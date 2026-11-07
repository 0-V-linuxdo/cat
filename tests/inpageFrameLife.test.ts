/* 补丁 inpage-tab-shake：失活标签的 iframe 不销毁、只停放（超时才销毁）；重建的 iframe 带外观。
 * 纯逻辑（决策表 / 常量 / URL 参数 / 滚动跟随）直接测；接线（content.ts / panel.ts / Commands.ts / tabState）按源码约束测。真实帧序列 = headed 验证项（见 README）。 */
import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { isParkedHost } from "@api/HostMode";

import { FRAME_IDLE_MSG, frameDecision, type FrameLifeIn, parseLookParam, shouldFollowScroll } from "../src/plugins/inpageSidebar/frameLife";

const SRC = resolve(import.meta.dir, "../src");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const code = (f: string) => strip(readFileSync(resolve(SRC, f), "utf8"));
const base: FrameLifeIn = { teardown: false, active: true, shown: true, blocked: false, hasFrame: false, stale: false, canBuild: true, parked: false };
const d = (o: Partial<FrameLifeIn>) => frameDecision({ ...base, ...o });
const NONE = { destroy: false, build: false, park: false, unpark: false };

describe("常量", () => {
    test("停放没有时限（补丁 inpage-park-forever）：没有 parkMs / parkExpired / FRAME 常量；失活 + 有 iframe 永远是 park，不销毁（细节见 tests/inpageParkForever.test.ts）", () => {
        expect(d({ active: false, hasFrame: true })).toEqual({ ...NONE, park: true });
    });
    test("停放通知的消息名不与现有协议撞（arc-inpage-* 家族）", () => { expect(FRAME_IDLE_MSG).toBe("arc-inpage-idle"); });
});

describe("frameDecision：生命周期决策表", () => {
    test("失活（别的标签成了前台）：有 iframe → 停放，不销毁；已停放 → 什么都不做（计时器已在跑）；没有 → 什么都不做", () => {
        expect(d({ active: false, hasFrame: true })).toEqual({ ...NONE, park: true });
        expect(d({ active: false, hasFrame: true, parked: true })).toEqual(NONE);
        expect(d({ active: false })).toEqual(NONE);
    });
    test("激活：停放着的 → 取消停放（不重建）；没停放 → 什么都不做；没有 iframe 且要显示 → 建", () => {
        expect(d({ hasFrame: true, parked: true })).toEqual({ ...NONE, unpark: true });
        expect(d({ hasFrame: true })).toEqual(NONE);
        expect(d({})).toEqual({ ...NONE, build: true });
    });
    test("激活但不该建：侧栏没展开 / blocked / 乐观状态没有 win·tab", () => {
        expect(d({ shown: false })).toEqual(NONE);
        expect(d({ blocked: true })).toEqual(NONE);
        expect(d({ canBuild: false })).toEqual(NONE);
    });
    test("设置关闭 / 扩展重载 / stale（teardown）：不论活动与否、停放与否，有 iframe 就销毁，且不建不停放", () => {
        for (const active of [true, false]) for (const parked of [true, false]) {
            expect(d({ teardown: true, active, parked, hasFrame: true })).toEqual({ ...NONE, destroy: true });
            expect(d({ teardown: true, active, parked })).toEqual(NONE);
        }
    });
    test("blocked（CSP / 握手超时）：失活的 iframe 不停放，直接销毁；激活不建", () => {
        expect(d({ active: false, hasFrame: true, blocked: true })).toEqual({ ...NONE, destroy: true });
        expect(d({ blocked: true, hasFrame: true })).toEqual(NONE); // 激活 + 有 iframe + blocked：rel52 同样不动（blocked 时 iframe 已被销毁，这是不可达分支）
    });
    test("stale（win / tab 与真实状态不一致）：失活 → 销毁；激活且要显示 → 销毁并重建；停放中的 stale 也销毁", () => {
        expect(d({ active: false, hasFrame: true, stale: true })).toEqual({ ...NONE, destroy: true });
        expect(d({ hasFrame: true, stale: true })).toEqual({ ...NONE, destroy: true, build: true });
        expect(d({ hasFrame: true, stale: true, parked: true })).toEqual({ ...NONE, destroy: true, build: true });
        expect(d({ hasFrame: true, stale: true, shown: false })).toEqual({ ...NONE, destroy: true });
    });
    test("受限页：该页没有内容脚本（没有 iframe 可管）；同窗口别的标签收到 active:false = 失活行（停放，到期销毁），切回普通页 = 激活行（取消停放，零重建）", () => {
        expect(d({ active: false, hasFrame: true })).toEqual({ ...NONE, park: true });
        expect(d({ hasFrame: true, parked: true })).toEqual({ ...NONE, unpark: true });
    });
    test("全组合不变量（2^8）：不会同时 park 与 unpark；park 只发生在失活 + 有 iframe；build 只发生在激活 + 没有可用 iframe；teardown 之后没有存活 iframe", () => {
        const bools = [false, true];
        for (const teardown of bools) for (const active of bools) for (const shown of bools) for (const blocked of bools) for (const hasFrame of bools)
            for (const stale of bools) for (const canBuild of bools) for (const parked of bools) {
                const c: FrameLifeIn = { teardown, active, shown, blocked, hasFrame, stale, canBuild, parked };
                const o = frameDecision(c);
                expect(o.park && o.unpark).toBe(false);
                if (o.park) { expect(!active && hasFrame && !stale && !teardown && !blocked).toBe(true); }
                if (o.unpark) { expect(active && hasFrame && !stale && parked && !teardown).toBe(true); }
                if (o.build) { expect(active && shown && !blocked && canBuild && !teardown && (!hasFrame || stale)).toBe(true); }
                if (o.destroy) { expect(hasFrame).toBe(true); }
                if (teardown) { expect(o.build || o.park || o.unpark).toBe(false); }
                // 决策后的 iframe 数 ≤ 1（建之前必先销毁旧的）
                const left = (hasFrame && !o.destroy ? 1 : 0) + (o.build ? 1 : 0); expect(left).toBeLessThanOrEqual(1);
            }
    });
});

describe("模拟：A ↔ B 来回切（内容脚本 render 的最小模型；停放没有计时器）", () => {
    /** 每个标签一份内容脚本；frame = 有没有 iframe，built = 累计建了几次；now 由测试推进（决策与时间无关） */
    const mk = () => {
        const s = { frame: false, parked: false, built: 0, destroyed: 0, now: 0 };
        const render = (active: boolean) => {
            const o = frameDecision({ ...base, active, hasFrame: s.frame, parked: s.parked });
            if (o.destroy) { s.frame = false; s.parked = false; s.destroyed++; }
            if (o.park) s.parked = true;
            if (o.unpark) s.parked = false;
            if (o.build) { s.frame = true; s.built++; }
        };
        return { s, render };
    };
    test("来回切：每个标签的 iframe 只建一次（rel52：每次切回都重建）", () => {
        const A = mk(), B = mk();
        A.render(true); B.render(false);
        for (let i = 0; i < 10; i++) { for (const t of [A, B]) t.s.now += 5_000; B.render(true); A.render(false); for (const t of [A, B]) t.s.now += 5_000; A.render(true); B.render(false); }
        expect(A.s.built).toBe(1); expect(B.s.built).toBe(1); expect(A.s.destroyed + B.s.destroyed).toBe(0);
    });
    test("停放 3 小时后切回 → 仍是同一个 iframe（不重建）", () => {
        const A = mk(); A.render(true); A.render(false); expect(A.s.frame).toBe(true);
        A.s.now += 3 * 3600_000; A.render(false); A.render(true);
        expect(A.s.built).toBe(1); expect(A.s.destroyed).toBe(0); expect(A.s.parked).toBe(false);
    });
});

describe("外观随 URL（重建的 iframe 不再「白 → 出行 → 换色」）", () => {
    test("parseLookParam：只认 flat / card", () => {
        expect(parseLookParam("?host=inpage&win=1&tab=2&look=flat")).toBe("flat");
        expect(parseLookParam("?look=card&host=inpage")).toBe("card");
        for (const bad of ["", "?look=", "?look=FLAT", "?look=x", "?host=inpage", "?look=flat%20x"]) expect(parseLookParam(bad)).toBeUndefined();
    });
    test("content.ts：URL 带 look；iframe 在 ready 之前 opacity:0（不用 visibility:hidden：跨源 iframe 隐藏会被浏览器降低渲染优先级），ready 时放出；销毁路径清干净；停放没有计时器", () => {
        const c = code("plugins/inpageSidebar/content.ts");
        expect(c).toMatch(/&look=\$\{look\}`/); expect(c).toMatch(/const look = shouldPush\(\{ mode: parseDisplayMode\(st\.displayMode\), pinned: !!st\.show && !blocked, fullscreen: fsActive \}\) \? "flat" : "card"/);
        expect(c).toMatch(/f\.style\.opacity = "0"/); expect(c).toMatch(/ready = true; iframe\.style\.opacity = ""/);
        expect(c).toMatch(/const destroyFrame = \(\) => \{[^\n]*clearPark\(\);[^\n]*iframe\?\.remove\(\)/); // 销毁一律先清停放状态
        expect(c).toMatch(/const clearPark = \(\) => \{ parked = false; \};/);
        expect(c).toMatch(/deferTimer\]\) if \(t\) clearTimeout\(t\)/); // teardown（设置关闭 / 重载 / stale）清其余计时器（停放没有计时器）
        expect(c).toMatch(/if \(parked\) postIdle\(true\)/); // ready 之后补发停放状态（停放发生在握手之前）
        expect(c).toMatch(/blocked = true; destroyFrame\(\)/); // 握手超时路径不变
    });
    test("panel.ts：启动时（发 ready 之前）同步套上 URL 里的外观；frameLook 仍可改；停放消息只认 window.parent、idle 必须是布尔", () => {
        const c = code("plugins/inpageSidebar/panel.ts");
        expect(c.indexOf("parseLookParam(location.search)")).toBeGreaterThan(0);
        expect(c.indexOf("parseLookParam(location.search)")).toBeLessThan(c.indexOf("tell(); reportTheme();"));
        expect(c).toMatch(/applyLook\(look0 === "flat"\)/); expect(c).toMatch(/applyLook\(d\.flat\); reportTheme\(\)/);
        expect(c).toMatch(/d\?\.type !== FRAME_IDLE_MSG \|\| typeof d\.idle !== "boolean"/); expect(c).toMatch(/e\.source !== window\.parent/);
        expect(c).toMatch(/delete root\.dataset\.inpageParked/);
    });
});

describe("停放期间的面板行为", () => {
    test("shouldFollowScroll：只在停放时跟随，差 ≤1 px / 非有限数不动", () => {
        expect(shouldFollowScroll({ idle: true, current: 0, next: 300 })).toBe(true);
        expect(shouldFollowScroll({ idle: true, current: 300, next: 300 })).toBe(false);
        expect(shouldFollowScroll({ idle: true, current: 300, next: 301 })).toBe(false);
        expect(shouldFollowScroll({ idle: false, current: 0, next: 300 })).toBe(false); // 前台：自己说了算
        expect(shouldFollowScroll({ idle: true, current: 0, next: Number.NaN })).toBe(false);
    });
    test("panel.ts：停放时不回写滚动位置，跟随 chrome.storage.session 里同窗口键", () => {
        const c = code("plugins/inpageSidebar/panel.ts");
        expect(c).toMatch(/if \(idle\) return;/); expect(c).toMatch(/area !== "session"/); expect(c).toMatch(/shouldFollowScroll\(\{ idle, current: e\.scrollTop, next: v \}\)/);
        expect(c).toMatch(/chrome\.storage\.onChanged\.removeListener\(onStore\)/);
    });
    const g = globalThis as Record<string, unknown>; const keep = g.document;
    afterAll(() => { g.document = keep; });
    test("isParkedHost：只在 ?host=inpage 且 <html data-inpage-parked=1> 时为真（原生侧栏 / 弹窗永远为假）", () => {
        const html: { dataset: Record<string, string> } = { dataset: {} }; g.document = { documentElement: html };
        expect(isParkedHost("?host=inpage&win=1&tab=2")).toBe(false);
        html.dataset.inpageParked = "1";
        expect(isParkedHost("?host=inpage&win=1&tab=2")).toBe(true);
        expect(isParkedHost("")).toBe(false); expect(isParkedHost("?popup=1")).toBe(false);
        delete html.dataset.inpageParked; expect(isParkedHost("?host=inpage")).toBe(false);
    });
    test("Commands.serveCommands：停放的 iframe 不执行 CMD（target 校验之后、runServed 之前）", () => {
        const c = code("api/Commands.ts");
        expect(c.indexOf("if (isParkedHost()) return;")).toBeGreaterThan(c.indexOf("msg.target !== getContext()) return;"));
        expect(c.indexOf("if (isParkedHost()) return;")).toBeLessThan(c.indexOf('runServed(msg, "message")'));
    });
    test("tabState：页内 iframe 切回可见时立即 reload（不等被节流的去抖）；停止时摘掉", () => {
        const c = code("plugins/_core/tabState/index.ts");
        expect(c).toMatch(/if \(isInpageHost\(\)\) document\.addEventListener\("visibilitychange", onVisible\)/);
        expect(c).toMatch(/document\.removeEventListener\("visibilitychange", onVisible\)/);
        expect(c).toMatch(/const onVisible = \(\) => \{ if \(document\.visibilityState === "visible"\) void reload\(\); \}/);
    });
});

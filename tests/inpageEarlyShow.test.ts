import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { EARLY, canBuildFrame, frameStale, hintFromState, hintToState, isFirstPlacement, mayShowOptimistic, parseHint, sameHint, shouldDeferInactive, withoutIds } from "../src/plugins/inpageSidebar/earlyShow";
import { type FitFacts, pushCss } from "../src/plugins/inpageSidebar/logic";
import { createPagePush, type PagePushDeps } from "../src/plugins/inpageSidebar/pagePush";

/* 补丁 inpage-early-show：提示（hint）校验 / 写入条件 / 乐观状态；pagePush.refit（document_start 推开时 body 还没有 → 之后补量）；接线与源码约束。
 * 真实时序（侧栏首次出现 vs DCL / load、冷 SW）要真浏览器——见 shots/measure-early.ts，这里不声称。 */

const DIR = resolve(import.meta.dir, "../src/plugins/inpageSidebar");
const src = (f: string) => readFileSync(resolve(DIR, f), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const GOOD = { v: 1 as const, show: true, width: 300, base: "rgb(30, 32, 32)", scheme: "dark" as const, win: 7, tab: 9 };

describe("parseHint：页面可写 sessionStorage，所以每个字段都当不可信", () => {
    test("合法提示原样（宽度夹取 164–500）；缺 / 坏的可选字段被丢弃而不是拒绝整条", () => {
        expect(parseHint(GOOD)).toEqual(GOOD);
        expect(parseHint({ ...GOOD, width: 9999 })!.width).toBe(500); expect(parseHint({ ...GOOD, width: 1 })!.width).toBe(164); expect(parseHint({ ...GOOD, width: "x" })!.width).toBe(228);
        expect(parseHint({ v: 1, show: false, width: 228 })).toEqual({ v: 1, show: false, width: 228 });
        expect(parseHint({ ...GOOD, base: "url(javascript:1)" })).toEqual({ v: 1, show: true, width: 300, win: 7, tab: 9 }); // 颜色只认 opaqueColor
        expect(parseHint({ ...GOOD, scheme: "sepia" })!.base).toBeUndefined(); // base / scheme 必须成对
        for (const bad of [{ win: 0 }, { win: 1.5 }, { win: -3 }, { tab: "9" }, { win: 7, tab: undefined }]) { const r = parseHint({ ...GOOD, ...bad })!; expect(r.win).toBeUndefined(); expect(r.tab).toBeUndefined(); }
    });
    test("版本 / show 类型不对、非对象 → undefined（不会因为页面写了垃圾而显示壳）", () => {
        for (const bad of [undefined, null, 1, "x", [], {}, { v: 2, show: true, width: 228 }, { v: 1, show: "true", width: 228 }, { v: 1, show: 1 }]) expect(parseHint(bad)).toBeUndefined();
    });
});

describe("hintFromState / sameHint / withoutIds：什么时候记、记什么", () => {
    const st = { active: true, show: true, width: 300, windowId: 7, tabId: 9 };
    const ok = { st, theme: { base: "rgb(1, 2, 3)", scheme: "light" as const }, blocked: false, visible: true, real: true };
    test("只在 真实状态已到 + 活动标签 + 页面可见 + iframe 没被拦 时记", () => {
        expect(hintFromState(ok)).toEqual({ v: 1, show: true, width: 300, base: "rgb(1, 2, 3)", scheme: "light", win: 7, tab: 9 });
        for (const o of [{ real: false }, { visible: false }, { blocked: true }, { st: undefined }, { st: { ...st, active: false } }]) expect(hintFromState({ ...ok, ...o })).toBeUndefined();
        expect(hintFromState({ ...ok, st: { ...st, show: false } })!.show).toBe(false); // 用户关了侧栏也要记（下一个页面别乐观显示）
        expect(hintFromState({ ...ok, theme: undefined })!.base).toBeUndefined();
    });
    test("sameHint 逐字段比较；withoutIds 去掉 win / tab（第 2 层跨标签不带）", () => {
        const h = hintFromState(ok)!; expect(sameHint(h, { ...h })).toBe(true); expect(sameHint(h, { ...h, width: 301 })).toBe(false); expect(sameHint(h, undefined)).toBe(false); expect(sameHint(undefined, undefined)).toBe(false);
        expect(withoutIds(h)).toEqual({ v: 1, show: true, width: 300, base: "rgb(1, 2, 3)", scheme: "light" });
    });
    test("写 → 读 往返：写出来的东西 parseHint 一定接受且相等", () => { const h = hintFromState(ok)!; expect(parseHint(JSON.parse(JSON.stringify(h)))).toEqual(h); });
});

describe("乐观状态与规则", () => {
    test("hintToState：active:true、显示方式 / 悬停 / 按钮来自本地设置；第 2 层（无 id）windowId / tabId = 0 → 不建 iframe", () => {
        const s = hintToState(parseHint(GOOD)!, { displayMode: "overlay", hover: true, handle: false });
        expect(s).toMatchObject({ type: "inpage:state", windowId: 7, tabId: 9, active: true, show: true, nativeOpen: false, prewarm: false, warm: false, width: 300, displayMode: "overlay", hover: true, handle: false });
        const l = hintToState(withoutIds(parseHint(GOOD)!), { displayMode: "junk", hover: false, handle: true });
        expect(l.windowId).toBe(0); expect(l.displayMode).toBe("push"); expect(canBuildFrame(l)).toBe(false); expect(canBuildFrame(s)).toBe(true);
        expect(canBuildFrame(undefined)).toBe(false);
    });
    test("frameStale：win / tab 任一不同就重建；没建 / 没状态 = 不算", () => {
        expect(frameStale({ win: 7, tab: 9 }, { windowId: 7, tabId: 9 })).toBe(false); expect(frameStale({ win: 7, tab: 9 }, { windowId: 8, tabId: 9 })).toBe(true); expect(frameStale({ win: 7, tab: 9 }, { windowId: 7, tabId: 10 })).toBe(true);
        expect(frameStale(undefined, { windowId: 1, tabId: 1 })).toBe(false); expect(frameStale({ win: 1, tab: 1 }, undefined)).toBe(false);
    });
    test("shouldDeferInactive：只有「乐观壳已显示 + 还没有真实状态 + 状态 inactive + 标签可见」才缓一缓", () => {
        const b = { hinted: true, realSeen: false, active: false, visible: true }; expect(shouldDeferInactive(b)).toBe(true);
        for (const o of [{ hinted: false }, { realSeen: true }, { active: true }, { visible: false }]) expect(shouldDeferInactive({ ...b, ...o })).toBe(false);
        expect(EARLY.inactiveGraceMs).toBeGreaterThan(0); expect(EARLY.inactiveGraceMs).toBeLessThan(2000);
    });
    test("isFirstPlacement：没有任何状态 = 是；已有状态但还没摆过 active 且仍在新页面窗口内 = 是（冷 SW 的第二条状态）；之后的切换 = 否（动画照播）", () => {
        expect(isFirstPlacement({ hasState: false, activated: false, fresh: false })).toBe(true);
        expect(isFirstPlacement({ hasState: true, activated: false, fresh: true })).toBe(true);
        expect(isFirstPlacement({ hasState: true, activated: false, fresh: false })).toBe(false); // 后台加载的标签过了很久才被切到
        expect(isFirstPlacement({ hasState: true, activated: true, fresh: true })).toBe(false);
    });
    test("mayShowOptimistic：可见 + 非预渲染 + 提示说要显示", () => {
        const h = parseHint(GOOD); expect(mayShowOptimistic({ visible: true, prerendering: false, hint: h })).toBe(true);
        expect(mayShowOptimistic({ visible: false, prerendering: false, hint: h })).toBe(false); expect(mayShowOptimistic({ visible: true, prerendering: true, hint: h })).toBe(false);
        expect(mayShowOptimistic({ visible: true, prerendering: false, hint: { ...h!, show: false } })).toBe(false); expect(mayShowOptimistic({ visible: true, prerendering: false, hint: undefined })).toBe(false);
    });
    test("常量：两层的键名不同、第 2 层键在 data: 命名空间；时间窗口是正数", () => {
        expect(EARLY.sessionKey).not.toBe(EARLY.localKey); expect(EARLY.localKey).toBe("data:inpageSidebarHint"); expect(EARLY.freshMs).toBeGreaterThan(0); expect(EARLY.version).toBe(1);
    });
});

describe("pagePush.refit：document_start 推开（body 还没有）之后补量", () => {
    function env(o: { facts: () => FitFacts | null; ml?: () => number }) {
        let css = ""; const log: string[] = []; const timers = new Map<number, () => void>(); let tid = 0; let cb: (() => void) | undefined;
        const deps: PagePushDeps = {
            scan: () => [], isOwn: () => false, position: () => "static", marginLeft: () => (o.ml ? o.ml() : Number(/margin-left: ([\d.]+)px/.exec(css)?.[1] ?? 0)), clientWidth: () => 1200, rtlScrollbar: () => 0,
            flush: () => { log.push("flush"); }, reducedMotion: () => false, fitFacts: o.facts,
            sheet: { set: c => { css = c; log.push("set"); }, clear: () => { css = ""; log.push("clear"); } },
            observe: c => { cb = c; return () => { cb = undefined; }; }, setTimer: (fn) => { const id = ++tid; timers.set(id, fn); return id; }, clearTimer: t => { timers.delete(t as number); },
        };
        return { deps, log, get css() { return css; }, mutate: () => cb?.(), flushTimers: () => { for (const [id, fn] of timers) { timers.delete(id); fn(); } }, pending: () => timers.size };
    }
    const full = (): FitFacts => ({ htmlW: 1200, htmlMl: 0, clientW: 1200, innerW: 1200, bodyW: 1200, bodyMinW: 1200 }); // 想占满视口的页面
    test("安装时 body 不存在（fitFacts null）→ 没有 fit；refit 时 body 在了 → 按「没有我们样式」重量并加上 width:auto / body max-width；偏移不变", () => {
        let body = false; const e = env({ facts: () => body ? full() : null }); const p = createPagePush(e.deps);
        p.set(228, { animate: false }); expect(e.css).toBe(pushCss(228, false)); expect(p.fit()).toEqual({ html: false, body: false, bodyMin: false });
        body = true; p.refit();
        expect(p.fit()).toEqual({ html: true, body: true, bodyMin: true }); expect(e.css).toBe(pushCss(228, false, { html: true, body: true, bodyMin: true }));
        expect(p.state()).toMatchObject({ offset: 228, installed: true });
        const i = e.log.lastIndexOf("clear"); expect(e.log.slice(i)).toEqual(["clear", "flush", "set", "flush"]); // 摘表 → 量 → 重装，同一个任务里完成（没有 await / 定时器夹在中间）
    });
    test("refit 重读 html 的原 margin-left（页面样式晚到）：新基数 = 页面自己的值 + 偏移", () => {
        let page = 0, body = false; const e = env({ facts: () => body ? { ...full(), htmlMl: page } : null, ml: () => (e.css ? 228 + page : page) });
        const p = createPagePush(e.deps); p.set(228, { animate: false }); expect(e.css).toContain("margin-left: 228px");
        page = 16; body = true; p.refit(); expect(e.css).toContain("margin-left: 244px");
    });
    test("body 出现后的下一次扫描（MutationObserver → 去抖）自动触发 refit，之后不再重量；没推开 / 收回后 refit 什么都不做", () => {
        let body = false, measured = 0; const e = env({ facts: () => { if (body) measured++; return body ? full() : null; } }); const p = createPagePush(e.deps);
        p.refit(); expect(e.log).toEqual([]); // 没推开
        p.set(228, { animate: false }); body = true; e.mutate(); e.flushTimers(); // 扫描定时器 → rescan → fitPending && facts → refit
        expect(p.fit().html).toBe(true); const clears = () => e.log.filter(x => x === "clear").length; const c0 = clears();
        e.flushTimers(); e.mutate(); e.flushTimers(); e.mutate(); e.flushTimers(); // 后续扫描不再重量（fitPending 已清）：没有新的「摘表」
        expect(clears()).toBe(c0); expect(p.fit().html).toBe(true); expect(measured).toBeGreaterThan(0);
        p.set(0, { animate: false }); const n = e.log.length; p.refit(); expect(e.log.length).toBe(n);
    });
    test("没有 fitFacts 依赖（旧环境 / 单测假环境）：安装与 refit 都不产生 pending，refit 只做一次无害重装", () => {
        const e = env({ facts: undefined as never }); delete (e.deps as { fitFacts?: unknown }).fitFacts; const p = createPagePush(e.deps);
        p.set(228, { animate: false }); expect(p.fit()).toEqual({ html: false, body: false, bodyMin: false }); p.refit(); expect(e.css).toBe(pushCss(228, false));
    });
});

describe("接线与源码约束", () => {
    test("manifest：内容脚本 document_start、只匹配 http(s)（提前显示的前提）", () => {
        const m = JSON.parse(readFileSync(resolve(import.meta.dir, "../static/manifest.json"), "utf8")) as { content_scripts: { run_at: string; matches: string[]; js: string[] }[] };
        expect(m.content_scripts[0]!.run_at).toBe("document_start"); expect(m.content_scripts[0]!.matches).toEqual(["http://*/*", "https://*/*"]);
    });
    test("content.ts：sessionStorage 读写都在 try 里；提示只读不信（parseHint）；connect 先于 loadHint；乐观状态只在 visible + 非 prerender；iframe 要 canBuildFrame；DCL / load 补量", () => {
        const c = strip(src("content.ts"));
        expect(c).toMatch(/try \{ const r = sessionStorage\.getItem\(EARLY\.sessionKey\); return r \? parseHint\(JSON\.parse\(r\)\) : undefined; \} catch/);
        expect(c).toMatch(/try \{ sessionStorage\.setItem\(EARLY\.sessionKey, JSON\.stringify\(h\)\); \} catch/);
        expect(c).toMatch(/parseHint\(\(r as Record<string, unknown> \| undefined\)\?\.\[EARLY\.localKey\]\)/);
        expect(c.indexOf("connect(); loadHint();")).toBeGreaterThan(0); expect(c).toMatch(/mayShowOptimistic\(\{ visible: document\.visibilityState === "visible", prerendering:/);
        expect(c).toMatch(/!canBuildFrame\(st\)/); expect(c).toMatch(/frameStale\(frameIds, st\)/);
        expect(c).toMatch(/addEventListener\("DOMContentLoaded", refit/); expect(c).toMatch(/addEventListener\("load", refit/);
        expect(c).toMatch(/render\(first\)/); { const i = strip(src("instantRender.ts")); expect(i).toMatch(/c\.box\.style\.setProperty\("transition", "none"\)/); expect(i).toMatch(/c\.box\.style\.removeProperty\("transition"\)/); } // 补丁 prepare-render：挪到 instantRender.ts
        expect(c).not.toMatch(/localStorage/); // 不碰页面源的 localStorage
        expect(c).not.toMatch(/console\.(error|log)\(/);
    });
    test("content.ts：写提示在 applyState / 主题回报里；测量用的 dataset 只在 IS_DEV 下", () => {
        const c = strip(src("content.ts"));
        expect(c).toMatch(/st = m; realSeen = true; render\(first\);/); expect(c).toMatch(/persistHint\(\);\s*\n\s*if \(m\.hint === "switch-failed"/); expect(c).toMatch(/theme = t; applyBg\(\); persistHint\(\)/);
        for (const k of ["tState", "tHint", "tStart"]) expect(c).toMatch(new RegExp(`if \\(IS_DEV\\)[^\\n]*dataset\\.${k}`));
    });
    test("earlyShow.ts / pagePush.ts：不 import chrome / ErrorLog、没有控制台调用", () => {
        for (const f of ["earlyShow.ts", "pagePush.ts"]) { const c = strip(src(f)); expect(c).not.toMatch(/chrome\.|@api\/ErrorLog|safe\(|console\./); }
    });
});

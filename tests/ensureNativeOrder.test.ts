import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
    commandBarPopupQuery, ENSURE_NATIVE_ACK_MS, ENSURE_NATIVE_MSG, ensureNativeAck, inpageActiveFor, NATIVE_GESTURE_BUDGET_MS, nativeGestureUsable, navigateAfterNative, setInpageProbe,
} from "../src/api/HostMode";

/* patch 07：先切原生再导航的顺序（ack / 超时）、手势预算降级、全局命令弹窗（Alt+T）的 via 探针 */
const g = globalThis as { chrome?: unknown };
const oldChrome = g.chrome;
const IFRAME = "?host=inpage&win=7&tab=2";
afterEach(() => { g.chrome = oldChrome; setInpageProbe(undefined); delete (globalThis.navigator as unknown as Record<string, unknown>).userActivation; });
const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));
/** 可控的 SW：send 记录进 log；ack() 才应答 */
function mkSW() {
    const log: string[] = []; const sent: unknown[] = []; let respond: (v?: unknown) => void = () => { }; let fail: (e: unknown) => void = () => { };
    g.chrome = { runtime: { sendMessage: (m: unknown) => { log.push("send"); sent.push(m); return new Promise((res, rej) => { respond = res; fail = rej; }); } } };
    return { log, sent, ack: () => respond({ type: "inpage:ensure-native-ack" }), reject: () => fail(new Error("The message port closed before a response was received.")) };
}

describe("ensureNativeAck / navigateAfterNative：消息先于导航（等 ack）", () => {
    test("常量：ack 超时 500 ms（SW 冷启动实测 29 ms，留余量）；手势预算 3000 ms（E8：≤3002 ms 成功、6002 ms 失败）", () => {
        expect(ENSURE_NATIVE_ACK_MS).toBe(500); expect(NATIVE_GESTURE_BUDGET_MS).toBe(3000);
    });
    test("不需要切（普通网页 / 不在页内上下文）：不发消息，ensureNativeAck 返回 undefined，go **同步**执行、返回值原样（不多一个微任务）", () => {
        const sw = mkSW(); const log = sw.log;
        expect(ensureNativeAck("https://a.com", "create", undefined, { search: IFRAME })).toBeUndefined();
        expect(ensureNativeAck("chrome://settings", "navigate", undefined, { search: "" })).toBeUndefined();
        const r = navigateAfterNative("https://a.com", "create", undefined, () => { log.push("go"); return 42; }, { search: IFRAME });
        expect(r).toBe(42); expect(log).toEqual(["go"]);
        expect(sw.sent).toEqual([]);
    });
    test("要切：消息同步发出，go 在 ack 之后才执行（顺序 send → ack → go），go 的返回值经 Promise 透传", async () => {
        const sw = mkSW();
        const p = navigateAfterNative("chrome://history", "create", undefined, () => { sw.log.push("go"); return 7; }, { search: IFRAME, ackMs: 1000 }) as Promise<number>;
        expect(p).toBeInstanceOf(Promise);
        expect(sw.log).toEqual(["send"]); // 返回时消息已发出（同步），导航还没执行
        expect(sw.sent).toEqual([{ type: ENSURE_NATIVE_MSG, kind: "create", url: "chrome://history", windowId: 7 }]);
        await tick(5); expect(sw.log).toEqual(["send"]); // 没 ack 之前不导航
        sw.ack(); expect(await p).toBe(7); expect(sw.log).toEqual(["send", "go"]);
    });
    test("SW 死了 / 没人应答：到 ackMs 超时后照常导航（从不无限阻塞），且不会提前导航", async () => {
        const sw = mkSW(); const t0 = Date.now();
        await navigateAfterNative("chrome://settings", "navigate", 5, () => { sw.log.push("go"); }, { search: IFRAME, ackMs: 60 });
        const dt = Date.now() - t0; expect(sw.log).toEqual(["send", "go"]); expect(dt).toBeGreaterThanOrEqual(50); expect(dt).toBeLessThan(400);
    });
    test("ack 先到时清掉超时计时器（不会在导航后再触发一次）", async () => {
        const sw = mkSW(); let n = 0;
        const p = navigateAfterNative("chrome://settings", "navigate", 5, () => { n++; }, { search: IFRAME, ackMs: 40 });
        sw.ack(); await p; await tick(80); expect(n).toBe(1);
    });
    test("sendMessage 异步拒绝（端口在应答前关闭 / 没有监听）→ 立刻导航，不等满超时；同步抛（扩展上下文失效）→ 也导航", async () => {
        const sw = mkSW(); const t0 = Date.now();
        const p = navigateAfterNative("chrome://settings", "navigate", 5, () => { sw.log.push("go"); }, { search: IFRAME, ackMs: 1000 });
        sw.reject(); await p; expect(Date.now() - t0).toBeLessThan(300); expect(sw.log).toEqual(["send", "go"]);
        const log: string[] = []; g.chrome = { runtime: { sendMessage: () => { throw new Error("Extension context invalidated."); } } };
        await navigateAfterNative("chrome://settings", "navigate", 5, () => { log.push("go"); }, { search: IFRAME }); expect(log).toEqual(["go"]);
    });
    test("没有 chrome.runtime：不发、go 同步执行", () => {
        delete g.chrome; const log: string[] = [];
        navigateAfterNative("chrome://settings", "navigate", 5, () => { log.push("go"); }, { search: IFRAME }); expect(log).toEqual(["go"]);
    });
    test("命令栏弹窗路径（pure logic）：带 via=inpage 的弹窗按 ?win= 发、等 ack 再导航；不带 via 的弹窗不发", async () => {
        const sw = mkSW();
        const withVia = "?" + commandBarPopupQuery(5, false, true), noVia = "?" + commandBarPopupQuery(5, false, false);
        const p = navigateAfterNative("chrome://extensions", "navigate", undefined, () => { sw.log.push("go"); }, { search: withVia, ackMs: 1000 });
        expect(sw.sent).toEqual([{ type: ENSURE_NATIVE_MSG, kind: "navigate", url: "chrome://extensions", windowId: 5 }]); sw.ack(); await p; expect(sw.log).toEqual(["send", "go"]);
        const q = mkSW(); const r = navigateAfterNative("chrome://extensions", "navigate", undefined, () => { q.log.push("go"); }, { search: noVia }); expect(r).toBeUndefined(); expect(q.log).toEqual(["go"]);
    });
});

describe("手势预算 / 事件自身不是激活触发事件的降级（⚠ 降级，不发明证据）", () => {
    test("nativeGestureUsable：gestureAt 在预算内可用，超过 3000 ms 不可用；needActive 要求 userActivation.isActive === true（API 缺失 = 不可用）", () => {
        expect(nativeGestureUsable({})).toBe(true);
        expect(nativeGestureUsable({ gestureAt: 10_000, now: 10_000 + 3000 })).toBe(true);
        expect(nativeGestureUsable({ gestureAt: 10_000, now: 10_000 + 3001 })).toBe(false);
        expect(nativeGestureUsable({ needActive: true }, { isActive: true })).toBe(true);
        expect(nativeGestureUsable({ needActive: true }, { isActive: false })).toBe(false);
        expect(nativeGestureUsable({ needActive: true }, undefined)).toBe(false);
        expect(nativeGestureUsable({ needActive: true, gestureAt: 0, now: 5000 }, { isActive: true })).toBe(false);
    });
    test("手势过期（await 之后很久才到）：不发消息，go 同步执行（降级 = 直接导航，兜底按钮 / 角标 / 快捷键）；新鲜则发", async () => {
        const sw = mkSW();
        const r = navigateAfterNative("chrome://settings", "navigate", 5, () => { sw.log.push("go"); return 1; }, { search: IFRAME, gestureAt: Date.now() - 4000 });
        expect(r).toBe(1); expect(sw.log).toEqual(["go"]);
        const p = navigateAfterNative("chrome://settings", "navigate", 5, () => 2, { search: IFRAME, gestureAt: Date.now() - 100, ackMs: 1000 }); expect(sw.log).toEqual(["go", "send"]); sw.ack(); expect(await p).toBe(2);
    });
    test("drop（needActive）：本文档没有瞬时激活 → 不发、直接导航；有激活 → 发、等 ack", async () => {
        const nav = globalThis.navigator as unknown as Record<string, unknown>;
        const sw = mkSW();
        Object.defineProperty(nav, "userActivation", { value: { isActive: false }, configurable: true });
        const r = navigateAfterNative("chrome://x", "navigate", 5, () => "merged", { search: IFRAME, needActive: true }); expect(r).toBe("merged"); expect(sw.sent).toEqual([]);
        Object.defineProperty(nav, "userActivation", { value: { isActive: true }, configurable: true });
        const p = navigateAfterNative("chrome://x", "navigate", 5, () => "merged", { search: IFRAME, needActive: true, ackMs: 1000 }); expect(sw.sent.length).toBe(1); sw.ack(); expect(await p).toBe("merged");
    });
});

describe("全局命令弹窗（Alt+T）：inpage 探针与弹窗查询串", () => {
    test("没装探针（插件关闭 / 冷 SW）= 永远 false；探针抛错 = false；装了按窗口回答；撤掉后回到 false", () => {
        expect(inpageActiveFor(7)).toBe(false);
        setInpageProbe(w => w === 7); expect(inpageActiveFor(7)).toBe(true); expect(inpageActiveFor(8)).toBe(false); expect(inpageActiveFor(undefined)).toBe(false);
        setInpageProbe(() => { throw new Error("x"); }); expect(inpageActiveFor(7)).toBe(false);
        setInpageProbe(undefined); expect(inpageActiveFor(7)).toBe(false);
    });
    test("commandBarPopupQuery：popup=commandBar&win=…[&edit=1][&via=inpage]，与旧的内联拼法逐字一致", () => {
        const old = (win: number, edit: boolean, via: boolean) => `popup=commandBar&win=${win}${edit ? "&edit=1" : ""}${via ? "&via=inpage" : ""}`;
        for (const edit of [false, true]) for (const via of [false, true]) expect(commandBarPopupQuery(9, edit, via)).toBe(old(9, edit, via));
        expect(commandBarPopupQuery(9, false, true)).toBe("popup=commandBar&win=9&via=inpage");
    });
});

/* —— 源码扫描：调用点没有退回成「发了不等」，降级参数都在 —— */
describe("调用点锁定（源码扫描）", () => {
    const src = (p: string) => readFileSync(resolve(import.meta.dir, "..", p), "utf8");
    const SHARED = ["src/components/TabRow.ts", "src/plugins/tabs/todayTabs/index.ts", "src/plugins/command/commandBar/index.ts", "src/plugins/command/navigation/index.ts", "src/plugins/views/siteControls/index.ts", "src/plugins/command/shortcuts/index.ts", "src/plugins/tabs/tabActions/index.ts"];
    test("共享文件里不再有「发了不等」的 ensureNativeBeforeNavigate（都走 navigateAfterNative / ensureNativeAck）", () => {
        for (const f of SHARED) expect(src(f)).not.toMatch(/ensureNativeBeforeNavigate\s*\(/);
        for (const f of SHARED) expect(src(f)).toMatch(/navigateAfterNative|ensureNativeAck/);
    });
    test("drop 两处带 needActive；await 之后的三处带 gestureAt（step / recentCommit / siteControls optionsUrl）", () => {
        const t = src("src/plugins/tabs/todayTabs/index.ts"); expect(t.match(/needActive: true/g)?.length).toBe(2);
        const a = src("src/plugins/tabs/tabActions/index.ts"); expect(a).toMatch(/gestureAt \}\)/); expect(a.match(/\{ gestureAt \}/g)?.length).toBe(2);
        expect(src("src/plugins/views/siteControls/index.ts")).toMatch(/optionsUrl, \{ gestureAt: clickedAt \}/);
    });
    test("recentCommit：列表已就绪时第一个 await 之前就发消息（ready 才跳过 await）；keydown / 点击刷新手势时间", () => {
        const a = src("src/plugins/tabs/tabActions/index.ts");
        expect(a).toMatch(/if \(!recent\.ready\) await recent\.loading;/); expect(a).toMatch(/recent\.ready = true;/);
        expect(a).toMatch(/recent\.sel = i; recent\.at = Date\.now\(\)/);
    });
    test("命令栏 go()：发了消息就等 ack 之后再 nav() + close()（弹窗先关 = 脚本没了、导航发不出去）；openCentered 问探针", () => {
        const c = src("src/plugins/command/commandBar/index.ts");
        expect(c).toMatch(/ack\.then\(nav\)\.then\(close, close\)/); // patch 08：导航 promise 落定之后才 close expect(c).toMatch(/inpageActiveFor\(win\.id\)/); expect(c).toMatch(/commandBarPopupQuery\(win\.id, edit, viaInpage\)/);
    });
    test("SW：ensure 的 ack 是同步 sendResponse（open 之后、finally 里），监听仍返回 false；探针由插件 start 装 / cleanup 撤", () => {
        const b = src("src/plugins/inpageSidebar/background.ts");
        expect(b).toMatch(/finally \{ try \{ sendResponse\?\.\(\{ type: ENSURE_NATIVE_ACK \}\)/);
        expect(b).toMatch(/onEnsureNativeMessage\(msg, sender, sendResponse\)/); expect(b).toMatch(/return false; \}\);/);
        expect(b).toMatch(/setInpageProbe\(w => bgActive/); expect(b).toMatch(/setInpageProbe\(undefined\)/);
    });
});

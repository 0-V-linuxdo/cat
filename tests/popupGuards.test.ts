import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
    ENSURE_BLUR_GRACE_MS, ensureNativeAck, ensureTargetWindow, lastEnsureNativeAt, nativeEnsurePending, navigateAfterNative, noteEnsureNative, pageBlurAction, popupBlurAction, senderIsInpagePopup,
} from "../src/api/HostMode";
import { createCommitter, gestureNow, withGesture } from "../src/plugins/command/commandBar/popupLogic";

/* patch 08：命令栏弹窗 ①手势时刻（gestureAt）②回车 / 点行只提交一次 ③失焦即关与 ensure-native 的竞争 */
const g = globalThis as { chrome?: unknown };
const oldChrome = g.chrome;
const POPUP = "?popup=commandBar&win=7&via=inpage";
afterEach(() => { g.chrome = oldChrome; });
const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));
function mkSW() {
    const sent: unknown[] = []; let respond: (v?: unknown) => void = () => { };
    g.chrome = { runtime: { sendMessage: (m: unknown) => { sent.push(m); return new Promise(res => { respond = res; }); } } };
    return { sent, ack: () => respond({ type: "inpage:ensure-native-ack" }) };
}

describe("① 手势时刻：keydown / click 当下取，stale 等待之后仍按它算预算", () => {
    test("withGesture：fn 的同步段里 gestureNow() = at，之后恢复（含抛错、嵌套）", () => {
        expect(gestureNow()).toBeUndefined();
        withGesture(11, () => { expect(gestureNow()).toBe(11); withGesture(22, () => expect(gestureNow()).toBe(22)); expect(gestureNow()).toBe(11); });
        expect(gestureNow()).toBeUndefined();
        expect(() => withGesture(5, () => { throw new Error("x"); })).toThrow(); expect(gestureNow()).toBeUndefined();
    });
    test("回车时结果 stale：等 waitFresh 之后执行的 fn 仍然读到 keydown 的时刻（不是执行时刻）", async () => {
        const c = createCommitter(); const seen: Array<number | undefined> = [];
        let fresh!: () => void; const wait = new Promise<void>(r => { fresh = r; });
        c.press(1000, () => { seen.push(gestureNow()); }, wait);
        await tick(5); expect(seen).toEqual([]); // 还在等
        fresh(); await tick(0); expect(seen).toEqual([1000]); expect(gestureNow()).toBeUndefined();
    });
    test("stale 等了 3.5 s 才就绪（手势已过期）：ensureNativeAck 因 gestureAt 超预算不发消息；3 s 内就绪则照发", () => {
        const sw = mkSW(); const now = 10_000;
        expect(ensureNativeAck("chrome://settings", "create", undefined, { search: POPUP, gestureAt: now - 3500, now })).toBeUndefined(); expect(sw.sent).toEqual([]);
        const p = ensureNativeAck("chrome://settings", "create", undefined, { search: POPUP, gestureAt: now - 2900, now, ackMs: 30 });
        expect(p).toBeInstanceOf(Promise); expect(sw.sent.length).toBe(1);
    });
    test("tab: 行 / go() / openTab 都经 gestureNow() 传 gestureAt（源码扫描）", () => {
        const c = readFileSync(resolve(__dirname, "../src/plugins/command/commandBar/index.ts"), "utf8");
        expect(c).toMatch(/ensureNativeAck\(t\.url, "activate", t\.id, \{ gestureAt: gestureNow\(\) \}\)/);
        expect(c).toMatch(/ensureNativeAck\(url, target != null \? "navigate" : "create", target, \{ gestureAt: gestureNow\(\) \}\)/);
        expect(c).toMatch(/navigateAfterNative\(url, "create", undefined, create, \{ gestureAt: gestureNow\(\) \}\)/);
        expect(c).toMatch(/committer\.press\(Date\.now\(\), \(\) => enter\(shift\), stale \? waitFresh\(\) : undefined\)/);
        expect(c).toMatch(/onclick: \(\) => \{ committer\.press\(Date\.now\(\)/);
    });
});

describe("② 一次性提交：ack 等待（≤500 ms）期间再回车 / 再点行不重复导航", () => {
    test("committer：第一次执行，之后返回 false 且不执行；release 后可再提交", () => {
        const c = createCommitter(); let n = 0;
        expect(c.press(1, () => { n++; })).toBe(true); expect(c.committed).toBe(true);
        expect(c.press(2, () => { n++; })).toBe(false); expect(n).toBe(1);
        c.release(); expect(c.press(3, () => { n++; })).toBe(true); expect(n).toBe(2);
    });
    test("stale 等待期间的第二次回车也被挡住（等待本身就算提交）", async () => {
        const c = createCommitter(); let n = 0; let fresh!: () => void; const wait = new Promise<void>(r => { fresh = r; });
        expect(c.press(1, () => { n++; }, wait)).toBe(true); expect(c.press(2, () => { n++; }, undefined)).toBe(false);
        fresh(); await tick(); expect(n).toBe(1);
    });
    test("同步抛错 / 等待被拒绝 → 释放（不会把命令栏锁死）", async () => {
        const c = createCommitter();
        expect(() => c.press(1, () => { throw new Error("boom"); })).toThrow(); expect(c.committed).toBe(false);
        c.press(2, () => undefined, Promise.reject(new Error("no"))); await tick(); expect(c.committed).toBe(false);
    });
    test("集成：go() 形态——发 ensure-native、等 ack 后导航一次；ack 期间连按 3 次回车只导航 1 次、只发 1 条消息", async () => {
        const sw = mkSW(); const c = createCommitter(); let navs = 0, closes = 0;
        const go = () => {
            const ack = ensureNativeAck("chrome://settings", "create", undefined, { search: POPUP, ackMs: 1000, gestureAt: gestureNow() });
            const nav = () => { navs++; return Promise.resolve(); };
            if (ack) { void ack.then(nav).then(() => { closes++; }); return; }
            void nav(); closes++;
        };
        const enter = () => c.press(Date.now(), go);
        expect(enter()).toBe(true); expect(enter()).toBe(false); expect(enter()).toBe(false);
        await tick(10); expect(navs).toBe(0); expect(sw.sent.length).toBe(1); // 还在等 ack：没导航、没关
        sw.ack(); await tick(5); expect(navs).toBe(1); expect(closes).toBe(1);
        expect(enter()).toBe(false); await tick(5); expect(navs).toBe(1); // 导航之后也不再接受
    });
    test("集成：不需要切（普通网页）时导航同步发生，第二次回车也被挡", () => {
        mkSW(); const c = createCommitter(); let navs = 0;
        const enter = () => c.press(Date.now(), () => { navigateAfterNative("https://a.com", "create", undefined, () => { navs++; }, { search: POPUP }); });
        enter(); enter(); expect(navs).toBe(1);
    });
    test("空输入回车：go('') 释放，用户可以继续输入（源码扫描）", () => {
        const c = readFileSync(resolve(__dirname, "../src/plugins/command/commandBar/index.ts"), "utf8");
        expect(c).toMatch(/if \(!q\.trim\(\)\) \{ committer\.release\(\); return; \}/);
    });
});

describe("③ 失焦即关 × sidePanel.open 的焦点变化", () => {
    const base = { popupId: 50, born: 0, now: 10_000 };
    test("popupBlurAction：弹窗自己拿焦点 / 刚开 500 ms 内 = ignore；其它窗口拿焦点且没有 ensure = close（与 07 一致）", () => {
        expect(popupBlurAction({ ...base, focused: 50 })).toBe("ignore");
        expect(popupBlurAction({ ...base, focused: 3, now: 499 })).toBe("ignore");
        expect(popupBlurAction({ ...base, focused: 3 })).toBe("close");
        expect(popupBlurAction({ ...base, focused: -1 })).toBe("close"); // WINDOW_ID_NONE = 别的应用
    });
    test("ensure-native 刚发过（grace 内）= defer；过了 grace = close；ensureAt 在未来 / 缺失 = close", () => {
        expect(popupBlurAction({ ...base, focused: 3, ensureAt: 9_900 })).toBe("defer");
        expect(popupBlurAction({ ...base, focused: 3, ensureAt: 10_000 - ENSURE_BLUR_GRACE_MS + 1 })).toBe("defer");
        expect(popupBlurAction({ ...base, focused: 3, ensureAt: 10_000 - ENSURE_BLUR_GRACE_MS })).toBe("close");
        expect(popupBlurAction({ ...base, focused: 3, ensureAt: 20_000 })).toBe("close");
        expect(popupBlurAction({ ...base, focused: 3, ensureAt: undefined })).toBe("close");
        expect(ENSURE_BLUR_GRACE_MS).toBeGreaterThan(500); // 必须盖住 ack 超时（500 ms）
    });
    test("pageBlurAction（弹窗页自己的 blur 复查）：有焦点 keep；没焦点但 ensure 在等 = wait；否则 close", () => {
        expect(pageBlurAction({ hasFocus: true, pending: true })).toBe("keep");
        expect(pageBlurAction({ hasFocus: false, pending: true })).toBe("wait");
        expect(pageBlurAction({ hasFocus: false, pending: false })).toBe("close");
    });
    test("nativeEnsurePending：发出消息到 ack / 超时 / reject 之间为真，之后为假；没发消息不影响", async () => {
        await tick(80); expect(nativeEnsurePending()).toBe(false); // 前面的用例里没等的 30 ms 超时调用先落定
        const sw = mkSW();
        const p = ensureNativeAck("chrome://settings", "create", undefined, { search: POPUP, ackMs: 1000 })!;
        expect(nativeEnsurePending()).toBe(true); sw.ack(); await p; expect(nativeEnsurePending()).toBe(false);
        mkSW(); const q = ensureNativeAck("chrome://settings", "create", undefined, { search: POPUP, ackMs: 30 })!;
        expect(nativeEnsurePending()).toBe(true); await q; expect(nativeEnsurePending()).toBe(false); // 超时
        ensureNativeAck("https://a.com", "create", undefined, { search: POPUP }); expect(nativeEnsurePending()).toBe(false);
        g.chrome = { runtime: { sendMessage: () => Promise.reject(new Error("closed")) } };
        await ensureNativeAck("chrome://settings", "create", undefined, { search: POPUP, ackMs: 1000 }); expect(nativeEnsurePending()).toBe(false);
        g.chrome = { runtime: { sendMessage: () => { throw new Error("invalidated"); } } };
        await ensureNativeAck("chrome://settings", "create", undefined, { search: POPUP }); expect(nativeEnsurePending()).toBe(false);
    });
    test("noteEnsureNative / lastEnsureNativeAt", () => {
        noteEnsureNative(1234); expect(lastEnsureNativeAt()).toBe(1234);
        const t0 = Date.now(); noteEnsureNative(); expect(lastEnsureNativeAt()!).toBeGreaterThanOrEqual(t0);
    });
    test("目标窗口：弹窗的 sender.tab.windowId 是弹窗自己 → 优先用消息里的 ?win=；iframe / 内容脚本仍优先 sender.tab", () => {
        const popupUrl = "chrome-extension://abc/sidepanel.html" + POPUP, frameUrl = "chrome-extension://abc/sidepanel.html?host=inpage&win=7&tab=2";
        expect(senderIsInpagePopup(popupUrl)).toBe(true); expect(senderIsInpagePopup(frameUrl)).toBe(false);
        expect(senderIsInpagePopup("chrome-extension://abc/sidepanel.html?popup=commandBar&win=7")).toBe(false); // 没有 via：不是页内派生的
        expect(senderIsInpagePopup(undefined)).toBe(false); expect(senderIsInpagePopup("not a url")).toBe(false);
        expect(ensureTargetWindow(popupUrl, 99, 7)).toBe(7);
        expect(ensureTargetWindow(popupUrl, 99, undefined)).toBe(99);
        expect(ensureTargetWindow(frameUrl, 7, 8)).toBe(7);
        expect(ensureTargetWindow(undefined, 7, 8)).toBe(7);
        expect(ensureTargetWindow(frameUrl, undefined, 8)).toBe(8);
        expect(ensureTargetWindow(popupUrl, undefined, undefined)).toBeUndefined();
    });
    test("源码扫描：openCentered 用 popupBlurAction + 延后复查；sidepanel.ts 的 blur 用 pageBlurAction + nativeEnsurePending；插件 SW 记 noteEnsureNative 并用 ensureTargetWindow", () => {
        const r = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf8");
        const c = r("src/plugins/command/commandBar/index.ts");
        expect(c).toMatch(/popupBlurAction\(\{ focused: f, popupId: id, born, now: Date\.now\(\), ensureAt: lastEnsureNativeAt\(\) \}\)/);
        expect(c).toMatch(/act === "defer"[\s\S]*lastFocus !== id\) closeIt\(\)[\s\S]*ENSURE_BLUR_GRACE_MS/);
        const s = r("src/entries/sidepanel.ts");
        expect(s).toMatch(/pageBlurAction\(\{ hasFocus: document\.hasFocus\(\), pending: nativeEnsurePending\(\) \}\)/); expect(s).toMatch(/a === "wait"\) setTimeout\(checkBlur, 200\)/);
        expect(s).not.toMatch(/if \(!document\.hasFocus\(\)\) window\.close\(\)/);
        const b = r("src/plugins/inpageSidebar/background.ts");
        expect(b).toMatch(/noteEnsureNative\(\)/); expect((b.match(/ensureTargetWindow\(sender\.url, sender\.tab\?\.windowId, m\.windowId\)/g) ?? []).length).toBe(2);
        // （原来这里还锁 target 的 senderIsInpagePopup 判断：它只服务已移除的 enable-target 分支，一并移除）
    });
});

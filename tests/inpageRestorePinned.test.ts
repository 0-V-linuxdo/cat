/* 补丁 inpage-restore-pinned：Window 预热开的原生，被 ⌃S（toggle-sidebar / 图标）关掉后，页内要以常驻（pinned，推开页面）恢复，而不是只关（页内 show=false → 页面全宽，悬停 peek 出浮动卡片）。
 * 真机现象（rel53 53721，Cat）：Window 模式，页内关着时任意键（Cmd+R）预热开原生 → ⌃S 关原生 → 页内以「浮动圆角卡片」出现（-50 / -51）。
 * 根因：预热时页内本来就关着（hadIntent=false）→ 不打 restoreOnClose；⌃S 对「原生已开」只给 hide-visible（意图 false）→ show=false；卡片 = 开着「悬停浮出」且指针在左缘时的 peek（peek 从不推开页面）。
 * A) 纯函数 shouldPinInpageAfterToggle 判定表；B) 后台控制器（chrome mock，真 toggleFor / nativeChanged / 预热）端到端：预热 → ⌃S → 端口断开 → show:true；C) 宿主侧：show:true + push = 平贴推开（shouldPush），show:false 永远不推开。 */
import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import { resolve } from "node:path";

import { decideToggle, type Facts, parseDisplayMode, pushOffset, shouldPinInpageAfterToggle, shouldPush } from "../src/plugins/inpageSidebar/logic";

const DIR = resolve(import.meta.dir, "../src/plugins/inpageSidebar");

describe("B) 预热开的原生被 ⌃S 关掉后页内常驻恢复（后台控制器 chrome mock，真 toggleFor / nativeChanged / prewarm）", () => {
    const g = globalThis as Record<string, unknown>;
    const keep = { chrome: g.chrome, document: g.document };
    let realSettings: Record<string, unknown>;
    const prefs: Record<string, unknown> = { defaultMode: "inpage", showHandle: false, hoverReveal: false, prewarm: "off" };
    const L: Record<string, Function[]> = {}; const ev = (k: string) => ({ addListener: (f: Function) => { (L[k] ??= []).push(f); }, removeListener: (f: Function) => { L[k] = (L[k] ?? []).filter(x => x !== f); } });
    const calls: string[] = []; const urlOf: Record<number, { windowId: number; url: string; pendingUrl?: string }> = {};
    const chromeMock = {
        runtime: { onMessage: ev("msg"), onConnect: ev("conn"), lastError: undefined, id: "x", getManifest: () => ({ version: "0.0.0" }) }, commands: { onCommand: ev("cmd") },
        contextMenus: { onClicked: ev("menu"), create: (_p: unknown, cb?: () => void) => { cb?.(); }, remove: (_id: string, cb?: () => void) => cb?.(), update: (_i: string, _p: unknown, cb?: () => void) => cb?.() },
        sidePanel: { open: async (o: { windowId: number }) => { calls.push("open:" + o.windowId); }, close: async (o: { windowId: number }) => { calls.push("close:" + o.windowId); }, setOptions: async (o: unknown) => { calls.push("setOptions:" + JSON.stringify(o)); } },
        webNavigation: { onBeforeNavigate: ev("nav") },
        tabs: { update: async (id: number) => { calls.push(`update:${id}`); }, onActivated: ev("act"), onUpdated: ev("upd"), onRemoved: ev("rem"), query: async () => [], get: async (id: number) => ({ id, ...(urlOf[id] ?? { windowId: 8, url: "https://x.test/" }) }), sendMessage: async () => ({ ok: true, proto: 1 }) },
        windows: { onRemoved: ev("wrem"), onFocusChanged: ev("foc"), getAll: async () => [{ id: 8 }, { id: 9 }, { id: 10 }, { id: 11 }, { id: 12 }, { id: 13 }], getLastFocused: async () => ({ id: 8 }), WINDOW_ID_NONE: -1 },
        action: { setBadgeText: async () => undefined },
        storage: { local: { get: async () => ({ "data:inpageSidebar": { openByWin: {}, lastOpen: false } }) /* rel62-intent-persist：老用户「上次收起」——未知窗口继承 false（本文件测的不是继承） */, set: async () => undefined }, onChanged: ev("sc") },
    };
    let BG: any;
    // 核心 SidePanelGesture 的 installed 标志是模块级的（别的测试文件先装在它们自己的 chrome mock 上）→ 这里用可控的假 open 集合代替 isPanelOpen / closePanel / openPanelInGesture
    let routerFn: ((tab: { id?: number; windowId?: number; url?: string }) => string) | undefined; // 假 SPG 捕获后台装的 ⌃S 路由
    const openSet = new Set<number>(); let realSPG: Record<string, unknown>; const SPG_PATH = resolve(DIR, "../../api/SidePanelGesture.ts");
    beforeAll(async () => {
        realSettings = { ...(await import("../src/plugins/inpageSidebar/settings")) };
        realSPG = { ...(await import("../src/api/SidePanelGesture")) };
        mock.module(SPG_PATH, () => ({
            ...realSPG, setGestureRouter: (fn: typeof routerFn) => { routerFn = fn; }, isPanelOpen: (w: number) => openSet.has(w),
            closePanel: (w: number) => { openSet.delete(w); return chromeMock.sidePanel.close({ windowId: w }); },
            openPanelInGesture: (w: number, cb?: (ok: boolean) => void) => { void chromeMock.sidePanel.open({ windowId: w }).then(() => cb?.(true)); },
        }));
        delete g.document; g.chrome = chromeMock;
        mock.module(resolve(DIR, "settings.ts"), () => ({ settings: { store: prefs, def: {} } }));
        BG = await import(resolve(DIR, "background.ts") + "?restorepin");
        (globalThis as { rpCleanups?: unknown }).rpCleanups = BG.startBackground(); await wait();
    });
    afterAll(() => { for (const c of ((globalThis as { rpCleanups?: (() => void)[] }).rpCleanups ?? [])) { try { c(); } catch { /* 清理失败不影响其它文件 */ } } delete (globalThis as { rpCleanups?: unknown }).rpCleanups; mock.module(resolve(DIR, "settings.ts"), () => realSettings); mock.module(SPG_PATH, () => realSPG); mock.restore(); g.chrome = keep.chrome; if (keep.document !== undefined) g.document = keep.document; });
    afterEach(() => { prefs.defaultMode = "inpage"; });
    const wait = (ms = 8) => new Promise(r => setTimeout(r, ms));
    const mkPort = (name: string, sender: unknown) => {
        const m: Function[] = []; const d: Function[] = []; const sent: any[] = [];
        return {
            name, sender, sent, postMessage: (x: unknown) => { sent.push(x); }, disconnect() { for (const f of d) f(); },
            onMessage: { addListener: (f: Function) => m.push(f), removeListener: (f: Function) => { const i = m.indexOf(f); if (i >= 0) m.splice(i, 1); } },
            onDisconnect: { addListener: (f: Function) => d.push(f) }, say: (x: unknown) => { for (const f of m) f(x); },
        };
    };
    const host = (tabId: number, windowId: number, url: string) => { urlOf[tabId] = { windowId, url }; return mkPort("inpage:host", { tab: { id: tabId, windowId, url }, frameId: 0 }); };
    const hello = (p: ReturnType<typeof host>, frame = "none") => { p.say({ type: "hello", proto: 1, frame }); };
    const states = (p: { sent: any[] }) => p.sent.filter(s => s.type === "inpage:state"); const last = (p: { sent: any[] }) => states(p).at(-1);
    const conn = (p: { name: string; onDisconnect: { addListener: (f: Function) => void } }) => { // 后台的监听 + 代核心登记 / 注销 open 集合
        const m = /^panel:(\d+)$/.exec(p.name); if (m) { openSet.add(Number(m[1])); p.onDisconnect.addListener(() => openSet.delete(Number(m[1]))); }
        for (const f of L.conn!) f(p);
    };
    const NATIVE = "chrome-extension://x/sidepanel.html";
    const connectHost = async (tabId: number, w: number, url: string) => { const p = host(tabId, w, url); conn(p); hello(p); await wait(); return p; };
    const openNative = async (w: number) => { const p = mkPort(`panel:${w}`, { url: NATIVE }); conn(p); await wait(); return p; };
    /** 模拟 action.onClicked → 核心 onToggleGesture：有路由 → 路由；返回 native → 核心 togglePanelInGesture（开着关、关着开） */
    const icon = async (tab: { id?: number; windowId: number; url?: string }) => {
        const r = routerFn!(tab); if (r === "native") { if (openSet.has(tab.windowId)) { openSet.delete(tab.windowId); void chromeMock.sidePanel.close({ windowId: tab.windowId }); } else void chromeMock.sidePanel.open({ windowId: tab.windowId }); }
        await wait(); return r;
    };
    afterEach(() => { prefs.defaultMode = "inpage"; prefs.prewarm = "off"; });
    const msg = (m: object, sender: object) => { for (const f of L.msg ?? []) f(m, sender, () => undefined); };
    const W = "https://a.test/";
    /** 页面里的首次真实手势 → 后台预热（只在 prewarm=window 时开原生）；返回开出来的原生面板端口（模拟端口注册） */
    const warm = async (tabId: number, w: number) => {
        calls.length = 0; msg({ type: "inpage:prewarm", source: "host" }, { id: "x", tab: { id: tabId, windowId: w, url: W } }); await wait();
        expect(calls).toEqual([`open:${w}`]); return openNative(w);
    };
    const ctrlS = (tabId: number, w: number, url = W) => icon({ id: tabId, windowId: w, url }); // ⌃S = toggle-sidebar：与图标同一路由（SidePanelGesture.onToggleGesture）
    const close = async (panel: { disconnect: () => void }) => { panel.disconnect(); await wait(); };

    test("复现（真机 53721）：Window，页内关着 → 首击预热开原生 → ⌃S 关原生 → 端口断开后页内应常驻（show:true，displayMode push = 推开）", async () => {
        prefs.prewarm = "window"; const w = 100;
        const a = await connectHost(1001, w, W); L.act![0]!({ tabId: 1001, windowId: w });
        expect(last(a)).toMatchObject({ show: false }); // 页内本来就关着（用户之前 ⌃S 收起过）
        const panel = await warm(1001, w); expect(last(a)).toMatchObject({ show: false, nativeOpen: true });
        calls.length = 0; expect(await ctrlS(1001, w)).toBe("native"); expect(calls).toEqual([`close:${w}`]);
        await close(panel);
        expect(last(a)).toMatchObject({ show: true, nativeOpen: false, displayMode: "push" }); // 修前：show:false（页面全宽，悬停 peek 才出卡片）
    });
    test("同一场景：ctrl+S 之后用户再按 ⌃S → 正常 toggle 收起（pinned 之后的 toggle 不受影响）", async () => {
        prefs.prewarm = "window"; const w = 101;
        const a = await connectHost(1011, w, W); L.act![0]!({ tabId: 1011, windowId: w });
        const panel = await warm(1011, w); await ctrlS(1011, w); await close(panel); expect(last(a)).toMatchObject({ show: true });
        expect(await ctrlS(1011, w)).toBe("inpage"); expect(last(a)).toMatchObject({ show: false });
    });
    test("预热时页内是开着的（hadIntent=true）：既有 restoreOnClose 路径 → ⌃S 关原生后同样 show:true（回归，不变）", async () => {
        prefs.prewarm = "window"; const w = 102;
        const a = await connectHost(1021, w, W); L.act![0]!({ tabId: 1021, windowId: w }); await ctrlS(1021, w); expect(last(a)).toMatchObject({ show: true });
        const panel = await warm(1021, w); expect(last(a)).toMatchObject({ show: false, nativeOpen: true });
        await ctrlS(1021, w); await close(panel); expect(last(a)).toMatchObject({ show: true });
    });
    test("用户自己开的原生（没有预热标记，prewarm=off）：⌃S 仍只关，不凭空打开页内（action-click 既定语义不变）", async () => {
        prefs.prewarm = "off"; const w = 103;
        const a = await connectHost(1031, w, W); L.act![0]!({ tabId: 1031, windowId: w }); const panel = await openNative(w);
        calls.length = 0; expect(await ctrlS(1031, w)).toBe("native"); expect(calls).toEqual([`close:${w}`]); await close(panel);
        expect(last(a)).toMatchObject({ show: false, nativeOpen: false });
    });
    /** rel62-intent-persist：新窗口继承全局最近意图（lastOpen）——前面的用例开过页内 → 先在一次性窗口里收起一次，让「最近意图 = 收起」（这些用例测的是「页内本来关着」的老前提，不是继承） */
    let lcW = 9000; const lastClosed = async () => { const w = ++lcW, t = w * 10; const p = await connectHost(t, w, W); L.act![0]!({ tabId: t, windowId: w }); await wait(); if (last(p)?.show) await ctrlS(t, w); expect(last(p)).toMatchObject({ show: false }); };
    test("预热开的原生被用户点 × 关掉（不是 ⌃S）：页内本来关着 → 保持关（不变；只有 ⌃S 这个明确的「要 Cat」手势才恢复）", async () => {
        prefs.prewarm = "window"; const w = 104; await lastClosed();
        const a = await connectHost(1041, w, W); L.act![0]!({ tabId: 1041, windowId: w }); const panel = await warm(1041, w); await close(panel);
        expect(last(a)).toMatchObject({ show: false, nativeOpen: false });
    });
    test("默认方式 = native：⌃S 关预热开的原生后不恢复页内（用户要的是原生）", async () => {
        prefs.prewarm = "window"; const w = 105; await lastClosed();
        const a = await connectHost(1051, w, W); L.act![0]!({ tabId: 1051, windowId: w });
        const panel = await warm(1051, w); prefs.defaultMode = "native"; await ctrlS(1051, w); await close(panel);
        expect(last(a)).toMatchObject({ show: false });
    });
    test("宿主被页面拦截（frame-blocked，不可页内）：⌃S 只关原生，不置意图（不会出现「想看侧栏」的降级角标）", async () => {
        prefs.prewarm = "window"; const w = 106;
        const a = await connectHost(1061, w, W); L.act![0]!({ tabId: 1061, windowId: w }); const panel = await warm(1061, w);
        a.say({ type: "frame", state: "blocked" }); await wait(); await ctrlS(1061, w); await close(panel);
        expect(last(a)).toMatchObject({ show: false });
    });
    test("原生关闭后意图落盘为 true（pinned 偏好）：重复一轮「预热 → ⌃S」页内每次都常驻", async () => {
        prefs.prewarm = "window"; const w = 107;
        const a = await connectHost(1071, w, W); L.act![0]!({ tabId: 1071, windowId: w });
        for (let i = 0; i < 2; i++) {
            const panel = await warm(1071, w); await ctrlS(1071, w); await close(panel); expect(last(a)).toMatchObject({ show: true });
            await ctrlS(1071, w); expect(last(a)).toMatchObject({ show: false }); // 再收起，进入下一轮
        }
    });
});

describe("A) shouldPinInpageAfterToggle 判定表（纯函数）", () => {
    const f = (o: Partial<Facts> = {}): Facts => ({ nativeOpen: true, intent: false, defaultMode: "inpage", kind: "ok", hostAlive: true, frameBlocked: false, ...o });
    const run = (o: Partial<Facts>, marked = true, enabled = true) => { const x = f(o); return shouldPinInpageAfterToggle(decideToggle(x), x, marked, enabled); };
    test("原生开 + 预热标记 + 默认页内 + 可页内 + 开关开 → true", () => { expect(run({})).toBe(true); });
    test("缺任何一个条件 → false", () => {
        expect(run({}, false)).toBe(false); expect(run({}, true, false)).toBe(false);
        expect(run({ defaultMode: "native" })).toBe(false); expect(run({ kind: "restricted" as never })).toBe(false);
        expect(run({ hostAlive: false })).toBe(false); expect(run({ frameBlocked: true })).toBe(false);
    });
    test("不是「关原生」的决策（原生没开：页内 show / 页内 hide / 回落原生）→ false", () => {
        expect(run({ nativeOpen: false })).toBe(false); expect(run({ nativeOpen: false, intent: true })).toBe(false); expect(run({ nativeOpen: false, hostAlive: false })).toBe(false);
    });
});

describe("C) 宿主：pinned（show:true）+ push = 推开；show:false（含悬停 peek）永远不推开", () => {
    test("shouldPush：push + 常驻 + 非元素全屏 → true；peek（pinned=false）/ overlay / 全屏 → false", () => {
        expect(shouldPush({ mode: "push", pinned: true, fullscreen: false })).toBe(true);
        expect(shouldPush({ mode: "push", pinned: false, fullscreen: false })).toBe(false); // 悬停 peek：卡片，页面全宽（真机 -51）
        expect(shouldPush({ mode: "overlay", pinned: true, fullscreen: false })).toBe(false); expect(shouldPush({ mode: "push", pinned: true, fullscreen: true })).toBe(false);
    });
    test("缺省 / 未知 displayMode 回落 push（不是 floating）；pinned = 后台 show，没有别的存储键", () => {
        expect(parseDisplayMode(undefined)).toBe("push"); expect(parseDisplayMode("x")).toBe("push"); expect(parseDisplayMode("overlay")).toBe("overlay");
        expect(pushOffset(228)).toBeGreaterThan(0);
    });
});

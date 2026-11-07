/* 【只加测试，不改行为】B9（Cat 真机 rel53）：Window 预热开的原生，被「设置 Window → Off」关掉后，页内侧栏要不要恢复？静态结论 = 现行代码按设计行事，没有缺陷：
 *   (a) 预热时页内是关着的（用户先 ⌃S 收起过 → hadIntent=false → 不打 restoreOnClose）：Off 只关原生，页内保持收起（回到预热之前的状态）；之后用户按 ⌃S 能正常出页内（pinned）。
 *   (b) 预热时页内是开着的（hadIntent=true → restoreOnClose）：Off 关原生后 nativeChanged 恢复页内意图 → show:true；中途切到设置页标签（受限页）不会让原生被提前收起。
 * 这些用例在基线（r54 栈）上本来就通过——是把 B9 两条路径钉住的回归测试，不是「先失败后通过」的修复测试。
 * 与 inpageSidebar.test.ts ④（settingsChanged 单元用例）的区别：这里经过真实的 toggleFor / 路由 / 标签激活（onActivated → arriveCheck）/ ⌘R 重载握手，而不只是 prewarm → Off。 */
import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import { resolve } from "node:path";



const DIR = resolve(import.meta.dir, "../src/plugins/inpageSidebar");

describe("B9) 设置 Window→Off 关掉预热开的原生：页内是否恢复（后台控制器 chrome mock，真 toggleFor / nativeChanged / onActivated / refresh）", () => {
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
        BG = await import(resolve(DIR, "background.ts") + "?offrestore");
        (globalThis as { offCleanups?: unknown }).offCleanups = BG.startBackground(); await wait();
    });
    afterAll(() => { for (const c of ((globalThis as { offCleanups?: (() => void)[] }).offCleanups ?? [])) { try { c(); } catch { /* 清理失败不影响其它文件 */ } } delete (globalThis as { offCleanups?: unknown }).offCleanups; mock.module(resolve(DIR, "settings.ts"), () => realSettings); mock.module(SPG_PATH, () => realSPG); mock.restore(); g.chrome = keep.chrome; if (keep.document !== undefined) g.document = keep.document; });
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
    const settingsChanged = () => { BG.refreshBackground(); };
    const closes = (w: number) => calls.filter(c => c === "close:" + w);
    const SETTINGS = "chrome-extension://x/options.html"; // 设置页（扩展页，pageKind=scheme → 受限）
    const activate = (tabId: number, w: number) => { L.act![0]!({ tabId, windowId: w }); };
    /** ⌘R：旧文档卸载（端口断开）→ 新文档同一标签重新握手（hello）；返回新宿主端口 */
    const reload = async (old: ReturnType<typeof host>, tabId: number, w: number, url: string) => { old.disconnect(); await wait(); return connectHost(tabId, w, url); };

    test("b9a（Cat 真机复现路径）：页内先被 ⌃S 关掉 → ⌘R 预热开原生（重载握手后原生仍在、页内不出）→ 去设置页 → 切 Off：只关原生（close 一次），页内保持收起（无意图 = 不恢复，预热前的状态）；再按 ⌃S 页内正常出（pinned）", async () => {
        prefs.prewarm = "window"; const w = 120; const T = 1201, S = 1202; urlOf[S] = { windowId: w, url: SETTINGS };
        let a = await connectHost(T, w, W); activate(T, w);
        await ctrlS(T, w); expect(last(a)).toMatchObject({ show: true }); // 先开
        await ctrlS(T, w); expect(last(a)).toMatchObject({ show: false }); // 再 ⌃S 收起 = 页内关着（hadIntent=false 的前置）
        const panel = await warm(T, w); expect(last(a)).toMatchObject({ show: false, nativeOpen: true });
        a = await reload(a, T, w, W); // ⌘R 重载：新文档 hello；没有 restoreOnClose → 不会被 onArrive 收掉
        expect(last(a)).toMatchObject({ show: false, nativeOpen: true }); expect(openSet.has(w)).toBe(true);
        calls.length = 0; activate(S, w); await wait(); expect(closes(w)).toEqual([]); // 去设置页标签：受限页，原生不动
        prefs.prewarm = "off"; settingsChanged(); expect(closes(w)).toEqual([`close:${w}`]); // fix-off-close：关预热开的原生
        await close(panel);
        expect(last(a)).toMatchObject({ show: false, nativeOpen: false }); // 页内不出现：符合设计（无意图）
        activate(T, w); await wait(); expect(last(a)).toMatchObject({ show: false, nativeOpen: false }); // 回到 http 页标签：仍然不出
        expect(await ctrlS(T, w)).toBe("inpage"); expect(last(a)).toMatchObject({ show: true, nativeOpen: false }); // 用户想要侧栏：⌃S 正常出
    });
    /** rel62-intent-persist：新窗口继承全局最近意图（lastOpen）——前面的用例开过页内 → 先在一次性窗口里收起一次，让「最近意图 = 收起」（这些用例测的是「页内本来关着」的老前提，不是继承） */
    let lcW = 9000; const lastClosed = async () => { const w = ++lcW, t = w * 10; const p = await connectHost(t, w, W); L.act![0]!({ tabId: t, windowId: w }); await wait(); if (last(p)?.show) await ctrlS(t, w); expect(last(p)).toMatchObject({ show: false }); };
    test("b9b：页内开着 → 首击预热开原生（打 restoreOnClose）→ 去设置页（受限页，原生不被提前收起）→ 切 Off：关原生，端口断开后页内恢复（show:true，push）；回到 http 页仍是 show:true", async () => {
        prefs.prewarm = "window"; await lastClosed(); const w = 121; const T = 1211, S = 1212; urlOf[S] = { windowId: w, url: SETTINGS };
        const a = await connectHost(T, w, W); activate(T, w);
        await ctrlS(T, w); expect(last(a)).toMatchObject({ show: true }); // 页内开着
        const panel = await warm(T, w); expect(last(a)).toMatchObject({ show: false, nativeOpen: true });
        calls.length = 0; activate(S, w); await wait(); expect(closes(w)).toEqual([]); expect(openSet.has(w)).toBe(true); // arriveCheck：目的标签是受限页 → keep
        prefs.prewarm = "off"; settingsChanged(); expect(closes(w)).toEqual([`close:${w}`]);
        await close(panel);
        expect(last(a)).toMatchObject({ show: true, nativeOpen: false, displayMode: "push" }); // 恢复（宿主 hostAlive，非活动标签也带 show:true）
        activate(T, w); await wait(); expect(last(a)).toMatchObject({ show: true, active: true, nativeOpen: false });
        expect(await ctrlS(T, w)).toBe("inpage"); expect(last(a)).toMatchObject({ show: false }); // 之后 ⌃S 正常收起
    });
    test("b9b'：页内开着、没去别的标签，直接在当前窗口切 Off（设置在原生侧栏里改）：同样恢复；再改一次设置不重复 close", async () => {
        prefs.prewarm = "window"; const w = 122; const T = 1221;
        const a = await connectHost(T, w, W); activate(T, w); await ctrlS(T, w);
        const panel = await warm(T, w); calls.length = 0;
        prefs.prewarm = "off"; settingsChanged(); settingsChanged(); expect(closes(w)).toEqual([`close:${w}`]);
        await close(panel); expect(last(a)).toMatchObject({ show: true, nativeOpen: false });
    });
    test("b9c（⌘R + 页内开着，D：设计行为，非缺陷）：预热开原生后重载握手 → onArrive 由 SW 自己关原生并恢复页内；此后切 Off 没有原生可关（不再 close）", async () => {
        prefs.prewarm = "window"; await lastClosed(); const w = 123; const T = 1231;
        let a = await connectHost(T, w, W); activate(T, w); await ctrlS(T, w);
        const panel = await warm(T, w); expect(last(a)).toMatchObject({ show: false });
        a = await reload(a, T, w, W); await close(panel); // 新文档 hello → restoreOnClose.has && 活动标签 → SW closePanel → 面板端口断开 → 页内回来
        expect(last(a)).toMatchObject({ show: true, nativeOpen: false });
        calls.length = 0; prefs.prewarm = "off"; settingsChanged(); expect(closes(w)).toEqual([]);
    });
});

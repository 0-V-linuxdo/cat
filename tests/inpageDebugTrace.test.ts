/* 补丁 inpage-debug-trace：默认关的调试追踪（⌘R 重载中途「Cat 📌 ×」面板：原生还是页内壳？——真机上开了它，prewarm → openNativeForWindow → nativeChanged → pushWindow(show) → 页内 iframe → restoreOnClose 的先后与时间戳都在缓冲里）。
 * A) trace.ts 单元：关着零副作用（无记录 / 无全局函数 / 不写 storage.session / 不打控制台 / TracedSet 与 Set 行为一致）；开着有记录（编号 / 时间戳 / src）、环形缓冲上限、节流写 storage.session、全局标志与开关两种来源、sink / 补发、onTraceEnabled。
 * B) 后台控制器（chrome mock，真 prewarm / toggleFor / nativeChanged）：同一场景追踪关 / 开两次，宿主收到的状态序列和 sidePanel 调用逐条相同（追踪不改行为；开着时状态多一个 trace:true）；开着时事件按因果顺序齐全。
 * C) 源码接线：每个 trace( 调用点都有 traceOn() 守卫；要求覆盖的事件都在；trace.ts 无 window / document（SW）、只在 trace.ts 里打控制台。
 * ⚠ 内容脚本的 DOM 行为（iframe 建 / 毁 / 可见的真实时序）bun 里没有 DOM，只做 C) 的源码断言；真实时序见 README 的 headed 脚本（只写没跑）。 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { setTraceSink, setTraceSwitch, TRACE_FLUSH_MS, TRACE_FLAG, TRACE_KEY, TRACE_LOG_KEY, TRACE_MAX, TRACE_MSG, trace, traceConfigure, TracedSet, traceDump, traceFromHost, traceOn, traceReset, traceText, onTraceEnabled } from "../src/plugins/inpageSidebar/trace";

const DIR = resolve(import.meta.dir, "../src/plugins/inpageSidebar");
const wait0 = (ms: number) => new Promise(r => setTimeout(r, ms));
const g = globalThis as Record<string, unknown>;

describe("A) trace.ts：关着零副作用", () => {
    let dbg: ReturnType<typeof spyOn>; const sets: unknown[] = []; const keepChrome = g.chrome;
    beforeEach(() => { traceReset(); delete g[TRACE_FLAG]; sets.length = 0; g.chrome = { storage: { session: { set: async (o: unknown) => { sets.push(o); } } } }; dbg = spyOn(console, "debug").mockImplementation(() => undefined); });
    afterEach(() => { dbg.mockRestore(); traceReset(); delete g[TRACE_FLAG]; g.chrome = keepChrome; });
    test("默认关：traceOn() false；trace() 不记、不挂全局函数、不打控制台、不写 storage.session（等过节流时间也没有）", async () => {
        traceConfigure({ src: "sw", persist: true });
        expect(traceOn()).toBe(false);
        for (let i = 0; i < 50; i++) trace("x", { i });
        await wait0(TRACE_FLUSH_MS + 80);
        expect(traceDump()).toEqual([]); expect(sets).toEqual([]); expect(dbg).not.toHaveBeenCalled();
        expect(g.__arcInpageTraceDump).toBeUndefined(); expect(g.__arcInpageTraceText).toBeUndefined(); expect(g.__arcInpageTraceClear).toBeUndefined();
    });
    test("关着时 traceFromHost / setTraceSink 回调 / onTraceEnabled 回调都不执行、不记", () => {
        let sunk = 0, enabled = 0; setTraceSink(() => { sunk++; }); onTraceEnabled(() => { enabled++; });
        traceFromHost({ ev: "cs.start", t: Date.now() }, 3); trace("y");
        expect(sunk).toBe(0); expect(enabled).toBe(0); expect(traceDump()).toEqual([]);
    });
    test("TracedSet 关着时与 Set 行为一致（add 链式 / has / delete 返回值 / size / 迭代顺序 / clear），且不产生记录", () => {
        const a = new TracedSet("s"), b = new Set<number>();
        for (const s of [a, b]) { s.add(3).add(1).add(3); expect(s.size).toBe(2); expect([...s]).toEqual([3, 1]); expect(s.has(1)).toBe(true); expect(s.delete(1)).toBe(true); expect(s.delete(9)).toBe(false); s.add(5); s.clear(); expect(s.size).toBe(0); }
        expect(a instanceof Set).toBe(true); expect(traceDump()).toEqual([]);
    });
});

describe("A) trace.ts：开着有记录", () => {
    let dbg: ReturnType<typeof spyOn>; const sets: Record<string, unknown>[] = []; const keepChrome = g.chrome;
    beforeEach(() => { traceReset(); delete g[TRACE_FLAG]; sets.length = 0; g.chrome = { storage: { session: { set: async (o: Record<string, unknown>) => { sets.push(o); } } } }; dbg = spyOn(console, "debug").mockImplementation(() => undefined); });
    afterEach(() => { dbg.mockRestore(); traceReset(); delete g[TRACE_FLAG]; g.chrome = keepChrome; });
    test("setTraceSwitch(true)：记录带编号 n / 时间戳 t（Date.now）/ p（performance.now）/ src / ev / d；挂导出函数；打 [arc-trace]", () => {
        traceConfigure({ src: "sw" }); setTraceSwitch(true); const t0 = Date.now();
        trace("prewarm.msg", { tab: 7 }); trace("openNative.call");
        const r = traceDump(); expect(r.map(x => x.ev)).toEqual(["prewarm.msg", "openNative.call"]); expect(r.map(x => x.n)).toEqual([1, 2]);
        expect(r[0]).toMatchObject({ src: "sw", d: { tab: 7 } }); expect(r[0]!.t).toBeGreaterThanOrEqual(t0); expect(typeof r[0]!.p).toBe("number"); expect("d" in r[1]!).toBe(false);
        expect(typeof g.__arcInpageTraceDump).toBe("function"); expect((g.__arcInpageTraceDump as () => unknown[])().length).toBe(2);
        expect(dbg).toHaveBeenCalledTimes(2); expect(dbg.mock.calls[0]![0]).toBe("[arc-trace]");
        expect(g.__arcInpageTraceText as () => string).toBeTypeOf("function"); expect((g.__arcInpageTraceText as () => string)()).toMatch(/sw\s+prewarm\.msg \{"tab":7\}/);
        (g.__arcInpageTraceClear as () => void)(); expect(traceDump()).toEqual([]);
    });
    test("全局标志 globalThis.__arcInpageTrace = true 也能开（删掉即关）", () => {
        g[TRACE_FLAG] = true; expect(traceOn()).toBe(true); trace("a"); expect(traceDump().length).toBe(1);
        delete g[TRACE_FLAG]; expect(traceOn()).toBe(false); trace("b"); expect(traceDump().length).toBe(1);
        setTraceSwitch(true); g[TRACE_FLAG] = false; expect(traceOn()).toBe(true); // 两个来源是「或」
    });
    test("环形缓冲：最多 TRACE_MAX 条，丢最旧的；导出按时间排序", () => {
        setTraceSwitch(true); for (let i = 0; i < TRACE_MAX + 100; i++) trace("e", { i });
        const r = traceDump(); expect(r.length).toBe(TRACE_MAX); expect((r[0]!.d as { i: number }).i).toBe(100); expect((r.at(-1)!.d as { i: number }).i).toBe(TRACE_MAX + 99);
    });
    test("persist（SW）：节流写 chrome.storage.session[TRACE_LOG_KEY]（一批只写一次，内容 = 整个缓冲）", async () => {
        traceConfigure({ src: "sw", persist: true }); setTraceSwitch(true);
        trace("a"); trace("b"); trace("c"); expect(sets.length).toBe(0); await wait0(TRACE_FLUSH_MS + 80);
        expect(sets.length).toBe(1); expect(Object.keys(sets[0]!)).toEqual([TRACE_LOG_KEY]); expect((sets[0]![TRACE_LOG_KEY] as { ev: string }[]).map(x => x.ev)).toEqual(["a", "b", "c"]);
    });
    test("不 persist（内容脚本）时不写 storage.session", async () => {
        traceConfigure({ src: "cs", persist: false }); setTraceSwitch(true); trace("a"); await wait0(TRACE_FLUSH_MS + 80); expect(sets.length).toBe(0);
    });
    test("traceFromHost：并入 SW 缓冲，src = cs:<tabId>，保留内容脚本的时间戳；格式不对的丢弃", () => {
        setTraceSwitch(true); traceFromHost({ ev: "cs.iframe.create", t: 1000, p: 5, d: { win: 1 } }, 42); traceFromHost({ ev: 1 }, 42); traceFromHost(null, 42); traceFromHost({ ev: "x" }, 42);
        const r = traceDump(); expect(r.length).toBe(1); expect(r[0]).toMatchObject({ src: "cs:42", ev: "cs.iframe.create", t: 1000, d: { win: 1 } });
    });
    test("sink：每条都发给 sink；没有 sink 时先存着，装上 sink 后补发；sink 抛错不影响记录", () => {
        setTraceSwitch(true); trace("early1"); trace("early2"); const got: string[] = []; setTraceSink(r => { got.push(r.ev); });
        expect(got).toEqual(["early1", "early2"]); trace("late"); expect(got).toEqual(["early1", "early2", "late"]);
        setTraceSink(() => { throw new Error("port closed"); }); expect(() => trace("boom")).not.toThrow(); expect(traceDump().map(x => x.ev)).toEqual(["early1", "early2", "late", "boom"]);
    });
    test("onTraceEnabled：已开 = 立刻执行；之后才开 = 开后第一条记录时执行；只执行一次", () => {
        let n = 0; setTraceSwitch(true); trace("first"); onTraceEnabled(() => { n++; }); expect(n).toBe(1);
        traceReset(); n = 0; onTraceEnabled(() => { n++; }); expect(n).toBe(0); setTraceSwitch(true); expect(n).toBe(1); trace("a"); trace("b"); expect(n).toBe(1);
    });
    test("TracedSet 开着：add / delete / clear 进记录（重复 add 带 had:true；删不存在的不记）", () => {
        setTraceSwitch(true); const s = new TracedSet("restoreOnClose"); s.add(4); s.add(4); s.delete(4); s.delete(4); s.add(1); s.clear();
        expect(traceDump().map(x => [x.ev, x.d])).toEqual([["restoreOnClose.add", { w: 4, had: false }], ["restoreOnClose.add", { w: 4, had: true }], ["restoreOnClose.delete", { w: 4 }], ["restoreOnClose.add", { w: 1, had: false }], ["restoreOnClose.clear", { n: 1 }]]);
    });
    test("traceText：HH:MM:SS.mmm +Δms src ev {json}", () => {
        const t = traceText([{ n: 1, t: Date.UTC(2026, 9, 27, 3, 4, 5, 6), p: 1, src: "sw", ev: "a", d: { k: 1 } }, { n: 2, t: Date.UTC(2026, 9, 27, 3, 4, 5, 56), p: 2, src: "cs:1", ev: "b" }]);
        expect(t).toBe('03:04:05.006 +    0ms sw      a {"k":1}\n03:04:05.056 +   50ms cs:1    b');
    });
});

describe("B) 后台控制器：追踪不改行为；开着时事件按因果齐全", () => {
    let dbgB: ReturnType<typeof spyOn>; beforeEach(() => { dbgB = spyOn(console, "debug").mockImplementation(() => undefined); }); afterEach(() => dbgB.mockRestore());
    const g = globalThis as Record<string, unknown>;
    const keep = { chrome: g.chrome, document: g.document };
    let realSettings: Record<string, unknown>;
    const prefs: Record<string, unknown> = { defaultMode: "inpage", showHandle: false, hoverReveal: false, prewarm: "off" };
    const L: Record<string, Function[]> = {}; const ev = (k: string) => ({ addListener: (f: Function) => { (L[k] ??= []).push(f); }, removeListener: (f: Function) => { L[k] = (L[k] ?? []).filter(x => x !== f); } });
    const sessionSets: unknown[] = []; const calls: string[] = []; const urlOf: Record<number, { windowId: number; url: string; pendingUrl?: string }> = {};
    const chromeMock = {
        runtime: { onMessage: ev("msg"), onConnect: ev("conn"), lastError: undefined, id: "x", getManifest: () => ({ version: "0.0.0" }) }, commands: { onCommand: ev("cmd") },
        contextMenus: { onClicked: ev("menu"), create: (_p: unknown, cb?: () => void) => { cb?.(); }, remove: (_id: string, cb?: () => void) => cb?.(), update: (_i: string, _p: unknown, cb?: () => void) => cb?.() },
        sidePanel: { open: async (o: { windowId: number }) => { calls.push("open:" + o.windowId); }, close: async (o: { windowId: number }) => { calls.push("close:" + o.windowId); }, setOptions: async (o: unknown) => { calls.push("setOptions:" + JSON.stringify(o)); } },
        webNavigation: { onBeforeNavigate: ev("nav") },
        tabs: { update: async (id: number) => { calls.push(`update:${id}`); }, onActivated: ev("act"), onUpdated: ev("upd"), onRemoved: ev("rem"), query: async () => [], get: async (id: number) => ({ id, ...(urlOf[id] ?? { windowId: 8, url: "https://x.test/" }) }), sendMessage: async () => ({ ok: true, proto: 1 }) },
        windows: { onRemoved: ev("wrem"), onFocusChanged: ev("foc"), getAll: async () => [{ id: 8 }, { id: 9 }, { id: 10 }, { id: 11 }, { id: 12 }, { id: 13 }], getLastFocused: async () => ({ id: 8 }), WINDOW_ID_NONE: -1 },
        action: { setBadgeText: async () => undefined },
        storage: { local: { get: async () => ({ "data:inpageSidebar": { openByWin: {}, lastOpen: false } }) /* rel62-intent-persist：老用户「上次收起」——未知窗口继承 false（本文件测的不是继承） */, set: async () => undefined }, session: { set: async (o: unknown) => { sessionSets.push(o); } }, onChanged: ev("sc") },
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
        BG = await import(resolve(DIR, "background.ts") + "?dbgtrace");
        (globalThis as { dtCleanups?: unknown }).dtCleanups = BG.startBackground(); await wait();
    });
    afterAll(() => { for (const c of ((globalThis as { dtCleanups?: (() => void)[] }).dtCleanups ?? [])) { try { c(); } catch { /* 清理失败不影响其它文件 */ } } delete (globalThis as { dtCleanups?: unknown }).dtCleanups; mock.module(resolve(DIR, "settings.ts"), () => realSettings); mock.module(SPG_PATH, () => realSPG); mock.restore(); g.chrome = keep.chrome; if (keep.document !== undefined) g.document = keep.document; });
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
    afterEach(() => { traceReset(); delete g[TRACE_FLAG]; });
    /** 同一场景：Window 预热；页内先开着（hadIntent）→ 首击预热开原生 → ⌃S 关原生 → 端口断开恢复页内。返回宿主收到的状态序列（去掉窗口 / 标签 id 和 trace 字段）+ sidePanel 调用（w 归一） */
    const scenario = async (w: number, tabId: number) => {
        prefs.prewarm = "window"; calls.length = 0;
        const a = await connectHost(tabId, w, W); L.act![0]!({ tabId, windowId: w }); await ctrlS(tabId, w);
        const panel = await warm(tabId, w); await ctrlS(tabId, w); await close(panel);
        const norm = (s: Record<string, unknown>) => { const { windowId: _w, tabId: _t, trace: _tr, ...rest } = s; return rest; };
        return { states: states(a).map(norm), hasTraceField: states(a).some(s => "trace" in s), hostSent: a };
    };
    test("关着：宿主状态里没有 trace 字段、不写 storage.session、没有记录", async () => {
        sessionSets.length = 0; const r = await scenario(210, 2101); await wait();
        expect(r.hasTraceField).toBe(false); expect(sessionSets).toEqual([]); expect(traceDump()).toEqual([]); expect(g.__arcInpageTraceDump).toBeUndefined();
    });
    test("开 / 关两次跑同一场景：宿主收到的状态序列逐条相同（开着只多 trace:true），sidePanel 调用序列相同", async () => {
        const off = await scenario(220, 2201); const callsOff = calls.map(c => c.replace(/\d+/g, "N"));
        setTraceSwitch(true); const on = await scenario(221, 2211); const callsOn = calls.map(c => c.replace(/\d+/g, "N"));
        expect(on.states).toEqual(off.states); expect(callsOn).toEqual(callsOff); expect(on.hasTraceField).toBe(true);
        expect(states(on.hostSent).every(s => s.trace === true)).toBe(true);
    });
    /** rel62-intent-persist：新窗口继承全局最近意图（lastOpen）——前面的用例开过页内 → 先在一次性窗口里收起一次，让「最近意图 = 收起」（这些用例测的是「页内本来关着」的老前提，不是继承） */
    let lcW = 9000; const lastClosed = async () => { const w = ++lcW, t = w * 10; const p = await connectHost(t, w, W); L.act![0]!({ tabId: t, windowId: w }); await wait(); if (last(p)?.show) await ctrlS(t, w); expect(last(p)).toMatchObject({ show: false }); };
    test("开着：Window 预热链按因果顺序记下（prewarm.msg → prewarm.plan → openNative.call → pendingWin / prewarmOpened.add → openNative.result → restoreOnClose.add → intent → pushWindow → pushRec(show:false) → panelPort.connect → nativeChanged）", async () => {
        await lastClosed(); setTraceSwitch(true); prefs.prewarm = "window"; const w = 230, tab = 2301;
        const a = await connectHost(tab, w, W); L.act![0]!({ tabId: tab, windowId: w }); await ctrlS(tab, w); expect(last(a)).toMatchObject({ show: true });
        traceReset(); setTraceSwitch(true); traceConfigure({ src: "sw" });
        const panel = await warm(tab, w);
        const ev = traceDump().map(x => x.ev); const at = (e: string) => ev.indexOf(e);
        for (const e of ["prewarm.msg", "prewarm.plan", "openNative.call", "pendingWin.add", "prewarmOpened.add", "openNative.result", "restoreOnClose.add", "intent", "pushWindow", "pushRec", "panelPort.connect", "nativeChanged"]) expect(at(e), e).toBeGreaterThanOrEqual(0);
        expect(at("prewarm.msg")).toBeLessThan(at("prewarm.plan")); expect(at("prewarm.plan")).toBeLessThan(at("openNative.call")); expect(at("openNative.call")).toBeLessThan(at("openNative.result"));
        expect(at("openNative.result")).toBeLessThan(at("restoreOnClose.add")); expect(at("restoreOnClose.add")).toBeLessThan(at("intent")); expect(at("intent")).toBeLessThan(at("pushWindow")); expect(at("pushWindow")).toBeLessThan(at("pushRec"));
        expect(at("pushRec")).toBeLessThan(at("panelPort.connect")); expect(at("panelPort.connect")).toBeLessThan(at("nativeChanged"));
        const R = traceDump(); const plan = R.find(x => x.ev === "prewarm.plan")!; expect(plan.d).toMatchObject({ w, go: true, mode: "window", intent: true });
        expect(R.find(x => x.ev === "openNative.call")!.d).toMatchObject({ w, source: "prewarm", hadIntent: true });
        expect(R.find(x => x.ev === "intent")!.d).toEqual({ w, from: true, to: false, suppress: true }); // rel62-intent-persist：开原生而收起 = 落盘意图保留 + suppressed 标记
        expect(R.find(x => x.ev === "pushRec")!.d).toMatchObject({ tab, show: false, intent: false });
        await close(panel);
    });
    test("开着：restoreOnClose 触发（原生端口断开 → nativeChanged restoreFired:true → intent true → pushRec show:true）", async () => {
        await lastClosed(); setTraceSwitch(true); prefs.prewarm = "window"; const w = 231, tab = 2311;
        const a = await connectHost(tab, w, W); L.act![0]!({ tabId: tab, windowId: w }); await ctrlS(tab, w);
        const panel = await warm(tab, w); traceReset(); setTraceSwitch(true); traceConfigure({ src: "sw" });
        await close(panel);
        const R = traceDump(); const nc = R.filter(x => x.ev === "nativeChanged").at(-1)!;
        expect(nc.d).toMatchObject({ w, open: false, panelAlive: false, intentBefore: false, intentAfter: true, restoreMarkedBefore: true, restoreFired: true });
        expect(R.some(x => x.ev === "restoreOnClose.delete")).toBe(true); expect(R.filter(x => x.ev === "pushRec").at(-1)!.d).toMatchObject({ tab, show: true, nativeOpen: false });
        expect(last(a)).toMatchObject({ show: true });
    });
    test("重载时序（真实代码路径，追踪记下）：⌘R 时页内开着 → 预热开原生（restoreOnClose 打标）→ 新文档 hello 到达 → 旧意图的 onArrive 回落：SW 自己 close 原生 → 端口断开 → 页内恢复 = 「页内 → 原生闪一下 → 页内」", async () => {
        await lastClosed(); setTraceSwitch(true); prefs.prewarm = "window"; const w = 232, tab = 2321;
        const a = await connectHost(tab, w, W); L.act![0]!({ tabId: tab, windowId: w }); await ctrlS(tab, w); expect(last(a)).toMatchObject({ show: true }); // 页内开着
        const panel = await warm(tab, w); expect(last(a)).toMatchObject({ show: false, nativeOpen: true }); // ⌘R 的 keydown 预热：原生开、页内让位
        traceReset(); setTraceSwitch(true); traceConfigure({ src: "sw" }); calls.length = 0;
        a.disconnect(); await wait(); const b = host(tab, w, W); conn(b); hello(b); await wait(); // 重载：旧文档卸载，新文档 hello
        const R = traceDump(); const ev = R.map(x => x.ev); const at = (e: string) => ev.indexOf(e);
        expect(at("host.disconnect")).toBeGreaterThanOrEqual(0); expect(at("host.disconnect")).toBeLessThan(at("host.hello"));
        expect(R.find(x => x.ev === "host.hello")!.d).toMatchObject({ tab, nativeOpen: true, intent: false }); // 新文档握手时原生正开着、意图是 false
        expect(R.find(x => x.ev === "restoreOnClose.add")!.d).toEqual({ w, had: true }); // evalSidebarSwitch 的 to-inpage 分支
        expect(calls).toEqual([`close:${w}`]); // hello 里 SW 把原生关了（switch-auto onArrive）
        expect(last(b)).toMatchObject({ show: true, nativeOpen: false, instant: true, trace: true }); // 补丁 pinned-first-frame：close 一发就把「已展开」推下去（补丁前：show:false，要等原生端口断开 ≈350 ms 才恢复 = 全宽空窗）；真正的意图仍等端口断开后恢复
        await close(panel); // 原生面板文档销毁 → 端口断开 → nativeChanged 恢复意图
        const nc = traceDump().filter(x => x.ev === "nativeChanged").at(-1)!; expect(nc.d).toMatchObject({ restoreFired: true, intentAfter: true });
        expect(last(b)).toMatchObject({ show: true, nativeOpen: false });
    });
    test("重载时序：⌘R 时页内是关着的（hadIntent=false，无 restoreOnClose）→ 新文档 hello 后原生仍开着，SW 不 close、页内不出现（pushRec nativeOpen:true show:false）", async () => {
        await lastClosed(); setTraceSwitch(true); prefs.prewarm = "window"; const w = 234, tab = 2341;
        const a = await connectHost(tab, w, W); L.act![0]!({ tabId: tab, windowId: w }); expect(last(a)).toMatchObject({ show: false });
        const panel = await warm(tab, w); traceReset(); setTraceSwitch(true); traceConfigure({ src: "sw" }); calls.length = 0;
        a.disconnect(); await wait(); const b = host(tab, w, W); conn(b); hello(b); await wait();
        expect(traceDump().some(x => x.ev === "restoreOnClose.add")).toBe(false); expect(calls).toEqual([]); expect(last(b)).toMatchObject({ show: false, nativeOpen: true });
        await close(panel);
    });
    test("开着：内容脚本经端口转来的记录并入 SW 缓冲（src = cs:<tabId>）；storage.onChanged 打开开关后状态带 trace:true、关掉后没有", async () => {
        const w = 233, tab = 2331; const a = await connectHost(tab, w, W); L.act![0]!({ tabId: tab, windowId: w });
        expect(traceOn()).toBe(false); for (const f of L.sc ?? []) f({ [TRACE_KEY]: { newValue: true } }, "local"); await wait(); expect(traceOn()).toBe(true); expect(last(a)).toMatchObject({ trace: true });
        a.say({ type: TRACE_MSG, rec: { ev: "cs.iframe.create", t: Date.now(), p: 1, d: { win: w } } }); await wait();
        expect(traceDump().find(x => x.ev === "cs.iframe.create")).toMatchObject({ src: `cs:${tab}`, d: { win: w } });
        for (const f of L.sc ?? []) f({ [TRACE_KEY]: { newValue: false } }, "local"); await wait(); expect(traceOn()).toBe(false); expect("trace" in last(a)).toBe(false);
    });
});

describe("C) 源码接线", () => {
    const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    const bg = readFileSync(resolve(DIR, "background.ts"), "utf8"), ct = readFileSync(resolve(DIR, "content.ts"), "utf8"), tr = readFileSync(resolve(DIR, "trace.ts"), "utf8");
    const calls = (src: string) => strip(src).split("\n").filter(l => /(^|[^.\w])trace\(/.test(l) && !/function trace\(/.test(l));
    test("background.ts / content.ts 里每一行 trace( 调用都在 traceOn() 守卫内（同一行 `traceOn() &&` / `if (traceOn())` / `if (t0)`；trace.on 在 trace.ts 的 startTraceSwitch 里）", () => {
        for (const [name, src] of [["background", bg], ["content", ct]] as const) for (const l of calls(src)) expect(/traceOn\(\)|if \(t0\)|trace\("trace\.on"/.test(l), `${name}: ${l.trim().slice(0, 120)}`).toBe(true);
        expect(calls(bg).length).toBeGreaterThan(12); expect(calls(ct).length).toBeGreaterThan(12);
    });
    test("要求覆盖的事件都在（后台）", () => {
        for (const e of ["prewarm.msg", "prewarm.plan", "openNative.call", "openNative.result", "nativeChanged", "pushWindow", "pushRec", "intent", "toggle", "host.hello", "host.disconnect", "host.msg", "panelPort.connect", "panelPort.disconnect", "tab.updated"]) expect(bg, e).toContain(`"${e}"`);
        expect(bg).toContain('new TracedSet("pendingWin")'); expect(bg).toContain("const restoreOnClose = new RestoreOnClose("); expect(bg).toContain("onOp: (op, info) => { if (traceOn()) trace(`restoreOnClose.${op}`, info); }"); // 补丁 inpage-restoreonclose-persist：restoreOnClose 换成带持久化的 RestoreOnClose，追踪经 onOp 接入（事件名不变）
        expect(bg).toContain("const prewarmOpened = new PrewarmOpened("); expect(bg).toContain("onOp: (op, info) => { if (traceOn()) trace(`prewarmOpened.${op}`, info); }"); // 补丁 inpage-prewarmopened-persist：prewarmOpened 换成带持久化的 PrewarmOpened，追踪经 onOp 接入（仍进 debug-trace）
    });
    test("要求覆盖的事件都在（内容脚本：iframe 建 / 毁 / 就绪 / 可见、hint、手势、端口、卸载）", () => {
        for (const e of ["cs.start", "cs.iframe.create", "cs.iframe.destroy", "cs.iframe.ready", "cs.iframe.park", "cs.iframe.unpark", "cs.iframe.handshakeTimeout", "cs.hostVisible", "cs.state", "cs.hint.apply", "cs.hint.persist", "cs.gesture", "cs.port.connect", "cs.port.disconnect", "cs.pageshow", "cs.visibility", "cs.pagehide", "cs.beforeunload", "cs.teardown"]) expect(ct, e).toContain(`"${e}"`);
    });
    test("只在开着时才挂的东西：pagehide / beforeunload 监听放在 onTraceEnabled 回调里；storage 开关只在 SW（content 不读 storage）；状态里的 trace 字段只在 traceOn() 时展开", () => {
        const c = strip(ct); expect(c).toMatch(/onTraceEnabled\(\(\) => \{[\s\S]*?addEventListener\("pagehide"[\s\S]*?\}\);/); expect(c).not.toMatch(/TRACE_KEY|storage\.local\.get\(TRACE/);
        expect(strip(bg)).toMatch(/\.\.\.\(traceOn\(\) \? \{ trace: true as const \} : \{\}\)/);
    });
    test("手势记录不泄漏输入内容：keydown 的键名只在带修饰键（快捷键）时记", () => {
        expect(ct).toMatch(/key: e\.type === "keydown" && \(k\.metaKey \|\| k\.ctrlKey \|\| k\.altKey\) \? k\.key : undefined/);
    });
    test("trace.ts：无 window / document（SW 里没有）；只在 trace.ts 里打控制台；background / content 里没有新增控制台调用", () => {
        const t = strip(tr); expect(t).not.toMatch(/\b(window|document)\./); expect(t).toMatch(/console\.debug\("\[arc-trace\]"/);
        expect(strip(bg)).not.toMatch(/console\./); expect(strip(ct).match(/console\.\w+/g)).toEqual(["console.warn", "console.warn", "console.warn"]);
    });
    test("默认关的三个常量：键 debug:inpageTrace、标志 __arcInpageTrace、日志键 debug:inpageTrace:log", () => {
        expect(TRACE_KEY).toBe("debug:inpageTrace"); expect(TRACE_FLAG).toBe("__arcInpageTrace"); expect(TRACE_LOG_KEY).toBe("debug:inpageTrace:log");
    });
});

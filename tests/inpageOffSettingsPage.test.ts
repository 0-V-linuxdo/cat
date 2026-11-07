/* 第 19 层（inpage-settings-copy-fix）里随附的「设置页 Off」特征测试（characterization，**不改行为**）：
 * 真机验收 53889：warm-up 改 Off 时，① 原生面板是工具栏图标在受限页（about:blank → 设置页）上开的 → 没关；② 原生面板是页内预热（首次手势，打了 prewarmOpened 标记）开的、
 * 之后带到设置页 → 立即关。结论（静态）：差别在「有没有预热标记」，与 SW 冷 / 热、与「当前页是设置页」无关；标记是按窗口记的，不看当前活动页。
 * 这里用真实 background.ts + chrome mock 把四件事锁住：A) 图标开的原生（无标记）Off 不关（热 / 冷唤醒各一）；B) 预热开的、带到设置页：热 → 关一次，冷唤醒 → ":r" 重连后关一次（第 14 层对设置页成立）；
 * C) 已知边界（⚠ 记录而非认可）：预热那个标签关了 → 标记随标签清掉 → 之后 Off 不关。这些测试在 18b 基线上也通过（它们描述既有行为），所以 fail-first 对它们不适用。 */
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { resolve } from "node:path";

import * as C from "../src/plugins/inpageSidebar/constants";

const DIR = resolve(import.meta.dir, "../src/plugins/inpageSidebar");
const KEY = "inpageRestoreOnClose"; const PKEY = "inpagePrewarmOpened";
void C;

describe("B) 后台控制器：SW 被 Off 写入唤醒（启动即 Off）→ 面板 \":r\" 重连 → 关原生 → 页内恢复（chrome mock）", () => {
    const g = globalThis as Record<string, unknown>;
    const keep = { chrome: g.chrome, document: g.document, now: Date.now };
    let realSettings: Record<string, unknown>; let realSPG: Record<string, unknown>;
    const prefs: Record<string, unknown> = { defaultMode: "inpage", showHandle: false, hoverReveal: false, prewarm: "window" };
    const L: Record<string, Function[]> = {}; const ev = (k: string) => ({ addListener: (f: Function) => { (L[k] ??= []).push(f); }, removeListener: (f: Function) => { L[k] = (L[k] ?? []).filter(x => x !== f); } });
    const calls: string[] = []; const urlOf: Record<number, { windowId: number; url: string }> = {}; const deadWin = new Set<number>();
    const sess: Record<string, unknown> = {}; let sessionOn = true; let sessGate: Promise<void> | undefined; let skew = 0; let sessSetErr = false;
    const chromeMock: Record<string, any> = {
        runtime: { onMessage: ev("msg"), onConnect: ev("conn"), lastError: undefined, id: "x", getManifest: () => ({ version: "0.0.0" }) }, commands: { onCommand: ev("cmd") },
        contextMenus: { onClicked: ev("menu"), create: (_p: unknown, cb?: () => void) => { cb?.(); }, remove: (_id: string, cb?: () => void) => cb?.(), update: (_i: string, _p: unknown, cb?: () => void) => cb?.() },
        sidePanel: { open: async (o: { windowId: number }) => { calls.push("open:" + o.windowId); }, close: async (o: { windowId: number }) => { calls.push("close:" + o.windowId); }, setOptions: async () => undefined },
        webNavigation: { onBeforeNavigate: ev("nav") },
        tabs: { update: async () => undefined, onActivated: ev("act"), onUpdated: ev("upd"), onRemoved: ev("rem"), query: async () => [], get: async (id: number) => { if (!urlOf[id]) throw new Error("No tab"); return { id, ...urlOf[id] }; }, sendMessage: async () => ({ ok: true, proto: 1 }) },
        windows: { onRemoved: ev("wrem"), onFocusChanged: ev("foc"), getAll: async () => Array.from({ length: 500 }, (_, i) => ({ id: i })), get: async (id: number) => { if (deadWin.has(id)) throw new Error("No window"); return { id }; }, getLastFocused: async () => ({ id: 8 }), WINDOW_ID_NONE: -1 },
        action: { setBadgeText: async () => undefined },
        storage: { local: { get: async () => ({ "data:inpageSidebar": { openByWin: {}, lastOpen: false } }) /* rel62-intent-persist：老用户「上次收起」——未知窗口继承 false（本文件测的不是继承） */, set: async () => undefined }, onChanged: ev("sc") },
    };
    const installSession = () => { if (sessionOn) chromeMock.storage.session = { get: async (k: string) => { if (sessGate) await sessGate; return { [k]: JSON.parse(JSON.stringify(sess[k] ?? null)) ?? undefined }; }, set: async (o: Record<string, unknown>) => { if (sessSetErr) throw new Error("quota"); Object.assign(sess, JSON.parse(JSON.stringify(o))); } }; else delete chromeMock.storage.session; };
    let BG: any; let routerFn: ((tab: { id?: number; windowId?: number; url?: string }) => string) | undefined; const openSet = new Set<number>();
    let coldReopen: { t: number; windowId: number; tabId: number | undefined } | undefined; const SPG_PATH = resolve(DIR, "../../api/SidePanelGesture.ts");
    let cleanup: unknown;
    const runCleanup = () => { for (const c of ([] as unknown[]).concat(cleanup ?? [])) { try { (c as () => void)(); } catch { /* */ } } cleanup = undefined; };
    beforeAll(async () => {
        realSettings = { ...(await import("../src/plugins/inpageSidebar/settings")) }; realSPG = { ...(await import("../src/api/SidePanelGesture")) };
        mock.module(SPG_PATH, () => ({
            ...realSPG, setGestureRouter: (fn: typeof routerFn) => { routerFn = fn; }, isPanelOpen: (w: number) => openSet.has(w), takeColdGesture: () => undefined,
            takeColdReopenClose: (w: number) => { const c = coldReopen; if (c && c.windowId === w) { coldReopen = undefined; return c; } return undefined; },
            closePanel: (w: number) => { openSet.delete(w); return chromeMock.sidePanel.close({ windowId: w }); },
            openPanelInGesture: (w: number, cb?: (ok: boolean) => void) => { void chromeMock.sidePanel.open({ windowId: w }).then(() => cb?.(true)); },
        }));
        delete g.document; g.chrome = chromeMock; Date.now = () => keep.now() + skew;
        mock.module(resolve(DIR, "settings.ts"), () => ({ settings: { store: prefs, def: {} } }));
        BG = await import(resolve(DIR, "background.ts") + "?offsettingspage");
    });
    afterAll(() => { runCleanup(); Date.now = keep.now; mock.module(resolve(DIR, "settings.ts"), () => realSettings); mock.module(SPG_PATH, () => realSPG); mock.restore(); g.chrome = keep.chrome; if (keep.document !== undefined) g.document = keep.document; });
    const wait = (ms = 8) => new Promise(r => setTimeout(r, ms));
    /** 「SW 回收后重启」：清监听、清内存里的开面板集合；session 数据保留 */
    /** 真 SW 回收 = 进程被杀，cleanup 不会跑；测试里为了摘监听要跑 cleanup（它会 clear 标记并写回 {}）→ 先存快照、cleanup 后还原，等价「杀进程」 */
    const kill = async () => { const snap = JSON.parse(JSON.stringify(sess)); runCleanup(); for (const p of livePanels.splice(0)) p.disconnect(); /* 核心的 panelPorts 是模块级的：真回收时随进程清空 */ await wait(); for (const k of Object.keys(sess)) delete sess[k]; Object.assign(sess, snap); };
    const boot = async (o: { reset?: boolean } = {}) => {
        if (o.reset) runCleanup(); else await kill(); calls.length = 0; openSet.clear(); routerFn = undefined; coldReopen = undefined; sessGate = undefined; sessSetErr = false;
        if (o.reset) for (const k of Object.keys(sess)) delete sess[k];
        if (o.reset) for (const f of L.sc ?? []) f({ "data:inpageSidebar": { newValue: { openByWin: {}, lastOpen: false } } }, "local"); // rel62-intent-persist：全新启动 = storage.local 也回到「老用户、上次收起」（测试里 data:inpageSidebar 只活在模块级 store 缓存里，跨用例会带着 lastOpen / suppressedByWin）
        installSession(); cleanup = BG.startBackground(); await wait();
    };
    const mkPort = (name: string, sender: unknown) => { const m: Function[] = []; const d: Function[] = []; const sent: any[] = []; return { name, sender, sent, postMessage: (x: unknown) => { sent.push(x); }, disconnect() { for (const f of d) f(); }, onMessage: { addListener: (f: Function) => m.push(f), removeListener: (f: Function) => { const i = m.indexOf(f); if (i >= 0) m.splice(i, 1); } }, onDisconnect: { addListener: (f: Function) => d.push(f) }, say: (x: unknown) => { for (const f of m) f(x); } }; };
    const W = "https://a.test/"; const NATIVE = "chrome-extension://x/sidepanel.html";
    const conn = (p: { name: string; onDisconnect: { addListener: (f: Function) => void } }) => { const m = /^panel:(\d+)$/.exec(p.name); if (m) { openSet.add(Number(m[1])); p.onDisconnect.addListener(() => openSet.delete(Number(m[1]))); } for (const f of L.conn!) f(p); };
    const connectHost = async (tabId: number, w: number, url = W) => { urlOf[tabId] = { windowId: w, url }; const p = mkPort("inpage:host", { tab: { id: tabId, windowId: w, url }, frameId: 0 }); conn(p); p.say({ type: "hello", proto: 1, frame: "none" }); await wait(); return p; };
    const livePanels: Array<{ disconnect: () => void }> = [];
    const openNative = async (w: number) => { const p = mkPort(`panel:${w}`, { url: NATIVE }); livePanels.push(p); conn(p); await wait(); return p; };
    const states = (p: { sent: any[] }) => p.sent.filter(s => s.type === "inpage:state"); const last = (p: { sent: any[] }) => states(p).at(-1);
    const msg = (m: object, sender: object) => { for (const f of L.msg ?? []) f(m, sender, () => undefined); };

    const sr = (w: number) => (sess[KEY] as Record<string, any> | undefined)?.[w];
    const closes = (w: number) => calls.filter(c => c === "close:" + w);
    const off = () => { prefs.prewarm = "off"; BG.refreshBackground(); };
    /** 实例 1：页内先开着（⌃S）→ 首次手势预热开原生（页内收起、打 restoreOnClose）；返回 {a, panel} */
    const warmInpage = async (tabId: number, w: number) => {
        prefs.prewarm = "window"; await boot({ reset: true }); const a = await connectHost(tabId, w); L.act![0]!({ tabId, windowId: w }); await wait();
        expect(routerFn!({ id: tabId, windowId: w, url: W })).toBe("inpage"); await wait(); expect(last(a)).toMatchObject({ show: true }); // 页内开着
        msg({ type: "inpage:prewarm", source: "host" }, { id: "x", tab: { id: tabId, windowId: w, url: W } }); await wait(); const panel = await openNative(w); await wait();
        expect(last(a)).toMatchObject({ show: false, nativeOpen: true }); return { a, panel };
    };

    /** 面板页重连（_core/sidebar：连上过 > 1 s 的面板页在 SW 重启后带 ":r" 重连）；name 可改成不带 ":r" 的新开面板 */
    const reconnect = async (w: number, name = `panel:${w}:r`) => { const p = mkPort(name, { url: NATIVE }); livePanels.push(p); openSet.add(w); p.onDisconnect.addListener(() => openSet.delete(w)); for (const f of L.conn!) f(p); await wait(); return p; };
    const sp = (w: number) => (sess[PKEY] as Record<string, any> | undefined)?.[w];
    /** 页内本来关着：开 → 关（用户 ⌃S 关掉）→ 预热开原生（没有 restoreOnClose 标记，但有 prewarmOpened） */
    const warmHidden = async (tabId: number, w: number) => {
        prefs.prewarm = "window"; await boot({ reset: true }); const a = await connectHost(tabId, w); L.act![0]!({ tabId, windowId: w }); await wait();
        routerFn!({ id: tabId, windowId: w, url: W }); await wait(); routerFn!({ id: tabId, windowId: w, url: W }); await wait(); expect(last(a)).toMatchObject({ show: false });
        msg({ type: "inpage:prewarm", source: "host" }, { id: "x", tab: { id: tabId, windowId: w, url: W } }); await wait(); const panel = await openNative(w); await wait(); return { a, panel };
    };
    /** SW 被 Off 写入唤醒：杀 SW（session 保留）→ 设置已是 off（启动读到的就是 Off，没有 refresh 调用）→ 启动 → 宿主握手 + 激活 */
    const wakeWithOff = async (tabId: number, w: number, o: { gate?: Promise<void>; mode?: string } = {}) => {
        await kill(); prefs.prewarm = o.mode ?? "off"; calls.length = 0; openSet.clear(); routerFn = undefined; coldReopen = undefined; sessSetErr = false; installSession(); sessGate = o.gate; cleanup = BG.startBackground(); await wait();
        const a = await connectHost(tabId, w); L.act![0]!({ tabId, windowId: w }); await wait(); return a;
    };
    const gate = () => { let go!: () => void; const p = new Promise<void>(r => { go = r; }); return { p, go }; };
    const SET = "chrome-extension://x/options.html";
    /** 设置页 = 受限页：没有内容脚本、没有宿主端口；只有 tabs 记录 */
    const goSettings = async (tabId: number, w: number) => { urlOf[tabId] = { windowId: w, url: SET }; L.act![0]!({ tabId, windowId: w }); await wait(); };
    /** 工具栏图标在设置页上开原生（SidePanelGesture 路由 → toggleFor viaRouter → 核心 open；这里用 openNative 模拟端口出现）。无预热标记 */
    const iconOpenOnSettings = async (tabId: number, w: number) => {
        prefs.prewarm = "window"; await boot({ reset: true }); await goSettings(tabId, w);
        expect(routerFn!({ id: tabId, windowId: w, url: SET })).toBe("native"); const panel = await openNative(w); await wait(); return panel;
    };

    test("A1 热：图标在设置页开的原生（无预热标记）→ warm-up 改 Off → 不关（planOffClose marked=false → keep）；标记集合始终为空", async () => {
        await iconOpenOnSettings(5001, 800); expect(sp(800)).toBeUndefined(); calls.length = 0; off(); await wait(30); expect(closes(800)).toEqual([]); expect(openSet.has(800)).toBe(true);
    });
    test("A2 冷：同上，但 SW 回收、被 Off 写入唤醒（启动即 Off）→ 面板 \":r\" 重连 → 仍不关（没有恢复来的标记，closeWokenOff 首行返回）", async () => {
        await iconOpenOnSettings(5002, 801); await kill(); prefs.prewarm = "off"; calls.length = 0; openSet.clear(); routerFn = undefined; installSession(); cleanup = BG.startBackground(); await wait();
        await goSettings(5002, 801); await reconnect(801); await wait(40); expect(closes(801)).toEqual([]); expect(sp(801)).toBeUndefined(); expect(sr(801)).toBeUndefined();
    });
    test("B1 热：页内预热（标记）开的原生，用户切到设置页（原生带过去）→ Off → 立即 close 一次（= 验收 B9a 的「立即关」）；页内由 restoreOnClose 在原生断开后恢复", async () => {
        const { a, panel } = await warmInpage(5101, 802); await goSettings(5102, 802); expect(sp(802)).toBeDefined(); calls.length = 0; off(); await wait(30);
        expect(closes(802)).toEqual(["close:802"]); panel.disconnect(); await wait(); expect(last(a)).toMatchObject({ show: true, nativeOpen: false });
    });
    test("B2 冷：同 B1，但 SW 回收后被 Off 写入唤醒、活动页是设置页 → 面板 \":r\" 重连 → close 一次（第 14 层对「设置页 + 无页内宿主」成立：标记按窗口、校验的是记录里那个标签还在不在，不看活动页）", async () => {
        await warmInpage(5103, 803); await goSettings(5104, 803); await kill(); prefs.prewarm = "off"; calls.length = 0; openSet.clear(); routerFn = undefined; installSession(); cleanup = BG.startBackground(); await wait();
        L.act![0]!({ tabId: 5104, windowId: 803 }); await wait(); expect(closes(803)).toEqual([]); // 面板还没回来：先不动
        await reconnect(803); await wait(30); expect(closes(803)).toEqual(["close:803"]);
    });
    test("C 已知边界（⚠ 记录，未改）：预热那个标签被关掉 → prewarmOpened.removeTab 清标记 → 原生仍在设置页 → 之后 Off 不关（热路径）", async () => {
        await warmInpage(5105, 804); await goSettings(5106, 804); for (const f of L.rem ?? []) f(5105); await wait(); expect(sp(804)).toBeUndefined();
        calls.length = 0; off(); await wait(30); expect(closes(804)).toEqual([]); expect(PKEY).toBe("inpagePrewarmOpened"); expect(KEY).toBe("inpageRestoreOnClose");
    });
    void warmHidden; void wakeWithOff; void gate; // 复用自 inpageOffWakeClose 的辅助，这里没用到（noUnusedLocals）
});

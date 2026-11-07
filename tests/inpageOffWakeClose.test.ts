/* 补丁 inpage-off-wake-close（rel55 第 14 层）：SW 被「设置写入」本身唤醒、读到的设置已经是 Off 时，预热开的原生面板关不掉（槽位 3：COLD_GAP_MS=20 / 100 → LOST，原生一直 1）。
 * 根因（静态）：没有任何「变化」事件能触发 refresh → closePrewarmedIfOff——① initSettings 读完存储才挂 storage.onChanged 监听，且把读到的值当「现状」，之后到的同值事件比对不出变化；
 *   ② InpageSidebar 的 start() 不对账「预热方式 = off 且有持久化的预热标记」。修法：启动对账 closeWokenOff（只处理存储恢复来的预热标记；等该窗口的面板页用 ":r" 重连端口回来再 close 一次）。
 * A) 根因对照（真 Settings.ts + chrome mock）；B) 后台控制器（chrome mock，真 toggleFor / nativeChanged / refresh；「SW 回收」= 清监听后重新 startBackground，session 数据保留）；C) 源码约束。无 Chrome。
 * 新行为一律经行为断言读取，这样在没有本补丁的 13 层源码上各条测试各自失败（fail-first 记录），而不是整个文件因导入失败。 */
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import * as C from "../src/plugins/inpageSidebar/constants";

const DIR = resolve(import.meta.dir, "../src/plugins/inpageSidebar");
const RC = C.RESTORE_ON_CLOSE;
const KEY = "inpageRestoreOnClose"; const PKEY = "inpagePrewarmOpened";

describe("A) 根因对照：冷 SW 读到的设置已经是 Off，之后没有「变化」可触发 refresh（真 Settings.ts）", () => {
    const g = globalThis as Record<string, unknown>;
    const mkChrome = (stored: unknown, getGate?: Promise<void>) => {
        const lst: Function[] = []; let listenersAtGet = -1;
        const chromeLike = { storage: { local: { get: async () => { listenersAtGet = lst.length; if (getGate) await getGate; return { ArcSidebarSettings: stored }; }, set: async () => undefined }, onChanged: { addListener: (f: Function) => { lst.push(f); } } } };
        return { chromeLike, lst, listenersAtGet: () => listenersAtGet };
    };
    const withChrome = async (c: unknown, fn: () => Promise<void>) => { const keep = g.chrome; g.chrome = c; try { await fn(); } finally { g.chrome = keep; } };
    const impSettings = async (q: string) => (await import(resolve(DIR, "../../api/Settings.ts") + "?" + q)) as typeof import("../src/api/Settings");
    const OFF = { plugins: { InpageSidebar: { enabled: true, prewarm: "off" } } }; const WIN = { plugins: { InpageSidebar: { enabled: true, prewarm: "window" } } };

    test("storage.onChanged 监听在 `await storage.local.get` 之后才注册（读之前 0 个；读完才 1 个）", async () => {
        let go!: () => void; const gate = new Promise<void>(r => { go = r; }); const m = mkChrome(OFF, gate);
        await withChrome(m.chromeLike, async () => {
            const S = await impSettings("offwake-a1"); const p = S.initSettings(); await new Promise(r => setTimeout(r, 5));
            expect([m.listenersAtGet(), m.lst.length]).toEqual([0, 0]); go(); await p; expect(m.lst).toHaveLength(1);
        });
    });
    test("冷 SW：存储里已是 Off → 之后到的「写 Off」那条 storage.onChanged（同值）不产生 externalHooks 回调 = 没有 refresh（本补丁要补的缺口）", async () => {
        const m = mkChrome(OFF);
        await withChrome(m.chromeLike, async () => {
            const S = await impSettings("offwake-a2"); await S.initSettings(); const hits: string[][] = []; S.onExternalSettingsChange(c => hits.push([...c]));
            for (const f of m.lst) f({ ArcSidebarSettings: { newValue: OFF } }, "local"); expect(hits).toEqual([]); expect(S.PlainSettings.plugins.InpageSidebar?.prewarm).toBe("off");
        });
    });
    test("对照：热 SW（设置先加载成 window）→ 同一条写 Off 的事件**会**产生回调（既有行为，refresh 由此而来）", async () => {
        const m = mkChrome(WIN);
        await withChrome(m.chromeLike, async () => {
            const S = await impSettings("offwake-a3"); await S.initSettings(); const hits: string[][] = []; S.onExternalSettingsChange(c => hits.push([...c]));
            for (const f of m.lst) f({ ArcSidebarSettings: { newValue: OFF } }, "local"); expect(hits).toEqual([["InpageSidebar"]]);
        });
    });
});

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
        BG = await import(resolve(DIR, "background.ts") + "?offwake");
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

    test("复现 + 修复（槽位 3 gap=20/100 的 LOST）：预热开原生 → SW 回收 → 被 Off 写入唤醒（启动即 Off，无 refresh）→ 面板 \":r\" 重连 → 只 close 一次；断开后页内恢复；两份标记撤掉", async () => {
        await warmInpage(3501, 600); const a = await wakeWithOff(3501, 600); expect(closes(600)).toEqual([]); // 面板还没回来：先不动
        const panel = await reconnect(600); expect(closes(600)).toEqual(["close:600"]);
        panel.disconnect(); await wait(); expect(last(a)).toMatchObject({ show: true, nativeOpen: false, displayMode: "push" }); expect(sr(600)).toBeUndefined(); expect(sp(600)).toBeUndefined();
    });
    test("加载竞态：面板 \":r\" 重连在两份标记加载完成**之前**到 → 先不关；加载完（ready）→ 补做 → close 一次；之后页内恢复", async () => {
        await warmInpage(3502, 601); const g1 = gate(); const a = await wakeWithOff(3502, 601, { gate: g1.p }); const panel = await reconnect(601); expect(closes(601)).toEqual([]);
        g1.go(); await wait(40); expect(closes(601)).toEqual(["close:601"]); panel.disconnect(); await wait(); expect(last(a)).toMatchObject({ show: true, nativeOpen: false });
    });
    test("面板重连晚于加载完成：ready 那次对账不 close、也**不清标记**（不是 \"clear\"）；\":r\" 端口一到才 close（朴素「启动补做一次 closePrewarmedIfOff」会在这里清掉标记 → 永远关不掉）", async () => {
        await warmInpage(3503, 602); const a = await wakeWithOff(3503, 602); await wait(40); expect(closes(602)).toEqual([]); expect(sp(602)).toBeDefined(); expect(sr(602)).toBeDefined(); // 标记还在（等重连）
        const panel = await reconnect(602); expect(closes(602)).toEqual(["close:602"]); panel.disconnect(); await wait(); expect(last(a)).toMatchObject({ show: true });
    });
    test("反例（页内本来收起）：回收后被 Off 唤醒 → 关掉预热开的原生，但页内**不会**被弹出（没有 restoreOnClose 标记）", async () => {
        await warmHidden(3504, 603); expect(sr(603)).toBeUndefined(); expect(sp(603)).toBeDefined(); const a = await wakeWithOff(3504, 603); const panel = await reconnect(603); expect(closes(603)).toEqual(["close:603"]);
        panel.disconnect(); await wait(); expect(last(a)).toMatchObject({ show: false, nativeOpen: false });
    });
    test("护栏 1：重连端口不带 \":r\"（回收期间用户关掉预热面板、之后自己新开的原生）→ 不当成预热面板，不关", async () => {
        await warmInpage(3505, 604); await wakeWithOff(3505, 604); const panel = await reconnect(604, "panel:604"); await wait(); expect(closes(604)).toEqual([]); expect(openSet.has(604)).toBe(true); void panel;
    });
    test("护栏 2：预热方式不是 off（SW 被别的原因唤醒）→ 面板 \":r\" 重连也不关；标记保留", async () => {
        await warmInpage(3506, 605); await wakeWithOff(3506, 605, { mode: "window" }); await reconnect(605); await wait(); expect(closes(605)).toEqual([]); expect(sp(605)).toBeDefined();
    });
    test("护栏 3：标记过期（> 10 分钟）/ tab 不在该窗口 / 窗口已关 → 标记没恢复 → 不关（宁可不关，也不关用户自己的原生）", async () => {
        await warmInpage(3507, 606); delete sess[KEY]; try { skew = RC.ttlMs + 1000; await wakeWithOff(3507, 606); await reconnect(606); await wait(); expect(closes(606)).toEqual([]); } finally { skew = 0; }
        for (const [name, mutate] of [["标签换窗口", (t: number) => { urlOf[t] = { windowId: 999, url: W }; }], ["窗口已关", (_t: number, w: number) => { deadWin.add(w); }]] as const) {
            const t = 3600 + Math.floor(Math.random() * 300), w = 700 + Math.floor(Math.random() * 90); await warmInpage(t, w); delete sess[KEY]; mutate(t, w);
            await kill(); prefs.prewarm = "off"; calls.length = 0; openSet.clear(); installSession(); cleanup = BG.startBackground(); await wait(); await reconnect(w); await wait(); expect([name, closes(w)]).toEqual([name, []]); deadWin.delete(w);
        }
    });
    test("幂等：重复 \":r\" 端口 / nativeChanged / 随后的 refresh（设置变化）/ 并发触发 → close 只发一次", async () => {
        await warmInpage(3508, 607); await wakeWithOff(3508, 607); const p1 = await reconnect(607); expect(closes(607)).toHaveLength(1);
        const p2 = await reconnect(607); BG.refreshBackground(); off(); await wait(); expect(closes(607)).toHaveLength(1); void p1; void p2;
    });
    test("热路径不变：同一生命里 Off → 关一次 → 页内恢复；之后同窗口面板掉线又 \":r\" 重连（没有恢复来的标记）不再关、不抛", async () => {
        const { a, panel } = await warmInpage(3509, 608); calls.length = 0; off(); await wait(); expect(closes(608)).toEqual(["close:608"]);
        panel.disconnect(); await wait(); expect(last(a)).toMatchObject({ show: true, nativeOpen: false }); await reconnect(608); await wait(); expect(closes(608)).toHaveLength(1);
    });
    test("对照（SW 已被面板重连先唤醒、再写 Off = gap=500 的 PASS 路径）：标记已加载 → refresh 的 closePrewarmedIfOff 关一次；页内恢复；唤醒对账不重复关", async () => {
        await warmInpage(3510, 609); await wakeWithOff(3510, 609, { mode: "window" }); const panel = await reconnect(609); await wait(); expect(closes(609)).toEqual([]);
        off(); await wait(); expect(closes(609)).toEqual(["close:609"]); panel.disconnect(); await wait(); expect(closes(609)).toHaveLength(1);
    });
    test("sweep：面板始终没重连 → 标记在 sweepMs 后作废；之后任何端口都不再被误关，页内也不弹", async () => {
        const realST = globalThis.setTimeout; (globalThis as any).setTimeout = (fn: Function, ms?: number, ...r: unknown[]) => realST(fn as () => void, ms === RC.sweepMs ? 20 : ms, ...r);
        try {
            await warmInpage(3511, 610); const a = await wakeWithOff(3511, 610); await wait(80); expect(sp(610)).toBeUndefined(); expect(sr(610)).toBeUndefined();
            const panel = await reconnect(610); await wait(); expect(closes(610)).toEqual([]); panel.disconnect(); await wait(); expect(last(a)).toMatchObject({ show: false });
        } finally { (globalThis as any).setTimeout = realST; }
    });
    test("回退：storage.session 不可用 → 没有恢复来的标记 → 唤醒对账什么都不做，不抛错（同一生命里的 Off 仍走 closePrewarmedIfOff）", async () => {
        sessionOn = false;
        try {
            await warmInpage(3512, 611); await wakeWithOff(3512, 611); await reconnect(611); await wait(); expect(closes(611)).toEqual([]);
            const w2 = await warmInpage(3513, 612); calls.length = 0; off(); await wait(); expect(closes(612)).toEqual(["close:612"]); void w2;
        } finally { sessionOn = true; }
    });
    test("护栏 4（与第 13 层一致）：唤醒后重连握手 / 切到另一个普通页不会把原生关掉（预热方式 window 时）；对账只在 off 才动", async () => {
        await warmInpage(3514, 613); await wakeWithOff(3514, 613, { mode: "window" }); await reconnect(613); await connectHost(3614, 613, "https://b.test/"); L.act![0]!({ tabId: 3614, windowId: 613 }); await wait(30); expect(calls.filter(c => c.startsWith("close"))).toEqual([]);
    });
});

describe("C) 源码约束", () => {
    const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    const bg = readFileSync(resolve(DIR, "background.ts"), "utf8"); const code = strip(bg);
    test("\":r\" 重连端口在顶层 onConnect 里同步登记（在任何 await 之前、ctl 还没起来也登记）；断开时撤", () => {
        const m = /chrome\.runtime\?\.onConnect\?\.addListener\(port => \{[\s\S]*?\n    \}\);\n\}/.exec(code)!; expect(m).toBeTruthy(); expect(m[0]).toMatch(/if \(m\[2\]\) reconnectedPanels\.add\(w\);/); expect(m[0]).not.toMatch(/\bawait\b/); expect(m[0]).toMatch(/if \(m\[2\] && !set\.size\) reconnectedPanels\.delete\(w\)/);
    });
    test("closeWokenOff：热路径第一行就返回（restored 为空）；只在 off + 面板 \":r\" 重连 + planOffClose = close 才关；先删标记再 close；两份标记 ready 后触发一次，nativeChanged 入口每次触发", () => {
        const f = /const closeWokenOff = \(\) => \{[\s\S]*?\n    \};/.exec(code)![0];
        expect(f).toMatch(/^const closeWokenOff = \(\) => \{\s*if \(!prewarmOpened\.restored\.size\) return;/); expect(f).toMatch(/mode !== "off"/); expect(f).toMatch(/!reconnectedPanels\.has\(w\) \|\| !panelAlive\(w\)/);
        expect(f).toMatch(/planOffClose\(\{ mode, marked: true, nativeShowing: true, pending: pendingWin\.has\(w\) \}\) !== "close"/); expect(f.indexOf("prewarmOpened.delete(w)")).toBeLessThan(f.indexOf("closePanel(w)"));
        expect(code).toMatch(/void Promise\.all\(\[prewarmOpened\.ready, restoreOnClose\.ready\]\)\.then\(closeWokenOff\);/); expect(code).toMatch(/nativeChanged: w => \{ closeWokenOff\(\); nativeChanged\(w\); \},/);
    });
    test("既有路径未动：closePrewarmedIfOff 仍先等两份 ready；refresh 仍是 closePrewarmedIfOff + pushAll；不新增常量 / 定时器", () => {
        expect(code).toMatch(/refresh: \(\) => \{ closePrewarmedIfOff\(\); pushAll\(\); \}/); expect(code).toMatch(/if \(!prewarmOpened\.loaded \|\| !restoreOnClose\.loaded\) \{ void Promise\.all\(\[prewarmOpened\.ready, restoreOnClose\.ready\]\)\.then\(closePrewarmedIfOff\); return; \}/);
        const f = /const closeWokenOff = \(\) => \{[\s\S]*?\n    \};/.exec(code)![0]; expect(f).not.toMatch(/setTimeout|later\(|\b\d{3,}\b/);
    });
});

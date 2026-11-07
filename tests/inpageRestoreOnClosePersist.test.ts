/* 补丁 inpage-restoreonclose-persist：restoreOnClose（「为进受限页 / 窗口级预开而收起了页内的窗口：原生关了要恢复」）持久化到 chrome.storage.session。
 * 动机（b9b COLD=1 实测）：SW 回收后设置改 Off → 原生 532 ms 内关掉，但页内不恢复（restoreOnClose 在内存里、SW 回收时丢了）。热 SW 同场景 PINNED。
 * A) RestoreOnClose 类 = 第 10 层 PrewarmOpened 的存取层（子类，另一个键）：写镜像 / 过期 / tabId·windowId 不匹配 / 加载竞态 / 清除 / 回退 / retab；
 * B) 后台控制器（chrome mock，真 toggleFor / nativeChanged / refresh；「SW 回收」= 清监听后重新 startBackground，session 数据保留）：冷 SW 里 Off → 关原生 → 页内恢复；副作用护栏；热路径不变；
 * C) 源码 / 常量约束。无 Chrome。
 * 注意：新符号一律经 `import * as` 读取，这样在没有本补丁的源码上各条测试各自失败（fail-first 记录），而不是整个文件因导入失败。 */
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import * as C from "../src/plugins/inpageSidebar/constants";
import * as PO from "../src/plugins/inpageSidebar/prewarmOpened";

const DIR = resolve(import.meta.dir, "../src/plugins/inpageSidebar");
const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));
const RC = (C as any).RESTORE_ON_CLOSE as { key: string; ttlMs: number; loadTimeoutMs: number; sweepMs: number };
const KEY = "inpageRestoreOnClose"; const PKEY = "inpagePrewarmOpened";
const RestoreOnClose = (PO as any).RestoreOnClose as typeof PO.PrewarmOpened;

describe("A) RestoreOnClose 类（第 10 层存取层复用）", () => {
    const mkArea = (init: Record<string, unknown> = {}, o: { getDelay?: Promise<void>; getErr?: boolean; setErr?: boolean } = {}) => {
        const data: Record<string, unknown> = { ...init }; const sets: Record<string, unknown>[] = [];
        return { data, sets, area: {
            get: async (k: string) => { if (o.getErr) throw new Error("no session"); if (o.getDelay) await o.getDelay; return { [k]: data[k] }; },
            set: async (it: Record<string, unknown>) => { if (o.setErr) throw new Error("quota"); sets.push(JSON.parse(JSON.stringify(it))); Object.assign(data, it); },
        } };
    };
    const mk = (over: Partial<PO.PrewarmOpenedDeps> & { now?: number; tabs?: Record<number, number>; wins?: number[] } = {}) => {
        const clock = { t: over.now ?? 1_000_000 }; const tabs = over.tabs ?? { 11: 5 }; const wins = over.wins ?? [5];
        const deps: PO.PrewarmOpenedDeps = { now: () => clock.t, area: undefined, tabOf: w => (w === 5 ? 11 : undefined), getTab: async id => (id in tabs ? { windowId: tabs[id] } : Promise.reject(new Error("No tab"))), hasWindow: async w => wins.includes(w), key: RC?.key, ttlMs: RC?.ttlMs, loadTimeoutMs: RC?.loadTimeoutMs, ...over };
        return { clock, deps, mk: () => new RestoreOnClose(deps) };
    };
    const rec = (w = 5, tabId = 11, t = 1_000_000) => ({ [KEY]: { [w]: { tabId, windowId: w, t } } });

    test("常量集中在 constants.ts（key / 10 分钟 / 加载超时 / sweep）；类复用第 10 层的 PrewarmOpened（不另造存取层）；键与 prewarmOpened 不同", () => {
        expect(RC).toEqual({ key: KEY, ttlMs: 600_000, loadTimeoutMs: 1_500, sweepMs: 7_000 });
        expect(RC.key).not.toBe(C.PREWARM_OPENED.key); expect(typeof RestoreOnClose).toBe("function");
        expect(Object.getPrototypeOf(RestoreOnClose)).toBe(PO.PrewarmOpened);
    });
    test("写镜像：记 { tabId（打标时窗口的激活标签）, windowId, t }；只写自己的键；delete / clear 同步撤；tabOf 取不到 = 只记内存", async () => {
        const m = mkArea({ [PKEY]: { 9: "keep" } }); const s = mk({ area: m.area }).mk(); await s.ready;
        s.add(5); await tick(); expect(s.has(5)).toBe(true); expect(m.data[KEY]).toEqual({ 5: { tabId: 11, windowId: 5, t: 1_000_000 } }); expect(m.data[PKEY]).toEqual({ 9: "keep" });
        s.add(6); await tick(); expect(s.has(6)).toBe(true); expect(Object.keys(m.data[KEY] as object)).toEqual(["5"]);
        s.delete(5); await tick(); expect(m.data[KEY]).toEqual({}); s.add(5); await tick(); s.clear(); await tick(); expect(s.size).toBe(0); expect(m.data[KEY]).toEqual({});
    });
    test("读取：有效记录恢复（has、restored）；加载完成前 loaded = false 且 has = false（= 旧行为：没有标记）", async () => {
        const m = mkArea(rec()); const s = mk({ area: m.area }).mk(); expect(s.loaded).toBe(false); expect(s.has(5)).toBe(false);
        await s.ready; expect(s.loaded).toBe(true); expect(s.has(5)).toBe(true); expect(s.restored.has(5)).toBe(true); expect(s.tabIdOf(5)).toBe(11);
    });
    test("过期：超过 10 分钟 / 时间在未来（> 60 s）→ 丢弃并从存储删掉；寿命内保留", async () => {
        for (const [age, keep] of [[RC.ttlMs - 1, true], [RC.ttlMs + 1, false], [-120_000, false]] as const) {
            const m = mkArea(rec(5, 11, 1_000_000 - age)); const s = mk({ area: m.area }).mk(); await s.ready; await tick();
            expect([age, s.has(5)]).toEqual([age, keep]); if (!keep) expect(m.data[KEY]).toEqual({});
        }
    });
    test("tabId / windowId 不匹配：标签在别的窗口 / 标签没了 / 窗口没了 / 键与 windowId 不一致 / 字段缺失 / 不是对象 → 丢弃；对照有效 = 保留", async () => {
        const cases: Array<[string, Record<string, unknown>, { tabs?: Record<number, number>; wins?: number[] }]> = [
            ["标签换窗口", rec(), { tabs: { 11: 9 } }], ["标签没了", rec(), { tabs: {} }], ["窗口没了", rec(), { wins: [] }],
            ["键不一致", { [KEY]: { 5: { tabId: 11, windowId: 6, t: 1_000_000 } } }, {}], ["字段缺失", { [KEY]: { 5: { windowId: 5, t: 1_000_000 } } }, {}], ["不是对象", { [KEY]: "x" }, {}],
        ];
        for (const [name, init, o] of cases) { const m = mkArea(init); const s = mk({ area: m.area, ...o }).mk(); await s.ready; expect([name, s.has(5)]).toEqual([name, false]); }
        const m = mkArea(rec()); const s = mk({ area: m.area }).mk(); await s.ready; expect(s.has(5)).toBe(true);
    });
    test("加载竞态：加载期间内存里已 add / delete 的窗口以内存为准（存储里的旧记录不覆盖、不复活）", async () => {
        let go!: () => void; const gate = new Promise<void>(r => { go = r; });
        const m = mkArea({ [KEY]: { 5: { tabId: 11, windowId: 5, t: 1_000_000 }, 7: { tabId: 12, windowId: 7, t: 1_000_000 } } }, { getDelay: gate });
        const s = mk({ area: m.area, tabs: { 11: 5, 12: 7 }, wins: [5, 7] }).mk(); expect(s.loaded).toBe(false); s.delete(5); go(); await s.ready; expect(s.has(5)).toBe(false); expect(s.has(7)).toBe(true);
    });
    test("加载超时：storage.session 卡住 → ready 在 loadTimeoutMs 后 resolve，按「没有标记」处理", async () => {
        const never = new Promise<void>(() => undefined); const m = mkArea(rec(), { getDelay: never });
        const s = mk({ area: m.area, loadTimeoutMs: 30 }).mk(); const t0 = Date.now(); await s.ready; expect(Date.now() - t0).toBeGreaterThanOrEqual(25); expect(s.loaded).toBe(true); expect(s.has(5)).toBe(false);
    });
    test("retab：记录的 tabId 跟随激活标签并落盘、不动 t、没有记录 = 不动、同值不写；标签关了的那个窗口：不 retab 则重载后被校验丢弃，retab 了则保留", async () => {
        const m = mkArea(); const c = mk({ area: m.area, tabs: { 11: 5, 12: 5 } }); const s = c.mk(); await s.ready; s.add(5); await tick(); const n0 = m.sets.length;
        c.clock.t += 5_000; s.retab(5, 11); await tick(); expect(m.sets.length).toBe(n0); // 同值：不写
        s.retab(6, 12); await tick(); expect(m.sets.length).toBe(n0); // 没有记录：不动
        s.retab(5, 12); await tick(); expect(m.data[KEY]).toEqual({ 5: { tabId: 12, windowId: 5, t: 1_000_000 } }); expect(s.tabIdOf(5)).toBe(12); expect(s.has(5)).toBe(true);
        // 11 关了：存储里 tabId=12（仍在）→ 重载有效
        const alive = mk({ area: m.area, tabs: { 12: 5 } }).mk(); await alive.ready; expect(alive.has(5)).toBe(true);
        const stale = mk({ area: mkArea(rec(5, 11)).area, tabs: { 12: 5 } }).mk(); await stale.ready; expect(stale.has(5)).toBe(false); // 对照：没 retab（记录指向已关的 11）→ 丢
    });
    test("清除：delete（原生关闭消费后 / 窗口关闭）撤记录；removeTab 不在子类用法里调用（见 C）", async () => {
        const m = mkArea(); const s = mk({ area: m.area }).mk(); await s.ready; s.add(5); await tick(); expect(m.data[KEY]).toEqual({ 5: { tabId: 11, windowId: 5, t: 1_000_000 } });
        expect(s.delete(5)).toBe(true); await tick(); expect(m.data[KEY]).toEqual({}); expect(s.delete(5)).toBe(false);
    });
    test("回退：没有 storage.session → 立即 loaded、纯内存；get 抛错 / set 拒绝 → 不抛错、内存照常、不再写", async () => {
        const a = mk({ area: undefined }).mk(); expect(a.loaded).toBe(true); await a.ready; a.add(5); expect(a.has(5)).toBe(true); a.retab(5, 3); a.delete(5); expect(a.has(5)).toBe(false);
        const g = mkArea({}, { getErr: true }); const b = mk({ area: g.area }).mk(); await b.ready; expect(b.loaded).toBe(true); b.add(5); expect(b.has(5)).toBe(true);
        const s = mkArea({}, { setErr: true }); const c = mk({ area: s.area }).mk(); await c.ready; c.add(5); await tick(); c.add(6); c.retab(5, 9); await tick(); expect(c.has(5) && c.has(6)).toBe(true); expect(s.sets).toHaveLength(0);
    });
    test("onOp 钩子：add 带 had、delete 只在真删了时回调、clear 只在非空时回调（debug-trace 事件名 restoreOnClose.* 由此而来）", () => {
        const ops: unknown[] = []; const s = mk({ onOp: (op, info) => ops.push([op, info]) }).mk(); s.add(5); s.add(5); s.delete(5); s.delete(5); s.add(1); s.clear(); s.clear();
        expect(ops).toEqual([["add", { w: 5, had: false }], ["add", { w: 5, had: true }], ["delete", { w: 5 }], ["add", { w: 1, had: false }], ["clear", { n: 1 }]]);
    });
});

describe("B) 后台控制器：冷 SW 里 Off → 关原生 → 页内恢复（chrome mock，真 toggleFor / nativeChanged / refresh）", () => {
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
        BG = await import(resolve(DIR, "background.ts") + "?rcpersist");
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
    /** SW 回收后：重新握手、激活、面板页重连；返回 {a, panel} */
    const afterRecycle = async (tabId: number, w: number) => { await boot(); const a = await connectHost(tabId, w); L.act![0]!({ tabId, windowId: w }); const panel = await openNative(w); await wait(); return { a, panel }; };

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

    test("打标时 session 里记下 { tabId, windowId, t }（键 inpageRestoreOnClose；prewarmOpened 的键也在）", async () => {
        await warmInpage(3001, 400); await wait(); expect(sr(400)).toMatchObject({ tabId: 3001, windowId: 400 }); expect(typeof sr(400).t).toBe("number"); expect((sess[PKEY] as any)?.[400]).toBeDefined();
    });
    test("复现（b9b COLD=1 的缺口）：SW 回收后设置改 Off → 只关原生一次，端口断开后页内恢复（show:true、push）；标记随消费从存储撤掉", async () => {
        const { panel: p0 } = await warmInpage(3002, 401); void p0; const { a, panel } = await afterRecycle(3002, 401);
        expect(last(a)).toMatchObject({ show: false, nativeOpen: true }); calls.length = 0; off(); await wait(); expect(closes(401)).toEqual(["close:401"]);
        panel.disconnect(); await wait(); expect(last(a)).toMatchObject({ show: true, nativeOpen: false, displayMode: "push" }); expect(sr(401)).toBeUndefined(); expect((sess[PKEY] as any)?.[401]).toBeUndefined();
    });
    test("对照（没有持久化：restoreOnClose 记录被清掉）→ 回收后 Off 只关，页内不恢复（修前行为）", async () => {
        await warmInpage(3003, 402); delete sess[KEY]; const { a, panel } = await afterRecycle(3003, 402); calls.length = 0; off(); await wait();
        expect(closes(402)).toEqual(["close:402"]); panel.disconnect(); await wait(); expect(last(a)).toMatchObject({ show: false, nativeOpen: false });
    });
    test("热路径不变（没回收）：同一生命里 Off → 关 → 页内恢复；标签关闭不清标记（关原生时页内照样恢复）", async () => {
        const { a, panel } = await warmInpage(3004, 403); calls.length = 0; for (const f of L.rem ?? []) f(9999); off(); await wait(); expect(closes(403)).toEqual(["close:403"]);
        panel.disconnect(); await wait(); expect(last(a)).toMatchObject({ show: true, nativeOpen: false });
        const w2 = await warmInpage(3014, 413); for (const f of L.rem ?? []) f(3014); await wait(); expect(sr(413)).toBeDefined(); expect(w2.panel).toBeDefined(); // 标签关了：记录还在（不同于 prewarmOpened.removeTab）
    });
    test("副作用护栏 1：回收后重连握手（hello）/ 切到另一个普通页，**不会**把正开着的原生关掉（恢复来的标记不参与到达自动切换）；对照：热 SW 同操作会切（既有 switch-auto 行为）", async () => {
        await warmInpage(3005, 404); const { a } = await afterRecycle(3005, 404); await connectHost(3105, 404, "https://b.test/"); L.act![0]!({ tabId: 3105, windowId: 404 }); await wait(30);
        expect(calls.filter(c => c.startsWith("close"))).toEqual([]); expect(openSet.has(404)).toBe(true); expect(last(a)).toMatchObject({ show: false, nativeOpen: true });
        // 热对照
        await warmInpage(3006, 405); await connectHost(3106, 405, "https://b.test/"); calls.length = 0; L.act![0]!({ tabId: 3106, windowId: 405 }); await wait(30); expect(closes(405)).toEqual(["close:405"]);
    });
    test("副作用护栏 2：页内本来就关着（用户 ⌃S 关掉）→ 预热开原生没有标记 → 回收后 Off / 关原生都不会弹出页内", async () => {
        prefs.prewarm = "window"; await boot({ reset: true }); const a0 = await connectHost(3007, 406); L.act![0]!({ tabId: 3007, windowId: 406 }); await wait();
        routerFn!({ id: 3007, windowId: 406, url: W }); await wait(); routerFn!({ id: 3007, windowId: 406, url: W }); await wait(); expect(last(a0)).toMatchObject({ show: false }); // 开 → 关
        msg({ type: "inpage:prewarm", source: "host" }, { id: "x", tab: { id: 3007, windowId: 406, url: W } }); await wait(); await openNative(406); await wait(); expect(sr(406)).toBeUndefined();
        const { a, panel } = await afterRecycle(3007, 406); off(); await wait(); panel.disconnect(); await wait(); expect(last(a)).toMatchObject({ show: false, nativeOpen: false });
    });
    test("副作用护栏 3：过期（> 10 分钟）→ 关原生后不恢复（只清除）", async () => {
        await warmInpage(3008, 407); delete sess[PKEY]; skew = RC.ttlMs + 1000;
        try { const { a, panel } = await afterRecycle(3008, 407); panel.disconnect(); await wait(); expect(last(a)).toMatchObject({ show: false }); expect(sr(407)).toBeUndefined(); } finally { skew = 0; }
    });
    test("副作用护栏 4：tabId / windowId 不匹配 → 不恢复：标签换窗口 / 标签已关 / 窗口已关", async () => {
        for (const [name, mutate] of [["标签换窗口", (t: number) => { urlOf[t] = { windowId: 999, url: W }; }], ["标签已关", (t: number) => { delete urlOf[t]; }], ["窗口已关", (_t: number, w: number) => { deadWin.add(w); }]] as const) {
            const t = 3200 + Math.floor(Math.random() * 700), w = 500 + Math.floor(Math.random() * 90);
            await warmInpage(t, w); delete sess[PKEY]; mutate(t, w); await boot(); const a = await connectHost(t, w); L.act![0]!({ tabId: t, windowId: w }); const panel = await openNative(w); await wait(); panel.disconnect(); await wait();
            expect([name, last(a)?.show]).toEqual([name, false]); deadWin.delete(w);
        }
    });
    test("retab：预热后切到别的标签（onActivated）再关掉预热标签 → 存储里的 tabId 已跟随 → 回收后仍有效，Off 后页内恢复", async () => {
        const { a: a1 } = await warmInpage(3009, 408); void a1; await connectHost(3109, 408, "https://c.test/"); urlOf[3109] = { windowId: 408, url: "chrome://settings/" }; L.act![0]!({ tabId: 3109, windowId: 408 }); await wait();
        expect(sr(408).tabId).toBe(3109); delete urlOf[3009]; for (const f of L.rem ?? []) f(3009); await wait(); delete sess[PKEY];
        await boot(); const a = await connectHost(3109, 408, "https://c.test/"); L.act![0]!({ tabId: 3109, windowId: 408 }); const panel = await openNative(408); await wait(); panel.disconnect(); await wait();
        expect(last(a)).toMatchObject({ show: true, nativeOpen: false });
    });
    test("加载竞态 1：Off 的 refresh 在 storage.session 加载完成前到达 → 先不关；加载完再判 → close 一次；之后端口断开 → 页内恢复", async () => {
        await warmInpage(3010, 409); let go!: () => void; const gate = new Promise<void>(r => { go = r; });
        await kill(); calls.length = 0; openSet.clear(); installSession(); sessGate = gate; cleanup = BG.startBackground(); await wait();
        const a = await connectHost(3010, 409); L.act![0]!({ tabId: 3010, windowId: 409 }); const panel = await openNative(409); await wait(); calls.length = 0;
        off(); await wait(); expect(closes(409)).toEqual([]); go(); await wait(40); expect(closes(409)).toEqual(["close:409"]); panel.disconnect(); await wait(); expect(last(a)).toMatchObject({ show: true, nativeOpen: false });
    });
    test("加载竞态 2：原生在标记加载完成前就被关了（冷 SW）→ 先照旧推一次，加载完再补恢复 + push（不丢、不重复）", async () => {
        await warmInpage(3011, 410); delete sess[PKEY]; let go!: () => void; const gate = new Promise<void>(r => { go = r; });
        await kill(); calls.length = 0; openSet.clear(); installSession(); sessGate = gate; cleanup = BG.startBackground(); await wait();
        const a = await connectHost(3011, 410); L.act![0]!({ tabId: 3011, windowId: 410 }); const panel = await openNative(410); await wait();
        panel.disconnect(); await wait(); expect(last(a)).toMatchObject({ show: false }); go(); await wait(40); expect(last(a)).toMatchObject({ show: true, nativeOpen: false }); expect(sr(410)).toBeUndefined();
    });
    test("加载竞态 3（没有标记）：等加载完 → 不恢复", async () => {
        prefs.prewarm = "window"; await boot({ reset: true }); await connectHost(3012, 411); let go!: () => void; const gate = new Promise<void>(r => { go = r; });
        runCleanup(); calls.length = 0; openSet.clear(); installSession(); sessGate = gate; cleanup = BG.startBackground(); await wait();
        const a = await connectHost(3012, 411); L.act![0]!({ tabId: 3012, windowId: 411 }); const panel = await openNative(411); await wait(); panel.disconnect(); await wait(); go(); await wait(40); expect(last(a)).toMatchObject({ show: false });
    });
    test("sweep：只从存储恢复、本生命里没等到原生面板的标记 → 作废且不恢复；之后用户自己开的原生关掉也不会弹页内；有原生面板的标记保留", async () => {
        const realST = globalThis.setTimeout; (globalThis as any).setTimeout = (fn: Function, ms?: number, ...r: unknown[]) => realST(fn as () => void, ms === RC?.sweepMs ? 20 : ms, ...r);
        try {
            await warmInpage(3013, 412); delete sess[PKEY]; await boot(); const a = await connectHost(3013, 412); L.act![0]!({ tabId: 3013, windowId: 412 }); await wait(80);
            expect(sr(412)).toBeUndefined(); const p = await openNative(412); await wait(); p.disconnect(); await wait(); expect(last(a)).toMatchObject({ show: false });
            await warmInpage(3016, 414); delete sess[PKEY]; const r = await afterRecycle(3016, 414); await wait(80); expect(sr(414)).toBeDefined(); r.panel.disconnect(); await wait(); expect(last(r.a)).toMatchObject({ show: true });
        } finally { (globalThis as any).setTimeout = realST; }
    });
    test("清除：窗口关闭撤记录；cleanup（插件停用）清空", async () => {
        await warmInpage(3017, 415); for (const f of L.wrem ?? []) f(415); await wait(); expect(sr(415)).toBeUndefined();
    });
    test("回退：storage.session 不可用 → 不抛错，同一生命里 Off 仍恢复（内存标记）；回收后不恢复（修前行为）", async () => {
        sessionOn = false;
        try {
            const { a, panel } = await warmInpage(3018, 416); off(); await wait(); panel.disconnect(); await wait(); expect(last(a)).toMatchObject({ show: true });
            prefs.prewarm = "window"; const w2 = await warmInpage(3019, 417); await boot(); const a2 = await connectHost(3019, 417); L.act![0]!({ tabId: 3019, windowId: 417 }); const p2 = await openNative(417); await wait(); void w2; p2.disconnect(); await wait(); expect(last(a2)).toMatchObject({ show: false });
        } finally { sessionOn = true; }
    });
    test("回退：session.set 拒绝 → 不抛错、内存标记照常（同一生命里仍恢复）", async () => {
        prefs.prewarm = "window"; await boot({ reset: true }); sessSetErr = true; const a = await connectHost(3020, 418); L.act![0]!({ tabId: 3020, windowId: 418 }); await wait(); routerFn!({ id: 3020, windowId: 418, url: W }); await wait();
        msg({ type: "inpage:prewarm", source: "host" }, { id: "x", tab: { id: 3020, windowId: 418, url: W } }); await wait(); const panel = await openNative(418); off(); await wait(); panel.disconnect(); await wait(); expect(last(a)).toMatchObject({ show: true });
    });
    /** rel62-intent-persist：扩展重载 = SW 进程没了 + storage.session 清空（storage.local 保留）+ 原生面板文档随扩展重载销毁 */
    const reloadExt = async () => { await kill(); for (const k of Object.keys(sess)) delete sess[k]; calls.length = 0; openSet.clear(); routerFn = undefined; coldReopen = undefined; sessGate = undefined; installSession(); cleanup = BG.startBackground(); await wait(); };
    test("rel62 ④（复现 sc4-window-native）：页内开着 → 预热开原生 → 扩展重载 → 新标签 / 同标签都恢复页内（修前：落盘意图被删 → show:false、触发块）", async () => {
        await warmInpage(3030, 430); await reloadExt();
        const a = await connectHost(3031, 430); L.act![0]!({ tabId: 3031, windowId: 430 }); await wait(C.SUPPRESS_RESTORE.graceMs + 120);
        expect(last(a)).toMatchObject({ show: true, nativeOpen: false }); expect(calls.filter(c => c.startsWith("open"))).toEqual([]); // 没有原生被打开
        expect(routerFn!({ id: 3031, windowId: 430, url: W })).toBe("inpage"); await wait(); expect(last(a)).toMatchObject({ show: false }); // ⌃S 照常收起（意图 = 真的 true）
    });
    test("rel62 ④：页内本来关着 → 预热开原生 → 扩展重载 → 不弹页内（没有 suppressed，落盘 false）", async () => {
        prefs.prewarm = "window"; await boot({ reset: true }); const a0 = await connectHost(3032, 431); L.act![0]!({ tabId: 3032, windowId: 431 }); await wait();
        routerFn!({ id: 3032, windowId: 431, url: W }); await wait(); routerFn!({ id: 3032, windowId: 431, url: W }); await wait(); expect(last(a0)).toMatchObject({ show: false });
        msg({ type: "inpage:prewarm", source: "host" }, { id: "x", tab: { id: 3032, windowId: 431, url: W } }); await wait(); await openNative(431); await wait();
        await reloadExt(); const a = await connectHost(3033, 431); L.act![0]!({ tabId: 3033, windowId: 431 }); await wait(C.SUPPRESS_RESTORE.graceMs + 120); expect(last(a)).toMatchObject({ show: false });
    });
    test("rel62 ④：浏览器重启（窗口 id 变了）→ 新窗口继承全局最近意图：最后一次是展开 → 展开；最后一次是收起 → 不展开", async () => {
        await warmInpage(3034, 432); await reloadExt(); const a = await connectHost(3035, 433); L.act![0]!({ tabId: 3035, windowId: 433 }); await wait(); expect(last(a)).toMatchObject({ show: true });
        expect(routerFn!({ id: 3035, windowId: 433, url: W })).toBe("inpage"); await wait(); expect(last(a)).toMatchObject({ show: false }); // 用户收起 → lastOpen:false
        await reloadExt(); const b = await connectHost(3036, 434); L.act![0]!({ tabId: 3036, windowId: 434 }); await wait(); expect(last(b)).toMatchObject({ show: false });
    });
    test("rel62 ④：SW 回收路径不变——session 存活键还在、restoreOnClose 标记被清 → 关原生后不恢复；有标记 → 恢复（见上面 复现 / 对照）", async () => {
        await warmInpage(3037, 435); delete sess[KEY]; expect(sess[C.SUPPRESS_RESTORE.sessionKey]).toBe(true);
        const { a, panel } = await afterRecycle(3037, 435); await wait(C.SUPPRESS_RESTORE.graceMs + 120); panel.disconnect(); await wait(); expect(last(a)).toMatchObject({ show: false, nativeOpen: false });
    });
    test("冷 SW 的另一条老路径不变：⌃S 先于 start()（takeColdReopenClose）→ 页内常驻恢复；恢复后重复 nativeChanged 不抛", async () => {
        await warmInpage(3021, 419); await boot(); const a = await connectHost(3021, 419); L.act![0]!({ tabId: 3021, windowId: 419 }); const panel = await openNative(419); await wait();
        coldReopen = { t: Date.now(), windowId: 419, tabId: 3021 }; openSet.delete(419); panel.disconnect(); await wait(30); expect(last(a)).toMatchObject({ show: true, nativeOpen: false });
    });
});

describe("C) 源码 / 常量约束", () => {
    const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    const bg = readFileSync(resolve(DIR, "background.ts"), "utf8");
    test("常量集中：10 分钟 / key / 超时 / sweep 只在 constants.ts；prewarmOpened.ts / background.ts 不写死数字", () => {
        expect(RC).toEqual({ key: KEY, ttlMs: 600_000, loadTimeoutMs: 1_500, sweepMs: 7_000 });
        const code = strip(bg) + strip(readFileSync(resolve(DIR, "prewarmOpened.ts"), "utf8")); expect(code).not.toMatch(/600_?000|10 \* 60|1_?500\b|\b7_?000\b/); expect(code).not.toContain('"inpageRestoreOnClose"');
        expect(strip(readFileSync(resolve(DIR, "prewarmOpened.ts"), "utf8"))).not.toMatch(/\b(window|document|chrome)\b/);
    });
    test("background.ts 接线：restoreOnClose = RestoreOnClose（不再是 TracedSet）、复用同一存取层；pendingWin 仍是内存 TracedSet（不持久化）", () => {
        expect(bg).toContain("const restoreOnClose = new RestoreOnClose("); expect(bg).not.toContain('new TracedSet("restoreOnClose")'); expect(bg).toContain('const pendingWin = new TracedSet("pendingWin")');
        expect(bg).toContain("key: RESTORE_ON_CLOSE.key, ttlMs: RESTORE_ON_CLOSE.ttlMs, loadTimeoutMs: RESTORE_ON_CLOSE.loadTimeoutMs"); expect(bg).toContain("onOp: (op, info) => { if (traceOn()) trace(`restoreOnClose.${op}`, info); }");
    });
    test("读 restoreOnClose 的路径：nativeChanged 未加载时等 ready 再判；closePrewarmedIfOff 等两份 ready；到达 / 握手只认本生命的标记（arrivalMarked）；onActivated 跟随 retab；不随标签关闭清除；窗口关闭清除", () => {
        const b = strip(bg);
        expect(b).toMatch(/if \(restoreOnClose\.loaded\) restoreInpage\(open\);\s*else if \(!panelAlive\(w\) && !pendingWin\.has\(w\)\) void restoreOnClose\.ready\.then\(\(\) => \{ if \(restoreInpage\(showingNative\(w\)\)\) pushWindow\(w\); \}\);/);
        expect(b).toMatch(/if \(!prewarmOpened\.loaded \|\| !restoreOnClose\.loaded\) \{ void Promise\.all\(\[prewarmOpened\.ready, restoreOnClose\.ready\]\)\.then\(closePrewarmedIfOff\); return; \}/);
        expect(b).toContain("const arrivalMarked = (w: number) => restoreOnClose.has(w) && !restoreOnClose.restored.has(w);");
        expect(b).toContain("restoreMarked: arrivalMarked(w)"); expect(b).toContain("else if (arrivalMarked(rec.windowId) && activeByWin[rec.windowId] === rec.tabId) evalSidebarSwitch"); expect(b).toContain("if (arrivalMarked(i.windowId)) arriveCheck(i.windowId, i.tabId);");
        expect(b).toContain("restoreOnClose.retab(i.windowId, i.tabId);"); expect(b).not.toMatch(/restoreOnClose\.removeTab/);
        expect(b).toMatch(/const onWinRemoved = \(w: number\) => \{[^}]*restoreOnClose\.delete\(w\);/); expect(b).toContain("restoreOnClose.clear(); pendingWin.clear(); awaitHost.clear(); prewarmOpened.clear();");
    });
    test("sweep：restored 且没有原生面板（端口 / 正在打开 / pending）→ delete（不恢复）", () => {
        expect(strip(bg)).toMatch(/restoreOnClose\.restored\.size\) later\(\(\) => \{ for \(const w of Array\.from\(restoreOnClose\.restored\)\) if \(!panelAlive\(w\) && !isPanelOpen\(w\) && !pendingWin\.has\(w\)\) \{ restoreOnClose\.delete\(w\); dropSuppressed\(w\); \} \}, RESTORE_ON_CLOSE\.sweepMs\);/); // rel62-intent-persist：作废时连同 storage.local 的 suppressed 一起作废（仍是「不恢复」）
    });
    test("manifest 不碰、不需要新权限（storage 已有）", () => {
        const m = JSON.parse(readFileSync(resolve(DIR, "../../../static/manifest.json"), "utf8")); expect(m.permissions).toContain("storage");
    });
});

/* 补丁 inpage-prewarmopened-persist：prewarmOpened（窗口的原生是首次手势预热开的）持久化到 chrome.storage.session。
 * A) PrewarmOpened 类（纯，注入假依赖）：写镜像 / 过期 / tabId·windowId 校验 / 加载竞态 / 清除 / 回退；
 * B) 后台控制器（chrome mock，真 toggleFor / nativeChanged / 预热；「SW 回收」= 清监听后重新 startBackground，session 数据保留）；
 * C) 源码 / manifest 约束（storage 权限已在、没有新增权限；SW 无 DOM）。无 Chrome。 */
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { PREWARM_OPENED } from "../src/plugins/inpageSidebar/constants";
import { PrewarmOpened, type PrewarmOpenedDeps } from "../src/plugins/inpageSidebar/prewarmOpened";

const DIR = resolve(import.meta.dir, "../src/plugins/inpageSidebar");
const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));
const KEY = PREWARM_OPENED.key;

describe("A) PrewarmOpened 类", () => {
    const mkArea = (init: Record<string, unknown> = {}, o: { getDelay?: Promise<void>; getErr?: boolean; setErr?: boolean } = {}) => {
        const data: Record<string, unknown> = { ...init }; const sets: Record<string, unknown>[] = [];
        return { data, sets, area: {
            get: async (k: string) => { if (o.getErr) throw new Error("no session"); if (o.getDelay) await o.getDelay; return { [k]: data[k] }; },
            set: async (it: Record<string, unknown>) => { if (o.setErr) throw new Error("quota"); sets.push(JSON.parse(JSON.stringify(it))); Object.assign(data, it); },
        } };
    };
    const mk = (over: Partial<PrewarmOpenedDeps> & { now?: number; tabs?: Record<number, number>; wins?: number[] } = {}) => {
        const clock = { t: over.now ?? 1_000_000 }; const tabs = over.tabs ?? { 11: 5 }; const wins = over.wins ?? [5];
        const deps: PrewarmOpenedDeps = { now: () => clock.t, area: undefined, tabOf: w => (w === 5 ? 11 : undefined), getTab: async id => (id in tabs ? { windowId: tabs[id] } : Promise.reject(new Error("No tab"))), hasWindow: async w => wins.includes(w), ...over };
        return { clock, deps, mk: () => new PrewarmOpened(deps) };
    };
    const rec = (w = 5, tabId = 11, t = 1_000_000) => ({ [KEY]: { [w]: { tabId, windowId: w, t } } });

    test("写镜像：add 记 { tabId（预热时窗口的激活标签）, windowId, t }；delete / clear 同步撤；tabOf 取不到 = 只记内存", async () => {
        const m = mkArea(); const { mk: make } = mk({ area: m.area }); const s = make(); await s.ready;
        s.add(5); await tick(); expect(s.has(5)).toBe(true); expect(m.data[KEY]).toEqual({ 5: { tabId: 11, windowId: 5, t: 1_000_000 } });
        s.add(6); await tick(); expect(s.has(6)).toBe(true); expect(Object.keys(m.data[KEY] as object)).toEqual(["5"]); // 窗口 6 没有激活标签记录 → 不持久化
        s.delete(5); await tick(); expect(s.has(5)).toBe(false); expect(m.data[KEY]).toEqual({});
        s.add(5); await tick(); s.clear(); await tick(); expect(s.size).toBe(0); expect(m.data[KEY]).toEqual({});
    });
    test("onOp 钩子（debug-trace 接入点）：add 带 had、delete 只在真删了时回调、clear 只在非空时回调", () => {
        const ops: unknown[] = []; const s = mk({ onOp: (op, info) => ops.push([op, info]) }).mk(); s.add(5); s.add(5); s.delete(5); s.delete(5); s.add(1); s.clear(); s.clear();
        expect(ops).toEqual([["add", { w: 5, had: false }], ["add", { w: 5, had: true }], ["delete", { w: 5 }], ["add", { w: 1, had: false }], ["clear", { n: 1 }]]);
    });
    test("读取：有效记录恢复（has = true、restored 里有）；加载完成前 loaded = false，ready 之后 true", async () => {
        const m = mkArea(rec()); const s = mk({ area: m.area }).mk(); expect(s.loaded).toBe(false); expect(s.has(5)).toBe(false);
        await s.ready; expect(s.loaded).toBe(true); expect(s.has(5)).toBe(true); expect(s.restored.has(5)).toBe(true); expect(s.tabIdOf(5)).toBe(11);
    });
    test("过期：超过 ttlMs（10 分钟）的记录丢弃并从存储里删掉；刚好在寿命内保留；时间在未来（> 60 s）也丢", async () => {
        expect(PREWARM_OPENED.ttlMs).toBe(600_000);
        for (const [age, keep] of [[PREWARM_OPENED.ttlMs - 1, true], [PREWARM_OPENED.ttlMs + 1, false], [-120_000, false]] as const) {
            const m = mkArea(rec(5, 11, 1_000_000 - age)); const s = mk({ area: m.area }).mk(); await s.ready; await tick();
            expect(s.has(5)).toBe(keep); if (!keep) expect(m.data[KEY]).toEqual({});
        }
    });
    test("tabId / windowId 不匹配：标签不在该 window / 标签已不存在 / 窗口已不存在 / 记录自相矛盾 → 丢弃", async () => {
        const cases: Array<[string, Record<string, unknown>, { tabs?: Record<number, number>; wins?: number[] }]> = [
            ["标签被拖去别的窗口", rec(), { tabs: { 11: 9 } }], ["标签没了", rec(), { tabs: {} }], ["窗口没了", rec(), { wins: [] }],
            ["键与 windowId 不一致", { [KEY]: { 5: { tabId: 11, windowId: 6, t: 1_000_000 } } }, {}], ["字段缺失", { [KEY]: { 5: { windowId: 5, t: 1_000_000 } } }, {}], ["不是对象", { [KEY]: "x" }, {}],
        ];
        for (const [name, init, o] of cases) { const m = mkArea(init); const s = mk({ area: m.area, ...o }).mk(); await s.ready; expect([name, s.has(5)]).toEqual([name, false]); }
        const m = mkArea(rec()); const s = mk({ area: m.area }).mk(); await s.ready; expect(s.has(5)).toBe(true); // 对照：全部有效 = 保留
    });
    test("加载竞态：加载期间内存里已 add / delete 的窗口以内存为准（存储里的旧记录不覆盖、不复活）", async () => {
        let go!: () => void; const gate = new Promise<void>(r => { go = r; });
        const m = mkArea({ [KEY]: { 5: { tabId: 11, windowId: 5, t: 1_000_000 }, 7: { tabId: 12, windowId: 7, t: 1_000_000 } } }, { getDelay: gate });
        const s = mk({ area: m.area, tabs: { 11: 5, 12: 7 }, wins: [5, 7] }).mk(); expect(s.loaded).toBe(false);
        s.delete(5); // 加载没完成时用户已经让它作废
        go(); await s.ready; expect(s.has(5)).toBe(false); expect(s.has(7)).toBe(true);
    });
    test("加载超时（storage.session 卡住）：ready 在 loadTimeoutMs 后 resolve，按「没有标记」处理（旧行为）", async () => {
        const never = new Promise<void>(() => undefined); const m = mkArea(rec(), { getDelay: never });
        const s = mk({ area: m.area, loadTimeoutMs: 30 }).mk(); const t0 = Date.now(); await s.ready; expect(Date.now() - t0).toBeGreaterThanOrEqual(25); expect(s.loaded).toBe(true); expect(s.has(5)).toBe(false);
    });
    test("清除：removeTab 只清记录里 tabId 等于它的窗口；其它不动", async () => {
        const m = mkArea(); const { mk: make } = mk({ area: m.area, tabOf: w => (w === 5 ? 11 : 12) }); const s = make(); await s.ready; s.add(5); s.add(6); await tick();
        s.removeTab(99); expect([s.has(5), s.has(6)]).toEqual([true, true]); s.removeTab(11); await tick(); expect([s.has(5), s.has(6)]).toEqual([false, true]); expect(Object.keys(m.data[KEY] as object)).toEqual(["6"]);
    });
    test("回退：没有 storage.session → 立即 loaded、纯内存；get 抛错 / set 拒绝 → 不抛错、内存照常、不再写", async () => {
        const a = mk({ area: undefined }).mk(); expect(a.loaded).toBe(true); await a.ready; a.add(5); expect(a.has(5)).toBe(true); a.delete(5); expect(a.has(5)).toBe(false);
        const g = mkArea({}, { getErr: true }); const b = mk({ area: g.area }).mk(); await b.ready; expect(b.loaded).toBe(true); b.add(5); expect(b.has(5)).toBe(true);
        const s = mkArea({}, { setErr: true }); const c = mk({ area: s.area }).mk(); await c.ready; c.add(5); await tick(); c.add(6); await tick(); expect(c.has(5) && c.has(6)).toBe(true); expect(s.sets).toHaveLength(0);
    });
});

describe("B) 后台控制器：SW 回收后 ⌃S（chrome mock）", () => {
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
        BG = await import(resolve(DIR, "background.ts") + "?ppersist");
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
    const ctrlS = async (tabId: number, w: number) => { const r = routerFn!({ id: tabId, windowId: w, url: W }); if (r === "native") { if (openSet.has(w)) { openSet.delete(w); void chromeMock.sidePanel.close({ windowId: w }); } else void chromeMock.sidePanel.open({ windowId: w }); } await wait(); return r; };
    /** 实例 1：页内关着 → 首次手势预热开原生（记下标记）→ 返回 {tab, w}；之后调用方 boot() 模拟 SW 回收 */
    const prewarmed = async (tabId: number, w: number) => {
        await boot({ reset: true }); const a = await connectHost(tabId, w); L.act![0]!({ tabId, windowId: w }); await wait();
        msg({ type: "inpage:prewarm", source: "host" }, { id: "x", tab: { id: tabId, windowId: w, url: W } }); await wait(); const p = await openNative(w); await wait();
        expect(calls).toContain(`open:${w}`); expect(last(a)).toMatchObject({ show: false, nativeOpen: true }); return p;
    };
    /** SW 回收后：重新握手、激活、面板页重连；返回 {a, panel} */
    const afterRecycle = async (tabId: number, w: number) => { await boot(); const a = await connectHost(tabId, w); L.act![0]!({ tabId, windowId: w }); const panel = await openNative(w); await wait(); return { a, panel }; };

    test("预热时 session 里记下 { tabId, windowId, t }", async () => {
        await prewarmed(2001, 200); await wait();
        expect((sess[KEY] as Record<string, any>)[200]).toMatchObject({ tabId: 2001, windowId: 200 }); expect(typeof (sess[KEY] as any)[200].t).toBe("number");
    });
    test("复现（restore-pinned 的遗留缺口）：SW 回收后首次 ⌃S → 只关原生，页内以常驻恢复（show:true、push）", async () => {
        await prewarmed(2002, 201); const { a, panel } = await afterRecycle(2002, 201);
        calls.length = 0; expect(await ctrlS(2002, 201)).toBe("native"); await wait(); // 已加载：核心照常关原生（hide-visible + close）
        expect(calls).toEqual(["close:201"]); panel.disconnect(); await wait();
        expect(last(a)).toMatchObject({ show: true, nativeOpen: false, displayMode: "push" });
        expect((sess[KEY] as Record<string, unknown>)[201]).toBeUndefined(); // 原生没了 → 标记作废并从存储里撤掉
    });
    test("没有持久化（对照：记录被清掉）→ 回收后 ⌃S 只关（修前行为）", async () => {
        await prewarmed(2003, 202); delete sess[KEY]; const { a, panel } = await afterRecycle(2003, 202);
        calls.length = 0; await ctrlS(2003, 202); expect(calls).toEqual(["close:202"]); panel.disconnect(); await wait(); expect(last(a)).toMatchObject({ show: false });
    });
    test("过期（> 10 分钟）→ 只关，不恢复", async () => {
        await prewarmed(2004, 203); skew = PREWARM_OPENED.ttlMs + 1000;
        try { const { a, panel } = await afterRecycle(2004, 203); await ctrlS(2004, 203); panel.disconnect(); await wait(); expect(last(a)).toMatchObject({ show: false }); } finally { skew = 0; }
    });
    test("tabId / windowId 不匹配 → 只关：标签被移到别的窗口 / 标签已关 / 窗口已关", async () => {
        for (const [name, mutate] of [["标签换窗口", (t: number) => { urlOf[t] = { windowId: 999, url: W }; }], ["标签已关", (t: number) => { delete urlOf[t]; }], ["窗口已关", (_t: number, w: number) => { deadWin.add(w); }]] as const) {
            const t = 2100 + Math.floor(Math.random() * 800), w = 300 + Math.floor(Math.random() * 90);
            await prewarmed(t, w); mutate(t, w); await boot(); /* 记录校验发生在 boot 的加载里；之后 connectHost 重新握手（会重建 urlOf，不影响已完成的校验） */ const a = await connectHost(t, w);
            L.act![0]!({ tabId: t, windowId: w }); const panel = await openNative(w); await wait(); calls.length = 0; await ctrlS(t, w); panel.disconnect(); await wait();
            expect([name, last(a)?.show]).toEqual([name, false]); deadWin.delete(w);
        }
    });
    test("加载竞态：⌃S 在 storage.session 加载完成前到达 → 先不动（返回 inpage = 核心不抢先关原生），加载完再判断 → 有标记 = 常驻恢复", async () => {
        await prewarmed(2005, 204); let go!: () => void; const gate = new Promise<void>(r => { go = r; });
        await kill(); calls.length = 0; openSet.clear(); installSession(); sessGate = gate; cleanup = BG.startBackground(); await wait();
        const a = await connectHost(2005, 204); L.act![0]!({ tabId: 2005, windowId: 204 }); const panel = await openNative(204); await wait();
        calls.length = 0; const r = routerFn!({ id: 2005, windowId: 204, url: W }); await wait(); expect(r).toBe("inpage"); expect(calls).toEqual([]); // 还在等加载：什么都没做
        go(); await wait(30); expect(calls).toEqual(["close:204"]); panel.disconnect(); await wait(); expect(last(a)).toMatchObject({ show: true, nativeOpen: false });
    });
    test("加载竞态（没有标记）：等加载完 → 只关，不恢复；且只关一次（不重复）", async () => {
        await boot({ reset: true }); const a0 = await connectHost(2006, 205); void a0; let go!: () => void; const gate = new Promise<void>(r => { go = r; });
        runCleanup(); calls.length = 0; openSet.clear(); installSession(); sessGate = gate; cleanup = BG.startBackground(); await wait();
        const a = await connectHost(2006, 205); L.act![0]!({ tabId: 2006, windowId: 205 }); const panel = await openNative(205); await wait(); calls.length = 0;
        routerFn!({ id: 2006, windowId: 205, url: W }); go(); await wait(30); expect(calls).toEqual(["close:205"]); panel.disconnect(); await wait(); expect(last(a)).toMatchObject({ show: false });
    });
    test("清除：原生关闭（nativeChanged）/ 标签关闭 / 窗口关闭 都把 session 里的记录撤掉", async () => {
        await prewarmed(2007, 206); const panelA = openSet.has(206); expect(panelA).toBe(true);
        for (const f of L.rem ?? []) f(2007); await wait(); expect((sess[KEY] as Record<string, unknown>)[206]).toBeUndefined(); // 标签关闭
        await prewarmed(2008, 207); for (const f of L.wrem ?? []) f(207); await wait(); expect((sess[KEY] as Record<string, unknown>)[207]).toBeUndefined(); // 窗口关闭
        const p = await prewarmed(2009, 208); expect((sess[KEY] as Record<string, unknown>)[208]).toBeDefined();
        p.disconnect(); await wait(); expect((sess[KEY] as Record<string, unknown>)[208]).toBeUndefined(); // 原生关闭
    });
    test("回退：storage.session 不可用 → 不抛错，行为同修前（同一生命里的 ⌃S 仍恢复页内；回收后只关）", async () => {
        sessionOn = false;
        try {
            await boot({ reset: true }); const a = await connectHost(2010, 209); L.act![0]!({ tabId: 2010, windowId: 209 });
            msg({ type: "inpage:prewarm", source: "host" }, { id: "x", tab: { id: 2010, windowId: 209, url: W } }); await wait(); const panel = await openNative(209);
            await ctrlS(2010, 209); panel.disconnect(); await wait(); expect(last(a)).toMatchObject({ show: true }); // 内存标记 = restore-pinned 原行为
        } finally { sessionOn = true; }
    });
    test("回退：session.set 拒绝 → 不抛错、内存标记照常（同一生命里仍恢复）", async () => {
        await boot({ reset: true }); sessSetErr = true; const a = await connectHost(2011, 210); L.act![0]!({ tabId: 2011, windowId: 210 });
        msg({ type: "inpage:prewarm", source: "host" }, { id: "x", tab: { id: 2011, windowId: 210, url: W } }); await wait(); const panel = await openNative(210); await ctrlS(2011, 210); panel.disconnect(); await wait();
        expect(last(a)).toMatchObject({ show: true });
    });
    test("冷 SW：⌃S 先于 start() 到达，SPG 把重连的面板页当成「再点一次 = 关」关掉（takeColdReopenClose）→ 标记有效 → 页内常驻恢复", async () => {
        await prewarmed(2012, 211); await boot(); const a = await connectHost(2012, 211); L.act![0]!({ tabId: 2012, windowId: 211 }); const panel = await openNative(211); await wait();
        coldReopen = { t: Date.now(), windowId: 211, tabId: 2012 }; openSet.delete(211); panel.disconnect(); await wait(30); // SPG 已 closePanel：面板端口断开
        expect(last(a)).toMatchObject({ show: true, nativeOpen: false });
    });
    test("冷 SW：同上但没有持久化标记（用户自己开的原生）→ 只关，页内不出现", async () => {
        await boot({ reset: true }); const a = await connectHost(2013, 212); L.act![0]!({ tabId: 2013, windowId: 212 }); const panel = await openNative(212); await wait();
        coldReopen = { t: Date.now(), windowId: 212, tabId: 2013 }; openSet.delete(212); panel.disconnect(); await wait(30); expect(last(a)).toMatchObject({ show: false });
    });
    test("冷 SW：受限页（chrome://）→ 保持只关", async () => {
        await prewarmed(2014, 213); await boot(); urlOf[2014] = { windowId: 213, url: "chrome://settings/" }; const panel = await openNative(213); await wait();
        coldReopen = { t: Date.now(), windowId: 213, tabId: 2014 }; openSet.delete(213); panel.disconnect(); await wait(30);
        for (const f of L.act ?? []) f({ tabId: 2014, windowId: 213 }); await wait(); expect(calls.filter(c => c.startsWith("open"))).toEqual([]);
    });
});

describe("C) 源码 / manifest 约束", () => {
    test("manifest 已有 storage 权限（storage.session 不需要新增）；这个补丁不碰 manifest", () => {
        const m = JSON.parse(readFileSync(resolve(DIR, "../../../static/manifest.json"), "utf8")); expect(m.permissions).toContain("storage");
    });
    test("prewarmOpened.ts：无 window / document / chrome 引用；常量集中在 constants.ts（key / ttl / 加载超时 / sweep）", () => {
        const s = readFileSync(resolve(DIR, "prewarmOpened.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
        expect(s).not.toMatch(/\b(window|document|chrome)\b/); expect(s).toContain("PREWARM_OPENED");
        expect(PREWARM_OPENED).toEqual({ key: "inpagePrewarmOpened", ttlMs: 600_000, loadTimeoutMs: 1_500, sweepMs: 7_000 });
    });
    test("background.ts 接线：用 PrewarmOpened（不再是裸 Set）；toggleFor 在 hide-visible+close 且未加载时等 ready；nativeChanged 取 takeColdReopenClose；onTabRemoved 清", () => {
        const b = readFileSync(resolve(DIR, "background.ts"), "utf8");
        expect(b).toContain("const prewarmOpened = new PrewarmOpened("); expect(b).not.toContain("const prewarmOpened = new Set<number>()");
        expect(b).toMatch(/if \(!prewarmOpened\.loaded && d\.why === "hide-visible" && d\.native === "close"\) \{ void prewarmOpened\.ready\.then\(\(\) => \{ toggleFor\(tab, false\); \}\); return "inpage"; \}/);
        expect(b).toContain("takeColdReopenClose(w)"); expect(b).toContain("prewarmOpened.removeTab(id)");
    });
});

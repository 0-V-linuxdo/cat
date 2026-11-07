/* 补丁 inpage-tabswitch-noreload（rel55 第 15 层）：冷 SW 启动后，读完 storage 之前不向内容脚本下发状态。
 * 根因（静态 + 本文件单测）：startBackground 里 `ctl = me; for (e of pendingPorts) onHost(e.port, e)` 在 start 同一拍重放 hello → pushRec → stateFor → shouldShowHost(intentOf(w)) / mem.width，
 *   而 mem.openByWin / mem.width 要等 `store.ready.then(windows.getAll)` 才恢复（之后才 pushAll）→ 冷 SW 的第一条状态一定是 show:false + 默认宽（228）。
 *   内容脚本（切回标签：realSeen=true，shouldDeferInactive 不适用）照做 → 盒子收起 + 页面 pager 归零，几毫秒后第二条 show:true 再展开 = 「切 tab 重播展开动画」。
 * 本文件：每个用例用**新的** background 模块实例（模块级 ctl / storeRef 是进程级的，SW 冷启动 = 全新模块）；chrome mock；无 Chrome。 */
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import * as C from "../src/plugins/inpageSidebar/constants";

const DIR = resolve(import.meta.dir, "../src/plugins/inpageSidebar");
const STORE = `data:${C.STORE_KEY}`;

describe("B) 冷 SW：第一条状态不能是「未恢复的」show:false / 默认宽（chrome mock）", () => {
    const g = globalThis as Record<string, unknown>;
    const keep = { chrome: g.chrome, document: g.document };
    let realSettings: Record<string, unknown>; let realSPG: Record<string, unknown>;
    const prefs: Record<string, unknown> = { defaultMode: "inpage", showHandle: false, hoverReveal: false, prewarm: "off" };
    let L: Record<string, Function[]> = {}; const ev = (k: string) => ({ addListener: (f: Function) => { (L[k] ??= []).push(f); }, removeListener: (f: Function) => { L[k] = (L[k] ?? []).filter(x => x !== f); } });
    let sess: Record<string, unknown> | undefined; // rel62-intent-persist：storage.session（undefined = 没有 session 区；{} = 扩展重载 / 重启后清空的 session）
    let persisted: unknown = undefined; let getMode: "ok" | "reject" | "hang" = "ok"; const aliveWins = new Set<number>([77]);
    const chromeMock: Record<string, any> = {
        runtime: { onMessage: ev("msg"), onConnect: ev("conn"), lastError: undefined, id: "x", getManifest: () => ({ version: "0.0.0" }) }, commands: { onCommand: ev("cmd") },
        contextMenus: { onClicked: ev("menu"), create: (_p: unknown, cb?: () => void) => { cb?.(); }, remove: (_id: string, cb?: () => void) => cb?.(), update: (_i: string, _p: unknown, cb?: () => void) => cb?.() },
        sidePanel: { open: async () => undefined, close: async () => undefined, setOptions: async () => undefined },
        webNavigation: { onBeforeNavigate: ev("nav") },
        tabs: { update: async () => undefined, onActivated: ev("act"), onUpdated: ev("upd"), onRemoved: ev("rem"), query: async () => [], get: async (id: number) => ({ id, windowId: 77, url: "https://a.test/" }), sendMessage: async () => ({ ok: true, proto: 1 }) },
        windows: { onRemoved: ev("wrem"), onFocusChanged: ev("foc"), getAll: async () => [...aliveWins].map(id => ({ id })), get: async (id: number) => { if (!aliveWins.has(id)) throw new Error("No window"); return { id }; }, getLastFocused: async () => ({ id: 77 }), WINDOW_ID_NONE: -1 },
        action: { setBadgeText: async () => undefined },
        storage: { local: { get: async (k: string) => { if (getMode === "reject") throw new Error("storage down"); if (getMode === "hang") return new Promise(() => undefined); return k === STORE && persisted !== undefined ? { [STORE]: JSON.parse(JSON.stringify(persisted)) } : {}; }, set: async () => undefined }, onChanged: ev("sc") },
    };
    const SPG_PATH = resolve(DIR, "../../api/SidePanelGesture.ts"); let cleanup: unknown; let n = 0;
    const runCleanup = () => { for (const c of ([] as unknown[]).concat(cleanup ?? [])) { try { (c as () => void)(); } catch { /* */ } } cleanup = undefined; };
    beforeAll(async () => {
        realSettings = { ...(await import("../src/plugins/inpageSidebar/settings")) }; realSPG = { ...(await import("../src/api/SidePanelGesture")) };
        mock.module(SPG_PATH, () => ({ ...realSPG, setGestureRouter: () => undefined, isPanelOpen: () => false, takeColdGesture: () => undefined, takeColdReopenClose: () => undefined, closePanel: async () => undefined, openPanelInGesture: () => undefined }));
        mock.module(resolve(DIR, "settings.ts"), () => ({ settings: { store: prefs, def: {} } }));
        delete g.document; g.chrome = chromeMock;
    });
    afterAll(() => { runCleanup(); mock.module(resolve(DIR, "settings.ts"), () => realSettings); mock.module(SPG_PATH, () => realSPG); mock.restore(); g.chrome = keep.chrome; if (keep.document !== undefined) g.document = keep.document; });
    const wait = (ms = 8) => new Promise(r => setTimeout(r, ms));
    const mkPort = (name: string, sender: unknown) => { const m: Function[] = []; const sent: any[] = []; return { name, sender, sent, postMessage: (x: unknown) => { sent.push(x); }, disconnect() { /* */ }, onMessage: { addListener: (f: Function) => m.push(f), removeListener: (f: Function) => { const i = m.indexOf(f); if (i >= 0) m.splice(i, 1); } }, onDisconnect: { addListener: (_f: Function) => undefined }, say: (x: unknown) => { for (const f of m) f(x); } }; };
    const states = (p: { sent: any[] }) => p.sent.filter(s => s.type === "inpage:state");
    /** 一次「SW 冷启动」：新模块实例 + 清掉监听；返回 { BG, start }。hello 先于 start 到（pendingPorts 路径）= 真实冷启动里 bootstrap 还没跑完时端口就连上了 */
    const coldBoot = async (o: { helloBeforeStart?: boolean; tabId?: number; win?: number } = {}) => {
        if (sess) { const S = sess; chromeMock.storage.session = { get: async (k: string) => ({ [k]: JSON.parse(JSON.stringify(S[k] ?? null)) ?? undefined }), set: async (x: Record<string, unknown>) => { Object.assign(S, JSON.parse(JSON.stringify(x))); } }; } else delete chromeMock.storage.session;
        runCleanup(); L = {}; const BG = await import(resolve(DIR, "background.ts") + `?coldstate${++n}`); const tab = { id: o.tabId ?? 5, windowId: o.win ?? 77, url: "https://a.test/" };
        const host = mkPort("inpage:host", { tab, frameId: 0 }); const hello = () => { for (const f of L.conn!) f(host); host.say({ type: "hello", proto: 1, frame: "none" }); };
        if (o.helloBeforeStart !== false) hello();
        cleanup = BG.startBackground(); if (o.helloBeforeStart === false) { await wait(); hello(); }
        return { BG, host };
    };

    test("复现 + 修复：窗口意图 / 宽度只存在 storage.local → 冷 SW 重放的 hello 之后，宿主收到的**每一条**状态都是 show:true + 真实宽（没有 show:false / 228 的中间态）", async () => {
        persisted = { openByWin: { 77: true }, width: 300 }; getMode = "ok";
        const { host } = await coldBoot(); await wait(40);
        const s = states(host); expect(s.length).toBeGreaterThan(0);
        expect(s.map(x => [x.show, x.width])).toEqual(s.map(() => [true, 300]));
    });
    test("热路径（端口在恢复完成之后才连）：hello 立刻得到 show:true + 真实宽，没有额外延迟", async () => {
        persisted = { openByWin: { 77: true }, width: 280 }; getMode = "ok";
        const { host } = await coldBoot({ helloBeforeStart: false }); await wait(20);
        expect(states(host).at(-1)).toMatchObject({ show: true, width: 280 }); expect(states(host).every(x => x.show === true)).toBe(true);
    });
    test("没有存过任何东西（全新安装）：恢复完成后仍然补发一条状态（默认宽）；rel62-intent-persist：没有记录 + 默认方式 inpage → 展开（修前 show:false）", async () => {
        persisted = undefined; getMode = "ok"; const { host } = await coldBoot(); await wait(40);
        expect(states(host).length).toBeGreaterThan(0); expect(states(host).at(-1)).toMatchObject({ show: true, width: C.ARC.defaultWidth });
    });
    test("rel62-intent-persist：没有本窗口记录、全局最近意图 lastOpen:false（用户上次收起）→ 不展开；仍然补发状态", async () => {
        persisted = { openByWin: {}, lastOpen: false }; getMode = "ok"; const { host } = await coldBoot(); await wait(40);
        expect(states(host).length).toBeGreaterThan(0); expect(states(host).at(-1)).toMatchObject({ show: false, width: C.ARC.defaultWidth });
    });
    test("rel62-intent-persist：默认方式 = native 时没有记录 → 不展开（继承默认只对 inpage 成立）", async () => {
        persisted = undefined; getMode = "ok"; prefs.defaultMode = "native";
        try { const { host } = await coldBoot(); await wait(40); expect(states(host).at(-1)).toMatchObject({ show: false }); } finally { prefs.defaultMode = "inpage"; }
    });
    test("存的意图属于已不存在的窗口（浏览器重启后 id 变了）：旧 id 被清掉；rel62-intent-persist：新窗口继承 lastOpen（true → 展开 / false → 不展开 / 没有 → 默认展开）", async () => {
        for (const [lastOpen, show] of [[true, true], [false, false], [undefined, true]] as const) {
            persisted = { openByWin: { 999: true }, width: 300, ...(lastOpen === undefined ? {} : { lastOpen }) }; getMode = "ok"; const { host } = await coldBoot(); await wait(40);
            expect([lastOpen, states(host).at(-1)?.show]).toEqual([lastOpen, show]);
        }
    });
    test("rel62-intent-persist：本窗口记录 false（用户在这个窗口收起过）优先于 lastOpen:true", async () => {
        persisted = { openByWin: { 77: false }, lastOpen: true }; getMode = "ok"; const { host } = await coldBoot(); await wait(40);
        expect(states(host).at(-1)).toMatchObject({ show: false });
    });
    test("存储读失败（reject）→ 放行：照默认值补发状态，不卡住（rel62-intent-persist：默认 = 继承默认值 → 展开）", async () => {
        persisted = { openByWin: { 77: true }, width: 300 }; getMode = "reject";
        try { const { host } = await coldBoot(); await wait(40); expect(states(host).length).toBeGreaterThan(0); expect(states(host).at(-1)).toMatchObject({ show: true, width: C.ARC.defaultWidth }); } finally { getMode = "ok"; }
    });
    test("rel62-intent-persist（④ 复现 sc4-window-native）：开原生时收起的窗口（落盘 openByWin:true + suppressedByWin）→ 扩展重载（session 清空）后没有原生面板 → graceMs 后恢复页内（show:true）", async () => {
        persisted = { openByWin: { 77: true }, suppressedByWin: { 77: true }, width: 300 }; getMode = "ok"; sess = {};
        try {
            const { host } = await coldBoot(); await wait(40); expect(states(host).at(-1)).toMatchObject({ show: false }); // 先按收起（可能还有原生面板）
            await wait(C.SUPPRESS_RESTORE.graceMs + 120); expect(states(host).at(-1)).toMatchObject({ show: true, width: 300 });
        } finally { sess = undefined; }
    });
    test("rel62-intent-persist：SW 回收（session 里有存活键）且没有 restoreOnClose 标记 → 不恢复（修前行为：宁可不恢复）", async () => {
        persisted = { openByWin: { 77: true }, suppressedByWin: { 77: true }, width: 300 }; getMode = "ok"; sess = { [C.SUPPRESS_RESTORE.sessionKey]: true };
        try { const { host } = await coldBoot(); await wait(C.SUPPRESS_RESTORE.graceMs + 120); expect(states(host).at(-1)).toMatchObject({ show: false }); } finally { sess = undefined; }
    });
    test("rel62-intent-persist：没有 storage.session（分不出重载 / 回收）→ 保守不恢复", async () => {
        persisted = { openByWin: { 77: true }, suppressedByWin: { 77: true }, width: 300 }; getMode = "ok"; sess = undefined;
        const { host } = await coldBoot(); await wait(C.SUPPRESS_RESTORE.graceMs + 120); expect(states(host).at(-1)).toMatchObject({ show: false });
    });
    test("rel62-intent-persist：重载后原生面板还开着 → 先不恢复；面板关掉后恢复页内", async () => {
        persisted = { openByWin: { 77: true }, suppressedByWin: { 77: true }, width: 300 }; getMode = "ok"; sess = {};
        try {
            const { host } = await coldBoot(); const d: Function[] = []; const panel = { name: "panel:77", sender: { url: "chrome-extension://x/sidepanel.html" }, postMessage: () => undefined, disconnect() { for (const f of d) f(); }, onMessage: { addListener: () => undefined, removeListener: () => undefined }, onDisconnect: { addListener: (f: Function) => d.push(f) } };
            for (const f of L.conn!) f(panel); await wait(C.SUPPRESS_RESTORE.graceMs + 120); expect(states(host).at(-1)).toMatchObject({ show: false });
            panel.disconnect(); await wait(40); expect(states(host).at(-1)).toMatchObject({ show: true });
        } finally { sess = undefined; }
    });
    test("存储挂住（永不返回）→ 最多等 STATE_RESTORE.maxWaitMs 后放行（测试里把该定时器缩到 20 ms）", async () => {
        persisted = { openByWin: { 77: true }, width: 300 }; getMode = "hang"; const realST = globalThis.setTimeout; (globalThis as any).setTimeout = (fn: Function, ms?: number, ...r: unknown[]) => realST(fn as () => void, ms === C.STATE_RESTORE.maxWaitMs ? 20 : ms, ...r);
        try { const { host } = await coldBoot(); expect(states(host)).toEqual([]); await wait(80); expect(states(host).length).toBeGreaterThan(0); } finally { (globalThis as any).setTimeout = realST; getMode = "ok"; }
    });
});

describe("C) 源码约束", () => {
    const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    const code = strip(readFileSync(resolve(DIR, "background.ts"), "utf8"));
    test("pushRec：未恢复（!memReady）且不带 hint 时不下发；restoreMem 在成功 / 失败 / 超时三处都调用，幂等", () => {
        expect(code).toMatch(/let memReady = false;/); expect(code).toMatch(/if \(!rec\.port \|\| \(!memReady && !hint\)\) return;/);
        expect(code).toMatch(/const restoreMem = \(\) => \{ if \(memReady\) return; memReady = true; pushAll\(\); \};/);
        expect(code).toMatch(/\}, \(\) => \{ restoreMem\(\); \}\);/); expect(code).toMatch(/later\(restoreMem, STATE_RESTORE\.maxWaitMs\);/); expect(code).toMatch(/restoreMem\(\);\n\s*\}, \(\) =>/);
    });
    test("恢复逻辑本身不变：只用「本次会话没动过的窗口」恢复意图；宽度只在没被调过时恢复", () => {
        expect(code).toMatch(/if \(!alive\.has\(k\) \|\| k in mem\.openByWin \|\| typeof saved\.openByWin\[k\] !== "boolean"\) continue;/); expect(code).toMatch(/mem\.openByWin\[\+k\] = saved\.openByWin\[k\];/); // rel62-intent-persist：true / false 都恢复（false = 用户在该窗口收起过） expect(code).toMatch(/if \(!widthTouched\) mem\.width = clampWidth\(saved\.width\);/);
        expect(C.STATE_RESTORE.maxWaitMs).toBeGreaterThan(0);
    });
});

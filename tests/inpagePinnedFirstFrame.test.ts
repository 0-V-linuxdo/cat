/* 补丁 pinned-first-frame：「常驻（pinned = 持久展开 show，不是 Chrome 固定标签）」时，原生 → 页内交接的第一帧就要是已推开的。
 * 根因（headed 实测，见 patches/pinned-first-frame/REPORT.md）：原生侧栏里点已开的收藏 → SW 发 close，但原生面板文档要 ≈350 ms 才断端口，
 * 之前页内「展开」状态（show / margin）一直等到端口断开才推给宿主；视口 ≈+40 ms 就变宽 → 目的标签先全宽（left=0）≈350 ms，再被 80 ms 动画挤到 228。
 * 修：close 一发就推 show:true + instant:true（交接窗口 handoff），SW 等目的标签「applied」回执后再激活（页面不再自己 tabs.update 抢跑，TabRow.focusOrOpen 走层 6 的 sidebarSwitchAck）。 */
import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { SIDEBAR_SWITCH_ACK, SIDEBAR_SWITCH_MSG } from "../src/api/HostMode";

const DIR = resolve(import.meta.dir, "../src/plugins/inpageSidebar");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const code = (f: string) => strip(readFileSync(resolve(DIR, f), "utf8"));

describe("补丁 pinned-first-frame：原生 → 页内交接（后台，chrome mock）", () => {
    const g = globalThis as Record<string, unknown>;
    const keep = { chrome: g.chrome, document: g.document };
    let realSettings: Record<string, unknown>;
    const prefs: Record<string, unknown> = { defaultMode: "inpage", showHandle: false, hoverReveal: false, prewarm: "off" };
    const L: Record<string, Function[]> = {}; const ev = (k: string) => ({ addListener: (f: Function) => { (L[k] ??= []).push(f); }, removeListener: (f: Function) => { L[k] = (L[k] ?? []).filter(x => x !== f); } });
    const calls: string[] = []; const urlOf: Record<number, { windowId: number; url: string }> = {};
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
    let BG: any; let closeFail = false;
    // 核心 SidePanelGesture 的 installed 标志是模块级的（别的测试文件先装在它们自己的 chrome mock 上）→ 这里用可控的假 open 集合代替 isPanelOpen / closePanel / openPanelInGesture
    let routerFn: ((tab: { id?: number; windowId?: number; url?: string }) => string) | undefined; // 假 SPG 捕获后台装的 ⌃S 路由
    const openSet = new Set<number>(); let realSPG: Record<string, unknown>; const SPG_PATH = resolve(DIR, "../../api/SidePanelGesture.ts");
    beforeAll(async () => {
        realSettings = { ...(await import("../src/plugins/inpageSidebar/settings")) };
        realSPG = { ...(await import("../src/api/SidePanelGesture")) };
        mock.module(SPG_PATH, () => ({
            ...realSPG, setGestureRouter: (fn: typeof routerFn) => { routerFn = fn; }, isPanelOpen: (w: number) => openSet.has(w),
            closePanel: (w: number) => { openSet.delete(w); return closeFail ? Promise.reject(new Error("close failed")) : chromeMock.sidePanel.close({ windowId: w }); },
            openPanelInGesture: (w: number, cb?: (ok: boolean) => void) => { void chromeMock.sidePanel.open({ windowId: w }).then(() => cb?.(true)); },
        }));
        delete g.document; g.chrome = chromeMock;
        mock.module(resolve(DIR, "settings.ts"), () => ({ settings: { store: prefs, def: {} } }));
        BG = await import(resolve(DIR, "background.ts") + "?pff");
        (globalThis as { pffCleanups?: unknown }).pffCleanups = BG.startBackground(); await wait();
    });
    afterAll(() => { for (const c of ((globalThis as { pffCleanups?: (() => void)[] }).pffCleanups ?? [])) { try { c(); } catch { /* 清理失败不影响其它文件 */ } } delete (globalThis as { pffCleanups?: unknown }).pffCleanups; mock.module(resolve(DIR, "settings.ts"), () => realSettings); mock.module(SPG_PATH, () => realSPG); mock.restore(); g.chrome = keep.chrome; if (keep.document !== undefined) g.document = keep.document; });
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
    const msg = (m: unknown, sender: unknown = { id: "x", url: NATIVE }) => { L.msg![0]!(m, sender, () => undefined); };
    const connectHost = async (tabId: number, w: number, url: string) => { const p = host(tabId, w, url); conn(p); hello(p); await wait(); return p; };
    const openNative = async (w: number) => { const p = mkPort(`panel:${w}`, { url: NATIVE }); conn(p); await wait(); return p; };
    const toggleInpage = async (tabId: number, w: number, url: string) => { L.menu![0]!({ menuItemId: "inpage-toggle-page" }, { id: tabId, windowId: w, url }); await wait(); };

    test("close 一发（原生端口还连着）→ 本窗口所有宿主（含还没激活的目的标签）立刻 show:true + instant:true、nativeOpen:false；别的窗口不受影响", async () => {
        const a = await connectHost(121, 8, "https://a.test/"), b = await connectHost(122, 8, "https://b.test/"), o = await connectHost(123, 9, "https://o.test/");
        L.act![0]!({ tabId: 121, windowId: 8 }); const panel = await openNative(8); expect(last(b)).toMatchObject({ show: false, nativeOpen: true });
        msg({ type: SIDEBAR_SWITCH_MSG, tabId: 122, url: "https://b.test/" }); await wait(); // 不带 activate 的老消息也一样
        expect(last(b)).toMatchObject({ active: false, show: true, nativeOpen: false, instant: true }); // 补丁前：show:false（等端口断开）
        expect(last(a)).toMatchObject({ show: true, nativeOpen: false, instant: true });
        expect(last(o)).not.toMatchObject({ show: true }); expect(last(o)).not.toHaveProperty("instant");
        panel.disconnect(); await wait();
        expect(last(b)).toMatchObject({ show: true, nativeOpen: false }); expect(last(b)).not.toHaveProperty("instant"); // 交接结束
        await toggleInpage(121, 8, "https://a.test/"); expect(last(b)).toMatchObject({ show: false }); // 交接态没有卡住：之后的收起照常
        expect(last(b)).not.toHaveProperty("instant");
    });
    test("activate:true：SW 等目的标签的 applied 回执才 tabs.update；超时（HANDOFF_ACK_MS）没回执也照样激活；别的标签的回执不算", async () => {
        const a = await connectHost(131, 8, "https://a.test/"), b = await connectHost(132, 8, "https://b.test/");
        L.act![0]!({ tabId: 131, windowId: 8 }); let panel = await openNative(8); calls.length = 0;
        L.msg![0]!({ type: SIDEBAR_SWITCH_MSG, tabId: 132, url: "https://b.test/", activate: true }, { id: "x", url: NATIVE }, () => undefined);
        await wait(); expect(calls).toEqual(["close:8"]); // close 完成了，但目的标签还没摆好：不激活
        a.say({ type: "applied" }); await wait(); expect(calls).toEqual(["close:8"]); // 别的标签（131）的回执不算
        b.say({ type: "applied" }); await wait(); expect(calls).toEqual(["close:8", "update:132"]);
        panel.disconnect(); await wait(); L.act![0]!({ tabId: 132, windowId: 8 }); await wait(); await toggleInpage(131, 8, "https://a.test/");
        // 无回执：超时兜底（端口死 / 状态没变没下发）
        panel = await openNative(8); calls.length = 0;
        L.msg![0]!({ type: SIDEBAR_SWITCH_MSG, tabId: 131, url: "https://a.test/", activate: true }, { id: "x", url: NATIVE }, () => undefined);
        await wait(40); expect(calls).toEqual(["close:8"]); await wait(200); expect(calls).toEqual(["close:8", "update:131"]);
        panel.disconnect(); await wait(); L.act![0]!({ tabId: 131, windowId: 8 }); await wait(); await toggleInpage(131, 8, "https://a.test/");
    });
    test("close 失败（原生没关掉）→ 撤回交接：宿主回到 show:false / nativeOpen 状态，不留「页内已展开 + 原生还在」", async () => {
        const a = await connectHost(141, 8, "https://a.test/"), b = await connectHost(142, 8, "https://b.test/");
        L.act![0]!({ tabId: 141, windowId: 8 }); const panel = await openNative(8);
        closeFail = true; try { msg({ type: SIDEBAR_SWITCH_MSG, tabId: 142, url: "https://b.test/" }); await wait(); } finally { closeFail = false; }
        expect(last(b)).toMatchObject({ show: false }); expect(last(b)).not.toHaveProperty("instant"); expect(last(a)).toMatchObject({ show: false });
        panel.disconnect(); await wait();
    });
    test("窗口关掉 → 交接态清除（不残留在 handoff 里影响后面复用同 id 的窗口）", async () => {
        const a = await connectHost(151, 10, "https://a.test/"), b = await connectHost(152, 10, "https://b.test/");
        L.act![0]!({ tabId: 151, windowId: 10 }); await openNative(10);
        msg({ type: SIDEBAR_SWITCH_MSG, tabId: 152, url: "https://b.test/" }); await wait(); expect(last(b)).toMatchObject({ show: true, instant: true });
        L.wrem![0]!(10); // 窗口关了（端口没来得及断）
        const c = await connectHost(153, 10, "https://c.test/"); expect(last(c)).toMatchObject({ show: false }); expect(last(c)).not.toHaveProperty("instant");
        expect(a.sent.length).toBeGreaterThan(0);
    });
});

describe("补丁 pinned-first-frame：内容脚本 / TabRow（源码约束 + 行为）", () => {
    const ct = code("content.ts"), bg = code("background.ts"), tr = strip(readFileSync(resolve(import.meta.dir, "../src/components/TabRow.ts"), "utf8"));
    test("content：instant 状态不播推开动画，且只有 instant 才回 applied（普通状态不多发消息）", () => {
        expect(ct).toMatch(/const first = !!m\.instant \|\| isFirstPlacement\(/); expect(ct).toMatch(/st = m; realSeen = true; render\(first\);/);
        expect((ct.match(/type: "applied"/g) ?? []).length).toBe(1); expect(ct).toMatch(/if \(m\.instant\) send\(\{ type: "applied" \}\)/);
    });
    test("background：facts 的意图含 handoff；state 只在交接窗口带 instant；清除点 = nativeChanged（端口真断）/ onWinRemoved / close 失败 / cleanup；没有新增常驻定时器（只有激活前一次性 later）", () => {
        expect(bg).toMatch(/intent: intentOf\(w\) \|\| handoff\.has\(w\)/); expect(bg).toMatch(/\.\.\.\(handoff\.has\(rec\.windowId\) \? \{ instant: true as const \} : \{\}\)/);
        expect(bg).toMatch(/if \(!panelAlive\(w\) && !isPanelOpen\(w\) && !pendingWin\.has\(w\)\) handoff\.delete\(w\)/);
        expect(bg).toMatch(/const onWinRemoved = \(w: number\) => \{ handoff\.delete\(w\);/); expect(bg).toMatch(/if \(handoff\.delete\(w\)\) pushWindow\(w\)/); expect(bg).toMatch(/handoff\.clear\(\); handoffAck\.clear\(\);/);
        expect((bg.match(/setInterval/g) ?? []).length).toBe(1); // 只有既有的 heartbeat（预热关时不转）；本补丁不加常驻定时器
        expect(bg).not.toMatch(/show: false[^;]*memReady/); // 不在 memReady 前写 show:false（层 14）
    });
    test("TabRow.focusOrOpen：已开标签先走 sidebarSwitchAck（层 6），SW 接管就不再自己 tabs.update；没接管照老路", async () => {
        expect(tr).toMatch(/if \(tabId != null\) \{ const sw = sidebarSwitchAck\(url, "activate", tabId\); if \(sw && await sw\) return tabId; \}/);
        const { focusOrOpen } = await import("../src/components/TabRow"); const { setSidebarSwitchEnabled } = await import("../src/api/HostMode");
        const g = globalThis as Record<string, any>; const keep = g.chrome; const upd: number[] = [];
        const mk = (r: unknown) => { g.chrome = { runtime: { sendMessage: async () => r }, tabs: { get: async (id: number) => ({ id, windowId: 3 }), update: async (id: number) => { upd.push(id); }, create: async () => ({ id: 99 }) }, windows: { update: async () => undefined } }; };
        try {
            setSidebarSwitchEnabled(true);
            mk({ type: SIDEBAR_SWITCH_ACK, handled: true }); expect(await focusOrOpen(9, "https://a.com/")).toBe(9); expect(upd).toEqual([]); // 补丁前：页面自己 tabs.update（和 SW 抢跑）
            mk({ type: SIDEBAR_SWITCH_ACK, handled: false }); expect(await focusOrOpen(9, "https://a.com/")).toBe(9); expect(upd).toEqual([9]);
            setSidebarSwitchEnabled(false); upd.length = 0; mk(undefined); expect(await focusOrOpen(9, "https://a.com/")).toBe(9); expect(upd).toEqual([9]);
        } finally { setSidebarSwitchEnabled(false); g.chrome = keep; }
    });
});

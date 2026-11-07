/* 补丁 inpage-discarded-tab：点「休眠的（discarded）标签」后侧栏停在 / 变成 Chrome 原生侧边栏（rel53，0.1.0.53721 用户报告）。
 * 静态结论（见补丁 README）：Off 下点休眠标签在代码里没有任何会开原生的路径；原生 → 页内（switch-auto 层 6）对「没有宿主记录的标签」有一个洞：
 * sidebarSwitchSync 返回 handled:false 后页面自己激活，但没有任何地方登记「等它的内容脚本握手再切回页内」（页面端走了 sidebarSwitchAck 就不会再发老的异步消息），
 * 休眠标签重载后握手也没人接 → 原生一直留着。本文件用后台控制器的 chrome mock 复现并锁定修法。真机（是否真的发生 / 握手是否在 3 s 内）要 headed：见 shots/。 */
import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { destinationNeedsNative, ensureNativeMsg, SIDEBAR_SWITCH_ACK, SIDEBAR_SWITCH_MSG } from "../src/api/HostMode";

const DIR = resolve(import.meta.dir, "../src/plugins/inpageSidebar");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("休眠标签：页内 → 不会要求开原生（Off / 页内上下文的消息层）", () => {
    const IFRAME = "?host=inpage&win=7&tab=2";
    test("激活已有标签时目的地 url 为空串 / undefined（休眠或未提交的标签）= 未知，不发 ensure-native；真实 http(s) 也不发", () => {
        for (const u of ["", undefined, null, "https://sleep.test/a"]) { expect(destinationNeedsNative(u, "activate")).toBe(false); expect(ensureNativeMsg(u, "activate", 5, IFRAME)).toBeUndefined(); }
    });
    test("对照：目的地是受限页才发（这才是页内 → 原生的设计触发）", () => {
        for (const u of ["chrome://settings", "about:blank", "chrome-extension://x/a.html"]) expect(ensureNativeMsg(u, "activate", 5, IFRAME)).toMatchObject({ kind: "activate", tabId: 5 });
    });
});

describe("后台控制器（chrome mock）：休眠标签：原生 → 页内", () => {
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
        storage: { local: { get: async () => ({}), set: async () => undefined }, onChanged: ev("sc") },
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
        BG = await import(resolve(DIR, "background.ts") + "?disc");
        (globalThis as { discCleanups?: unknown }).discCleanups = BG.startBackground(); await wait();
    });
    afterAll(() => { for (const c of ((globalThis as { discCleanups?: (() => void)[] }).discCleanups ?? [])) { try { c(); } catch { /* 清理失败不影响其它文件 */ } } delete (globalThis as { discCleanups?: unknown }).discCleanups; mock.module(resolve(DIR, "settings.ts"), () => realSettings); mock.module(SPG_PATH, () => realSPG); mock.restore(); g.chrome = keep.chrome; if (keep.document !== undefined) g.document = keep.document; });
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
    const toggleInpage = async (tabId: number, w: number, url: string) => { L.menu![0]!({ menuItemId: "inpage-toggle-page" }, { id: tabId, windowId: w, url }); await wait(); };
    const ask = (m: object): any => { let r: any; L.msg![0]!({ type: SIDEBAR_SWITCH_MSG, activate: true, ...m }, { id: "x", url: NATIVE }, (x: unknown) => { r = x; }); return r; };
    const realNow = Date.now;
    afterEach(() => { Date.now = realNow; });

    test("【复现 A】原生（用户开的）在显示；点从没握手过的休眠标签：handled:false（页面自己激活），休眠标签重载、内容脚本 hello 后必须把原生切回页内（修前：原生一直留着）", async () => {
        const a = await connectHost(81, 20, "https://a.test/"); L.act![0]!({ tabId: 81, windowId: 20 });
        const panel = await openNative(20); calls.length = 0;
        urlOf[82] = { windowId: 20, url: "https://sleep.test/" }; // 休眠：有 url，但 SW 没有它的宿主记录
        expect(ask({ tabId: 82, url: "https://sleep.test/" })).toEqual({ type: SIDEBAR_SWITCH_ACK, handled: false });
        await wait(); expect(calls).toEqual([]); // 此刻还不能切（宿主不在，切了页内出不来）
        L.act![0]!({ tabId: 82, windowId: 20 }); await wait(); expect(calls).toEqual([]); // 页面 tabs.update → onActivated：用户自己开的原生无 marker，到达路径不动
        const late = host(82, 20, "https://sleep.test/"); conn(late); hello(late); await wait(); // 休眠标签重载 → 内容脚本握手
        expect(calls).toEqual(["close:20"]); panel.disconnect(); await wait();
        expect(last(late)).toMatchObject({ active: true, show: true, nativeOpen: false }); expect(last(a)).toMatchObject({ show: true });
        await toggleInpage(82, 20, "https://sleep.test/");
    });
    test("A 的边界：等宿主最多 hostWaitMs（3000 ms）；超时后才握手 = 放弃，原生保留（同补丁前的老行为，⚠ 休眠标签冷加载超过 3 s 的真机比例未测）", async () => {
        await connectHost(83, 21, "https://a.test/"); L.act![0]!({ tabId: 83, windowId: 21 });
        const panel = await openNative(21); calls.length = 0;
        urlOf[84] = { windowId: 21, url: "https://slow.test/" };
        expect(ask({ tabId: 84, url: "https://slow.test/" })).toEqual({ type: SIDEBAR_SWITCH_ACK, handled: false }); await wait();
        Date.now = () => realNow() + 3500;
        const late = host(84, 21, "https://slow.test/"); conn(late); hello(late); await wait(); expect(calls).toEqual([]);
        Date.now = realNow; panel.disconnect(); await wait();
    });
    test("对照（修前修后都通过）：有宿主记录、只是端口断了的休眠标签（之前握手过）→ wait-host，hello 后切回页内", async () => {
        await connectHost(85, 22, "https://a.test/"); L.act![0]!({ tabId: 85, windowId: 22 });
        const old = await connectHost(86, 22, "https://b.test/"); old.disconnect(); // 被丢弃：内容脚本没了
        const panel = await openNative(22); calls.length = 0;
        expect(ask({ tabId: 86, url: "https://b.test/" })).toEqual({ type: SIDEBAR_SWITCH_ACK, handled: false }); await wait(); expect(calls).toEqual([]);
        const again = host(86, 22, "https://b.test/"); conn(again); hello(again); await wait(); expect(calls).toEqual(["close:22"]);
        panel.disconnect(); await wait(); await toggleInpage(86, 22, "https://b.test/");
    });
    test("【复现 B】休眠 / 未提交标签的 url 是空串、pendingUrl 才有真实地址：不能因 url 空串被当成受限页（修前 `t.url ?? m.url` 取到空串 → no-url → restricted → 不等宿主）", async () => {
        await connectHost(87, 23, "https://a.test/"); L.act![0]!({ tabId: 87, windowId: 23 });
        const panel = await openNative(23); calls.length = 0;
        urlOf[88] = { windowId: 23, url: "", pendingUrl: "https://pending.test/" };
        L.msg![0]!({ type: SIDEBAR_SWITCH_MSG, tabId: 88 }, { id: "x", url: NATIVE }, () => undefined); await wait(); expect(calls).toEqual([]); // 老的异步路径（不带 activate、不带 url）
        const late = host(88, 23, "https://pending.test/"); conn(late); hello(late); await wait(); expect(calls).toEqual(["close:23"]);
        panel.disconnect(); await wait(); await toggleInpage(88, 23, "https://pending.test/");
    });
    test("Off / 页内显示中（原生没开）：点休眠标签 → 后台什么都不做（不 open、不 close、不 setOptions）——Off 下 SW 侧没有翻原生的路径", async () => {
        const a = await connectHost(89, 24, "https://a.test/"); L.act![0]!({ tabId: 89, windowId: 24 }); await toggleInpage(89, 24, "https://a.test/"); // 页内显示中
        calls.length = 0; urlOf[90] = { windowId: 24, url: "https://sleep2.test/" };
        expect(ask({ tabId: 90, url: "https://sleep2.test/" })).toEqual({ type: SIDEBAR_SWITCH_ACK, handled: false });
        L.act![0]!({ tabId: 90, windowId: 24 }); await wait();
        const late = host(90, 24, "https://sleep2.test/"); conn(late); hello(late); await wait();
        expect(calls).toEqual([]); expect(last(late)).toMatchObject({ nativeOpen: false }); expect(last(a)).toBeDefined();
        await toggleInpage(90, 24, "https://sleep2.test/");
    });
});

describe("源码约束（补丁 inpage-discarded-tab）", () => {
    const bg = strip(readFileSync(resolve(DIR, "background.ts"), "utf8"));
    test("sidebarSwitchSync 在「没有宿主记录」分支自己起异步 sidebarSwitch（登记 wait-host），并仍返回 false（不接管）", () => {
        expect(bg).toMatch(/const sidebarSwitchSync[\s\S]*?if \(!rec\) \{ sidebarSwitch\(m\); return false; \}/);
    });
    test("tabs.get 取 url 一律 url || pendingUrl（空串不是未知）；不再有 `t.url ?? m.url` / 单用 `t.url, true`", () => {
        expect(bg).not.toMatch(/t\.url \?\? m\.url/);
        expect(bg).toMatch(/t\.url \|\| t\.pendingUrl \|\| m\.url/); expect(bg).toMatch(/t\.url \|\| t\.pendingUrl, true/);
    });
});

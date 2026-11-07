/* 补丁 inpage-switch-auto：侧栏形态跟着「通过侧栏切标签」自动切。
 * 方向：页内 → 受限页 = 既有 ensure-native（手势里同步 open，先切后进）；原生 → 普通页 = 本补丁（不需要手势，只 close，由后台判定）。
 * 这里能验证的：纯决策表、消息契约（HostMode）、后台控制器（chrome mock，无 Chrome）、源码约束。真实观感（是否闪、到达前是否已切）要 headed：见 shots/measure-switch-auto.ts，这里不声称。 */
import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
    ensureNativeAck, ENSURE_NATIVE_MSG, navigateAfterNative, senderIsInpageContext, SIDEBAR_SWITCH_ACK, SIDEBAR_SWITCH_MSG, setSidebarSwitchEnabled, sidebarSwitchEnabled, sidebarSwitchMsg,
} from "../src/api/HostMode";
import { AUTO_SWITCH } from "../src/plugins/inpageSidebar/constants";
import { arrivedDuringOpen, decideSidebarSwitch, hostWaitValid, type SwitchFacts } from "../src/plugins/inpageSidebar/switchAuto";

const DIR = resolve(import.meta.dir, "../src/plugins/inpageSidebar");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const code = (f: string) => strip(readFileSync(resolve(DIR, f), "utf8"));

const F: SwitchFacts = { enabled: true, requireMarked: false, restoreMarked: false, nativeOpen: true, defaultMode: "inpage", targetKind: "ok", targetHostAlive: true, targetBlocked: false };

describe("decideSidebarSwitch（纯决策表）", () => {
    test("原生在显示 + 目的标签是可页内显示的普通页且宿主活着 → to-inpage", () => { expect(decideSidebarSwitch(F)).toEqual({ act: "to-inpage" }); });
    test("目的标签宿主还没握手（刚加载 / 被丢弃重载）→ wait-host，不是 to-inpage（切了页内又出不来 = 一个侧栏都没有）", () => { expect(decideSidebarSwitch({ ...F, targetHostAlive: false })).toEqual({ act: "wait-host" }); });
    test("各个「不动」的理由，按顺序", () => {
        const keep = (o: Partial<SwitchFacts>) => decideSidebarSwitch({ ...F, ...o });
        expect(keep({ enabled: false })).toEqual({ act: "keep", why: "disabled" });
        expect(keep({ defaultMode: "native" })).toEqual({ act: "keep", why: "default-native" });
        expect(keep({ nativeOpen: false })).toEqual({ act: "keep", why: "not-native" }); // 页内本来就在 / 什么都没开：原生 → 页内无从谈起
        for (const k of ["no-url", "scheme", "webstore", "pdf"] as const) expect(keep({ targetKind: k })).toEqual({ act: "keep", why: "restricted" }); // 受限页：留在原生
        expect(keep({ targetBlocked: true })).toEqual({ act: "keep", why: "blocked" }); // 页面禁止被嵌入（frame-ancestors 等）：页内显示不出来
        expect(keep({ targetKind: "scheme", targetHostAlive: false })).toEqual({ act: "keep", why: "restricted" }); // 受限页永远没有宿主：不等
    });
    test("到达路径（requireMarked）：只有「原生是我们为进受限页而开的」才切；用户自己开的原生不动；侧栏行点击不看标记", () => {
        expect(decideSidebarSwitch({ ...F, requireMarked: true, restoreMarked: false })).toEqual({ act: "keep", why: "not-marked" });
        expect(decideSidebarSwitch({ ...F, requireMarked: true, restoreMarked: true })).toEqual({ act: "to-inpage" });
        expect(decideSidebarSwitch({ ...F, requireMarked: false, restoreMarked: false })).toEqual({ act: "to-inpage" });
    });
    test("hostWaitValid：未到期有效；过期 / 没有 = 无效", () => {
        const w = { windowId: 1, until: 1000, requireMarked: false };
        expect(hostWaitValid(w, 1000)).toBe(true); expect(hostWaitValid(w, 1001)).toBe(false); expect(hostWaitValid(undefined, 0)).toBe(false);
    });
    test("常量：默认两条路径都开；等宿主 3000 ms", () => { expect(AUTO_SWITCH).toEqual({ viaSidebar: true, onArrive: true, hostWaitMs: 3000 }); });
});

describe("HostMode：sidebarSwitchMsg / ensureNativeAck 的消息契约", () => {
    const g = globalThis as { chrome?: unknown }; const oldChrome = g.chrome;
    afterEach(() => { g.chrome = oldChrome; setSidebarSwitchEnabled(false); });
    const IFRAME = "?host=inpage&win=7&tab=2", VIA = "?popup=commandBar&win=7&via=inpage";
    const sent: unknown[] = [];
    const mk = (reply?: unknown) => { sent.length = 0; g.chrome = { runtime: { sendMessage: (m: unknown) => { sent.push(m); return Promise.resolve(reply); } } }; };

    test("开关默认关（插件没启用 / 页内上下文 = 一条消息都不发）", () => {
        expect(sidebarSwitchEnabled()).toBe(false); expect(sidebarSwitchMsg("https://a.com", "activate", 5, "")).toBeUndefined();
        mk(); expect(ensureNativeAck("https://a.com", "activate", 5, { search: "" })).toBeUndefined(); expect(sent).toEqual([]);
    });
    test("纯函数：只发「激活已有标签 + 目的地不是受限页」；页内 iframe / via=inpage 弹窗不发；kind=create/navigate 不发；url 未知照发（后台判）", () => {
        const on = true;
        expect(sidebarSwitchMsg("https://a.com/x", "activate", 5, "", on)).toEqual({ type: SIDEBAR_SWITCH_MSG, tabId: 5, url: "https://a.com/x" });
        expect(sidebarSwitchMsg(undefined, "activate", 5, "", on)).toEqual({ type: SIDEBAR_SWITCH_MSG, tabId: 5 });
        expect(sidebarSwitchMsg("https://a.com", "activate", 5, IFRAME, on)).toBeUndefined();
        expect(sidebarSwitchMsg("https://a.com", "activate", 5, VIA, on)).toBeUndefined();
        expect(sidebarSwitchMsg("https://a.com", "create", undefined, "", on)).toBeUndefined();
        expect(sidebarSwitchMsg("https://a.com", "navigate", 5, "", on)).toBeUndefined();
        expect(sidebarSwitchMsg("https://a.com", "activate", undefined, "", on)).toBeUndefined();
        for (const u of ["chrome://settings", "chrome-extension://x/options.html", "about:blank", "https://chromewebstore.google.com/detail/x", "https://a.com/f.pdf"]) expect(sidebarSwitchMsg(u, "activate", 5, "", on)).toBeUndefined(); // 受限页：留在原生
    });
    test("开关开（原生侧栏）：ensureNativeAck 对普通页的激活仍发 fire-and-forget 的 sidebar-switch、返回 undefined（别的直接调用方不变）；层 6：navigateAfterNative 改发带 activate:true 的消息并等 ack", async () => {
        mk(); setSidebarSwitchEnabled(true);
        expect(ensureNativeAck("https://a.com/", "activate", 9, { search: "" })).toBeUndefined();
        expect(sent).toEqual([{ type: SIDEBAR_SWITCH_MSG, tabId: 9, url: "https://a.com/" }]);
        mk(); const log: string[] = [];
        const r = navigateAfterNative("https://a.com/", "activate", 9, () => { log.push("go"); return 1; }, { search: "" });
        expect(r).toBeInstanceOf(Promise); expect(log).toEqual([]); // 等 ack 之前不激活
        expect(sent).toEqual([{ type: SIDEBAR_SWITCH_MSG, tabId: 9, url: "https://a.com/", activate: true }]);
        expect(await r).toBe(1); expect(log).toEqual(["go"]); // ack 不是 handled:true（这里 mock 回 undefined）→ 页面照老路自己激活
    });
    test("层 6：SW 回 handled:true = SW 接管激活，页面不再 go()；handled:false / 发送失败 = 页面自己激活；受限页 / 页内上下文 / 开关关 = 老路（无 Promise）", async () => {
        setSidebarSwitchEnabled(true); const log: string[] = [];
        mk({ type: SIDEBAR_SWITCH_ACK, handled: true });
        await navigateAfterNative("https://a.com/", "activate", 9, () => { log.push("go"); }, { search: "" }); expect(log).toEqual([]);
        mk({ type: SIDEBAR_SWITCH_ACK, handled: false });
        await navigateAfterNative("https://a.com/", "activate", 9, () => { log.push("go"); }, { search: "" }); expect(log).toEqual(["go"]);
        g.chrome = { runtime: { sendMessage: () => Promise.reject(new Error("gone")) } };
        await navigateAfterNative("https://a.com/", "activate", 9, () => { log.push("go2"); }, { search: "" }); expect(log).toEqual(["go", "go2"]);
        mk({ type: SIDEBAR_SWITCH_ACK, handled: true }); log.length = 0;
        expect(navigateAfterNative("chrome://settings", "activate", 9, () => { log.push("r"); return 5; }, { search: "" })).toBe(5);
        expect(navigateAfterNative("https://a.com/", "activate", 9, () => 6, { search: IFRAME })).not.toBeInstanceOf(Promise);
        setSidebarSwitchEnabled(false); expect(navigateAfterNative("https://a.com/", "activate", 9, () => 7, { search: "" })).toBe(7); expect(sent).toEqual([]);
    });
    test("开关开 + 原生里点到受限页：不发 sidebar-switch（留在原生），也不发 ensure-native（本来就是原生）", () => {
        mk(); setSidebarSwitchEnabled(true);
        expect(ensureNativeAck("chrome://settings", "activate", 9, { search: "" })).toBeUndefined(); expect(sent).toEqual([]);
    });
    test("页内 iframe 点到受限页：仍是 ensure-native（等 ack），不发 sidebar-switch；点到普通页：什么都不发（页内保持）", async () => {
        mk(); setSidebarSwitchEnabled(true);
        const p = ensureNativeAck("chrome://history", "activate", 9, { search: IFRAME, ackMs: 5 }); expect(p).toBeInstanceOf(Promise); await p;
        expect(sent).toEqual([{ type: ENSURE_NATIVE_MSG, kind: "activate", url: "chrome://history", tabId: 9, windowId: 7 }]);
        mk(); expect(ensureNativeAck("https://a.com", "activate", 9, { search: IFRAME })).toBeUndefined(); expect(sent).toEqual([]);
    });
    test("发送失败（上下文失效 / 同步抛）不外泄、不阻塞", () => {
        setSidebarSwitchEnabled(true);
        g.chrome = { runtime: { sendMessage: () => { throw new Error("Extension context invalidated."); } } };
        expect(() => ensureNativeAck("https://a.com", "activate", 9, { search: "" })).not.toThrow();
        g.chrome = { runtime: { sendMessage: () => Promise.reject(new Error("Receiving end does not exist.")) } };
        expect(() => ensureNativeAck("https://a.com", "activate", 9, { search: "" })).not.toThrow();
        g.chrome = {}; expect(ensureNativeAck("https://a.com", "activate", 9, { search: "" })).toBeUndefined();
    });
    test("senderIsInpageContext：iframe / via=inpage 弹窗 = true；原生侧栏 / 普通弹窗 / 空 = false", () => {
        expect(senderIsInpageContext("chrome-extension://x/sidepanel.html?host=inpage&win=1&tab=2")).toBe(true);
        expect(senderIsInpageContext("chrome-extension://x/sidepanel.html?popup=commandBar&win=1&via=inpage")).toBe(true);
        expect(senderIsInpageContext("chrome-extension://x/sidepanel.html")).toBe(false);
        expect(senderIsInpageContext("chrome-extension://x/sidepanel.html?popup=commandBar&win=1")).toBe(false);
        expect(senderIsInpageContext(undefined)).toBe(false); expect(senderIsInpageContext("not a url")).toBe(false);
    });
});

describe("后台控制器（chrome mock）：原生 → 页内", () => {
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
        windows: { onRemoved: ev("wrem"), onFocusChanged: ev("foc"), getAll: async () => [{ id: 8 }, { id: 9 }, { id: 10 }, { id: 11 }, { id: 12 }, { id: 13 }, { id: 14 }, { id: 15 }], getLastFocused: async () => ({ id: 8 }), WINDOW_ID_NONE: -1 },
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
        BG = await import(resolve(DIR, "background.ts") + "?switchauto");
        (globalThis as { swaCleanups?: unknown }).swaCleanups = BG.startBackground(); await wait();
    });
    afterAll(() => { for (const c of ((globalThis as { swaCleanups?: (() => void)[] }).swaCleanups ?? [])) { try { c(); } catch { /* 清理失败不影响其它文件 */ } } delete (globalThis as { swaCleanups?: unknown }).swaCleanups; mock.module(resolve(DIR, "settings.ts"), () => realSettings); mock.module(SPG_PATH, () => realSPG); mock.restore(); g.chrome = keep.chrome; if (keep.document !== undefined) g.document = keep.document; });
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

    test("原生在显示（用户开的）→ 在原生侧栏点普通页标签：同步路径只 close（不 open、不 setOptions）；面板端口断开后页内意图恢复，所有标签（含非活动）show:true、nativeOpen:false", async () => {
        const a = await connectHost(21, 8, "https://a.test/"), b = await connectHost(22, 8, "https://b.test/");
        L.act![0]!({ tabId: 21, windowId: 8 });
        const panel = await openNative(8); expect(last(a)).toMatchObject({ show: false, nativeOpen: true });
        calls.length = 0;
        msg({ type: SIDEBAR_SWITCH_MSG, tabId: 22, url: "https://b.test/" }); await wait();
        expect(calls).toEqual(["close:8"]); expect(last(b)).toMatchObject({ show: true, nativeOpen: false, instant: true }); // 补丁 pinned-first-frame：原生端口还连着也立刻把「已展开」推给所有宿主（补丁前：show:false，要等端口断开 ≈350 ms）；真正的意图仍等端口断开后恢复
        panel.disconnect(); await wait();
        expect(last(b)).toMatchObject({ active: false, show: true, nativeOpen: false }); expect(last(b)).not.toHaveProperty("instant"); // 目的标签（尚未激活）已展开；交接结束：状态不再带 instant：到达时无需再动画（tab-switch 的 show 与 active 无关）
        L.act![0]!({ tabId: 22, windowId: 8 }); await wait(); expect(calls).toEqual(["close:8"]); // 随后 tabs.update 的 onActivated 到达：不会重复 close（marker 已随恢复清掉）
        expect(last(a)).toMatchObject({ active: false, show: true }); expect(last(b)).toMatchObject({ active: true, show: true });
        expect(calls.filter(c => c.startsWith("open") || c.startsWith("setOptions"))).toEqual([]);
        await toggleInpage(21, 8, "https://a.test/"); // 清理：收起
    });
    test("层 6：activate:true（原生行点击）→ SW 同步 close 原生，**close 完成之后**由 SW 自己 tabs.update 激活目标；同步 ack handled:true；端口断开后恢复页内", async () => {
        const a = await connectHost(61, 8, "https://a.test/"), b = await connectHost(62, 8, "https://b.test/");
        L.act![0]!({ tabId: 61, windowId: 8 }); const panel = await openNative(8); calls.length = 0;
        let resp: any; L.msg![0]!({ type: SIDEBAR_SWITCH_MSG, tabId: 62, url: "https://b.test/", activate: true }, { id: "x", url: NATIVE }, (r: unknown) => { resp = r; });
        expect(resp).toEqual({ type: SIDEBAR_SWITCH_ACK, handled: true }); // 同步（回调在监听返回前已调）
        expect(calls).toEqual(["close:8"]); // 同一调用栈：只有 close，激活还没发（要等 close 完成）
        await wait(); expect(calls).toEqual(["close:8"]); // 补丁 pinned-first-frame：close 完成后还要等目的标签回执（按「已展开」摆好）才激活
        b.say({ type: "applied" }); await wait(); expect(calls).toEqual(["close:8", "update:62"]); // close 之后才激活，且是 SW 自己发的
        panel.disconnect(); await wait(); expect(last(b)).toMatchObject({ show: true, nativeOpen: false });
        L.act![0]!({ tabId: 62, windowId: 8 }); await wait(); expect(calls).toEqual(["close:8", "update:62"]); expect(last(a)).toMatchObject({ show: true });
        await toggleInpage(61, 8, "https://a.test/");
    });
    test("层 6：activate:true 但 SW 不接管（没有宿主记录 / 目的是受限页 / 原生没在显示）→ handled:false，不 close、不激活（页面照老路自己激活）", async () => {
        const a = await connectHost(71, 8, "https://a.test/"); L.act![0]!({ tabId: 71, windowId: 8 }); const panel = await openNative(8); calls.length = 0;
        const ask = (m: object): any => { let r: any; L.msg![0]!({ type: SIDEBAR_SWITCH_MSG, activate: true, ...m }, { id: "x", url: NATIVE }, (x: unknown) => { r = x; }); return r; };
        expect(ask({ tabId: 79, url: "https://c.test/" })).toEqual({ type: SIDEBAR_SWITCH_ACK, handled: false }); // 79 没握手过
        await connectHost(72, 8, "chrome://settings"); expect(ask({ tabId: 72, url: "chrome://settings" })).toEqual({ type: SIDEBAR_SWITCH_ACK, handled: false });
        await wait(); expect(calls).toEqual([]);
        panel.disconnect(); await wait();
        await connectHost(73, 8, "https://d.test/"); calls.length = 0; // 原生已关：not-native
        expect(ask({ tabId: 73, url: "https://d.test/" })).toEqual({ type: SIDEBAR_SWITCH_ACK, handled: false }); await wait(); expect(calls).toEqual([]);
        expect(last(a)).toBeDefined(); await toggleInpage(71, 8, "https://a.test/");
    });
    test("用 tabs.get 查窗口：目的标签没有宿主记录 → 先查 url / windowId，宿主握手（hello）后才切（wait-host）；超时作废", async () => {
        const a = await connectHost(31, 9, "https://a.test/"); L.act![0]!({ tabId: 31, windowId: 9 });
        const panel = await openNative(9); calls.length = 0;
        urlOf[32] = { windowId: 9, url: "https://late.test/" };
        msg({ type: SIDEBAR_SWITCH_MSG, tabId: 32 }); await wait(); expect(calls).toEqual([]); // 宿主还没握手：等
        const late = host(32, 9, "https://late.test/"); conn(late); hello(late); await wait();
        expect(calls).toEqual(["close:9"]); panel.disconnect(); await wait(); expect(last(late)).toMatchObject({ show: true }); expect(last(a)).toMatchObject({ show: true });
        await toggleInpage(31, 9, "https://a.test/");
    });
    test("不该切的：受限页 url / 页面禁止嵌入 / 默认方式=原生 / 页内本来就在显示 / 发送者不是本扩展 / 页内 iframe 发的 / tabId 非整数 → 都不 close", async () => {
        const a = await connectHost(41, 10, "https://a.test/"), blocked = await connectHost(42, 10, "https://noembed.test/"); hello(blocked, "blocked"); await wait();
        L.act![0]!({ tabId: 41, windowId: 10 }); const panel = await openNative(10); calls.length = 0;
        urlOf[43] = { windowId: 10, url: "chrome://settings" };
        msg({ type: SIDEBAR_SWITCH_MSG, tabId: 43, url: "chrome://settings" }); msg({ type: SIDEBAR_SWITCH_MSG, tabId: 43 }); // 受限页（URL 给了 / 没给）
        msg({ type: SIDEBAR_SWITCH_MSG, tabId: 42, url: "https://noembed.test/" });
        msg({ type: SIDEBAR_SWITCH_MSG, tabId: 41, url: "https://a.test/" }, { id: "evil", url: NATIVE });
        msg({ type: SIDEBAR_SWITCH_MSG, tabId: 41, url: "https://a.test/" }, { id: "x", url: NATIVE + "?host=inpage&win=10&tab=41", tab: { id: 41, windowId: 10 } });
        msg({ type: SIDEBAR_SWITCH_MSG, tabId: 1.5 }); msg({ type: SIDEBAR_SWITCH_MSG });
        prefs.defaultMode = "native"; msg({ type: SIDEBAR_SWITCH_MSG, tabId: 41, url: "https://a.test/" }); prefs.defaultMode = "inpage";
        await wait(); expect(calls).toEqual([]);
        panel.disconnect(); await wait();
        calls.length = 0; await toggleInpage(41, 10, "https://a.test/"); // 页内显示中（intent 开、原生没开）
        msg({ type: SIDEBAR_SWITCH_MSG, tabId: 41, url: "https://a.test/" }); await wait(); expect(calls).toEqual([]);
        await toggleInpage(41, 10, "https://a.test/"); expect(last(a)).toMatchObject({ show: false });
    });
    test("页内 → 受限页（既有 ensure-native）→ 浏览器 UI / 侧栏回到普通页：原生是我们开的（marker）→ 到达（onActivated）时关原生、恢复页内；没有手势也能做（只 close）", async () => {
        const a = await connectHost(51, 11, "https://a.test/"), b = await connectHost(52, 11, "https://b.test/");
        L.act![0]!({ tabId: 51, windowId: 11 }); await toggleInpage(51, 11, "https://a.test/"); expect(last(b)).toMatchObject({ show: true });
        calls.length = 0;
        const IFR = { id: "x", url: NATIVE + "?host=inpage&win=11&tab=51", tab: { id: 51, windowId: 11 } };
        msg({ type: ENSURE_NATIVE_MSG, kind: "activate", url: "chrome://settings", tabId: 60, windowId: 11 }, IFR); await wait();
        expect(calls).toEqual(["open:11"]); expect(last(a)).toMatchObject({ show: false }); // 先 open（同栈），open 成功 → 页内收起、记 marker
        const panel = await openNative(11); calls.length = 0;
        L.act![0]!({ tabId: 60, windowId: 11 }); await wait(); expect(calls).toEqual([]); // 到了受限页：不动
        L.act![0]!({ tabId: 52, windowId: 11 }); await wait(); expect(calls).toEqual(["close:11"]); // 到了普通页（宿主活着）：关原生
        panel.disconnect(); await wait();
        expect(last(a)).toMatchObject({ show: true, nativeOpen: false }); expect(last(b)).toMatchObject({ active: true, show: true });
        calls.length = 0; L.act![0]!({ tabId: 51, windowId: 11 }); await wait(); expect(calls).toEqual([]); // marker 已清：再切标签不会重复 close
        await toggleInpage(51, 11, "https://a.test/");
    });
    test("到达路径不动用户自己开的原生（无 marker）；onArrive 只看窗口标记，不看别的窗口", async () => {
        await connectHost(61, 12, "https://a.test/"); await connectHost(62, 12, "https://b.test/");
        const panel = await openNative(12); calls.length = 0; // 用户自己开的原生：没有 restoreOnClose 标记
        L.act![0]!({ tabId: 62, windowId: 12 }); await wait(); expect(calls).toEqual([]);
        panel.disconnect(); await wait();
    });
    test("同一标签内受限页 → 普通页（新标签页里输入网址）：内容脚本握手 = 到达；marker 窗口里活动标签的 hello 触发切换", async () => {
        const a = await connectHost(71, 11, "https://a.test/"); L.act![0]!({ tabId: 71, windowId: 11 }); await toggleInpage(71, 11, "https://a.test/");
        msg({ type: ENSURE_NATIVE_MSG, kind: "create", windowId: 11 }, { id: "x", url: NATIVE + "?host=inpage&win=11&tab=71", tab: { id: 71, windowId: 11 } }); await wait();
        const panel = await openNative(11); L.act![0]!({ tabId: 99, windowId: 11 }); await wait(); calls.length = 0; // 新标签页（受限）
        const nt = host(99, 11, "https://typed.test/"); conn(nt); hello(nt); await wait(); // 地址栏输入网址 → 同标签新内容脚本握手
        expect(calls).toEqual(["close:11"]); panel.disconnect(); await wait(); expect(last(nt)).toMatchObject({ active: true, show: true }); expect(last(a)).toMatchObject({ show: true });
        await toggleInpage(99, 11, "https://typed.test/");
    });

    /* 补丁 t903u-tab-switch：用户真机「YouTube 切到 GitHub 后变回 Chrome 原生侧边栏」。预热=窗口级时，页内侧栏里点收藏这一下真实点击
     * 同时 ① 发预热（pointerdown → MSG.prewarm → open）② 切标签（tabs.update）。onActivated 在面板端口出现之前到达 → 到达判定 not-native → 以前就没人再判了。 */
    const IFRAME = (tab: number, w: number, url: string) => ({ id: "x", url: NATIVE + `?host=inpage&win=${w}&tab=${tab}`, tab: { id: tab, windowId: w, url } });
    const prewarmClick = (tab: number, w: number, url: string) => msg({ type: "inpage:prewarm", source: "frame" }, IFRAME(tab, w, url));
    test("回归 t903u：页内侧栏里的同一下点击既触发窗口级预热又切走标签（到达先于面板端口）→ 面板端口落定时补判到达：关原生、目的标签恢复页内", async () => {
        const yt = await connectHost(91, 14, "https://www.youtube.com/"), gh = await connectHost(92, 14, "https://github.com/");
        L.act![0]!({ tabId: 91, windowId: 14 }); await toggleInpage(91, 14, "https://www.youtube.com/"); expect(last(gh)).toMatchObject({ show: true });
        prefs.prewarm = "window"; calls.length = 0;
        try {
            prewarmClick(91, 14, "https://www.youtube.com/"); // pointerdown（真实手势）→ 同栈 open
            expect(calls).toEqual(["open:14"]); await wait(); // open 回来：页内收起、记 restoreOnClose
            L.act![0]!({ tabId: 92, windowId: 14 }); await wait(); // 同一下点击的 tabs.update：到达时面板端口还没连上
            expect(calls).toEqual(["open:14"]); // 到达判定此刻只能 keep（原生还没「在显示」）——修复前到这里就结束了
            const panel = await openNative(14); // 面板端口出现 = open 落定
            expect(calls).toEqual(["open:14", "close:14"]); // 修复：补判到达 → 关原生（只 close，不再 open / setOptions）
            panel.disconnect(); await wait();
            expect(last(gh)).toMatchObject({ active: true, show: true, nativeOpen: false }); expect(last(yt)).toMatchObject({ active: false, show: true });
        } finally { prefs.prewarm = "off"; }
        await toggleInpage(92, 14, "https://github.com/");
    });
    test("t903u 对照：预热手势没有切标签（页面里点一下）→ 原生照设计留着；切到受限页 → 也留着", async () => {
        const a = await connectHost(101, 15, "https://www.youtube.com/"); await connectHost(102, 15, "https://github.com/");
        L.act![0]!({ tabId: 101, windowId: 15 }); await toggleInpage(101, 15, "https://www.youtube.com/");
        prefs.prewarm = "window"; calls.length = 0;
        try {
            prewarmClick(101, 15, "https://www.youtube.com/"); await wait();
            const panel = await openNative(15); await wait(50);
            expect(calls).toEqual(["open:15"]); expect(last(a)).toMatchObject({ show: false, nativeOpen: true }); // 设计内：首次手势整窗开原生，页内让位
            panel.disconnect(); await wait(); expect(last(a)).toMatchObject({ show: true }); // 原生关了恢复页内（既有）
            calls.length = 0; urlOf[103] = { windowId: 15, url: "chrome://settings/" };
            prewarmClick(101, 15, "https://www.youtube.com/"); await wait();
            L.act![0]!({ tabId: 103, windowId: 15 }); await wait(); // 点的是受限页（chrome://）
            const p2 = await openNative(15); await wait(50);
            expect(calls).toEqual(["open:15"]); // 受限页：留在原生（arriveCheck → restricted）
            p2.disconnect(); await wait();
        } finally { prefs.prewarm = "off"; }
        L.act![0]!({ tabId: 101, windowId: 15 }); await wait(); expect(last(a)).toBeDefined();
    });
    test("回归（Cat 真机 53661）：扩展重载 / SW 冷启动后不刷新页面直接按 ⌃S——内容脚本在 SW 的 start 之前连上并发出的 hello 不丢，路由 = 页内；没握手的页面才是原生（对照）", async () => {
        const n = L.conn!.length; const cold = await import(resolve(DIR, "background.ts") + "?swacold"); // 全新的后台实例 = 刚被唤醒的 SW（顶层监听同步注册，ctl 还没起来）
        const early = host(81, 13, "https://example.com/"); for (const f of L.conn!.slice(n)) f(early); hello(early);
        expect(early.sent).toEqual([]); // start 前：缓冲、无应答（Chrome 只对「到达时没有监听者」的消息丢弃——这里有缓冲监听）
        const off = cold.startBackground(); await wait();
        expect(last(early)).toMatchObject({ type: "inpage:state", tabId: 81, windowId: 13 }); // hello 被回放 → hostAlive
        expect(routerFn!({ id: 81, windowId: 13, url: "https://example.com/" })).toBe("inpage"); // ⌃S：同步路由 = 页内（不开原生）
        expect(routerFn!({ id: 82, windowId: 13, url: "https://example.com/" })).toBe("native"); // 对照：没握手（孤儿内容脚本 / 重载后没注入）的标签 → 原生，这正是真机现象的前置条件
        for (const c of off as (() => void)[]) { try { c(); } catch { /* 清理失败不影响其它用例 */ } }
    });
});

describe("源码约束", () => {
    const bg = code("background.ts"), hm = strip(readFileSync(resolve(import.meta.dir, "../src/api/HostMode.ts"), "utf8")), pn = code("panel.ts"), sw = code("switchAuto.ts");
    test("消息入口：并进既有的唯一 runtime.onMessage 顶层监听（不新增监听）；校验 sender.id / 整数 tabId / 非页内发送者", () => {
        expect(bg).toMatch(/onPrewarmMessage\(msg, sender\); onSidebarSwitchMessage\(msg, sender, sendResponse\); return false;/);
        const f = bg.slice(bg.indexOf("function onSidebarSwitchMessage"), bg.indexOf("if (isServiceWorker && typeof chrome"));
        expect(f).toMatch(/sender\.id !== chrome\.runtime\?\.id/); expect(f).toMatch(/Number\.isInteger\(m\.tabId\)/); expect(f).toMatch(/senderIsInpageContext\(sender\.url\)/); expect(f).not.toMatch(/await |setTimeout|sidePanel/);
        expect((bg.match(/runtime\?\.onMessage\?\.addListener/g) ?? []).length).toBe(1);
    });
    test("原生 → 页内只 close：新增代码里没有 openPanelInGesture / sidePanel.open / setOptions；整个后台没有 enabled:false（E3）", () => {
        const f = bg.slice(bg.indexOf("const awaitHost"), bg.indexOf("const toggleFor"));
        expect(f).toMatch(/closePanel\(w\)/); expect(f).not.toMatch(/openPanelInGesture|sidePanel\.|setOptions|setIntent\(w, true\)/); // 意图只在面板端口断开后由 nativeChanged 的既有「原生关了恢复」分支设
        expect(f).toMatch(/restoreOnClose\.add\(w\)/);
        expect((bg.match(/enabled: false/g) ?? []).length).toBe(0);
    });
    test("触发点：onActivated（只在 restoreOnClose 窗口）+ hello（等宿主 / marker 窗口的活动标签）+ 侧栏消息；清理时清 awaitHost", () => {
        expect(bg).toMatch(/if \(arrivalMarked\(i\.windowId\)\) arriveCheck\(i\.windowId, i\.tabId\);/); // 补丁 inpage-restoreonclose-persist：只认本生命里打的标（arrivalMarked = restoreOnClose.has 且不是存储恢复来的）
        expect(bg).toMatch(/awaitHost\.get\(rec\.tabId\)/); expect(bg).toMatch(/restoreOnClose\.clear\(\); pendingWin\.clear\(\); awaitHost\.clear\(\);/);
    });
    test("HostMode：ensureNativeAck 在「不需要切」时发 sidebar-switch 并仍返回 undefined；panel.ts：非页内上下文才开开关，清理时关", () => {
        expect(hm).toMatch(/if \(!msg\) \{ notifySidebarSwitch\(url, kind, tabId, o\.search\); return undefined; \}/);
        expect(pn).toMatch(/if \(!inpageContext\(\)\) \{ setSidebarSwitchEnabled\(AUTO_SWITCH\.viaSidebar\); return \(\) => setSidebarSwitchEnabled\(false\); \}/);
    });
    test("t903u：arrivedDuringOpen（纯函数）只在「有发起标签 · 已落定 · 原生在显示 · 有到达标记 · 活动标签换了」时为真", () => {
        const B = { origin: 1, active: 2, open: true, pending: false, marked: true };
        expect(arrivedDuringOpen(B)).toBe(true);
        expect(arrivedDuringOpen({ ...B, active: 1 })).toBe(false); // 没切标签：设计内的「首次手势开原生」
        expect(arrivedDuringOpen({ ...B, origin: undefined })).toBe(false); // 不是预热开的（ensure / 用户自己开）
        expect(arrivedDuringOpen({ ...B, pending: true })).toBe(false);
        expect(arrivedDuringOpen({ ...B, open: false })).toBe(false); // 没开成
        expect(arrivedDuringOpen({ ...B, marked: false })).toBe(false); // 页内本来没在显示：没有可恢复的
        expect(arrivedDuringOpen({ ...B, active: undefined })).toBe(false);
    });
    test("t903u：补判挂在 nativeChanged 落定处、只认预热 open 的发起标签；清理 / 关窗清掉", () => {
        expect(bg).toMatch(/if \(wp\.go\) openNativeForWindow\(w, "prewarm", id\);/);
        expect(bg).toMatch(/if \(source === "prewarm" && originTab != null\) prewarmOrigin\.set\(w, originTab\); else prewarmOrigin\.delete\(w\);/);
        const nc = bg.slice(bg.indexOf("const nativeChanged"), bg.indexOf("const onHost"));
        expect(nc).toMatch(/if \(re\) arriveCheck\(w, activeByWin\[w\]!\);/); expect(nc).not.toMatch(/openPanelInGesture|sidePanel\.|setOptions/);
        expect(bg).toMatch(/prewarmOrigin\.clear\(\); \}/); expect(bg).toMatch(/onWinRemoved = \(w: number\) => \{ handoff\.delete\(w\); prewarmOrigin\.delete\(w\);/);
    });
    test("switchAuto.ts：纯逻辑文件不 import chrome / 无控制台", () => { expect(sw).not.toMatch(/chrome\.|console\./); expect(sw.match(/^import .*$/gm)).toEqual(['import type { PageKind } from "@api/HostMode";', 'import type { Mode } from "./constants";']); });
    test("回归（Cat 真机 53661）：扩展重载后补注入 = onInstalled → reinjectContent（http/https/file 全部标签）；新内容脚本先移除上一份遗留的宿主", () => {
        const entry = readFileSync(resolve(import.meta.dir, "../src/entries/background.ts"), "utf8"), content = readFileSync(resolve(DIR, "content.ts"), "utf8");
        expect(entry).toMatch(/onInstalled\.addListener\(\(\) => void reinjectContent\(\)\)/); expect(entry).toMatch(/url: \["http:\/\/\*\/\*", "https:\/\/\*\/\*"/);
        expect(content).toMatch(/document\.getElementById\(HOST_ID\)\?\.remove\(\)/);
    });
});

/* 补丁 inpage-action-click：点工具栏图标 → 按当前页面性质决定：可注入 → 页内侧栏显示 / 收起；受限页 → Chrome 原生侧栏开 / 关（与 Alt+S 同一套判定）。
 * 三层：A) 核心 SidePanelGesture：action.onClicked 顶层同步注册、与 toggle-sidebar 命令走同一个 onToggleGesture（同步、open 前无 await；冷启动 = 原生 + 记冷手势）；
 *       B) 后台控制器的路由（chrome mock，真 toggleFor / decideToggle）：页面性质 × 原生是否已开 × 预热模式 的判定表；
 *       C) 源码约束：openPanelOnActionClick 必须是 false（否则 Chrome 不派发 action.onClicked）、迁移写 false、监听在 install 里同步注册。
 * 真机（Chrome 是否对 CDP / xdotool 的图标点击派发 onClicked、手势是否有效）要 headed：见 shots/。 */
import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { pageKind } from "../src/plugins/inpageSidebar/logic";

const DIR = resolve(import.meta.dir, "../src/plugins/inpageSidebar");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/* ---------- A) 核心 SidePanelGesture ---------- */
const realErrorLog = { ...(await import("../src/api/ErrorLog")) };
mock.module("@api/ErrorLog", () => ({ ...realErrorLog, recordError: () => { } }));
const aCalls: string[] = []; const AL: Record<string, Function[]> = {};
const aev = (k: string) => ({ addListener: (f: Function) => { (AL[k] ??= []).push(f); } });
const aChrome = {
    sidePanel: { open: async (o: any) => { aCalls.push("open:" + o.windowId); }, close: async (o: any) => { aCalls.push("close:" + o.windowId); }, setOptions: async () => { } },
    commands: { onCommand: aev("cmd") }, action: { onClicked: aev("action") }, runtime: { onConnect: aev("conn"), lastError: undefined },
    windows: { onFocusChanged: aev("focus"), WINDOW_ID_NONE: -1, getLastFocused: async () => ({ id: 7 }) },
};
const gKeep = { chrome: (globalThis as any).chrome };
(globalThis as any).chrome = aChrome;
const G = (await import(resolve(import.meta.dir, "../src/api/SidePanelGesture.ts") + "?actclick")) as typeof import("../src/api/SidePanelGesture"); // 独立模块实例（installed 标志是模块级的）
G.installSidePanelGesture();
describe("A) SidePanelGesture：action.onClicked（工具栏图标 / _execute_action）与 toggle-sidebar 同一条手势路径", () => {
    test("install 时同步注册 action.onClicked（与 commands.onCommand 一样在顶层、无 await）；各一个监听", () => {
        expect(AL.action!.length).toBe(1); expect(AL.cmd!.length).toBe(1);
    });
    test("冷启动（没有路由）点图标：同一调用栈里立刻 open（调用返回时 calls 已有 open，没有 await），无违规；并记下冷手势供 start() 纠偏", () => {
        G.takeColdGesture(); aCalls.length = 0;
        AL.action![0]!({ windowId: 3, id: 11, url: "https://a.test/" });
        expect(aCalls).toEqual(["open:3"]); expect(G.violations.length).toBe(0);
        expect(G.takeColdGesture()).toMatchObject({ windowId: 3, tabId: 11, url: "https://a.test/", opened: true });
    });
    test("原生已开（面板端口在）再点图标 → close（受限页 / 原生下与 Alt+S 一致：开着就关）", () => {
        const port = { name: "panel:3", onMessage: aev("pm"), onDisconnect: aev("pd") }; for (const f of AL.conn!) f(port);
        expect(G.isPanelOpen(3)).toBe(true); aCalls.length = 0;
        AL.action![0]!({ windowId: 3, id: 11, url: "chrome://settings" }); expect(aCalls).toEqual(["close:3"]); expect(G.isPanelOpen(3)).toBe(false);
    });
    test("有路由：返回 inpage → 不碰原生，路由收到图标点击带的 tab；返回 native → 同栈 open；路由抛错 → 回落原生", () => {
        aCalls.length = 0; const seen: unknown[] = [];
        G.setGestureRouter((tab: unknown) => { seen.push(tab); return "inpage"; }); AL.action![0]!({ windowId: 4, id: 12, url: "https://b.test/" });
        expect(aCalls).toEqual([]); expect(seen).toEqual([{ windowId: 4, id: 12, url: "https://b.test/" }]);
        G.setGestureRouter(() => "native"); AL.action![0]!({ windowId: 4 }); expect(aCalls).toEqual(["open:4"]);
        aCalls.length = 0; G.setGestureRouter(() => { throw new Error("boom"); }); expect(() => AL.action![0]!({ windowId: 5 })).not.toThrow(); expect(aCalls).toEqual(["open:5"]);
    });
    test("等价性：同一路由结果下，图标点击与 toggle-sidebar 命令的 sidePanel 调用序列逐项相同（Alt+S = 图标）", () => {
        for (const r of ["inpage", "native"] as const) {
            G.setGestureRouter(() => r); aCalls.length = 0; AL.cmd![0]!("toggle-sidebar", { windowId: 6 }); const viaCmd = [...aCalls];
            // 清掉命令可能留下的 open 集合状态（没有面板端口，open 集合不变）
            aCalls.length = 0; AL.action![0]!({ windowId: 6 }); expect(aCalls).toEqual(viaCmd);
        }
    });
    test("别的命令不会触发（只有 toggle-sidebar 走命令路径）；chrome.action 不存在（旧环境 / 测试 mock）时 install 不抛错", () => {
        aCalls.length = 0; G.setGestureRouter(() => "native"); AL.cmd![0]!("open-command-bar", { windowId: 4 }); expect(aCalls).toEqual([]);
        /* chrome.action 缺失：源码用了可选链（装过一次后不会再装，所以只做源码断言） */
        expect(strip(readFileSync(resolve(DIR, "../../api/SidePanelGesture.ts"), "utf8"))).toMatch(/chrome\.action\?\.onClicked\?\.addListener\(/);
    });
});
/* ---------- A2) v2：冷 SW + 原生本来就开着，再点图标 / Alt+S = 关（与热 SW 一致） ----------
 * 冷 SW 同步栈里分不出「原生已开」（open 集合空）→ 仍同栈 open（⚠ 对已开面板预期无操作，真机未验证）；之后原生面板页自己重连的端口（名字带 ":r"）证明它此前就开着 → 关。 */
describe("A2) 冷 SW + 原生已开：重连端口（panel:<w>:r）判定「手势之前就开着」→ close，不纠偏成页内", () => {
    const connect = (name: string) => { const port = { name, onMessage: aev("pm2"), onDisconnect: aev("pd2") }; for (const f of AL.conn!) f(port); return port; };
    const fire = (kind: "action" | "cmd", tab: any) => { if (kind === "action") AL.action![0]!(tab); else AL.cmd![0]!("toggle-sidebar", tab); };
    const realNow = Date.now;
    const reset = () => { G.setGestureRouter(undefined); G.takeColdGesture(); aCalls.length = 0; Date.now = realNow; };
    afterEach(() => { Date.now = realNow; G.setGestureRouter(undefined); });
    for (const kind of ["action", "cmd"] as const) {
        test(`[${kind}] 冷 + 普通页 + 原生已开：手势同栈 open；重连端口 :r 到达 → 同栈 close；open 集合清空；冷手势被取走（start() 不会纠偏成页内）`, () => {
            reset(); fire(kind, { windowId: 21, id: 31, url: "https://a.test/" });
            expect(aCalls).toEqual(["open:21"]); // 同栈（调用返回时已有）；此刻判成「未开」是已知局限
            connect("panel:21:r");
            expect(aCalls).toEqual(["open:21", "close:21"]); expect(G.isPanelOpen(21)).toBe(false);
            expect(G.takeColdGesture()).toBeUndefined(); expect(G.violations.length).toBe(0);
        });
    }
    test("冷 + 受限页（chrome://version）+ 原生已开：同样 close（核心不看页面性质；原生开着一律是『再点 = 关』）", () => {
        reset(); fire("action", { windowId: 22, id: 32, url: "chrome://version" }); connect("panel:22:r");
        expect(aCalls).toEqual(["open:22", "close:22"]);
    });
    test("start() 先取走冷手势（插件起得比重连端口早）：之后 :r 到达仍然 close", () => {
        reset(); fire("action", { windowId: 23, id: 33, url: "https://a.test/" });
        expect(G.takeColdGesture()).toMatchObject({ windowId: 23, opened: true }); // 插件 start() 做的事
        connect("panel:23:r"); expect(aCalls).toEqual(["open:23", "close:23"]);
    });
    test("冷 + 原生未开（现状不变）：手势 open；新开面板的端口（无 :r）到达 → 不 close，冷手势保留给 start() 纠偏（opened:true）；之后 :r 也不再关（等待已撤销）", () => {
        reset(); fire("action", { windowId: 24, id: 34, url: "https://a.test/" });
        connect("panel:24"); expect(aCalls).toEqual(["open:24"]); expect(G.isPanelOpen(24)).toBe(true);
        expect(G.takeColdGesture()).toMatchObject({ windowId: 24, tabId: 34, opened: true });
        connect("panel:24:r"); expect(aCalls).toEqual(["open:24"]); // 例如新面板在 SW 再次重启后重连：不是「手势前就开着」
    });
    test("冷 + 受限页 + 原生未开：open，新端口（无 :r）→ 不关、不纠偏（受限页本就不纠偏）", () => {
        reset(); fire("cmd", { windowId: 25, id: 35, url: "chrome://settings" }); connect("panel:25");
        expect(aCalls).toEqual(["open:25"]);
    });
    test("别的窗口的 :r 端口不触发；超时（> COLD_NATIVE_RECONNECT_MS）的 :r 不触发（保留现状：原生保持）", () => {
        reset(); fire("action", { windowId: 26, id: 36, url: "https://a.test/" }); connect("panel:27:r"); expect(aCalls).toEqual(["open:26"]);
        const t0 = realNow(); Date.now = () => t0 + G.COLD_NATIVE_RECONNECT_MS + 1; connect("panel:26:r"); expect(aCalls).toEqual(["open:26"]);
        expect(G.isPanelOpen(26)).toBe(true);
    });
    test("没有冷手势时的 :r 端口（SW 因空闲被回收后面板页自己把它唤醒）只登记 open，不 close", () => {
        reset(); connect("panel:28:r"); expect(aCalls).toEqual([]); expect(G.isPanelOpen(28)).toBe(true);
    });
    test("热路径不变：路由已装（热 SW）→ 不登记等待；之后迟到的 :r 端口不 close；open 集合有该窗口时点图标仍是 close（原测试路径）", () => {
        reset(); G.setGestureRouter(() => "native"); fire("action", { windowId: 29, id: 37, url: "https://a.test/" });
        expect(aCalls).toEqual(["open:29"]); connect("panel:29:r"); expect(aCalls).toEqual(["open:29"]);
        G.setGestureRouter(undefined); G.takeColdGesture(); aCalls.length = 0; connect("panel:30"); fire("action", { windowId: 30, id: 38, url: "https://a.test/" });
        expect(aCalls).toEqual(["close:30"]);
    });
    test("冷手势先于路由安装，随后热手势到达：热手势清掉等待（路由已装 = 热路径）", () => {
        reset(); fire("action", { windowId: 31, id: 39, url: "https://a.test/" });
        G.setGestureRouter(() => "inpage"); fire("action", { windowId: 31, id: 39, url: "https://a.test/" });
        connect("panel:31:r"); expect(aCalls).toEqual(["open:31"]);
    });
    test("端口名解析：panel:<w> / panel:<w>:r 都被核心与插件接受；别的后缀不接受", () => {
        expect(G.panelPortRe.exec("panel:3")?.[1]).toBe("3"); expect(G.panelPortRe.exec("panel:3:r")?.[2]).toBe(":r");
        expect(G.panelPortRe.test("panel:3:x")).toBe(false); expect(G.panelPortRe.test("panel:")).toBe(false);
        expect(readFileSync(resolve(DIR, "background.ts"), "utf8")).toContain("/^panel:(\\d+)(:r)?$/.exec(port.name)");
    });
    test("面板页（_core/sidebar）：连上 >1 s 后的重连才带 :r；首次连接与立刻失败的重试不带", () => {
        const src = strip(readFileSync(resolve(DIR, "../_core/sidebar/index.ts"), "utf8"));
        expect(src).toContain('name: `panel:${w.id}${reconnect ? ":r" : ""}`'); expect(src).toMatch(/Date\.now\(\) - at > 1000\) reconnect = true/);
        expect(src).toMatch(/reconnect = false/);
    });
    test("closePanel 在 onConnect 监听里同步发出，不含 await / setTimeout（源码约束）", () => {
        const src = strip(readFileSync(resolve(DIR, "../../api/SidePanelGesture.ts"), "utf8")); const i = src.indexOf("if (coldNative?.windowId === id)"); const blk = src.slice(i, src.indexOf("port.onMessage", i));
        expect(blk).toContain("closePanel(id)"); expect(blk).not.toMatch(/await|setTimeout|\.then\(/);
    });
});
afterAll(() => { mock.module("@api/ErrorLog", () => realErrorLog); (globalThis as any).chrome = gKeep.chrome; });

/* ---------- B) 后台控制器的路由 ---------- */
describe("B) 工具栏图标的判定表（后台控制器 chrome mock，真 toggleFor / decideToggle；图标 = 路由返回 native 时再由核心开 / 关原生）", () => {
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
        BG = await import(resolve(DIR, "background.ts") + "?actclick");
        (globalThis as { actCleanups?: unknown }).actCleanups = BG.startBackground(); await wait();
    });
    afterAll(() => { for (const c of ((globalThis as { actCleanups?: (() => void)[] }).actCleanups ?? [])) { try { c(); } catch { /* 清理失败不影响其它文件 */ } } delete (globalThis as { actCleanups?: unknown }).actCleanups; mock.module(resolve(DIR, "settings.ts"), () => realSettings); mock.module(SPG_PATH, () => realSPG); mock.restore(); g.chrome = keep.chrome; if (keep.document !== undefined) g.document = keep.document; });
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

    test("可注入页（http/https，宿主已握手）：图标 → 页内显示；再点 → 页内收起；全程不 open / close 原生", async () => {
        const a = await connectHost(101, 30, "https://a.test/"); L.act![0]!({ tabId: 101, windowId: 30 }); calls.length = 0;
        expect(await icon({ id: 101, windowId: 30, url: "https://a.test/" })).toBe("inpage"); expect(last(a)).toMatchObject({ show: true, nativeOpen: false });
        expect(await icon({ id: 101, windowId: 30, url: "https://a.test/" })).toBe("inpage"); expect(last(a)).toMatchObject({ show: false });
        expect(calls).toEqual([]);
    });
    test("受限页（chrome:// / chrome-extension:// / about:blank / view-source / file:）：原生没开 → open；已开 → close（不是保持），与 Alt+S 一致", async () => {
        let w = 40;
        for (const url of ["chrome://settings", "chrome-extension://x/options.html", "about:blank", "view-source:https://a.test/", "file:///tmp/a.html"]) {
            w++; calls.length = 0; expect(pageKind(url)).not.toBe("ok");
            expect(await icon({ id: 200 + w, windowId: w, url })).toBe("native"); expect(calls).toEqual([`open:${w}`]);
            const panel = await openNative(w); calls.length = 0;
            expect(await icon({ id: 200 + w, windowId: w, url })).toBe("native"); expect(calls).toEqual([`close:${w}`]); panel.disconnect(); await wait();
        }
    });
    test("商店页 / PDF 查看器（pageKind webstore / pdf）→ 原生", async () => {
        let w = 60;
        for (const url of ["https://chromewebstore.google.com/detail/x", "https://chrome.google.com/webstore/detail/x", "https://a.test/paper.pdf"]) { w++; calls.length = 0; expect(await icon({ id: 300 + w, windowId: w, url })).toBe("native"); expect(calls).toEqual([`open:${w}`]); }
    });
    test("url 空串 / undefined（未知，no-url）：当受限页 → 原生（⚠ 取舍：宁可开原生也不让图标点了没反应）", async () => {
        let w = 70;
        for (const url of ["", undefined]) { w++; calls.length = 0; expect(pageKind(url)).toBe("no-url"); expect(await icon({ id: 400 + w, windowId: w, url })).toBe("native"); expect(calls).toEqual([`open:${w}`]); }
    });
    test("可注入页但宿主还没握手（刚加载 / 休眠重载中 / 内容脚本被拦）：和 Alt+S 一样回落原生（decideToggle 的 fallback-native；⚠ 图标点得太早会开原生）", async () => {
        calls.length = 0; expect(await icon({ id: 501, windowId: 80, url: "https://nohost.test/" })).toBe("native"); expect(calls).toEqual(["open:80"]);
    });
    test("原生已开、当前是可注入页：图标 → 关原生（hide-visible，页内不显示；与 Alt+S 同；若原生是预热 / 受限页让位开的，端口断开后 restoreOnClose 恢复页内）", async () => {
        const a = await connectHost(111, 31, "https://a.test/"); L.act![0]!({ tabId: 111, windowId: 31 }); const panel = await openNative(31); calls.length = 0;
        expect(await icon({ id: 111, windowId: 31, url: "https://a.test/" })).toBe("native"); expect(calls).toEqual(["close:31"]); panel.disconnect(); await wait();
        expect(last(a)).toMatchObject({ show: false });
    });
    test("默认方式 = native（设置）：可注入页也走原生（native-mode）", async () => {
        const a = await connectHost(121, 32, "https://a.test/"); L.act![0]!({ tabId: 121, windowId: 32 }); prefs.defaultMode = "native"; calls.length = 0;
        expect(await icon({ id: 121, windowId: 32, url: "https://a.test/" })).toBe("native"); expect(calls).toEqual(["open:32"]); expect(last(a)).toMatchObject({ show: false });
    });
    test("预热模式（Off / Window）不影响图标：预热只由页面里的可信 pointerdown / keydown 触发，图标点击不是页面事件；两种模式下可注入页都是页内显示、受限页都是原生开", async () => {
        for (const mode of ["off", "window"]) {
            prefs.prewarm = mode; const w = mode === "off" ? 33 : 34, t = mode === "off" ? 131 : 141;
            const a = await connectHost(t, w, "https://a.test/"); L.act![0]!({ tabId: t, windowId: w }); calls.length = 0;
            expect(await icon({ id: t, windowId: w, url: "https://a.test/" })).toBe("inpage"); expect(last(a)).toMatchObject({ show: true }); expect(calls).toEqual([]);
            expect(await icon({ id: t, windowId: w, url: "https://a.test/" })).toBe("inpage");
            expect(await icon({ id: t + 1, windowId: w, url: "chrome://version" })).toBe("native"); expect(calls).toEqual([`open:${w}`]);
        }
    });
    test("休眠（discarded）标签不会是图标的点击目标（活动标签不可能被丢弃）；若 tab.url 仍在 → 按 url 判；无宿主记录 → 回落原生", async () => {
        calls.length = 0; expect(await icon({ id: 601, windowId: 90, url: "https://sleep.test/" })).toBe("native"); expect(calls).toEqual(["open:90"]);
    });
});

describe("C) 源码约束（补丁 inpage-action-click）", () => {
    const api = strip(readFileSync(resolve(DIR, "../../api/SidePanelGesture.ts"), "utf8"));
    const sb = strip(readFileSync(resolve(DIR, "../_core/sidebar/index.ts"), "utf8"));
    const entry = strip(readFileSync(resolve(DIR, "../../entries/background.ts"), "utf8"));
    test("_core/sidebar：setPanelBehavior 写 openPanelOnActionClick:false（迁移旧的持久化 true），不再有 true", () => {
        expect(sb).toMatch(/setPanelBehavior\(\{ openPanelOnActionClick: false \}\)/); expect(sb).not.toMatch(/openPanelOnActionClick: true/);
    });
    test("action.onClicked 监听在 installSidePanelGesture 里同步注册（函数体内没有 await 在它之前）；两个入口共用 onToggleGesture", () => {
        const body = api.slice(api.indexOf("export function installSidePanelGesture")); const i = body.indexOf("chrome.action?.onClicked");
        expect(i).toBeGreaterThan(0); expect(body.slice(0, i)).not.toMatch(/\bawait\b/);
        expect(body).toMatch(/commands\.onCommand\.addListener\(\(cmd, tab\) => \{ if \(cmd === "toggle-sidebar"\) onToggleGesture\(tab\); \}\)/); expect(body).toMatch(/onClicked\?\.addListener\(tab => onToggleGesture\(tab\)\)/);
    });
    test("onToggleGesture 自身同步：不含 await / setTimeout / then 之前的异步取值（open 在手势栈里）", () => {
        const s = api.indexOf("const onToggleGesture"), e = api.indexOf("chrome.commands.onCommand"); const fn = api.slice(s, e);
        expect(fn).not.toMatch(/\bawait\b|setTimeout|chrome\.tabs\.get|chrome\.windows\.get/);
    });
    test("entries/background：installSidePanelGesture 在顶层、任何 await 之前", () => {
        const i = entry.indexOf("installSidePanelGesture();"); expect(i).toBeGreaterThan(0); expect(entry.slice(0, i)).not.toMatch(/\bawait\b/);
    });
});

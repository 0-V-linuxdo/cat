/* 页内侧边栏：插件定义约定 + 源码约束（E3 / 裁定 B、H）+ 后台胶水（chrome mock，无 Chrome / 无 headed）。 */
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const DIR = resolve(import.meta.dir, "../src/plugins/inpageSidebar");
const src = (f: string) => readFileSync(resolve(DIR, f), "utf8");
const ALL = readdirSync(DIR).filter(f => f.endsWith(".ts"));
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\s\/\/.*$/gm, "");

describe("插件定义约定", () => {
    test("name = InpageSidebar；默认关；tags views；依赖 Sidebar；不声明 icon（卡片图标只来自 PLUGIN_CARD_ICON）", async () => {
        const p = (await import("../src/plugins/inpageSidebar/index")).default as Record<string, unknown>;
        expect(p.name).toBe("InpageSidebar"); expect(p.enabledByDefault).toBe(false); expect(p.tags).toEqual(["views"]); expect(p.dependencies).toEqual(["Sidebar"]);
        expect("icon" in p).toBe(false);
        expect(Object.keys(p.settings as { def: object }["def"] ? (p.settings as { def: object }).def : {}).toSorted()).toEqual(["defaultMode", "displayMode", "hoverReveal", "prewarm", "showHandle"]);
    });
    test("设置默认值：默认打开方式 = 页内；悬停浮出默认关；切换按钮默认跟 E8 常量", async () => {
        const { settings } = await import("../src/plugins/inpageSidebar/settings"); const { STRINGS } = await import("../src/plugins/inpageSidebar/i18n");
        const def = settings.def as Record<string, { default?: unknown; options?: { label: string; value: string; default?: boolean }[] }>;
        expect(def.defaultMode!.options!.find(o => o.default)!.value).toBe("inpage");
        expect(def.prewarm!.options!.find(o => o.default)!.value).toBe("off"); expect(def.prewarm!.options!.map(o => o.value)).toEqual(["off", "window"]); // tab 已移除
        for (const o of def.prewarm!.options!) for (const L of ["en", "zh"] as const) expect((STRINGS[L] as Record<string, string>)[o.label]).toBeTruthy(); // 每个选项在 zh / en 都有文案：下拉不出空白
        for (const L of ["en", "zh"] as const) expect(Object.keys(STRINGS[L]).filter(k => k.startsWith("inpageSidebar.prewarm.tab"))).toEqual([]);
        expect(def.displayMode!.options!.find(o => o.default)!.value).toBe("push"); expect(def.displayMode!.options!.map(o => o.value)).toEqual(["push", "overlay"]); // 补丁 09：默认推开页面
        expect(def.hoverReveal!.default).toBe(false); expect(def.showHandle!.default).toBe(false); /* 补丁 12：侧栏把手竖条默认关；旧键 showSwitchButton 已废 */
    });
    test("i18n：所有 inpageSidebar.* 与 plugin.inpageSidebar.* 键在 en / zh 都有；选项标签 / 描述 / 标签键都存在", async () => {
        const { STRINGS } = await import("../src/plugins/inpageSidebar/i18n");
        expect(Object.keys(STRINGS.en).toSorted()).toEqual(Object.keys(STRINGS.zh).toSorted());
        for (const k of ["inpageSidebar.defaultMode", "inpageSidebar.mode.inpage", "inpageSidebar.mode.native", "inpageSidebar.showHandle", "inpageSidebar.hoverReveal", "inpageSidebar.displayMode", "inpageSidebar.displayMode.push", "inpageSidebar.displayMode.overlay", "inpageSidebar.tag.panel", "inpageSidebar.tag.hover", "inpageSidebar.tag.native", "inpageSidebar.prewarm", "inpageSidebar.prewarm.off", "inpageSidebar.prewarm.window"]) { expect(STRINGS.en[k as keyof typeof STRINGS.en]).toBeTruthy(); expect(STRINGS.zh[k as keyof typeof STRINGS.zh]).toBeTruthy(); }
        expect(STRINGS.zh["plugin.inpageSidebar.label"]).toBe("页内侧边栏"); expect(STRINGS.en["plugin.inpageSidebar.label"]).toBe("In-page Sidebar");
    });
});

describe("源码约束", () => {
    const code = (f: string) => stripComments(src(f));
    test("E3：没有直接 sidePanel.open；没有改 openPanelOnActionClick（方案 Z）", () => {
        for (const f of ALL) { const c = code(f); expect(c).not.toMatch(/sidePanel\.open\(/); expect(c).not.toMatch(/openPanelOnActionClick/); expect(c).not.toMatch(/setPanelBehavior/); }
    });
    test("E3：整个插件目录里没有任何 enabled:false（标签级预热已移除：Chrome ≥132 里它藏不住原生面板；也就没有「disable 正在显示面板的标签」的可能）", () => {
        for (const f of ALL) expect((code(f).match(/enabled\s*:\s*false/g) ?? []).length).toBe(0);
        const c = code("background.ts"); expect(c).not.toMatch(/setTabEnabled|mayDisable|warmStep|planPrewarm|applyWarm|endWarm|predictNav|onBeforeNavigate/);
    });
    test("setOptions 只出口两处：启动对账（只 {tabId, enabled:true}，不带 path，不 open / close）与 E8 变体（默认关）", () => {
        const c = code("background.ts"); const uses = [...c.matchAll(/setOptions\(([^)]*)\)/g)].map(m => m[1]!);
        expect(uses.length).toBe(2); expect(uses).toContain("{ tabId: id, enabled: true }"); expect(uses.some(u => u.startsWith('{ tabId, path: "sidepanel.html", enabled: true }'))).toBe(true);
        const fn = c.slice(c.indexOf("const reconcileTabs"), c.indexOf("const factsFor")); // 对账函数体：不带 path、不碰 open / close（不会因此打开原生）
        expect(fn).toMatch(/setOptions\(\{ tabId: id, enabled: true \}\)/); expect(fn).not.toMatch(/path|\.open\(|\.close\(|openPanel|closePanel/);
        for (const f of ALL.filter(x => x !== "background.ts")) expect(code(f)).not.toMatch(/setOptions\(/);
    });
    test("裁定 H：内容脚本不引入 @api/ErrorLog / safe；只用 console.warn", () => {
        for (const f of ["content.ts", "host.css.ts", "constants.ts", "logic.ts"]) { expect(code(f)).not.toMatch(/@api\/ErrorLog/); }
        expect(code("content.ts")).not.toMatch(/\bsafe\(/); expect(code("content.ts")).not.toMatch(/console\.(error|log)\(/);
    });
    test("裁定 B：顶层监听里调用 openPanelInGesture 前没有 await / then；背景文件里没有 await 夹在监听与 open 之间", () => {
        const c = code("background.ts"); const top = c.slice(0, c.indexOf("export function startBackground"));
        expect(top).toMatch(/openPanelInGesture\(wid, ok =>/); expect(top).not.toMatch(/\bawait\b/); expect(top).not.toMatch(/\.then\(/);
        expect(top).not.toMatch(/ChromeEvents|listen\(/); // 不经缓冲层
    });
    test("裁定 G / I：background 没有 declarativeNetRequest / scripting / 新权限；web_accessible_resources 由补丁 01 负责", () => {
        for (const f of ALL) expect(code(f)).not.toMatch(/chrome\.(declarativeNetRequest|scripting|debugger)\b/);
    });
});

/* —— 后台胶水：假 chrome + 全新模块实例 —— */
describe("后台胶水（chrome mock）", () => {
    const g = globalThis as Record<string, unknown>;
    const keep = { chrome: g.chrome, document: g.document };
    let realSettings: Record<string, unknown>;
    const prefs: Record<string, unknown> = { defaultMode: "inpage", showHandle: true, hoverReveal: false, prewarm: "off" };
    const L: Record<string, Function[]> = {}; const ev = (k: string) => ({ addListener: (f: Function) => { (L[k] ??= []).push(f); }, removeListener: (f: Function) => { L[k] = (L[k] ?? []).filter(x => x !== f); } });
    const optsByTab: Record<number, { enabled?: boolean; path?: string }> = { 1: { enabled: false, path: "sidepanel.html" } }; // 旧版本标签级预热在 SW 重启后留下的 enabled:false（tab 1）
    let migrations = 0;
    const calls: string[] = []; const badges: [number, string][] = []; const sessionStore: Record<string, unknown> = {};
    const chromeMock = {
        runtime: { onMessage: ev("msg"), onConnect: ev("conn"), lastError: undefined, id: "x", getManifest: () => ({ version: "0.0.0" }) },
        contextMenus: { onClicked: ev("menu"), create: (_p: unknown, cb?: () => void) => { calls.push("menu.create"); cb?.(); }, remove: (_id: string, cb?: () => void) => cb?.(), update: (_i: string, _p: unknown, cb?: () => void) => cb?.() },
        sidePanel: { open: async (o: { windowId: number }) => { calls.push("open:" + o.windowId); }, close: async (o: { windowId: number }) => { calls.push("close:" + o.windowId); }, getOptions: async (o: { tabId: number }) => optsByTab[o.tabId] ?? {}, setOptions: async (o: unknown) => { calls.push("setOptions:" + JSON.stringify(o)); } },
        webNavigation: { onBeforeNavigate: ev("nav") },
        tabs: { onActivated: ev("act"), onUpdated: ev("upd"), onRemoved: ev("rem"), query: async () => [{ id: 1, windowId: 7 }], get: async (id: number) => ({ id, url: "chrome://settings" }), sendMessage: async () => ({ ok: true, proto: 1 }) },
        windows: { onRemoved: ev("wrem"), onFocusChanged: ev("foc"), getAll: async () => [{ id: 7 }], getLastFocused: async () => ({ id: 7 }), WINDOW_ID_NONE: -1 },
        action: { setBadgeText: async (o: { tabId: number; text: string }) => { badges.push([o.tabId, o.text]); } },
        storage: { local: { get: async () => ({ "data:inpageSidebar": { openByWin: {}, lastOpen: false } }) /* rel62-intent-persist：老用户「上次收起」——未知窗口继承 false（本文件测的不是继承） */, set: async (o: Record<string, unknown>) => { Object.assign(sessionStore, o); } }, onChanged: ev("sc") },
    };
    let BG: any, SPG: typeof import("../src/api/SidePanelGesture");
    beforeAll(async () => {
        realSettings = { ...(await import("../src/plugins/inpageSidebar/settings")) };
        delete g.document; g.chrome = chromeMock;
        mock.module(resolve(DIR, "settings.ts"), () => ({ settings: { store: prefs, def: {} }, migratePrewarmTab: () => { migrations++; return false; } }));
        BG = await import(resolve(DIR, "background.ts") + "?glue");
        SPG = await import("../src/api/SidePanelGesture");
    });
    afterAll(() => { mock.module(resolve(DIR, "settings.ts"), () => realSettings); mock.restore(); g.chrome = keep.chrome; if (keep.document !== undefined) g.document = keep.document; });

    const port = (tabId: number, windowId: number, url: string) => {
        const sent: any[] = []; const m: Function[] = []; const d: Function[] = [];
        return { name: "inpage:host", sender: { tab: { id: tabId, windowId, url }, frameId: 0 }, sent, postMessage: (x: unknown) => { sent.push(x); }, onMessage: { addListener: (f: Function) => m.push(f), removeListener: (f: Function) => { const i = m.indexOf(f); if (i >= 0) m.splice(i, 1); } }, listeners: () => m.length, onDisconnect: { addListener: (f: Function) => d.push(f) }, disconnect() { }, say: (x: unknown) => m.forEach(f => f(x)), drop: () => d.forEach(f => f()) };
    };
    const states = (p: { sent: any[] }) => p.sent.filter(s => s.type === "inpage:state");
    const last = (p: { sent: any[] }) => states(p).at(-1);

    test("顶层同步注册了 3 个监听（菜单 / 消息 / 连接）；插件启动前来的 inpage:host 端口先排队，start 后接管", async () => {
        expect(L.menu!.length).toBe(1); expect(L.msg!.length).toBe(1); expect(L.conn!.length).toBe(1);
        const early = port(1, 7, "https://a.test/"); L.conn![0]!(early); expect(early.sent).toEqual([]);
        /* patch cold-start：SW 冷启动时内容脚本在 bootstrap 完成**之前**就连上并发了 hello（只发一次）。Chrome 的端口在没有 onMessage 监听时丢弃消息（这里的 port.say 同样：没监听 = 丢），
         * 所以 onConnect 必须同步挂一个缓冲监听，ctl 起来后重放；否则 hostAlive 永远 false → Alt+S 回落原生。 */
        const cold = port(11, 7, "https://e.test/"); L.conn![0]!(cold); expect(cold.listeners()).toBe(1); // 同步挂了缓冲监听
        cold.say({ type: "hello", proto: 1, frame: "none" }); expect(cold.sent).toEqual([]); // ctl 还没起来：只缓冲，不应答
        (globalThis as { __cleanups?: unknown }).__cleanups = BG.startBackground();
        await new Promise(r => setTimeout(r, 5));
        expect(cold.listeners()).toBe(1); // 缓冲监听已摘掉，只剩 onHost 自己的那一个（不重复处理后续消息）
        expect(last(cold)).toMatchObject({ type: "inpage:state", tabId: 11, windowId: 7 }); // 缓冲的 hello 已重放：hostAlive=true，状态已下发
        await Promise.resolve(); early.say({ type: "hello", proto: 1, frame: "none" });
        await new Promise(r => setTimeout(r, 5)); expect(last(early)).toMatchObject({ type: "inpage:state", tabId: 1, windowId: 7, active: true, show: false, width: 228, handle: true });
        // 启动对账（store 就绪后一次）：只对 getOptions 报 enabled:false 的标签 setOptions({tabId, enabled:true})，不带 path；不 open / close（不会因此打开原生）；迁移钩子被调用一次
        await new Promise(r => setTimeout(r, 20));
        expect(calls.filter(c => c.startsWith("setOptions"))).toEqual(['setOptions:{"tabId":1,"enabled":true}']); expect(calls.filter(c => c.startsWith("open") || c.startsWith("close"))).toEqual([]); expect(migrations).toBe(1);
    });
    test("右键菜单（inpage- 前缀）：页内可显示 → 显示页内、不开原生；再点 → 收起；不认别的前缀", async () => {
        const p = port(2, 7, "https://b.test/"); L.conn![0]!(p); p.say({ type: "hello", proto: 1, frame: "none" }); await new Promise(r => setTimeout(r, 5));
        calls.length = 0; L.menu![0]!({ menuItemId: "cat-boost-new" }, { id: 2, windowId: 7, url: "https://b.test/" }); expect(calls).toEqual([]);
        L.menu![0]!({ menuItemId: "inpage-toggle-page" }, { id: 2, windowId: 7, url: "https://b.test/" });
        expect(calls.filter(c => c.startsWith("open"))).toEqual([]); expect(last(p)).toMatchObject({ active: true, show: true });
        L.menu![0]!({ menuItemId: "inpage-toggle-action" }, { id: 2, windowId: 7, url: "https://b.test/" });
        expect(last(p)).toMatchObject({ show: false }); expect(calls.filter(c => c.startsWith("open") || c.startsWith("close"))).toEqual([]);
    });
    test("补丁 12 把手收起：port 消息 {type:\"collapse\", width} → 与 Alt+S 页内关闭同一条路径（toggleFor）：收起页内、宽度 = 起始宽、不开 / 不关原生；没显示时是空操作（不会反过来「显示」或开原生）", async () => {
        const p = port(3, 7, "https://c.test/"); L.conn![0]!(p); p.say({ type: "hello", proto: 1, frame: "none" }); await new Promise(r => setTimeout(r, 5));
        calls.length = 0;
        p.say({ type: "collapse", width: 300 }); await new Promise(r => setTimeout(r, 5)); // 还没显示：空操作（intent 仍 false，宽度照常记，状态异步下发）
        expect(last(p)).toMatchObject({ show: false, width: 300 }); expect(calls.filter(c => c.startsWith("open") || c.startsWith("close"))).toEqual([]);
        L.menu![0]!({ menuItemId: "inpage-toggle-page" }, { id: 3, windowId: 7, url: "https://c.test/" });
        expect(last(p)).toMatchObject({ active: true, show: true });
        p.say({ type: "collapse", width: 340 }); // 显示中：收起，宽度 340 落在状态里
        expect(last(p)).toMatchObject({ show: false, width: 340 }); expect(calls.filter(c => c.startsWith("open") || c.startsWith("close"))).toEqual([]);
        p.say({ type: "collapse", width: 340 }); expect(last(p)).toMatchObject({ show: false }); // 再来一次：仍是空操作
        L.menu![0]!({ menuItemId: "inpage-toggle-page" }, { id: 3, windowId: 7, url: "https://c.test/" }); expect(last(p)).toMatchObject({ show: true, width: 340 }); // 之后正常再展开，宽度是起始宽
        p.say({ type: "collapse", width: 9999 }); expect(last(p)).toMatchObject({ show: false, width: 500 }); // 宽度照 clampWidth 夹取
    });
    test("受限页（chrome://）右键菜单 → 回落原生：同一调用栈里 open:7（经 openPanelInGesture）", () => {
        calls.length = 0; L.menu![0]!({ menuItemId: "inpage-toggle-action" }, { id: 9, windowId: 7, url: "chrome://settings" });
        expect(calls).toEqual(["open:7"]); // 监听返回时已经同步调到 open
    });
    test("命令路由接口（patch 02）存在；命令 → 路由 → inpage/native 的转发语义由 tests/sidePanelGesture.test.ts 覆盖，决策表由 inpageSidebarLogic.test.ts 覆盖", () => {
        expect(typeof SPG.setGestureRouter).toBe("function"); expect(typeof SPG.closePanel).toBe("function");
    });
    test("「切到 Chrome 侧边栏」消息（E8 路径）：onMessage 监听里同步 open；来源不在 sources 里 / 开关关闭 / 没有 sender.tab → 忽略", () => {
        const { NATIVE_SWITCH } = require("../src/plugins/inpageSidebar/constants") as typeof import("../src/plugins/inpageSidebar/constants");
        calls.length = 0;
        L.msg![0]!({ type: "inpage:switch-native", source: "host" }, { tab: { id: 2, windowId: 7 } }); expect(calls).toEqual(["open:7"]);
        calls.length = 0; L.msg![0]!({ type: "inpage:switch-native", source: "frame" }, { tab: { id: 2, windowId: 7 } }); expect(calls).toEqual([]); // sources 默认只有 host
        L.msg![0]!({ type: "inpage:switch-native", source: "host" }, {}); expect(calls).toEqual([]);
        L.msg![0]!({ type: "other" }, { tab: { id: 2, windowId: 7 } }); expect(calls).toEqual([]);
        expect(NATIVE_SWITCH.setOptionsFirst).toBe(false); expect(calls.some(c => c.startsWith("setOptions"))).toBe(false);
    });
    test("切原生成功后：页内收起（意图清除）", async () => {
        const p = port(3, 7, "https://c.test/"); L.conn![0]!(p); p.say({ type: "hello", proto: 1, frame: "none" }); await new Promise(r => setTimeout(r, 5));
        L.menu![0]!({ menuItemId: "inpage-toggle-page" }, { id: 3, windowId: 7, url: "https://c.test/" }); expect(last(p)).toMatchObject({ show: true });
        L.msg![0]!({ type: "inpage:switch-native", source: "host" }, { tab: { id: 3, windowId: 7 } }); await new Promise(r => setTimeout(r, 5));
        expect(last(p)).toMatchObject({ show: false });
    });
    test("切原生失败（手势过期等）：给宿主一次性提示 hint:switch-failed", async () => {
        const sp = (globalThis as any).chrome.sidePanel; const keepOpen = sp.open; sp.open = async () => { throw new Error("user gesture"); };
        const p = port(4, 7, "https://d.test/"); L.conn![0]!(p); p.say({ type: "hello", proto: 1, frame: "none" }); await new Promise(r => setTimeout(r, 5));
        const ce = console.error; console.error = () => undefined; // recordError 会打印预期内的拒绝
        try { L.msg![0]!({ type: "inpage:switch-native", source: "host" }, { tab: { id: 4, windowId: 7 } }); await new Promise(r => setTimeout(r, 5)); } finally { sp.open = keepOpen; console.error = ce; }
        expect(states(p).some(s => s.hint === "switch-failed")).toBe(true);
    });
    test("一个窗口一个活动 iframe：切到标签 4，标签 2 / 3 收到 active:false", async () => {
        const a = port(5, 8, "https://e.test/"), b = port(6, 8, "https://f.test/"); L.conn![0]!(a); L.conn![0]!(b); a.say({ type: "hello", proto: 1, frame: "none" }); b.say({ type: "hello", proto: 1, frame: "none" });
        await new Promise(r => setTimeout(r, 5));
        L.act![0]!({ tabId: 5, windowId: 8 }); expect(last(a)).toMatchObject({ active: true }); expect(last(b)).toMatchObject({ active: false });
        L.act![0]!({ tabId: 6, windowId: 8 }); expect(last(a)).toMatchObject({ active: false }); expect(last(b)).toMatchObject({ active: true });
    });
    test("L3 版本握手：协议号不一致 → stale，不下发状态", async () => {
        const p = port(10, 7, "https://g.test/"); L.conn![0]!(p); p.say({ type: "hello", proto: 999, frame: "none" }); expect(p.sent).toEqual([{ type: "inpage:stale" }]);
    });
    test("L4：iframe 握手超时（frame: blocked）→ 标记 blocked，显示被撤回，角标 ↗；再按快捷键走原生", async () => {
        const p = port(11, 7, "https://h.test/"); L.conn![0]!(p); p.say({ type: "hello", proto: 1, frame: "none" }); await new Promise(r => setTimeout(r, 5));
        L.act![0]!({ tabId: 11, windowId: 7 });
        L.menu![0]!({ menuItemId: "inpage-toggle-page" }, { id: 11, windowId: 7, url: "https://h.test/" }); expect(last(p)).toMatchObject({ show: true });
        p.say({ type: "frame", state: "blocked" }); expect(last(p)).toMatchObject({ show: false }); expect(badges.at(-1)).toEqual([11, "↗"]);
        calls.length = 0; L.menu![0]!({ menuItemId: "inpage-toggle-page" }, { id: 11, windowId: 7, url: "https://h.test/" }); expect(calls).toEqual(["open:7"]);
    });
    test("宽度：内容脚本上报 → 夹取后只由后台写入 data:inpageSidebar 并下发", async () => {
        const p = port(12, 7, "https://i.test/"); L.conn![0]!(p); p.say({ type: "hello", proto: 1, frame: "none" }); await new Promise(r => setTimeout(r, 5));
        p.say({ type: "width", width: 9999 }); await new Promise(r => setTimeout(r, 10));
        expect((sessionStore["data:inpageSidebar"] as { width: number }).width).toBe(500); expect(last(p)).toMatchObject({ width: 500 });
    });
    const panelPort = (w: number) => { const d: Function[] = []; return { name: `panel:${w}`, sender: {}, postMessage() { }, onMessage: { addListener() { } }, onDisconnect: { addListener: (f: Function) => d.push(f) }, drop() { for (const f of d) f(); } }; };
    const tick = () => new Promise(r => setTimeout(r, 8));
    test("ensure-native（进受限页前）：同步 open:7；目的地是普通网页 / 发送者不是本扩展 / kind 不合法 → 什么都不做；全程没有 setOptions", () => {
        const S = { id: "x", tab: { id: 2, windowId: 7 } };
        calls.length = 0; L.msg![0]!({ type: "inpage:ensure-native", kind: "navigate", url: "chrome://settings" }, S); expect(calls).toEqual(["open:7"]);
        calls.length = 0; L.msg![0]!({ type: "inpage:ensure-native", kind: "create" }, S); expect(calls).toEqual(["open:7"]); // 新建标签 = newtab = 受限
        calls.length = 0; L.msg![0]!({ type: "inpage:ensure-native", kind: "navigate", url: "https://ok.test/" }, S); expect(calls).toEqual([]);
        L.msg![0]!({ type: "inpage:ensure-native", kind: "navigate", url: "chrome://x" }, { ...S, id: "evil" }); expect(calls).toEqual([]);
        L.msg![0]!({ type: "inpage:ensure-native", kind: "bogus", url: "chrome://x" }, S); expect(calls).toEqual([]);
        L.msg![0]!({ type: "inpage:ensure-native", kind: "activate" }, S); expect(calls).toEqual([]); // 激活且 url 未知 = 不判断
    });
    test("ensure-native 的 ack（patch 07）：open 已同步发出之后同步 sendResponse；不需要切 / 发送者不是本扩展 / kind 不合法 → 不应答（页面端靠超时或通道关闭放行）；没有 sendResponse（旧调用）不抛", () => {
        const S = { id: "x", tab: { id: 2, windowId: 7 } };
        const run = (m: unknown, s: unknown) => { const order: string[] = []; calls.length = 0; const before = () => calls.length; L.msg![0]!(m, s, () => order.push(`ack@open${before()}`)); return order; };
        expect(run({ type: "inpage:ensure-native", kind: "navigate", url: "chrome://settings" }, S)).toEqual(["ack@open1"]); // 应答时 calls 里已经有 open:7
        expect(calls).toEqual(["open:7"]);
        expect(run({ type: "inpage:ensure-native", kind: "create" }, S)).toEqual(["ack@open1"]);
        expect(run({ type: "inpage:ensure-native", kind: "navigate", url: "https://ok.test/" }, S)).toEqual([]);
        expect(run({ type: "inpage:ensure-native", kind: "navigate", url: "chrome://x" }, { ...S, id: "evil" })).toEqual([]);
        expect(run({ type: "inpage:ensure-native", kind: "bogus", url: "chrome://x" }, S)).toEqual([]);
        expect(() => L.msg![0]!({ type: "inpage:ensure-native", kind: "navigate", url: "chrome://settings" }, S)).not.toThrow();
        const r = L.msg![0]!({ type: "inpage:ensure-native", kind: "navigate", url: "chrome://settings" }, S, () => undefined); expect(r).toBe(false); // 同步应答，不需要保持通道
        expect(() => L.msg![0]!({ type: "inpage:ensure-native", kind: "navigate", url: "chrome://settings" }, S, () => { throw new Error("port gone"); })).not.toThrow();
    });
    test("弹窗发的 ensure-native（patch 08）：sender.tab.windowId 是弹窗自己的窗口 → 用消息里的 ?win=（宿主窗口）开原生；iframe 发的仍用 sender.tab；被拒绝的消息不记 noteEnsureNative", async () => {
        const HM = await import("../src/api/HostMode");
        const popup = { id: "x", url: "chrome-extension://x/sidepanel.html?popup=commandBar&win=7&via=inpage", tab: { id: 77, windowId: 99 } };
        calls.length = 0; HM.noteEnsureNative(1);
        L.msg![0]!({ type: "inpage:ensure-native", kind: "create", windowId: 7 }, popup, () => undefined);
        expect(calls).toEqual(["open:7"]); expect(HM.lastEnsureNativeAt()!).toBeGreaterThan(1000); // 开的是宿主窗口 7，不是弹窗窗口 99
        calls.length = 0;
        L.msg![0]!({ type: "inpage:ensure-native", kind: "create", windowId: 7 }, { id: "x", url: "chrome-extension://x/sidepanel.html?host=inpage&win=8&tab=2", tab: { id: 2, windowId: 7 } }, () => undefined);
        expect(calls).toEqual(["open:7"]); // iframe：sender.tab 优先（?win= 可能过期）
        HM.noteEnsureNative(1); calls.length = 0;
        L.msg![0]!({ type: "inpage:ensure-native", kind: "create", windowId: 7 }, { ...popup, id: "evil" }, () => undefined);
        L.msg![0]!({ type: "inpage:ensure-native", kind: "navigate", url: "https://ok.test/", windowId: 7 }, popup, () => undefined);
        expect(calls).toEqual([]); expect(HM.lastEnsureNativeAt()).toBe(1); // 不该处理的消息不记
    });
    /** rel62-intent-persist：新窗口继承全局最近意图（lastOpen）——前面的用例开过页内 → 先在一次性窗口里收起一次，让「最近意图 = 收起」（这些用例的前提是「新窗口页内关着」，测的不是继承） */
    let lcW = 9000; const lastClosed = async () => { const w = ++lcW, t = w * 10, u = "https://lc.test/"; const p = port(t, w, u); L.conn![0]!(p); p.say({ type: "hello", proto: 1, frame: "none" }); await tick(); L.act![0]!({ tabId: t, windowId: w }); if (last(p)?.show) L.menu![0]!({ menuItemId: "inpage-toggle-page" }, { id: t, windowId: w, url: u }); expect(last(p)).toMatchObject({ show: false }); };
    test("Alt+T 探针（patch 07）：页内侧栏在用（意图开 + 原生没在显示）才回答 true；原生开着 / 关掉意图 / 别的窗口 = false；原生关掉后恢复", async () => {
        const HM = await import("../src/api/HostMode"); await lastClosed();
        const p = port(60, 12, "https://pr.test/"); L.conn![0]!(p); p.say({ type: "hello", proto: 1, frame: "none" }); await tick(); L.act![0]!({ tabId: 60, windowId: 12 });
        expect(HM.inpageActiveFor(12)).toBe(false); expect(HM.inpageActiveFor(undefined)).toBe(false);
        L.menu![0]!({ menuItemId: "inpage-toggle-page" }, { id: 60, windowId: 12, url: "https://pr.test/" }); expect(last(p)).toMatchObject({ show: true });
        expect(HM.inpageActiveFor(12)).toBe(true); expect(HM.inpageActiveFor(13)).toBe(true); // rel62-intent-persist：没记录的窗口继承全局最近意图（刚在 12 里展开 → 新窗口也展开）；修前 = false
        L.msg![0]!({ type: "inpage:ensure-native", kind: "navigate", url: "chrome://settings" }, { id: "x", tab: { id: 60, windowId: 12 } }); await tick();
        const pp = panelPort(12); L.conn![0]!(pp); await tick(); expect(HM.inpageActiveFor(12)).toBe(false); // 原生在显示：Alt+T 弹窗不需要 via（本来就在原生里）
        pp.drop(); await tick(); expect(HM.inpageActiveFor(12)).toBe(true); // 原生被关：恢复页内
        L.menu![0]!({ menuItemId: "inpage-toggle-page" }, { id: 60, windowId: 12, url: "https://pr.test/" }); expect(HM.inpageActiveFor(12)).toBe(false); // 用户把页内收起
    });
    test("ensure-native 之后：页内收起；原生面板关闭时恢复为原来的页内意图（restoreInpageOnClose）", async () => {
        await lastClosed(); const p = port(40, 11, "https://r.test/"); L.conn![0]!(p); p.say({ type: "hello", proto: 1, frame: "none" }); await tick(); L.act![0]!({ tabId: 40, windowId: 11 });
        L.menu![0]!({ menuItemId: "inpage-toggle-page" }, { id: 40, windowId: 11, url: "https://r.test/" }); expect(last(p)).toMatchObject({ show: true });
        L.msg![0]!({ type: "inpage:ensure-native", kind: "navigate", url: "https://chromewebstore.google.com/" }, { id: "x", tab: { id: 40, windowId: 11 } }); await tick();
        expect(last(p)).toMatchObject({ show: false });
        const pp = panelPort(11); L.conn![0]!(pp); await tick(); pp.drop(); await tick();
        expect(last(p)).toMatchObject({ show: true });
    });
    test("旧的 \"tab\" 值（迁移之前 / 插件停用期间还留在存储里）：按 off 处理——首次手势消息什么都不做、状态里 prewarm:false、绝不 setOptions / open（不并入 window）", async () => {
        prefs.prewarm = "tab";
        const p = port(20, 9, "https://p.test/"); L.conn![0]!(p); p.say({ type: "hello", proto: 1, frame: "none" }); await tick(); L.act![0]!({ tabId: 20, windowId: 9 });
        calls.length = 0; L.msg![0]!({ type: "inpage:prewarm", source: "host" }, { id: "x", tab: { id: 20, windowId: 9, url: "https://p.test/" } });
        await tick(); expect(calls).toEqual([]); expect(last(p)).toMatchObject({ prewarm: false, warm: false });
        expect(L.nav ?? []).toEqual([]); // 不再监听 webNavigation（预测信号只服务标签级预热）
        prefs.prewarm = "off";
    });
    test("预热 off：首次手势消息什么都不做", () => {
        prefs.prewarm = "off"; calls.length = 0; L.msg![0]!({ type: "inpage:prewarm", source: "host" }, { id: "x", tab: { id: 21, windowId: 9, url: "https://p.test/" } }); expect(calls).toEqual([]);
    });
    test("预热 window 方式：只 open:10（没有任何 setOptions）；原生开着时页内收起，关闭后恢复", async () => {
        prefs.prewarm = "window"; await lastClosed();
        const p = port(30, 10, "https://w.test/"); L.conn![0]!(p); p.say({ type: "hello", proto: 1, frame: "none" }); await tick(); L.act![0]!({ tabId: 30, windowId: 10 });
        L.menu![0]!({ menuItemId: "inpage-toggle-page" }, { id: 30, windowId: 10, url: "https://w.test/" }); expect(last(p)).toMatchObject({ show: true });
        calls.length = 0; L.msg![0]!({ type: "inpage:prewarm", source: "host" }, { id: "x", tab: { id: 30, windowId: 10, url: "https://w.test/" } });
        expect(calls).toEqual(["open:10"]); await tick(); expect(last(p)).toMatchObject({ show: false });
        const pp = panelPort(10); L.conn![0]!(pp); await tick(); pp.drop(); await tick(); expect(last(p)).toMatchObject({ show: true }); prefs.prewarm = "off";
    });
    /* —— 预热 window → off（设置变化）：只关「预热打开的」原生（close({windowId})）；ensure / 用户自己开的 / 方式仍是 window 的不动 —— */
    const settingsChanged = () => { BG.refreshBackground(); };
    const closes = (w: number) => calls.filter(c => c === "close:" + w);
    const prewarmMsg = (tabId: number, w: number, url: string) => L.msg![0]!({ type: "inpage:prewarm", source: "host" }, { id: "x", tab: { id: tabId, windowId: w, url } });
    const setupWin = async (tabId: number, w: number, url: string, show: boolean) => {
        await lastClosed();
        const p = port(tabId, w, url); L.conn![0]!(p); p.say({ type: "hello", proto: 1, frame: "none" }); await tick(); L.act![0]!({ tabId, windowId: w });
        if (show) { L.menu![0]!({ menuItemId: "inpage-toggle-page" }, { id: tabId, windowId: w, url }); expect(last(p)).toMatchObject({ show: true }); }
        return p;
    };
    test("④ 预热（window）开的原生：设置改成 off → close:w（一次）；页内原本开着 → 原生关后恢复；再改一次设置不重复 close", async () => {
        prefs.prewarm = "window"; const w = 21;
        const p = await setupWin(210, w, "https://off1.test/", true);
        calls.length = 0; prewarmMsg(210, w, "https://off1.test/"); expect(calls).toEqual(["open:21"]); await tick(); expect(last(p)).toMatchObject({ show: false });
        const pp = panelPort(w); L.conn![0]!(pp); await tick();
        settingsChanged(); expect(closes(w)).toEqual([]); // 方式还是 window：什么都不关
        prefs.prewarm = "off"; settingsChanged(); expect(closes(w)).toEqual(["close:21"]);
        pp.drop(); await tick(); expect(last(p)).toMatchObject({ show: true }); // restoreOnClose：恢复预热前的页内
        settingsChanged(); expect(closes(w).length).toBe(1);
    });
    test("④ 预热开的原生、页内本来就收起：改成 off → 关原生，页内保持收起（回到预热之前的状态）", async () => {
        prefs.prewarm = "window"; const w = 22;
        const p = await setupWin(220, w, "https://off2.test/", false);
        calls.length = 0; prewarmMsg(220, w, "https://off2.test/"); expect(calls).toEqual(["open:22"]); await tick();
        const pp = panelPort(w); L.conn![0]!(pp); await tick();
        prefs.prewarm = "off"; settingsChanged(); expect(closes(w)).toEqual(["close:22"]);
        pp.drop(); await tick(); expect(last(p)).toMatchObject({ show: false });
    });
    test("④ 不影响不是预热开的原生：ensure-native（让位）/ 用户自己开的（只有面板端口、没有我们的 open）→ 改成 off 也不 close", async () => {
        prefs.prewarm = "window";
        const e = await setupWin(230, 23, "https://off3.test/", true); calls.length = 0;
        L.msg![0]!({ type: "inpage:ensure-native", kind: "navigate", url: "chrome://settings" }, { id: "x", tab: { id: 230, windowId: 23 } }); expect(calls).toEqual(["open:23"]); await tick();
        const ep = panelPort(23); L.conn![0]!(ep); await tick(); expect(last(e)).toMatchObject({ show: false });
        await setupWin(240, 24, "https://off4.test/", false); const up = panelPort(24); L.conn![0]!(up); await tick(); // 用户自己开的原生
        calls.length = 0; prefs.prewarm = "off"; settingsChanged(); settingsChanged(); expect(calls.filter(c => c.startsWith("close"))).toEqual([]);
    });
    test("④ 预热开的原生被用户关掉后，用户又自己开了一个 → 标记已作废，改成 off 不关；open 失败也不留标记", async () => {
        prefs.prewarm = "window"; const w = 25;
        await setupWin(250, w, "https://off5.test/", false);
        calls.length = 0; prewarmMsg(250, w, "https://off5.test/"); await tick();
        const p1 = panelPort(w); L.conn![0]!(p1); await tick(); p1.drop(); await tick(); // 用户关掉预热开的
        const p2 = panelPort(w); L.conn![0]!(p2); await tick(); // 用户自己再开
        prefs.prewarm = "off"; calls.length = 0; settingsChanged(); expect(closes(w)).toEqual([]);
        // open 失败
        prefs.prewarm = "window"; const w2 = 26; await setupWin(260, w2, "https://off6.test/", false);
        const sp = (globalThis as any).chrome.sidePanel; const keepOpen = sp.open; sp.open = async () => { throw new Error("user gesture"); };
        const ce = console.error; console.error = () => undefined;
        try { prewarmMsg(260, w2, "https://off6.test/"); await tick(); } finally { sp.open = keepOpen; console.error = ce; }
        const q = panelPort(w2); L.conn![0]!(q); await tick();
        prefs.prewarm = "off"; calls.length = 0; settingsChanged(); expect(closes(w2)).toEqual([]);
    });
    test("④ open 已发出、面板端口还没连上（pending）时改成 off → 也发 close；窗口里 settings 其它项变化（方式仍 window）不关", async () => {
        prefs.prewarm = "window"; const w = 27;
        await setupWin(270, w, "https://off7.test/", false);
        calls.length = 0; prewarmMsg(270, w, "https://off7.test/"); await tick(); expect(calls).toEqual(["open:27"]);
        settingsChanged(); expect(closes(w)).toEqual([]); // 方式仍是 window
        prefs.prewarm = "off"; settingsChanged(); expect(closes(w)).toEqual(["close:27"]);
    });
    test("迁移（真实 settings 模块 + 真实设置存储）：\"tab\" / 旧布尔 / 未知值 → 删键（回到默认 off，下拉不出空白）；\"off\" / \"window\" / 未设置 → 不动；其它设置不受影响", async () => {
        const { migratePrewarmTab } = realSettings as { migratePrewarmTab: () => boolean };
        const { SettingsStore } = await import("../src/api/Settings");
        const set = (v: Record<string, unknown>) => { SettingsStore.plain.plugins.InpageSidebar = { enabled: true, ...v } as never; };
        const cur = () => SettingsStore.plain.plugins.InpageSidebar as Record<string, unknown>;
        for (const old of ["tab", true, false, "Tab", "x", 1, null]) {
            set({ prewarm: old, width: 5 }); expect(migratePrewarmTab()).toBe(true);
            expect("prewarm" in cur()).toBe(false); expect(cur().width).toBe(5); expect(cur().enabled).toBe(true);
            expect(migratePrewarmTab()).toBe(false); // 幂等
        }
        for (const keep of ["off", "window"]) { set({ prewarm: keep }); expect(migratePrewarmTab()).toBe(false); expect(cur().prewarm).toBe(keep); }
        set({}); expect(migratePrewarmTab()).toBe(false); expect("prewarm" in cur()).toBe(false);
        // 设置项的选项只剩 off / window，且迁移后的值（缺省）落在默认项 off 上：Dropdown 的 label 查找一定命中
        const { PREWARM } = await import("../src/plugins/inpageSidebar/constants");
        const opts = (await import("node:fs")).readFileSync(resolve(DIR, "settings.ts"), "utf8");
        expect([...opts.matchAll(/value: "(\w+)", default: PREWARM\.defaultMode === "(\w+)"/g)].map(m => [m[1], m[2]])).toEqual([["off", "off"], ["window", "window"]]); expect(PREWARM.defaultMode).toBe("off");
        delete SettingsStore.plain.plugins.InpageSidebar;
    });
    test("清理：路由撤销、菜单移除、端口收到 stale、不动原生侧栏设置", () => {
        const cleanups = (globalThis as { __cleanups?: unknown }).__cleanups as Array<() => void>; expect(Array.isArray(cleanups)).toBe(true);
        calls.length = 0; for (const c of cleanups) c(); expect(calls.some(c => c.includes('"enabled":false'))).toBe(false); // 清理不调 setOptions，更不会 disable 任何标签
        return import("../src/api/HostMode").then(HM => { expect(HM.inpageActiveFor(12)).toBe(false); }); // patch 07：探针随插件 cleanup 撤掉（插件关闭 = Alt+T 弹窗不带 via）
    });
});

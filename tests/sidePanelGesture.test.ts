import { describe, expect, test, mock, afterAll } from "bun:test";
// 展开真实导出（含 safe），只覆盖 recordError；测试结束后恢复真实模块，避免 mock 泄漏到其它测试文件
const realErrorLog = { ...(await import("../src/api/ErrorLog")) };
mock.module("@api/ErrorLog", () => ({ ...realErrorLog, recordError: () => { } }));
afterAll(() => { mock.module("@api/ErrorLog", () => realErrorLog); mock.restore(); });
const calls: string[] = []; const L: Record<string, Function[]> = {};
const ev = (k: string) => ({ addListener: (f: Function) => { (L[k] ??= []).push(f); } });
(globalThis as any).chrome = {
    sidePanel: { open: async (o: any) => { calls.push("open:" + o.windowId); }, close: async (o: any) => { calls.push("close:" + o.windowId); }, setOptions: async () => { } },
    commands: { onCommand: ev("cmd") }, runtime: { onConnect: ev("conn"), lastError: undefined },
    windows: { onFocusChanged: ev("focus"), WINDOW_ID_NONE: -1, getLastFocused: async () => ({ id: 7 }) },
};
const G = await import("../src/api/SidePanelGesture");
G.installSidePanelGesture();
describe("SidePanelGesture：手势里同步开 / 关；手势外的 open 记为违规", () => {
    test("toggle-sidebar 命令：关着 → 同一调用栈里 open，无违规", () => {
        L.cmd![0]!("toggle-sidebar", { windowId: 3 });
        expect(calls).toEqual(["open:3"]); expect(G.violations.length).toBe(0);
    });
    test("侧栏连上后再按 → close（不需要手势）", () => {
        const port = { name: "panel:3", onMessage: ev("pm"), onDisconnect: ev("pd") };
        L.conn![0]!(port); expect(G.isPanelOpen(3)).toBe(true);
        L.cmd![0]!("toggle-sidebar", { windowId: 3 }); expect(calls.at(-1)).toBe("close:3"); expect(G.isPanelOpen(3)).toBe(false);
    });
    test("无手势的请求只关不开；手势外直接调用 open → 违规", async () => {
        G.requestToggleNoGesture(5); expect(calls.at(-1)).toBe("close:3");
        await chrome.sidePanel.open({ windowId: 9 });
        expect(G.violations.length).toBe(1);
    });
});

describe("SidePanelGesture · setGestureRouter（页内侧边栏，patch 02）：只路由 commands.onCommand", () => {
    test("只有 commands / onConnect / windows.onFocusChanged 三类顶层监听：action.onClicked / contextMenus.onClicked 不经本模块", () => {
        expect(Object.keys(L).filter(k => !["cmd", "conn", "focus", "pm", "pd"].includes(k))).toEqual([]); // pm / pd 是 port 自己的 onMessage / onDisconnect
        expect(L.cmd!.length).toBe(1);
    });
    test("路由返回 inpage：不碰原生（没有 open / close）；路由收到命令带的 tab", () => {
        calls.length = 0; const seen: unknown[] = [];
        G.setGestureRouter(tab => { seen.push(tab); return "inpage"; });
        L.cmd![0]!("toggle-sidebar", { windowId: 4, id: 11, url: "https://a.test/" });
        expect(calls).toEqual([]); expect(seen).toEqual([{ windowId: 4, id: 11, url: "https://a.test/" }]); expect(G.violations.length).toBe(1); // 1 = 上一组里故意触发的那次
    });
    test("路由返回 native：同一调用栈里 open（经 openPanelInGesture，不新增违规）", () => {
        calls.length = 0; G.setGestureRouter(() => "native");
        L.cmd![0]!("toggle-sidebar", { windowId: 4 });
        expect(calls).toEqual(["open:4"]); expect(G.violations.length).toBe(1);
    });
    test("路由抛错：回落原生，不外泄", () => {
        calls.length = 0; G.setGestureRouter(() => { throw new Error("boom"); });
        expect(() => L.cmd![0]!("toggle-sidebar", { windowId: 5 })).not.toThrow();
        expect(calls).toEqual(["open:5"]);
    });
    test("别的命令不进路由", () => {
        calls.length = 0; let n = 0; G.setGestureRouter(() => { n++; return "inpage"; });
        L.cmd![0]!("open-command-bar", { windowId: 4 }); expect(n).toBe(0); expect(calls).toEqual([]);
    });
    test("路由撤销（undefined）= 冷启动：走原生并记下这次手势，takeColdGesture 取走即清", () => {
        calls.length = 0; G.setGestureRouter(undefined); G.takeColdGesture();
        L.cmd![0]!("toggle-sidebar", { windowId: 6, id: 21, url: "https://b.test/" });
        expect(calls).toEqual(["open:6"]);
        const c = G.takeColdGesture(); expect(c).toMatchObject({ windowId: 6, tabId: 21, url: "https://b.test/", opened: true });
        expect(G.takeColdGesture()).toBeUndefined();
    });
    test("closePanel 已导出：关闭不需要手势（走 sidePanel.close）", () => {
        calls.length = 0; G.closePanel(8); expect(calls).toEqual(["close:8"]);
    });
});

describe("openPanelInGesture 的 onResult 回调（patch 02，页内「切到 Chrome 侧边栏」按钮的失败回落用）", () => {
    test("open 成功 → onResult(true)；仍然同一调用栈里 open、不新增违规", async () => {
        calls.length = 0; const before = G.violations.length; const r: boolean[] = [];
        G.openPanelInGesture(12, ok => r.push(ok)); expect(calls).toEqual(["open:12"]);
        await Promise.resolve(); await Promise.resolve(); expect(r).toEqual([true]); expect(G.violations.length).toBe(before);
    });
    test("open 被拒（例如手势已过期）→ onResult(false)，不外泄", async () => {
        const sp = chrome.sidePanel as unknown as { open: (o: unknown) => Promise<void> }; const keep = sp.open;
        sp.open = async () => { throw new Error("user gesture required"); }; const r: boolean[] = [];
        try { G.openPanelInGesture(13, ok => r.push(ok)); await Promise.resolve(); await Promise.resolve(); } finally { sp.open = keep; }
        expect(r).toEqual([false]);
    });
    test("不传 onResult 的旧调用方式不变", () => { calls.length = 0; G.openPanelInGesture(14); expect(calls).toEqual(["open:14"]); });
});

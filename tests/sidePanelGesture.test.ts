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

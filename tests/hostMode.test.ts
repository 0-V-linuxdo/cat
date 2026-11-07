import { afterEach, describe, expect, test } from "bun:test";
import { currentWindow, currentWindowId, destinationNeedsNative, ENSURE_NATIVE_MSG, ensureNativeBeforeNavigate, hostTabId, hostWindowId, inpageContext, isInpageHost, pageKind, viaInpage } from "../src/api/HostMode";

describe("HostMode：?host=inpage 解析", () => {
    test("只有 host=inpage 才算页内宿主；popup / win / 空都不是", () => {
        expect(isInpageHost("?host=inpage&win=3&tab=9")).toBe(true);
        expect(isInpageHost("?win=3")).toBe(false); expect(isInpageHost("?popup=1")).toBe(false); expect(isInpageHost("")).toBe(false); expect(isInpageHost("?host=other")).toBe(false);
    });
    test("win / tab 只接受正整数；非 inpage 下一律 undefined（?win= 仍由 tabState 自己读）", () => {
        expect(hostWindowId("?host=inpage&win=3&tab=9")).toBe(3); expect(hostTabId("?host=inpage&win=3&tab=9")).toBe(9);
        for (const bad of ["?host=inpage&win=0", "?host=inpage&win=-1", "?host=inpage&win=1.5", "?host=inpage&win=abc", "?host=inpage"]) expect(hostWindowId(bad)).toBeUndefined();
        expect(hostWindowId("?win=3")).toBeUndefined(); expect(hostTabId("?tab=9")).toBeUndefined();
    });
    test("?host=inpage 与 ?win= / ?popup= 同时出现互不干扰", () => {
        expect(isInpageHost("?win=3&host=inpage")).toBe(true); expect(hostWindowId("?win=3&host=inpage&popup=1")).toBe(3);
    });
});

describe("HostMode：currentWindow()", () => {
    const g = globalThis as { chrome?: unknown; location?: unknown };
    const oldChrome = g.chrome, oldLoc = Object.getOwnPropertyDescriptor(g, "location");
    const setLoc = (search: string) => Object.defineProperty(g, "location", { value: { search }, configurable: true, writable: true });
    afterEach(() => { g.chrome = oldChrome; if (oldLoc) Object.defineProperty(g, "location", oldLoc); else delete g.location; });
    const mk = () => { const calls: string[] = []; g.chrome = { windows: { getCurrent: async () => { calls.push("getCurrent"); return { id: 1 }; }, get: async (id: number) => { calls.push("get:" + id); return { id }; } } }; return calls; };
    test("非 inpage：原样 getCurrent（原生侧栏 / popup 行为不变）", async () => {
        const calls = mk(); setLoc("?popup=1"); expect((await currentWindow()).id).toBe(1); expect(await currentWindowId()).toBe(1); expect(calls).toEqual(["getCurrent", "getCurrent"]);
    });
    test("inpage 且带 win：走 windows.get(win)，不调 getCurrent；currentWindowId 同步已知", async () => {
        const calls = mk(); setLoc("?host=inpage&win=7&tab=2"); expect((await currentWindow()).id).toBe(7); expect(await currentWindowId()).toBe(7); expect(calls).toEqual(["get:7"]);
    });
    test("inpage 但 win 缺失 / 非法：回落 getCurrent（E5：iframe 里返回宿主窗口）", async () => {
        const calls = mk(); setLoc("?host=inpage"); expect((await currentWindow()).id).toBe(1); expect(calls).toEqual(["getCurrent"]);
    });
});

describe("HostMode：pageKind / destinationNeedsNative（受限页判定，单一来源）", () => {
    test("pageKind：http(s) 才 ok；chrome:// / 扩展页 / file / about / 商店 / pdf / 空都不 ok", () => {
        expect(pageKind("https://a.com/x")).toBe("ok"); expect(pageKind("http://a.com")).toBe("ok");
        for (const u of ["chrome://settings", "chrome://newtab/", "chrome-extension://abc/split.html", "file:///a", "about:blank", "view-source:https://a.com"]) expect(pageKind(u)).toBe("scheme");
        expect(pageKind("https://chromewebstore.google.com/detail/x")).toBe("webstore"); expect(pageKind("https://chrome.google.com/webstore/x")).toBe("webstore");
        expect(pageKind("https://a.com/b.PDF")).toBe("pdf"); expect(pageKind(undefined)).toBe("no-url"); expect(pageKind("not a url")).toBe("no-url");
    });
    test("destinationNeedsNative：新建标签无 url = newtab（受限）；激活 / 导航拿不到 url = 不动", () => {
        expect(destinationNeedsNative(undefined, "create")).toBe(true); expect(destinationNeedsNative("", "create")).toBe(true);
        expect(destinationNeedsNative(undefined, "activate")).toBe(false); expect(destinationNeedsNative(null, "navigate")).toBe(false);
        expect(destinationNeedsNative("https://a.com", "create")).toBe(false); expect(destinationNeedsNative("chrome://history", "navigate")).toBe(true);
        expect(destinationNeedsNative("chrome-extension://x/split.html?u=1", "navigate")).toBe(true); expect(destinationNeedsNative("https://a.com/doc.pdf", "activate")).toBe(true);
    });
});

describe("HostMode：ensureNativeBeforeNavigate", () => {
    const g = globalThis as { chrome?: unknown };
    const oldChrome = g.chrome;
    afterEach(() => { g.chrome = oldChrome; });
    const mk = () => { const sent: unknown[] = []; g.chrome = { runtime: { sendMessage: (m: unknown) => { sent.push(m); return Promise.resolve(undefined); } } }; return sent; };
    test("上下文解析：host=inpage 或 via=inpage 才算页内上下文（via 不改变 isInpageHost）", () => {
        expect(inpageContext("?host=inpage&win=1")).toBe(true); expect(inpageContext("?popup=commandBar&win=1&via=inpage")).toBe(true);
        expect(inpageContext("?popup=commandBar&win=1")).toBe(false); expect(inpageContext("")).toBe(false);
        expect(viaInpage("?via=inpage")).toBe(true); expect(viaInpage("?via=x")).toBe(false);
        expect(isInpageHost("?popup=commandBar&win=1&via=inpage")).toBe(false); // 弹窗里 currentWindow() 仍走 getCurrent
    });
    test("iframe 里去受限页：同步发出一条消息（返回时已发出），带 kind / url / windowId", () => {
        const sent = mk();
        expect(ensureNativeBeforeNavigate("chrome://history", "create", undefined, "?host=inpage&win=7&tab=2")).toBe(true);
        expect(sent).toEqual([{ type: ENSURE_NATIVE_MSG, kind: "create", url: "chrome://history", windowId: 7 }]);
    });
    test("激活标签带 tabId 一起发（SW 用它判断目标是不是被预热禁过的标签）", () => {
        const sent = mk();
        expect(ensureNativeBeforeNavigate("chrome://settings", "activate", 42, "?host=inpage&win=7")).toBe(true);
        expect(sent).toEqual([{ type: ENSURE_NATIVE_MSG, kind: "activate", url: "chrome://settings", tabId: 42, windowId: 7 }]);
    });
    test("新建标签无 url（= newtab）发；激活无 url 不发", () => {
        const sent = mk();
        expect(ensureNativeBeforeNavigate(undefined, "create", undefined, "?host=inpage&win=7")).toBe(true);
        expect(ensureNativeBeforeNavigate(undefined, "activate", undefined, "?host=inpage&win=7")).toBe(false);
        expect(sent).toEqual([{ type: ENSURE_NATIVE_MSG, kind: "create", windowId: 7 }]);
    });
    test("去普通网页 / 不在页内上下文（原生侧栏 / 后台 / 普通弹窗）：不发，返回 false", () => {
        const sent = mk();
        expect(ensureNativeBeforeNavigate("https://a.com", "create", undefined, "?host=inpage&win=7")).toBe(false);
        expect(ensureNativeBeforeNavigate("chrome://settings", "navigate", undefined, "")).toBe(false);
        expect(ensureNativeBeforeNavigate("chrome://settings", "navigate", undefined, "?popup=commandBar&win=7")).toBe(false);
        expect(sent).toEqual([]);
    });
    test("命令栏弹窗（via=inpage）：带 ?win= 的宿主窗口发出", () => {
        const sent = mk();
        expect(ensureNativeBeforeNavigate("chrome://extensions", "navigate", undefined, "?popup=commandBar&win=5&via=inpage")).toBe(true);
        expect(sent).toEqual([{ type: ENSURE_NATIVE_MSG, kind: "navigate", url: "chrome://extensions", windowId: 5 }]);
    });
    test("sendMessage 同步抛错 / 异步拒绝：不外泄（导航照常继续）；chrome 不存在也不抛", () => {
        g.chrome = { runtime: { sendMessage: () => { throw new Error("Extension context invalidated."); } } };
        expect(() => ensureNativeBeforeNavigate("chrome://settings", "navigate", undefined, "?host=inpage&win=1")).not.toThrow();
        g.chrome = { runtime: { sendMessage: () => Promise.reject(new Error("closed")) } };
        expect(() => ensureNativeBeforeNavigate("chrome://settings", "navigate", undefined, "?host=inpage&win=1")).not.toThrow();
        delete g.chrome;
        expect(ensureNativeBeforeNavigate("chrome://settings", "navigate", undefined, "?host=inpage&win=1")).toBe(false);
    });
});

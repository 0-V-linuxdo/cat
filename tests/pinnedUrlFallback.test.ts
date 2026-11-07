/* 补丁 pinned-url-fallback：固定项网址的 pendingUrl 兜底（空串用 ||）+ reattachByUrl 等 store ready —— 复制到 tests/ */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { createPluginStore } from "../src/api/Storage";
import * as mod from "../src/plugins/tabs/pinnedTabs/model";
import { reattachByUrl } from "../src/plugins/tabs/pinnedTabs/reattach";

const g = globalThis as any;
const origChrome = g.chrome;
const stored: Record<string, unknown> = {};
let tabsNow: any[] = [];

// 全局 chrome 桩（bun test 同进程共享，beforeAll 装、afterAll 还原）。存储读取故意延迟：模拟“tabs.query 先返回、storage 后返回”的启动竞态
const stub = () => ({
    storage: {
        local: {
            get: async (k: string) => { await new Promise(r => setTimeout(r, 30)); return k in stored ? { [k]: structuredClone(stored[k]) } : {}; },
            set: async (o: Record<string, unknown>) => { Object.assign(stored, structuredClone(o)); },
        },
        onChanged: { addListener: () => { } },
    },
    tabs: { query: async () => structuredClone(tabsNow) },
});
const seed = () => {
    stored["data:pinned-t"] = { bySpace: { s1: [{ id: "a", kind: "tab", url: "https://a.test/x", tabId: 101 }, { id: "f", kind: "folder", children: [{ id: "b", kind: "tab", url: "https://b.test/", tabId: 102 }] }] }, collapsed: {} };
    stored["data:favorites-t"] = { items: [{ id: "fv", url: "https://c.test/", title: "c", tabId: 103 }] };
};
const mkStores = () => ({ pinned: createPluginStore<mod.PinnedData>("pinned-t", () => ({ bySpace: {}, collapsed: {} })), favs: createPluginStore<{ items: any[] }>("favorites-t", () => ({ items: [] })) });
beforeAll(() => { g.chrome = stub(); });
afterAll(() => { g.chrome = origChrome; });

describe("tabUrl：空串 url 退到 pendingUrl", () => {
    test("url 为空串 → pendingUrl（?? 不会落到 pendingUrl）", () => {
        expect(mod.tabUrl({ url: "", pendingUrl: "https://p.test/" })).toBe("https://p.test/");
        expect(mod.tabUrl({ url: undefined, pendingUrl: "https://p.test/" })).toBe("https://p.test/");
    });
    test("url 有值 → 用 url；都没有 → undefined（不是空串）", () => {
        expect(mod.tabUrl({ url: "https://u.test/", pendingUrl: "https://p.test/" })).toBe("https://u.test/");
        expect(mod.tabUrl({ url: "", pendingUrl: "" })).toBeUndefined();
        expect(mod.tabUrl(undefined)).toBeUndefined();
    });
});

describe("pinNodeFromTab：固定仍在首次加载的标签", () => {
    test("url 为空串、有 pendingUrl → 存 pendingUrl", () => {
        const n = mod.pinNodeFromTab({ id: 7, url: "", pendingUrl: "https://p.test/", title: "" }, "n1");
        expect(n).toEqual({ id: "n1", kind: "tab", url: "https://p.test/", title: "", tabId: 7 });
    });
    test("已提交的标签 → 存 url；都为空 → url undefined（不存空串）", () => {
        expect(mod.pinNodeFromTab({ id: 1, url: "https://u.test/", title: "T" }, "n").url).toBe("https://u.test/");
        expect(mod.pinNodeFromTab({ id: 1, url: "" }, "n").url).toBeUndefined();
    });
});

describe("reattachByUrl", () => {
    test("启动竞态：tabs.query 立即返回、store 稍后才读完 → 仍挂接（等 ready），不是 return 0", async () => {
        seed();
        const s = mkStores(); // 此刻 store 还没读完存储（ready 未决），get() 还是空默认值
        expect(s.pinned.get().bySpace).toEqual({});
        tabsNow = [{ id: 201, url: "https://a.test/x#h" }, { id: 202, url: "https://b.test" }, { id: 203, url: "https://c.test/" }];
        const n = await reattachByUrl(s);
        expect(n).toBe(3);
        const d = s.pinned.get().bySpace.s1;
        expect(d[0].tabId).toBe(201);
        expect(d[1].children![0].tabId).toBe(202);
        expect(s.favs.get().items[0].tabId).toBe(203);
    });
    test("恢复出来的标签 url 是空串、只有 pendingUrl → 也能按网址挂回", async () => {
        seed();
        const s = mkStores();
        tabsNow = [{ id: 301, url: "", pendingUrl: "https://a.test/x" }, { id: 302, url: "", pendingUrl: "https://b.test/" }];
        const n = await reattachByUrl(s);
        expect(n).toBe(2);
        expect(s.pinned.get().bySpace.s1[0].tabId).toBe(301);
        expect(s.pinned.get().bySpace.s1[1].children![0].tabId).toBe(302);
        expect(s.favs.get().items[0].tabId).toBeUndefined();
    });
});

describe("源码守卫：同类写法不再出现在 pinnedTabs/*", () => {
    const rd = (f: string) => readFileSync(`src/plugins/tabs/pinnedTabs/${f}`, "utf8");
    test("没有 tab.url ?? / url ?? pendingUrl / 直接存 tab.url", () => {
        for (const f of ["index.ts", "reattach.ts", "dupNode.ts", "editPinnedMenu.ts", "model.ts"]) {
            const s = rd(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
            expect(s).not.toMatch(/\.url \?\? [\w.?]*pendingUrl/);
            expect(s).not.toMatch(/tab\??\.url \?\? n\.url/);
            expect(s).not.toMatch(/kind: "tab", url: tab\.url/);
        }
    });
    test("reattachByUrl 先 await 两个 store 的 ready，再 tabs.query", () => {
        const s = rd("reattach.ts");
        expect(s.indexOf("await Promise.all([pinnedStore.ready, favStore.ready])")).toBeGreaterThan(0);
        expect(s.indexOf("pinnedStore.ready")).toBeLessThan(s.indexOf("chrome.tabs.query"));
    });
    test("pinTab / 拖放 / openNode 用 pinNodeFromTab 与 || 兜底", () => {
        const s = rd("index.ts");
        expect(s.match(/pinNodeFromTab\(tab, uid\(\)\)/g)?.length).toBe(2);
        expect(s).toContain('n.url || "about:blank"');
    });
});

test("rel48 ②：menu.ts / multiSelect 的 url 回退用 ||（首次导航未提交时 url 是空串，?? 不会回退）", () => {
    const menu = readFileSync("src/plugins/spaces/spaceManager/menu.ts", "utf8"), ms = readFileSync("src/plugins/tabs/multiSelect/index.ts", "utf8");
    expect(menu).toContain('/^(https?|file|chrome):/.test(t.url || t.pendingUrl || "")');
    expect(menu).toContain("url: t.url || t.pendingUrl, title");
    expect(menu).not.toContain("t.url ?? t.pendingUrl");
    expect(ms).toContain("getTab(n.tabId)?.url || n.url");
    expect(ms).not.toContain("getTab(n.tabId)?.url ?? n.url");
});

/* 补丁 rel63-fav-reattach（rel63 #2）：
 * (a) reattachByUrl 只在真的浏览器重启后跑（storage.session 标记 + 窗口），不再每次 panel.start 都跑；
 * (b) 收藏 / 固定项绑定的标签被关掉 → tabs.onRemoved 清 tabId（窗口整个关闭不清），撤销重开按 closedTabId 重新关联。
 * 复现（rel63-logs/rootcause.md §2、repro/r63.ts A0–A4）：关掉收藏自己的标签后留下死 id → 下一个 panel.start 的 reattachByUrl 把无关的同网址 Today 标签吞进收藏。 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { createPluginStore } from "../src/api/Storage";
import type { PinnedData } from "../src/plugins/tabs/pinnedTabs/model";
import { REATTACH_SESSION_KEY, REATTACH_WINDOW_MS, planReattach, reattachByUrl, reattachOnRestart } from "../src/plugins/tabs/pinnedTabs/reattach";
import { clearClosedTabId, rebindReopened, shouldClearOnRemoved } from "../src/plugins/tabs/pinnedTabs/closedTab";
import { walk } from "../src/plugins/tabs/pinnedTabs/model";

const g = globalThis as any;
const origChrome = g.chrome;
const stored: Record<string, unknown> = {};
let tabsNow: any[] = [];
beforeAll(() => {
    g.chrome = {
        storage: {
            local: { get: async (k: string) => (k in stored ? { [k]: structuredClone(stored[k]) } : {}), set: async (o: Record<string, unknown>) => { Object.assign(stored, structuredClone(o)); } },
            onChanged: { addListener: () => { } },
        },
        tabs: { query: async () => structuredClone(tabsNow) },
    };
});
afterAll(() => { g.chrome = origChrome; });

/** 内存版 storage.session */
const mkSession = (init: Record<string, unknown> = {}) => {
    const m: Record<string, unknown> = { ...init };
    return { m, area: { get: async (k: string) => (k in m ? { [k]: m[k] } : {}), set: async (o: Record<string, unknown>) => { Object.assign(m, o); } } as any };
};
let seq = 0;
/** 第 2 节场景：收藏 fy 绑着已关闭的 900（死 id），T4=672 是同网址的普通 Today 标签 */
const mkScenario = () => {
    const k = `r63-${++seq}`;
    stored[`data:pinned-${k}`] = { bySpace: { s1: [{ id: "p", kind: "tab", url: "https://p.test/", tabId: 901 }] }, collapsed: {} };
    stored[`data:favorites-${k}`] = { items: [{ id: "fy", url: "https://yt.test/", title: "YT", tabId: 900 }] };
    tabsNow = [{ id: 672, url: "https://yt.test/#t=1" }, { id: 673, url: "https://p.test" }];
    return { pinned: createPluginStore<PinnedData>(`pinned-${k}`, () => ({ bySpace: {}, collapsed: {} })), favs: createPluginStore<{ items: any[] }>(`favorites-${k}`, () => ({ items: [] })) };
};

describe("(a) planReattach：会话标记决定要不要按网址重新挂接", () => {
    test("没有标记（浏览器刚重启 / 扩展刚重载）→ 跑，并写标记 {at: now}", () => {
        expect(planReattach(undefined, 1000)).toEqual({ run: true, mark: { at: 1000 } });
        expect(planReattach(null, 5)).toEqual({ run: true, mark: { at: 5 } });
        expect(planReattach({ at: "x" }, 7)).toEqual({ run: true, mark: { at: 7 } }); // 坏值 = 没有标记
    });
    test("有标记、在窗口内（重启时陆续启动的侧栏实例）→ 跑，不重写标记", () => {
        expect(planReattach({ at: 1000 }, 1000)).toEqual({ run: true });
        expect(planReattach({ at: 1000 }, 1000 + REATTACH_WINDOW_MS - 1)).toEqual({ run: true });
    });
    test("有标记、窗口外（会话中途的任何 panel.start）→ 不跑；时钟倒退也不跑", () => {
        expect(planReattach({ at: 1000 }, 1000 + REATTACH_WINDOW_MS)).toEqual({ run: false });
        expect(planReattach({ at: 1000 }, 999)).toEqual({ run: false });
    });
});

describe("(a) reattachOnRestart：会话中途的 panel.start 不再吞并同网址标签", () => {
    test("会话中途（标记在、窗口外）+ 收藏死 id + 同网址的未认领 Today 标签 → 不改绑，返回 skip，T4 不被吞", async () => {
        const s = mkScenario(); await Promise.all([s.pinned.ready, s.favs.ready]);
        const ss = mkSession({ [REATTACH_SESSION_KEY]: { at: 0 } });
        const r = await reattachOnRestart({ area: ss.area, now: () => REATTACH_WINDOW_MS + 5, run: () => reattachByUrl(s) });
        expect(r).toBe("skip");
        expect(s.favs.get().items[0].tabId).toBe(900); // 没被改成 672
        expect(s.pinned.get().bySpace.s1[0].tabId).toBe(901);
    });
    test("首次启动（没有标记 = 真的重启）→ 照常按网址挂回（重启场景不退化），并写下标记", async () => {
        const s = mkScenario();
        const ss = mkSession();
        const r = await reattachOnRestart({ area: ss.area, now: () => 42, run: () => reattachByUrl(s) });
        expect(r).toBe(2);
        expect(s.favs.get().items[0].tabId).toBe(672);
        expect(s.pinned.get().bySpace.s1[0].tabId).toBe(673);
        expect(ss.m[REATTACH_SESSION_KEY]).toEqual({ at: 42 });
    });
    test("同一会话第二个侧栏实例（窗口内）还能跑；之后（窗口外）不跑", async () => {
        const ss = mkSession(); let n = 0; const run = async () => (++n, 0);
        await reattachOnRestart({ area: ss.area, now: () => 100, run });
        await reattachOnRestart({ area: ss.area, now: () => 100 + 1000, run });
        await reattachOnRestart({ area: ss.area, now: () => 100 + REATTACH_WINDOW_MS + 1, run });
        expect(n).toBe(2);
    });
    test("没有 storage.session / 读失败 → 不跑（宁可不挂，也不误吞）/ 当作没有标记", async () => {
        let n = 0; const run = async () => (++n, 0);
        const saved = g.chrome.storage.session; delete g.chrome.storage.session;
        expect(await reattachOnRestart({ run })).toBe("skip");
        g.chrome.storage.session = saved;
        expect(n).toBe(0);
        const bad = { get: async () => { throw new Error("ctx invalidated"); }, set: async () => undefined } as any;
        expect(await reattachOnRestart({ area: bad, now: () => 1, run })).toBe(0);
        expect(n).toBe(1);
    });
});

describe("(b) 关标签清 tabId（closedTab.ts）", () => {
    test("clearClosedTabId：只清绑着该 id 的条目，旧 id 记到 closedTabId；其它条目不动", () => {
        const items: any[] = [{ id: "a", tabId: 5 }, { id: "b", tabId: 6 }, { id: "c" }];
        expect(clearClosedTabId(items, 5)).toBe(1);
        expect(items[0]).toEqual({ id: "a", closedTabId: 5 });
        expect(items[1]).toEqual({ id: "b", tabId: 6 });
        expect(items[2]).toEqual({ id: "c" });
        expect(clearClosedTabId(items, 99)).toBe(0);
    });
    test("固定项树（含文件夹）：walk 一遍即可清到文件夹里的项", () => {
        const d: PinnedData = { bySpace: { s: [{ id: "f", kind: "folder", children: [{ id: "x", kind: "tab", url: "u", tabId: 8 }] }, { id: "y", kind: "tab", tabId: 9 }] }, collapsed: {} };
        expect(clearClosedTabId(walk(d.bySpace.s), 8)).toBe(1);
        expect(d.bySpace.s[0].children![0].tabId).toBeUndefined();
        expect(d.bySpace.s[0].children![0].closedTabId).toBe(8);
        expect(d.bySpace.s[1].tabId).toBe(9);
    });
    test("shouldClearOnRemoved：普通关标签清；窗口整个关闭（含退出浏览器）不清，留给重启映射 / reattachOnRestart", () => {
        expect(shouldClearOnRemoved({ isWindowClosing: false })).toBe(true);
        expect(shouldClearOnRemoved(undefined)).toBe(true);
        expect(shouldClearOnRemoved({ isWindowClosing: true })).toBe(false);
    });
    test("清掉之后，即使 reattachByUrl 被误跑（手动 pin.reattach）也不会吞并同网址标签：没有死 id = 不 stale", async () => {
        const s = mkScenario(); await Promise.all([s.pinned.ready, s.favs.ready]);
        await s.favs.update(x => { clearClosedTabId(x.items, 900); });
        await s.pinned.update(x => { clearClosedTabId(walk(x.bySpace.s1), 901); });
        expect(await reattachByUrl(s)).toBe(0);
        expect(s.favs.get().items[0].tabId).toBeUndefined();
    });
    test("rebindReopened（撤销重开）：已清的按 closedTabId 改绑；还绑着旧 id 的照旧改；已绑了别的活标签的不动", () => {
        const items: any[] = [{ id: "a", closedTabId: 5 }, { id: "b", tabId: 6 }, { id: "c", tabId: 7, closedTabId: 5 }, { id: "d", closedTabId: 99 }];
        expect(rebindReopened(items, new Map([[5, 50], [6, 60]]))).toBe(2);
        expect(items[0]).toEqual({ id: "a", tabId: 50 });
        expect(items[1]).toEqual({ id: "b", tabId: 60 });
        expect(items[2]).toEqual({ id: "c", tabId: 7, closedTabId: 5 });
        expect(items[3]).toEqual({ id: "d", closedTabId: 99 });
    });
});

describe("源码约束", () => {
    const rd = (f: string) => readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    test("pinnedTabs panel.start 里不再无门直接调 reattachByUrl()，改走 reattachOnRestart()；pin.reattach 命令保留", () => {
        const s = rd("src/plugins/tabs/pinnedTabs/index.ts");
        const start = s.slice(s.indexOf("panel: {"), s.indexOf("panel: {") + 1200);
        expect(start).toContain("reattachOnRestart()");
        expect(start).not.toMatch(/void reattachByUrl\(\)/);
        expect(s).toContain('id: "pin.reattach"');
        expect(s.match(/reattachByUrl\(\)/g)?.length).toBe(1); // 只剩命令里那一处
    });
    test("reattachOnRestart 用 storage.session（重启清空、SW 回收不清），不用 storage.local", () => {
        const s = rd("src/plugins/tabs/pinnedTabs/reattach.ts");
        const fn = s.slice(s.indexOf("export async function reattachOnRestart"));
        expect(fn).toContain("chrome.storage?.session");
        expect(fn).not.toContain("storage.local");
    });
    test("favorites / pinnedTabs 的 background 都挂了 tabs.onRemoved → clearClosedTabId，并先判 shouldClearOnRemoved", () => {
        for (const f of ["src/plugins/spaces/favorites/index.ts", "src/plugins/tabs/pinnedTabs/index.ts"]) {
            const s = rd(f); const bg = s.slice(s.indexOf("background: {"), s.indexOf("panel: {", s.indexOf("background: {")));
            expect(bg).toContain('listen("tabs.onRemoved"');
            expect(bg).toContain("shouldClearOnRemoved(info)");
            expect(bg).toContain("clearClosedTabId(");
        }
    });
    test("undo reopenTabs 用 rebindReopened 同时重新关联固定项与收藏", () => {
        const s = rd("src/plugins/tabs/undo/index.ts");
        const fn = s.slice(s.indexOf("async function reopenTabs"), s.indexOf("async function reopenTabs") + 2000);
        expect(fn).toContain("rebindReopened(walk(list), map)");
        expect(fn).toContain("rebindReopened(x.items, map)");
    });
});

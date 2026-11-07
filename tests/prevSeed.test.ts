/* 补丁 rel64-prev-seed（rel64 #1，rel64-logs/rootcause.md §1）：
 * 页内侧栏每个标签一个 iframe；新标签 / 收藏打开 / ⌘Z 重开的标签的 iframe 在激活之后才生出来，PrevTab 原来 prev 为空 → 上一个标签行没有 .arc-prev。
 * 修法 A：启动时用 tab.lastAccessed 取同窗口第二近访问的标签做种子（没有 lastAccessed 回落旧行为）；onActivated 在 bootstrap 之前同步注册，启动期间的激活不丢。固定行不加 prev 底色。 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { applyActivation, pickSeedPrev, seedState } from "../src/api/prevSeed";

const r = (p: string) => readFileSync(new URL("../" + p, import.meta.url), "utf8");

describe("pickSeedPrev：同窗口第二近访问的标签", () => {
    test("取除当前标签外 lastAccessed 最大的", () => {
        const tabs = [{ id: 1, lastAccessed: 100 }, { id: 2, lastAccessed: 300 }, { id: 3, lastAccessed: 500, active: true }, { id: 4, lastAccessed: 200 }];
        expect(pickSeedPrev(tabs, 3)).toBe(2);
    });
    test("当前标签的 lastAccessed 不是最大（还没盖戳）也照样排除它", () => {
        expect(pickSeedPrev([{ id: 1, lastAccessed: 900 }, { id: 2, lastAccessed: 300 }, { id: 3, lastAccessed: 10, active: true }], 3)).toBe(1);
    });
    test("没有 lastAccessed（Chrome < 121）→ undefined（回落旧行为）", () => {
        expect(pickSeedPrev([{ id: 1 }, { id: 2 }, { id: 3, active: true }], 3)).toBeUndefined();
    });
    test("部分标签缺 lastAccessed：只在有值的里面挑；0 / NaN 不算", () => {
        expect(pickSeedPrev([{ id: 1 }, { id: 2, lastAccessed: 5 }, { id: 4, lastAccessed: 0 }, { id: 5, lastAccessed: NaN }, { id: 3, active: true, lastAccessed: 9 }], 3)).toBe(2);
    });
    test("只有当前一个标签 / 空列表 / 没有 id → undefined", () => {
        expect(pickSeedPrev([{ id: 3, active: true, lastAccessed: 9 }], 3)).toBeUndefined();
        expect(pickSeedPrev([], undefined)).toBeUndefined();
        expect(pickSeedPrev([{ lastAccessed: 9 }], undefined)).toBeUndefined();
    });
    test("当前标签未知（cur 为 undefined）→ 取 lastAccessed 最大的", () => {
        expect(pickSeedPrev([{ id: 1, lastAccessed: 1 }, { id: 2, lastAccessed: 2 }], undefined)).toBe(2);
    });
});

describe("applyActivation / seedState", () => {
    test("切到另一个标签：prev = 原 cur；同一个标签：不变", () => {
        expect(applyActivation({ prev: 1, cur: 2 }, { tabId: 3, windowId: 7 }, 7)).toEqual({ prev: 2, cur: 3 });
        const s = { prev: 1, cur: 2 };
        expect(applyActivation(s, { tabId: 2, windowId: 7 }, 7)).toBe(s);
    });
    test("别的窗口的激活忽略；窗口未知时不过滤", () => {
        const s = { prev: 1, cur: 2 };
        expect(applyActivation(s, { tabId: 9, windowId: 8 }, 7)).toBe(s);
        expect(applyActivation(s, { tabId: 9, windowId: 8 }, undefined)).toEqual({ prev: 2, cur: 9 });
    });
    test("新标签的侧栏在激活之后才启动：种子 = 激活前的那个标签（之前为空）", () => {
        // 激活顺序：1 → 2（新标签，active）；侧栏文档此刻才启动，没收到任何 onActivated
        const s = seedState([{ id: 1, lastAccessed: 1000 }, { id: 2, lastAccessed: 2000, active: true }, { id: 5, lastAccessed: 10 }], [], 7);
        expect(s).toEqual({ prev: 1, cur: 2 });
    });
    test("快照之后到的激活按顺序重放（不丢）；重放与种子一致时不重复", () => {
        const tabs = [{ id: 1, lastAccessed: 1000 }, { id: 2, lastAccessed: 2000, active: true }];
        expect(seedState(tabs, [{ tabId: 2, windowId: 7 }, { tabId: 3, windowId: 7 }], 7)).toEqual({ prev: 2, cur: 3 });
        expect(seedState(tabs, [{ tabId: 3, windowId: 8 }], 7)).toEqual({ prev: 1, cur: 2 });
    });
    test("没有 lastAccessed：prev 为空、cur 来自快照（= 旧行为）", () => {
        expect(seedState([{ id: 1 }, { id: 2, active: true }], [], 7)).toEqual({ prev: undefined, cur: 2 });
    });
});

describe("PrevTab 运行时（假 chrome / DOM）", () => {
    const listeners: ((i: { tabId: number; windowId: number }) => void)[] = [];
    const cls = new Map<string, Set<string>>(); // data-sel → classList
    let resolveQuery!: (t: any[]) => void;
    const saved: Record<string, unknown> = {};
    const mkEl = (sel: string) => {
        const set = cls.get(sel)!;
        return { classList: { add: (c: string) => set.add(c), remove: (c: string) => set.delete(c), contains: (c: string) => set.has(c) } };
    };
    beforeAll(() => {
        for (const k of ["chrome", "document", "location", "MutationObserver", "requestAnimationFrame"]) saved[k] = (globalThis as any)[k];
        for (const s of ["tab:1", "tab:2", "tab:3", "pin:p1"]) cls.set(s, new Set(["arc-tab"]));
        const g = globalThis as any;
        g.location = { search: "?host=inpage&win=7&tab=2", href: "chrome-extension://x/sidepanel.html?host=inpage&win=7&tab=2" };
        g.chrome = {
            tabs: {
                onActivated: { addListener: (f: any) => listeners.push(f) },
                query: () => new Promise(res => { resolveQuery = res; }),
            },
            windows: { get: async (id: number) => ({ id }), getCurrent: async () => ({ id: 7 }) },
            storage: { local: { get: async () => ({}), set: async () => { } }, session: { get: async () => ({}), set: async () => { } }, onChanged: { addListener: () => { } } },
            runtime: { id: "x", getURL: (p: string) => p, onMessage: { addListener: () => { } }, sendMessage: async () => { } },
        };
        g.document = {
            querySelectorAll: (q: string) => q === ".arc-tab.arc-prev" ? [...cls].filter(([, s]) => s.has("arc-prev")).map(([k]) => mkEl(k)) : [],
            querySelector: (q: string) => { const m = q.match(/data-sel="([^"]+)"/); return m && cls.has(m[1]!) ? mkEl(m[1]!) : null; },
            getElementById: () => null, body: {},
        };
        g.MutationObserver = class { observe() { } };
        g.requestAnimationFrame = (f: () => void) => setTimeout(f, 0);
    });
    afterAll(() => { for (const [k, v] of Object.entries(saved)) (globalThis as any)[k] = v; });
    const has = (sel: string) => cls.get(sel)!.has("arc-prev");
    const tick = () => new Promise(res => setTimeout(res, 5));

    test("onActivated 同步注册；快照前的激活丢弃（已反映在 lastAccessed），快照后的激活重放；种子 = 第二近访问；固定行不加", async () => {
        const { startPrevTab, prevTabId } = await import("../src/api/PrevTab");
        startPrevTab();
        expect(listeners.length).toBe(1); // 同步注册（在任何 await 之前）
        startPrevTab();
        expect(listeners.length).toBe(1); // 重复调用不重复注册
        listeners[0]!({ tabId: 1, windowId: 7 }); // 快照发出之前：丢弃
        await tick(); // currentWindow 解析 → 发出 tabs.query
        expect(typeof resolveQuery).toBe("function");
        listeners[0]!({ tabId: 3, windowId: 8 }); // 别的窗口：重放时忽略
        resolveQuery([{ id: 1, lastAccessed: 100 }, { id: 2, lastAccessed: 300, active: true }, { id: 3, lastAccessed: 200 }]);
        await tick();
        expect(prevTabId()).toBe(3);
        expect(has("tab:3")).toBe(true);
        expect(has("tab:1") || has("tab:2") || has("pin:p1")).toBe(false);
        listeners[0]!({ tabId: 1, windowId: 7 });
        expect(prevTabId()).toBe(2);
        expect(has("tab:2")).toBe(true);
        expect(has("tab:3")).toBe(false);
        expect(has("pin:p1")).toBe(false);
    });
});

describe("源码扫描", () => {
    test("sidepanel.ts：startPrevTab 在 bootstrap 之前同步调用，弹窗不启动", () => {
        const s = r("src/entries/sidepanel.ts");
        const a = s.indexOf("if (!popup) startPrevTab();"), b = s.indexOf('void bootstrap("panel")');
        expect(a).toBeGreaterThan(0);
        expect(a).toBeLessThan(b);
        expect(s).not.toMatch(/void startPrevTab\(\)/);
    });
    test("PrevTab.ts：onActivated 在第一个 await 之前注册；只标 tab: 行（固定行不加 prev 底色）", () => {
        const s = r("src/api/PrevTab.ts");
        const fn = s.slice(s.indexOf("export function startPrevTab"));
        expect(fn.indexOf("chrome.tabs.onActivated.addListener")).toBeLessThan(fn.indexOf("await "));
        expect(s).toMatch(/\.arc-tab\[data-sel="tab:\$\{prev\}"\]/);
        expect(s).not.toMatch(/pin:\$\{/);
        expect(r("static/sidepanel.css")).toMatch(/\.arc-tab\.arc-prev:not\(\.active\) \{ background: var\(--arc-prev\); \}/);
    });
});

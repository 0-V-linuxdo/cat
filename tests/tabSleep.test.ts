import { describe, expect, test } from "bun:test";
import { anyUnsaved, CLAIMED_MIGRATION_READY, CLOSE_AFTER_MIN, pickCloseTargets, DEFAULT_IDLE_MIN, hostMatches, isSleepableUrl, pickSleepTargets, PROTECTED_LRU_COUNT, remapAfterRestart, type SleepOptions, type SleepTab, windowOrdinals } from "../src/plugins/tabSleep/logic";
import { LOCALES } from "../src/api/i18n";
import { STRINGS } from "../src/plugins/tabSleep/i18n";

const H = 3600_000, NOW = 100 * H;
const ids = (n: number[]) => n;
/** 默认每个测试标签都有 2 小时前的激活记录 */
const opt = (o: Partial<SleepOptions> & { tabs?: number[] } = {}): SleepOptions => ({
    now: NOW, idleMs: H, claimed: new Set(), skipHosts: [], keepPinned: false, sleepAudible: false, protectedLru: 0,
    lastActive: Object.fromEntries((o.tabs ?? ids([1, 2, 3, 4, 5])).map(i => [i, NOW - 2 * H])), ...o,
});
const tab = (id: number, t: Partial<SleepTab> = {}): SleepTab => ({ id, url: `https://e${id}.com/`, ...t });

describe("标签休眠筛选", () => {
    test("闲置超时的休眠，未超时的不动", () => {
        expect(pickSleepTargets([tab(1), tab(2)], opt({ lastActive: { 1: NOW - 2 * H, 2: NOW - 10 * 60_000 } }))).toEqual([1]);
    });
    test("没有激活记录一律不休眠，不回退 lastAccessed", () => {
        expect(pickSleepTargets([tab(1, { lastAccessed: NOW - 50 * H })], opt({ lastActive: {} }))).toEqual([]);
    });
    test("激活 / 已休眠 / 加载中 / 不可丢弃 跳过", () => {
        expect(pickSleepTargets([tab(1, { active: true }), tab(2, { discarded: true }), tab(3, { status: "loading" }), tab(4, { autoDiscardable: false })], opt())).toEqual([]);
    });
    test("音频：默认跳过，开关打开后休眠", () => {
        expect(pickSleepTargets([tab(1, { audible: true })], opt())).toEqual([]);
        expect(pickSleepTargets([tab(1, { audible: true })], opt({ sleepAudible: true }))).toEqual([1]);
    });
    test("Cat 认领的标签：discardKeep 已迁移 → 默认（同 Arc）休眠，开关打开后跳过", () => {
        expect(CLAIMED_MIGRATION_READY).toBe(true);
        expect(pickSleepTargets([tab(1), tab(2)], opt({ claimed: new Set([2]) }))).toEqual([1, 2]);
        expect(pickSleepTargets([tab(1), tab(2)], opt({ claimed: new Set([2]), keepPinned: true }))).toEqual([1]);
    });
    test("Chrome 原生固定：默认（同 Arc）休眠，「固定和收藏不休眠」打开后跳过", () => {
        expect(pickSleepTargets([tab(1, { pinned: true })], opt())).toEqual([1]);
        expect(pickSleepTargets([tab(1, { pinned: true })], opt({ keepPinned: true }))).toEqual([]);
    });
    test("36 小时关闭：只关闲置超过 36 小时的，已休眠的也算，认领的不关，例外同休眠", () => {
        const o = { ...opt({ lastActive: { 1: NOW - 40 * H, 2: NOW - 20 * H, 3: NOW - 40 * H, 4: NOW - 40 * H, 5: NOW - 40 * H } }), closeMs: CLOSE_AFTER_MIN * 60_000 };
        expect(CLOSE_AFTER_MIN).toBe(2160);
        expect(pickCloseTargets([tab(1, { discarded: true }), tab(2), tab(3, { audible: true }), tab(4), tab(5, { url: "chrome://x" })], { ...o, claimed: new Set([4]) })).toEqual([1]);
        expect(pickCloseTargets([tab(1)], { ...o, closeMs: 0 })).toEqual([]);
        expect(pickCloseTargets([tab(1, { active: true })], o)).toEqual([]);
    });
    test("36 小时 close tier：归档而非直接关闭、依赖核心 Archive、注明源码未找到与独立机制", async () => {
        const src = await Bun.file("src/plugins/tabSleep/index.ts").text();
        expect(src).toContain("autoClosing.add(id)");
        expect(src).toContain('isPluginEnabled("Archive")');
        expect(src).toMatch(/开关由调用方传入，默认值源码未找到/);
        expect(src).toMatch(/关闭还是归档源码未找到/);
        expect(src).toContain("两套独立机制");
        expect(STRINGS.zh["tabSleep.closeTier"]).toContain("归档");
        // 「源码未找到」注记原在设置行说明里（撑高整行），dialog-layering 补丁起移到悬停提示 detail
        expect(STRINGS.zh["tabSleep.closeTier.detail"]).toContain("Arc 的处理方式源码未找到");
        expect(STRINGS.zh["tabSleep.closeTier.detail"]).toContain("两套独立机制");
        expect(STRINGS.en["tabSleep.closeTier.detail"]).toContain("not found in source");
    });
    test("Arc 常量与文档一致：discard 14400 s、保护 10 个、采样 300 s", async () => {
        expect(DEFAULT_IDLE_MIN * 60).toBe(14400);
        expect(PROTECTED_LRU_COUNT).toBe(10);
        expect(await Bun.file("src/plugins/tabSleep/index.ts").text()).toContain("periodInMinutes: 5");
    });
    test("新设置项文案中英文齐全", () => {
        for (const l of ["en", "zh"] as const) for (const k of ["tabSleep.keepPinned", "tabSleep.closeTier"]) expect(STRINGS[l][k as keyof typeof STRINGS.en]).toBeTruthy();
        expect(STRINGS.zh["tabSleep.keepPinned"]).not.toContain("discardKeep");
    });
    test("白名单站点（含子域）", () => {
        expect(pickSleepTargets([tab(1, { url: "https://mail.google.com/x" }), tab(2)], opt({ skipHosts: ["google.com"] }))).toEqual([2]);
    });
    test("chrome:// / 扩展 / file / about 跳过", () => {
        const urls = ["chrome://settings", "chrome-extension://abc/p.html", "file:///a", "about:blank", undefined];
        expect(pickSleepTargets(urls.map((url, i) => tab(i + 1, { url })), opt())).toEqual([]);
    });
    test("idle 为 0 时不休眠", () => {
        expect(pickSleepTargets([tab(1)], opt({ idleMs: 0 }))).toEqual([]);
    });
    test("Arc 默认：4 小时、保护最近 10 个", () => {
        expect(DEFAULT_IDLE_MIN).toBe(240);
        expect(PROTECTED_LRU_COUNT).toBe(10);
    });
    test("最近使用的 10 个不休眠，第 11 个起才休眠", () => {
        const n = Array.from({ length: 12 }, (_, i) => i + 1);
        const la = Object.fromEntries(n.map(i => [i, NOW - (1 + i) * H]));
        expect(pickSleepTargets(n.map(i => tab(i)), opt({ protectedLru: undefined, lastActive: la }))).toEqual([11, 12]);
    });
    test("激活标签占一个保护名额", () => {
        const n = Array.from({ length: 10 }, (_, i) => i + 2);
        const la = Object.fromEntries(n.map(i => [i, NOW - i * H]));
        expect(pickSleepTargets([tab(1, { active: true }), ...n.map(i => tab(i))], opt({ protectedLru: undefined, lastActive: la }))).toEqual([11]);
    });
    test("工具函数", () => {
        expect(isSleepableUrl("http://a.com")).toBe(true);
        expect(hostMatches("https://www.youtube.com/w", ["*.youtube.com"])).toBe(true);
        expect(hostMatches("https://notyoutube.com", ["youtube.com"])).toBe(false);
    });
});

describe("重启后的记录校验", () => {
    test("窗口序号按 id 升序", () => {
        expect([...windowOrdinals([{ windowId: 9 }, { windowId: 3 }, { windowId: 9 }])]).toEqual([[3, 0], [9, 1]]);
    });
    test("URL + 窗口序号唯一匹配的迁移到新 id，其余丢弃", () => {
        const r = remapAfterRestart(
            { 1: 100, 2: 200, 3: 300, 4: 400 },
            { 1: { url: "https://a.com/", win: 0 }, 2: { url: "https://b.com/", win: 1 }, 3: { url: "https://dup.com/", win: 0 }, 4: { url: "https://dup.com/", win: 0 } },
            [{ id: 51, url: "https://a.com/", windowId: 70 }, { id: 52, url: "https://b.com/", windowId: 80 }, { id: 53, url: "https://dup.com/", windowId: 70 }],
        );
        expect(r.lastActive).toEqual({ 51: 100, 52: 200 });
    });
    test("没有 meta 或匹配不上时清空", () => {
        expect(remapAfterRestart({ 1: 100 }, {}, [{ id: 1, url: "https://a.com/", windowId: 1 }]).lastActive).toEqual({});
        expect(remapAfterRestart({ 1: 100 }, { 1: { url: "https://a.com/", win: 1 } }, [{ id: 9, url: "https://a.com/", windowId: 1 }]).lastActive).toEqual({});
    });
});

describe("未保存表单结果合并", () => {
    test("任一框架为 true 或无结果都算有", () => {
        expect(anyUnsaved([{ result: false }, { result: true }])).toBe(true);
        expect(anyUnsaved([{ result: false }, { result: false }])).toBe(false);
        expect(anyUnsaved([])).toBe(true);
        expect(anyUnsaved([{ result: false }, {}])).toBe(true);
    });
});

describe("文案", () => {
    test("命令和设置键中英齐全", () => {
        for (const k of ["tabSleep.cmdRun", "tabSleep.idle", "tabSleep.4h", "plugin.tabSleep.label"]) { expect(LOCALES.en[k]).toBeTruthy(); expect(LOCALES.zh[k]).toBeTruthy(); }
    });
});

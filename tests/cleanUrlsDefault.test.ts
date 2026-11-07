/* Clean URLs 默认开启（用户 12:59）：全新存储 → 开；已有显式 enabled:false → 保持关；显式 true → 开；只改过其它设置、没碰开关 → 仍按默认（开）。
 * 开启后的行为 = 复制链接时按 Arc 规则移除跟踪参数，与站点面板 “Copy URL” 按钮（copyCleanUrl：先 cleanUrlDetailed 再走 copy 管线）一致。
 * Rea 依据（arc-analysis/clean-urls.md §2）：Arc 里开关和默认值 ⛔ 源码未找到，调用处没有条件判断，“看起来一直开启（未证实）” → 默认开不与已知 Arc 行为冲突。 */
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";

const mem: Record<string, unknown> = {};
const ev = () => ({ addListener() { }, removeListener() { } });
(globalThis as any).IS_DEV = false;
(globalThis as any).VERSION = "test";
(globalThis as any).chrome = {
    runtime: { id: "test", onMessage: ev(), sendMessage: mock(() => Promise.resolve()) },
    storage: { local: { get: async (k: string) => (k in mem ? { [k]: mem[k] } : {}), set: async (o: Record<string, unknown>) => { Object.assign(mem, structuredClone(o)); } }, onChanged: ev() },
};

const { setContext } = await import("../src/api/context");
const PM = await import("../src/api/PluginManager");
const { initSettings, PlainSettings } = await import("../src/api/Settings");
const { default: cleanUrls, transform, TOAST_MSG } = await import("../src/plugins/cleanUrls/index");
const { cleanUrlDetailed, TOAST_KEY } = await import("../src/plugins/cleanUrls/clean");
const { applyUrlTransformsDetailed, registerUrlTransform } = await import("../src/api/UrlTransforms");
void TOAST_MSG;

const load = async (saved: unknown) => {
    for (const k of Object.keys(PlainSettings.plugins)) delete PlainSettings.plugins[k];
    if (saved === undefined) delete mem.ArcSidebarSettings; else mem.ArcSidebarSettings = saved;
    await initSettings();
};

beforeAll(() => { setContext("background"); PM.registerPlugin(cleanUrls); });
/* bun test 同一进程里各文件共享模块：必须把真实 CleanUrls 从全局插件表里撤掉，否则按字母序排在后面的 core.test 的 initPluginManager() 会把它（现在默认开）启动，往 copy 管线里塞变换 */
afterAll(() => {
    delete PM.plugins.CleanUrls;
    for (const k of Object.keys(PlainSettings.plugins)) delete PlainSettings.plugins[k];
    delete mem.ArcSidebarSettings;
});

describe("Clean URLs 默认开启", () => {
    test("插件定义：enabledByDefault: true", () => { expect(cleanUrls.enabledByDefault).toBe(true); });
    test("全新存储（从未写过设置）→ 开", async () => {
        await load(undefined);
        expect(PM.isPluginEnabled("CleanUrls")).toBe(true);
    });
    test("存储里有设置对象但没有 CleanUrls → 开", async () => {
        await load({ plugins: { Boosts: { enabled: true } } });
        expect(PM.isPluginEnabled("CleanUrls")).toBe(true);
    });
    test("已有显式关闭（用户手动关过）→ 保持关，不被默认覆盖", async () => {
        await load({ plugins: { CleanUrls: { enabled: false } } });
        expect(PM.isPluginEnabled("CleanUrls")).toBe(false);
    });
    test("已有显式关闭 + 其它设置 → 仍关", async () => {
        await load({ plugins: { CleanUrls: { enabled: false, extended: true } } });
        expect(PM.isPluginEnabled("CleanUrls")).toBe(false);
    });
    test("显式开启 → 开；只改过其它设置、没碰过开关（没有 enabled 键）→ 按默认开", async () => {
        await load({ plugins: { CleanUrls: { enabled: true } } });
        expect(PM.isPluginEnabled("CleanUrls")).toBe(true);
        await load({ plugins: { CleanUrls: { extended: true, skipHosts: "a.com" } } });
        expect(PM.isPluginEnabled("CleanUrls")).toBe(true);
    });
    test("全新安装后手动关 → 写入 enabled:false 并保持关；初始化不会把默认值写回存储", async () => {
        await load(undefined);
        expect(PlainSettings.plugins.CleanUrls).toBeUndefined(); // 没有任何初始化写入：默认只是读取时的回落值，所以不会覆盖以后/其它设备上的显式值
        await PM.togglePlugin("CleanUrls", false);
        expect(PlainSettings.plugins.CleanUrls?.enabled).toBe(false);
        expect(PM.isPluginEnabled("CleanUrls")).toBe(false);
    });
});

describe("开启后的行为 = 复制链接移除跟踪参数，与站点面板 Copy URL 一致", () => {
    const urls = [
        "https://example.com/a?utm_source=x&utm_medium=y&id=7",
        "https://x.com/u/status/1?s=20&t=abc",
        "https://www.youtube.com/watch?v=abc&feature=share",
        "https://example.com/plain?id=1",
        "https://example.com/?a=1;b=2&utm_source=x", // query 含 ; → Arc 整体不处理
    ];
    test("默认设置下 copy 变换 = Arc 默认规则（cleanUrlDetailed）：同样的网址、同样的 changed、同样的 toast 键", async () => {
        await load(undefined);
        for (const u of urls) {
            const arc = cleanUrlDetailed(u), r = transform(u);
            expect(r.url, u).toBe(arc.url);
            expect(!!r.changed, u).toBe(arc.changed);
            if (arc.changed) expect(r.toastKey, u).toBe(TOAST_KEY);
        }
        expect(transform(urls[0]!).url).toBe("https://example.com/a?id=7");
    });
    test("站点面板 Copy URL 的流程（先 Arc 清理，再走 copy 管线）与已开启的插件叠加后结果不变（幂等），清理提示键一致", async () => {
        await load(undefined);
        const off = registerUrlTransform("copy", transform);
        try {
            for (const u of urls) {
                const arc = cleanUrlDetailed(u);
                const viaButton = applyUrlTransformsDetailed("copy", arc.url);   // 站点面板：copyCleanUrl
                const viaShortcut = applyUrlTransformsDetailed("copy", u);        // 快捷键 / 右键 Copy Link：只走管线
                expect(viaButton.url, u).toBe(arc.url);
                expect(viaShortcut.url, u).toBe(arc.url);
                if (arc.changed) expect(viaShortcut.toastKey, u).toBe(TOAST_KEY);
            }
        } finally { off(); }
    });
    test("站点面板源码：copyCleanUrl 先 cleanUrlDetailed 再 applyUrlTransformsDetailed，提示用 CLEAN_TOAST_KEY（与插件同一个键）", () => {
        const src = readFileSync("src/plugins/views/siteControls/index.ts", "utf8");
        expect(src).toMatch(/const arc = cleanUrlDetailed\(url\);\s*const r = applyUrlTransformsDetailed\("copy", arc\.url\);/);
        expect(src).toContain("arc.changed ? CLEAN_TOAST_KEY");
    });
});

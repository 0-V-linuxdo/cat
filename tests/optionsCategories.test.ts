/* 设置页（options.ts）分类栏（用户 14:05：搜索框附近缺了「分类」，对齐 Void++）。
 * 根因：pre-rel2 的“左侧导航 = 分类”页面被 Void++ 风格卡片页重写后，分类栏没有在新页面重建；PLUGIN_CATEGORY_TABS / filterPlugins 留在 utils，options.ts 只拿它排序。
 * Void++ 依据：PluginsTab.tsx 87 / 134-166 / 206-220、PluginsTab.css 31-55（0-V-linuxdo/VoidPP dev）。
 * ⛔ Void++ 的 recent 分类 Cat 没有（Plugin 没有 updatedAt）；默认选中 all（Void++ 是 favorites，见 options.ts DEFAULT_CATEGORY）。 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";

import { LOCALES, setLang, tr } from "../src/api/i18n";
import { categoryListing, PLUGIN_CATEGORY_TABS, visibleCategoryTabs } from "../src/components/settings/utils";
import type { Plugin } from "../src/utils/types";

const dirs = readdirSync("src/plugins", { withFileTypes: true }).filter(e => e.isDirectory() && !e.name.startsWith("_") && !e.name.startsWith(".")).map(e => e.name).toSorted();
const real: Plugin[] = [];
for (const d of dirs) {
    const m = await import(`../src/plugins/${d}/index.ts`);
    if (m.default && !m.default.hidden) real.push(m.default as Plugin);
}
const names = (r: { user: Plugin[]; required: Plugin[] }) => [...r.user, ...r.required].map(p => p.name);
const on = () => true;

/* 合成插件：不碰全局注册表 / 设置存储（isEnabled / starred 注入） */
const mk = (name: string, tags: string[], extra: Partial<Plugin> = {}) => ({ name, label: name, description: `${name} desc`, tags, authors: [], ...extra }) as unknown as Plugin;
const fake = [mk("A", ["tabs"]), mk("B", ["tabs"]), mk("C", ["spaces"]), mk("D", ["views"], { required: true }), mk("E", ["views"]), mk("F", [])];
const enabled = new Set(["A", "C", "D"]);
const isOn = (n: string) => enabled.has(n);

describe("分类栏：存在 + 顺序（Void++ PluginsTab.tsx 134-137）", () => {
    test("分类顺序 = PLUGIN_CATEGORY_TABS（收藏 / 全部 / 标签 / 空间 / 命令 / 视图 / 资料库 / 数据），有「全部」", () => {
        expect(PLUGIN_CATEGORY_TABS.map(t => t.id)).toEqual(["favorites", "all", "tabs", "spaces", "command", "views", "library", "data"]);
        expect(visibleCategoryTabs(real, []).map(t => t.id)).toEqual(["favorites", "all", "tabs", "spaces", "command", "views", "library", "data"]);
    });
    test("favorites / all 永远显示；其它分类只有至少一个插件命中才显示", () => {
        expect(visibleCategoryTabs([], []).map(t => t.id)).toEqual(["favorites", "all"]);
        expect(visibleCategoryTabs(fake, []).map(t => t.id)).toEqual(["favorites", "all", "tabs", "spaces", "views"]);
    });
    test("options.ts 渲染分类栏：在搜索 / 筛选行之前（同 Void++ 206-226），按钮来自 visibleCategoryTabs，点击切换分类并重画列表", () => {
        const src = readFileSync("src/entries/options.ts", "utf8");
        expect(src).toMatch(/catBar, filterBar\(\), listBox\)/); // 分类栏 → 搜索行 → 列表
        expect(src).toMatch(/visibleCategoryTabs\(\)\.map/);
        expect(src).toMatch(/"data-test": `opt-cat:\$\{t\.id\}`/);
        expect(src).toMatch(/onclick: \(\) => \{ category = t\.id; drawCats\(\); drawList\(\); \}/);
        expect(src).not.toMatch(/data-nav": t\.id/); // 不抢 selftest 的 [data-nav]（只能是 plugins,general）
    });
    test("CSS 取 Void++ PluginsTab.css 31-55 的值：gap 2px、底线 1px、选中下划线 inset 8px / bottom -1px / 高 2px / 圆角 1px", () => {
        const css = readFileSync("static/options.css", "utf8");
        expect(css).toMatch(/\.arc-opt-cats \{[^}]*flex-wrap: wrap;[^}]*gap: 2px;[^}]*border-bottom: 1px solid var\(--opt-line\);/);
        expect(css).toMatch(/\.arc-opt-cat\.active \{ color: var\(--opt-fg\); \}/);
        expect(css).toMatch(/\.arc-opt-cat\.active::after \{[^}]*inset-inline: 8px;[^}]*bottom: -1px;[^}]*height: 2px;[^}]*border-radius: 1px;[^}]*background: var\(--opt-fg\);/);
        expect(css).toMatch(/\.arc-opt-cat \{[^}]*color: var\(--opt-muted\);/);
    });
});

describe("分类栏：点击过滤卡片（Void++ 139-163）", () => {
    test("all：可选插件在前、必需插件在后（分隔线之后）", () => {
        const r = categoryListing(fake, "all", "all", "", on, []);
        expect(r.user.map(p => p.name)).toEqual(["A", "B", "C", "E", "F"]);
        expect(r.required.map(p => p.name)).toEqual(["D"]);
    });
    test("某个分类：只剩该 tag 的插件；必需插件并入同一组（没有分隔线）", () => {
        expect(categoryListing(fake, "tabs", "all", "", on, [])).toEqual({ user: [fake[0], fake[1]], required: [] });
        const v = categoryListing(fake, "views", "all", "", on, []);
        expect(v.user.map(p => p.name)).toEqual(["E", "D"]);
        expect(v.required).toEqual([]);
    });
    test("favorites：只有收藏的；没有收藏 → 空", () => {
        expect(names(categoryListing(fake, "favorites", "all", "", on, ["C", "D"]))).toEqual(["C", "D"]);
        expect(names(categoryListing(fake, "favorites", "all", "", on, []))).toEqual([]);
    });
    test("真实插件：每个分类的卡片 = 带该 tag 的插件；all = 全部可见插件", () => {
        expect(names(categoryListing(real, "all", "all", "", on, [])).length).toBe(real.length);
        for (const t of PLUGIN_CATEGORY_TABS.filter(x => x.id !== "all" && x.id !== "favorites")) {
            const got = names(categoryListing(real, t.id, "all", "", on, []));
            expect(got.length, t.id).toBeGreaterThan(0);
            expect(got.toSorted(), t.id).toEqual(real.filter(p => (p.tags as string[] | undefined)?.includes(t.id)).map(p => p.name).toSorted());
        }
    });
});

describe("分类栏：与搜索 / 启用筛选叠加（Void++ 165-166）", () => {
    test("分类 + 搜索：只在该分类里搜", () => {
        expect(names(categoryListing(fake, "tabs", "all", "desc", on, []))).toEqual(["A", "B"]);
        expect(names(categoryListing(fake, "tabs", "all", "a desc", on, []))).toEqual(["A"]);
        expect(names(categoryListing(fake, "spaces", "all", "a desc", on, []))).toEqual([]); // A 在 tabs，不在 spaces
        expect(names(categoryListing(fake, "all", "all", "a desc", on, []))).toEqual(["A"]);
    });
    test("分类 + 启用筛选 + 搜索三者同时生效", () => {
        expect(names(categoryListing(fake, "tabs", "enabled", "", isOn, []))).toEqual(["A"]);
        expect(names(categoryListing(fake, "tabs", "disabled", "", isOn, []))).toEqual(["B"]);
        expect(names(categoryListing(fake, "tabs", "disabled", "b desc", isOn, []))).toEqual(["B"]);
        expect(names(categoryListing(fake, "tabs", "disabled", "a desc", isOn, []))).toEqual([]);
        expect(names(categoryListing(fake, "views", "enabled", "", isOn, []))).toEqual(["D"]);
    });
    test("搜索不区分大小写；真实插件按卡片底部功能名能搜到（Views → Peek）", () => {
        setLang("en");
        expect(names(categoryListing(fake, "tabs", "all", "A DESC", on, []))).toEqual(["A"]);
        expect(names(categoryListing(real, "views", "all", "peek", on, []))).toContain("Views");
        expect(names(categoryListing(real, "tabs", "all", "peek", on, []))).not.toContain("Views");
    });
    test("options.ts 的列表 / 占位数量都走 categoryListing；占位数量不含搜索，搜索词传给列表", () => {
        const src = readFileSync("src/entries/options.ts", "utf8");
        expect(src).toMatch(/categoryListing\(groupPlugins\(\), category, filter, query\)/); // 列表：分类 + 筛选 + 搜索
        expect(src).toMatch(/categoryListing\(groupPlugins\(\), category, filter\);\s*return \[\.\.\.r\.user/); // 占位数量：分类 + 筛选
        expect(src).toMatch(/placeholder = tr\("settings\.searchPlugins", inCategory\(\)\.length\)/);
        expect(src).toMatch(/category = DEFAULT_CATEGORY/); // 切到别的页再回来 → 回到默认分类
    });
});

describe("搜索框占位带数量（Void++ PluginsTab.tsx:220 “Search N plugins...”）", () => {
    test("settings.searchPlugins 中英文都含 {0}，且与 tr() 的 {0} 约定一致（数量被替换进去、不留占位符）", () => {
        expect(LOCALES.en["settings.searchPlugins"]).toContain("{0}");
        expect(LOCALES.zh["settings.searchPlugins"]).toContain("{0}");
        setLang("en"); expect(tr("settings.searchPlugins", 14)).toBe("Search 14 plugins…");
        setLang("zh"); expect(tr("settings.searchPlugins", 3)).toBe("搜索 3 个插件…");
        setLang("en"); expect(tr("settings.searchPlugins", 0)).toBe("Search 0 plugins…"); // 0 也要显示（不是空串）
    });
    test("options.ts / 侧边栏浮层的占位都传入数量（不能留下字面量 {0}）", () => {
        const o = readFileSync("src/entries/options.ts", "utf8");
        expect(o).toMatch(/placeholder: tr\("settings\.searchPlugins", inCategory\(\)\.length\)/);
        const ov = readFileSync("src/plugins/_core/pluginSettings/index.ts", "utf8");
        expect(ov).not.toMatch(/tr\("settings\.searchPlugins"\)/); // 无参调用会显示 "{0}"
        expect(ov).toMatch(/placeholder: tr\("settings\.searchPlugins", filterPlugins\("all", ""\)\.length\)/);
        expect(ov).toMatch(/search\.placeholder = tr\("settings\.searchPlugins", filterPlugins\(category, "", state\)\.length\)/);
    });
    test("数量 = 当前分类 + 启用筛选后的卡片数，与搜索无关", () => {
        const n = (c: Parameters<typeof categoryListing>[1], f: Parameters<typeof categoryListing>[2], q = "") => { const r = categoryListing(fake, c, f, q, isOn, []); return r.user.length + r.required.length; };
        expect(n("all", "all")).toBe(6);
        expect(n("tabs", "all")).toBe(2);
        expect(n("tabs", "enabled")).toBe(1);
        expect(n("views", "all")).toBe(2); // 必需插件并入同一组，数量也要算
        expect(n("favorites", "all")).toBe(0);
        expect(n("tabs", "all", "a desc")).toBe(1); // 搜索会改列表，但占位数量用的是不带 query 的 n("tabs", "all") = 2
    });
});

describe("Adaptive color 的分类（⛔ 分类表里没有外观 / 主题类 → 只在「全部」出现，不新增分类、不改 tag）", () => {
    const adaptive = real.find(p => p.name === "Adaptive")!;
    test("Adaptive 存在，tag = adaptive（selftest 的 7 个核心组 = tabs / spaces / command / views / library / data / adaptive）", () => {
        expect(adaptive).toBeTruthy();
        expect(adaptive.tags).toEqual(["adaptive"]);
    });
    test("分类表里没有 adaptive 分类：Adaptive 只出现在「全部」，其它任何分类里都没有", () => {
        expect(PLUGIN_CATEGORY_TABS.map(t => t.id as string)).not.toContain("adaptive");
        expect(names(categoryListing(real, "all", "all", "", on, []))).toContain("Adaptive");
        for (const t of PLUGIN_CATEGORY_TABS.filter(x => x.id !== "all" && x.id !== "favorites")) expect(names(categoryListing(real, t.id, "all", "", on, [])), t.id).not.toContain("Adaptive");
        expect(visibleCategoryTabs(real, []).map(t => t.id as string)).not.toContain("adaptive");
    });
    test("收藏了 Adaptive 以后它出现在「收藏」里", () => {
        expect(names(categoryListing(real, "favorites", "all", "", on, ["Adaptive"]))).toEqual(["Adaptive"]);
    });
});

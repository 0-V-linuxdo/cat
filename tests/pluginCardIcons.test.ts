/* 插件管理页卡片左上角图标（Cat 裁定，/workspace/arc-ui/plugin-icon-map.md）：
 * 每个可见插件按自己的 name 取图标（不再按分类共用）；只用 Arc 原生资源 / SF Symbol；没有映射的插件不渲染图标容器；图标内部 id 每个实例唯一。
 * 根因（实测，headless Chrome 渲染真实 options.js + CSS）：tabs 分类的 5 张卡共用 `tabs` = raster tab__tab@2x.png，这张位图本身就是一个实心圆角方块（Arc “+” 菜单的 New Tab 图标），
 * 深色下就是白方块；不是遮罩失效。Tidy Downloads 用 library 分类图标（LibraryIcon.svg 四点），与 Library 卡重复。 */
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";

import { ICON_NAMES, SF_GLYPHS } from "../src/api/icons";
import { ION_GLYPHS } from "../src/api/ionGlyphs";
import { cardIconOf, PLUGIN_CARD_ICON } from "../src/components/settings/utils";
import type { Plugin } from "../src/utils/types";

const r = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const dirs = readdirSync("src/plugins", { withFileTypes: true }).filter(e => e.isDirectory() && !e.name.startsWith("_") && !e.name.startsWith(".")).map(e => e.name).sort();
const listed: Plugin[] = [];
for (const d of dirs) {
    const m = await import(`../src/plugins/${d}/index.ts`);
    if (m.default && !m.default.hidden) listed.push(m.default as Plugin);
}

/* Cat 裁定表：插件 name → 图标名（icons.ts 的 IconName / "boxOfThings"） */
const WANT: Record<string, string> = {
    CleanUrls: "link", // Arc copy-url.svg（ARC_SiteControlCenter.bundle）
    TidyTabs: "clean", // Arc broom-stick.svg
    Boosts: "boost", // Arc boost.svg（ARC_HomeButton.bundle）
    Capture: "cameraRegular", // SF camera 16pt Regular（Arc 截图按钮）
    Views: "splitCols", // Arc split-add-right.svg（保持）
    Library: "boxOfThings", // Arc BoxOfThingsIcon（Rea：LibraryIcon 勿用）
    TabSleep: "moonZzz", TidyTabTitles: "textformat", DownloadRename: "arrowDown", Adaptive: "paintpalette", Data: "externaldrive", // SF closest, not from Arc ⛔ 图标选择
    Tabs: "rectangleOnRectangle", // SF rectangle.on.rectangle ⛔ SF closest（原 tabs 位图 = 实心圆角方块 = “白方块”）
    InpageSidebar: "navSidebar", // Arc icon-browser-navigation-sidebar.svg（vector/Arc_main）；页内侧边栏插件（可选，默认关）
    SessionTransfer: "shareUp", // SF square.and.arrow.up ⛔ SF closest（会话传递；可选，默认关）
    Spaces: "spaces", Command: "search", // 组卡保持（Spaces = Arc 双卡片剪影位图，Command = SF 矢量）
};

describe("每个插件自己的卡片图标", () => {
    test("映射表 = Cat 裁定表；所有可见插件都有映射", () => {
        expect<Record<string, string>>({ ...PLUGIN_CARD_ICON }).toEqual(WANT);
        expect(listed.length).toBeGreaterThanOrEqual(14);
        for (const p of listed) expect<string | undefined>(cardIconOf(p), p.name).toBe(WANT[p.name]!);
    });
    test("图标名都存在（ICON_NAMES）；11 张点名卡片互不重复，且不是 tabs / library / sparkles / moon / sun 占位", () => {
        const vals = Object.values(PLUGIN_CARD_ICON);
        for (const v of vals) expect(v === "boxOfThings" || (ICON_NAMES as string[]).includes(v), v).toBe(true);
        const named = ["CleanUrls", "TidyTabs", "Boosts", "Capture", "Views", "Library", "TabSleep", "TidyTabTitles", "DownloadRename", "Adaptive", "Data"].map(n => PLUGIN_CARD_ICON[n]!);
        expect(new Set(named).size).toBe(named.length);
        for (const bad of ["tabs", "spaces", "library", "sparkles", "moon", "sun", "plugin", "downloadBox", "data"]) expect(named).not.toContain(bad);
    });
    test("没有映射的插件：cardIconOf = undefined（options.ts 不渲染 .arc-vcard-icon 容器，不留白方块）", () => {
        expect(cardIconOf({ name: "NoSuchPlugin" } as Plugin)).toBeUndefined();
        const o = r("src/entries/options.ts");
        expect(o).toMatch(/return k \? h\("span", \{ class: "arc-vcard-icon"/);
        expect(o).toContain(": null;");
        expect(o).not.toMatch(/PLUGIN_CATEGORY_TABS\.find\(t => t\.id === tagOf\(p\)\)\?\.icon/); // 不再按分类取图标
        expect(o).not.toContain('?? "plugin"');
        expect(o).toContain("cardIcon(p),");
    });
    test("卡片图标容器保持现状（⛔ Arc 无依据）：24×24 / 圆角 7 / --opt-sel / glyph 盒 14；BoxOfThings 14/16 缩放", () => {
        const css = r("static/options.css");
        expect(css).toContain(".arc-vcard-icon { display: inline-grid; place-items: center; width: 24px; height: 24px; border-radius: 7px; flex: none; color: var(--opt-fg); background: var(--opt-sel); }");
        expect(css).toContain(".arc-vcard-icon .arc-boxthings { transform: scale(.875); }");
        expect(r("src/entries/options.ts")).toContain("const CARD_ICON_BOX = 14;");
    });
});

describe("卡片图标不用手写路径", () => {
    test("手写 sparkles 不在任何卡片图标里（它仍只给主题选择器“自动”用，⛔ SF sparkles 未导出）", () => {
        expect(Object.values(PLUGIN_CARD_ICON)).not.toContain("sparkles");
    });
    test("ionGlyphs 的 data 仍是 externaldrive.fill（设置分类标签用，线框 externaldrive 只给 Data 卡片）", () => {
        expect(ION_GLYPHS.data.src).toContain("externaldrive.fill");
        expect(SF_GLYPHS.externaldrive.src).not.toContain(".fill");
    });
});

describe("组卡图标（Tabs 的实心方块已换掉）", () => {
    test("Tabs = SF rectangle.on.rectangle（不再是 `tabs` 位图），其它 12 张卡的图标都不是 tabs；Spaces / Command 保持", () => {
        expect(PLUGIN_CARD_ICON.Tabs).toBe("rectangleOnRectangle");
        expect(Object.entries(PLUGIN_CARD_ICON).filter(([, v]) => v === "tabs")).toEqual([]);
        expect(PLUGIN_CARD_ICON.Spaces).toBe("spaces");
        expect(PLUGIN_CARD_ICON.Command).toBe("search");
    });
    test("没有任何卡片图标是实心方块位图：映射值里只有 spaces 是位图遮罩（Arc 双卡片剪影），其余都是 SF / Arc 矢量或 BoxOfThings", async () => {
        const { ARC_ICONS } = await import("../src/api/arcIcons");
        const raster = Object.values(PLUGIN_CARD_ICON).filter(v => v !== "boxOfThings" && ARC_ICONS[v]?.body.includes("<image")).sort();
        expect(raster).toEqual(["spaces"]);
    });
    test("rectangleOnRectangle = suggested/rectangle.on.rectangle_16pt_regular.svg，带 ⛔ 注释", () => {
        const g = SF_GLYPHS.rectangleOnRectangle;
        expect(g.src).toBe("arc-icons/sf/suggested/rectangle.on.rectangle_16pt_regular.svg");
        expect(g.pt).toBe(16);
        expect(g.body).toContain('fill="currentColor"');
        const lines = r("src/api/icons.ts").split("\n");
        const i = lines.findIndex(l => l.startsWith("    rectangleOnRectangle: {"));
        expect(i).toBeGreaterThan(0);
        expect(lines[i - 1]).toContain("SF closest, not from Arc ⛔ 图标选择");
    });
});

describe("InpageSidebar 卡片图标 = Arc icon-browser-navigation-sidebar（navSidebar，页内侧边栏补丁 04）", () => {
    const SRC = "/workspace/arc-icons/vector/Arc_main/icon-browser-navigation-sidebar.svg"; // 只在有 Rea 导出目录的机器上比对源文件
    test("映射 InpageSidebar → navSidebar；navSidebar 在 ICON_NAMES，且只有这一张卡用它", () => {
        expect(PLUGIN_CARD_ICON.InpageSidebar).toBe("navSidebar");
        expect(ICON_NAMES as string[]).toContain("navSidebar");
        expect(Object.entries(PLUGIN_CARD_ICON).filter(([, v]) => v === "navSidebar").map(([k]) => k)).toEqual(["InpageSidebar"]);
        expect("navSidebar" in SF_GLYPHS).toBe(false); // Arc 原生资源，不是 SF closest
        expect("navSidebar" in ION_GLYPHS).toBe(false);
    });
    test("arcIcons：来源 = vector/Arc_main/icon-browser-navigation-sidebar.svg，26×26，单色 currentColor，无写死颜色 / 位图", async () => {
        const { ARC_ICONS, ARC_ICON_SOURCE } = await import("../src/api/arcIcons");
        expect(ARC_ICON_SOURCE.navSidebar).toBe("vector/Arc_main/icon-browser-navigation-sidebar.svg");
        const g = ARC_ICONS.navSidebar!;
        expect(g.vb).toBe("0 0 26 26");
        expect(g.body).toContain('fill="currentColor"');
        expect(g.body).not.toMatch(/rgb\(|#[0-9a-f]{3,6}|<image|\burl\(|\bid=/i);
        if (existsSync(SRC)) {
            const svg = readFileSync(SRC, "utf8");
            expect(svg).toContain('viewBox="0 0 26 26"');
            expect(g.body).toContain(svg.match(/ d="([^"]+)"/)![1]!);
        }
    });
});

import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";

/* accept-live-52179 第 6 项：收藏磁贴悬停出现两个提示（旧 .arc-fav-preview + ArcTooltip）。只允许共享 ArcTooltip（data-tip）。 */
const MINE = [
    "src/plugins/spaces/favorites/index.ts", "src/plugins/spaces/themes/picker.ts", "src/plugins/spaces/themes/index.ts",
    "src/plugins/spaces/spaceManager/menu.ts", "src/entries/options.ts", "src/plugins/_core/pluginSettings/index.ts",
    "src/components/settings/PluginCard.ts", "src/components/IconPicker.ts",
];
const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

describe("收藏 / 设置页 / Space 面板：收藏无提示，其余只有 ArcTooltip", () => {
    test("收藏没有旧悬停预览卡（arc-fav-preview / hoverPreview）", () => {
        const s = src("src/plugins/spaces/favorites/index.ts");
        expect(s).not.toMatch(/h\("div",\s*\{\s*class:\s*"arc-fav-preview"/);
        expect(s).not.toMatch(/hoverPreview|onmouseenter/);
    });
    test("收藏磁贴没有任何提示：无 data-tip、无 title（tooltip-favorites.md：Arc Favorites 格子无 tooltip）；保留 aria-label", () => {
        const line = src("src/plugins/spaces/favorites/index.ts").split("\n").find(l => l.includes("class: `arc-fav-tile"))!;
        expect(line).toBeDefined();
        expect(line).not.toMatch(/"data-tip"|\btitle:/);
        expect(line).toMatch(/"aria-label":/);
    });
    for (const p of MINE) test(`${p}：元素上没有原生 title（h() 属性 / .title = / setAttribute("title")）`, () => {
        const bad = src(p).split("\n").filter(l => /\bh\("[a-z]+",\s*\{[^}]*[{,]\s*title:/.test(l) || /\b(el|btn|b|img|row|tile|host)\.title\s*=/.test(l) || /setAttribute\("title"/.test(l));
        expect(bad).toEqual([]);
    });
});

/* 底栏 Space 图标提示 = ArcTooltip 默认样式（space-icon-tooltip.md / arc-tooltip.md §A），不跟随 Space 主题色 */
import { test, expect } from "bun:test";
import { TOOLTIP_CSS, TOOLTIP_PALETTE, TOOLTIP_TITLE_PX, TOOLTIP_KEY_PX, TOOLTIP_KEY_RADIUS, TOOLTIP_GAP } from "../src/components/ArcTooltip";
test("调色板 = Rea 默认值（深 #2B2B2B / 浅 #fff；键帽 .28/.45 深、.9/.66 浅）", () => {
    expect(TOOLTIP_PALETTE.dark).toMatchObject({ bg: "#2B2B2B", title: "#fff", keyFg: "rgb(71 71 71)", keyBg: "rgb(115 115 115)", keyText: "#fff" });
    expect(TOOLTIP_PALETTE.light).toMatchObject({ bg: "#fff", title: "#000", keyFg: "rgb(230 230 230)", keyBg: "rgb(168 168 168)", keyText: "#000" });
    expect([TOOLTIP_TITLE_PX, TOOLTIP_KEY_PX, TOOLTIP_KEY_RADIUS, TOOLTIP_GAP]).toEqual([12, 10, 4, 6]);
});
test("提示样式不引用 Space 色 / 强调色", () => {
    expect(TOOLTIP_CSS).not.toMatch(/--arc-space|--arc-accent|--sc\b|data-color/);
});
test("底栏和 Space 样式里没有覆盖 .arc-tooltip 的规则", async () => {
    for (const p of ["../static/sidepanel.css", "../src/plugins/spaces/style.ts"]) expect(await Bun.file(new URL(p, import.meta.url)).text()).not.toContain(".arc-tooltip");
});

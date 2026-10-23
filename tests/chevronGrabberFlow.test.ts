/* 原 B-07「把手绝对定位在左内边距里」的几何测试。Rea（space-header-idle.md §3.2）：Space 标题行没有拖拽手柄 → 把手已移除；
 * 这里改为：没有把手，箭头盒（24）里 14px 字形的左边仍 = 标签 favicon 左边，idle 箭头 opacity 0 但保留占位（Arc 隐藏时宽 0，与 Cat 的占位要求有差异，⛔ 已在 style.ts 注明）。 */
import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
const r = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const sp = r("src/plugins/spaces/style.ts"), css = r("static/sidepanel.css"), mgr = r("src/plugins/spaces/spaceManager/index.ts");

test("侧栏 Space 标题没有拖动把手（样式和节点都不存在）；Manage Spaces 的 arc-manage-grip 保留", () => {
    expect(sp).not.toMatch(/\.arc-space-grabber \{/);
    expect(mgr).not.toContain('class: "arc-space-grabber"');
    expect(mgr).not.toContain("space-grabber");
    expect(sp).toContain(".arc-manage-grip {");
});
test("槽左缘 = 标签图标容器左缘：左内边距 + (槽宽 − 16) / 2 = --arc-pad-x（16 字形 / favicon 居中于 24 槽）", () => {
    const titlePadL = Number(sp.match(/\.arc-space-title \{[^}]*?display: flex;[^}]*?padding: \d+px \d+(?:px)? \d+px (\d+)px/)![1]);
    const spanW = Number(sp.match(/\.arc-space-chevron \{[^}]*width: (\d+)px/)![1]);
    const padX = Number(css.match(/--arc-pad-x:\s*(\d+)px/)![1]);
    expect(titlePadL + (spanW - 16) / 2).toBe(padX);
});
test("箭头 idle opacity 0（槽 24×24 与图标共用，不是第二个槽：图标 margin-left −28 叠上去，见 spaceHeaderSlot.test.ts；取代「箭头 idle opacity 0 仍占位、顺序 [箭头, 图标, 标题]」旧裁定）；hover 恢复 opacity 1", () => {
    const c = sp.match(/\n\.arc-space-chevron \{([^}]*)\}/)![1]!;
    expect(c).toContain("opacity: 0");
    expect(c).toMatch(/width: 24px; height: 24px/);
    expect(c).not.toMatch(/display: none|visibility: hidden/);
    expect(sp).toMatch(/\.arc-space-title:hover \.arc-space-chevron \{ opacity: 1;/);
});

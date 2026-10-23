import { expect, test } from "bun:test";
import { readFileSync } from "fs";

/* 图标弹出框头部删除按钮 .arc-ip-del 必须是 22×20（urlbar-menus-followup.md L418–466）。
 * 产品 CSS 的坑：static/sidepanel.css 的 .arc-icon-btn 有 min-width: 28px，与 .arc-ip-del（只设 width: 22px）同特异性且不冲突属性 → 实测 28×20。
 * 修法：按钮自带内联 min-width: 22px（内联样式高于任何选择器的特异性，不依赖样式表顺序，也不改共享的 sidepanel.css）。 */
const rd = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const picker = rd("src/components/IconPicker.ts");
const css = rd("src/plugins/spaces/style.ts");
const side = rd("static/sidepanel.css");

test("删除按钮内联 min-width: 22px（盖过 .arc-icon-btn 的 min-width: 28px）", () => {
    const btn = picker.slice(picker.indexOf('class: "arc-icon-btn arc-ip-del"'), picker.indexOf('svgIcon("trashIcomoon", 15)'));
    expect(btn).toMatch(/style: "min-width: 22px"/);
    expect(btn).not.toContain("!important");
});
test("前提仍成立：.arc-icon-btn { min-width: 28px } 在 sidepanel.css（所以必须覆盖）；.arc-ip-del 样式表只有 width: 22px; height: 20px", () => {
    expect(side).toMatch(/\.arc-icon-btn, \.arc-caret \{[^}]*min-width: 28px/);
    expect(css).toMatch(/\.arc-ip-del \{ width: 22px; height: 20px;/);
    expect(css).toMatch(/\.arc-ip-del > \.arc-svg \{ width: 15px; height: 15px; \}/);
});
test("内联 min-width（22）+ 样式表 width（22）= 22；高 20 由样式表给（自测实测高已是 20，只有宽被 min-width 撑大）", () => {
    const inline = Number(/style: "min-width: (\d+)px"/.exec(picker)![1]);
    const width = Number(/\.arc-ip-del \{ width: (\d+)px/.exec(css)![1]);
    expect(Math.max(inline, width)).toBe(22);
});

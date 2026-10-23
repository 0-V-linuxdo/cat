/* 标题列（pinned-slash.md ★ 结论 / space-header-layout.md 表）：所有标签行标题起点 40→44，偏离行 46，文件夹 41→44；图标 x（18）/ 文件夹图标（17）不动。
 * 全部用相对量：图标槽 24（16 图标居中，槽左缘 = 图标左缘 − 4），槽右缘 → 标题 = customSpacing 4 + titleStack inset 2 = 行 gap 6；drift 槽后 0、斜杠 4×15、斜杠 → 标题 4、inset 0。 */
import { expect, test } from "bun:test";
import { readFileSync } from "fs";

const css = readFileSync("static/sidepanel.css", "utf8");
const tabsCss = readFileSync("src/plugins/tabs/style.ts", "utf8");
const row = readFileSync("src/components/TabRow.ts", "utf8");
const align = readFileSync("src/selftest/align.ts", "utf8");

/* 和 CSS 同样的数值把一行的水平位置算出来（flex：行 gap 6，行内左边距 10，行左缘 8；margin-right / 负外边距见 sidepanel.css 注释） */
const GAP = 6, ROW_X = 8, PAD_X = 10, FAV = 16, FOLDER = 17, BOX = 24;
const PAD = (BOX - FAV) / 2;                       // --arc-icon-pad = 4
const SLASH_W = 4, SLASH_TITLE = 4;
const iconLeft = ROW_X + PAD_X;                    // 18：图标位置不动
const normal = () => iconLeft + FAV + PAD + GAP;   // 图标右缘 + 槽右留白 4 + gap 6
const folder = () => iconLeft + FOLDER + (BOX - PAD - FOLDER) + GAP; // 文件夹图标 17 不动，右外边距 3
const drift = () => {
    const slashLeft = iconLeft + FAV + PAD + GAP - GAP;                // 斜杠 margin-left −gap
    const slashRight = slashLeft + SLASH_W;
    return { slashLeft, slashRight, title: slashRight + GAP + (SLASH_TITLE - GAP) };   // 斜杠 margin-right 4 − gap
};

test("非 drift 标签行（固定 / Today / 新标签页）：标题起点 44（槽左 14 + 24 + 4 + 2；图标右缘 + 10），以前 40", () => {
    expect(normal()).toBe(44);
    expect(normal() - (iconLeft - PAD)).toBe(BOX + 4 + 2);        // 相对槽左缘 = 24 + 4 + 2
    expect(normal() - (iconLeft + FAV)).toBe(10);
});
test("drift 行：斜杠 38–42（槽右缘起）、标题起点 46、图标右缘 → 斜杠 4；图标 x 仍 18", () => {
    const d = drift();
    expect(iconLeft).toBe(18);
    expect([d.slashLeft, d.slashRight]).toEqual([38, 42]);
    expect(d.title).toBe(46);                                      // 槽左 14 + 24 + 0 + 4 + 4 + 0
    expect(d.slashLeft - (iconLeft + FAV)).toBe(PAD);
    expect(d.title - d.slashRight).toBe(SLASH_TITLE);
});
test("文件夹行：标题起点 44（Rea 14 + 24 + 6），以前 41；文件夹图标 17 不动", () => {
    expect(folder()).toBe(44);
    expect(folder() - normal()).toBe(0);                           // 与标签行同一列
});
test("CSS：图标槽留白用变量（相对量），标签 / 新标签页图标右外边距 = pad，文件夹图标 = 槽 − pad − 17；没有写死的 44 / 46", () => {
    expect(css).toContain("--arc-icon-box: 24px; --arc-icon-pad: calc((var(--arc-icon-box) - var(--arc-fav-size)) / 2);");
    expect(css).toContain(":root .arc-tab > .arc-fav, :root .arc-newtab > .arc-svg { margin-right: var(--arc-icon-pad, 4px); }");
    expect(css).toContain(":root .arc-folder-head > .arc-folder-icon { margin-right: calc(var(--arc-icon-box, 24px) - var(--arc-icon-pad, 4px) - 17px); }");
    expect(tabsCss).toMatch(/\.arc-folder-icon \{ width: 17px; height: 17px;/);           // 文件夹图标 17 不动（与上面的 17px 同源）
    expect(css).not.toMatch(/\b(44|46)px/);
    // 斜杠外边距沿用：−gap 抵掉行 gap（斜杠贴槽右缘），右 4 − gap（斜杠 → 标题 4）
    expect(css).toContain("margin: 0 calc(4px - var(--arc-gap, 6px)) 0 calc(-1 * var(--arc-gap, 6px))");
    expect(css).toMatch(/\.arc-drift \{[^}]*width: 4px; height: 15px;/);
    expect(css).not.toContain(".arc-icon-box {");                    // 不再有每行包装容器（槽用相对外边距表达）
});
test("Space 标题行不在本补丁里（设置页负责 −4 外边距）：新增规则不碰 .arc-space-*", () => {
    const block = css.slice(css.indexOf(":root .arc-tab > .arc-fav"), css.indexOf(":root .arc-folder-head > .arc-folder-icon") + 200);
    expect(block).not.toContain("arc-space");
});
test("TabRow：图标区 = 行左缘 → 斜杠左缘（= 槽右缘），点击与 hover 副标题同一条线；右按钮 / 静音钮除外；斜杠仍只在 drifted 时创建", () => {
    expect(row).toContain("e.clientX < sl.getBoundingClientRect().left");
    expect(row).toContain("e.clientX < r.left");
    expect(row).toContain('".arc-tab-close, .arc-audio"');
    expect(row).toContain("p.drifted ? driftSlash() : null");
});
test("align.ts：标题列相对图标槽量（非 drift +26、drift +28、图标→斜杠 4），文件夹 dTx 0", () => {
    expect(align).toContain("const SLOT = 24, FAV = 16, SLASH_W = 4, SLASH_TITLE = 4, CUSTOM_SP = 4, INSET = 2;");
    expect(align).toContain("titleFromIcon = (SLOT - padR) + CUSTOM_SP + INSET");
    expect(align).toContain("driftFromIcon = (SLOT - padR) + SLASH_W + SLASH_TITLE");
    expect(align).toContain("{ tab: 0, newtab: 0, folder: 0, space: -2 }");
    expect((SLOT => SLOT - (24 - 16) / 2 + 4 + 2)(24)).toBe(26);
});

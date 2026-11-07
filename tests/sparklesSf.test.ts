/* 手绘 sparkles 已删（Cat 裁定：整个侧边栏没有手绘图标）：主题选择器 “自动” 用 SF `sparkles`，16pt Regular，原样拷贝导出文件。
 * ⛔ Rea 没有这个按钮的符号名 / 字号 / 字重（arcIcons.ts sparkles = null）：SF closest，16pt Regular 是 Cat 的统一规格，不是 Arc 取值。 */
import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";

import { ICON_NAMES, SF_GLYPHS } from "../src/api/icons";

const r = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("SF_GLYPHS.sparkles = suggested/sparkles_16pt_regular.svg（viewBox / path 原样，fill=currentColor），带 ⛔ 注释", () => {
    const g = SF_GLYPHS.sparkles;
    expect(g.src).toBe("arc-icons/sf/suggested/sparkles_16pt_regular.svg");
    expect(g.pt).toBe(16);
    expect(g.body).toContain('fill="currentColor"');
    const f = "/workspace/arc-icons/sf/suggested/sparkles_16pt_regular.svg";
    if (existsSync(f)) { const svg = readFileSync(f, "utf8"); expect(svg).toContain(`viewBox="${g.vb}"`); expect(svg).toContain(g.body); }
    const lines = r("src/api/icons.ts").split("\n");
    const i = lines.findIndex(l => l.startsWith("    sparkles: {"));
    expect(i).toBeGreaterThan(0);
    expect(lines[i - 1]).toContain("SF closest, not from Arc ⛔ 图标选择");
});

test("名字仍可用（picker / tidyTabTitles），但不再有手写路径", () => {
    expect((ICON_NAMES as string[]).includes("sparkles")).toBe(true);
    const src = r("src/api/icons.ts");
    const paths = src.slice(src.indexOf("const PATHS = {"), src.indexOf("} as const;", src.indexOf("const PATHS = {")));
    expect(paths).not.toContain("sparkles");
    expect(src).not.toMatch(/sparkles: "M/);
    expect(r("src/plugins/spaces/themes/picker.ts")).toContain('icon(s === "auto" ? "sparkles" : s === "light" ? "sun" : "moon")');
});

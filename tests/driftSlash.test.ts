/* 偏离斜杠按 pinned-drift.md：画线 4×15、线宽 2 圆头、无 tooltip、悬停透明、α.30 */
import { expect, test } from "bun:test";
import { readFileSync } from "fs";
const row = readFileSync("src/components/TabRow.ts", "utf8");
const css = readFileSync("static/sidepanel.css", "utf8");
test("drift slash 是 SVG 直线，无 tooltip", () => {
    expect(row).toContain('p.drifted ? driftSlash() : null');
    expect(row).toContain('"viewBox", "0 0 4 15"');
    expect(row).toContain('"stroke-width", "2"');
    expect(row).toContain('"stroke-linecap", "round"');
    expect(row).not.toContain("pinned.drifted");
});
test("drift slash 样式", () => {
    expect(css).toContain("rgb(0 0 0 / .30)");
    expect(css).toContain(":root[data-theme=\"dark\"] .arc-drift { color: rgb(255 255 255 / .30); }");
    expect(css).toContain(".arc-tab:hover .arc-drift { opacity: 0; }");
    expect(css).not.toMatch(/\.arc-drift \{[^}]*margin-right: -4px/);
});

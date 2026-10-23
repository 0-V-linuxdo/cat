/* fav 模糊层 α 动画（fav-tile-blur.md §4）：时长 0.12s 用单独变量 --fav-blur-t（不动全局 --arc-t-fast）；只有“选中（.active）”磁贴的 hover 才过渡，其余瞬时；缓动用默认（不用 --arc-ease）。 */
import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
const r = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const style = r("src/plugins/spaces/style.ts"), side = r("static/sidepanel.css");
const rule = style.split("\n").find(l => l.startsWith(".arc-fav-blur {"))!;

test("--fav-blur-t 在 .arc-fav-grid 里定义，默认 .12s", () => {
    expect(style).toMatch(/\.arc-fav-grid \{ --fav-blur-t: \.12s; --fav-render: 16; \}/);
});
test("基础 .arc-fav-blur 没有 transition（未选中 hover / 外观切换 / 创建时瞬时）", () => {
    expect(rule).not.toContain("transition");
});
test("只有 .arc-fav-tile.active（选中）的模糊层带 opacity 过渡，时长 var(--fav-blur-t, .12s)，缓动默认：不用 --arc-ease / --arc-t-fast", () => {
    const l = style.split("\n").find(x => x.startsWith(".arc-fav-tile.active .arc-fav-blur {"))!;
    expect(l).toBe(".arc-fav-tile.active .arc-fav-blur { transition: opacity var(--fav-blur-t, .12s); }");
    expect(l).not.toMatch(/--arc-ease|--arc-t-fast/);
    expect(style.match(/--fav-blur-t/g)!.length).toBeGreaterThanOrEqual(2);
});
test("--arc-t-fast 全局变量没动（sidepanel.css 仍是 120ms 与 80ms 覆盖）；style.ts 不重定义它", () => {
    expect(side).toContain("--arc-t-fast: 120ms;");
    expect(side).toContain("--arc-t-fast: 80ms;");
    expect(style).not.toMatch(/--arc-t-fast:\s*\d/);
});
test("磁贴本体的 transition 仍走 --arc-t-fast；α 值不变（深 .2 / .3，浅 0 / .1）", () => {
    expect(style).toMatch(/transition: background var\(--arc-t-fast\) var\(--arc-ease\), transform var\(--arc-t-fast\) var\(--arc-ease\);/);
    expect(style).toContain("--fav-blur-a: 0; --fav-blur-a-hover: .1;");
    expect(style).toContain(':root[data-theme="dark"] .arc-fav-grid { --fav-blur-a: .2; --fav-blur-a-hover: .3;');
});
test("磁贴白色填充只在选中（.active）时设置：基础磁贴 background: transparent，.active 才用 --fav-sel", () => {
    expect(style).toMatch(/\.arc-fav-tile \{[^}]*background: transparent;/);
    expect(style).toContain(":root .arc-fav-grid .arc-fav-tile.active { background: var(--fav-sel);");
});

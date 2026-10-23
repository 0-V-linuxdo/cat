import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { ION_GLYPHS } from "../src/api/ionGlyphs";

// New Tab 行「+」：Arc 取 SF plus 16pt medium 的自然大小（13.086），居中在 16×16 视图里（ionicons-to-arc.md L17）。
test("New Tab「+」按 13.086 居中在 16×16 槽里，不被撑满槽", () => {
    const css = readFileSync(new URL("../src/plugins/tabs/style.ts", import.meta.url), "utf8");
    expect(ION_GLYPHS.plusMedium.w).toBeCloseTo(13.086, 3);
    expect(css).toContain(".arc-newtab > .arc-svg-plusMedium { box-sizing: border-box; padding: calc((var(--arc-fav-size) - 13.086px) / 2); }");
    expect(css).toContain(".arc-newtab .arc-svg { width: var(--arc-fav-size); }"); // 槽仍是 16 宽（左边距 / 文字间距不变）
});

// Rea newtab-plus.md §2：图标 ForegroundSecondary α.5（浅黑 / 深白），文字 SidebarForeground 浅 α.3 / 深 α.45。
test("New Tab 行：图标与文字分色（Arc 命名色），不再共用 --arc-muted", () => {
    const css = readFileSync(new URL("../src/plugins/tabs/style.ts", import.meta.url), "utf8");
    expect(css).toContain(".arc-newtab { --nt-text: rgb(0 0 0/.3); --nt-icon: rgb(0 0 0/.5); color: var(--nt-text); }");
    expect(css).toContain(':root[data-theme="dark"] .arc-newtab { --nt-text: rgb(255 255 255/.45); --nt-icon: rgb(255 255 255/.5); }');
    expect(css).toContain(":root .arc-newtab:hover { --nt-text: var(--arc-fg); --nt-icon: var(--arc-fg); }"); // hover 前景色保留（Arc ⛔ 未找到）
});

// Rea newtab-plus.md §4：只有 New Tab 文字明确 14；--arc-fs 保持 13（其它标题字号 ⛔ 源码未找到）。
test("New Tab 文字 14px，全局 --arc-fs 仍是 13px", () => {
    const css = readFileSync(new URL("../src/plugins/tabs/style.ts", import.meta.url), "utf8");
    expect(css).toContain(".arc-newtab > span { font-size: 14px; }");
    expect(readFileSync(new URL("../static/sidepanel.css", import.meta.url), "utf8")).toContain("--arc-fs: 13px;");
});

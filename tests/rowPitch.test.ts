import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

/* 行 pitch 41（Rea space-header-layout.md §3：sidebarItem 行高 40 = 盒 36 + 上下各 2；intercellSpacing 1 → 盒 pitch 41）。
 * 文件夹内 + Today + 新标签行补 gap 1；固定区本来就是 gap 1px，不改。⛔ 盒在 40 高行里的 y（按 margin 居中，推断）。 */
const tabs = readFileSync("src/plugins/tabs/style.ts", "utf8");
const css = readFileSync("static/sidepanel.css", "utf8");
const rule = (src: string, sel: string) => { const i = src.indexOf(`\n${sel} {`); expect(i, `没有规则 ${sel}`).toBeGreaterThanOrEqual(0); return src.slice(i, src.indexOf("}", i)); };

describe("行 pitch 41（intercell 1）", () => {
    test("变量 --arc-row-gap: 1px 定义在 tabs/style.ts（不进共享 sidepanel.css）", () => {
        expect(tabs).toContain(":root { --arc-row-gap: 1px; }");
        expect(css).not.toContain("--arc-row-gap");
    });
    test("Today / 文件夹 / 文件夹子行容器：flex 列 + gap var(--arc-row-gap)", () => {
        expect(rule(tabs, ".arc-today")).toMatch(/display: flex; flex-direction: column; gap: var\(--arc-row-gap/);
        expect(rule(tabs, ".arc-folder, .arc-folder-body")).toMatch(/display: flex; flex-direction: column; gap: var\(--arc-row-gap/);
    });
    test("折叠且无子行的文件夹：空 body 不显示（否则 gap 白占 1px）", () => {
        expect(tabs).toContain(".arc-folder-body:empty { display: none; }");
    });
    test("子行容器里 tab → 子文件夹：清掉 sidepanel.css:404 的 .arc-tab + .arc-folder margin-top（flex 不折叠，否则 pitch 43）", () => {
        expect(tabs).toContain(".arc-folder-body > .arc-tab + .arc-folder { margin-top: 0; }");
        expect(css).toContain(":root .arc-tab + .arc-folder"); // 共享规则本身不改
    });
    test("新标签行：上下 margin 2（行 40 内居中 36）+ 下补 intercell 1", () => {
        expect(tabs).toMatch(/margin: calc\(\(var\(--arc-row-pitch, 40px\) - var\(--arc-row-h\)\) \/ 2\) 0 calc\(\(var\(--arc-row-pitch, 40px\) - var\(--arc-row-h\)\) \/ 2 \+ var\(--arc-row-gap, 1px\)\)/);
        // 共享变量：行高 36 / 行槽 40 不变 → margin 2
        expect(css).toMatch(/--arc-row-h: 36px; --arc-row-pitch: 40px;/);
        expect(css).toMatch(/:root \.arc-tab, :root \.arc-folder-head \{ height: var\(--arc-row-h\); margin: calc\(\(var\(--arc-row-pitch\) - var\(--arc-row-h\)\) \/ 2\) 0;/);
    });
    test("固定区：.arc-pinned 仍是 flex 列 gap 1px（容器本身未改）", () => {
        expect(rule(tabs, ".arc-pinned")).toContain("display: flex; flex-direction: column; gap: 1px; min-height: 8px;");
    });
    test("固定区 tab → 文件夹：清掉共享 .arc-tab + .arc-folder 的 margin-top 2（7 → 5，pitch 43 → 41），特异性高于共享规则，只作用于 .arc-pinned 直接子行", () => {
        expect(tabs).toContain(":root .arc-pinned > .arc-tab + .arc-folder { margin-top: 0; }");
        expect(css).toContain(":root .arc-tab + .arc-folder"); // 共享规则本身不改（(0,3,0) < 我们的 (0,4,0)）
        expect(css).not.toMatch(/arc-pinned > \.arc-tab \+ \.arc-folder/); // 没有往共享 css 里加
        // 其它方向不动：folder + tab 的 margin-top 2 恰好等于 tab 自己的 margin，不需要清
        expect(tabs).not.toMatch(/\.arc-pinned > \.arc-folder \+ \.arc-tab/);
    });
});

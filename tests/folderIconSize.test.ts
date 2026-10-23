/* D-01 文件夹图标尺寸：ListHeader.folderIconSize 17×17（sidebar-full-spec.md:293，@0x102a25a10；rFB/1003ede28.c L18）；Archive 行 imageSize 16（archive-page.md:46）。字形 = FolderIconView 代码绘制复刻（folder-icon-search-padding.md §B），非 SF、非 ionicons。 */
import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
const r = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const fake = () => { const attrs: Record<string, string> = {}, cls = new Set<string>(); return { dataset: {} as Record<string, string>, innerHTML: "", setAttribute: (k: string, v: string) => { attrs[k] = v; }, getAttribute: (k: string) => attrs[k] ?? null, classList: { add: (...c: string[]) => c.forEach(x => cls.add(x)), contains: (c: string) => cls.has(c) } }; };

test("folderGlyph 默认 17×17 盒；传 16 为 16×16（Library Archive 行）", async () => {
    const g0 = globalThis as unknown as { document?: unknown }; const prev = g0.document;
    g0.document = { createElement: fake };
    const { folderGlyph, FOLDER_ICON_SIZE } = await import("../src/api/icons");
    const d = folderGlyph(false, undefined, 2) as unknown as ReturnType<typeof fake>, s16 = folderGlyph(false, 16, 2) as unknown as ReturnType<typeof fake>;
    g0.document = prev;
    expect(FOLDER_ICON_SIZE).toBe(17);
    expect(d.getAttribute("style")).toContain("width:17px;height:17px");
    expect(s16.getAttribute("style")).toContain("width:16px;height:16px");
    expect(d.innerHTML).not.toMatch(/ fill="(?!url)/); // 不再是 SF 填充字形，颜色走 CSS 变量
});

test("文件夹行盒 17×17（tabs/style.ts）；注释写明出处", () => {
    expect(r("src/plugins/tabs/style.ts")).toMatch(/\.arc-folder-icon \{ width: 17px; height: 17px;/);
    expect(r("src/api/icons.ts")).toMatch(/ListHeaderCellView\._iconView 宽高约束 17×17，rFB\/1003ede28\.c L18/);
});

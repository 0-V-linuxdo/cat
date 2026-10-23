/* Library Archive 归档文件夹图标 = 16（ContentCell imageSize 16×16，archive-page.md:46），不跟侧栏文件夹行的默认 17 */
import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
test("libraryView 归档文件夹 folderGlyph(false, 16)", () => {
    const s = readFileSync(new URL("../src/plugins/library/libraryView/index.ts", import.meta.url), "utf8");
    expect(s).toContain("folderGlyph(false, 16)");
    expect(s).not.toMatch(/folderGlyph\(false\)/);
});

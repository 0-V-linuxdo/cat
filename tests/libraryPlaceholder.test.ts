/* Library 共用搜索框占位符（Rea library-search-placeholder.md，PageHeaderView，rIon/1026e91d0.c L257–271） */
import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import en from "../src/i18n/en";
import zh from "../src/i18n/zh";
import { searchPlaceholder } from "../src/plugins/library/libraryView/searchPlaceholder";
const t = en as Record<string, string>, z = zh as Record<string, string>;
const fill = (s: string, v: string) => s.replace("{0}", v);

test("标题为空 → 'Search…'；否则 'Search ' + 标题 + '…'（U+2026）", () => {
    expect(searchPlaceholder("")).toBe("Search\u2026");
    expect(searchPlaceholder("Archive")).toBe("Search Archive\u2026");
    expect(searchPlaceholder("Boosts")).toBe("Search Boosts\u2026");
    expect(searchPlaceholder("Downloads")).toBe("Search Downloads\u2026");
    expect(searchPlaceholder("Archive")).not.toContain("...");
});
test("en：library.search / searchTitled 的字面值；Archive 页标题 = 'Archive'", () => {
    expect(t["library.search"]).toBe("Search\u2026");
    expect(t["library.searchTitled"]).toBe("Search {0}\u2026");
    expect(t["library.pageArchive"]).toBe("Archive");
    expect(t["library.searchArchive"]).toBeUndefined();
});
test("zh：沿用原中文（⛔ Arc 中文本地化未找到）：'搜索…' / '搜索{0}…' / 归档页仍是 '搜索归档…'", () => {
    expect(z["library.search"]).toBe("搜索…");
    expect(fill(z["library.searchTitled"]!, z["library.pageArchive"]!)).toBe("搜索归档…");
    expect(z["library.searchArchive"]).toBeUndefined();
});
test("libraryView 的搜索框占位符经 searchPlaceholder 生成，没有逐页写死的字符串", () => {
    const src = readFileSync(new URL("../src/plugins/library/libraryView/index.ts", import.meta.url), "utf8");
    expect(src).toContain('import { searchPlaceholder } from "./searchPlaceholder"');
    expect(src.match(/placeholder: /g)?.length).toBe(1);
    expect(src).toContain('placeholder: searchPlaceholder(tr("library.pageArchive"))');
});

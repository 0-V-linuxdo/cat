/* Library Archive 页（archive-page.md）：结构断言（libraryView 依赖 DOM / chrome，按源码检查） */
import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import en from "../src/i18n/en";
const src = readFileSync(resolve(import.meta.dir, "../src/plugins/library/libraryView/index.ts"), "utf8");
const t = en as Record<string, string>;

test("Delete / Restore 包在 .arc-lib-acts 里（归档 + 下载两处）", () => {
    expect(src.match(/h\("span", \{ class: "arc-lib-acts" \}/g)?.length).toBe(2);
    const arch = src.slice(src.indexOf("function renderArchive"), src.indexOf("function favBox"));
    expect(arch).toMatch(/arc-lib-acts" \},\s*\n\s*h\("button", \{ class: "arc-icon-btn arc-lib-act", "data-tip": tr\("common\.delete"\)[^\n]*icon\("trash", 14\)/);
    expect(arch).toMatch(/"data-tip": tr\("common\.restore"\)[^\n]*icon\("undo", 14\)/);
});

test("文案：Delete / Restore / Search Archive…（由页面标题生成） / Filter 菜单 / 分组 / 空状态", () => {
    expect([t["common.delete"], t["common.restore"], t["library.searchTitled"]!.replace("{0}", t["library.pageArchive"]!), t["library.filterTitle"], t["library.whereTab"], t["library.howClosed"], t["library.autoClosed"], t["library.manualClosed"]])
        .toEqual(["Delete", "Restore", "Search Archive…", "Filter Archived Tabs", "Where was the tab?", "How was the tab closed?", "Auto-Closed", "Manually Closed"]);
    expect(t["library.removeFilter"]).toBe("Remove {0} Filter");
    expect([t["library.today"], t["library.yesterday"], t["library.earlierWeek"]]).toEqual(["Today", "Yesterday", "Earlier This Week"]);
    expect(t["library.nothingYet"]).toBe("Nothing here yet!");
    expect(t["library.nothingYetSub"]).toBe("Hover your mouse over a tab and press the × to archive it.");
    expect(t["library.noResults"].startsWith("No results found for")).toBe(true);
});

test("Filter 菜单以标题开头；右键菜单只有 Restore / Delete；第二行只显示域名", () => {
    expect(src).toContain(`{ label: tr("library.filterTitle"), disabled: true }`);
    expect(src).toMatch(/openMenu\(\{ x: e\.clientX, y: e\.clientY \}, \[\{ label: tr\("common\.restore"\)[^\]]*\{ label: tr\("common\.delete"\)[^\]]*\}\]\)/);
    expect(src).toContain(`h("span", { class: "arc-lib-url" }, i.folder ? "" : displayUrl(i.url, "domain"))`); // 归档文件夹（「菜单定案」§3）无网址
    expect(src).toContain(`placeholder: searchPlaceholder(tr("library.pageArchive"))`);
    expect(src).not.toContain("library.searchArchive");
    expect(src).toContain(`icon("search", 14), q)`);
});

test("归档行：单击只选中（.current），不恢复；提示 = 标题；滚动时 .scrolling、停 150ms 移除", () => {
    const arch = src.slice(src.indexOf("function renderArchive"), src.indexOf("function favBox"));
    expect(arch).toContain(`"data-tip": i.title || null`);
    expect(arch).toContain(`onclick: (e: MouseEvent) => select(e.currentTarget as HTMLElement, i.id),`);
    expect(arch).not.toMatch(/onclick: restore/);
    expect(arch).not.toMatch(/ondblclick/);
    expect(arch).toMatch(/classList\.add\("scrolling"\)[^\n]*setTimeout\(\(\) => list\.classList\.remove\("scrolling"\), 150\)/);
    expect(arch).toContain('`arc-lib-row${i.id === archSel ? " current" : ""}`');
});

test("favBox：无 favicon / 加载失败 / 默认地球 → .no-fav；加载中不加", () => {
    const fb = src.slice(src.indexOf("export function favBox"), src.indexOf("function dlRow"));
    expect(fb).toContain(`if (!src) { box.classList.add("no-fav"); return box; }`);
    expect(fb).toContain(`onerror: () => box.classList.add("no-fav")`);
    expect(fb).toContain(`else box.classList.add("no-fav");`);
});

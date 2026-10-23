/* 补丁 multiselect-menu：多选菜单按「菜单定案」§1/§2/§4 —— 复制到 tests/ */
import { expect, test } from "bun:test";
import { readFileSync } from "fs";

const s = readFileSync("src/plugins/tabs/multiSelect/index.ts", "utf8");
const menu = s.slice(s.indexOf("function selectionMenu()"), s.indexOf("const CLOSE_KEY"));
test("无 Pin / Unpin / Add to Favorites / Close Tabs / Move to Folder", () => {
    for (const k of ['"multi.pinN"', '"multi.unpinN"', '"fav.add"', '"undo.closeN"', '"multi.archiveN"', '"multi.moveToFolder"']) expect(menu).not.toContain(k);
});
test("组 5：Move to ▸ 各 Space → 分隔线 → New Space…（无痕隐藏）+ New Folder with N Items（n > 1）", () => {
    expect(menu).toContain('incognito ? null : {\n            label: tr("tab.moveTo")');
    expect(menu).toContain('{ separator: true, label: "" }, { label: tr("spaces.moveToNew"), run: actions.moveToNewSpace');
    expect(menu).toContain('!incognito && n > 1 && isPluginEnabled("Folders") ? { label: tr("multi.newFolderWithN", n)');
    expect(menu.indexOf('tr("tab.moveTo")')).toBeLessThan(menu.indexOf("multi.newFolderWithN"));
});
test("组 6：全是固定项 → Remove Pin(s)，否则（混选 / 今日）→ Archive Tab(s)，且在最后", () => {
    expect(menu).toContain("const allPinned = pins.length > 0 && tabIds.length === 0;");
    expect(menu).toMatch(/allPinned \? \{ label: tr\(pins\.length > 1 \? "pinned\.removePins" : "pinned\.removePin"\)[\s\S]*: \{ label: tr\(n > 1 \? "tab\.archiveTabs" : "tab\.archiveTab"\)/);
    expect(menu.indexOf("multi.newFolderWithN")).toBeLessThan(menu.indexOf("allPinned ?"));
    expect(s).toMatch(/async moveToNewSpace\(\) \{[\s\S]{0,200}const r = resolved\(\), from = activeSpace\(\)\.id;/);
});

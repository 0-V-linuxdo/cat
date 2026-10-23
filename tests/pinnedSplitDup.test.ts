/* 补丁 pinned-split-dup：固定 / 收藏菜单组 4 Open in Split View / Duplicate 复用标签菜单同一项 —— 复制到 tests/ */
import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import { MENU_LAYOUT } from "../src/api/ContextMenus";

const rd = (p: string) => readFileSync(p, "utf8");
const ta = rd("src/plugins/tabs/tabActions/index.ts");
const sv = rd("src/plugins/views/splitView/index.ts");

test("版式：pinned 组 4 = split [3,30] / dup [3,31] / moveTo [3,32]，与 tab 同值；Edit Pinned Page 在组 3", () => {
    const p = MENU_LAYOUT.pinned!;
    const g4 = Object.entries(p).filter(([, [g]]) => g === 3).sort((a, b) => a[1][1] - b[1][1]).map(([id]) => id);
    expect(g4).toEqual(["split", "dup", "moveTo"]);
    for (const id of ["split", "dup", "moveTo", "mute"]) expect(p[id]).toEqual(MENU_LAYOUT.tab![id]);
    expect(p.editPinned![0]).toBe(2);
});
test("Duplicate：tabActions 唯一实现 dupMenuItem，注册到 tab / pinned（收藏的 Duplicate 由 favorites 自带）；永远可用（Rea H1：不置灰、不隐藏）；固定项走 pinnedTabs.duplicatePin（rel35b）", () => {
    expect(ta).toMatch(/export const dupMenuItem: MenuItemDef = \{\s*id: "dup", label: "tab\.duplicate"/);
    const at = ta.indexOf("export const dupMenuItem");
    const item = ta.slice(at, ta.indexOf("\n};", at));
    expect(item).not.toMatch(/disabled|visible/);
    expect(ta).toContain("if (t.itemId) return duplicatePin(t.itemId);");
    expect(ta.match(/chrome\.tabs\.duplicate\(t\.tabId\)/g)?.length).toBe(1);
    expect(ta.match(/id: "dup"/g)?.length).toBe(1);
    expect(ta).toContain("        pinned: [dupMenuItem],");
    expect(ta).not.toContain("        favorite: [dupMenuItem],");
    const tab = ta.slice(ta.indexOf("        tab: ["), ta.indexOf("        pinned: [dupMenuItem]"));
    expect(tab).toContain("            dupMenuItem,");
    expect(ta).toMatch(/void safe\(chrome\.tabs\.duplicate/);
});
test("Open in Split View：splitView 唯一实现 splitMenuItem，注册到 tab / pinned / favorite，无条件", () => {
    expect(sv).toMatch(/export const splitMenuItem: MenuItemDef = \{\s*id: "split", label: "split\.withCurrent"/);
    expect(sv.match(/id: "split",/g)?.length).toBe(1);
    expect(sv).not.toMatch(/splitMenuItem: MenuItemDef = \{[^}]*visible/);
    for (const loc of ["pinned", "favorite"]) expect(sv).toContain(`        ${loc}: [splitMenuItem],`);
    expect(sv).toContain("            splitMenuItem,");
    expect(sv).toContain("chrome.tabs.remove(t.tabId).catch(() => { })");
});

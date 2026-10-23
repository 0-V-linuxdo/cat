import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { editPinnedMenu, editPinnedVisible } from "../src/plugins/tabs/pinnedTabs/editPinnedMenu";
import { STRINGS } from "../src/plugins/spaces/favorites/i18n";
import { favMenuState, favSelectionCount } from "../src/plugins/spaces/favorites/menuState";

/* 收藏右键菜单（urlbar-menus-followup.md「收藏菜单完整结构」L326–415）：收藏插件注册的项、标签、子菜单、多选状态 */
const src = readFileSync(new URL("../src/plugins/spaces/favorites/index.ts", import.meta.url), "utf8");
const block = src.slice(src.indexOf("favorite: ["), src.indexOf("background: {"));
const ids = (s: string) => [...s.matchAll(/\{\s*id: "(\w+)", label: ([^,]+),|(editPinnedMenu)\(\{/g)].map(m => m[3] ? ["editPinned", "pinned.editPinned"] : [m[1], m[2].trim()]);

describe("收藏菜单项", () => {
    test("注册顺序 / 标签：copy、changeIcon、rename、editPinned ▸、dup、closeTab、remove", () => {
        expect(ids(block).map(([id]) => id)).toEqual(["copy", "changeIcon", "rename", "editPinned", "dup", "closeTab", "remove"]);
        const label = Object.fromEntries(ids(block));
        expect(label.changeIcon).toBe('"fav.changeIcon"');
        expect(label.rename).toBe('"fav.rename"');
        expect(label.closeTab).toBe('"fav.closeTab"');
        expect(label.remove).toBe('"fav.removeFrom"');
        expect(block).toMatch(/label: \(\) => favMenuState\(favSelectionCount\(\)\)\.copyLabel/);
        expect(block).toMatch(/disabled: \(\) => favMenuState\(favSelectionCount\(\)\)\.changeIconDisabled/);
    });
    test("Edit Pinned Page ▸ 用固定标签共用的构造（单选 / 非无痕 / 网址可解析），不再手写子菜单", () => {
        expect(block).toMatch(/editPinnedMenu\(\{\s*visible: t => editPinnedVisible\(favSelectionCount\(\), incognito\(\), favUrl\(t\)\)/);
        expect(block).not.toContain("submenu:");
        expect(block).not.toContain("editLabel");
        const m = editPinnedMenu({ visible: () => true, replace: () => { }, edit: () => { } });
        expect([m.id, m.label]).toEqual(["editPinned", "pinned.editPinned"]);
        expect(m.submenu!({}).map(c => [c.id, c.label])).toEqual([["replace", "pinned.replace"], ["editUrl", "pinned.editPinnedUrl"]]);
    });
    test("旧的平铺项 replace / editUrl / icon / iconReset 不再在顶层；恢复默认图标的逻辑是 resetFavIcon（头部删除按钮调用）", () => {
        for (const id of ["replace", "editUrl", "icon", "iconReset"]) expect(ids(block).map(([i]) => i)).not.toContain(id);
        expect(src).toContain("export { resetFavIcon }");
    });
    test("中文标签是英文原文的译文", () => {
        expect(STRINGS.en).toMatchObject({ "fav.copyLinks": "Copy Links", "fav.changeIcon": "Change Icon…", "fav.rename": "Rename…" });
        expect(STRINGS.zh).toMatchObject({ "fav.copyLinks": "复制链接", "fav.changeIcon": "更换图标…", "fav.rename": "重命名…" });
    });
});

describe("收藏菜单条件", () => {
    test("单选：Copy Link；Change Icon… 可用；Rename 出现；Edit Pinned Page 出现", () => {
        expect(favMenuState(1)).toEqual({ copyLabel: "tab.copyLink", changeIconDisabled: false, renameVisible: true });
        expect(editPinnedVisible(1, false, "https://a.com")).toBe(true);
    });
    test("多选：Copy Links；Change Icon… 显示但置灰；Rename / Edit Pinned Page 不出现", () => {
        expect(favMenuState(2)).toEqual({ copyLabel: "fav.copyLinks", changeIconDisabled: true, renameVisible: false });
        expect(favMenuState(5).changeIconDisabled).toBe(true);
        expect(editPinnedVisible(2, false, "https://a.com")).toBe(false);
    });
    test("Edit Pinned Page：无痕或网址无法解析时不出现", () => {
        expect(editPinnedVisible(1, true, "https://a.com")).toBe(false);
        expect(editPinnedVisible(1, false, undefined)).toBe(false);
        expect(editPinnedVisible(1, false, "")).toBe(false);
    });
    test("⛔ 收藏还不能多选：选中数恒为 1", () => expect(favSelectionCount()).toBe(1));
});

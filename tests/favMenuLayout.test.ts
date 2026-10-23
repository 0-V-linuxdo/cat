import { describe, expect, test } from "bun:test";
import { MENU_LAYOUT } from "../src/api/ContextMenus";

/* 收藏右键菜单版式（urlbar-menus-followup.md「收藏菜单完整结构」L326–415）：分组 / 顺序（Mute / Split / Duplicate 分别由 media / splitView / tabActions 注册到 favorite 位置） */
const lay = MENU_LAYOUT.favorite!;
const ordered = Object.entries(lay).sort((a, b) => a[1][1] - b[1][1]);

describe("收藏菜单 MENU_LAYOUT", () => {
    test("分组：Copy | Change Icon / Rename / Mute / Edit Pinned Page | Split / Duplicate | Close Tab / Remove Favorite", () => {
        expect(ordered.map(([id, [g]]) => `${g}:${id}`)).toEqual(["1:copy", "2:changeIcon", "2:rename", "2:mute", "2:editPinned", "3:split", "3:dup", "6:closeTab", "6:remove"]);
    });
    test("与 tab / pinned 菜单同名项同槽位", () => {
        for (const id of ["copy", "changeIcon", "rename", "mute", "split", "dup"]) expect(lay[id]).toEqual(MENU_LAYOUT.tab![id]);
        expect(lay.editPinned).toEqual(MENU_LAYOUT.pinned!.editPinned);
    });
    test("没有 Arc 收藏菜单外的项（旧的 replace / editUrl / icon / iconReset 不在版式里，也不在组 9）", () => {
        for (const id of ["replace", "editUrl", "icon", "iconReset", "moveTo", "share", "customize", "liveCalendar"]) expect(lay).not.toHaveProperty(id);
    });
});

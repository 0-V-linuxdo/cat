import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { MENU_LAYOUT } from "../src/api/ContextMenus";
import { favMenuState } from "../src/plugins/spaces/favorites/menuState";

/* 收藏 Rename…（urlbar-menus-followup.md「收藏菜单完整结构」第 7 项；收藏走 renameFavorite(12)） */
const saved: Record<string, unknown> = {};
const prevChrome = (globalThis as any).chrome;
afterAll(() => { (globalThis as any).chrome = prevChrome; });
beforeAll(() => {
    (globalThis as any).chrome = {
        storage: {
            local: { get: async () => ({}), set: async (o: Record<string, unknown>) => { Object.assign(saved, structuredClone(o)); } },
            onChanged: { addListener: () => { } },
        },
    };
});
const src = readFileSync(new URL("../src/plugins/spaces/favorites/index.ts", import.meta.url), "utf8");

describe("收藏 Rename…", () => {
    test("位置：组 2，Change Icon… 之后、Mute 之前（与 tab / pinned 菜单同槽位）", () => {
        const fav = MENU_LAYOUT.favorite!;
        expect(fav.rename[0]).toBe(fav.changeIcon[0]);
        expect(fav.rename[0]).toBe(fav.mute[0]);
        expect(fav.changeIcon[1]).toBeLessThan(fav.rename[1]);
        expect(fav.rename[1]).toBeLessThan(fav.mute[1]);
        expect(fav.rename).toEqual(MENU_LAYOUT.tab!.rename);
    });
    test("只在单选时出现", () => {
        expect(src).toMatch(/id: "rename", label: "fav\.rename", visible: \(\) => favMenuState\(favSelectionCount\(\)\)\.renameVisible/);
        expect(favMenuState(1).renameVisible).toBe(true);
        expect(favMenuState(2).renameVisible).toBe(false);
    });
    test("改名后写入存储，显示名称（磁贴 aria-label / 菜单 target）用自定义名称；清空恢复原名", async () => {
        const { favStore, favTitle, renameFav } = await import("../src/plugins/spaces/favorites/store");
        await favStore.update(x => { x.items = [{ id: "f1", url: "https://a.com", title: "A" }]; });
        await renameFav("f1", "  我的 A  ");
        const f = favStore.get().items[0];
        expect(f.customTitle).toBe("我的 A");
        expect((saved["data:favorites"] as any).items[0].customTitle).toBe("我的 A");
        expect(favTitle(f, { title: "Tab A" })).toBe("我的 A");
        await renameFav("f1", "");
        const g = favStore.get().items[0];
        expect(g.customTitle).toBeUndefined();
        expect(favTitle(g, { title: "Tab A" })).toBe("Tab A");
        expect(favTitle(g)).toBe("A");
        expect(src).toMatch(/"aria-label": favTitle\(f, tab\)/);
        expect(src).toMatch(/showContextMenu\(e, "favorite", \{[^}]*title: favTitle\(f, tab\)/);
    });
    test("固定项拖成收藏时保留自定义名称", () => {
        expect(src).toMatch(/customTitle: n\.customTitle/);
    });
});

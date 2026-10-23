import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { editPinnedMenu, editPinnedVisible } from "../src/plugins/tabs/pinnedTabs/editPinnedMenu";

/* P-04：Edit Pinned Page ▸（urlbar-menus-followup.md L326–415 第 10 项，out7/0x102eb73c0.c） */
const rd = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

describe("editPinnedMenu", () => {
    const calls: string[] = [];
    const item = editPinnedMenu({ visible: () => true, replace: () => calls.push("replace"), edit: () => calls.push("edit") });
    test("父项 id / 文字；子菜单顺序 ① Replace Pinned URL with Current ② Edit…", () => {
        expect(item.id).toBe("editPinned"); expect(item.label).toBe("pinned.editPinned");
        const sub = item.submenu!({});
        expect(sub.map(s => s.id)).toEqual(["replace", "editUrl"]);
        expect(sub.map(s => s.label)).toEqual(["pinned.replace", "pinned.editPinnedUrl"]);
        sub[0].run({}); sub[1].run({});
        expect(calls).toEqual(["replace", "edit"]);
    });
    test("两个子项没有附加条件（eb73c0：enabled = 1，无 visible / disabled）", () => {
        for (const s of item.submenu!({})) { expect(s.visible).toBeUndefined(); expect(s.disabled).toBeUndefined(); }
    });
    test("收藏可换 ② 的文字键", () => {
        expect(editPinnedMenu({ visible: () => true, replace: () => 0, edit: () => 0, editLabel: "fav.editPinnedUrl" }).submenu!({})[1].label).toBe("fav.editPinnedUrl");
    });
});

describe("editPinnedVisible：单选、非无痕、网址可解析", () => {
    test.each([
        [1, false, "https://a.com", true],
        [2, false, "https://a.com", false],
        [0, false, "https://a.com", false],
        [1, true, "https://a.com", false],
        [1, false, undefined, false],
        [1, false, "", false],
    ] as const)("n=%p incog=%p url=%p → %p", (n, inc, url, want) => expect(editPinnedVisible(n, inc, url)).toBe(want));
});

describe("固定标签菜单接入", () => {
    const pin = rd("src/plugins/tabs/pinnedTabs/index.ts");
    const block = pin.slice(pin.indexOf("        pinned: ["), pin.indexOf("    background:"));
    test("用共用构造，带无痕与网址条件；不再有平铺 / 旧顺序的 editUrl、replace", () => {
        expect(block).toContain("editPinnedMenu({");
        expect(block).toMatch(/visible: t => editPinnedVisible\(1, inIncognito\(\), pinNodeUrl\(t\)\)/);
        expect(block).not.toMatch(/id: "(editUrl|replace)"/);
        expect(block.indexOf("replace:")).toBeLessThan(block.indexOf("edit:"));
    });
    test("文字：Edit Pinned Page / Replace Pinned URL with Current / Edit…", () => {
        const en = rd("src/i18n/en.ts"), zh = rd("src/i18n/zh.ts");
        expect(en).toContain('"pinned.editPinned": "Edit Pinned Page"');
        expect(en).toContain('"pinned.replace": "Replace Pinned URL with Current"');
        expect(en).toContain('"pinned.editPinnedUrl": "Edit…"');
        expect(zh).toContain('"pinned.editPinnedUrl": "编辑…"');
        expect(en).not.toContain('"Edit the pinned URL"');
    });
    test("版式：pinned 组内 Rename < Mute < Edit Pinned Page（同组）", () => {
        const cm = rd("src/api/ContextMenus.ts");
        const m = cm.match(/\n {4}pinned: \{([^}]*)\}/)!;
        const get = (id: string) => m[1].match(new RegExp(`\\b${id}: \\[(\\d+), (\\d+)\\]`))?.slice(1).map(Number);
        const [g, o] = get("editPinned")!;
        expect(g).toBe(get("rename")![0]); expect(o).toBeGreaterThan(get("rename")![1]);
        const mute = get("mute");
        if (mute) { expect(mute[0]).toBe(g); expect(o).toBeGreaterThan(mute[1]); }
    });
});

/* rel34：URL 取法 = 当前页 URL 优先，取不到才回退保存的 URL（urlbar-menus-followup.md L467–572） */
import { editPinnedUrlOf } from "../src/plugins/tabs/pinnedTabs/editPinnedMenu";
describe("editPinnedUrlOf", () => {
    test.each([
        ["https://cur", "https://saved", "https://cur"],
        [undefined, "https://saved", "https://saved"],
        ["", "https://saved", "https://saved"],
        ["https://cur", undefined, "https://cur"],
        [undefined, undefined, undefined],
        ["", "", undefined],
    ] as const)("current=%p saved=%p → %p", (c, s, want) => expect(editPinnedUrlOf(c, s)).toBe(want));
    test("固定 / 收藏都用它；Replace 未打开时不隐藏、不置灰、无 toast", () => {
        const pin = rd("src/plugins/tabs/pinnedTabs/index.ts"), fav = rd("src/plugins/spaces/favorites/index.ts"), emp = rd("src/plugins/tabs/pinnedTabs/editPinnedMenu.ts");
        expect(pin).toContain("editPinnedUrlOf(getTab(t.tabId)?.url");
        expect(fav).toMatch(/resolveFavUrl\(getTab\(f\?\.tabId\)\?\.url, f\?\.url \?\? t\.url\)/); // 设置页版：resolveFavUrl 与 editPinnedUrlOf 同规则（当前页优先）
        const rep = emp.slice(emp.indexOf('id: "replace"'), emp.indexOf('id: "editUrl"'));
        expect(rep).not.toMatch(/disabled|visible/);
        for (const s of [pin, fav]) { const r = s.slice(s.indexOf("replace: t =>"), s.indexOf("edit: t =>")); expect(r).not.toContain("toast"); }
    });
});

import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { dupFav, type Fav, favTitle, replaceFavUrl } from "../src/plugins/spaces/favorites/store";

/* 收藏的 Replace Pinned URL with Current / Duplicate —— urlbar-menus-followup.md L513–534（Replace 对 customTitle / savedTitle / 图标）、「H1」（未打开的 Duplicate） */
const rd = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const fav = rd("src/plugins/spaces/favorites/index.ts");
const ta = rd("src/plugins/tabs/tabActions/index.ts");
const mk = (o: Partial<Fav> = {}): Fav => ({ id: "f1", url: "https://old.com/", title: "Old", ...o });

describe("A) Replace Pinned URL with Current", () => {
    test("只写 savedURL / savedTitle / savedFavicon；customTitle、自定义图标、id、tabId 不动", () => {
        const f = mk({ customTitle: "Mine", icon: "sym:star", favicon: "https://old.com/f.ico", tabId: 7 });
        expect(replaceFavUrl(f, { url: "https://new.com/", title: "New", favIconUrl: "https://new.com/f.ico" })).toBe(true);
        expect(f).toEqual({ id: "f1", tabId: 7, url: "https://new.com/", title: "New", customTitle: "Mine", icon: "sym:star", favicon: "https://new.com/f.ico" });
    });
    test("savedTitle 无条件覆盖：当前页没有标题 → 写成空（不保留旧值）", () => {
        const f = mk();
        replaceFavUrl(f, { url: "https://new.com/" });
        expect(f.title).toBe("");
        replaceFavUrl(f, { url: "https://new.com/", title: "" });
        expect(f.title).toBe("");
    });
    test("savedFavicon 仅新值非空才覆盖：空 / 缺失保留旧值", () => {
        const f = mk({ favicon: "https://old.com/f.ico" });
        replaceFavUrl(f, { url: "https://new.com/", title: "N" });
        expect(f.favicon).toBe("https://old.com/f.ico");
        replaceFavUrl(f, { url: "https://new.com/", title: "N", favIconUrl: "" });
        expect(f.favicon).toBe("https://old.com/f.ico");
        replaceFavUrl(f, { url: "https://new.com/", title: "N", favIconUrl: "https://new.com/f.ico" });
        expect(f.favicon).toBe("https://new.com/f.ico");
    });
    test("没有打开的标签 / 没有网址 = 什么也不改（返回 false，不 toast）", () => {
        const f = mk({ customTitle: "Mine" }); const before = structuredClone(f);
        expect(replaceFavUrl(f, undefined)).toBe(false);
        expect(replaceFavUrl(f, { title: "x" })).toBe(false);
        expect(f).toEqual(before);
        const rep = fav.slice(fav.indexOf("replace: t =>"), fav.indexOf("edit: t =>"));
        expect(rep).not.toMatch(/toast/);
    });
    test("替换后显示：customTitle 仍优先；savedTitle 为空时回退到网址", () => {
        const f = mk({ customTitle: "Mine" });
        replaceFavUrl(f, { url: "https://new.com/", title: "New" });
        expect(favTitle(f)).toBe("Mine");
        expect(favTitle({ ...f, customTitle: undefined }, { title: "" })).toBe("New");
        const g = mk(); replaceFavUrl(g, { url: "https://new.com/" });
        expect(favTitle(g)).toBe("https://new.com/");
    });
    test("磁贴图标回退：自定义图标 → 打开标签的 favicon → savedFavicon → 网址 favicon", () => {
        expect(fav).toContain("favTile(f.icon || tab?.favIconUrl || f.favicon || faviconUrl(f.url, 64))");
    });
});

describe("B) Duplicate（收藏）", () => {
    test("菜单项：favorites 自带，不置灰、不隐藏；tabActions 不再给收藏注册共用的 dupMenuItem（否则出现两个 Duplicate）", () => {
        const item = fav.slice(fav.indexOf('{ id: "dup"'), fav.indexOf('{ id: "closeTab"'));
        expect(item).toContain('label: "tab.duplicate"');
        expect(item).toContain("run: t => duplicateFav(t.itemId)");
        expect(item).not.toMatch(/disabled|visible/);
        expect(ta).not.toContain("favorite: [dupMenuItem]");
        expect(ta).toContain("pinned: [dupMenuItem]");
    });
    test("未打开：复制出新项，保留 customTitle，复制 saved 字段（url / title / favicon）和自定义图标", () => {
        const f = mk({ customTitle: "Mine", icon: "😀", favicon: "https://old.com/f.ico", tabId: 9 });
        const c = dupFav(f, undefined);
        expect(c).toEqual({ url: "https://old.com/", title: "Old", customTitle: "Mine", icon: "😀", favicon: "https://old.com/f.ico" });
        expect(c).not.toHaveProperty("tabId"); expect(c).not.toHaveProperty("id");
    });
    test("没有可选字段时不凭空造字段", () => {
        expect(dupFav(mk(), undefined)).toEqual({ url: "https://old.com/", title: "Old" });
    });
    test("已打开且未偏离：保留 customTitle；仅 #片段不同不算偏离", () => {
        expect(dupFav(mk({ customTitle: "Mine" }), { url: "https://old.com/" }).customTitle).toBe("Mine");
        expect(dupFav(mk({ customTitle: "Mine" }), { url: "https://old.com/#x" }).customTitle).toBe("Mine");
    });
    test("已打开且偏离保存网址：网址用当前页，不带 customTitle（Arc FUN_1029dd06c 返回 true）", () => {
        const c = dupFav(mk({ customTitle: "Mine", favicon: "f" }), { url: "https://other.com/" });
        expect(c.url).toBe("https://other.com/"); expect(c.customTitle).toBeUndefined(); expect(c.favicon).toBe("f");
    });
    test("duplicateFav：新项紧跟原项后、遵守 12 个上限、然后打开", () => {
        const fn = fav.slice(fav.indexOf("export async function duplicateFav"), fav.indexOf("async function moveFav"));
        expect(fn).toContain("if (!src || full()) return;");
        expect(fn).toContain("x.items.splice(i < 0 ? x.items.length : i + 1, 0, copy)");
        expect(fn).toContain("await openFav(copy)");
    });
});

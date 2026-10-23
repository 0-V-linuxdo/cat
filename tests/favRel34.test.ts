import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { LOCALES } from "../src/api/i18n";
import { editPinnedMenu, editPinnedVisible } from "../src/plugins/tabs/pinnedTabs/editPinnedMenu";
import { favMenuState, resolveFavUrl } from "../src/plugins/spaces/favorites/menuState";
import { promptBlocked } from "../src/components/Dialog";

/* rel34：urlbar-menus-followup.md L418–512（图标重置 / Replace 未打开）与 L573–633（Rename 对话框） */
const rd = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const fav = rd("src/plugins/spaces/favorites/index.ts");
const picker = rd("src/components/IconPicker.ts");
const dialog = rd("src/components/Dialog.ts");
const icons = rd("src/api/icons.ts");

const saved: Record<string, unknown> = {};
const prevChrome = (globalThis as any).chrome;
beforeAll(() => { (globalThis as any).chrome = { storage: { local: { get: async () => ({}), set: async (o: Record<string, unknown>) => { Object.assign(saved, structuredClone(o)); } }, onChanged: { addListener: () => { } } } }; });
afterAll(() => { (globalThis as any).chrome = prevChrome; });

describe("1. 恢复默认图标：Change Icon… 弹出框头部的删除按钮", () => {
    const head = picker.slice(picker.indexOf('const head = h("div"'), picker.indexOf("const menu = openPanel"));
    test("按钮只在已有自定义图标时出现（canRemoveIcon），点击 = 清空（set('')）；没有文字项", () => {
        expect(head).toMatch(/!cur \? null : h\("button", \{ class: "arc-icon-btn arc-ip-del"/);
        expect(head).toContain('onclick: () => pick("")');
        expect(head).toContain('"data-test": "emoji:none"');
        expect(picker).not.toMatch(/Reset|Remove Icon|Use Default/);
    });
    test("图标 = icomoon U+E9F0 垃圾桶 15pt（不是 SF trash）；没有 tooltip（⛔ Rea 未找到）", () => {
        expect(head).toContain('svgIcon("trashIcomoon", 15)');
        expect(head).not.toContain("data-tip");
        expect(icons).toMatch(/trashIcomoon: \{ src: "arc-icons\/iconfonts\/icomoon\/uniE9F0_UE9F0\.svg", pt: 15, w: 15, h: 15,/);
        expect(icons).toContain("M768 640V85Q768 77"); // uniE9F0 的轮廓
        expect(rd("src/plugins/spaces/style.ts")).toMatch(/\.arc-ip-del \{ width: 22px;/);
    });
    test("收藏 Change Icon… 用该弹出框；空值（删除按钮）调 resetFavIcon，其余写入 icon", () => {
        const item = fav.slice(fav.indexOf('id: "changeIcon"'), fav.indexOf('id: "rename"'));
        expect(item).toContain("openIconPicker(");
        expect(item).toMatch(/, f\.icon, v => void \(v \? favStore\.update\(.*it\.icon = v;.*\) : resetFavIcon\(f\.id\)\)\);/);
        expect(item).not.toContain("floatingEdit");
        expect(fav).not.toMatch(/id: "icon(Reset)?"/);
        expect(fav).toMatch(/isSym\(f\.icon\) \? symIcon\(f\.icon\.slice\(4\), 18\)/); // 弹出框的 Icon 页返回 sym:<名>
    });
    test("resetFavIcon 清空 icon 字段并写入存储，别的收藏不受影响", async () => {
        const { favStore, resetFavIcon } = await import("../src/plugins/spaces/favorites/store");
        await favStore.update(x => { x.items = [{ id: "a", url: "https://a.com", title: "A", icon: "😀" }, { id: "b", url: "https://b.com", title: "B", icon: "🙂" }]; });
        await resetFavIcon("a");
        expect(favStore.get().items[0]).not.toHaveProperty("icon");
        expect(favStore.get().items[1].icon).toBe("🙂");
        expect((saved["data:favorites"] as any).items[0].icon).toBeUndefined();
    });
});

describe("2. Rename 对话框（TextInputDialog）", () => {
    test("文案：Rename Tab… / Keep it short and sweet! / Rename / Cancel；中文是译文", () => {
        expect(LOCALES.en).toMatchObject({ "rename.title": "Rename Tab…", "rename.placeholder": "Keep it short and sweet!", "rename.ok": "Rename", "common.cancel": "Cancel" });
        expect(LOCALES.zh["rename.title"]).toBe("重命名标签…");
        expect(LOCALES.zh["rename.ok"]).toBe("重命名");
        expect(LOCALES.zh["rename.placeholder"]).toBeTruthy();
    });
    test("arcRename：标题 / placeholder / 确认键用共用键，单行 input，requireText", () => {
        expect(dialog).toMatch(/arcRename = \(current: string\) => arcPrompt\(tr\("rename\.title"\), current, \{ placeholder: tr\("rename\.placeholder"\), ok: tr\("rename\.ok"\), requireText: true \}\)/);
        expect(dialog).toContain('"data-test": "dlg-input"');
        expect(dialog).not.toContain("textarea");
        expect(dialog).toMatch(/placeholder: po\.placeholder/);
    });
    test("输入为空（含只有空白）时 Rename 置灰、Enter 不提交；有内容时可提交；不要求时不拦", () => {
        expect(promptBlocked({ requireText: true }, "")).toBe(true);
        expect(promptBlocked({ requireText: true }, "   ")).toBe(true);
        expect(promptBlocked({ requireText: true }, "a")).toBe(false);
        expect(promptBlocked({}, "")).toBe(false);
        expect(dialog).toMatch(/const yes = \(\) => \{ if \(!blocked\(\)\) done\(/);
        expect(dialog).toMatch(/ok\.disabled = blocked\(\)/);
    });
    test("收藏 Rename… 用共用对话框（不再是浮动编辑框），初始文本 = 当前显示名称；收藏不另设对话框文案", () => {
        const at = fav.indexOf('id: "rename"'); const item = fav.slice(at, fav.indexOf("editPinnedMenu({", at));
        expect(item).toContain("arcRename(favTitle(f, getTab(f.tabId)))");
        expect(item).not.toContain("floatingEdit");
        expect(item).toContain("renameFav(f.id, v)");
        const favI18n = rd("src/plugins/spaces/favorites/i18n.ts");
        expect(favI18n).not.toMatch(/rename\.(title|placeholder|ok)|Keep it short/);
    });
    test("取消返回 null → 不改名（源码：v != null 才提交）", () => expect(fav).toMatch(/if \(v != null\) await renameFav/));
});

describe("3. 显示名称规则：非空 customTitle > 页面标题 > 保存的标题（收藏时已回退到网址）", () => {
    test("favTitle", async () => {
        const { favTitle } = await import("../src/plugins/spaces/favorites/store");
        expect(favTitle({ title: "saved", customTitle: "mine" }, { title: "page" })).toBe("mine");
        expect(favTitle({ title: "saved", customTitle: "" }, { title: "page" })).toBe("page");
        expect(favTitle({ title: "saved" }, { title: "" })).toBe("saved");
        expect(favTitle({ title: "https://a.com" })).toBe("https://a.com");
    });
});

describe("4. Replace Pinned URL with Current：未打开时仍显示可点（无操作、无提示）；整个子菜单只在没有任何网址时隐藏", () => {
    test("网址解析：当前页网址优先，其次保存的网址，都没有 = undefined", () => {
        expect(resolveFavUrl("https://now.com", "https://saved.com")).toBe("https://now.com");
        expect(resolveFavUrl(undefined, "https://saved.com")).toBe("https://saved.com");
        expect(resolveFavUrl("", "https://saved.com")).toBe("https://saved.com");
        expect(resolveFavUrl(undefined, undefined)).toBeUndefined();
        expect(resolveFavUrl(undefined, "")).toBeUndefined();
    });
    test("Edit Pinned Page ▸ 可见性：未打开但有保存网址 = 出现；没有任何网址 = 隐藏；无痕 / 多选 = 隐藏", () => {
        expect(editPinnedVisible(1, false, resolveFavUrl(undefined, "https://saved.com"))).toBe(true);
        expect(editPinnedVisible(1, false, resolveFavUrl("https://now.com", undefined))).toBe(true);
        expect(editPinnedVisible(1, false, resolveFavUrl(undefined, undefined))).toBe(false);
        expect(editPinnedVisible(1, true, "https://a.com")).toBe(false);
        expect(editPinnedVisible(2, false, "https://a.com")).toBe(false);
        expect(favMenuState(1).renameVisible).toBe(true);
    });
    test("子项 Replace / Edit… 没有 visible / disabled（照常显示可点）", () => {
        for (const c of editPinnedMenu({ visible: () => true, replace: () => 0, edit: () => 0 }).submenu!({})) { expect(c.visible).toBeUndefined(); expect(c.disabled).toBeUndefined(); }
    });
    test("收藏 Replace：没有打开的标签 = 什么也不做（不 toast）；favUrl 先看当前页再看保存网址", () => {
        const rep = fav.slice(fav.indexOf("replace: t =>"), fav.indexOf("edit: t =>"));
        expect(rep).toMatch(/if \(f\) replaceFavUrl\(f, getTab\(f\.tabId\)\)/); // 无标签 / 无网址 → replaceFavUrl 返回 false，不写
        expect(rep).not.toMatch(/toast/);
        expect(fav).toMatch(/resolveFavUrl\(getTab\(f\?\.tabId\)\?\.url, f\?\.url \?\? t\.url\)/);
    });
    test("固定标签同一规则（命令栏文件）：pinNodeUrl 先当前页再保存网址", () => {
        expect(rd("src/plugins/tabs/pinnedTabs/index.ts")).toContain("const pinNodeUrl = (t: MenuTarget) => editPinnedUrlOf(getTab(t.tabId)?.url");
    });
});

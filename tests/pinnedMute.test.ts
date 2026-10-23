/* rel34：Mute 进固定 / 收藏 / 多选菜单，规则按 urlbar-menus-followup.md L467–572（替换旧版“逐个切换 / 未打开置灰但无 Unmute”的断言） */
import { expect, test } from "bun:test";
import { readFileSync } from "fs";

const rd = (p: string) => readFileSync(p, "utf8");
const media = rd("src/plugins/library/media/index.ts");
const ms = rd("src/plugins/tabs/multiSelect/index.ts");
const cm = rd("src/api/ContextMenus.ts");
const mm = rd("src/plugins/library/media/muteMenu.ts");

test("media：唯一的菜单项 muteMenuItem 注册到 tab / pinned / favorite；标题 Mute / Unmute 由验证器决定", () => {
    expect(media).toMatch(/export const muteMenuItem: MenuItemDef = \{\s*id: "mute", order: 40,/);
    for (const loc of ["tab", "pinned", "favorite"]) expect(media).toContain(`        ${loc}: [muteMenuItem],`);
    expect(media).toContain('muteMenuState([muteItemOf(getTab(t.tabId))]).unmute ? "media.unmute" : "media.mute"');
    expect(media).toContain("disabled: t => muteMenuState([muteItemOf(getTab(t.tabId))]).disabled");
    expect(media).toContain("run: t => muteTabs([t.tabId])");
    expect(media).not.toContain("toggleMuted");
});
test("没有逐个翻转：菜单动作只在 muteTabs 里，且统一设置 { muted }", () => {
    expect(mm).toMatch(/const muted = newMutedFor\(/);
    expect(mm).toMatch(/chrome\.tabs\.update\(t!\.id!, \{ muted \}\)/);
    expect(mm).not.toMatch(/!tab\.mutedInfo/);
});
test("版式：pinned / favorite 的 mute [2, 21] 在 editPinned [2, 22] 之前", () => {
    for (const loc of ["pinned", "favorite"]) {
        const m = cm.match(new RegExp(`\\n {4}${loc}: \\{([^}]*)\\}`))![1];
        expect(m).toContain("mute: [2, 21]"); expect(m).toContain("editPinned: [2, 22]");
    }
});
test("多选菜单：组 3 Mute，同一套规则与 muteTabs，位于复制与 Duplicate 之间", () => {
    const menu = ms.slice(ms.indexOf("function selectionMenu()"), ms.indexOf("const CLOSE_KEY"));
    expect(ms).toContain('import { muteTabs } from "@plugins/library/media";');
    expect(ms).toMatch(/async mute\(\) \{ const \{ tabIds, pins \} = resolved\(\); await muteTabs\(\[\.\.\.tabIds, \.\.\.pins\.map\(p => p\.tabId\)\]\)/);
    expect(menu).toContain("const mute = muteMenuState([...tabIds, ...pins.map(p => p.tabId)].map(id => muteItemOf(getTab(id))));");
    expect(menu).toContain('isPluginEnabled("Media") ? { label: tr(mute.unmute ? "media.unmute" : "media.mute"), run: actions.mute, test: "multi:mute", disabled: mute.disabled } : null');
    const i = (s: string) => menu.indexOf(s);
    expect(i('"multi:copy"')).toBeLessThan(i('"multi:mute"')); expect(i('"multi:mute"')).toBeLessThan(i('"multi:dup"'));
});

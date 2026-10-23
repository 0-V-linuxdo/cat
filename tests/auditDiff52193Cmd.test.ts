import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";

/* audit-arc-diff-52193：命令栏与会话恢复线程（X-01 / X-03 / X-04 / P-02 / P-04 / D-02 / D-03 / U-01 / U-02 / S-01 / 额外 #7 #8 #9） */
const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const en = src("src/i18n/en.ts"), zh = src("src/i18n/zh.ts");
const menus = src("src/api/ContextMenus.ts");
const layout = (kind: string) => menus.match(new RegExp(`\\b${kind}: \\{([^}]*)\\}`))![1];
const grp = (kind: string, id: string) => Number(layout(kind).match(new RegExp(`\\b${id}: \\[(\\d+)`))![1]);

describe("audit-arc-diff-52193（命令栏与会话恢复）", () => {
    test("X-01 / X-03：Arc 菜单文案", () => {
        for (const kv of ['"archive.others": "Archive Other Tabs"', '"archive.below": "Archive Tabs Below"', '"archive.above": "Archive Tabs Above"', '"split.withCurrent": "Open in Split View"',
            '"pinned.closeKeep": "Close and Keep Pinned"', '"tab.archiveThis": "Archive this tab"', '"tab.changeIcon": "Change Icon"', '"tab.renameTab": "Rename Tab"']) expect(en).toContain(kv);
    });
    test("X-01/X-04：关闭在组 6，归档其它 / 下方 / 上方同在组 7；Change Icon 在 Rename 前", () => {
        expect(grp("tab", "close")).toBe(6); for (const id of ["others", "below", "above"]) expect(grp("tab", id)).toBe(7);
        expect(grp("tab", "changeIcon")).toBe(grp("tab", "rename"));
        expect(src("src/plugins/tabs/todayTabs/index.ts")).toMatch(/id: "changeIcon"/);
    });
    test("P-02 / P-04：置顶菜单 Change Icon / Rename / Edit Pinned Page 子菜单", () => {
        const pin = src("src/plugins/tabs/pinnedTabs/index.ts");
        expect(pin).toMatch(/id: "changeIcon"/);
        expect(pin).toMatch(/editPinnedMenu\(\{/); expect(src("src/plugins/tabs/pinnedTabs/editPinnedMenu.ts")).toMatch(/id: "editPinned"[\s\S]{0,400}submenu/);
        expect(layout("pinned")).not.toMatch(/\bcloseTab:/); expect(grp("pinned", "removePin")).toBe(6); // 「菜单定案」§4：固定区组 6 只有 Remove Pin
        expect(grp("pinned", "changeIcon")).toBe(grp("pinned", "editPinned"));
        for (const kv of ['"pinned.editPinned": "Edit Pinned Page"', '"pinned.replace": "Replace Pinned URL with Current"']) expect(en).toContain(kv);
        expect(src("src/plugins/tabs/pinnedTabs/model.ts")).toMatch(/customIcon\?/);
    });
    test("D-02 / D-03：文件夹菜单与删除确认", () => {
        const f = src("src/plugins/tabs/folders/index.ts");
        expect(grp("folder", "toSpace")).toBe(grp("folder", "sub")); // urlbar-menus-followup.md §5.1
        expect(f).toMatch(/pasteMenu: \{ type: OptionType\.BOOLEAN, default: false/);
        expect(f).toMatch(/id: "paste"[^\n]*visible: \(\) => !!settings\.store\.pasteMenu/);
        for (const kv of ['"folders.copyAllMd": "Copy All Links as Markdown"', '"folders.deleteConfirm": "Delete your “{0}” folder?"', '"folders.newSub": "New Nested Folder…"', '"folders.toSpace": "Turn “{0}” into Space"', '"folders.duplicate": "Duplicate"']) expect(en).toContain(kv);
        expect(f).toMatch(/detail: tr\("folders\.deleteDetail"\)/);
        expect(src("src/components/Dialog.ts")).toMatch(/"data-test": "dlg-detail"/);
    });
    test("新建 Space 后移动：moveKeysToSpace 用调用前的 Space 做来源", () => {
        expect(src("src/plugins/tabs/pinnedTabs/index.ts")).toMatch(/export async function moveKeysToSpace\(keys: string\[\], spaceId: string, from = activeSpace\(\)\.id\)/);
    });
    test("U-01 / U-02：不安全页面左侧图标按钮，点开站点面板", () => {
        const nav = src("src/plugins/command/navigation/index.ts"), st = src("src/plugins/command/style.ts");
        expect(nav).toMatch(/"data-test": "urlbar-icon", "aria-label": tr\("nav\.insecure"\)/);
        expect(nav).toMatch(/has-icon/);
        expect(st).toMatch(/\.arc-urlbar\.has-icon/);
        expect(st).toContain(".arc-urlbar-icon.arc-insecure { color: rgb(245 55 20 / .75); }");
    });
    test("S-01：自动归档选项 Never / 30d / 7d / 24h / 12h（默认）/ 6h / 1h", () => {
        const a = src("src/plugins/tabs/autoArchive/index.ts");
        const vals = [...a.match(/options: \[([^\]]*)\]/)![1].matchAll(/value: (\d+)/g)].map(m => +m[1]);
        expect(vals).toEqual([0, 720, 168, 24, 12, 6, 1]);
        expect(a).toMatch(/value: 12, default: true/);
    });
    test("额外 #8 / #9：网页右键 Quote 菜单默认关", () => {
        const t = src("src/plugins/tabs/tabActions/index.ts");
        expect(t).toMatch(/quoteMenu: \{ type: OptionType\.BOOLEAN, default: false/);
        expect(t).toMatch(/menuItemId !== "arc-quote" \|\| !settings\.store\.quoteMenu/);
    });
    test("额外 #7：Arc 没有的默认快捷键已去掉（命令保留）", () => {
        const cases: [string, string][] = [["src/plugins/command/navigation/index.ts", "nav.history"], ["src/plugins/command/commandBar/index.ts", "cmdbar.pasteUrl"], ["src/plugins/spaces/spaceManager/index.ts", "space.menu"],
            ["src/plugins/_core/pluginSettings/index.ts", "settings.open"], ["src/plugins/tabs/archive/index.ts", "archive.reopen"], ["src/plugins/tabs/tabActions/index.ts", "tab.recent"], ["src/plugins/tabs/tabActions/index.ts", "tab.recentBack"]];
        for (const [f, id] of cases) {
            const s = src(f), i = s.indexOf(`id: "${id}"`);
            expect(i).toBeGreaterThan(-1);
            expect(s.slice(i, s.indexOf("run:", i))).not.toContain("defaultKey");
        }
        const split = src("src/plugins/views/splitView/index.ts");
        expect(split).not.toMatch(/split\.focus[^\n]*defaultKey/);
    });
    test("中英文键一致（新增键）", () => {
        for (const k of ["tab.changeIcon", "tab.renameTab", "tab.archiveThis", "tab.quoteMenu", "pinned.editPinned", "pinned.editPinnedUrl", "folders.toSpace", "folders.deleteDetail", "folders.pasteMenu", "autoArchive.1h", "autoArchive.6h"]) {
            expect(en).toContain(`"${k}":`); expect(zh).toContain(`"${k}":`);
        }
    });
});

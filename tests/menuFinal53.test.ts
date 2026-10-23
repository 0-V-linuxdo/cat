/* urlbar-menus-followup.md「菜单定案」+ audit-52193-answers.md「Toast 位置定案」（命令栏与会话恢复线程） */
import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import { recordUndo, setUndoSink, snapshotStores, type UndoInput } from "@api/Undo";

const rd = (f: string) => readFileSync(f, "utf8");
const menus = rd("src/api/ContextMenus.ts");
const layout = (kind: string) => menus.match(new RegExp(`\\b${kind}: \\{([^}]*)\\}`))![1];

test("§1 标签菜单没有 Add to Favorites：MENU_LAYOUT.tab 无 fav", () => {
    expect(layout("tab")).not.toMatch(/\bfav:/);
    expect(layout("tab")).not.toMatch(/\bpin:/);
});
test("§4 收藏菜单组 6 = Close Tab + Remove Favorite；固定区组 6 只有 Remove Pin", () => {
    expect(layout("favorite")).toContain("closeTab: [6, 60], remove: [6, 61]");
    const en = rd("src/i18n/en.ts");
    expect(en).toContain('"fav.closeTab": "Close Tab"'); expect(en).toContain('"fav.removeFrom": "Remove Favorite"');
    expect(en).toContain('"pinned.removePins": "Remove Pins"'); expect(en).toContain('"tab.archiveTabs": "Archive Tabs"');
    expect(en).toContain('"multi.newFolderWithN": "New Folder with {0} Items"');
    const pin = rd("src/plugins/tabs/pinnedTabs/index.ts");
    const items = pin.slice(pin.indexOf("        pinned: ["), pin.indexOf("    background:"));
    expect(items).not.toContain('id: "closeTab"');
    expect(items).toContain('{ id: "removePin", label: "pinned.removePin"');
});
test("§2 Move to：标签 / 固定项 / 文件夹菜单都有，无痕窗口隐藏", () => {
    expect(rd("src/plugins/tabs/tabActions/index.ts")).toContain('{ id: "moveTo", label: "tab.moveTo", order: 60, visible: t => t.tabId != null && !chrome.extension?.inIncognitoContext,');
    const pin = rd("src/plugins/tabs/pinnedTabs/index.ts");
    expect(pin).toContain("export const inIncognito = () => !!chrome.extension?.inIncognitoContext;");
    expect(pin).toContain('{ id: "moveTo", label: "tab.moveTo", visible: () => !inIncognito(), run: () => { }, submenu: t => pinMoveToMenu(t.itemId!) },');
    expect(rd("src/plugins/tabs/folders/index.ts")).toContain('{ id: "move", label: "tab.moveTo", visible: () => !inIncognito(), run: () => { }, submenu: t => pinMoveToMenu(t.itemId!) },');
    expect(layout("pinned")).toContain("moveTo: [3, 32]");
    expect(layout("folder")).toContain("move: [3, 31]");
});
test("§3 文件夹 Delete = 归档：子树进归档、标签关闭、撤销标题 Archive Tab", () => {
    const f = rd("src/plugins/tabs/folders/index.ts");
    const body = f.slice(f.indexOf("export async function archiveFolder"));
    const i = ["snapshotStores([pinnedStore, archiveStore])", 'call("archive:addFolder", archivedFolder(f), spaceId, open)', "await removeFolder(folderId, spaceId)", "await chrome.tabs.remove(open)", 'commit(tr("tab.archiveTab"))'].map(s => body.indexOf(s));
    for (const x of i) expect(x).toBeGreaterThan(-1);
    expect([...i].sort((a, b) => a - b)).toEqual(i);
    expect(f).toMatch(/async function deleteFolder[\s\S]{0,400}await archiveFolder\(folderId\);/);
    expect(f).not.toContain('commit(tr("folders.delete"))');
});
test("撤销栈：快照后、期间压入关标签记录，commit 后归档文件夹那条在栈顶", () => {
    const stack: UndoInput[] = [];
    setUndoSink(e => stack.push(e));
    try {
        let tree = { bySpace: { s: [{ id: "f", kind: "folder", children: [{ id: "a", tabId: 1 }] }] } };
        const store = { key: "data:pinned", get: () => tree };
        const commit = snapshotStores([store]);
        tree = { bySpace: { s: [] } }; // removeFolder
        recordUndo("tabsClosed", "Close tab", [{ oldId: 1 }]); // 关标签：background tabs.onRemoved
        commit("Archive Tab");
        expect(stack.at(-1)!.label).toBe("Archive Tab");
        expect(stack.at(-1)!.kind).toBe("stores");
        // 快照是删除前的树（撤销会写回文件夹）
        expect(JSON.stringify(stack.at(-1)!.data)).toContain('"id":"f"');
    } finally { setUndoSink(null); }
});
test("Toast 位置定案：location 3 floatingTopRight → 面板右上角；拖动只水平平移", () => {
    const css = rd("static/sidepanel.css");
    expect(css).toContain("position: fixed; right: 8px; top: 10px; z-index: 30;");
    expect(css).not.toMatch(/\.arc-toast[^}]*left: 50%/);
    for (const l of css.split("\n").filter(l => /@keyframes arc-toast-(in|out)/.test(l))) expect(l).not.toContain("-50%");
    const ps = rd("src/api/PanelShell.ts");
    expect(ps).toContain("t.style.transform = `translate(${dx}px, 0)`;");
    expect(ps).toContain("export const TOAST_MS = 5000;");
});

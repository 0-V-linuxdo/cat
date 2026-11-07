/* 审计 52193 第二轮：X-05 / X-01 / K-02 / 文件夹删除撤销（rel32 回归） */
import { expect, test } from "bun:test";
import { readFileSync } from "fs";
const rd = (f: string) => readFileSync(f, "utf8");

test("X-05：标签菜单无 Pin to this space；收藏菜单无 Reset，组 6 文案 Close Tab / Remove Favorite（「菜单定案」§4）", () => {
    expect(rd("src/plugins/tabs/pinnedTabs/index.ts")).not.toContain('label: "pinned.pinHere"');
    const fav = rd("src/plugins/spaces/favorites/index.ts");
    expect(fav).not.toContain('label: "fav.reset"');
    const en = rd("src/i18n/en.ts");
    expect(en).toContain('"fav.closeTab": "Close Tab"');
    expect(en).not.toContain('"Close Favorite"');
    expect(en).toContain('"fav.removeFrom": "Remove Favorite"');
    expect(rd("src/api/ContextMenus.ts")).toMatch(/favorite: \{[^}]*closeTab: \[6, 60\], remove: \[6, 61\] \}/);
});
test("X-01：Archive Tab（close）在组 6，其它归档在组 7；pin 只在组 6 close 之前（rel65 ②，用户 11/2 定）", () => {
    const cm = rd("src/api/ContextMenus.ts");
    expect(cm).toContain("close: [6, 60], others: [7, 70], below: [7, 71], above: [7, 72]");
    expect(cm).toMatch(/tab: \{[^}]*\bpin: \[6, 59\], close: \[6, 60\]/);
});
test("K-02：space.go1–9 无默认键，命令保留", () => {
    const s = rd("src/plugins/spaces/spaceManager/index.ts");
    expect(s).toContain("id: `space.go${i + 1}`");
    expect(s).not.toContain("defaultKey: `Alt+${i + 1}`");
});
test("删除文件夹：快照在前，关标签之后才记撤销，撤销项（Archive Tab）在栈顶", () => {
    const f = rd("src/plugins/tabs/folders/index.ts");
    const a = f.indexOf("const commit = snapshotStores([pinnedStore, archiveStore]);");
    const b = f.indexOf("await chrome.tabs.remove(open)", a);
    const c = f.indexOf('commit(tr("tab.archiveTab"));', b);
    expect(a).toBeGreaterThan(-1); expect(b).toBeGreaterThan(a); expect(c).toBeGreaterThan(b);
    expect(f).not.toContain("recordStoreUndo(");
});

import { expect, test } from "bun:test";
import { readFileSync } from "fs";
const r = (f: string) => readFileSync(f, "utf8");
test("Move to 子菜单 = 各 Space → 分隔线 → New Space…，无文件夹（tab-tooltip-internal-moveto.md §2）", () => {
    // 固定项 / 文件夹共用 pinMoveToMenu（pinnedTabs）
    for (const f of ["src/plugins/tabs/tabActions/index.ts", "src/plugins/tabs/pinnedTabs/index.ts"]) {
        const s = r(f);
        expect(s).toContain('{ id: "sep", label: "", separator: true');
        expect(s).toContain('label: "spaces.moveToNew"');
        expect(s).not.toContain("id: `folder:");
        expect(s.indexOf("tab.moveToSpace")).toBeLessThan(s.indexOf('id: "sep"'));
        expect(s.indexOf('id: "sep"')).toBeLessThan(s.indexOf("spaces.moveToNew"));
    }
    const ta = r("src/plugins/tabs/tabActions/index.ts");
    for (const k of ["toFav", "toPinned", "toToday"]) expect(ta).not.toContain(`id: "${k}"`);
    const fo = r("src/plugins/tabs/folders/index.ts");
    expect(fo.indexOf('id: "dup"')).toBeLessThan(fo.indexOf('id: "move"'));
    expect(fo).toContain("submenu: t => pinMoveToMenu(t.itemId!)");
    expect(r("src/api/PanelShell.ts")).toContain('if (d.separator) return { separator: true, label: "" };');
});
test("siteControls 搜索框空时隐藏 ×", () => {
    expect(r("src/plugins/command/style.ts")).toContain(".arc-sc-search:placeholder-shown::-webkit-search-cancel-button { display: none; }");
});
test("openCentered 错误被记录，不再被 void 吞掉", () => {
    const s = r("src/plugins/command/commandBar/index.ts");
    expect(s).not.toMatch(/void openCentered\(/);
    expect(s.match(/safe\(openCentered\(/g)?.length).toBe(2);
});

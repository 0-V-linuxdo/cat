import { expect, test } from "bun:test";
import { readFileSync } from "fs";

/* urlbar-menus-followup.md §1 / §2.1：不安全页面左侧 = lock.slash.fill（SF_GLYPHS.lockSlashFill，14×14 导出），安全页不渲染；lock.fill 不出现（无 privateCreativeTool） */
test("地址栏左侧图标用 lockSlashFill，仅不安全页渲染", () => {
    const nav = readFileSync(new URL("../src/plugins/command/navigation/index.ts", import.meta.url), "utf8");
    expect(nav).toContain('secure ? null : h("button", { class: "arc-urlbar-icon arc-insecure", "data-test": "urlbar-icon", "aria-label": tr("nav.insecure"), onclick: openSite }, icon("lockSlashFill", 14))');
    expect(nav).not.toContain('icon("alert", 14)');
    expect(nav).not.toMatch(/icon\("lock", /);
    expect(nav).not.toContain("暂用现有 alert 字形");
});

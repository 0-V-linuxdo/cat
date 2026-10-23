import { test, expect } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";
test("52159：侧栏没焦点时打开菜单要把焦点拉进侧栏（内部页无内容脚本，Esc / 点网页才能关闭）", () => {
    const m = readFileSync(resolve(import.meta.dir, "../src/components/Menu.ts"), "utf8");
    const open = m.slice(m.indexOf("export function openMenu"), m.indexOf("export function openSubMenu"));
    expect(open).toContain("!document.hasFocus()");
    expect(open).toContain("window.focus()");
    expect(m).toContain('window.addEventListener("blur", () => closeMenus())');
});

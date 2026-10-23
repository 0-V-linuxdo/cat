import { expect, test } from "bun:test";
import { readFileSync } from "fs";
const r = (f: string) => readFileSync(f, "utf8");
test("52148：网页焦点下 Esc 由内容脚本转发，侧边栏关闭整层菜单（含子菜单 / ＋菜单）", () => {
    const c = r("src/entries/content.ts");
    expect(c).toContain('k.key !== "Escape"');
    expect(c).toContain('type: "arc-outside-esc"');
    const p = r("src/api/PanelShell.ts");
    expect(p).toMatch(/arc-outside-esc[\s\S]{0,120}closeMenus\(\); document\.dispatchEvent\(new Event\("arc-dismiss"\)\)/);
    expect(p).toContain('dismiss("page-click")');
    expect(p).toContain('dismiss("blur")');
    expect(p).toContain('dismiss("hidden")');
});
test("Menu：Esc / 外部点击 / 失焦关闭整个菜单栈，并清掉残留子菜单", () => {
    const m = r("src/components/Menu.ts");
    expect(m).toMatch(/e\.key === "Escape" && open\.length\) \{ e\.stopPropagation\(\); closeMenus\(\); \}/);
    expect(m).toContain('window.addEventListener("blur", () => closeMenus())');
    expect(m).toContain("swallowOutside(() => open.length > 0");
    expect(m).toContain('if (depth === 0) document.querySelectorAll("body > .arc-menu").forEach(m => m.remove());');
    expect(m).toContain('if (it.separator) { menu.append(h("div", { class: "arc-menu-sep"'); // 分隔线不是可点项 / 子菜单
});
test("＋菜单响应 arc-dismiss / 外部点击 / 失焦", () => {
    const s = r("src/plugins/command/plusMenu/index.ts");
    for (const k of ['addEventListener("arc-dismiss", close)', 'addEventListener("blur", close)', "arc-outside-click"]) expect(s).toContain(k);
});

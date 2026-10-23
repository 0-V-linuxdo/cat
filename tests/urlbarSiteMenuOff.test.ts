import { expect, test } from "bun:test";
import { readFileSync } from "fs";
/*
 * 审计 52193 多出项 #5：Arc 的地址胶囊没有右键菜单（Rea sidebar-features.md:128 只有点按站点控制中心）。
 * 插件里的站点菜单保留为可选项 Navigation.siteMenu，默认关闭；关闭时右键不弹任何菜单
 * （preventDefault 挡住 PanelShell 空白处 sidebar 菜单和浏览器原生菜单）。
 */
const nav = readFileSync("src/plugins/command/navigation/index.ts", "utf8");
const en = readFileSync("src/i18n/en.ts", "utf8");
const zh = readFileSync("src/i18n/zh.ts", "utf8");

test("siteMenu 选项存在且默认关", () => {
    expect(nav).toMatch(/siteMenu: \{ type: OptionType\.BOOLEAN, default: false, description: "nav\.siteMenu" \}/);
    expect(nav).toMatch(/enabledByDefault: true,\s*\n\s*settings,/);
});

test("右键只在 siteMenu 打开时调用 siteControls；关闭时仍 preventDefault，不冒泡到空白处菜单", () => {
    const line = nav.split("\n").find(l => l.includes("oncontextmenu:"))!;
    expect(line).toBeDefined();
    expect(line).toContain("e.preventDefault(); e.stopPropagation();");
    expect(line).toContain("if (t && settings.store.siteMenu) siteControls(e, t);");
    expect(line.indexOf("preventDefault")).toBeLessThan(line.indexOf("settings.store.siteMenu"));
});

test("按钮打开站点控制不受 siteMenu 影响（openSite 回退路径保留）", () => {
    expect(nav).toContain("if (siteControlsHook.open) void siteControlsHook.open({ x: r.right - 300, y: r.bottom + 8 }, t);");
    expect(nav).toContain("else siteControls(e as MouseEvent, t);");
    expect(nav).toContain('"data-test": "site-controls-btn", onclick: openSite');
});

test("选项文案中英都有，并注明 Arc 没有", () => {
    expect(en).toMatch(/"nav\.siteMenu": "[^"]*\(not in Arc\)"/);
    expect(zh).toMatch(/"nav\.siteMenu": "[^"]*（Arc 没有）"/);
});

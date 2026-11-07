import { expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
/*
 * 52179 实机异常：悬停 GitHub 固定行时站点控制 popover“自己”弹出。
 * Rea（arc-analysis/sidebar-features.md:128）：Arc 只有 onTapSiteControlCenterButton（点按）打开站点控制中心。
 * 本测试锁定：打开只走 click / 右键 / 命令；任何悬停 / 焦点 / 重绘路径都不打开。关闭：外部点击 + Esc（指针移开关闭 ⛔，Rea 无依据）。
 */
const r = (f: string) => readFileSync(f, "utf8");
const walk = (d: string): string[] => readdirSync(d).flatMap(n => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(n) ? [p] : []; });
const SRC = walk("src").filter(f => !f.includes("selftest"));
const OPENERS = /siteControlsHook\.open\s*\(|openSiteControls\s*\(|\bsiteControls\s*\(\s*e\b/;

test("打开站点控制的调用点只有：地址栏按钮 click、地址栏右键、site.controls 命令", () => {
    const hits = SRC.flatMap(f => r(f).split("\n").map((l, i) => ({ f, i: i + 1, l })).filter(x => OPENERS.test(x.l) && !/^\s*(async\s+)?function\s/.test(x.l) && !/^\s*(\/\/|\*)/.test(x.l)));
    const where = hits.map(x => x.f.replace(/\\/g, "/"));
    expect(new Set(where)).toEqual(new Set(["src/plugins/command/navigation/index.ts", "src/plugins/views/siteControls/index.ts"]));
    const nav = r("src/plugins/command/navigation/index.ts");
    // openSite 只挂在按钮的 onclick 上（左侧图标 U-02 + 右侧站点控制按钮）；地址栏本体 click = 编辑地址，右键 = 站点菜单
    expect(nav).toMatch(/"data-test": "site-controls-btn", onclick: openSite/);
    expect(nav).toMatch(/"data-test": "urlbar-icon", "aria-label": tr\("nav\.insecure"\), onclick: openSite/);
    expect(nav.match(/\bopenSite\b/g)!.length).toBe(3); // 定义 + 两个 onclick
    expect(nav).toMatch(/onclick: \(\) => void runCommand\("commandBar\.editUrl"\)/);
    // 右键站点菜单 Arc 没有（审计 52193 多出项 #5）：只在 siteMenu 打开时弹出，见 urlbarSiteMenuOff.test.ts
    expect(nav).toMatch(/oncontextmenu: \(e: MouseEvent\) => \{ e\.preventDefault\(\); e\.stopPropagation\(\); if \(t && settings\.store\.siteMenu\) siteControls\(e, t\); \}/);
    const sc = r("src/plugins/views/siteControls/index.ts");
    expect(sc.match(/openSiteControls\s*\(/g)!.length).toBe(2); // 定义 + 命令 run
    expect(sc).toContain("siteControlsHook.open = openSiteControls;");
});

test("悬停 / 焦点类事件处理里不打开任何面板", () => {
    const HOVER = /on(mouseenter|mouseover|mousemove|pointerenter|pointerover|pointermove|focus|focusin)\s*:|addEventListener\(\s*"(mouseenter|mouseover|mousemove|pointerenter|pointerover|pointermove|focus|focusin)"/;
    for (const f of ["src/plugins/command/navigation/index.ts", "src/plugins/views/siteControls/index.ts", "src/plugins/views/siteControls/extPopup.ts"]) expect(HOVER.test(r(f))).toBe(false);
    for (const f of SRC) for (const l of r(f).split("\n")) if (HOVER.test(l)) expect(OPENERS.test(l) || /openPanel\s*\(/.test(l)).toBe(false);
});

test("keepHover 重绘只同步属性 / 换监听，不派发 click、不调用处理函数", () => {
    const k = r("src/api/keepHover.ts");
    // 唯一的 dispatchEvent 是自定义 REHOVER（pinned-icon-hover：让悬停行重判图标区，不是 click / 不调处理函数）
    expect(k.match(/dispatchEvent/g)?.length).toBe(1);
    expect(k).toContain("old.dispatchEvent(new Event(REHOVER))");
    expect(k.replace("old.dispatchEvent(new Event(REHOVER))", "")).not.toMatch(/\.click\(\)|dispatchEvent|\.fn\.call|handleEvent\(/);
    // 换监听只做 remove + add
    expect(k).toMatch(/old\.removeEventListener\(r\.type, r\.fn, r\.opts\)/);
    expect(k).toMatch(/old\.addEventListener\(r\.type, r\.fn, r\.opts\)/);
});

test("关闭：外部点击 + Esc；不加指针移开关闭（⛔：Rea 未给出站点控制中心的移开关闭）", () => {
    const m = r("src/components/Menu.ts");
    expect(m).toMatch(/e\.key === "Escape" && open\.length\) \{ e\.stopPropagation\(\); closeMenus\(\); \}/);
    expect(m).toContain("swallowOutside(() => open.length > 0");
    expect(m).toContain('document.addEventListener("click", () => closeMenus())');
    const sc = r("src/plugins/views/siteControls/index.ts");
    expect(sc).not.toMatch(/pointerleave|mouseleave|pointerout|mouseout/);
    expect(sc).toContain('"arc-site-controls");'); // 经 openPanel 进入共享菜单栈 → 共享上面的关闭规则
});

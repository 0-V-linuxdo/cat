/* 审计 52193「底栏图标与边距」回归：读源码断言 Rea 取值（每条值的出处见对应源文件注释）。 */
import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";

const r = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const app = r("static/sidepanel.css");
const cmd = r("src/plugins/command/style.ts");
const tabs = r("src/plugins/tabs/style.ts");
const icons = r("src/api/icons.ts");
const ion = r("src/api/ionGlyphs.ts");
const sel = (css: string, re: RegExp) => [...css.matchAll(re)].map(m => m[0]).join("\n");

test("P-01 更正（pinned-hover.md）：hover 整行标题右移 7 作废；7 只在左图标 hover 副标题出现时（data-hz，translateY）", () => {
    expect(tabs).not.toContain("translateX(7px)");
    expect(tabs).toContain(':root .arc-tab[data-hz="icon"] > .arc-tab-title { transform: translateY(-7px); }');
    expect(tabs).toContain(".arc-tab > .arc-tab-title { transition: transform .1s ease-in-out; }");
});

test("P-03：多选底 = T-C8 α.10，无强调色 / 描边", () => {
    expect(tabs).toContain(":root .arc-tab.selected:not(.active) { background: rgb(0 0 0/.10); box-shadow: none; }");
    expect(tabs).toContain(":root[data-theme=\"dark\"] .arc-tab.selected:not(.active) { background: rgb(250 251 255/.10); }");
    const rules = sel(tabs + app, /[^\n]*\.arc-tab\.selected[^\n]*/g);
    expect(rules).not.toContain("arc-accent");
    expect(rules).not.toContain("inset 0 0 0 1px");
});

test("N-01：Tidy 只在按下时旋转 −25°，锚点 (0.6, 1.0)", () => {
    expect(tabs).toContain(".arc-today-hbtn:has(> .arc-svg-broom).pressed > .arc-svg-broom { transform: rotate(-25deg); }");
    expect(tabs).not.toMatch(/broom\):is\(:hover/);
    expect(tabs).toContain("transform-origin: 60% 100%");
});

test("D-01：文件夹图标 = FolderIconView 代码绘制复刻（两层 SVG 图层 + 渐变阴影），不是 SF 字形 / 手绘双层 / 空间色", async () => {
    expect(icons).not.toContain("\"fg-back\"");
    expect(icons).not.toMatch(/export function folderGlyph[\s\S]*?SF_GLYPHS\.folder/);
    expect(tabs).not.toMatch(/--fg-hue/);
    // 最小 DOM 替身：folderGlyph 只用 createElement / setAttribute / classList / dataset / innerHTML
    const fake = () => { const attrs: Record<string, string> = {}, cls = new Set<string>(); return { dataset: {} as Record<string, string>, innerHTML: "", setAttribute: (k: string, v: string) => { attrs[k] = v; }, getAttribute: (k: string) => attrs[k] ?? null, classList: { add: (...c: string[]) => c.forEach(x => cls.add(x)), contains: (c: string) => cls.has(c) } }; };
    const g0 = globalThis as unknown as { document?: unknown }; const prev = g0.document;
    g0.document = { createElement: fake };
    const { folderGlyph } = await import("../src/api/icons");
    const g = folderGlyph(true, 17, 2) as unknown as ReturnType<typeof fake>;
    g0.document = prev;
    expect(g.classList.contains("arc-folder-glyph")).toBe(true);
    expect(g.getAttribute("style")).toContain("width:17px;height:17px");
    expect(g.innerHTML).toContain('class="arc-fg-back"'); expect(g.innerHTML).toContain('class="arc-fg-front"');
    expect(g.innerHTML).not.toMatch(/ fill="(?!url)/); // 颜色全由 CSS 变量决定（渐变 stop 用 stop-color，不算）
    expect(g.dataset.open).toBe("true");
});

test("I-01：手写 PATHS 只剩 sparkles（⛔）；scanText = SF text.viewfinder（⛔ suggestion）；views 指向 Arc 原生 splitCols；别名只剩 command / views", () => {
    const paths = icons.slice(icons.indexOf("const PATHS = {"), icons.indexOf("} as const;", icons.indexOf("const PATHS = {")));
    const drawn = [...paths.matchAll(/^\s+(\w+): "([^"]+)"/gm)].map(m => m[1]);
    expect(drawn).toEqual(["sparkles"]);
    expect(paths).not.toContain("cards:");
    expect(ion).toMatch(/\/\/ ⛔ 源码未找到（suggestion）[^\n]*text\.viewfinder[^\n]*\n\s+scanText: \{ src: "arc-icons\/sf\/suggested\/text\.viewfinder_17pt_regular\.svg"/);
    expect(r("src/api/arcIcons.ts")).toContain('"splitCols": "vector/ARC_SidebarPlusButton.bundle/split-add-right.svg"');
    expect(icons).toContain("⛔ Rea 没有给出这些名字对应哪个 Arc 图标");
    expect(icons).toContain('const ICON_ALIAS: Partial<Record<string, IconName>> = { command: "search", views: "splitCols" };');
});

test("X-02：右键菜单高亮不用主题强调色，改系统色", () => {
    const menu = app.slice(app.indexOf("/* 右键菜单 = 原生 NSMenu"), app.indexOf("/* —— Toast"));
    expect(menu).not.toMatch(/arc-accent|#e5484d|color: #fff/);
    expect(menu).toContain("background: Highlight; color: HighlightText;");
    expect(menu).toContain("background: AccentColor; color: AccentColorText;");
});

test("B-01：Space 切换器左右 inset 2（后面的覆盖不再清零）", () => {
    const last = [...app.matchAll(/:root \.arc-space-bar \{[^}]*\}/g)].map(m => m[0]).at(-1)!;
    expect(last).toContain("padding: 0 2px");
});

test("B-04：＋菜单无阴影（T-K3 hasShadow=false）", () => {
    expect(cmd).not.toContain("box-shadow: var(--arc-pop-shadow)");
    expect(cmd).toMatch(/:root \.arc-menu\.arc-plus-menu \{[^}]*box-shadow: none;/);
});

test("U-03 / U-04 / U-05：地址框左距 13（有图标 34）、文字 #000 α.6 / 占位 α.3、按钮 28", () => {
    expect(cmd).toContain("padding: 0 12px 0 13px;");
    expect(cmd).toContain(".arc-urlbar.has-icon { padding-left: 34px; }"); expect(cmd).not.toContain("arc-urlbar-lead");
    expect(cmd).toContain(".arc-urlbar { --urlbar-fg: rgb(0 0 0/.6); --urlbar-placeholder: rgb(0 0 0/.3); }");
    expect(cmd).toContain("color: var(--urlbar-fg);");
    expect(cmd).toMatch(/\.arc-urlbar-btn \{[^}]*width: 28px; height: 28px;/);
});

test("多出项 #4 / #6：角标与进度条默认关闭，只在根属性开启时显示", () => {
    for (const m of app.matchAll(/^[^\n/]*\.arc-lib-btn\.badged::after[^{]*\{/gm)) expect(m[0]).toContain(":root[data-lib-badge]");
    expect(app).toContain(":root[data-lib-badge] .arc-lib-btn.badged::after");
    // Arc 原生：有徽标放大 1.2×、0.15s（sidebar-features.md:359），常开，不受 libBadge 控制
    expect(app).toContain(":root .arc-slot-bottom .arc-lib-btn.badged { transform: scale(1.2); transition: transform .15s; }");
    expect(app).not.toContain(":root[data-lib-badge] .arc-slot-bottom .arc-lib-btn.badged {");
    expect(cmd).toContain(".arc-urlbar-progress { position: absolute; left: 0; bottom: 0; height: 2px; width: 0; background: var(--arc-accent); opacity: 0; }");
    for (const m of cmd.matchAll(/^[^\n]*\.arc-urlbar-progress \{ opacity: 1;/gm)) expect(m[0]).toContain(":root[data-urlbar-progress]");
});

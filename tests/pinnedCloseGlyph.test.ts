/* 固定 / Today 行右按钮字形（pinned-hover.md §2.4 SidebarCellButtonCloseContentView）：内容 14×14，点击区 24，两条 14×2 圆角 1 的横条；
 * ✕ = ±π/4 旋转，− = 单条；只改 TabRow 的右按钮，其它行仍用 SmallCloseButton（ARC_ICONS.x）。 */
import { expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { ARC_ICONS } from "../src/api/arcIcons";

const row = readFileSync("src/components/TabRow.ts", "utf8");
const css = readFileSync("static/sidepanel.css", "utf8");
const rule = (sel: string) => { const m = css.match(new RegExp(`^${sel.replace(/[.*+?^${}()|[\]\\>]/g, "\\$&")} \\{([^}]*)\\}`, "m")); if (!m) throw new Error("no rule " + sel); return m[1]; };
const px = (decls: string, prop: string) => Number(new RegExp(`(?:^|[\\s;])${prop}:\\s*(-?[\\d.]+)(?:px)?(?:;|\\s|$)`).exec(decls)?.[1] ?? NaN);
const walk = (d: string): string[] => readdirSync(d).flatMap(n => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") ? [p] : []; });

test("字形结构：✕ = 两条 .arc-cb（±45°），− = 一条 .arc-cb；不再用 svgIcon('x') / SmallCloseButton", () => {
    expect(row).toContain('h("span", { class: `arc-cg arc-cg-${action === "close" ? "minus" : "x"}`, "aria-hidden": "true" }, ...(action === "close" ? [bar()] : [bar(), bar()]))');
    expect(row).toContain('const bar = () => h("i", { class: "arc-cb" });');
    expect(row).not.toMatch(/svgIcon\("x"/);
    expect(row).not.toContain("arc-svg-x");
});

test("字形几何（CSS）：内容 14×14；横条 14×2、圆角 1、垂直居中；✕ 两条 ∓45°；点击区 24", () => {
    const cg = rule(".arc-tab-close .arc-cg"), cb = rule(".arc-tab-close .arc-cb");
    expect(px(cg, "width")).toBe(14); expect(px(cg, "height")).toBe(14);
    expect(px(cb, "width")).toBe(14); expect(px(cb, "height")).toBe(2); expect(px(cb, "border-radius")).toBe(1);
    expect(px(cb, "left")).toBe(0); expect(px(cb, "top") + px(cb, "height") / 2).toBe(px(cg, "height") / 2); // 条中心 = 内容中心（7）
    expect(rule(".arc-tab-close .arc-cg-x > .arc-cb:nth-child(1)")).toContain("rotate(45deg)");
    expect(rule(".arc-tab-close .arc-cg-x > .arc-cb:nth-child(2)")).toContain("rotate(-45deg)");
    expect(css).not.toMatch(/\.arc-cg-minus[^{]*\{[^}]*transform/); // − 恒等
    expect(css).toContain("--arc-close-size: 24px"); expect(css).toContain(":root .arc-tab-close { width: var(--arc-close-size); height: var(--arc-close-size)");
    // ✕ 外接框 = (14 cos45° + 2 sin45°) ≈ 11.31，− = 14×2：两种字形都在 14×14 内容框内、居中
    expect(+((14 + 2) / Math.SQRT2).toFixed(2)).toBe(11.31);
});

test("颜色沿用现状（currentColor，不新增颜色 / 透明度）", () => {
    expect(rule(".arc-tab-close .arc-cb")).toContain("background: currentColor");
    expect(css).toContain("color: var(--arc-muted); cursor: pointer; opacity: 0;"); // .arc-tab-close 原样
    expect(css).toContain(".arc-tab-close:hover { background: var(--arc-press); color: var(--arc-fg); }");
});

test("动作 / tooltip 沿用 pinned-hover：close → − + tab.closeThisItem；archive → ✕ + tab.archiveThisItem；edge 7、delay 0.45", () => {
    expect(row).toContain('arc-tab-close arc-tab-close-${action}');
    expect(row).toContain('tr("tab.closeThisItem") : tr("tab.archiveThisItem")');
    expect(row).toContain('"data-tip-edge": "7", "data-tip-delay": "0.45", "data-tip-block": ""');
});

test("其它行仍用 SmallCloseButton：ARC_ICONS.x 资产未动；其它调用点仍是 icon('x')；.arc-cg / .arc-cb 只出现在 TabRow 和 sidepanel.css 的 .arc-tab-close 下", () => {
    expect(ARC_ICONS.x.vb).toBe("0 0 11 11");
    expect(new Bun.CryptoHasher("sha1").update(JSON.stringify(ARC_ICONS.x)).digest("hex")).toBe("0d1778d2ac6321b16579f8507482bfce88183fcd");
    expect(readFileSync("src/api/arcIcons.ts", "utf8")).toContain('"x": "vector/ARCClients_BaseAssets.bundle/SmallCloseButton.svg"');
    for (const f of ["src/api/PanelShell.ts", "src/entries/options.ts", "src/plugins/command/commandBar/index.ts", "src/plugins/library/libraryView/index.ts", "src/plugins/views/splitView/index.ts", "src/plugins/views/peek/index.ts"])
        expect(readFileSync(f, "utf8")).toMatch(/icon\("x"/);
    const users = walk("src").filter(f => !f.includes("selftest") && /arc-cg|arc-cb/.test(readFileSync(f, "utf8")));
    expect(users.map(f => f.replace(/\\/g, "/"))).toEqual(["src/components/TabRow.ts"]);
    for (const line of css.split("\n").filter(l => /arc-cg|\.arc-cb/.test(l) && !l.startsWith("/*") && !l.startsWith(" *")))
        expect(line.startsWith(".arc-tab-close ")).toBe(true);
    expect(css).toContain(".arc-icon-btn > .arc-svg, .arc-caret > .arc-svg, .arc-tab-close > .arc-svg { margin: auto; }"); // 其它行的 svg 规则未动
    // TabRow 只有固定 / Today 两个调用方传 onClose
    const callers = walk("src").filter(f => !f.includes("selftest") && /onClose:\s*\(/.test(readFileSync(f, "utf8"))).map(f => f.replace(/\\/g, "/")).sort();
    expect(callers).toEqual(["src/plugins/tabs/pinnedTabs/index.ts", "src/plugins/tabs/todayTabs/index.ts"]);
});

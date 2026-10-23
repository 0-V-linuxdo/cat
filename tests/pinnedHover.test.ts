/* 固定标签 hover（pinned-hover.md）：左图标 hover 副标题、右按钮 −/✕、行 tooltip 位置与抑制、SVG 宿主、swap 带 tip、P-01 更正 */
import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import { applyTip, arcTooltip, copyTip, placeAtCursor, scanTips, cursorCorners, TOOLTIP_CURSOR_OFFSET } from "../src/components/ArcTooltip";

const row = readFileSync("src/components/TabRow.ts", "utf8");
const css = readFileSync("static/sidepanel.css", "utf8");
const tabsCss = readFileSync("src/plugins/tabs/style.ts", "utf8");
const en = readFileSync("src/i18n/en.ts", "utf8"), zh = readFileSync("src/i18n/zh.ts", "utf8");
const pinned = readFileSync("src/plugins/tabs/pinnedTabs/index.ts", "utf8");
const emptyFav = readFileSync("src/components/EmptyFavicon.ts", "utf8");

/* ── 左图标 ── */
test("左图标：没有 tooltip（不再有 pinned.reset 的 data-tip），没有原生 title；副标题只在 drifted && onIconClick 的行上创建", () => {
    expect(row).not.toContain('tr("pinned.reset")');
    expect(row).not.toMatch(/"title"\s*:|\btitle=|setAttribute\("title"/);
    expect(row).toContain("if (p.drifted && p.onIconClick) {"); // 只有偏离固定网址的行才建副标题（普通行没有 .arc-tab-sub）
    expect(row.split('class: "arc-tab-sub"').length - 1).toBe(1);
    expect(row).toContain('tr("pinned.backToUrl")');
    expect(en).toContain('"pinned.backToUrl": "Back to Pinned URL"');
    expect(zh).toMatch(/"pinned\.backToUrl": "[^"]+"/);
});
test("左图标副标题：只在图标区（行左缘 → 斜杠左缘）；不是整行；hover 整行不触发", () => {
    expect(row).toContain("e.clientX < r.left"); // r = 斜杠的 rect
    expect(row).toContain('row.setAttribute("data-hz", "icon")');
    expect(css + tabsCss).not.toMatch(/\.arc-tab:hover[^{]*\.arc-tab-sub/); // 副标题不挂在整行 :hover 上
});
test("左图标 hover 样式：标题平移 7（只在 data-hz）、副标题 0.1s easeInEaseOut 淡入、右按钮隐藏、单行尾截断；P-01 的 translateX(7px) 已删", () => {
    expect(tabsCss).not.toContain("translateX(7px)");
    expect(tabsCss).toContain(':root .arc-tab[data-hz="icon"] > .arc-tab-title { transform: translateY(-7px); }');
    expect(tabsCss).toContain(".arc-tab > .arc-tab-title { transition: transform .1s ease-in-out; }");
    expect(tabsCss).toMatch(/\.arc-tab-sub \{[^}]*opacity: 0; transition: opacity \.1s ease-in-out;/);
    expect(tabsCss).toMatch(/\.arc-tab-sub \{[^}]*white-space: nowrap; overflow: hidden; text-overflow: ellipsis;/);
    expect(tabsCss).toContain(':root .arc-tab[data-hz="icon"] > .arc-tab-sub { opacity: 1; }');
    expect(tabsCss).toContain(':root .arc-tab[data-hz="icon"] .arc-tab-close { opacity: 0; pointer-events: none; }');
});
test("斜杠版面：图标 → 斜杠 0、斜杠 → 标题 4；hover 只改 alpha", () => {
    expect(css).toContain("margin: 0 calc(4px - var(--arc-gap, 6px)) 0 calc(-1 * var(--arc-gap, 6px))");
    expect(css).toContain(".arc-tab:hover .arc-drift { opacity: 0; }");
    expect(row).toContain("p.drifted ? driftSlash() : null"); // 不偏离 → 没有占位
});

/* ── 右按钮 ── */
test("右按钮：− / ✕ 按动作；文案用 Rea 的；tooltip 锚点 7、延迟 0.45", () => {
    expect(row).toContain('closeAction?: "close" | "archive"');
    expect(row).toContain('...(action === "close" ? [bar()] : [bar(), bar()])'); // 字形见 pinnedCloseGlyph.test.ts
    expect(row).toContain('tr("tab.closeThisItem") : tr("tab.archiveThisItem")');
    expect(row).toContain('"data-tip-edge": "7", "data-tip-delay": "0.45", "data-tip-block": ""');
    expect(en).toContain('"tab.closeThisItem": "Close this item"'); expect(en).toContain('"tab.archiveThisItem": "Archive this item"');
    expect(css).toMatch(/\.arc-tab-close \.arc-cb \{[^}]*width: 14px; height: 2px;[^}]*border-radius: 1px;/);
    expect(css).toMatch(/\.arc-tab-close \{\s*position: relative;/);
    expect(css).toContain(":root .arc-tab-close { width: var(--arc-close-size)"); expect(css).toContain("--arc-close-size: 24px");
    expect(pinned).toContain('closeAction: tab ? "close" : "archive"');
    expect(pinned).not.toContain('tr("pinned.closeKeep")');
});

/* ── 行 tooltip 位置：光标上方 12，上方放不下才翻下方；永不越出视口 ── */
const vp = { width: 400, height: 600 };
test("placeAtCursor：默认在光标上方（底边 = y − 12），x = 鼠标 x", () => {
    expect(TOOLTIP_CURSOR_OFFSET).toBe(12);
    expect(placeAtCursor(100, 300, 80, 28, vp)).toEqual({ left: 100, top: 300 - 12 - 28, flipX: false, flipY: true });
});
test("placeAtCursor：上方没有位置 → 翻到光标下方（y + 12）；左右翻转 / 夹紧；永不越出可用区", () => {
    expect(placeAtCursor(100, 30, 80, 28, vp)).toEqual({ left: 100, top: 42, flipX: false, flipY: false });
    expect(placeAtCursor(380, 300, 80, 28, vp)).toEqual({ left: 300, top: 260, flipX: true, flipY: true });
    for (const [mx, my, w, h] of [[2, 2, 40, 28], [398, 598, 500, 28], [200, 10, 120, 590], [200, 300, 900, 900]] as const) {
        const p = placeAtCursor(mx, my, w, h, vp);
        expect(p.left).toBeGreaterThanOrEqual(8); expect(p.left + Math.min(w, 384)).toBeLessThanOrEqual(392);
        expect(p.top).toBeGreaterThanOrEqual(8); expect(p.top + Math.min(h, 584)).toBeLessThanOrEqual(592);
    }
});
test("cursor 圆角：靠光标的角 3（光标上方时 = 左下）", () => {
    expect(cursorCorners(false, true)).toEqual([14, 14, 14, 3]);
});
test("行 tooltip 声明：anchor cursor、1.5s、maxWidth 500；副标题 = 无自定义名才 Double-click to rename", () => {
    expect(row).toContain('"data-tip-anchor": "cursor", "data-tip-delay": "1.5", "data-tip-max-width": "500"');
    expect(row).toContain('"data-tip-subtitle": p.onRename && !p.renamed ? tr("tab.renameHint") : null');
});

/* ── 嵌套抑制：行 tooltip 与按钮 / 左图标 tooltip 不同时出现 ── */
type Ev = { clientX: number; clientY: number; target: { closest(sel: string): unknown } };
class H {
    tagName = "DIV"; attrs = new Map<string, string>(); ls = new Map<string, ((e: Ev) => void)[]>(); kids = new Set<unknown>();
    getAttribute(k: string) { return this.attrs.get(k) ?? null; } hasAttribute(k: string) { return this.attrs.has(k); }
    setAttribute(k: string, v: string) { this.attrs.set(k, v); } removeAttribute(k: string) { this.attrs.delete(k); }
    addEventListener(t: string, f: (e: Ev) => void) { this.ls.set(t, [...(this.ls.get(t) ?? []), f]); }
    contains(x: unknown) { return this.kids.has(x); }
    fire(t: string, target: Ev["target"]) { for (const f of this.ls.get(t) ?? []) f({ clientX: 10, clientY: 10, target }); }
}
test("嵌套抑制：指针在 data-tip-block 后代 / data-tip-blocked 宿主上 → 行计时取消；离开后重新计时", () => {
    const sets: number[] = [], clears: unknown[] = [];
    const st = globalThis.setTimeout, ct = globalThis.clearTimeout;
    (globalThis as { setTimeout: unknown }).setTimeout = ((_f: unknown, ms: number) => { sets.push(ms); return sets.length; }) as unknown;
    (globalThis as { clearTimeout: unknown }).clearTimeout = ((id: unknown) => { if (id !== undefined) clears.push(id); }) as unknown;
    try {
        const host = new H(); const btn = {}; host.kids.add(btn);
        arcTooltip(host as unknown as HTMLElement, "Row title", { anchor: "cursor", delay: 1.5 });
        const onBody = { closest: () => null }, onBtn = { closest: () => btn };
        host.fire("mouseenter", onBody); expect(sets).toEqual([1500]); // 行本体：照常 1.5s
        host.fire("mousemove", onBtn); expect(clears.length).toBeGreaterThan(0); // 移到按钮上：取消
        const n = sets.length;
        host.fire("mousemove", onBtn); expect(sets.length).toBe(n); // 仍在按钮上：不再计时
        host.fire("mousemove", onBody); expect(sets.length).toBe(n + 1); // 回到行本体：重新计时
        host.setAttribute("data-tip-blocked", ""); // 左图标区（TabRow 置位）
        host.fire("mousemove", onBody); expect(clears.length).toBeGreaterThan(1);
        const m = sets.length; host.fire("mousemove", onBody); expect(sets.length).toBe(m);
        host.removeAttribute("data-tip-blocked"); host.fire("mousemove", onBody); expect(sets.length).toBe(m + 1);
        // 直接从外部进入就落在按钮上：mouseenter 不计时
        const h2 = new H(); const b2 = {}; h2.kids.add(b2); arcTooltip(h2 as unknown as HTMLElement, "Row 2", { delay: 1.5 });
        const k = sets.length; h2.fire("mouseenter", { closest: () => b2 }); expect(sets.length).toBe(k);
    } finally { globalThis.setTimeout = st; globalThis.clearTimeout = ct; }
});

/* ── SVG 宿主 / swap 带 tip ── */
test("SVG 宿主：scanTips / applyTip 对 svg 元素自身生效（Element 而非 HTMLElement）", () => {
    class E { }
    class Svg extends E {
        tagName = "svg"; attrs = new Map<string, string>();
        getAttribute(k: string) { return this.attrs.get(k) ?? null; } hasAttribute(k: string) { return this.attrs.has(k); }
        setAttribute(k: string, v: string) { this.attrs.set(k, v); } removeAttribute(k: string) { this.attrs.delete(k); }
        addEventListener() { } querySelectorAll() { return []; }
    }
    const g = globalThis as { Element?: unknown }; const old = g.Element; g.Element = E;
    try {
        const s = new Svg(); s.setAttribute("data-tip", "Svg tip");
        scanTips(s as unknown as ParentNode);
        expect(s.hasAttribute("data-tip")).toBe(false); // 被消费 = 已挂 ArcTooltip
        expect(s.hasAttribute("data-arc-tt")).toBe(true);
    } finally { g.Element = old; }
    expect(readFileSync("src/components/ArcTooltip.ts", "utf8")).toContain("root instanceof Element) applyTip(root as HTMLElement)");
});
test("copyTip：属性已被消费也能把 tip 复制到替换节点；EmptyFavicon.swap 用它", () => {
    class F { a = new Map<string, string>(); getAttribute(k: string) { return this.a.get(k) ?? null; } hasAttribute(k: string) { return this.a.has(k); } setAttribute(k: string, v: string) { this.a.set(k, v); } removeAttribute(k: string) { this.a.delete(k); } addEventListener() { } }
    const img = new F(); img.setAttribute("data-tip", "Hello"); img.setAttribute("data-tip-edge", "7"); img.setAttribute("data-tip-delay", "0.45");
    applyTip(img as unknown as HTMLElement); expect(img.hasAttribute("data-tip")).toBe(false);
    const svg = new F(); expect(copyTip(img as unknown as Element, svg as unknown as Element)).toBe(true);
    expect(svg.getAttribute("data-tip")).toBe("Hello"); expect(svg.getAttribute("data-tip-edge")).toBe("7"); expect(svg.getAttribute("data-tip-delay")).toBe("0.45");
    expect(copyTip(new F() as unknown as Element, new F() as unknown as Element)).toBe(false);
    expect(emptyFav).toContain("copyTip(img, e)");
    expect(emptyFav).not.toContain('["data-tip", "data-tip-subtitle"');
});

/* ── 行 hover 背景 = Rea N1 ── */
test("行 hover 背景：浅 #0E0F10 α.10 / 深 #FAFBFF α.15（已与 Rea N1 一致）", () => {
    expect(css).toContain("--arc-hover: rgb(14 15 16 / .10)");
    expect(css).toContain("--arc-hover: rgb(250 251 255 / .15)");
});

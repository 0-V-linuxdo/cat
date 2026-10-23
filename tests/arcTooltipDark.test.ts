import { test, expect } from "bun:test";
import { TOOLTIP_CSS, TOOLTIP_PALETTE, stripTitles } from "../src/components/ArcTooltip";

test("深色：不引用未定义变量，系统 / data-theme / data-bb-dark 三路切到同一组深色值（顺序：bb-dark 最后）", () => {
    expect(TOOLTIP_CSS).not.toContain("--arc-menu-bg");
    const dark = "--tt-bg: #2B2B2B; --tt-fg: #fff;";
    expect(TOOLTIP_CSS).toContain(`@media (prefers-color-scheme: dark) { .arc-tooltip { ${dark}`);
    expect(TOOLTIP_CSS).toContain(`:root[data-theme="dark"] .arc-tooltip { ${dark}`);
    expect(TOOLTIP_CSS).toContain(`:root[data-bb-dark="1"] .arc-tooltip { ${dark}`);
    expect(TOOLTIP_CSS).toContain(':root[data-bb-dark="0"] .arc-tooltip { --tt-bg: #fff; --tt-fg: #000;');
    expect(TOOLTIP_CSS.indexOf("data-bb-dark")).toBeGreaterThan(TOOLTIP_CSS.indexOf(':root[data-theme="dark"]'));
    expect(TOOLTIP_CSS).toContain("--tt-stroke0: rgb(255 255 255/.1)");
    expect(TOOLTIP_PALETTE.dark.bg).toBe("#2B2B2B");
});

/** 极简假元素：够 stripTitles 用 */
class El {
    attrs = new Map<string, string>(); kids: El[] = []; removed = false;
    constructor(public tagName: string, a: Record<string, string> = {}, public parentTag = "") { for (const [k, v] of Object.entries(a)) this.attrs.set(k, v); }
    getAttribute(k: string) { return this.attrs.get(k) ?? null; } hasAttribute(k: string) { return this.attrs.has(k); }
    setAttribute(k: string, v: string) { this.attrs.set(k, v); } removeAttribute(k: string) { this.attrs.delete(k); }
    remove() { this.removed = true; }
    querySelectorAll(sel: string) { return sel === "[title]" ? this.kids.filter(k => k.hasAttribute("title")) : this.kids.filter(k => k.tagName === "TITLE" && k.parentTag === "SVG"); }
}
const strip = (e: El) => stripTitles(e as unknown as Element);

test("title：可交互宿主挪到 aria-label 后移除，内部 img / favicon / svg<title> 一并去掉", () => {
    const img = new El("IMG", { title: "github.com" }), st = new El("TITLE", {}, "SVG");
    const a = new El("A", { title: "GitHub" }); a.kids = [img, st];
    expect(strip(a)).toBe(3);
    expect(a.getAttribute("aria-label")).toBe("GitHub"); expect(a.hasAttribute("title")).toBe(false);
    expect(img.hasAttribute("title")).toBe(false); expect(st.removed).toBe(true);
});
test("title：不覆盖已有 aria-label；非交互元素不补 aria-label", () => {
    const b = new El("BUTTON", { title: "x", "aria-label": "Keep" }); strip(b);
    expect(b.getAttribute("aria-label")).toBe("Keep"); expect(b.hasAttribute("title")).toBe(false);
    const s = new El("SPAN", { title: "badge" }); strip(s);
    expect(s.hasAttribute("aria-label")).toBe(false); expect(s.hasAttribute("title")).toBe(false);
});

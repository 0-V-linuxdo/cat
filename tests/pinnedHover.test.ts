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
    expect(row).toContain('"pinned.backToUrl"'); // rel47：经 hoverSubText()（按 ⌘ 在 backToUrl / separate 间切换）
    expect(row).toContain("hoverSubText());");
    expect(en).toContain('"pinned.backToUrl": "Back to Pinned URL"');
    expect(zh).toMatch(/"pinned\.backToUrl": "[^"]+"/);
});
test("⌘：图标区悬停按住 Command → 第二行 Separate From Pinned Tab（rel47，pinned-icon-hover.md 结论 1，bit3 = command）；实时切换", () => {
    expect(row).toContain('tr(metaDown ? "pinned.separate" : "pinned.backToUrl")');
    expect(row).toContain('window.addEventListener("keydown", e => sync(e.metaKey), true)');
    expect(row).toContain('window.addEventListener("keyup", e => sync(e.metaKey), true)');
    expect(row).toContain('.arc-tab[data-hz="icon"] > .arc-tab-sub'); // 只改图标区悬停中的第二行（⌘ 只在图标区有效）
    expect(row).toContain("applyMeta(); // morph"); // 整屏重绘后补回
    expect(row).not.toContain("e.altKey"); // 不是 Option
    expect(en).toContain('"pinned.separate": "Separate From Pinned Tab"');
    expect(zh).toMatch(/"pinned\.separate": "[^"]+"/);
});
test("左图标副标题：只在图标区（行左缘 → 斜杠左缘）；不是整行；hover 整行不触发", () => {
    expect(row).toContain("e.clientX < r.left"); // r = 斜杠的 rect
    expect(row).toContain('rw.setAttribute("data-hz", "icon")'); // rw = e.currentTarget（pinned-icon-hover：不能用渲染时闭包里的 row）
    expect(css + tabsCss).not.toMatch(/\.arc-tab:hover[^{]*\.arc-tab-sub/); // 副标题不挂在整行 :hover 上
});
test("左图标 hover 样式：标题平移 7（只在 data-hz）、副标题 0.1s easeInEaseOut 淡入、右按钮隐藏、单行尾截断；P-01 的 translateX(7px) 已删", () => {
    expect(tabsCss).not.toContain("translateX(7px)");
    expect(tabsCss).toContain(':root .arc-tab[data-hz="icon"] > .arc-tab-title { transform: translateY(-7px); }');
    expect(tabsCss).toContain(".arc-tab > .arc-tab-title { transition: transform .1s ease-in-out; }");
    expect(tabsCss).toMatch(/\.arc-tab-sub \{[^}]*opacity: 0; transition: opacity \.1s ease-in-out;/);
    expect(tabsCss).toMatch(/\.arc-tab-sub \{[^}]*white-space: nowrap; overflow: hidden; text-overflow: ellipsis;/);
    expect(tabsCss).toContain(':root .arc-tab[data-hz="icon"] > .arc-tab-sub { opacity: 1; }');
    expect(tabsCss).toContain(':root .arc-tab[data-hz="icon"] .arc-tab-close { opacity: 0; pointer-events: none; display: none; }'); // rel47 ⑤：不占位
});
test("斜杠版面：图标 → 斜杠 0、斜杠 → 标题 4；图标区 hover 只改 alpha", () => {
    expect(css).toContain("margin: 0 calc(4px - var(--arc-gap, 6px)) 0 calc(-1 * var(--arc-gap, 6px))");
    expect(css).toContain('.arc-tab[data-hz="icon"] .arc-drift { opacity: 0; }');
    expect(css).not.toContain(".arc-tab:hover .arc-drift"); // rel46：整行悬停不再隐藏「/」
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
test("图标区 region0 高亮块（rel47，pinned-icon-hover.md 结论 5）：宽 36 / 圆角 12 / 色值 / 当前行左圆右直；只在 data-hz=icon（偏离行图标区）", () => {
    expect(tabsCss).toContain(':root .arc-tab[data-hz="icon"]::before { content: ""; position: absolute; z-index: -1; left: 0; top: 0; bottom: 0; width: 36px; border-radius: 12px; background: var(--arc-hz-bg); pointer-events: none; }');
    expect(tabsCss).toContain(":root { --arc-hz-bg: rgb(14 15 16 / .05); --arc-hz-press: rgb(14 15 16 / .065); }");
    expect(tabsCss).toContain(':root[data-theme="dark"] { --arc-hz-bg: rgb(250 251 255 / .10); --arc-hz-press: rgb(250 251 255 / .065); }');
    expect(tabsCss).toContain("@media (prefers-color-scheme: dark) { :root:not([data-theme=\"light\"]) { --arc-hz-bg: rgb(250 251 255 / .10)");
    expect(tabsCss).toContain(':root .arc-tab[data-hz="icon"]:active::before { background: var(--arc-hz-press); }');
    expect(tabsCss).toContain('border-radius: 12px 0 0 12px; }'); // cornerMask 5
    expect(tabsCss).toContain("宽 36 ⚠ 推导值"); // 标注
});
test("rel47 ④⑤⑥：第一行尾部省略号（无渐隐 mask）；第二行右界到行最右（不再 --arc-sub-width）；第二行色 = 行文字色 × 0.5", () => {
    const sp = css;
    expect(sp).toMatch(/\.arc-tab-title \{[^}]*text-overflow: ellipsis;[^}]*\}/);
    expect(sp.match(/\.arc-tab-title \{[^}]*\}/)![0]).not.toMatch(/mask|text-overflow: clip/);
    expect(tabsCss).toMatch(/\.arc-tab-sub \{[^}]*left: var\(--arc-sub-left, 0\); right: 6px;/);
    expect(tabsCss).not.toContain("var(--arc-sub-width");
    expect(tabsCss).toContain("var(--arc-row-fg, currentColor) 50%, transparent)");
    expect(tabsCss).not.toContain("var(--arc-row-fg, currentColor) 56%");
});
test("rel47 ⑦：⌘ 单击图标区 = separateCurrent（最小实现，reducer ⛔）；普通单击仍 resetNode；multiSelect 放行图标区 ⌘ 单击；选中状态不动（后台新开）", () => {
    const pin = readFileSync("src/plugins/tabs/pinnedTabs/index.ts", "utf8");
    const ms = readFileSync("src/plugins/tabs/multiSelect/index.ts", "utf8");
    expect(pin).toContain("e => { if (e.metaKey) void separateCurrent(n.id); else resetNode(n.id); }");
    expect(pin).toContain("按 shouldSeparateCurrent=true 语义的最小实现，reducer 源码未找到");
    const fn = pin.slice(pin.indexOf("export async function separateCurrent"), pin.indexOf("/** 固定标签是否已偏离固定的网址"));
    expect(fn).toContain("chrome.tabs.create({ url: n.url,"); expect(fn).toContain("active: false"); // 当前页保持选中
    expect(fn).toContain("f.tabId = nt.id"); // 固定项改绑新标签，原标签不再被认领 → 普通标签
    expect(fn).not.toContain("chrome.tabs.update"); expect(fn).not.toContain("resetNode"); // 当前页不被导航回固定网址
    expect(fn).not.toContain("n.url ="); // 固定项保存的 URL 不改
    expect(pin).not.toContain("e.metaKey || e.ctrlKey");
    expect(ms).toContain("if (e.metaKey && !e.shiftKey && inDriftIconZone(row, e)) return;");
    expect(row).toContain("export function inDriftIconZone(");
    expect(row).toContain("inDriftIconZone(e.currentTarget as HTMLElement, e)");
});

test("rel48 ①：偏离行图标区悬停（无 ⌘）→ 图标换成保存网址的 _favicon；⌘ / 离开 / REHOVER 补回；customIcon 与未偏离行不换；不新增存储字段（推导数据源 ⚠）", () => {
    const pin = readFileSync("src/plugins/tabs/pinnedTabs/index.ts", "utf8");
    expect(pin).toContain("savedUrl: n.url,");
    expect(row).toContain('const savedFav = p.drifted && p.onIconClick && !p.customIcon && p.savedUrl ? faviconUrl(p.savedUrl) : "";');
    expect(row).toContain('"data-saved-fav": savedFav || null');
    expect(row).toContain('const want = rw.hasAttribute("data-hz") && !metaDown');
    expect(row).toContain("数据源是推导 ⚠"); // 注释标明
    // 换图随 data-hz（set）、⌘（applyMeta）、REHOVER（其后调 applyMeta）同步
    expect(row).toContain('rw.removeAttribute("data-hz"); rw.removeAttribute("data-tip-blocked"); syncIcon(rw);');
    expect(row).toMatch(/applyMeta\(\) \{[^}]*data-saved-fav\][^}]*syncIcon\(r\)/s);
    expect(row).toMatch(/REHOVER, e => \{[\s\S]*?applyMeta\(\);/);
    // 无动画 / 缩放：换图只替换节点，没有 transition / scale
    const fn = row.slice(row.indexOf("function syncIcon"), row.indexOf("function applyMeta"));
    expect(fn).not.toMatch(/transition|animate|scale/);
    // 不新增存储字段
    const model = readFileSync("src/plugins/tabs/pinnedTabs/model.ts", "utf8");
    expect(model).not.toMatch(/savedFav\w*\??:|favIconUrl\??:/); // 没有保存 favicon 的字段
    expect(readFileSync("static/manifest.json", "utf8")).toContain('"favicon"'); // _favicon 权限已有，没加
});

test("rel48 ①：selftest 第 71 项的 REHOVER 模拟同样摘 data-fav-orig 并断言补回换图", () => {
    const st = readFileSync("src/selftest/selftest.ts", "utf8");
    expect(st).toContain('dr.removeAttribute("data-fav-orig");');
    expect(st).toContain("ri.favSwap === true");
});

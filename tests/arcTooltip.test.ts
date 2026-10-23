import { test, expect } from "bun:test";
import { TOOLTIP_DELAY_S, TOOLTIP_FADE_IN_S, TOOLTIP_FADE_OUT_S, TOOLTIP_TITLE_PX, TOOLTIP_TITLE_WEIGHT, TOOLTIP_SUBTITLE_PX, TOOLTIP_KEY_PX, TOOLTIP_KEY_PAD, TOOLTIP_KEY_RADIUS, TOOLTIP_GAP, TOOLTIP_PAD_X, TOOLTIP_WARM_S, TOOLTIP_WARM_DELAY_S, tooltipVariant, tooltipStroke, tooltipCorners, placeTooltip, edgeFrame, nextDelay, TOOLTIP_PALETTE, TOOLTIP_CSS } from "../src/components/ArcTooltip";

test("ArcTooltip 源码取值（第 2 轮）", () => {
    expect(TOOLTIP_DELAY_S).toBe(0.45); expect(TOOLTIP_FADE_IN_S).toBe(0.05); expect(TOOLTIP_FADE_OUT_S).toBe(0.3);
    expect(TOOLTIP_TITLE_PX).toBe(12); expect(TOOLTIP_TITLE_WEIGHT).toBe(700); expect(TOOLTIP_SUBTITLE_PX).toBe(11);
    expect(TOOLTIP_KEY_PX).toBe(10); expect(TOOLTIP_KEY_PAD).toBe(2); expect(TOOLTIP_KEY_RADIUS).toBe(4);
    expect(TOOLTIP_GAP).toBe(6); expect(TOOLTIP_PAD_X).toBe(10);
    expect(TOOLTIP_CSS).not.toContain("0.12s");
});
test("预热：距上次关闭 <0.6s → 0.01s", () => {
    expect(TOOLTIP_WARM_S).toBe(0.6); expect(TOOLTIP_WARM_DELAY_S).toBe(0.01);
    expect(nextDelay(0.45, 0.3)).toBe(0.01); expect(nextDelay(0.45, 0.7)).toBe(0.45); expect(nextDelay(1, Infinity)).toBe(1);
});
test("样式 / 圆角 / 描边", () => {
    expect(tooltipVariant(0).shadow).toBe("0 0 2.5px rgb(0 0 0/.18), 0 2.5px 10px rgb(0 0 0/.15)");
    expect(tooltipVariant(1)).toEqual({ radius: 8, shadow: "0 16px 31px rgb(113 84 42/.15)" });
    expect(tooltipCorners(0)).toEqual([14, 3, 14, 14]); // 默认 6 bottomLeading（§F）
    expect(TOOLTIP_CSS).toContain("border-radius: 14px 3px 14px 14px");
    expect(tooltipStroke(0, false)).toBeNull(); expect(tooltipStroke(0, true)).toBe("rgb(255 255 255/.1)");
});
test("配色 FUN_100de71d8", () => {
    expect(TOOLTIP_PALETTE.dark).toEqual({ bg: "#2B2B2B", title: "#fff", keyFg: "rgb(71 71 71)", keyBg: "rgb(115 115 115)", keyText: "#fff" });
    expect(TOOLTIP_PALETTE.light).toEqual({ bg: "#fff", title: "#000", keyFg: "rgb(230 230 230)", keyBg: "rgb(168 168 168)", keyText: "#000" });
    expect(TOOLTIP_CSS).toContain("background: var(--tt-bg); /*"); // 气泡纯色；渐变只在键帽底座
});
const R = (l: number, t: number, r: number, b: number) => ({ left: l, top: t, right: r, bottom: b });
const overlaps = (p: { left: number; top: number }, w: number, h: number, a: ReturnType<typeof R>) => p.left < a.right && p.left + w > a.left && p.top < a.bottom && p.top + h > a.top;

test("位置公式（FUN_100deef1c）：top/bottom 居中间距 4，侧边间距 4，四角重叠 6", () => {
    const a = R(100, 100, 140, 120), area = R(8, 8, 392, 592);
    expect(edgeFrame(1, a, 60, 28, area)).toEqual({ left: 90, top: 124 });
    expect(edgeFrame(0, a, 60, 28, area)).toEqual({ left: 90, top: 68 });
    expect(edgeFrame(2, a, 60, 28, area)).toEqual({ left: 36, top: 96 });
    expect(edgeFrame(3, a, 60, 28, area)).toEqual({ left: 144, top: 96 });
    expect(edgeFrame(6, a, 60, 28, area)).toEqual({ left: 46, top: 114 });
    expect(edgeFrame(7, a, 60, 28, area)).toEqual({ left: 134, top: 114 });
});
test("回退：底栏 Library 按钮（左下角）首选 6 放不下 → top，居中并夹紧到可用区（内缩 8）", () => {
    const vp = { width: 300, height: 600 }, a = R(10, 566, 34, 590);
    const p = placeTooltip(a, 80, 28, vp)!;
    expect(p.edge).toBe(0); expect(p.top).toBe(566 - 28 - 4); expect(p.left).toBe(8);
    expect(overlaps(p, 80, 28, a)).toBe(false);
});
test("回退顺序 首选 → 0..7 去重；首选放得下立即用；都放不下 → null", () => {
    const vp = { width: 400, height: 600 };
    expect(placeTooltip(R(200, 200, 240, 220), 60, 28, vp)!.edge).toBe(6);
    expect(placeTooltip(R(200, 200, 240, 220), 60, 28, vp, 1)!.edge).toBe(1);
    // 顶部贴边：top 放不下 → bottom
    expect(placeTooltip(R(5, 10, 395, 30), 60, 28, vp)!.edge).toBe(1);
    // 比可用区还宽 → 不再丢弃：按可用区宽截断，top 居中夹紧（maxWidth ⛔ 回退）
    { const p = placeTooltip(R(100, 100, 120, 120), 500, 28, vp)!; expect(p).not.toBeNull(); expect(p.left).toBe(8); expect(p.edge).toBe(0); }
    // 高度超出可用区仍不显示
    expect(placeTooltip(R(100, 100, 120, 120), 60, 700, vp)).toBeNull();
});
test("水平夹紧只用于 top/bottom；侧边方向不夹紧（放不下就换方向）", () => {
    const area = R(8, 8, 392, 592), a = R(380, 300, 396, 320);
    expect(edgeFrame(1, a, 120, 28, area).left).toBe(392 - 120);
    expect(edgeFrame(3, a, 120, 28, area).left).toBe(400);
});
test("气泡不覆盖宿主（边方向）；圆角按首选方向、不随回退；pointer-events:none", () => {
    const vp = { width: 300, height: 600 };
    for (const a of [R(10, 566, 34, 590), R(5, 10, 295, 30), R(100, 300, 200, 330)]) {
        const p = placeTooltip(a, 80, 28, vp)!;
        if (p.edge <= 3) expect(overlaps(p, 80, 28, a)).toBe(false);
    }
    expect(tooltipCorners(0, 6)).toEqual([14, 3, 14, 14]); expect(tooltipCorners(0, 4)).toEqual([14, 14, 3, 14]);
    expect(tooltipCorners(0, 5)).toEqual([14, 14, 14, 3]); expect(tooltipCorners(0, 7)).toEqual([3, 14, 14, 14]);
    expect(tooltipCorners(0, 0)).toEqual([14, 14, 14, 14]); expect(tooltipCorners(1, 6)).toEqual([8, 8, 8, 8]);
    expect(TOOLTIP_CSS).toMatch(/\.arc-tooltip \{[^}]*pointer-events: none/);
});

/* ── 显示期间实时更新文本（bindLiveText）：假 MutationObserver + 假宿主 */
import { bindLiveText, applyTip } from "../src/components/ArcTooltip";
class FakeMO {
    static all: FakeMO[] = [];
    target: unknown = null; opts: MutationObserverInit | null = null; connected = false;
    constructor(public cb: () => void) { FakeMO.all.push(this); }
    observe(t: unknown, o: MutationObserverInit) { this.target = t; this.opts = o; this.connected = true; }
    disconnect() { this.connected = false; }
    fire() { if (this.connected) this.cb(); }
}
class Host {
    tagName = "BUTTON"; attrs = new Map<string, string>(); listeners = 0;
    getAttribute(k: string) { return this.attrs.get(k) ?? null; } hasAttribute(k: string) { return this.attrs.has(k); }
    setAttribute(k: string, v: string) { this.attrs.set(k, v); } removeAttribute(k: string) { this.attrs.delete(k); }
    addEventListener() { this.listeners++; }
}
const MO = FakeMO as unknown as typeof MutationObserver;

test("显示中改 data-tip：气泡文本实时更新，宿主节点不变，只监听宿主 data-tip", () => {
    const host = new Host(); let text = "Mute";
    const seen: string[] = [];
    const off = bindLiveText(host as unknown as HTMLElement, () => text, t => seen.push(t), MO);
    const mo = FakeMO.all.at(-1)!;
    expect(mo.target).toBe(host); expect(mo.opts).toEqual({ attributes: true, attributeFilter: ["data-tip"] });
    text = "Unmute"; mo.fire();
    expect(seen).toEqual(["Unmute"]);
    mo.fire(); expect(seen).toEqual(["Unmute"]); // 文本未变不重复回调（不重排）
    expect(mo.target).toBe(host); // 宿主身份不变
    off();
});
test("hide 后 observer 断开，不再更新", () => {
    const host = new Host(); let text = "A"; const seen: string[] = [];
    const off = bindLiveText(host as unknown as HTMLElement, () => text, t => seen.push(t), MO);
    const mo = FakeMO.all.at(-1)!;
    off(); expect(mo.connected).toBe(false);
    text = "B"; mo.fire(); expect(seen).toEqual([]);
});
test("实时更新经 applyTip：已有 aria-label 不动，data-tip 被消费", () => {
    const host = new Host(); host.attrs.set("aria-label", "Keep");
    host.attrs.set("data-tip", "One"); applyTip(host as unknown as HTMLElement);
    const off = bindLiveText(host as unknown as HTMLElement, () => "x", () => { }, MO);
    host.attrs.set("data-tip", "Two"); FakeMO.all.at(-1)!.fire();
    expect(host.getAttribute("aria-label")).toBe("Keep"); expect(host.hasAttribute("data-tip")).toBe(false);
    off();
});

/* ── 中性配色（用户截图：蓝色 Space 主题下气泡变深蓝）——气泡 / 文字 / 描边 / 键帽只按深浅切换，不引用任何 --arc-* 主题变量 */
import { splitShortcut, keycaps, TOOLTIP_CSS as CSS2 } from "../src/components/ArcTooltip";
test("中性：TOOLTIP_CSS 不含任何 --arc-* 主题变量；根上设蓝色主题变量也不影响（变量只在 .arc-tooltip 自身定义）", () => {
    expect(CSS2).not.toMatch(/var\(--arc-/);
    expect(CSS2).not.toMatch(/--arc-[a-z-]+\s*:/);
    // 模拟「根上设了蓝色主题」：气泡用的 --tt-* 在 .arc-tooltip 选择器内定值，根上的 --arc-pop-solid / --arc-fg / --arc-accent 无从继承
    const blueRoot = ":root { --arc-pop-solid: #1b2a4a; --arc-fg: #cfe0ff; --arc-accent: #4c8bf5; --arc-menu: #1b2a4a; }";
    for (const v of ["--arc-pop-solid", "--arc-fg", "--arc-accent", "--arc-menu"]) expect(CSS2.includes(v)).toBe(false);
    expect(blueRoot).toContain("#1b2a4a");
    expect(CSS2).toMatch(/\.arc-tooltip \{ --tt-bg: #fff; --tt-fg: #000;/);
    expect(CSS2).toContain("--tt-bg: #2B2B2B; --tt-fg: #fff;");
    expect(CSS2).toContain("background: var(--tt-bg);");
    expect(CSS2).toContain("color: var(--tt-ktext)");
});
test("快捷键解析：每键一个、⌃⌥⇧⌘ 顺序、主键大写、无 + / 空格", () => {
    expect(splitShortcut("⌃2")).toEqual(["⌃", "2"]);
    expect(splitShortcut("⌥ 1")).toEqual(["⌥", "1"]);
    expect(splitShortcut("Alt+1")).toEqual(["⌥", "1"]);
    expect(splitShortcut("⌥⇧1")).toEqual(["⌥", "⇧", "1"]);
    expect(splitShortcut("⌘⇧⌥⌃k")).toEqual(["⌃", "⌥", "⇧", "⌘", "K"]);
    expect(splitShortcut("Shift+Ctrl+Cmd+p")).toEqual(["⌃", "⇧", "⌘", "P"]);
    expect(splitShortcut("Ctrl++")).toEqual(["⌃", "+"]);
    expect(splitShortcut("")).toEqual([]);
    expect(keycaps(undefined)).toBeNull();
});
test("主键映射：Space → ⎵，Tab → tab，其余原样大写", async () => {
    const { mapMainKey } = await import("../src/components/ArcTooltip");
    expect(splitShortcut("Ctrl+Space")).toEqual(["⌃", "⎵"]);
    expect(splitShortcut("⌥Tab")).toEqual(["⌥", "tab"]);
    expect(mapMainKey("⇥")).toBe("tab"); expect(mapMainKey("a")).toBe("A"); expect(mapMainKey("↩")).toBe("↩");
});
test("键帽结构 / 尺寸：底座圆角 4 + 渐变 + keyBackground，面圆角 3 + keyForeground，inset 1/1/2.5/1，min 19×19，间距 3", async () => {
    const m = await import("../src/components/ArcTooltip");
    expect(m.TOOLTIP_KEYCAP_PAD).toEqual([1, 1, 2.5, 1]); expect(m.TOOLTIP_KEYCAP_GAP).toBe(3); expect(m.TOOLTIP_KEYCAP_MIN).toBe(19);
    expect(CSS2).toContain(".arc-tt-keys { display: inline-flex; align-items: center; gap: 3px; }");
    expect(CSS2).toMatch(/\.arc-tooltip kbd \{[^}]*min-width: 19px; min-height: 19px; border-radius: 4px;[^}]*padding: 1px 1px 2\.5px 1px;[^}]*background: linear-gradient\(rgb\(0 0 0\/0\), rgb\(0 0 0\/\.1\)\), var\(--tt-kbg\)/);
    expect(CSS2).toMatch(/\.arc-tooltip kbd > span \{[^}]*border-radius: 3px; background: var\(--tt-kfg\);[^}]*padding: 0 2px; font-size: 10px; font-weight: 700;[^}]*color: var\(--tt-ktext\)/);
});
test("键帽颜色：浅 面 #E6E6E6 / 底座 #A8A8A8 / 字黑；深 面 #474747 / 底座 #737373 / 字白；蓝色主题下不变", () => {
    const hex = (c: string) => "#" + c.match(/\d+/g)!.map(n => (+n).toString(16).padStart(2, "0")).join("").toUpperCase();
    expect(hex(TOOLTIP_PALETTE.light.keyFg)).toBe("#E6E6E6"); expect(hex(TOOLTIP_PALETTE.light.keyBg)).toBe("#A8A8A8");
    expect(hex(TOOLTIP_PALETTE.dark.keyFg)).toBe("#474747"); expect(hex(TOOLTIP_PALETTE.dark.keyBg)).toBe("#737373");
    expect(TOOLTIP_PALETTE.light.keyText).toBe("#000"); expect(TOOLTIP_PALETTE.dark.keyText).toBe("#fff");
    expect(CSS2).toContain(`:root[data-bb-dark="1"] .arc-tooltip { --tt-bg: #2B2B2B; --tt-fg: #fff; --tt-kfg: ${TOOLTIP_PALETTE.dark.keyFg}; --tt-kbg: ${TOOLTIP_PALETTE.dark.keyBg};`);
    expect(CSS2).not.toMatch(/var\(--arc-/);
});
test("副标题：11pt Regular，标题色 α.66（深白 / 浅黑，随中性配色）", () => {
    expect(CSS2).toContain("font-size: 11px; font-weight: 400; color: color-mix(in srgb, var(--tt-fg) 66%, transparent);"); expect(CSS2).toContain(".arc-tooltip small { display: block;");
});
test("防祖先主题 / 滤镜：气泡自身 isolation、无混合 / 滤镜 / 透明度，纯色 #2B2B2B 不受根上蓝色主题变量影响", async () => {
    expect(CSS2).toMatch(/\.arc-tooltip \{[^}]*isolation: isolate; mix-blend-mode: normal; filter: none; backdrop-filter: none; opacity: 1;/);
    expect(CSS2).toContain("--tt-bg: #2B2B2B;"); expect(CSS2).not.toMatch(/var\(--arc-/);
    const src = await Bun.file(new URL("../src/components/ArcTooltip.ts", import.meta.url)).text();
    expect(src).toContain("return { root: document, parent: document.body };"); // 挂在 body，不在 #app（失焦 filter / opacity）之下
});
test("声明式副标题 data-tip-subtitle", async () => {
    const src = await Bun.file(new URL("../src/components/ArcTooltip.ts", import.meta.url)).text();
    expect(src).toContain('el.getAttribute("data-tip-subtitle")');
});
test("超长文本（chrome-extension:// URL）：max-width = 视口 − 16，标题单行省略号，键帽不收缩", () => {
    expect(CSS2).toContain("max-width: calc(100vw - 16px)");
    expect(CSS2).toMatch(/\.arc-tooltip > span:first-child \{ min-width: 0; overflow: hidden; text-overflow: ellipsis; \}/);
    expect(CSS2).toContain(".arc-tt-keys, .arc-tt-badge { flex: none; }");
    const p = placeTooltip(R(10, 300, 290, 330), 2000, 28, { width: 300, height: 600 });
    expect(p).not.toBeNull(); expect(p!.left).toBe(8);
});

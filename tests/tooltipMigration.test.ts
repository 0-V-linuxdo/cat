/* ArcTooltip 迁移守护：盘点（arc-analysis/tooltip-inventory.md）里已迁移的位置不再用原生 title */
import { expect, test } from "bun:test";
import { readFileSync } from "fs";

const sites: [string, string[]][] = [
    ["src/api/PanelShell.ts", ['"data-tip": tr("common.close"), onclick: closeOverlay']],
    ["src/components/IconPicker.ts", ['arc-ip-tone", "data-tip"', 'arc-ip-catbtn", "data-tip"']],
    ["src/components/TabRow.ts", ['arc-audio", "data-tip"', 'arc-tab-close-${action}`, "data-tip"']],
    ["src/plugins/command/commandBar/index.ts", ['"data-tip": tr("cmdbar.removeSuggestion")']],
    ["src/plugins/library/libraryView/index.ts", ['lib-back", "data-tip"', 'lib-filter", "data-tip"']],
    ["src/plugins/views/siteControls/index.ts", ['sc-share", "data-tip"', 'sc-more", "data-tip"']],
    ["src/plugins/views/splitView/index.ts", ['"data-tip": tr("split.closePane")']],
];
for (const [f, needles] of sites) test(`${f} 用 data-tip + @components/ArcTooltip`, () => {
    const s = readFileSync(f, "utf8");
    expect(s).toContain('import "@components/ArcTooltip"');
    for (const n of needles) expect(s).toContain(n);
});
test("ArcTooltip 组件未被改动的接口仍在", () => {
    const s = readFileSync("src/components/ArcTooltip.ts", "utf8");
    expect(s).toContain("export const TOOLTIP_DELAY_S = 0.45");
});

/* tip.ts：自带 aria-label 不覆盖；空白文本整个跳过 */
class FakeEl {
    tagName = "BUTTON";
    attrs = new Map<string, string>();
    listeners: Record<string, ((e: any) => void)[]> = {};
    getAttribute(k: string) { return this.attrs.get(k) ?? null; }
    setAttribute(k: string, v: string) { this.attrs.set(k, String(v)); }
    removeAttribute(k: string) { this.attrs.delete(k); }
    hasAttribute(k: string) { return this.attrs.has(k); }
    addEventListener(t: string, f: (e: any) => void) { (this.listeners[t] ??= []).push(f); }
}
const mk = (a: Record<string, string>) => { const e = new FakeEl(); for (const [k, v] of Object.entries(a)) e.setAttribute(k, v); return e as unknown as HTMLElement & FakeEl; };

test("tip：已有 aria-label 保持原样，原生 title 去掉，data-tip 移除", async () => {
    const { applyTip } = await import("../src/components/ArcTooltip");
    const el = mk({ "data-tip": "Copy Link", "aria-label": "自带标签", title: "old" });
    applyTip(el);
    expect(el.getAttribute("aria-label")).toBe("自带标签");
    expect(el.hasAttribute("title")).toBe(false);
    expect(el.hasAttribute("data-tip")).toBe(false);
    expect(el.listeners.mouseenter?.length).toBeGreaterThan(0);
    el.setAttribute("data-tip", "Changed"); applyTip(el);   // 更新文本也不覆盖
    expect(el.getAttribute("aria-label")).toBe("自带标签");
});
test("tip：没有 aria-label 时用提示文本补上，文本更新时跟着改", async () => {
    const { applyTip } = await import("../src/components/ArcTooltip");
    const el = mk({ "data-tip": "Back" });
    applyTip(el);
    expect(el.getAttribute("aria-label")).toBe("Back");
    el.setAttribute("data-tip", "Forward"); applyTip(el);
    expect(el.getAttribute("aria-label")).toBe("Forward");
});
test("tip：空 / 纯空白文本整个跳过（不挂提示、不写 aria-label）", async () => {
    const { applyTip } = await import("../src/components/ArcTooltip");
    for (const v of ["", "   ", "\n\t"]) {
        const el = mk({ "data-tip": v, title: "keep" });
        applyTip(el);
        expect(el.hasAttribute("aria-label")).toBe(false);
        expect(el.listeners.mouseenter).toBeUndefined();
        expect(el.hasAttribute("data-tip")).toBe(false);
    }
});
test("tip：之前补过的 aria-label 在文本变空时撤掉，且不显示空提示", async () => {
    const { applyTip } = await import("../src/components/ArcTooltip");
    const el = mk({ "data-tip": "Mute" });
    applyTip(el);
    el.setAttribute("data-tip", " "); applyTip(el);
    expect(el.hasAttribute("aria-label")).toBe(false);
});

test("tip：非交互元素（span / div 徽标）不补 aria-label，但仍挂提示", async () => {
    const { applyTip } = await import("../src/components/ArcTooltip");
    const el = mk({ "data-tip": "Required" }); el.tagName = "SPAN";
    applyTip(el);
    expect(el.hasAttribute("aria-label")).toBe(false);
    expect(el.listeners.mouseenter?.length).toBeGreaterThan(0);
    const r = mk({ "data-tip": "Grip", role: "button" }); r.tagName = "SPAN"; applyTip(r);
    expect(r.getAttribute("aria-label")).toBe("Grip");
});
test("tip：options.ts 的“配置 + 插件名”aria-label 保留", async () => {
    const { applyTip } = await import("../src/components/ArcTooltip");
    const el = mk({ "data-tip": "Configure", "aria-label": "Configure Tidy Tabs" });
    applyTip(el);
    expect(el.getAttribute("aria-label")).toBe("Configure Tidy Tabs");
});
test("统一 helper：tip.ts 已删除，迷你播放器不再有本地 tips 补丁", () => {
    const { existsSync } = require("fs");
    expect(existsSync("src/components/tip.ts")).toBe(false);
    const s = readFileSync("src/plugins/library/media/index.ts", "utf8");
    expect(s).not.toContain("queueMicrotask(() => tips");
    expect(s).toContain('import "@components/ArcTooltip"');
});
test("peek：shadow root 内用 arcTooltip，样式按 root 注入", () => {
    const p = readFileSync("src/plugins/views/peek/index.ts", "utf8");
    expect(p).not.toMatch(/\.title = tr\(/);
    expect(p).toContain('arcTooltip(btn, tr("peek.cmdMove"))');
    const a = readFileSync("src/components/ArcTooltip.ts", "utf8");
    expect(a).toContain("r instanceof ShadowRoot");
});

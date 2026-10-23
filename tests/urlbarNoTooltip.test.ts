import { expect, test } from "bun:test";
import { readFileSync } from "fs";
/* Rea arc-analysis/tooltip-urlbar.md：Arc 的 URL pill（CommandBarPlaceholderView）和其中的图标（CommandBarIconView）都没有 tooltip。 */
const nav = readFileSync("src/plugins/command/navigation/index.ts", "utf8");
const start = nav.indexOf('h("div", { class: "arc-nav" }'), end = nav.indexOf('"arc-urlbar-progress"', start);
const block = nav.slice(start, end);

test("地址栏块存在", () => { expect(start).toBeGreaterThan(0); expect(end).toBeGreaterThan(start); });
test("地址栏本体 / 指示器 / 不安全图标 / 复制链接 / 站点控制：无 data-tip、无 title、无 arcTooltip", () => {
    expect(block).not.toMatch(/data-tip/);
    expect(block).not.toMatch(/\btitle:/);
    expect(block).not.toMatch(/arcTooltip\(/);
});
test("无障碍文本保留（aria-label）", () => {
    for (const k of ['"aria-label": displayUrl(t?.url)', '"aria-label": tr("tab.copyLink")', '"aria-label": tr("site.open")', '"data-test": "urlbar-icon", "aria-label": tr("nav.insecure")', '"aria-label": st.title || undefined']) expect(block).toContain(k);
});

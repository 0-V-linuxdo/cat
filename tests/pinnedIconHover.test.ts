/* 固定标签图标区 hover（pinned-icon-hover）回归：整屏重绘（keepHover.morphInto）后，悬停中的已偏离固定行必须还能进 / 保持图标区悬停态。
 * 真实 DOM / 真实鼠标 / 真实重绘由 scripts/harness-cdp.ts 的 pinhover 阶段验证；这里钉住源码约束（防止闭包捕获游离节点这类回退）。 */
import { expect, test } from "bun:test";
import { readFileSync } from "fs";

const row = readFileSync("src/components/TabRow.ts", "utf8");
const kh = readFileSync("src/api/keepHover.ts", "utf8");
const selftest = readFileSync("src/selftest/selftest.ts", "utf8");
const harness = readFileSync("scripts/harness-cdp.ts", "utf8");
/* 偏离行的图标区悬停块：从 `if (p.drifted && p.onIconClick) {` 到 mouseleave 监听 */
const a = row.indexOf("if (p.drifted && p.onIconClick) {"), b = row.indexOf('row.addEventListener("mouseleave"', a);
const block = row.slice(a, b + 120);
const code = block.split("\n").filter(l => !/^\s*(\/\*|\*|\/\/)/.test(l)).join("\n"); // 去掉注释行

test("根因：悬停监听里不得引用渲染时的 row / title / slash 闭包变量（morphInto 换监听后它们是游离新节点），一律用 e.currentTarget + 现查", () => {
    expect(a).toBeGreaterThan(0); expect(b).toBeGreaterThan(a);
    expect(code).not.toMatch(/const slash\b|let inIcon|const title = row\./); // 标题 / 斜杠只能现查（rw.querySelector）
    expect(code).toContain("e.currentTarget as HTMLElement");
    // 三个监听（mousemove / REHOVER / mouseleave）的函数体里都没有裸的 `row.`（只有注册语句 row.addEventListener）
    const bodies = code.slice(code.indexOf("const set =")).replace(/row\.addEventListener/g, "");
    expect(bodies).not.toMatch(/\brow\b/);
    expect(code).toContain("rw.contains(el)");
    expect(code).toContain('rw.querySelector(".arc-drift")?.getBoundingClientRect()');
});

test("状态放在行上（data-hz），不放进闭包；置位 / 复位同时处理 data-tip-blocked", () => {
    expect(code).toContain('on === rw.hasAttribute("data-hz")');
    expect(code).toContain('rw.setAttribute("data-hz", "icon"); rw.setAttribute("data-tip-blocked", "")');
    expect(code).toContain('rw.removeAttribute("data-hz"); rw.removeAttribute("data-tip-blocked")');
    expect(code).toContain('--arc-sub-left'); expect(code).not.toContain('setProperty("--arc-sub-width"'); // rel47 ⑤：不再用 --arc-sub-width
});

test("mousemove 用捕获阶段：先于 ArcTooltip 的目标阶段监听置位 data-tip-blocked（keepHover 换监听后顺序会反）", () => {
    expect(code).toMatch(/\}, true\);\s*\n\s*row\.addEventListener\(REHOVER/);
});

test("图标区命中规则不变：指针在斜杠左缘以左（含行左缘），且不在右按钮 / 音频喇叭上", () => {
    expect(code).toContain("e.clientX < r.left");
    expect(code).toContain('closest?.(".arc-tab-close, .arc-audio")');
    expect(code).toContain("pointer.x < r.left");
    expect(code).toContain('closest(".arc-tab-close, .arc-audio")');
});

test("REHOVER：keepHover.morphInto 同步完悬停中的行后派发；TabRow 按最近一次指针位置 + elementFromPoint 重判", () => {
    expect(kh).toContain('export const REHOVER = "arc-rehover"');
    expect(kh).toContain('if (old.classList.contains("arc-row") && old.matches(":hover")) old.dispatchEvent(new Event(REHOVER));');
    expect(row).toContain('import { REHOVER } from "@api/keepHover"');
    expect(code).toContain("document.elementFromPoint(pointer.x, pointer.y)");
    expect(row).toContain('document.addEventListener("mousemove"');
    // 派发在 replaceChildren 之后（子树就位、斜杠量得到宽度）
    expect(kh.indexOf("old.replaceChildren(...out)")).toBeLessThan(kh.indexOf("old.dispatchEvent(new Event(REHOVER))"));
});

test("Arc 行为不变：只有 drifted && onIconClick 的行才有图标区（canResetTab=false 无区域视图）；点击 / 数值（上移 7、0.1s）不在本补丁改动内", () => {
    expect(row).toContain("if (p.drifted && p.onIconClick) {");
    expect(row.split("trackPointer();").length - 1).toBe(1);
    expect(row).not.toMatch(/translate\(0,\s*-?\d+px\)[^;]*;[^\n]*REHOVER/);
});

test("自测 / harness 已覆盖：SELFTEST 67–72；harness pinhover 阶段（真实鼠标 + 真实重绘）", () => {
    expect(selftest).toContain("固定标签图标区 hover（pinned-icon-hover，SELFTEST 67–72）");
    expect(selftest).toContain('new Event("arc-rehover")');
    expect(harness).toContain('PH.has("pinhover")');
    expect(harness).toContain("指针不动 + 后台标签更新（重渲染）");
});

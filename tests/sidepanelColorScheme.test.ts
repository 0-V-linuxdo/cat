/* 补丁 5：sidepanel.css 的 color-scheme —— 钉住 light/dark 时原生控件 / 滚动条 / Canvas 随之钉住；auto（data-theme="auto" 或没有 data-theme）不钉死，随系统。
 * 源码守卫（bun test 无 DOM）；真实 Chrome 的 getComputedStyle 对照见 headed-scripts/（headless）。 */
import { expect, test } from "bun:test";
import { readFileSync } from "fs";
const raw = readFileSync("static/sidepanel.css", "utf8");
const css = raw.replace(/\/\*[\s\S]*?\*\//g, ""); // 去注释后再判（注释里会提到 color-scheme）
/** 取「选择器恰好是 sel」的规则体（顶层，不含 @media 内的） */
const body = (sel: string) => {
    const re = new RegExp(`(?:^|\\n)${sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`, "g");
    return [...css.matchAll(re)].map(m => m[1]);
};
const decls = [...css.matchAll(/(?<![-\w])color-scheme\s*:\s*([^;}/]+)/g)].map(m => m[1].trim());

test("钉住 light：:root[data-theme=\"light\"] { color-scheme: light }", () => {
    const b = body(':root[data-theme="light"]');
    expect(b.length).toBe(1);
    expect(b[0]).toMatch(/color-scheme:\s*light\s*;/);
});
test("钉住 dark：:root[data-theme=\"dark\"] 里有 color-scheme: dark（既有）", () => {
    expect(body(':root[data-theme="dark"]').some(b => /color-scheme:\s*dark\s*;/.test(b))).toBe(true);
});
test("基线 :root 仍是 color-scheme: light dark（auto / 无 data-theme 随系统）", () => {
    expect(decls[0]).toBe("light dark");
    expect(css).toMatch(/\n:root \{[^}]*color-scheme: light dark;/);
});
test("color-scheme 只有三处：基线 light dark、钉 light、钉 dark；auto 与媒体查询里都不钉死", () => {
    expect(decls.toSorted()).toEqual(["dark", "light", "light dark"]);
    expect(css).not.toMatch(/data-theme="auto"[^{]*\{[^}]*color-scheme/);
    expect(css).not.toMatch(/:not\(\[data-theme[^{]*\{[^}]*color-scheme/);
    const media = [...css.matchAll(/@media \(prefers-color-scheme: dark\) \{[\s\S]*?\n\}/g)].map(m => m[0]).join("\n");
    expect(media).not.toMatch(/(?<![-\w])color-scheme\s*:/);
});
test("特异性：钉住规则 (0,2,0) 高于基线 :root (0,1,0)，且 data-bb-dark 之类不被动到", () => {
    expect(css).toContain(':root[data-theme="light"] {');
    expect(css).not.toMatch(/data-bb-dark[^{]*\{[^}]*color-scheme/);
});
test("既有成对规则不被破坏：每处 :root[data-theme=\"dark\"] 都有「系统深色且非强制浅色」的对应分支", () => {
    const n1 = (css.match(/:root\[data-theme="dark"\]/g) ?? []).length;
    const n2 = (css.match(/:root:not\(\[data-theme="light"\]\)/g) ?? []).length;
    expect(n1).toBeGreaterThan(8);
    expect(n2).toBeGreaterThanOrEqual(n1);
});

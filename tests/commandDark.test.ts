/* 命令栏 / ＋菜单深色：系统深色与 Space 主题强制深色（<html data-theme="dark">，themes/index.ts:41/47）都要生效。
 * 颜色：arc-colors-all.tsv —— CommandBarRowHoverBackgroundColor 深 #FFF α.05（:235）、SecondaryWindowInputBackground 深 #0E0F10（:248）、
 * MenuText 深 #EBEBEC（:31）、MenuHoverBackground 深 #3970C5（:33）、MenuDisabledText 深 #797881（:37）。 */
import { expect, test } from "bun:test";
import css from "../src/plugins/command/style";

const decl = (sel: RegExp) => css.split("\n").filter(l => sel.test(l));
test("命令栏：data-theme=dark 分支与系统深色分支取同一组 Rea 深色值", () => {
    const forced = decl(/^:root\[data-theme="dark"\] \.arc-overlay\[data-overlay="commandBar"\]/);
    const sys = decl(/prefers-color-scheme: dark.*:root:not\(\[data-theme="light"\]\) \.arc-overlay\[data-overlay="commandBar"\]/);
    expect(forced.length).toBe(1); expect(sys.length).toBe(1);
    for (const l of [...forced, ...sys]) { expect(l).toContain("--cb-hover: rgb(255 255 255 / .05)"); expect(l).toContain("--cb-input: #0e0f10"); }
    expect(css).toContain("--cb-hover: rgb(0 0 0 / .05); --cb-input: #fafbff;");
});
test("＋菜单：data-theme=dark 分支存在且与系统深色分支一致", () => {
    const forced = decl(/^:root\[data-theme="dark"\] \.arc-plus-menu \{/);
    const sys = decl(/prefers-color-scheme: dark.*:root:not\(\[data-theme="light"\]\) \.arc-plus-menu \{/);
    expect(forced.length).toBe(1); expect(sys.length).toBe(1);
    for (const l of [...forced, ...sys]) for (const v of ["--pm-fg: #ebebec", "--pm-hover: #3970c5", "--pm-hover-fg: #fff", "--pm-dis: #797881"]) expect(l).toContain(v);
});

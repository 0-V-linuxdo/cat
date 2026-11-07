/* 插件配置对话框里的下拉菜单被对话框盖住（用户 bug，Cat 转来）。
 * 根因：options.css .arc-vdialog-scrim { z-index: 50 } > sidepanel.css .arc-menu { z-index: 20 }，两者都是 <body> 直接子元素 + position:fixed
 * （options.ts openDialog → document.body.append(scrim)；Menu.ts place() → document.body.appendChild(el)），同一个根层叠上下文，50 盖 20：
 * 菜单整个在对话框后面，看不见也点不到，点对话框任意处（= 菜单外）还会让菜单关闭（swallowOutside）。
 * 本测试固定：层级常量次序 / 与共享 sidepanel.css、ArcTooltip.ts 的值一致 / 遮罩 < 菜单 < toast < 确认框。 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { INPAGE_LAYERS, PAGE_Z_MAX, Z, Z_ORDER } from "../src/utils/zLayers";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const side = read("static/sidepanel.css"), opt = read("static/options.css");
const block = (css: string, sel: string) => { const m = new RegExp(`${sel.replace(/[.[\]()]/g, "\\$&")} \\{([^}]*)\\}`).exec(css); expect(m, `找不到 ${sel}`).not.toBeNull(); return m![1]!; };
const z = (css: string, sel: string) => { const m = /z-index: (\d+)/.exec(block(css, sel)); expect(m, `${sel} 没有 z-index`).not.toBeNull(); return Number(m![1]); };

describe("层级常量", () => {
    test("扩展页层级严格递增：overlay < dialog < menu < submenu < toast < confirm < inlineEdit < grain < tooltip", () => {
        const v = Z_ORDER.map(k => Z[k]);
        expect(v.every((x, i) => i === 0 || x > v[i - 1]!)).toBe(true);
        expect(Object.keys(Z).toSorted()).toEqual([...Z_ORDER].toSorted()); // 每个常量都在顺序表里
    });
    test("PAGE_Z_MAX = CSS z-index 上限（2^31-1），tooltip 同值", () => {
        expect(PAGE_Z_MAX).toBe(2 ** 31 - 1);
        expect(Z.tooltip).toBe(PAGE_Z_MAX);
    });
    test("页内侧栏 shadow 内部次序：保持层 / 触发条 < 容器 < 把手 / 提示 < 拖拽遮罩（host.css.ts 头注释）", () => {
        const L = INPAGE_LAYERS;
        expect(L.hold).toBeLessThan(L.box); expect(L.trigger).toBeLessThan(L.box);
        expect(L.box).toBeLessThan(L.handle); expect(L.box).toBeLessThan(L.hint);
        expect(Math.max(L.handle, L.hint)).toBeLessThan(L.mask);
    });
});

describe("与共享 CSS / 组件的值一致（那些文件不归本补丁改，改了任何一边忘记另一边就红）", () => {
    test("sidepanel.css：.arc-overlay / .arc-menu / .arc-submenu / .arc-toast / 噪点层", () => {
        expect(z(side, ".arc-overlay")).toBe(Z.overlay);
        expect(z(side, ".arc-menu")).toBe(Z.menu);
        expect(z(side, ".arc-submenu")).toBe(Z.submenu);
        expect(z(side, ".arc-toast")).toBe(Z.toast);
        const grain = [...side.matchAll(/body::after \{[^}]*z-index: (\d+)/g)].map(m => Number(m[1]));
        expect(grain.length).toBeGreaterThanOrEqual(2); // 跟随系统深色 + 强制深色两处
        for (const g of grain) expect(g).toBe(Z.grain);
    });
    test("ArcTooltip.ts z-index = Z.tooltip（文件已冻结，只读断言）", () => {
        expect(/\.arc-tooltip \{[^]*?position: fixed; z-index: (\d+)/.exec(read("src/components/ArcTooltip.ts"))?.[1]).toBe(String(Z.tooltip));
    });
});

describe("插件配置对话框遮罩（用户 bug 的回归点）", () => {
    test("options.css：遮罩 z-index 走 --arc-z-dialog，值 = Z.dialog，且 < 菜单 / 子菜单 / toast / 确认框", () => {
        const decl = /:root \{ --arc-z-dialog: (\d+); \}/.exec(opt);
        expect(decl, "options.css 缺 :root { --arc-z-dialog }").not.toBeNull();
        expect(Number(decl![1])).toBe(Z.dialog);
        expect(block(opt, ".arc-vdialog-scrim")).toMatch(/position: fixed;[^]*z-index: var\(--arc-z-dialog\)/);
        expect(Z.dialog).toBeLessThan(z(side, ".arc-menu")); // 修复点：原 50 > 20，菜单整个在对话框后面
        expect(Z.dialog).toBeLessThan(z(side, ".arc-submenu"));
        expect(Z.dialog).toBeLessThan(z(side, ".arc-toast")); // 对话框里的校验 / 「已恢复默认」toast 也要在遮罩之上
        expect(Z.dialog).toBeLessThan(Z.confirm); // 恢复默认的确认框在对话框之上
        expect(Z.dialog).toBeGreaterThan(Z.overlay - 1);
        expect(opt).not.toMatch(/z-index: 50\b/);
    });
    test("前提：遮罩和菜单都挂在 <body> 下（同一个根层叠上下文，所以只比 z-index）", () => {
        expect(read("src/entries/options.ts")).toMatch(/document\.body\.append\(scrim\)/);
        expect(read("src/components/Menu.ts")).toMatch(/document\.body\.appendChild\(el\)/);
        expect(block(side, ".arc-menu")).toMatch(/position: fixed/);
        expect(block(opt, ".arc-vdialog-scrim")).toMatch(/position: fixed/);
        // 对话框本身不带 transform / filter（否则 position:fixed 的子元素会以它为包含块）
        expect(block(opt, ".arc-vdialog")).not.toMatch(/transform|filter|perspective|contain:/);
    });
    test("options 页除遮罩外没有别的 z-index（对话框在页面内容之上不需要更大的数）", () => {
        expect([...opt.matchAll(/z-index:\s*([^;}\s]+)/g)].map(m => m[1])).toEqual(["var(--arc-z-dialog)"]);
    });
});

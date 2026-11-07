/* 补丁 3：内容脚本弹层（Capture 菜单）按「外观」设置：auto 跟系统（含菜单开着时系统切换），light / dark 钉住。
 * 旧行为：showMenu 里一次性 matchMedia("(prefers-color-scheme: dark)") 烘死整段 CSS，disabled 行另有 @media（不看设置、也不看菜单开着时的切换）。 */
import { describe, expect, test } from "bun:test";

const logic = () => import("../src/plugins/capture/logic");
const src = (p: string) => Bun.file(new URL(`../src/${p}`, import.meta.url)).text();
const showMenuSrc = async () => { const s = await src("plugins/capture/page.ts"); const a = s.indexOf("function showMenu("), b = s.indexOf("async function copyImage"); return a >= 0 && b > a ? s.slice(a, b) : ""; };

describe("menuCss(dark)：按解析后的明暗出整段 CSS（纯函数）", () => {
    test("深：用 MENU.dark 的底 / 字 / 选中 / toggle，不含浅色的底", async () => {
        const { menuCss, MENU } = await logic() as typeof import("../src/plugins/capture/logic") & { menuCss: (d: boolean) => string };
        const css = menuCss(true);
        for (const c of [MENU.dark.bg, MENU.dark.text, MENU.dark.toggle]) expect(css).toContain(c);
        expect(css).not.toContain(`background:${MENU.light.bg};color:${MENU.light.text}`);
    });
    test("浅：用 MENU.light", async () => {
        const { menuCss, MENU } = await logic() as typeof import("../src/plugins/capture/logic") & { menuCss: (d: boolean) => string };
        const css = menuCss(false);
        expect(css).toContain(`background:${MENU.light.bg};color:${MENU.light.text}`);
        expect(css).not.toContain(MENU.dark.bg);
    });
    test("不含 @media (prefers-color-scheme)——钉住（light / dark）时不能被系统改回去", async () => {
        const { menuCss } = await logic() as typeof import("../src/plugins/capture/logic") & { menuCss: (d: boolean) => string };
        expect(menuCss(true)).not.toContain("prefers-color-scheme"); expect(menuCss(false)).not.toContain("prefers-color-scheme");
    });
    test("disabled 行：浅 #ABABAB、深 #797881（沿用原值：Rea menus-spec.md:50 MenuDisabledText）", async () => {
        const { menuCss } = await logic() as typeof import("../src/plugins/capture/logic") & { menuCss: (d: boolean) => string };
        expect(menuCss(false)).toContain("aria-disabled=true]{color:#ABABAB;}"); expect(menuCss(false)).not.toContain("#797881");
        expect(menuCss(true)).toContain("aria-disabled=true]{color:#797881;}"); expect(menuCss(true)).not.toContain("#ABABAB");
    });
    test("不新增色值：出现的 hex 都在原有集合里（MENU 两套 + 预览底 #151C30 / #FFF + disabled 两个）", async () => {
        const { menuCss, MENU } = await logic() as typeof import("../src/plugins/capture/logic") & { menuCss: (d: boolean) => string };
        const allowed = new Set([...Object.values(MENU.light), ...Object.values(MENU.dark), "#151C30", "#FFF", "#ABABAB", "#797881"].map(x => x.toUpperCase()));
        for (const d of [true, false]) { const hexes = menuCss(d).match(/#[0-9a-fA-F]{3,8}\b/g) ?? []; expect(hexes.length).toBeGreaterThan(0); for (const x of hexes) expect(allowed.has(x.toUpperCase())).toBe(true); }
    });
});

describe("showMenu 接线（源码约束）", () => {
    test("不再直接 matchMedia 烘死；明暗来自 Appearance（resolveDark(appearanceMode(), …)）", async () => {
        const s = await showMenuSrc();
        expect(s.length).toBeGreaterThan(500);
        expect(s).not.toMatch(/matchMedia\(/);
        expect(s).toMatch(/resolveDark\(/); expect(s).toMatch(/appearanceMode\(/);
        expect(s).not.toContain("prefers-color-scheme");
    });
    test("菜单开着时跟随：watchAppearance；关闭时取消；回调只重写 <style>（不重建 DOM、不重放动画）", async () => {
        const s = await showMenuSrc();
        expect(s).toMatch(/watchAppearance\(/);
        const a0 = s.indexOf("watchAppearance("); const cb = s.slice(a0, s.indexOf("});", a0));
        expect(cb).toMatch(/textContent/);
        expect(cb).not.toMatch(/shadowHost|\.remove\(|replaceChildren|createElement|draw\(\)/);
        const close = s.match(/const close = \(\) => \{[^\n]*\}/)?.[0] ?? "";
        expect(close).toMatch(/stop|unwatch|unsub/i);
    });
});

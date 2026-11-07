/* 补丁 system-color-scheme/7：boost-editor（独立编辑器窗口，static/boost-editor.html + page.js）跟随「外观」设置 plugins.Spaces.mode。
 * 之前：该页链了 sidepanel.css（有 [data-theme] 规则），但 page 上下文里没有任何东西写 data-theme（Themes 插件只在 panel 上下文跑）→ 永远跟系统，mode 钉住无效。
 * 现在：① 页面 <head> 同步引用补丁 3b 的 options-theme-head.js（缓存里钉住的 light / dark 在首次 paint 前写 data-theme，复用，不新增构建入口）；
 *       ② page 上下文启动时 followAppearance：按 appearanceMode()（Themes 功能关 = auto）写 / 去掉 data-theme，并订阅系统与设置变化。
 * 无 DOM：这里测纯逻辑（可注入）+ 接线（源码约束）；真实 Chrome 的 getComputedStyle / 首帧见 headed-scripts/boost-editor-mode-cdp.ts（HEADLESS=1）。 */
import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const src = (f: string) => readFileSync(resolve(ROOT, f), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const load = () => import("../src/plugins/boosts/editorTheme");
type Mode = "auto" | "light" | "dark";
const mkRoot = (theme?: string) => ({ dataset: (theme === undefined ? {} : { theme }) as DOMStringMap });
const mkDeps = (init: { mode: Mode; sysDark?: boolean }) => {
    const st = { mode: init.mode, mq: { matches: !!init.sysDark, ls: new Set<() => void>() }, settingsLs: new Set<() => void>() };
    const mq = { get matches() { return st.mq.matches; }, addEventListener: (_t: "change", l: () => void) => { st.mq.ls.add(l); }, removeEventListener: (_t: "change", l: () => void) => { st.mq.ls.delete(l); } };
    return {
        st,
        deps: { mode: () => st.mode, mq, onSettings: (l: () => void) => { st.settingsLs.add(l); return () => { st.settingsLs.delete(l); }; } },
        setMode: (m: Mode) => { st.mode = m; for (const l of st.settingsLs) l(); },
        setSystem: (d: boolean) => { st.mq.matches = d; for (const l of st.mq.ls) l(); },
    };
};

describe("followAppearance：启动时按 mode 写 data-theme", () => {
    test("light / dark 钉住 → data-theme = mode（与系统无关）", async () => {
        const { followAppearance } = await load();
        for (const sys of [true, false]) for (const m of ["light", "dark"] as const) {
            const r = mkRoot(); const d = mkDeps({ mode: m, sysDark: sys }); followAppearance(r, d.deps);
            expect(r.dataset.theme).toBe(m);
        }
    });
    test("auto → 不写 data-theme（跟系统由 sidepanel.css 的 @media 负责）；残留的旧值被去掉", async () => {
        const { followAppearance } = await load();
        const r1 = mkRoot(); followAppearance(r1, mkDeps({ mode: "auto", sysDark: true }).deps); expect(r1.dataset.theme).toBeUndefined();
        const r2 = mkRoot("dark"); followAppearance(r2, mkDeps({ mode: "auto" }).deps); expect(r2.dataset.theme).toBeUndefined(); // 首帧缓存过期 → 以设置为准纠正
    });
    test("缓存过期：首帧脚本写了 dark，设置是 light → 纠正为 light", async () => {
        const { followAppearance } = await load(); const r = mkRoot("dark");
        followAppearance(r, mkDeps({ mode: "light", sysDark: true }).deps); expect(r.dataset.theme).toBe("light");
    });
});

describe("followAppearance：运行中跟随（不重载，只改属性）", () => {
    test("mode 在 auto / light / dark 间切：data-theme 立即跟变", async () => {
        const { followAppearance } = await load(); const r = mkRoot(); const d = mkDeps({ mode: "auto", sysDark: true }); followAppearance(r, d.deps);
        d.setMode("light"); expect(r.dataset.theme).toBe("light");
        d.setMode("dark"); expect(r.dataset.theme).toBe("dark");
        d.setMode("auto"); expect(r.dataset.theme).toBeUndefined();
    });
    test("系统明暗翻转：auto 不写 data-theme（交给 @media）；钉住的不动", async () => {
        const { followAppearance } = await load();
        const a = mkRoot(); const da = mkDeps({ mode: "auto", sysDark: false }); followAppearance(a, da.deps); da.setSystem(true); expect(a.dataset.theme).toBeUndefined();
        const p = mkRoot(); const dp = mkDeps({ mode: "light", sysDark: false }); followAppearance(p, dp.deps); dp.setSystem(true); expect(p.dataset.theme).toBe("light");
    });
    test("返回的取消函数摘掉两处订阅；之后不再写", async () => {
        const { followAppearance } = await load(); const r = mkRoot(); const d = mkDeps({ mode: "auto" }); const off = followAppearance(r, d.deps);
        expect(d.st.mq.ls.size).toBe(1); expect(d.st.settingsLs.size).toBe(1);
        off(); expect(d.st.mq.ls.size).toBe(0); expect(d.st.settingsLs.size).toBe(0);
        d.setMode("dark"); expect(r.dataset.theme).toBeUndefined();
    });
});

describe("followAppearance：读的是真实设置 plugins.Spaces.mode（Themes 功能关 = auto）", () => {
    afterEach(async () => { const { Settings } = await import("../src/api/Settings"); delete Settings.plugins.Spaces; delete Settings.plugins.Themes; });
    test("默认依赖：Spaces.mode = dark → dark；Themes:false → auto；plugins.Themes.mode 这个键不读", async () => {
        const { followAppearance } = await load(); const { Settings } = await import("../src/api/Settings"); const { appearanceMode } = await import("../src/api/Appearance");
        const d = mkDeps({ mode: "auto" }); const deps = { ...d.deps, mode: appearanceMode };
        Settings.plugins.Themes = { mode: "light" }; Settings.plugins.Spaces = { mode: "dark" };
        const r1 = mkRoot(); followAppearance(r1, deps); expect(r1.dataset.theme).toBe("dark");
        Settings.plugins.Spaces = { mode: "dark", Themes: false };
        const r2 = mkRoot(); followAppearance(r2, deps); expect(r2.dataset.theme).toBeUndefined();
        delete Settings.plugins.Spaces;
        const r3 = mkRoot(); followAppearance(r3, deps); expect(r3.dataset.theme).toBeUndefined();
    });
});

describe("接线（源码约束）", () => {
    test("static/boost-editor.html：<head> 里有同步 classic 脚本 options-theme-head.js，在样式表之前；仍链 sidepanel.css；无内联脚本；page.js 不变且不加载 sidepanel.js", () => {
        const html = src("static/boost-editor.html"); const head = html.slice(html.indexOf("<head>"), html.indexOf("</head>"));
        const tag = head.match(/<script\b[^>]*options-theme-head\.js[^>]*>/)?.[0] ?? "";
        expect(tag).not.toBe(""); expect(tag).not.toMatch(/\b(defer|async)\b|type\s*=\s*["']?module/);
        expect(head.indexOf("options-theme-head.js")).toBeLessThan(head.indexOf('href="sidepanel.css"'));
        expect(head.indexOf('href="sidepanel.css"')).toBeGreaterThan(0);
        expect(html.match(/<script\b(?![^>]*\bsrc=)[^>]*>/g)).toBeNull();
        expect(html).toContain('<script src="page.js"></script>'); expect(html).not.toContain("sidepanel.js");
    });
    test("没有新增构建入口：build.ts 里 options-theme-head 只出现一次（补丁 3b 已有，本补丁复用）", () => {
        expect((src("build.ts").match(/"options-theme-head"/g) ?? []).length).toBe(1);
    });
    test("boosts/index.ts page.start：先判 pathname，再 followAppearance（在 await boostStore.ready 之前），卸载时一并取消", () => {
        const s = strip(src("src/plugins/boosts/index.ts")); const i = s.indexOf("page: {"); const body = s.slice(i, i + 700);
        const p = body.indexOf('endsWith("/boost-editor.html")'), f = body.indexOf("followAppearance("), r = body.indexOf("await boostStore.ready");
        expect(p).toBeGreaterThan(0); expect(f).toBeGreaterThan(p); expect(r).toBeGreaterThan(f);
        expect(body).toContain("mountEditorPage("); expect(s).toMatch(/import \{ followAppearance \} from "\.\/editorTheme"/);
    });
    test("editorTheme.ts：只复用 Appearance.ts 的 appearanceMode / applyThemeAttr / watchAppearance；不含任何色值", () => {
        const e = strip(src("src/plugins/boosts/editorTheme.ts"));
        expect(e).toContain("appearanceMode"); expect(e).toContain("applyThemeAttr"); expect(e).toContain("watchAppearance"); expect(e).toContain("@api/Appearance");
        expect(e).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
    });
    test("bootstrap 里 page 上下文仍会 mirrorAppearanceCache（缓存由它写，head 脚本读）", () => {
        const s = strip(src("src/ArcSidebar.ts")); expect(s).toMatch(/ctx !== "background" && ctx !== "content"\) mirrorAppearanceCache\(\)/);
    });
});

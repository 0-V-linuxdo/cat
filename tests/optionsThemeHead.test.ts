/* 补丁 system-color-scheme/3b：设置页「钉住模式」的首帧——<head> 里一个同步的 classic 脚本读 localStorage 缓存的模式，写 data-theme，
 * 赶在首次 paint 之前（options.js 是大包，执行在首帧之后）。auto 不写、行为不变。
 * 缓存 = localStorage["cat-appearance-mode"]（扩展页面同源共享）：每个扩展 UI 上下文（bootstrap）在设置变化时同步写；auto = 删除该键。
 * 无 DOM：这里测纯逻辑（可注入存储）+ 接线（源码约束）；真实首帧（data-theme 写入时刻 < first-paint）见 headed-scripts/ 的 headless 实跑。 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const src = (f: string) => readFileSync(resolve(ROOT, f), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const loadCache = () => import("../src/api/AppearanceCache");
const mkStore = (init: Record<string, string> = {}, throws = false) => {
    const m = new Map(Object.entries(init));
    return { m, getItem: (k: string) => { if (throws) throw new Error("denied"); return m.get(k) ?? null; }, setItem: (k: string, v: string) => { if (throws) throw new Error("denied"); m.set(k, v); }, removeItem: (k: string) => { if (throws) throw new Error("denied"); m.delete(k); } };
};
const mkRoot = () => ({ dataset: {} as DOMStringMap });

describe("AppearanceCache：缓存读 / 写 / 首帧套用", () => {
    test("写：light / dark 存起来；auto 删除该键（= 不钉）", async () => {
        const { writeAppearanceCache, APPEARANCE_CACHE_KEY } = await loadCache(); const s = mkStore();
        writeAppearanceCache("dark", s); expect(s.m.get(APPEARANCE_CACHE_KEY)).toBe("dark");
        writeAppearanceCache("light", s); expect(s.m.get(APPEARANCE_CACHE_KEY)).toBe("light");
        writeAppearanceCache("auto", s); expect(s.m.has(APPEARANCE_CACHE_KEY)).toBe(false);
    });
    test("首帧套用：缓存 light / dark → 写 data-theme；auto / 无 / 脏值 → 什么都不写（与补丁前一致）", async () => {
        const { applyCachedTheme, APPEARANCE_CACHE_KEY: K } = await loadCache();
        for (const v of ["light", "dark"] as const) { const r = mkRoot(); expect(applyCachedTheme(r, mkStore({ [K]: v }))).toBe(v); expect(r.dataset.theme).toBe(v); }
        for (const v of [undefined, "auto", "", "Dark", "1"]) { const r = mkRoot(); expect(applyCachedTheme(r, mkStore(v === undefined ? {} : { [K]: v }))).toBeNull(); expect(r.dataset.theme).toBeUndefined(); }
    });
    test("存储不可用 / 抛错：不抛、不写", async () => {
        const { applyCachedTheme, writeAppearanceCache } = await loadCache(); const r = mkRoot();
        expect(() => applyCachedTheme(r, mkStore({}, true))).not.toThrow(); expect(r.dataset.theme).toBeUndefined();
        expect(() => applyCachedTheme(r, null)).not.toThrow();
        expect(() => writeAppearanceCache("dark", mkStore({}, true))).not.toThrow(); expect(() => writeAppearanceCache("dark", null)).not.toThrow();
    });
    test("AppearanceCache.ts 自己不 import 任何模块（head 脚本包要尽量小、同步）", () => {
        expect(strip(src("src/api/AppearanceCache.ts"))).not.toMatch(/^\s*import\s/m);
    });
});

describe("mirrorAppearanceCache：设置变化时同步写缓存（每个扩展 UI 上下文）", () => {
    test("先写一次当前模式；设置变化再写；取消后不再写", async () => {
        const { mirrorAppearanceCache } = await import("../src/api/Appearance"); const { APPEARANCE_CACHE_KEY: K } = await loadCache();
        const s = mkStore(); let mode: "auto" | "light" | "dark" = "dark"; let fire: () => void = () => { };
        const off = mirrorAppearanceCache({ mode: () => mode, storage: s, onSettings: l => { fire = l; return () => { fire = () => { }; }; } });
        expect(s.m.get(K)).toBe("dark");
        mode = "light"; fire(); expect(s.m.get(K)).toBe("light");
        mode = "auto"; fire(); expect(s.m.has(K)).toBe(false);
        off(); mode = "dark"; fire(); expect(s.m.has(K)).toBe(false);
    });
    test("没有可用存储（内容脚本里是网页自己的 localStorage，不碰）→ 不订阅、不写", async () => {
        const { mirrorAppearanceCache } = await import("../src/api/Appearance"); let subscribed = false;
        mirrorAppearanceCache({ mode: () => "dark", storage: null, onSettings: () => { subscribed = true; return () => { }; } });
        expect(subscribed).toBe(false);
    });
    test("真实依赖只在 chrome-extension: 协议下取 localStorage（源码约束）", () => {
        const a = strip(src("src/api/Appearance.ts"));
        expect(a).toContain('location.protocol === "chrome-extension:"'); expect(a).toContain("mirrorAppearanceCache");
    });
});

describe("接线（源码约束）", () => {
    test("static/options.html：<head> 里有同步 classic 脚本 options-theme-head.js，在样式表之前；不是 module / defer / async；没有内联脚本（扩展 CSP）", () => {
        const html = src("static/options.html"); const head = html.slice(html.indexOf("<head>"), html.indexOf("</head>"));
        const tag = head.match(/<script\b[^>]*options-theme-head\.js[^>]*>/)?.[0] ?? "";
        expect(tag).not.toBe(""); expect(tag).not.toMatch(/\b(defer|async)\b|type\s*=\s*["']?module/);
        expect(head.indexOf("options-theme-head.js")).toBeLessThan(head.indexOf('href="sidepanel.css"'));
        expect(head.match(/<script\b(?![^>]*\bsrc=)[^>]*>/g)).toBeNull();
        expect(html).toContain('<script src="options.js"></script>'); // 原有主包不变
    });
    test("build.ts 新增入口 options-theme-head；入口文件只做 applyCachedTheme", () => {
        expect(src("build.ts")).toContain('"options-theme-head"');
        const e = strip(src("src/entries/options-theme-head.ts"));
        expect(e).toContain("applyCachedTheme(document.documentElement"); expect(e.match(/^\s*import\s/gm)?.length).toBe(1); expect(e).toContain("@api/AppearanceCache");
    });
    test("bootstrap：扩展 UI 上下文（非 background / content）调用 mirrorAppearanceCache，且在 initSettings 之后", () => {
        const s = strip(src("src/ArcSidebar.ts")); const i = s.indexOf("await initSettings()"), j = s.indexOf("mirrorAppearanceCache(");
        expect(i).toBeGreaterThan(0); expect(j).toBeGreaterThan(i);
        expect(s.slice(j - 80, j)).toMatch(/ctx !== "background" && ctx !== "content"/);
    });
    test("options.ts 的既有逻辑不变：earlyAppearance 兜底仍在（缓存缺失 / 过期时由它与 bootstrap 后的 applyThemeAttr 纠正）", () => {
        const o = strip(src("src/entries/options.ts"));
        expect(o).toContain("earlyAppearance("); expect(o).toContain("applyThemeAttr(document.documentElement, appearanceMode())");
    });
});

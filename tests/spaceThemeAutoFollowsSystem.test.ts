import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveSpaceScheme } from "../src/plugins/spaces/themes/scheme";
import * as logic from "../src/plugins/inpageSidebar/logic";
import * as early from "../src/plugins/inpageSidebar/earlyShow";

/* 补丁 system-color-scheme/4：scheme=auto 的自定义 Space 主题明暗跟系统。
 * 之前：auto 按「主色 + 底色」对比度（prefersLightText）决定明暗并把 data-theme 钉成 dark / light → 系统变了不跟（用户抱怨）。
 * 现在：auto 跟全局 mode（mode=auto → data-theme="auto" 不钉死）；显式浅 / 深钉死。
 * 无 DOM：这里测纯函数 + 接线（源码约束）+ 与补丁 1（follow / fw）的耦合；真实渲染 / 切系统明暗要 headed（README「待 headed」）。 */
const ROOT = resolve(import.meta.dir, "..");
const src = (f: string) => readFileSync(resolve(ROOT, f), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const L = logic as unknown as Record<string, (...a: unknown[]) => unknown>;
const E = early as unknown as Record<string, (...a: unknown[]) => unknown>;

describe("resolveSpaceScheme：自定义 auto 跟全局 mode；显式浅 / 深钉死", () => {
    test("自定义 auto + mode=auto → 不钉死（theme=auto，follows），明暗 = 系统", () => {
        expect(resolveSpaceScheme("auto", "auto", true)).toEqual({ theme: "auto", dark: true, follows: true });
        expect(resolveSpaceScheme("auto", "auto", false)).toEqual({ theme: "auto", dark: false, follows: true });
    });
    test("自定义 auto + mode=light / dark → 钉成全局 mode，与系统无关（等同没有自定义主题的 Space）", () => {
        expect(resolveSpaceScheme("auto", "dark", false)).toEqual({ theme: "dark", dark: true, follows: false });
        expect(resolveSpaceScheme("auto", "light", true)).toEqual({ theme: "light", dark: false, follows: false });
    });
    test("显式 light / dark 钉死，不受 mode 与系统影响", () => {
        for (const mode of ["auto", "light", "dark"]) for (const sys of [true, false]) {
            expect(resolveSpaceScheme("light", mode, sys)).toEqual({ theme: "light", dark: false, follows: false });
            expect(resolveSpaceScheme("dark", mode, sys)).toEqual({ theme: "dark", dark: true, follows: false });
        }
    });
    test("没有自定义主题（undefined）= 只看全局 mode；未知 / 缺省值按 auto（Themes 关掉 = auto）", () => {
        expect(resolveSpaceScheme(undefined, "dark", false).theme).toBe("dark");
        expect(resolveSpaceScheme(undefined, undefined, true)).toEqual({ theme: "auto", dark: true, follows: true });
        expect(resolveSpaceScheme("weird", "weird", false)).toEqual({ theme: "auto", dark: false, follows: true });
    });
});

describe("接线（源码约束）：themes/index.ts", () => {
    const t = strip(src("src/plugins/spaces/themes/index.ts"));
    test("明暗只由 resolveSpaceScheme 决定；不再用对比度（prefersLightText）钉死", () => {
        expect(t).toContain("resolveSpaceScheme(custom?.scheme, settings.store.mode, systemDark())");
        expect(t).not.toContain("prefersLightText");
        expect(t).not.toContain('dark ? "dark" : "light"');
    });
    test("data-theme 只在 apply() 里写一处（避免两路写成不同值）", () => {
        expect(t.match(/root\.dataset\.theme\s*=/g)?.length).toBe(1);
        expect(t).toContain("root.dataset.theme = sc.theme");
    });
    test("系统明暗变化仍由既有 matchMedia 监听触发 apply（实时重算；不重载）；设置变化仍 apply", () => {
        expect(t).toContain('mq.addEventListener("change", apply)');
        expect(t).toContain('mq.removeEventListener("change", apply)');
        expect(t).toContain("onSettingsChange: apply");
        expect(t).not.toMatch(/location\.reload|\.reload\(\)/);
    });
    test("gradient.ts 的 prefersLightText 保留（gradient.test.ts 仍测；本补丁不改 gradient.ts）", () => {
        expect(src("src/plugins/spaces/themes/gradient.ts")).toContain("export function prefersLightText");
    });
    test("selftest 第 26 步不再期望 auto 主题钉成 light", () => {
        const line = src("src/selftest/selftest.ts").split("\n").find(l => l.includes("STEP = 26;")) ?? "";
        expect(line).toContain("creamFollows"); expect(line).not.toContain('R.dataset.theme === "light"');
        expect(src("src/selftest/selftest.ts")).not.toContain("creamLight");
    });
});

describe("与补丁 1（follow / fw）的耦合：data-theme=auto → 页内侧栏判成跟随；钉死 → 不跟", () => {
    test("followsSystem('light dark', data-theme)：auto = 跟随；light / dark = 钉死（补丁 1 已在主树）", () => {
        expect(L.followsSystem?.("light dark", "auto")).toBe(true);
        expect(L.followsSystem?.("light dark", "light")).toBe(false); expect(L.followsSystem?.("light dark", "dark")).toBe(false);
    });
    test("跟随 → frameColorScheme = 'light dark'；retargetFollow 按新系统重指；hint 带 fw（补丁 1 逻辑，本补丁依赖、不改）", () => {
        const dark = { base: "rgb(30, 32, 32)", scheme: "dark" as const, follow: true };
        expect(L.frameColorScheme?.(dark)).toBe("light dark");
        expect(L.frameColorScheme?.({ ...dark, follow: undefined })).toBe("dark");
        expect(typeof L.retargetFollow).toBe("function"); expect(typeof E.hintFromState).toBe("function"); expect(typeof E.hintTheme).toBe("function");
        const h = E.hintFromState?.({ st: { active: true, show: true, width: 300, windowId: 1, tabId: 1 }, theme: dark, blocked: false, visible: true, real: true }) as { fw?: boolean } | undefined;
        expect(h?.fw).toBe(true);
    });
});

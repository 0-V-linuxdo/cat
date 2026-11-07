/* 补丁 3：设置页（options）读「外观」设置（Themes.mode：auto = 跟系统，light / dark = 钉住）。
 * ⚠ 存储位置：Themes 是 Spaces 的功能插件（featureSettings），mode 存在 plugins.Spaces.mode（不是 plugins.Themes.mode；selftest.ts:2424 同注）。
 * 公共模块 src/api/Appearance.ts：parseMode / modeFrom / resolveDark / appearanceMode / applyThemeAttr / watchAppearance。 */
import { afterEach, describe, expect, test } from "bun:test";

const load = () => import("../src/api/Appearance");
const src = (p: string) => Bun.file(new URL(`../src/${p}`, import.meta.url)).text();

describe("模式解析", () => {
    test("parseMode：只认 light / dark，其余（含 auto、未设置、脏值）一律 auto", async () => {
        const { parseMode } = await load();
        expect(["light", "dark", "auto", undefined, null, "", "Dark", 1, {}].map(parseMode)).toEqual(["light", "dark", "auto", "auto", "auto", "auto", "auto", "auto", "auto"]);
    });
    test("modeFrom：读 Spaces 的设置包；Themes 功能被关掉 = 侧栏不写 data-theme = 跟系统", async () => {
        const { modeFrom } = await load();
        expect(modeFrom({ mode: "dark" })).toBe("dark");
        expect(modeFrom({ mode: "light", Themes: true })).toBe("light");
        expect(modeFrom({ mode: "dark", Themes: false })).toBe("auto");
        expect(modeFrom({})).toBe("auto");
        expect(modeFrom(undefined)).toBe("auto");
    });
    test("resolveDark：auto 跟系统，light / dark 钉住（与系统无关）", async () => {
        const { resolveDark } = await load();
        expect([resolveDark("auto", true), resolveDark("auto", false), resolveDark("dark", false), resolveDark("dark", true), resolveDark("light", true), resolveDark("light", false)])
            .toEqual([true, false, true, true, false, false]);
    });
});

describe("appearanceMode：读的是 plugins.Spaces.mode", () => {
    afterEach(async () => { const { Settings } = await import("../src/api/Settings"); delete Settings.plugins.Spaces; delete Settings.plugins.Themes; });
    test("Spaces.mode = dark → dark；plugins.Themes 这个键不是存储位置（即使有也不读）", async () => {
        const { appearanceMode } = await load(); const { Settings } = await import("../src/api/Settings");
        Settings.plugins.Themes = { mode: "light" };
        Settings.plugins.Spaces = { mode: "dark" };
        expect(appearanceMode()).toBe("dark");
        delete Settings.plugins.Spaces;
        expect(appearanceMode()).toBe("auto");
    });
});

describe("applyThemeAttr：设置页根上的 data-theme", () => {
    const mk = () => { const writes: string[] = []; const dataset = new Proxy({} as Record<string, string>, { set(t, k, v) { writes.push(`${String(k)}=${v}`); t[k as string] = v; return true; }, deleteProperty(t, k) { writes.push(`del ${String(k)}`); delete t[k as string]; return true; } }); return { root: { dataset }, writes }; };
    test("light / dark 钉住；auto 去掉（交给 CSS 的 @media，与补丁前一致）", async () => {
        const { applyThemeAttr } = await load(); const { root } = mk();
        applyThemeAttr(root, "dark"); expect(root.dataset.theme).toBe("dark");
        applyThemeAttr(root, "light"); expect(root.dataset.theme).toBe("light");
        applyThemeAttr(root, "auto"); expect(root.dataset.theme).toBeUndefined();
    });
    test("值没变就不写（不触发样式重算 / MutationObserver）", async () => {
        const { applyThemeAttr } = await load(); const { root, writes } = mk();
        applyThemeAttr(root, "dark"); applyThemeAttr(root, "dark"); applyThemeAttr(root, "auto"); applyThemeAttr(root, "auto");
        expect(writes).toEqual(["theme=dark", "del theme"]);
    });
});

describe("watchAppearance：运行中跟随（matchMedia change + 设置变化），只在「解析后的明暗 / 模式」变了才回调", () => {
    type L = () => void;
    const fakes = (init: { mode: "auto" | "light" | "dark"; dark: boolean }) => {
        const st = { ...init }; const mqL = new Set<L>(), setL = new Set<L>();
        const deps = {
            mode: () => st.mode,
            mq: { get matches() { return st.dark; }, addEventListener: (_: string, l: L) => mqL.add(l), removeEventListener: (_: string, l: L) => mqL.delete(l) },
            onSettings: (l: L) => { setL.add(l); return () => setL.delete(l); },
        };
        return { st, deps, mqL, setL, sys: (d: boolean) => { st.dark = d; for (const l of mqL) l(); }, setMode: (m: "auto" | "light" | "dark") => { st.mode = m; for (const l of setL) l(); } };
    };
    test("auto：系统切换 → 回调（mode=auto、dark 跟系统）", async () => {
        const { watchAppearance } = await load(); const f = fakes({ mode: "auto", dark: false }); const got: unknown[] = [];
        watchAppearance(s => got.push(s), f.deps);
        f.sys(true); f.sys(false);
        expect(got).toEqual([{ mode: "auto", dark: true }, { mode: "auto", dark: false }]);
    });
    test("强制深 / 浅：系统切换不回调（钉住）", async () => {
        const { watchAppearance } = await load(); const f = fakes({ mode: "dark", dark: false }); const got: unknown[] = [];
        watchAppearance(s => got.push(s), f.deps);
        f.sys(true); f.sys(false);
        expect(got).toEqual([]);
    });
    test("设置里改模式 → 回调；解析结果没变的重复通知不回调（不重复重绘）", async () => {
        const { watchAppearance } = await load(); const f = fakes({ mode: "auto", dark: true }); const got: unknown[] = [];
        watchAppearance(s => got.push(s), f.deps);
        f.setMode("light"); f.setMode("light"); f.setMode("auto"); f.setMode("dark");
        expect(got).toEqual([{ mode: "light", dark: false }, { mode: "auto", dark: true }, { mode: "dark", dark: true }]);
    });
    test("返回的取消函数把两处监听都摘掉", async () => {
        const { watchAppearance } = await load(); const f = fakes({ mode: "auto", dark: false }); const got: unknown[] = [];
        const stop = watchAppearance(s => got.push(s), f.deps);
        expect(f.mqL.size).toBe(1); expect(f.setL.size).toBe(1);
        stop(); expect(f.mqL.size).toBe(0); expect(f.setL.size).toBe(0);
        f.sys(true); expect(got).toEqual([]);
    });
});

describe("设置页接线（源码约束）", () => {
    test("options.ts：用 Appearance 模块——启动即应用（先于 bootstrap 完成）+ 运行中跟随；不重载", async () => {
        const s = await src("entries/options.ts");
        expect(s).toMatch(/from "@api\/Appearance"/);
        expect(s).toMatch(/watchAppearance\(/);
        expect(s).toMatch(/applyThemeAttr\(/);
        expect(s).toMatch(/earlyAppearance\(/);
        expect(s).not.toMatch(/location\.reload|\.replaceWith\(document/);
    });
    test("options.ts：early 在 bootstrap 之前调用（首帧）", async () => {
        const s = await src("entries/options.ts");
        const a = s.indexOf("earlyAppearance("), b = s.indexOf('bootstrap("options")');
        expect(a).toBeGreaterThan(-1); expect(b).toBeGreaterThan(-1); expect(a).toBeLessThan(b);
    });
    test("Appearance.ts：不新增色值、不重载", async () => {
        const s = (await src("api/Appearance.ts")).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
        expect(s).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
        expect(s).not.toMatch(/location\.reload|innerHTML/);
    });
});

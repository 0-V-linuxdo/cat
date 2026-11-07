import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import * as early from "../src/plugins/inpageSidebar/earlyShow";
import { FLAT_BASE, MSG } from "../src/plugins/inpageSidebar/constants";
import * as logic from "../src/plugins/inpageSidebar/logic";

/* 补丁 system-color-scheme/1：页内侧栏跟随系统明暗。
 * 根因（INVESTIGATION.md §1.3，headless Chrome 156 实测）：宿主把 iframe 的行内 color-scheme 钉成回报的 light / dark 单值，
 * Chrome 把「内嵌元素的单值 color-scheme」当成 iframe 内文档的 prefers-color-scheme → 系统明暗再变，iframe 内 matchMedia 不变、不回报，宿主 --bg 也不更新；
 * hint 里存的上一次 scheme 在首帧同样把 iframe 钉在旧明暗。
 * 修法：iframe 回报 follow（根 color-scheme 同时支持 light 与 dark = 跟系统）→ 宿主给 iframe 设 "light dark"；强制明暗才钉单值；hint 带 fw；hint 与系统不一致首帧回退 FLAT_BASE；宿主自己监听系统切换。
 * 这里只测纯逻辑 + 接线（源码约束）；真实渲染 / 运行中切系统明暗要 headed（headed-scripts/，未运行）。 */
const DIR = resolve(import.meta.dir, "../src/plugins/inpageSidebar");
const src = (f: string) => readFileSync(resolve(DIR, f), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const L = logic as unknown as Record<string, (...a: unknown[]) => unknown>;
const E = early as unknown as Record<string, (...a: unknown[]) => unknown>;
const THEME = { base: "rgb(30, 32, 32)", scheme: "dark" as const };

describe("logic：follow 的判定 / 解析 / 宿主 color-scheme", () => {
    test("followsSystem：根 color-scheme 同时含 light 与 dark（且不是 only …）= 跟系统；单值 / only = 强制", () => {
        expect(L.followsSystem?.("light dark")).toBe(true); expect(L.followsSystem?.("dark light")).toBe(true);
        expect(L.followsSystem?.("normal")).toBe(false); expect(L.followsSystem?.("light")).toBe(false); expect(L.followsSystem?.("dark")).toBe(false);
        expect(L.followsSystem?.("only light")).toBe(false); expect(L.followsSystem?.("light dark only")).toBe(false); expect(L.followsSystem?.(undefined)).toBe(false);
    });
    test("followsSystem(cs, data-theme)：data-theme 强制 light / dark = 不跟系统（sidepanel.css 只有 [data-theme=dark] 写了 color-scheme，强制 light 时根 color-scheme 仍是 light dark，不能据此判成跟系统）；auto / 无 = 看 color-scheme", () => {
        expect(L.followsSystem?.("light dark", "light")).toBe(false); expect(L.followsSystem?.("light dark", "dark")).toBe(false);
        expect(L.followsSystem?.("light dark", "auto")).toBe(true); expect(L.followsSystem?.("light dark", undefined)).toBe(true); expect(L.followsSystem?.("dark", "auto")).toBe(false);
    });
    test("reportedScheme：强制 light 时回报 light（不随系统）；其余 = usedScheme", () => {
        expect(L.reportedScheme?.("light dark", "light", true)).toBe("light"); expect(L.reportedScheme?.("light dark", "light", false)).toBe("light");
        expect(L.reportedScheme?.("light dark", "auto", true)).toBe("dark"); expect(L.reportedScheme?.("light dark", undefined, false)).toBe("light");
        expect(L.reportedScheme?.("dark", "dark", false)).toBe("dark");
    });
    test("parseFrameTheme：follow 只认布尔 true；缺省 / 非布尔 = 不带该字段（旧回报形状不变）", () => {
        const base = { type: MSG.frameTheme, base: "#1e2020", scheme: "dark" };
        expect(logic.parseFrameTheme({ ...base, follow: true })).toEqual({ base: "rgb(30, 32, 32)", scheme: "dark", follow: true });
        expect(logic.parseFrameTheme({ ...base, follow: "yes" })).toEqual({ base: "rgb(30, 32, 32)", scheme: "dark" });
        expect(logic.parseFrameTheme({ ...base, follow: false })).toEqual({ base: "rgb(30, 32, 32)", scheme: "dark" });
        expect(logic.parseFrameTheme(base)).toEqual({ base: "rgb(30, 32, 32)", scheme: "dark" });
        expect(logic.parseFrameTheme({ ...base, follow: true, bar: "rgb(1, 2, 3)" })).toEqual({ base: "rgb(30, 32, 32)", scheme: "dark", follow: true, bar: "rgb(1, 2, 3)" });
    });
    test("frameColorScheme：follow 时必须同时含 light 与 dark；强制明暗才是单值", () => {
        const f = String(L.frameColorScheme?.({ ...THEME, follow: true })); expect(f.split(/\s+/).toSorted()).toEqual(["dark", "light"]);
        expect(String(L.frameColorScheme?.({ base: "rgb(236, 233, 241)", scheme: "light", follow: true })).split(/\s+/).toSorted()).toEqual(["dark", "light"]); // 与当前 scheme 无关
        expect(L.frameColorScheme?.(THEME)).toBe("dark"); expect(L.frameColorScheme?.({ base: "rgb(236, 233, 241)", scheme: "light" })).toBe("light");
    });
    test("retargetFollow：follow 且回报的 scheme ≠ 当前系统 → 立刻换成当前系统的 FLAT_BASE（不带旧 bar）；一致 / 强制 = 原对象", () => {
        const t = { ...THEME, follow: true as const, bar: "rgb(0, 255, 255)" };
        expect(L.retargetFollow?.(t, false)).toEqual({ base: FLAT_BASE.light, scheme: "light", follow: true });
        expect(L.retargetFollow?.(t, true)).toBe(t);
        expect(L.retargetFollow?.({ base: FLAT_BASE.light, scheme: "light", follow: true }, true)).toEqual({ base: FLAT_BASE.dark, scheme: "dark", follow: true });
        expect(L.retargetFollow?.(THEME, false)).toBe(THEME); // 强制深色（Themes.mode = dark）：系统变了也不动
    });
});

describe("earlyShow：hint 带 fw；hint 的 scheme 与当前系统不一致 → 首帧用 FLAT_BASE", () => {
    const GOOD = { v: 1 as const, show: true, width: 300, base: "rgb(30, 32, 32)", scheme: "dark" as const, win: 7, tab: 9 };
    test("parseHint：fw 只认 true，且必须与 base / scheme 成对；其它丢弃", () => {
        expect(early.parseHint({ ...GOOD, fw: true })).toEqual({ ...GOOD, fw: true });
        expect(early.parseHint({ ...GOOD, fw: "1" })).toEqual(GOOD); expect(early.parseHint({ ...GOOD, fw: false })).toEqual(GOOD);
        expect(early.parseHint({ v: 1, show: true, width: 300, fw: true })).toEqual({ v: 1, show: true, width: 300 });
    });
    test("hintFromState：theme.follow → fw: true；强制 = 不带 fw", () => {
        const st = { active: true, show: true, width: 300, windowId: 7, tabId: 9 };
        expect(early.hintFromState({ st, theme: { ...THEME, follow: true }, blocked: false, visible: true, real: true })).toMatchObject({ fw: true, scheme: "dark" });
        expect("fw" in early.hintFromState({ st, theme: THEME, blocked: false, visible: true, real: true })!).toBe(false);
    });
    test("sameHint / withoutIds 认 fw", () => {
        expect(early.sameHint({ ...GOOD, fw: true }, GOOD)).toBe(false); expect(early.sameHint({ ...GOOD, fw: true }, { ...GOOD, fw: true })).toBe(true);
        expect(early.withoutIds({ ...GOOD, fw: true })).toMatchObject({ fw: true }); expect("fw" in early.withoutIds(GOOD)).toBe(false);
    });
    test("hintTheme：fw 且 scheme ≠ 系统 → FLAT_BASE[系统]（不用旧 base）；fw 且一致 → hint 原值 + follow；无 fw → 原值不动（强制 / 旧 hint）；无 base = undefined", () => {
        const dark = { ...GOOD, fw: true as const };
        expect(E.hintTheme?.(dark, false)).toEqual({ base: FLAT_BASE.light, scheme: "light", follow: true }); // 系统浅 + hint 记的深：首帧必须浅
        expect(E.hintTheme?.({ ...GOOD, base: "rgb(236, 233, 241)", scheme: "light", fw: true }, true)).toEqual({ base: FLAT_BASE.dark, scheme: "dark", follow: true }); // 系统深 + hint 记的浅
        expect(E.hintTheme?.(dark, true)).toEqual({ base: "rgb(30, 32, 32)", scheme: "dark", follow: true });
        expect(E.hintTheme?.(GOOD, false)).toEqual({ base: "rgb(30, 32, 32)", scheme: "dark" }); // 没有 fw = 强制 / 旧 hint：照旧
        expect(E.hintTheme?.({ v: 1, show: true, width: 300 }, true)).toBeUndefined();
    });
});

describe("接线（源码约束）", () => {
    const c = strip(src("content.ts"));
    test("content.ts：iframe 的 color-scheme 一律经 frameColorScheme（不得再直接 = theme.scheme）；建 iframe 时与 applyBg 各一处", () => {
        expect(c).not.toMatch(/colorScheme\s*=\s*theme\.scheme/);
        expect(c.match(/style\.colorScheme = frameColorScheme\(theme\)/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    });
    test("content.ts：宿主自己监听系统明暗（change → onOsScheme），卸载时移除；onOsScheme 只重算主题 + 写 --bg，不重建 / 不重载 iframe、不重渲染", () => {
        expect(c).toMatch(/matchMedia\("\(prefers-color-scheme: dark\)"\)/); expect(c).toMatch(/addEventListener\("change", onOsScheme\)/); expect(c).toMatch(/removeEventListener\("change", onOsScheme\)/);
        const m = /const onOsScheme = \(\) => \{([\s\S]*?)\n    \};|const onOsScheme = \(\) => \{([^\n]*)\};/.exec(c); const body = (m?.[1] ?? m?.[2] ?? "");
        expect(body).toMatch(/retargetFollow\(/); expect(body).toMatch(/applyBg\(\)/);
        for (const bad of [/destroyFrame/, /ensureFrame/, /\.src\b/, /createElement/, /\brender\(/, /location\./]) expect(body).not.toMatch(bad);
    });
    test("content.ts：applyHint 用 hintTheme（按当前系统校正 fw 提示），不再直接 { base: h.base, scheme: h.scheme }", () => {
        expect(c).toMatch(/hintTheme\(h, osDark\(\)\)/); expect(c).not.toMatch(/theme = \{ base: h\.base, scheme: h\.scheme \}/);
    });
    test("panel.ts：回报带 follow（来自根 color-scheme 计算值），并进入去重 key；logic 的 followsSystem 是唯一判定", () => {
        const p = strip(src("panel.ts"));
        expect(p).toMatch(/followsSystem\(getComputedStyle\(root\)\.colorScheme, root\.dataset\.theme\)/); expect(p).toMatch(/reportedScheme\(getComputedStyle\(root\)\.colorScheme, root\.dataset\.theme, mq\.matches\)/); expect(p).not.toMatch(/scheme = usedScheme\(/); expect(p).toMatch(/follow/); expect(p).toMatch(/const key = `[^`]*\$\{follow\}/);
        expect(p).toMatch(/postMessage\(\{ type: MSG\.frameTheme, base, scheme,[^\n]*follow/);
    });
});

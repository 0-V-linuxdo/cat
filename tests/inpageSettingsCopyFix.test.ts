/* 补丁 inpage-settings-copy-fix（真机验收 53889 第 3 项）：设置页 warm-up 下拉按钮「Window: Chrome panel ...」被省略号截断，且验收里「^S」看起来不是 ⌃S。
 * 结论（静态 + 8× 截图放大）：① 码点本来就是 U+2303（⌃）——源码 i18n.ts 与 dist 打包里都是；「^」是 macOS 系统字体把 ⌃ 画成上抬的小尖角，不是文案错；这里把码点钉死（U+2303 / ⌘ U+2318），防以后被改成 ASCII「^」。
 * ② 截断：按钮是单行省略号、控件列 160–200px，window 项整句 zh 342px / en 450px 放不下；tooltip（inpage-select-title）已补，但按钮上仍只看到「Window: Chrome panel ...」。
 *    修法（不改布局）：选项可带 short（i18n 键），**按钮文字**用 short，菜单项与 data-tip 仍是整句（⌃S / ⌘R 的说明都还在）。没有 short 的选项与以前完全一致。
 * fail-first：18b 基线上 B（3 条）与 C 失败（没有 short 键、没有 dropdownButtonLabel）；A（码点）与「off 无 short」是锁定项，基线上本来就过。 */
import { describe, expect, test } from "bun:test";

import * as Menu from "../src/components/Menu";
import { buildStrings } from "../src/plugins/inpageSidebar/i18n";
import { settings } from "../src/plugins/inpageSidebar/settings";

type Opt = { label: string; short?: string; value: string };
const opts = (settings.def as unknown as Record<string, { options: Opt[] }>).prewarm!.options;
const win = opts.find(o => o.value === "window")!;
const S = (mac: boolean, L: "en" | "zh") => buildStrings(mac)[L] as Record<string, string>;
/** 保守宽度估计（13px 字体）：CJK / 全角 13px，其它 7px；按钮可用宽 = 控件 200 − 内边距 20 − 箭头 16 − 间距 6 = 158（窄屏 160 → 118，不在本补丁范围） */
const est = (s: string) => [...s].reduce((w, c) => w + (/[\u2e80-\u9fff\uff00-\uffef]/.test(c) ? 13 : 7), 0);
const AVAIL = 158;

describe("A) 码点：⌃ = U+2303、⌘ = U+2318，Mac 文案里没有 ASCII「^」当修饰键", () => {
    test("Mac：SW=⌃S（U+2303 + S）、RL=⌘R（U+2318 + R）；非 Mac：Alt+S / Ctrl+R", () => {
        for (const L of ["en", "zh"] as const) {
            const m = S(true, L), o = S(false, L);
            for (const k of ["inpageSidebar.prewarm.detail", "inpageSidebar.prewarm.window"]) {
                expect(m[k]).toContain("\u2303S"); expect(m[k]).toContain("\u2318R"); expect(m[k]).not.toMatch(/\^S/); expect(m[k]).not.toContain("Alt+S");
                expect(o[k]).toContain("Alt+S"); expect(o[k]).toContain("Ctrl+R"); expect(o[k]).not.toContain("\u2303");
            }
        }
    });
});

describe("B) 短标签：按钮放得下，整句仍在菜单项 / tooltip", () => {
    test("window 项带 short，en / zh 两种语言、两种平台都有这条文案，且与整句不同", () => {
        expect(win.short).toBe("inpageSidebar.prewarm.window.short");
        for (const mac of [true, false]) for (const L of ["en", "zh"] as const) {
            const t = S(mac, L)[win.short!]; expect(typeof t).toBe("string"); expect(t!.length).toBeGreaterThan(4); expect(t).not.toBe(S(mac, L)[win.label]);
        }
    });
    test("短标签在按钮可用宽（≈158px）内放得下；整句放不下（这才是要短标签的原因）", () => {
        for (const L of ["en", "zh"] as const) { expect(est(S(true, L)[win.short!]!)).toBeLessThanOrEqual(AVAIL); expect(est(S(true, L)[win.label]!)).toBeGreaterThan(AVAIL); }
    });
    test("短标签仍说清「窗口级 + Chrome 侧边栏」（含 Chrome），且不含快捷键（快捷键说明留在整句 / detail 里）", () => {
        for (const L of ["en", "zh"] as const) { const t = S(true, L)[win.short!]!; expect(t).toContain("Chrome"); expect(t).not.toMatch(/[\u2303\u2318]|Alt\+|Ctrl\+/); }
        expect(S(true, "en")[win.short!]).toBe("Window: Chrome"); // 补丁 inpage-settings-copy-fix-2：原 "Window: Chrome panel" 去掉 " panel"（窄屏放不下）
    });
    /* 补丁 inpage-settings-copy-fix-2（headed 复测 r58o：≤760px 控件列 --opt-control-w 160px → 按钮可用宽 = 160 − 内边距 20 − 间距 6 − 箭头 14 = 120px；
     * 旧短标签实测 en "Window: Chrome panel" / zh "窗口级：Chrome 侧边栏" 都是 143px → 600/700/760px 两种语言仍被截）。
     * 估计量 est 对这两句偏低约 2%（en 估 140 实测 143；zh 估 140 实测 143），所以窄屏断言乘 1.1 的安全系数。 */
    test("窄屏（≤760px，按钮可用宽 120px）：短标签 × 1.1 安全系数仍放得下（旧 143px 的两句都放不下）", () => {
        const NARROW = 120;
        for (const mac of [true, false]) for (const L of ["en", "zh"] as const) expect(est(S(mac, L)[win.short!]!) * 1.1).toBeLessThanOrEqual(NARROW);
        for (const old of ["Window: Chrome panel", "窗口级：Chrome 侧边栏"]) expect(est(old) * 1.1).toBeGreaterThan(NARROW); // 判据确实能拦住旧文案
    });
    test("off 项没有 short（保持原样）", () => { expect(opts.find(o => o.value === "off")!.short).toBeUndefined(); });
});

describe("C) dropdownButtonLabel：short 优先；没有 short = dropdownShownLabel（与以前一致）；值无匹配 = \"\"", () => {
    test("行为", () => {
        const T = Menu as unknown as { dropdownButtonLabel?: (o: readonly Opt[], v: unknown) => string; dropdownShownLabel: (o: readonly Opt[], v: unknown) => string };
        expect(typeof T.dropdownButtonLabel).toBe("function"); const f = T.dropdownButtonLabel!;
        const o: Opt[] = [{ label: "L.long", value: "a", short: "L.short" }, { label: "L.plain", value: "b" }];
        expect(f(o, "a")).toBe("L.short"); // 键缺失：tr 原样返回键（既有行为），证明确实取的是 short
        expect(f(o, "b")).toBe(T.dropdownShownLabel(o, "b")); expect(f(o, "zzz")).toBe(""); expect(f([], "a")).toBe(""); expect(f(o, undefined)).toBe("");
        expect(T.dropdownShownLabel(o, "a")).toBe("L.long"); // 整句（tooltip）不受影响
    });
});

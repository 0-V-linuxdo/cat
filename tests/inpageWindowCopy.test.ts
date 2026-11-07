/* 补丁 inpage-window-copy（Cat 真机验收 53694 Task R）：预热 = Window 时「首个手势后窗口级开原生、页内让位」是设计行为（DESIGN 3.6 方式 A），
 * 但设置里原来的文案「Window: Chrome panel opens early / 窗口级：提前打开 Chrome 侧边栏」读起来像「后台预热、页内照常」，与实际不符。
 * 这里锁定：键齐全、zh / en 都说清「首次点击 / 页内让位 / 基本只剩 Chrome 侧边栏」、不再出现旧的误导说法、保留原有限制说明。纯文案，不改行为。 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { PREWARM } from "../src/plugins/inpageSidebar/constants";
import { buildStrings, STRINGS } from "../src/plugins/inpageSidebar/i18n";

const K = ["inpageSidebar.prewarm", "inpageSidebar.prewarm.detail", "inpageSidebar.prewarm.off", "inpageSidebar.prewarm.window"] as const;
/* 补丁 inpage-mac-shortcut-copy：文案里的快捷键按平台选（Mac ⌃S / ⌘R，其它 Alt+S / Ctrl+R），这里固定按 Mac 构建断言；非 Mac 见 tests/inpageMacShortcutCopy.test.ts */
const S = (L: "en" | "zh", k: string) => (buildStrings(true)[L] as Record<string, string>)[k]!;

describe("Window 预热文案（zh / en）", () => {
    test("键齐全且非空；en / zh 键集合一致", () => {
        for (const L of ["en", "zh"] as const) for (const k of K) expect(S(L, k)).toBeTruthy();
        expect(Object.keys(STRINGS.en).toSorted()).toEqual(Object.keys(STRINGS.zh).toSorted());
    });
    test("选项标签：说清「首次点击或任意键（含 ⌘R）后」+「⌃S 可切回页内」（Mac 构建）（zh / en），不再说「提前 / early」（补丁 inpage-restore-pinned 改文案）", () => {
        const en = S("en", "inpageSidebar.prewarm.window"), zh = S("zh", "inpageSidebar.prewarm.window");
        expect(en).toMatch(/first click or any key/i); expect(en).toMatch(/⌘R/); expect(en).toMatch(/⌃S switches back to in-page/); expect(en).not.toMatch(/early/i);
        expect(zh).toMatch(/首次点击或任意键/); expect(zh).toMatch(/⌘R/); expect(zh).toMatch(/⌃S 可切回页内/); expect(zh).not.toMatch(/提前/);
    });
    test("详细说明：首次点击 / 任意键（含 ⌘R）→ 整个窗口开 Chrome 侧边栏 → 页内让位 → ⌃S 可切回页内（行宽上限由 settingRowLength.test 约束，所以说明保持两行以内）", () => {
        const en = S("en", "inpageSidebar.prewarm.detail"), zh = S("zh", "inpageSidebar.prewarm.detail");
        for (const re of [/first click or any key \(incl\. ⌘R\)/i, /Chrome panel/i, /whole window/i, /in-page sidebar steps aside/i, /⌃S switches back/i]) expect(en).toMatch(re);
        for (const re of [/首次点击或任意键（含 ⌘R）/, /整窗开 Chrome 侧边栏/, /页内侧栏让位/, /⌃S 可切回页内/]) expect(zh).toMatch(re);
    });
    test("原有限制说明还在：实验性 / 可能闪现 / 无法覆盖切换窗口、会话恢复、其它扩展页 / 默认关闭", () => {
        expect(S("en", "inpageSidebar.prewarm.detail")).toMatch(/Experimental: may flash; can't cover window switches, session restore or other extensions' pages\. Off by default\./);
        expect(S("zh", "inpageSidebar.prewarm.detail")).toMatch(/实验性：可能短暂闪现；无法覆盖切换窗口、会话恢复、其它扩展打开的页面。默认关闭。/);
    });
    test("设置行标题：保留「受限页前预热」本意，并点明 Window = Chrome 侧边栏接管页内侧栏", () => {
        expect(S("en", "inpageSidebar.prewarm")).toMatch(/^Restricted-page warm-up:.*chrome:\/\/ pages/); expect(S("en", "inpageSidebar.prewarm")).toMatch(/Window: Chrome panel only/);
        expect(S("zh", "inpageSidebar.prewarm")).toMatch(/^受限页前预热：.*chrome:\/\//); expect(S("zh", "inpageSidebar.prewarm")).toMatch(/窗口级：页内侧栏让位/);
    });
    test("Off 的文案没变（Off 下页内不让位，不需要额外说明）", () => {
        expect(S("en", "inpageSidebar.prewarm.off")).toBe("Off"); expect(S("zh", "inpageSidebar.prewarm.off")).toBe("关闭");
    });
    test("旧的误导说法在所有 inpageSidebar.* 文案里都不再出现", () => {
        const all = [...Object.values(STRINGS.en), ...Object.values(STRINGS.zh)].join("\n");
        expect(all).not.toMatch(/Chrome panel opens early/); expect(all).not.toMatch(/提前打开 Chrome 侧边栏/);
    });
});

describe("文案与行为一致（只读校验，不改行为）", () => {
    test("文案描述的行为 = 常量：默认 off；首次手势事件 = pointerdown / keydown；设置选项 = off / window", async () => {
        expect(PREWARM.defaultMode).toBe("off"); expect(PREWARM.gestureEvents).toEqual(["pointerdown", "keydown"]);
        const { settings } = await import("../src/plugins/inpageSidebar/settings");
        const def = settings.def as Record<string, { options?: { label: string; value: string }[]; detail?: string }>;
        expect(def.prewarm!.options!.map(o => o.value)).toEqual(["off", "window"]); expect(def.prewarm!.detail).toBe("inpageSidebar.prewarm.detail");
        expect(def.prewarm!.options!.find(o => o.value === "window")!.label).toBe("inpageSidebar.prewarm.window");
    });
    test("源码：Window 的行为仍是「首次手势 → openNativeForWindow → setIntent(false) 页内让位」（文案依据；有人改了这条链就该同步改文案）", () => {
        const bg = readFileSync(resolve(import.meta.dir, "../src/plugins/inpageSidebar/background.ts"), "utf8");
        expect(bg).toMatch(/if \(wp\.go\) openNativeForWindow\(w, "prewarm", id\);/); // 补丁 t903u-tab-switch：多传发起标签（落定时补判到达用），首次手势开原生的行为与文案不变
        expect(bg).toMatch(/setIntent\(w, false, \{ suppress: hadIntent && PREWARM\.restoreInpageOnClose \}\); pushWindow\(w\);/); // rel62-intent-persist：页内照样让位（内存意图 false），落盘只多一个 suppressed 标记——文案不受影响
        expect(bg).toMatch(/if \(hadIntent && PREWARM\.restoreInpageOnClose\) restoreOnClose\.add\(w\);/);
    });
});

describe("下拉兜底：存储里的未知 / 旧值（含手写 \"tab\"）显示为 Off，不空白（Cat 追加）", () => {
    test("selectShown：值在选项里 → 原样；不在 → 默认项；没有默认项 → 第一项；没有选项 → undefined", async () => {
        const { selectShown } = await import("../src/components/settings/selectShown");
        const opts = [{ value: "off", default: true }, { value: "window" }];
        expect(selectShown(opts, "window")).toBe("window"); expect(selectShown(opts, "off")).toBe("off");
        for (const bad of ["tab", "bogus", "", undefined, null, true, 0, "Window", "OFF"]) expect(selectShown<unknown>(opts, bad)).toBe("off");
        expect(selectShown([{ value: "a" }, { value: "b" }], "zzz")).toBe("a"); expect(selectShown([], "x")).toBeUndefined();
        expect(selectShown([{ value: "a" }, { value: "b", default: true }], "zzz")).toBe("b");
    });
    test("prewarm 设置：任何不在 off / window 里的存储值，下拉显示 Off，且 Off 的标签在 zh / en 都有文案（下拉不空白）", async () => {
        const { selectShown } = await import("../src/components/settings/selectShown"); const { settings } = await import("../src/plugins/inpageSidebar/settings");
        const o = (settings.def as unknown as Record<string, { options: { label: string; value: string; default?: boolean }[] }>).prewarm!.options;
        for (const stored of ["tab", "Tab", "legacy", true, false, 1, null, undefined]) {
            const shown = selectShown<unknown>(o, stored); expect(shown).toBe("off");
            const label = o.find(x => x.value === shown)!.label; for (const L of ["en", "zh"] as const) expect(S(L, label)).toBeTruthy();
        }
        expect(selectShown(o, "window")).toBe("window");
    });
    test("读取侧本来就归一化：parsePrewarmMode 对 \"tab\" / 未知值 = off（行为不变，下拉显示 Off 与实际一致）", async () => {
        const { parsePrewarmMode } = await import("../src/plugins/inpageSidebar/logic");
        for (const v of ["tab", "bogus", true, false, undefined, null, ""]) expect(parsePrewarmMode(v as never)).toBe("off");
        expect(parsePrewarmMode("window")).toBe("window"); expect(parsePrewarmMode("off")).toBe("off");
    });
    test("只改显示、不改存储写入语义：selectShown 是纯函数（无 store / chrome / DOM）；SettingField 的 SELECT 只在传给 Dropdown 的 value 上用它，set 仍原样写入", () => {
        const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
        const sh = strip(readFileSync(resolve(import.meta.dir, "../src/components/settings/selectShown.ts"), "utf8")), sf = strip(readFileSync(resolve(import.meta.dir, "../src/components/settings/SettingField.ts"), "utf8"));
        expect(sh).not.toMatch(/import |chrome\.|document\.|store|Settings/);
        expect(sf).toMatch(/Dropdown\(\{ options: d\.options, value: selectShown\(d\.options, cur\), onChange: set, disabled: dis(, tipShown: true)? \}\)/); // 补丁 inpage-select-title 加了 tipShown: true（只是按钮提示，value / set 不变）
        expect(sf).toMatch(/\(ds\.store as Record<string, unknown>\)\[key\] = v;/); expect((sf.match(/ds\.store as Record<string, unknown>\)\[key\] =/g) ?? []).length).toBe(1);
    });
});

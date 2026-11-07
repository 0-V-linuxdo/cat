/* 补丁 12：侧栏调宽把手（Arc SidebarResizeRegionView，Rea arc-sidebar-resize-handle.md）。
 * 纯逻辑 + 真 SettingsStore + 源码扫描（这个仓库的内容脚本测试不起 DOM）。浏览器里的悬停淡入 / 拖动 / 吸附见 shots/shots-handle.ts（只写不跑）。 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { SettingsStore } from "../src/utils/SettingsStore";

const SRC = "src/plugins/inpageSidebar/";
const read = (f: string) => readFileSync(`${SRC}${f}`, "utf8");

describe("设置 showHandle（只控制 3 px 竖条；8 px 热区始终在）", () => {
    test("默认 false；旧键 showSwitchButton 已从设置定义里去掉", async () => {
        const { settings } = await import("../src/plugins/inpageSidebar/settings");
        const def = (settings as unknown as { def: Record<string, { default: unknown; description: string }> }).def;
        expect(def.showHandle!.default).toBe(false); expect(def.showHandle!.description).toBe("inpageSidebar.showHandle"); // 默认 false = 默认看不到竖条
        expect(def.showSwitchButton).toBeUndefined();
        const { HANDLE, NATIVE_SWITCH } = await import("../src/plugins/inpageSidebar/constants");
        expect(HANDLE.defaultOn).toBe(false); expect((NATIVE_SWITCH as Record<string, unknown>).defaultShowButton).toBeUndefined();
    });
    test("已保存的值不被覆盖（真 SettingsStore + 默认值 getter）：true 仍是 true、false 仍是 false；没存过 → 默认 false 且默认值不会被写进存储", async () => {
        const { settings } = await import("../src/plugins/inpageSidebar/settings");
        const def = (settings as unknown as { def: Record<string, { default: unknown }> }).def;
        const mk = (saved: Record<string, unknown> | undefined) => {
            const s = new SettingsStore<any>({ plugins: { InpageSidebar: saved ? { ...saved } : {} } });
            s.setDefaultGetter("plugins.InpageSidebar", k => def[k]?.default);
            return s;
        };
        expect(mk({ showHandle: true }).store.plugins.InpageSidebar.showHandle).toBe(true);
        expect(mk({ showHandle: false }).store.plugins.InpageSidebar.showHandle).toBe(false);
        const none = mk(undefined); expect(none.store.plugins.InpageSidebar.showHandle).toBe(false);
        expect(Object.keys(none.plain.plugins.InpageSidebar)).toEqual([]); // 读默认值不落盘
    });
    test("旧键 showSwitchButton：不读取、不迁移 —— 存过 true 也不会把手打开；旧值原样留在存储里", async () => {
        const { settings } = await import("../src/plugins/inpageSidebar/settings");
        const def = (settings as unknown as { def: Record<string, { default: unknown }> }).def;
        const s = new SettingsStore<any>({ plugins: { InpageSidebar: { showSwitchButton: true } } });
        s.setDefaultGetter("plugins.InpageSidebar", k => def[k]?.default);
        expect(s.store.plugins.InpageSidebar.showHandle).toBe(false);
        expect(s.plain.plugins.InpageSidebar).toEqual({ showSwitchButton: true });
        for (const f of ["background.ts", "content.ts", "panel.ts", "settings.ts"]) expect(read(f)).not.toMatch(/store\.showSwitchButton|showSwitchButton:/);
    });
    test("文案（zh / en）：label「显示侧栏把手」+ 一行说明（无换行；说明不开也能拖宽；不再提点击切原生）", async () => {
        const { LOCALES } = await import("../src/api/i18n"); await import("../src/plugins/inpageSidebar/i18n");
        const zh = LOCALES.zh["inpageSidebar.showHandle"]!, en = LOCALES.en["inpageSidebar.showHandle"]!;
        expect(zh.startsWith("显示侧栏把手")).toBe(true); expect(en.startsWith("Show sidebar handle")).toBe(true);
        expect(zh).not.toContain("\n"); expect(en).not.toContain("\n"); expect(zh).not.toMatch(/切到|单击|点击/); expect(en).not.toMatch(/switch|native|single/i);
        expect(zh).toContain("竖条"); expect(zh).toContain("不开也能拖宽"); expect(en).toContain("bar"); expect(en).toContain("either way");
        expect(LOCALES.zh["inpageSidebar.showSwitchButton"]).toBeUndefined(); expect(LOCALES.en["inpageSidebar.showSwitchButton"]).toBeUndefined();
    });
});

describe("宽度规则（Arc ended / changed：trunc、收起、164–500、吸附 228 ±14）", () => {
    test("arcResizeWidth：w = trunc(起始 + 位移)；< 82 → 0（收起）；82 ≤ w < 164 → 164；> 500 → 500", async () => {
        const { arcResizeWidth } = await import("../src/plugins/inpageSidebar/logic");
        const w = (s: number, dx: number) => arcResizeWidth(s, dx, false);
        expect(w(300, 40.9).width).toBe(340); expect(w(300, -40.9).width).toBe(259); // trunc 朝 0 取整（259.1 → 259）
        expect(w(300, -219).collapsed).toBe(true); // 81 < 82
        expect(w(300, -218)).toMatchObject({ width: 164, collapsed: false }); // 82 → 夹到 164
        expect(w(300, -137)).toMatchObject({ width: 164 }); expect(w(300, -136)).toMatchObject({ width: 164 }); // 163 / 164
        expect(w(300, -300)).toMatchObject({ width: 0, collapsed: true }); expect(w(300, -1000).width).toBe(0);
        expect(w(300, 200).width).toBe(500); expect(w(300, 999.9).width).toBe(500); expect(w(499, 1.9).width).toBe(500);
        expect(w(Number.NaN, 10).width).toBe(228); expect(w(300, Number.POSITIVE_INFINITY).width).toBe(300); // 非有限数不炸
    });
    test("吸附：|228 − w| < 14 且已武装 → 228；14 带边界（差 14 不吸，差 13 吸）；没武装不吸", async () => {
        const { arcResizeWidth } = await import("../src/plugins/inpageSidebar/logic");
        expect(arcResizeWidth(300, -72, true)).toMatchObject({ width: 228, snapped: true }); // 差 0
    });
    test("吸附边界精确值", async () => {
        const { arcResizeWidth } = await import("../src/plugins/inpageSidebar/logic");
        const at = (w: number, armed: boolean) => arcResizeWidth(w, 0, armed);
        expect(at(241, true)).toMatchObject({ width: 228, snapped: true }); // 差 13
        expect(at(242, true)).toMatchObject({ width: 242, snapped: false, armed: true }); // 差 14：不吸（严格小于 14）
        expect(at(215, true)).toMatchObject({ width: 228, snapped: true }); expect(at(214, true)).toMatchObject({ width: 214, snapped: false });
        expect(at(235, false)).toMatchObject({ width: 235, snapped: false, armed: false }); // 没武装：带内保持原值
        expect(at(300, false).armed).toBe(true); // 离开 14 带 → 武装
        expect(at(0, false)).toMatchObject({ collapsed: true });
    });
    test("createResizeDrag：从 228 起手拖，先拖出 14 带才会吸回；吸上才脉冲一次；带内来回不重复脉冲（冷却 0.5 s，这里注入时间：每次 move 过 400 ms）", async () => {
        const { createResizeDrag } = await import("../src/plugins/inpageSidebar/logic");
        let t = 0; const d = createResizeDrag(228, { now: () => (t += 400) });
        expect(d.move(5)).toMatchObject({ width: 233, snapped: false, pulse: false }); // 起手在带内：不吸
        expect(d.move(-8)).toMatchObject({ width: 220, snapped: false, pulse: false });
        expect(d.move(30)).toMatchObject({ width: 258, snapped: false, pulse: false }); // 离开带 → 武装
        expect(d.move(10)).toMatchObject({ width: 228, snapped: true, pulse: true }); // 回到带内 → 吸 + 脉冲
        expect(d.move(12)).toMatchObject({ width: 228, snapped: true, pulse: false }); // 仍吸着：不再脉冲
        expect(d.move(40)).toMatchObject({ width: 268, snapped: false, pulse: false });
        expect(d.move(0)).toMatchObject({ width: 228, snapped: true, pulse: true }); // 再次吸上 → 再脉冲
        const e = createResizeDrag(300, { now: () => 0 }); expect(e.move(-60)).toMatchObject({ width: 228, snapped: true, pulse: true }); // 起手在带外：立即武装
    });
    test("createResizeDrag 实时宽：默认（anchored，locked 与 floating 同）w < 82 → 0；noChrome → 164、不收起；恰好 82 → 164；最终值取最后一次 move", async () => {
        const { createResizeDrag } = await import("../src/plugins/inpageSidebar/logic");
        const l = createResizeDrag(300, {}); expect(l.move(-250)).toMatchObject({ width: 0, collapsed: true, raw: 50 }); expect(l.last.width).toBe(0);
        const f = createResizeDrag(300, { noChrome: true }); expect(f.move(-250)).toMatchObject({ width: 164, collapsed: true }); expect(f.last.width).toBe(164);
        expect(createResizeDrag(300, {}).move(-218)).toMatchObject({ width: 164, collapsed: false, raw: 82 }); // 拖动中恰好 82：夹到 164，不是 0
        expect(createResizeDrag(300, {}).move(-219)).toMatchObject({ width: 0, collapsed: true, raw: 81 });
    });
    test("松手 release()：anchored（locked / floating）起手 Int(起始 + 位移) ≤ 82 → 收起 + 宽度恢复为 min(500, 起始宽)（含边界 82；83 不收；noChrome 永不收起）", async () => {
        const { createResizeDrag } = await import("../src/plugins/inpageSidebar/logic");
        const rel = (start: number, dx: number, locked: boolean) => { const d = createResizeDrag(start, { noChrome: !locked }); d.move(dx); return d.release(); };
        expect(rel(300, -250, true)).toEqual({ width: 300, collapse: true }); // 50 → 收起，宽度 = 起始宽
        expect(rel(300, -219, true)).toEqual({ width: 300, collapse: true }); // 81
        expect(rel(300, -218, true)).toEqual({ width: 300, collapse: true }); // 82：拖动中是 164，但松手 ≤ 82 → 收起（Arc 的边界差一）
        expect(rel(300, -217, true)).toEqual({ width: 164, collapse: false }); // 83：不收起，夹到 164
        expect(rel(300, -217.1, true)).toEqual({ width: 300, collapse: true }); // trunc(82.9) = 82 → 收起
        expect(rel(300, -216.9, true)).toEqual({ width: 164, collapse: false }); // trunc(83.1) = 83
        expect(rel(300, -1000, true)).toEqual({ width: 300, collapse: true }); expect(rel(500, -450, true)).toEqual({ width: 500, collapse: true });
        expect(rel(300, -250, false)).toEqual({ width: 164, collapse: false }); // noChrome（页内没有这个模式）：164，不收起；floating 现在与 locked 同一分支（见下方「Arc 样式对齐」）
        expect(rel(300, 40, true)).toEqual({ width: 340, collapse: false }); expect(rel(300, 0, true)).toEqual({ width: 300, collapse: false }); // 点一下不动 = 原宽
        expect(rel(228, 5, true)).toEqual({ width: 233, collapse: false }); // 起手在 14 带内未武装：不吸
        const back = createResizeDrag(300, {}); back.move(-250); back.move(-10); expect(back.release()).toEqual({ width: 290, collapse: false }); // 拖到 ≤82 又拖回来：以最后一次为准
        expect(createResizeDrag(300, {}).release()).toEqual({ width: 300, collapse: false }); // 没动过
        const c = createResizeDrag(300, {}); c.move(-250); expect(c.release(true)).toEqual({ width: 164, collapse: false }); // 取消（Arc cancelled）：夹 164–500、不收起
    });
    test("双击重置 = 228；barVisible：只有侧栏正显示且设置恰为 true 才渲染竖条（默认 / 关 = 不渲染）；热区不看设置", async () => {
        const L = await import("../src/plugins/inpageSidebar/logic");
        expect(L.resetWidth()).toBe(228);
        expect(L.barVisible({ shown: true, setting: true })).toBe(true);
        for (const setting of [false, undefined, null, 0, 1, "true", {}]) expect(L.barVisible({ shown: true, setting })).toBe(false);
        expect(L.barVisible({ shown: false, setting: true })).toBe(false);
        expect((L as Record<string, unknown>).handleVisible).toBeUndefined();
    });
    test("clampWidth 不变：164–500，非数字 → 228（旧测试仍成立）", async () => {
        const { clampWidth } = await import("../src/plugins/inpageSidebar/logic");
        expect(clampWidth(100)).toBe(164); expect(clampWidth(900)).toBe(500); expect(clampWidth(Number.NaN)).toBe(228);
    });
});

describe("几何 / 样式（Arc 值）与接线", () => {
    test("HANDLE 常量 = Rea 文档：竖条 3 宽、高 −8、圆角 4、opacity .5、延迟 250ms、淡入淡出 200ms、82 / 228 / 14、脉冲 1.7 / 80ms / 贝塞尔", async () => {
        const { HANDLE, ARC } = await import("../src/plugins/inpageSidebar/constants");
        expect(ARC).toMatchObject({ handleWidth: 8, handleTop: 11, handleVInset: 22 });
        expect(HANDLE).toMatchObject({ barWidth: 3, barStroke: 1, barVisible: 4, barVInset: 8, barRadius: 4, barCenterX: 0, barOpacity: 0.5, hoverDelayMs: 250, fadeMs: 200, collapseBelow: 82, collapseOnReleaseAtMost: 82, snapWidth: 228, snapBand: 14, pulseScaleX: 1.7, pulseMs: 80, pulseEasing: "cubic-bezier(0.215, 0.61, 0.355, 1)", pulseCooldownMs: 500, cursor: "ew-resize" });
        expect(HANDLE.barEstimate).toEqual({ light: "rgb(0 98 120)", dark: "rgb(0 255 255)" }); // ⚠ 默认主题估算（浅 #006278 / 深 #00FFFF）
        expect(HANDLE.barVisible as number).toBe(HANDLE.barWidth + 2 * (HANDLE.barStroke / 2)); // 可见宽 = 路径 3 + 描边两侧各 0.5 = 4
    });
    test("host.css：热区 8×(100vh−22) 在 left=--i+--w−4（locked --i=0 → W−4；floating --i=5 → W+1）；竖条 left −2、宽 4（可见 3 + 1 描边，中心线在热区 x=0）；悬停延迟 / 淡入淡出 / 拖动常显；z 序在容器之上、遮罩之下", async () => {
        const { hostCss } = await import("../src/plugins/inpageSidebar/host.css"); const css = hostCss();
        expect(css).toContain(".handle { position: fixed; left: calc(var(--i) + var(--w) - 4px); top: 11px; width: 8px; height: calc(100vh - 22px); z-index: 2; cursor: ew-resize;");
        expect(css).toMatch(/\.handle i \{ position: absolute; left: -2px; top: 4px; width: 4px; height: calc\(100% - 8px\); border-radius: 4px; background: var\(--bar\);/);
        expect(css).toContain("opacity: 0; transition: opacity 200ms linear 0s;"); expect(css).toContain('.handle[data-hot="1"] i { opacity: 0.5; }'); expect(css).not.toContain(".handle:hover"); // 悬停延迟在 JS，不在 CSS
        expect(css).toContain('.handle[data-drag="1"] i { opacity: 0.5; transition: none; }');
        expect(css).not.toContain("col-resize"); expect(css).toContain(".mask { position: fixed; inset: 0; z-index: 3; cursor: ew-resize;"); expect(css).not.toContain(".native"); expect(css).not.toContain(".grip");
        const z = (sel: string) => Number(new RegExp(`${sel.replace(".", "\\.")} \\{[^}]*?z-index: (\\d+)`).exec(css)?.[1]);
        expect(z(".box")).toBeLessThan(z(".handle")); expect(z(".handle")).toBeLessThan(z(".mask"));
        const flat = css.split(":host([data-push=\"1\"])")[0]!; expect(flat).toContain("--i"); // --i 由容器样式提供（平贴 0 / 卡片 5）
    });
    test("content.ts：热区只看「侧栏正显示」（syncHandle(shown)，与设置无关）、竖条才看设置（syncBar(barVisible(...))；关着 = 不创建，拖动中 / 脉冲也没有）；删掉 ↗ 按钮与点击切原生", () => {
        const c = read("content.ts");
        expect(c).toContain("syncHandle(shown); syncBar(barVisible({ shown, setting: st?.handle }));");
        expect(c).not.toContain("handleVisible");
        expect(c.match(/mk\("div", "handle"\)/g)?.length).toBe(1); expect(c).toContain("if (on && !handle) makeHandle();");
        expect(c.match(/createElement\("i"\)/g)?.length).toBe(1); expect(c).toContain("if (on && handle && !bar) { bar = document.createElement(\"i\"); handle.append(bar); }"); // 竖条只在 syncBar 里创建
        const mh = c.slice(c.indexOf("const makeHandle"), c.indexOf("function syncHandle")); expect(mh).not.toContain("createElement"); // 创建热区不顺带建竖条
        expect(c).toContain("typeof bar?.animate"); // 脉冲在竖条不存在时是空操作
        expect(c).not.toMatch(/switchNative|MSG\.switchNative|nativeBtn|NATIVE_SWITCH|ArcTooltip|arcTooltip|\.title\s*=/);
        expect(c).toContain("createResizeDrag(width); clearHot();"); expect(c).not.toContain("locked: pinnedNow"); // locked / floating 同一分支（Arc 只看 sidebarMode） expect(c).toContain('addEventListener("dblclick"'); expect(c).toContain("setWidth(resetWidth())");
        expect(c).toContain("HANDLE.pulseScaleX"); expect(c).toContain("HANDLE.pulseMs"); expect(c).toContain('direction: "alternate"');
        expect(c).toMatch(/pointermove[\s\S]*?setWidth\(r\.width\); syncPush\(false\)/); // 拖动中逐帧写宽度 + 推开页面（不动画）
        expect(c).toMatch(/endDrag = \(cancelled = false\) => \{[\s\S]*?const r = drag\.release\(cancelled\);[\s\S]*?send\(r\.collapse \? \{ type: "collapse", width: r\.width \} : \{ type: "width", width: r\.width \}\)/); // 松手落盘 / 收起一次
        expect(c).toMatch(/!on && handle\) \{ endDrag\(true\); clearHot\(\); handle\.remove\(\)/); // 拖到一半侧栏被收起：先收尾再摘
        expect(c).toContain('"pointercancel", () => endDrag(true)'); expect(c).toContain('"pointerup", () => endDrag()'); // 取消 / 把手被摘掉 = cancelled：不收起
    });
    test("后台：状态字段 handle = !!showHandle（没设置 → false）；switchNative 消息处理与把手设置无关（快捷键 / 右键菜单 / 图标不变）", () => {
        const b = read("background.ts");
        expect(b).toContain("handle: !!settings.store.showHandle"); expect(b).not.toContain("switchButton");
        const line = b.split("\n").find(l => l.includes("m?.type !== MSG.switchNative"))!; expect(line).toBeDefined(); expect(line).not.toContain("showHandle");
        expect(read("panel.ts")).toContain('NATIVE_SWITCH.sources.includes("frame")) {'); // iframe 内对照按钮：只看常量，默认不渲染
    });
});

describe("Arc 样式对齐（AH）：位置算式 / 颜色 / 悬停定时器 / 吸附冷却 / floating 收起", () => {
    test("位置算式：left = barCenterX − barVisible / 2 = −2；locked 热区 x = W − 4 → 可见 [W−6, W−2]（路径 [W−5.5, W−2.5]）；floating 热区 x = W + 1 → [W−1, W+3]（路径 [W−0.5, W+2.5]）；高 = 热区高 − 8 = H − 30，上下各 15", async () => {
        const { HANDLE, ARC } = await import("../src/plugins/inpageSidebar/constants");
        const left = HANDLE.barCenterX - HANDLE.barVisible / 2; expect(left).toBe(-2);
        const W = 228;
        const span = (containerLeft: number) => { const zone = containerLeft + W - ARC.handleWidth / 2; return [zone + left, zone + left + HANDLE.barVisible, zone - HANDLE.barWidth / 2, zone + HANDLE.barWidth / 2]; };
        expect(span(0)).toEqual([W - 6, W - 2, W - 1.5 - 4, W - 4 + 1.5]); // locked：[W−6, W−2] / 路径 [W−5.5, W−2.5]
        expect(span(0).slice(2)).toEqual([W - 5.5, W - 2.5]);
        expect(span(5)).toEqual([W - 1, W + 3, W + 5 - 5.5, W + 5 - 2.5]); // floating（容器左缘 5）：[W−1, W+3] / 路径 [W−0.5, W+2.5]
        const H = 900; expect(H - ARC.handleVInset - HANDLE.barVInset).toBe(H - 30); expect(ARC.handleTop + HANDLE.barVInset / 2).toBe(15); // 上 15；下 = H − 15 − (H − 30) = 15
    });
    test("颜色：host 的 --bar = frameTheme.bar > 按侧栏页 scheme 的估算值 > 按宿主深浅的估算值（内联在 applyBg）；parseFrameTheme 带 bar 时只收可解析的颜色（脏值丢弃但主题仍有效）", async () => {
        const { parseFrameTheme } = await import("../src/plugins/inpageSidebar/logic"); const { MSG } = await import("../src/plugins/inpageSidebar/constants");
        expect(read("content.ts")).toContain('host.style.setProperty("--bar", theme?.bar ?? HANDLE.barEstimate[theme?.scheme ?? (osDark() ? "dark" : "light")]);');
        expect(parseFrameTheme({ type: MSG.frameTheme, base: "#112233", scheme: "dark", bar: "rgb(10, 20, 30)" })).toEqual({ base: "rgb(17, 34, 51)", scheme: "dark", bar: "rgb(10, 20, 30)" });
        expect(parseFrameTheme({ type: MSG.frameTheme, base: "#112233", scheme: "dark" })).toEqual({ base: "rgb(17, 34, 51)", scheme: "dark" });
        expect(parseFrameTheme({ type: MSG.frameTheme, base: "#112233", scheme: "dark", bar: "url(javascript:1)" })).toEqual({ base: "rgb(17, 34, 51)", scheme: "dark" });
        expect(parseFrameTheme({ type: MSG.frameTheme, base: "#112233", scheme: "light", bar: "javascript:1" })).toEqual({ base: "rgb(17, 34, 51)", scheme: "light" });
    });
    test("maxContrastOf（Space 色 → 浅 T3 最暗档 / 深 T0 最亮档，WCAG 相对亮度）：浅外观亮度 ≤ 0.1，深外观 ≥ 0.85；认不出 → undefined", async () => {
        const { maxContrastOf } = await import("../src/plugins/inpageSidebar/logic");
        const lum = (css: string) => { const c = (css.match(/\d+/g) ?? []).map(Number).map(v => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!; };
        for (const base of ["#4c8bf5", "#e5534b", "#e5b93a", "rgb(110, 80, 230)", "#808080"]) {
            const l = maxContrastOf(base, false)!, d = maxContrastOf(base, true)!;
            expect(lum(l)).toBeLessThanOrEqual(0.1 + 1e-6); expect(lum(d)).toBeGreaterThanOrEqual(0.85 - 1e-6);
        }
        expect(maxContrastOf("not a color", true)).toBeUndefined(); expect(maxContrastOf(undefined, false)).toBeUndefined();
    });
    test("panel.ts：有 --arc-space 才算 bar 并随 frameTheme 回报（key 含 bar）；content.ts：applyBg 写 --bar", () => {
        const p = read("panel.ts");
        expect(p).toContain('getPropertyValue("--arc-space").trim()'); expect(p).toContain('maxContrastOf(space, scheme === "dark")'); expect(p).toContain("...(bar ? { bar } : {})"); expect(p).toContain('`${base}|${scheme}|${bar ?? ""}|${follow}`'); /* 补丁 system-color-scheme/1：key 再含 follow */ expect(p).toContain('root.append(sp)'); // 临时探针挂 root（挂 head 会触发观察者回环）
    });
    test("悬停 JS 定时器：pointerenter → 250 ms 后 data-hot=1；pointerleave 取消待执行并立即 data-hot=0；pointermove 不重置；拖动中忽略；松手按 :hover 重算；host.css 不再有 :hover / 延迟", () => {
        const all = read("content.ts"); const c = all.slice(all.indexOf("const makeHandle"), all.indexOf("function syncHandle")) + all.slice(all.indexOf("const endDrag"), all.indexOf("const makeHandle")); // 把手部分（不含 trigger 的 pointerenter）
        expect(c).toContain('addEventListener("pointerenter"'); expect(c).toContain("HANDLE.hoverDelayMs"); expect(c).toContain('addEventListener("pointerleave", () => { if (dragging) return; clearHot(); setHot(false); })');
        const enter = c.slice(c.indexOf('addEventListener("pointerenter"'), c.indexOf('addEventListener("pointerleave"')); expect(enter).toContain("if (dragging) return; clearHot(); hotTimer = setTimeout("); expect(enter).toContain("setHot(true)"); expect(enter).toContain("!dragging");
        const move = c.slice(c.indexOf('addEventListener("pointermove"'), c.indexOf('addEventListener("pointerup"')); expect(move).not.toContain("hotTimer"); expect(move).not.toContain("setHot"); // mouseMoved 不重置计时
        expect(c).toContain('setHot(!!handle?.matches(":hover"))'); expect(all).toContain("if (!stopped && !dragging) setHot(true)"); // teardown 后迟到的定时器不再动 DOM
    });
    test("floating 与 locked 同一分支：createResizeDrag 默认就收起（≤82）；noChrome 才不收起（164）；endDrag 在 floating（非 pinned）收起时本地 peek=false 收回浮出", async () => {
        const { createResizeDrag } = await import("../src/plugins/inpageSidebar/logic");
        const rel = (start: number, dx: number, noChrome = false) => { const d = createResizeDrag(start, { noChrome }); d.move(dx); return d.release(); };
        expect(rel(300, -250)).toEqual({ width: 300, collapse: true }); expect(rel(300, -218)).toEqual({ width: 300, collapse: true }); expect(rel(300, -217)).toEqual({ width: 164, collapse: false });
        expect(rel(300, -250, true)).toEqual({ width: 164, collapse: false });
        const c = read("content.ts"); expect(c).toContain("if (r.collapse && !pinnedNow && peek) { repeek.arm(lastX); peek = false; render(); }");
        expect(read("background.ts")).toContain("locked / floating 同一分支");
    });
    test("吸附脉冲冷却 0.5 s（Arc state[5]：带内触发一次后置 0；离开带且距上次 > 0.5 s 才再允许）", async () => {
        const { createResizeDrag } = await import("../src/plugins/inpageSidebar/logic");
        let t = 1000; const d = createResizeDrag(300, { now: () => t });
        expect(d.move(-72).pulse).toBe(true); // 吸上 228 → 脉冲
        t += 100; expect(d.move(-20).pulse).toBe(false); // 出带（距上次 100 ms：不恢复）
        t += 100; expect(d.move(-72).pulse).toBe(false); // 200 ms 内再吸上：冷却中，不脉冲
        t += 100; d.move(-20); t += 600; d.move(-10); // 出带，距上次反馈 > 0.5 s → 恢复
        t += 10; expect(d.move(-72).pulse).toBe(true);
        const e = createResizeDrag(300, { now: () => t }); expect(e.move(-72).pulse).toBe(true); t += 501; e.move(0); expect(e.move(-72).pulse).toBe(true); // 刚好超过 500 ms 出带再吸 → 再脉冲
        const f = createResizeDrag(300, { now: () => t }); expect(f.move(-72).pulse).toBe(true); t += 500; f.move(0); expect(f.move(-72).pulse).toBe(false); // 恰好 500 ms：不算 > 0.5 s
    });
});

describe("收起闸（locked 拖到 ≤82 松手收起：不得出现「--w 回到起始宽 + shown=0」同帧；再展开恢复起始宽）", () => {
    test("闸住期间：任何 shown 序列下 width() 都是 0；--w 绝不与 shown=false 同帧取起始宽", async () => {
        const { createCollapseGate } = await import("../src/plugins/inpageSidebar/logic");
        const g = createCollapseGate(); g.begin(); expect(g.holding).toBe(true);
        const frames: Array<[boolean, number]> = [];
        for (const shown of [true, true, false, false, false]) frames.push([shown, g.width(shown, 500)]); // 后台先后下发：松手瞬间的旧状态、收起后的状态
        expect(frames.map(f => f[1])).toEqual([0, 0, 0, 0, 0]);
        for (const [shown, w] of frames) expect(!shown && w === 500).toBe(false); // 判据：shown=0 的帧里 --w 不是起始宽
        expect(g.holding).toBe(true);
    });
    test("再展开（shown 变回 true，且之前出现过 shown=false）→ 恢复起始宽并放闸；之后 Alt+S 式隐藏 / 展开宽度照旧保持（不经过闸）", async () => {
        const { createCollapseGate } = await import("../src/plugins/inpageSidebar/logic");
        const g = createCollapseGate(); g.begin();
        g.width(false, 500); expect(g.width(true, 500)).toBe(500); expect(g.holding).toBe(false);
        expect(g.width(false, 500)).toBe(500); expect(g.width(true, 500)).toBe(500); // 放闸后 = 存储宽（clampWidth）
        expect(g.width(false, 9999)).toBe(500); expect(g.width(true, 10)).toBe(164); // 夹取规则不变
    });
    test("没经过 begin（普通松手 / Alt+S 关闭 / floating 收回）：width() = clampWidth(存储宽)，与改动前一致", async () => {
        const { createCollapseGate, clampWidth } = await import("../src/plugins/inpageSidebar/logic");
        const g = createCollapseGate(); expect(g.holding).toBe(false);
        for (const w of [0, 82, 164, 228, 338, 500, 900]) for (const shown of [true, false]) expect(g.width(shown, w)).toBe(clampWidth(w));
    });
    test("兜底：后台没收起（始终 shown）→ expire(true) 放行并恢复起始宽；已收起（shown=false）→ expire(false) 仍闸住（不抢在隐藏时恢复）；release 立即放行", async () => {
        const { createCollapseGate } = await import("../src/plugins/inpageSidebar/logic");
        const a = createCollapseGate(); a.begin(); expect(a.width(true, 500)).toBe(0); expect(a.expire(true)).toBe(true); expect(a.width(true, 500)).toBe(500);
        const b = createCollapseGate(); b.begin(); b.width(false, 500); expect(b.expire(false)).toBe(false); expect(b.width(false, 500)).toBe(0); expect(b.width(true, 500)).toBe(500);
        const c = createCollapseGate(); c.begin(); c.release(); expect(c.holding).toBe(false); expect(c.width(true, 228)).toBe(228);
        const d = createCollapseGate(); d.begin(); d.begin(); d.width(false, 500); d.begin(); expect(d.width(true, 500)).toBe(0); // begin 重置「出现过隐藏」
    });
    test("接线：render 用闸取宽（拖动中不写）；endDrag 收起时 begin + 超时兜底；新拖动在闸住时先 release 并从存储宽起手；常量 collapseGateMs 存在；存储宽 / 消息不变", async () => {
        const c = read("content.ts"); const { TIMING } = await import("../src/plugins/inpageSidebar/constants");
        expect(c).toContain("if (st && !dragging) setWidth(collapseGate.width(shown, st.width));"); expect(c).not.toContain("setWidth(clampWidth(st.width))");
        expect(c).toContain("if (r.collapse) { collapseGate.begin();"); expect(c).toContain("TIMING.collapseGateMs"); expect(TIMING.collapseGateMs).toBeGreaterThan(500);
        expect(c).toMatch(/if \(collapseGate\.holding\) \{ collapseGate\.release\(\); setWidth\(clampWidth\(st\?\.width \?\? ARC\.defaultWidth\)\); \}[\s\S]*?createResizeDrag\(width\); clearHot\(\)/);
        expect(c).toContain('send(r.collapse ? { type: "collapse", width: r.width } : { type: "width", width: r.width });'); // 后台收到的仍是起始宽（落盘不变）
        expect(c).toContain("box.dataset.shown = shown ? \"1\" : \"0\";");
    });
});

describe("floating 拖到 ≤82 松手收起（与 locked 同分支）+ 收起后不回弹（headed 实测缺口）", () => {
    test("同分支：默认（anchored）createResizeDrag 对 floating / locked 一视同仁——拖动中 w<82 → 0，松手 Int ≤ 82 → { width: 起始宽, collapse: true }（floating 起始 228、位移 −228 / −146 / −300）", async () => {
        const { createResizeDrag } = await import("../src/plugins/inpageSidebar/logic");
        for (const dx of [-228, -300, -146]) { const d = createResizeDrag(228); expect(d.move(dx).width).toBe(dx === -146 ? 164 : 0); expect(d.release()).toEqual({ width: 228, collapse: true }); } // −146 → 82（拖动中 164，松手 ≤ 82 → 收起）
        const keep = createResizeDrag(228); keep.move(-145); expect(keep.release()).toEqual({ width: 164, collapse: false }); // 83 → 不收，夹 164
    });
    test("content.ts：endDrag 的 floating 分支（!pinnedNow && peek）→ 武装守卫（松手点 lastX）→ peek = false → render()；lastX 在 pointerdown / pointermove 里更新", () => {
        const c = read("content.ts");
        expect(c).toContain("if (r.collapse && !pinnedNow && peek) { repeek.arm(lastX); peek = false; render(); }");
        expect(c).toContain("dragX = lastX = e.clientX;");
        expect(c).toMatch(/lastX = e\.clientX; const r = drag\.move\(e\.clientX - dragX\);/);
        expect(c.indexOf("const repeek = createRepeekGuard()")).toBeGreaterThan(0);
        expect(c.indexOf("const repeek = createRepeekGuard()")).toBeLessThan(c.indexOf("const endDrag")); // 声明早于使用
    });
    test("content.ts：触发条 pointerenter 在守卫武装时直接返回（不起 160 ms 停留计时），pointerleave 解除", () => {
        const c = read("content.ts");
        expect(c).toMatch(/trigger\.addEventListener\("pointerenter", \(\) => \{\n\s+if \(repeek\.blocking\) return;\n\s+inTrigger = true;/);
        expect(c).toMatch(/trigger\.addEventListener\("pointerleave", \(\) => \{ repeek\.leave\(\); inTrigger = false;/);
    });
    test("createRepeekGuard：松手点在触发条内（x < 50，含负数 = 夹在窗口外）→ 武装，leave 后解除；在条外 / 非有限数 → 不武装（下次正常进入照常浮出）", async () => {
        const { createRepeekGuard } = await import("../src/plugins/inpageSidebar/logic");
        const { ARC } = await import("../src/plugins/inpageSidebar/constants");
        const g = createRepeekGuard(); expect(g.blocking).toBe(false);
        expect(g.arm(33)).toBe(true); expect(g.blocking).toBe(true); g.leave(); expect(g.blocking).toBe(false);
        expect(g.arm(-195)).toBe(true); g.leave();
        expect(g.arm(ARC.triggerNarrow)).toBe(false); expect(g.blocking).toBe(false); // 恰在条边界外
        expect(g.arm(ARC.triggerNarrow - 1)).toBe(true); expect(g.arm(Number.NaN)).toBe(false); expect(g.blocking).toBe(false); // 重新 arm 覆盖旧状态
    });
});

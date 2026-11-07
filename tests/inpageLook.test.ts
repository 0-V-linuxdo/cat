import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { LOCALES } from "@api/i18n";

import { ARC, CARD_LOOK, CHROME, FLAT_BASE, MSG, PUSH } from "../src/plugins/inpageSidebar/constants";
import { hostCss } from "../src/plugins/inpageSidebar/host.css";
import { boxChrome, flatBackground, handleLeft, isFlat, opaqueColor, parseFrameTheme, pushOffset, shouldPush, usedScheme } from "../src/plugins/inpageSidebar/logic";
import { lookCss } from "../src/plugins/inpageSidebar/panel";

/* 补丁 09 的外观修订（DESIGN 3.8.8）：常驻推开 = Arc locked = 平贴；悬停浮出 / 浮在页面上 = 卡片。
 * 这里只测几何数值、CSS 字符串、消息解析和接线（无 DOM）；「真的看起来平贴 / 不透光 / 深色页文字可读」要真浏览器——shots/shots-push.ts + MANUAL I37–I41，这里不声称。 */
const DIR = resolve(import.meta.dir, "../src/plugins/inpageSidebar");
const src = (f: string) => readFileSync(resolve(DIR, f), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const rule = (css: string, sel: string) => { const i = css.indexOf(sel + " {"); if (i < 0) return ""; return css.slice(i, css.indexOf("}", i) + 1); };

describe("几何：平贴（pinned / locked）与卡片（floating / overlay）", () => {
    test("pinned：x = 0、y = 0、高 = 100%（整高）、宽 228、推开量 = 228；无圆角 / 边框", () => {
        expect(CHROME.flat).toEqual({ left: 0, top: 0, vInset: 0, radius: 0, border: 0 });
        expect(boxChrome(true)).toBe(CHROME.flat); expect(ARC.defaultWidth).toBe(228);
        expect(pushOffset(ARC.defaultWidth)).toBe(ARC.defaultWidth + boxChrome(true).left + PUSH.gap); expect(pushOffset(228)).toBe(228); expect(PUSH.gap).toBe(0);
        expect(handleLeft(228, true)).toBe(224);
    });
    test("floating / overlay：x = y = 5、高 = 窗口 − 10、圆角 12、边框 1；Arc 值不变", () => {
        expect(CHROME.card).toEqual({ left: 5, top: 5, vInset: 10, radius: 12, border: 1 }); expect(boxChrome(false)).toBe(CHROME.card);
        expect(CHROME.card.left).toBe(ARC.inset); expect(CHROME.card.vInset).toBe(ARC.vInset); expect(CHROME.card.radius).toBe(ARC.radius);
        expect(handleLeft(228)).toBe(229);
    });
    test("外观与让位是同一个条件：只有 push 模式 + 常驻 + 非全屏 = 平贴；overlay 模式常驻 / 悬停浮出 = 卡片；悬停（peek）不会把 pinned 变卡片", () => {
        const f = (o: object) => ({ mode: "push", pinned: true, fullscreen: false, ...o }) as Parameters<typeof isFlat>[0];
        expect(isFlat(f({}))).toBe(true); expect(isFlat(f({ mode: "overlay" }))).toBe(false); expect(isFlat(f({ pinned: false }))).toBe(false); expect(isFlat(f({ fullscreen: true }))).toBe(false);
        expect(isFlat(f({}))).toBe(shouldPush(f({})));
        const c = strip(src("content.ts")); expect(c).toMatch(/host\.dataset\.push = on \? "1" : "0"/); expect(c).not.toMatch(/dataset\.push[^;]*(hover|peek|shown)/i);
    });
});

describe("host.css：卡片默认，data-push=1 = 平贴", () => {
    const css = hostCss(); const box = rule(css, ".box"); const flat = rule(css, ':host([data-push="1"]) .box');
    test("卡片（默认 .box）：left / top 5、高 100vh − 10、圆角 12、1 px 边框 rgba(255,255,255,.3)、阴影 0 0 10px α.075、背景透明 + backdrop-filter 模糊 / 饱和", () => {
        expect(box).toContain("left: 5px; top: 5px;"); expect(box).toContain("height: calc(100vh - 10px)"); expect(box).toContain("border-radius: 12px");
        expect(box).toContain("border: 1px solid rgba(255,255,255,.3)"); expect(box).toContain("box-shadow: 0 0 10px rgba(0,0,0,.075)"); expect(box).toContain("background-color: transparent");
        expect(box).toContain(`backdrop-filter: blur(${CARD_LOOK.blur}px) saturate(${CARD_LOOK.saturate})`); expect(box).toContain("-webkit-backdrop-filter:");
    });
    test("平贴（data-push=1）：left 0 / top 0、高 100vh、圆角 0、边框宽 0、无阴影、不透明底 var(--bg)、不模糊；没有 5px / 12px / calc(100vh - 10px) 残留", () => {
        expect(flat).toContain("left: 0px; top: 0px; height: calc(100vh - 0px); border-radius: 0px; border-width: 0px;"); expect(flat).toContain("box-shadow: none"); expect(flat).toContain("background-color: var(--bg)");
        expect(flat).toContain("backdrop-filter: blur(0px) saturate(1)"); expect(flat).not.toMatch(/\b5px|12px|rgba\(255,255,255|calc\(100vh - 10px\)/);
        expect(css).toContain(':host([data-push="1"]) { --i: 0px; }'); expect(css).toMatch(/--i: 5px;/); expect(css).toMatch(/--bg: #ece9f1;/);
    });
    test("悬停不改外观：没有任何 :hover 规则改 .box 的 left / top / height / border / shadow / background", () => {
        expect(css).not.toMatch(/\.box[^{]*:hover[^{]*\{[^}]*(left|top|height|border|shadow|background)/);
        for (const m of css.matchAll(/:host\(\[data-push="1"\]:hover\)[^{]*\{/g)) expect(m[0]).not.toContain(".box");
    });
    test("切换动画：外观属性（left/top/height/border-radius/border-width/border-color/box-shadow/background-color/backdrop-filter）全部用 arc80 过渡；hidden↔floating 的 transform 仍是弹簧；data-noanim 只留 transform / visibility", () => {
        const t = "80ms cubic-bezier(.25,.46,.45,.94)";
        for (const p of ["left", "top", "height", "border-radius", "border-width", "border-color", "box-shadow", "background-color", "backdrop-filter"]) { expect(box).toContain(`${p} ${t}`); expect(rule(css, ':host([data-curve="locked"]) .box')).toContain(`${p} ${t}`); }
        expect(box).toContain("transition: transform 250ms linear("); expect(css).toContain(':host([data-noanim="1"]) .box { transition-property: transform, visibility; }');
        expect(css).toContain(':host([data-noanim="1"][data-curve="locked"]) .box, :host([data-noanim="1"][data-curve="locked"]) .box[data-shown="1"] { transition-property: transform, visibility; }');
    });
    test("把手 / 提示的 left 跟 --i 走（平贴 0 / 卡片 5），不再写死 5px", () => {
        expect(css).not.toMatch(/calc\(5px \+ var\(--w\)/); expect((css.match(/calc\(var\(--i\) \+ var\(--w\)/g) ?? []).length).toBe(2); // 补丁 12：「↗」按钮删了，只剩把手 + 提示
    });
    test("iframe 保持透明背景（行内 color-scheme 由 content.ts 按回报写入）", () => { expect(css).toMatch(/iframe \{[^}]*background: transparent;[^}]*color-scheme: normal;/); });
});

describe("侧栏页：lookCss / 主题回报 / 消息解析", () => {
    test("lookCss：只在 data-inpage-look 下生效（原生侧栏不受影响）；html / body 背景透明、tint 画在 html::before（body::before 是颗粒层）；flat = 不透明度 1、card = " + CARD_LOOK.tint, () => {
        const c = lookCss(); expect(c).toContain("html[data-inpage-look], html[data-inpage-look] body { background: transparent !important; }");
        expect(c).toContain("html[data-inpage-look]::before {"); expect(c).toContain("background: var(--arc-tint); opacity: 1;"); expect(c).toContain(`html[data-inpage-look="card"]::before { opacity: ${CARD_LOOK.tint}; }`);
        expect(c).not.toContain("body::before"); for (const l of c.split("\n")) if (l.trim()) expect(l).toMatch(/^html\[data-inpage-look/);
    });
    test("opaqueColor：#hex / rgb / rgba / color(srgb) → 不透明 rgb()，alpha 被丢弃；非法 / 越界 / 过长 / 非字符串 → undefined", () => {
        expect(opaqueColor("#ece9f1")).toBe("rgb(236, 233, 241)"); expect(opaqueColor("rgb(30, 32, 32)")).toBe("rgb(30, 32, 32)"); expect(opaqueColor("rgba(30,32,32,0.4)")).toBe("rgb(30, 32, 32)");
        expect(opaqueColor("rgb(30 32 32 / 40%)")).toBe("rgb(30, 32, 32)"); expect(opaqueColor("color(srgb 0.5 0 1 / 0.3)")).toBe("rgb(128, 0, 255)");
        for (const v of ["red", "url(x)", "rgb(300,0,0)", "rgb(1,2,3);x", "", undefined, 5, "#fff", "a".repeat(100)]) expect(opaqueColor(v)).toBeUndefined();
    });
    test("usedScheme：dark / light 单选就用它；两者都支持（或 normal）跟系统", () => {
        expect(usedScheme("dark", false)).toBe("dark"); expect(usedScheme("light", true)).toBe("light"); expect(usedScheme("light dark", true)).toBe("dark"); expect(usedScheme("light dark", false)).toBe("light"); expect(usedScheme("normal", true)).toBe("dark"); expect(usedScheme(undefined, false)).toBe("light");
        expect(usedScheme("only light", true)).toBe("light");
    });
    test("parseFrameTheme：只认 type + 可解析 base + scheme；flatBackground 有回报用回报，没有按页面深浅回退到 --arc-base 默认值", () => {
        expect(parseFrameTheme({ type: MSG.frameTheme, base: "rgb(30, 32, 32)", scheme: "dark" })).toEqual({ base: "rgb(30, 32, 32)", scheme: "dark" });
        for (const d of [null, {}, { type: "x", base: "#ece9f1", scheme: "light" }, { type: MSG.frameTheme, base: "red", scheme: "light" }, { type: MSG.frameTheme, base: "#ece9f1", scheme: "auto" }]) expect(parseFrameTheme(d)).toBeUndefined();
        expect(flatBackground({ base: "rgb(1, 2, 3)", scheme: "light" }, true)).toBe("rgb(1, 2, 3)"); expect(flatBackground(undefined, false)).toBe(FLAT_BASE.light); expect(flatBackground(undefined, true)).toBe(FLAT_BASE.dark);
        expect(FLAT_BASE).toEqual({ light: "#ece9f1", dark: "#1e2020" });
    });
    test("FLAT_BASE 与 sidepanel.css 的 --arc-base 默认值一致（浅 / 深）", () => {
        const css = readFileSync(resolve(import.meta.dir, "../static/sidepanel.css"), "utf8");
        expect(css).toContain(`--arc-base: ${FLAT_BASE.light}`); expect(css).toContain(`--arc-base: ${FLAT_BASE.dark}`);
    });
});

describe("接线", () => {
    test("content.ts：flat 标志在 data-push 翻转时 postMessage 给 iframe（定向 origin）；ready 时补发；主题回报 → --bg + iframe colorScheme；instant 渲染 data-noanim", () => {
        const c = strip(src("content.ts"));
        expect(c).toMatch(/host\.dataset\.push = on \? "1" : "0";\s*\n\s*if \(on !== flatNow\) \{ flatNow = on; postLook\(\); \}/); expect(c).toMatch(/frameChan\.post\("look", \{ type: MSG\.frameLook, flat: flatNow \}\)/); expect(c).toMatch(/createFrameChannel\(\{ win: \(\) => iframe\?\.contentWindow, origin: frameOrigin/); // rel66：定向 origin 由 frameChannel 发
        expect(c).toMatch(/if \(!frameChan\.isReady\(\)\) \{ postLook\(\);/); expect(c).toMatch(/ready = true; iframe\.style\.opacity = "";/); /* 补丁 tab-shake：ready（面板已套好外观）才显示 iframe */ expect(c).toMatch(/parseFrameTheme\(e\.data\)/); expect(c).toMatch(/--bg/); expect(c).toMatch(/style\.colorScheme = /);
        expect(c).toMatch(/instant = prepareRender\(\{ instant, visible: vis, host, box, raf: requestAnimationFrame \}\)/); expect(strip(src("instantRender.ts"))).toMatch(/c\.host\.dataset\.noanim = "1"/); // 补丁 prepare-render：噪声写入挪到 instantRender.prepareRender
        expect(c.indexOf("parseFrameTheme(e.data)")).toBeGreaterThan(c.indexOf("e.source !== iframe.contentWindow")); // 来源校验在前
    });
    test("panel.ts：frameLook 只认 window.parent 来的、flat 必须是布尔；回报用 frameTheme；销毁时还原", () => {
        const c = strip(src("panel.ts"));
        expect(c).toMatch(/e\.source !== window\.parent/); expect(c).toMatch(/typeof d\.flat !== "boolean"/); expect(c).toMatch(/MSG\.frameTheme/); expect(c).toMatch(/delete root\.dataset\.inpageLook/);
    });
    test("设置文案（zh / en）说明推开 = 平贴、浮层 = 卡片", async () => {
        await import("../src/plugins/inpageSidebar/i18n");
        expect(LOCALES.zh["inpageSidebar.displayMode.detail"]).toContain("平贴"); expect(LOCALES.zh["inpageSidebar.displayMode.detail"]).toContain("卡片");
        expect(LOCALES.en["inpageSidebar.displayMode.detail"]).toContain("flat"); expect(LOCALES.en["inpageSidebar.displayMode.detail"]).toContain("card");
    });
});

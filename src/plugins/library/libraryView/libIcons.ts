/*
 * Library 左栏图标：Arc 原生 Lottie（/workspace/arc-icons/library/*.json，原样拷贝到 ./lottie/）。
 * Arc 按图层名着色（library-entries.md §2/§3，library-selected-color.md「深挖补充」）：
 * primaryColor 层 = SemanticColorPalette.maxContrastColor → --lib-max-contrast（选中 α1 / 未选中 α.7），
 * secondaryColor 层 = SemanticColorPalette.cutoutColor → --lib-cutout（选中 α1 / 未选中 α0）。
 * 不再用 --lib-secondary（= --arc-accent，那是旧的青绿 126,166,163 的来源，无源码依据）。archive.json 第 0 层写死蓝 #3134FB，必须覆盖。
 * 做法：加载前 prepareLottie() 给图层打 class（lottie svg 渲染器把 layer.cl 写到图层 <g>），并把所有纯色填充 / 描边中和为白，
 * 真正的颜色与透明度由下面注入的 CSS（变量随主题切换）决定。播放器：lottie-web light（仅 SVG、无 eval，MV3 CSP 安全，本地打包）。
 */
import lottie from "lottie-web/build/player/lottie_light";
import archive from "./lottie/archive.json";
import boosts from "./lottie/boosts.json";
import downloads from "./lottie/downloads.json";
import easels from "./lottie/easels.json";
import screenshots from "./lottie/screenshots.json";
import spaces from "./lottie/spaces.json";

/** Library 分类 id → Arc 原生 Lottie。easels：本扩展没有 Easel 功能（无入口），仅备用 */
export const LIB_LOTTIE: Record<string, unknown> = { media: screenshots, downloads, spaces, archive, boosts, easels };

import { PRIMARY_CLASS, SECONDARY_CLASS, prepareLottie } from "./lottieColor";

const CSS = `
.arc-lib-lottie { display: block; width: 28px; height: 28px; }
.arc-lib-lottie svg { display: block; width: 28px !important; height: 28px !important; }
.arc-lib-lottie .${PRIMARY_CLASS} [fill]:not([fill="none"]) { fill: var(--lib-max-contrast, var(--arc-fg)); }
.arc-lib-lottie .${PRIMARY_CLASS} [stroke]:not([stroke="none"]) { stroke: var(--lib-max-contrast, var(--arc-fg)); }
.arc-lib-lottie .${SECONDARY_CLASS} [fill]:not([fill="none"]) { fill: var(--lib-cutout, var(--arc-bg, transparent)); }
.arc-lib-lottie .${SECONDARY_CLASS} [stroke]:not([stroke="none"]) { stroke: var(--lib-cutout, var(--arc-bg, transparent)); }
.arc-lib-lottie .${PRIMARY_CLASS} > * { opacity: .7; }
.arc-lib-lottie .${SECONDARY_CLASS} > * { opacity: 0; }
.arc-lib-item.active .arc-lib-lottie .${PRIMARY_CLASS} > *, .arc-lib-item.active .arc-lib-lottie .${SECONDARY_CLASS} > * { opacity: 1; }
`;
/* ── SemanticColorPalette 推导（rSP 0x100d6b6c8 / 0x100d7f31c）──
 * 由 Space 基色（--arc-space，没有时用 sidepanel.css 里 --arc-accent 的同一默认色）按 WCAG 相对亮度推出色调：
 *   T0 亮度 ∈ [0.85, 0.95]（最亮），T3 亮度 ∈ [0, 0.1]（最暗），步长 0.01。
 * 调色板①：maxContrast = T3、cutout = T0；调色板②：maxContrast = T0、cutout = T3。
 * 注意：①=浅色外观、②=深色外观 是 Rea 按亮度做的推断，源码里没追到 light/dark 的接线（⛔）。
 * 每步“调亮 / 调暗 0.01”的具体算法（FUN_1009a66ec / 1009a6780）未逐行还原：这里按 0.01 向白 / 黑混合近似（⛔）。 */
export type RGB = [number, number, number];
const lum = ([r, g, b]: RGB) => { const f = (c: number) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const mix = (c: RGB, t: number, k: number): RGB => c.map(v => v + (t - v) * k) as RGB;
function tone(base: RGB, lo: number, hi: number): RGB {
    for (let k = 0; k <= 1.0001; k += 0.01) { const c = mix(base, 255, k); if (lum(c) >= lo) { if (lum(c) <= hi) return c; break; } }
    for (let k = 0; k <= 1.0001; k += 0.01) { const c = mix(base, 0, k); if (lum(c) <= hi && lum(c) >= lo) return c; }
    return lum(base) < lo ? [255, 255, 255] : [0, 0, 0];
}
function parseColor(css: string): RGB | null {
    const m = css.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/); return m ? [+m[1], +m[2], +m[3]] : null;
}
const isDark = () => { const t = document.documentElement.dataset.theme; return t === "dark" || (t !== "light" && matchMedia("(prefers-color-scheme: dark)").matches); };
const css = ([r, g, b]: RGB) => `rgb(${Math.round(r)} ${Math.round(g)} ${Math.round(b)})`;
/** 纯函数：基色 + 深浅 → { maxContrast, cutout }（测试用；applyLibPalette 用同一逻辑） */
export function libPalette(base: RGB, dark: boolean): { maxContrast: string; cutout: string } {
    const t0 = tone(base, 0.85, 0.95), t3 = tone(base, 0, 0.1);
    return { maxContrast: css(dark ? t0 : t3), cutout: css(dark ? t3 : t0) };
}
let lastKey = "";
/** 把 maxContrast / cutout 写到根元素（--lib-max-contrast / --lib-cutout）；Space 色或深浅变化时重算 */
export function applyLibPalette() {
    if (typeof document === "undefined") return;
    const root = document.documentElement, dark = isDark();
    const probe = document.createElement("span"); probe.style.cssText = `position:absolute;visibility:hidden;color:var(--arc-space, ${dark ? "#6e9cf2" : "#6e50e6"})`;
    document.body.append(probe); const base = parseColor(getComputedStyle(probe).color); probe.remove();
    if (!base) return;
    const key = `${base}|${dark}`; if (key === lastKey) return; lastKey = key;
    const p = libPalette(base, dark);
    root.style.setProperty("--lib-max-contrast", p.maxContrast);
    root.style.setProperty("--lib-cutout", p.cutout);
}
let watching = false;
function watchPalette() {
    if (watching || typeof document === "undefined") return; watching = true;
    new MutationObserver(() => applyLibPalette()).observe(document.documentElement, { attributes: true, attributeFilter: ["style", "data-theme"] });
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => applyLibPalette());
}
let injected = false;
function injectCss() {
    if (injected || typeof document === "undefined") return; injected = true;
    const s = document.createElement("style"); s.dataset.arc = "lib-lottie"; s.textContent = CSS; document.head.append(s);
}

export type LibIcon = { el: HTMLElement; play(): void; destroy(): void };
/** 生成 28×28 Lottie 图标；没有对应文件时返回 null（调用方用静态图标） */
export function libLottieIcon(id: string): LibIcon | null {
    const data = LIB_LOTTIE[id]; if (!data) return null;
    injectCss(); watchPalette(); applyLibPalette();
    const el = document.createElement("span"); el.className = "arc-lib-lottie"; el.setAttribute("aria-hidden", "true");
    const anim = lottie.loadAnimation({ container: el, renderer: "svg", loop: false, autoplay: false, animationData: prepareLottie(data) });
    anim.goToAndStop(0, true);
    return { el, play: () => anim.goToAndPlay(0, true), destroy: () => anim.destroy() };
}

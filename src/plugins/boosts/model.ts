import { buildTintFilter, hslMatrix, tintChain, type HslMatrixInput, type TintPrim } from "./color";
/* Boosts 数据模型与纯函数（无 chrome / DOM 依赖，供单测）。字段对齐 boosts.md §3/§4/§6/§8。 */

/** boosts.md §3 BoostColorWheelScheme。advancedSettings 只保留矩阵构造用得到的三项（boosts.md Q2）。
 * preservedSaturation 旧数据是 boolean：true 视为 1（保留原饱和度），false 视为未设置（0.5）——这个换算是我们的约定 */
export interface ColorWheelScheme {
    primaryHueDegrees: number;
    primarySaturation: number; // 0..1
    secondaryHueOffset: number; // 度
    invertLightness: boolean;
    baseAppearance: "light" | "dark";
    advancedSettings?: { preservedSaturation?: number | boolean; preservedLightness?: number; lightnessShift?: number };
}
export type BoostColorScheme = { type: "themeDriven" } | ({ type: "colorWheelDriven" } & ColorWheelScheme);

/** boosts.md §4 BoostFontOption = custom(family) | system */
export type BoostFont = { type: "system" } | { type: "custom"; family: string };

/** boosts.md §4 BoostTextTransform = capitalize | uppercase | lowercase（CSS text-transform）；null = 不改 */
export type BoostTextTransform = "capitalize" | "uppercase" | "lowercase";
export const TEXT_TRANSFORMS: BoostTextTransform[] = ["capitalize", "uppercase", "lowercase"];
/** 「Change text case」按钮循环：不改 → capitalize → uppercase → lowercase → 不改（循环顺序源码未找到，按枚举顺序） */
export const nextTextTransform = (t: BoostTextTransform | null | undefined): BoostTextTransform | null => {
    const i = t ? TEXT_TRANSFORMS.indexOf(t) : -1;
    return i + 1 < TEXT_TRANSFORMS.length ? TEXT_TRANSFORMS[i + 1] : null;
};

export interface Boost {
    id: string;
    title: string;
    /** 站点（主机名，含子域匹配） */
    host: string;
    isActive: boolean;
    css: string;
    js: string;
    font: BoostFont;
    /** 可选，旧数据没有此字段 */
    textTransform?: BoostTextTransform | null;
    zaps: string[];
    colorScheme: BoostColorScheme;
    created: number;
    updated: number;
}

export const ZAP_PREVIEW_BG = "#D9D9D9"; // ZapPreviewBackground
export const ZAP_BORDER = 3; // boostsEditorZapModalityBorderWidth
/** 字体注入选择器，boosts.md §4 */
export const FONT_SELECTOR = "*:not(i, .material-symbols-outlined, .material-icons)";
/** 互补 / 类似配色的副色相偏移。⛔ Arc 的取值源码未找到：互补取 180，类似取 30 */
export const COMPLEMENTARY_OFFSET = 180, ANALOGOUS_OFFSET = 30;

export function newBoost(host: string, now = Date.now(), id = `b${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`): Boost {
    return { id, title: host, host: normHost(host), isActive: true, css: "", js: "", font: { type: "system" }, zaps: [], colorScheme: { type: "themeDriven" }, created: now, updated: now };
}

export function normHost(h: string): string {
    return h.trim().toLowerCase().replace(/^\*\./, "").replace(/^www\./, "").replace(/\.$/, "");
}

export function hostOf(url: string | undefined): string | null {
    try { const u = new URL(url ?? ""); return /^https?:$/.test(u.protocol) ? u.hostname.toLowerCase() : null; } catch { return null; }
}

/** 站点匹配：同主机或其子域；www. 视为同站 */
export function boostMatches(b: Pick<Boost, "host">, url: string | undefined): boolean {
    const h = hostOf(url); const bh = normHost(b.host);
    if (!h || !bh) return false;
    const n = normHost(h);
    return n === bh || n.endsWith(`.${bh}`);
}

export const activeBoostsFor = (boosts: Boost[], url: string | undefined) => boosts.filter(b => b.isActive && boostMatches(b, url));

/* ---------- 配色 ---------- */
export const clampHue = (d: number) => ((Math.round(d) % 360) + 360) % 360;
export const secondaryHue = (s: ColorWheelScheme) => clampHue(s.primaryHueDegrees + s.secondaryHueOffset);
export const isComplementary = (s: ColorWheelScheme) => clampHue(s.secondaryHueOffset) === COMPLEMENTARY_OFFSET;

export function defaultWheel(): ColorWheelScheme {
    return { primaryHueDegrees: 0, primarySaturation: 0.5, secondaryHueOffset: COMPLEMENTARY_OFFSET, invertLightness: false, baseAppearance: "light" };
}

/** shuffle：随机主色相 */
export const shuffleWheel = (s: ColorWheelScheme, rnd = Math.random): ColorWheelScheme => ({ ...s, primaryHueDegrees: clampHue(rnd() * 360) });

/** 色环 → Arc HSL 矩阵输入；themeDriven / 没有配色返回 null */
export function wheelToMatrixInput(scheme: BoostColorScheme | undefined): HslMatrixInput | null {
    if (!scheme || scheme.type !== "colorWheelDriven") return null;
    const a = scheme.advancedSettings ?? {};
    const pS = typeof a.preservedSaturation === "boolean" ? (a.preservedSaturation ? 1 : undefined) : a.preservedSaturation;
    return { primaryHueDegrees: scheme.primaryHueDegrees, secondaryHueOffset: scheme.secondaryHueOffset, primarySaturation: scheme.primarySaturation,
        preservedSaturation: pS, preservedLightness: a.preservedLightness, lightnessShift: a.lightnessShift, invertLightness: scheme.invertLightness };
}

/** 配色动作，同 Arc 应用器 FUN_101177ee8：colorWheelDriven → 应用；没有配色 → 移除；themeDriven → 既不应用也不移除 */
export type ColorAction = { kind: "apply"; chain: TintPrim[] } | { kind: "remove" } | { kind: "keep" };
export function colorActionFor(boosts: Pick<Boost, "colorScheme">[]): ColorAction {
    const wheel = boosts.find(b => b.colorScheme?.type === "colorWheelDriven");
    if (wheel) return { kind: "apply", chain: tintChain(buildTintFilter(hslMatrix(wheelToMatrixInput(wheel.colorScheme)!))) };
    if (boosts.some(b => b.colorScheme?.type === "themeDriven")) return { kind: "keep" };
    return { kind: "remove" };
}

/* ---------- CSS 组装 ---------- */
/** 配色层。无法对齐：需要内核（Arc 用内核的 HSL 矩阵；整页还是逐层、图片和视频是否排除，源码未找到）。
 * 近似：content script 在 <html> 下放专用元素 <cat-boost-tint>，内含 SVG feColorMatrix（color.ts 最小二乘拟合出的 RGB 矩阵，sRGB 空间），
 * 元素本身 fixed 全屏、pointer-events:none，backdrop-filter 引用这个 SVG 滤镜。样式由 content script 以内联 !important 设置，不注入 CSS 规则：
 * 不占用页面的 html::after，不在 <html> / <body> 上设 filter（fixed 元素不跑位）。
 * 滚动：层是 fixed + contain:strict + 独立合成层，滚动不触发布局；backdrop-filter 每帧重采样的开销仍在（浏览器机制）。
 * Arc 的滤镜加在哪一层、是否跳过图片和视频：源码未找到，保持现状（图片和视频也会被调色）。 */
export const TINT_TAG = "cat-boost-tint";
export const TINT_FILTER_ID = "cat-boost-hsl";
export const COLOR_OVERLAY_SELECTOR = TINT_TAG;
const cssString = (s: string) => `"${s.replace(/["\\\n\r]/g, "")}"`;

/** 按 Arc StylesheetType 顺序组装：font → textTransform → zaps → user */
export function assembleCss(b: Pick<Boost, "css" | "font" | "zaps" | "colorScheme"> & { textTransform?: BoostTextTransform | null }): string {
    const out: string[] = [];
    if (b.font?.type === "custom" && b.font.family.trim()) out.push(`${FONT_SELECTOR} { font-family: ${cssString(b.font.family.trim())} !important; }`);
    if (b.textTransform && TEXT_TRANSFORMS.includes(b.textTransform)) out.push(`${FONT_SELECTOR} { text-transform: ${b.textTransform} !important; }`); // 与字体规则一样排除图标元素（图标字体靠连字名渲染，改大小写会坏）
    const zaps = (b.zaps ?? []).map(z => z.trim()).filter(z => z && !/[{}]/.test(z));
    if (zaps.length) out.push(`${zaps.join(",\n")} { display: none !important; }`);
    // 配色不走 CSS（Arc 的 StylesheetType 也没有颜色项），由 content script 的配色层处理（tint.ts）
    if (b.css?.trim()) out.push(b.css.trim());
    return out.join("\n");
}

export const assembleAll = (boosts: Boost[]) => boosts.map(assembleCss).filter(Boolean).join("\n");

/* ---------- 分享 ---------- */
/** boosts.md §8 CannotShareReason = hasJS | isEmpty */
export type CannotShareReason = "hasJS" | "isEmpty";

export function isEmptyBoost(b: Boost): boolean {
    return !b.css.trim() && !b.js.trim() && !(b.font.type === "custom" && b.font.family.trim()) && !b.textTransform && !b.zaps.length && b.colorScheme?.type !== "colorWheelDriven";
}

export function cannotShareReason(b: Boost): CannotShareReason | null {
    if (b.js.trim()) return "hasJS";
    if (isEmptyBoost(b)) return "isEmpty";
    return null;
}

const SHARE_PREFIX = "cat-boost:";

/** 分享码。Arc 用云端链接（Firestore boostSnapshots）分享：无法对齐，需要云端；Cat 只存本地，改为可复制的文本码 */
export function encodeShare(b: Boost): string {
    if (cannotShareReason(b)) throw new Error(cannotShareReason(b)!);
    const data = { v: 1, title: b.title, host: b.host, css: b.css, font: b.font, textTransform: b.textTransform ?? null, zaps: b.zaps, colorScheme: b.colorScheme };
    return SHARE_PREFIX + btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(data))));
}

/** 解析分享码 → 新 Boost（不会带 JS） */
export function decodeShare(code: string, now = Date.now()): Boost | null {
    const s = code.trim();
    if (!s.startsWith(SHARE_PREFIX)) return null;
    try {
        const bin = atob(s.slice(SHARE_PREFIX.length));
        const d = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0))));
        if (typeof d?.host !== "string" || !normHost(d.host)) return null;
        const b = newBoost(d.host, now);
        b.title = typeof d.title === "string" && d.title ? d.title.slice(0, 200) : b.host;
        b.css = typeof d.css === "string" ? d.css : "";
        if (d.font?.type === "custom" && typeof d.font.family === "string") b.font = { type: "custom", family: d.font.family };
        if (TEXT_TRANSFORMS.includes(d.textTransform)) b.textTransform = d.textTransform;
        b.zaps = Array.isArray(d.zaps) ? d.zaps.filter((z: unknown) => typeof z === "string") : [];
        if (d.colorScheme?.type === "colorWheelDriven") b.colorScheme = { ...defaultWheel(), ...d.colorScheme, type: "colorWheelDriven" };
        return isEmptyBoost(b) ? null : b;
    } catch { return null; }
}

/* ---------- 独立编辑器窗口 ---------- */
/** Shelf 高度 58（boosts.md §2 BoostsEditorShelfConstants.height） */
export const SHELF_HEIGHT = 58;
export const EDITOR_PARAM = "boostEditor";
/** 独立编辑器页面：只加载 page.js（page 上下文），不加载侧边栏、不启动侧边栏插件，后台也不会把它当成侧边栏。
 * 页面文件 static/boost-editor.html 属于核心（构建会原样拷贝 static/），需核心添加，内容见 EDITOR_PAGE_HTML。没有该文件时退回侧边栏内浮层编辑。 */
export const EDITOR_PAGE = "boost-editor.html";
export const editorUrl = (id: string, tabId?: number) => `${EDITOR_PAGE}?${EDITOR_PARAM}=${encodeURIComponent(id)}${tabId != null ? `&tab=${tabId}` : ""}`;
export const EDITOR_PAGE_HTML = `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>Boost</title><link rel="stylesheet" href="sidepanel.css"></head>
<body style="margin:0;height:100vh;"><script src="page.js"></script></body>
</html>
`;

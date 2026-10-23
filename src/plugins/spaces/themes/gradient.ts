/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
/* Ported from Zen Browser src/zen/spaces/ZenGradientGenerator.mjs (nsZenThemePicker):
 * colour-plane math (hue = angle, lightness = distance from centre), colour harmonies,
 * gradient composition, relative luminance / contrast ratio and the 0..1 grain steps.
 * DOM / XUL / prefs code was dropped; coordinates are normalised to a 0..1 square plane. */

export type RGB = [number, number, number];
export const EXPLICIT_LIGHTNESS = "explicit-lightness";
export const EXPLICIT_BLACKWHITE = "explicit-black-white";
export type DotType = typeof EXPLICIT_LIGHTNESS | typeof EXPLICIT_BLACKWHITE | undefined;
/** x / y in 0..1 of the plane; lightness only used by EXPLICIT_LIGHTNESS dots */
export interface Dot { x: number; y: number; type?: DotType; lightness?: number }
export interface GradientTheme {
    dots: Dot[];
    algo?: string;
    /** 0..1 — how strongly the colours cover the base (Zen "opacity") */
    opacity: number;
    /** 0..1 grain, in 1/16 steps (Zen "texture") */
    texture: number;
    scheme: "auto" | "light" | "dark";
}
export const MAX_DOTS = 3;
export const DEFAULT_THEME: GradientTheme = { dots: [], opacity: 0.5, texture: 0, scheme: "auto" };

export const HARMONIES = [
    { type: "complementary", angles: [180] },
    { type: "singleAnalogous", angles: [310] },
    { type: "splitComplementary", angles: [150, 210] },
    { type: "analogous", angles: [50, 310] },
    { type: "triadic", angles: [120, 240] },
    { type: "floating", angles: [] as number[] },
];

export function hueToRgb(p: number, q: number, t: number) {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
}
/** h, s, l in 0..1 */
export function hslToRgb(h: number, s: number, l: number): RGB {
    let r, g, b;
    if (s === 0) r = g = b = l;
    else {
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r = hueToRgb(p, q, h + 1 / 3); g = hueToRgb(p, q, h); b = hueToRgb(p, q, h - 1 / 3);
    }
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}
/** → [hue°, s 0..1, l 0..1] */
export function rgbToHsl(r: number, g: number, b: number): RGB {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let h = 0;
    if (d === 0) h = 0;
    else if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    const l = (min + max) / 2;
    const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
    return [(h * 60 + 360) % 360, s, l];
}
export const hexToRgb = (hex: string): RGB => {
    const m = hex.replace("#", "");
    const v = m.length === 3 ? m.split("").map(c => c + c).join("") : m;
    return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
};
export const rgbCss = (c: RGB, a = 1) => a >= 1 ? `rgb(${c[0]}, ${c[1]}, ${c[2]})` : `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${+a.toFixed(3)})`;

/** Zen getColorFromPosition: angle → hue; distance from centre → lightness (default) or saturation (explicit) */
export function colorFromPosition(d: Dot): RGB {
    const dx = d.x - 0.5, dy = d.y - 0.5;
    const dist = Math.sqrt(dx * dx + dy * dy);
    let angle = (Math.atan2(dy, dx) * 180) / Math.PI;
    if (angle < 0) angle += 360;
    const nd = 1 - Math.min(dist / 0.5, 1);
    let saturation = nd * 100;
    let lightness = d.lightness ?? 50;
    if (d.type !== EXPLICIT_LIGHTNESS) {
        saturation = 90 + (1 - nd) * 10;
        lightness = Math.round((1 - nd) * 100);
    }
    if (d.type === EXPLICIT_BLACKWHITE) { saturation = 0; lightness = Math.round((1 - nd) * 100); }
    const c = hslToRgb(angle / 360, saturation / 100, lightness / 100);
    return c.map(v => Math.min(255, Math.max(0, v))) as RGB;
}

/** Inverse used by the preset swatches (Zen calculateInitialPosition + data-lightness presets) */
export function dotForColor(rgb: RGB): Dot {
    const [h, s, l] = rgbToHsl(...rgb);
    const a = (h * Math.PI) / 180;
    if (s < 0.35 || l > 0.85) {
        // low-saturation colours (cream / slate): explicit lightness, saturation = closeness to centre
        const r = (1 - Math.min(s, 1)) * 0.5;
        return { x: 0.5 + r * Math.cos(a), y: 0.5 + r * Math.sin(a), type: EXPLICIT_LIGHTNESS, lightness: Math.round(l * 100) };
    }
    const r = Math.min(l, 1) * 0.5;
    return { x: 0.5 + r * Math.cos(a), y: 0.5 + r * Math.sin(a) };
}

/** Zen calculateCompliments: place the secondary dots at harmony angles around the primary dot */
export function compliments(dots: Dot[], action: "update" | "add" | "remove", algo = ""): { dots: Dot[]; algo: string } {
    if (!dots.length) return { dots: [], algo: "" };
    const n = dots.length + (action === "add" ? 1 : action === "remove" ? -1 : 0);
    let harmony = algo ? HARMONIES.find(h => h.type === algo) : undefined;
    if (harmony && action === "add") harmony = HARMONIES.find(h => h.angles.length === harmony!.angles.length + 1);
    else if (harmony && action === "remove") harmony = HARMONIES.find(h => h.angles.length === harmony!.angles.length - 1);
    if (!harmony || harmony.angles.length + 1 !== n) harmony = HARMONIES.find(h => h.angles.length + 1 === n);
    if (!harmony) return { dots: dots.slice(0, Math.max(1, n)), algo };
    const p = dots[0];
    const base = (Math.atan2(p.y - 0.5, p.x - 0.5) * 180) / Math.PI;
    const dist = Math.min(0.5, Math.hypot(p.x - 0.5, p.y - 0.5));
    const out: Dot[] = [p];
    for (const off of harmony.angles) {
        const r = (((base + off) % 360) * Math.PI) / 180;
        out.push({ x: 0.5 + dist * Math.cos(r), y: 0.5 + dist * Math.sin(r), type: p.type, lightness: p.lightness });
    }
    return { dots: out, algo: harmony.type };
}

/** Zen luminance (relative luminance, WCAG) */
export function luminance([r, g, b]: RGB) {
    const a = [r, g, b].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722;
}
export function contrastRatio(a: RGB, b: RGB) {
    const l1 = luminance(a), l2 = luminance(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}
/** percentage of rgb1 (0..100) */
export function blendColors(a: RGB, b: RGB, pct: number): RGB {
    const p = pct / 100;
    return [Math.round(a[0] * p + b[0] * (1 - p)), Math.round(a[1] * p + b[1] * (1 - p)), Math.round(a[2] * p + b[2] * (1 - p))];
}

/** Zen #getSingleRGBColor (opaque path): colour blended into the base by `opacity` */
const single = (c: RGB, base: RGB, opacity: number) => rgbCss(blendColors(c, base, opacity * 100));

/** Zen getGradient (sidebar variant): 1 colour = flat, 2 = two crossed linear layers, 3 = linear + two radials */
export function getGradient(colors: RGB[], base: RGB, opacity: number): string {
    const rotation = -30;
    if (!colors.length) return rgbCss(base);
    if (colors.length === 1) return single(colors[0], base, opacity);
    if (colors.length === 2) {
        return [
            `linear-gradient(${rotation + 180}deg, ${single(colors[0], base, opacity)} 30%, transparent 120%)`,
            `linear-gradient(${rotation}deg, ${single(colors[1], base, opacity)} 30%, transparent 120%)`,
            rgbCss(base),
        ].join(", ");
    }
    const [c2, c3, c1] = [single(colors[0], base, opacity), single(colors[1], base, opacity), single(colors[2], base, opacity)];
    return [
        `linear-gradient(-5deg, ${c1} 10%, transparent 80%)`,
        `radial-gradient(circle at 95% 0%, ${c3} 0%, transparent 75%)`,
        `radial-gradient(circle at 0% 0%, ${c2} 10%, transparent 70%)`,
        rgbCss(base),
    ].join(", ");
}

/** Zen getMostDominantColor + shouldBeDarkMode: true when light text reads better on the blended primary colour */
export function prefersLightText(colors: RGB[], base: RGB, opacity: number): boolean {
    if (!colors.length) return luminance(base) < 0.18;
    const bg = blendColors(colors[0], base, opacity * 100);
    const dark: RGB = [20, 20, 28], light: RGB = [236, 236, 243];
    return contrastRatio(bg, light) > contrastRatio(bg, dark);
}

/** Zen onTextureMouseMove: pointer angle around the dial → 0..1 in `steps` steps (top = 0) */
export function textureFromAngle(dx: number, dy: number, steps = 16) {
    let t = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
    if (t < 0) t += 360;
    t = Math.round((t / 360) * steps) / steps;
    return t === 1 ? 0 : t;
}

export const themeColors = (t: Pick<GradientTheme, "dots">) => t.dots.map(colorFromPosition);

import { describe, expect, test } from "bun:test";
import { applyHslMatrix, applyRgbMatrix, fitError, fitRgbMatrix, hslMatrix, hslToRgb, INITIAL_LIGHTNESS_RANGE, rgbToHsl, sampleColors } from "../src/plugins/boosts/color";

const base = { primaryHueDegrees: 210, secondaryHueOffset: 30, primarySaturation: 0.8, invertLightness: false };
const close = (a: number[], b: number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 6));

describe("Boosts 配色：Arc HSL 矩阵（boosts.md Q2）", () => {
    test("H 行 [0,0,p−s,0,s]，不取模", () => {
        const M = hslMatrix({ ...base, primaryHueDegrees: 300, secondaryHueOffset: 180 });
        close(M.slice(0, 5), [0, 0, 300 / 360 - 480 / 360, 0, 480 / 360]);
    });
    test("S 行：默认 pS=0.5 → [0,0.5,0,0,0.5·sat]；指定 pS", () => {
        close(hslMatrix(base).slice(5, 10), [0, 0.5, 0, 0, 0.4]);
        close(hslMatrix({ ...base, preservedSaturation: 1 }).slice(5, 10), [0, 1, 0, 0, 0]);
    });
    test("L 行：不反转 (1−3k)·L + 2k + ls；反转 (3k−1)·L + (1−k) + ls", () => {
        const k = 0.5 * 0.2 * 0.8;
        close(hslMatrix(base).slice(10, 15), [0, 0, 1 - 3 * k, 0, 2 * k]);
        close(hslMatrix({ ...base, invertLightness: true }).slice(10, 15), [0, 0, 3 * k - 1, 0, 1 - k]);
        // lightnessShift：ls = clamp((x+1)·0.5)·0.4 − 0.2
        expect(hslMatrix({ ...base, lightnessShift: 1 })[14]).toBeCloseTo(2 * k + 0.2, 6);
        expect(hslMatrix({ ...base, lightnessShift: -5 })[14]).toBeCloseTo(2 * k - 0.2, 6);
        // preservedLightness 越大 k 越小
        expect(hslMatrix({ ...base, preservedLightness: 1 })[12]).toBe(1);
        // 饱和度裁到 0..1
        expect(hslMatrix({ ...base, primarySaturation: 3 })[12]).toBeCloseTo(1 - 3 * 0.1, 6);
    });
    test("A 行恒为 [0,0,0,1,0]；lightnessRange 初始值记录", () => {
        expect(hslMatrix(base).slice(15)).toEqual([0, 0, 0, 1, 0]);
        expect(INITIAL_LIGHTNESS_RANGE).toEqual([0.1, 0.85]);
    });
    test("HSL 互转与参考实现", () => {
        for (const c of sampleColors(4)) close(hslToRgb(rgbToHsl(c)), c);
        // 越暗越接近副色相：黑色输出色相 = s
        const M = hslMatrix({ ...base, primarySaturation: 1, preservedSaturation: 0 });
        const out = rgbToHsl(applyHslMatrix(M, [0, 0, 0]));
        expect(out[0]).toBeCloseTo(240 / 360, 3);
    });
});

describe("Boosts 配色：RGB 最小二乘近似", () => {
    test("拟合矩阵形状、alpha 行不变", () => {
        const W = fitRgbMatrix(hslMatrix(base));
        expect(W).toHaveLength(20);
        expect(W.slice(15)).toEqual([0, 0, 0, 1, 0]);
        expect(W[3]).toBe(0);
    });
    test("误差量级：平均通道误差约 15–25/255，比恒等矩阵好", () => {
        for (const c of [base, { ...base, invertLightness: true, primaryHueDegrees: 120, secondaryHueOffset: 180, primarySaturation: 0.6 }]) {
            const M = hslMatrix(c), W = fitRgbMatrix(M);
            const e = fitError(M, W), id = fitError(M, [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0]);
            expect(e.mean).toBeLessThan(30);
            expect(e.mean).toBeLessThan(id.mean);
        }
        expect(applyRgbMatrix(fitRgbMatrix(hslMatrix(base)), [0.5, 0.5, 0.5]).every(v => v >= 0 && v <= 1)).toBe(true);
    });
});

describe("Boosts 配色：滤镜链（验收 51950，替换单矩阵）", () => {
    const C = (r: number, g: number, b: number): [number, number, number] => [r / 255, g / 255, b / 255];
    const to255 = (c: number[]) => c.map(v => Math.round(v * 255));
    const def = { primaryHueDegrees: 0, secondaryHueOffset: 180, primarySaturation: 0.5, invertLightness: false };
    test("公式本身：默认参数下 #222 → (41,68,57)，#fff → (245,239,239)（与验收预期一致）", async () => {
        const { applyHslMatrix: f, hslMatrix: m } = await import("../src/plugins/boosts/color");
        expect(to255(f(m(def), C(34, 34, 34)))).toEqual([41, 68, 57]);
        expect(to255(f(m(def), C(255, 255, 255)))).toEqual([245, 239, 239]);
    });
    test("旧单矩阵复现了实测的 bug：#222 → (0,139,14)", async () => {
        const { applyRgbMatrix: a, fitRgbMatrix: fit, hslMatrix: m } = await import("../src/plugins/boosts/color");
        expect(to255(a(fit(m(def)), C(34, 34, 34)))).toEqual([0, 139, 14]);
    });
    test("#222、#fff、中等亮度主色 #3366cc：与公式误差 ≤ 2/255（8 位中间结果 ≤ 10/255）", async () => {
        const { applyHslMatrix: f, buildTintFilter, hslMatrix: m, runTintChain, tintChain } = await import("../src/plugins/boosts/color");
        for (const p of [def, { primaryHueDegrees: 210, secondaryHueOffset: 30, primarySaturation: 1, invertLightness: true }, { primaryHueDegrees: 300, secondaryHueOffset: 90, primarySaturation: 1, invertLightness: false }]) {
            const M = m(p), chain = tintChain(buildTintFilter(M));
            for (const c of [C(34, 34, 34), C(255, 255, 255), C(51, 102, 204)]) {
                const want = f(M, c);
                runTintChain(chain, c).forEach((v, i) => expect(Math.abs(v - want[i]) * 255).toBeLessThanOrEqual(2));
                runTintChain(chain, c, true).forEach((v, i) => expect(Math.abs(v - want[i]) * 255).toBeLessThanOrEqual(10));
            }
        }
        expect(to255(runTintChain(tintChain(buildTintFilter(m(def))), C(34, 34, 34)))).toEqual([41, 68, 57]);
    });
    test("16 级采样（4096 色）整体误差：最大 ≤ 2/255；8 位中间结果最大 ≤ 10/255、平均 ≤ 2/255", async () => {
        const { hslMatrix: m, sampleColors, tintError } = await import("../src/plugins/boosts/color");
        for (const p of [def, { ...def, invertLightness: true, primaryHueDegrees: 120, primarySaturation: 0.6 }, { primaryHueDegrees: 210, secondaryHueOffset: 30, primarySaturation: 1, invertLightness: true }]) {
            expect(tintError(m(p), sampleColors(16)).max).toBeLessThanOrEqual(2);
            const q = tintError(m(p), sampleColors(16), true);
            expect(q.max).toBeLessThanOrEqual(10);
            expect(q.mean).toBeLessThanOrEqual(2);
        }
    });
    test("配色动作输出滤镜链；tint 层用 sRGB 插值", async () => {
        const { colorActionFor } = await import("../src/plugins/boosts/model");
        const a = colorActionFor([{ colorScheme: { type: "colorWheelDriven", ...def, baseAppearance: "light" } } as never]);
        expect(a.kind).toBe("apply");
        if (a.kind === "apply") expect(a.chain.at(-1)?.result).toBe("out");
        expect(await Bun.file("src/plugins/boosts/tint.ts").text()).toContain('setAttribute("color-interpolation-filters", "sRGB")');
    });
});

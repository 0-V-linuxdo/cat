/* Boosts 配色（纯函数，可单测）。
 * 无法对齐：需要内核。Arc 用内核里的 Skia HSLMatrixColorFilter（ArcHSLAMatrix，4×5 HSLA 矩阵，boosts.md「补充：配色滤镜实现」Q1/Q2）；
 * 整页还是逐层、图片和视频是否排除：源码未找到。扩展只能在 RGB 空间近似（见 fitRgbMatrix）。 */

/** Arc initialPreservedSaturation / initialPreservedLightness = 0.5，initialLightnessShift = 0（boosts.md Q2） */
export const INITIAL_PRESERVED_SATURATION = 0.5;
export const INITIAL_PRESERVED_LIGHTNESS = 0.5;
export const INITIAL_LIGHTNESS_SHIFT = 0;
/** Arc initialLightnessRange = (0.1, 0.85)。文档未给出它在矩阵构造里的用法，这里只记录，不参与计算 */
export const INITIAL_LIGHTNESS_RANGE = [0.1, 0.85] as const;

export interface HslMatrixInput {
    primaryHueDegrees: number;
    secondaryHueOffset: number;
    primarySaturation: number;
    preservedSaturation?: number;
    preservedLightness?: number;
    lightnessShift?: number;
    invertLightness: boolean;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** Arc 矩阵构造（FUN_101146b24）：4 行 × 5 列，行序 H、S、L、A，每行 [H, S, L, A 系数, 常数] */
export function hslMatrix(i: HslMatrixInput): number[] {
    const p = i.primaryHueDegrees / 360;
    const s = (i.primaryHueDegrees + i.secondaryHueOffset) / 360; // 不取模（同 Arc）
    const pS = i.preservedSaturation ?? INITIAL_PRESERVED_SATURATION;
    const pL = i.preservedLightness ?? INITIAL_PRESERVED_LIGHTNESS;
    const k = (1 - pL) * 0.2 * clamp01(i.primarySaturation);
    const ls = clamp01(((i.lightnessShift ?? INITIAL_LIGHTNESS_SHIFT) + 1) * 0.5) * 0.4 - 0.2;
    const L = i.invertLightness ? [0, 0, 3 * k - 1, 0, (1 - k) + ls] : [0, 0, 1 - 3 * k, 0, 2 * k + ls];
    return [
        0, 0, p - s, 0, s,
        0, pS, 0, 0, (1 - pS) * i.primarySaturation,
        ...L,
        0, 0, 0, 1, 0,
    ];
}

/* ---------- 参考实现：Skia HSL 矩阵滤镜（RGB → HSL → M·hsla+offset → RGB） ---------- */
export type RGB = [number, number, number]; // 0..1

export function rgbToHsl([r, g, b]: RGB): RGB {
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
    if (d === 0) return [0, 0, l];
    const s = d / (1 - Math.abs(2 * l - 1));
    let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6; if (h < 0) h += 1;
    return [h, s, l];
}
export function hslToRgb([h, s, l]: RGB): RGB {
    const c = (1 - Math.abs(2 * l - 1)) * s, hp = (((h % 1) + 1) % 1) * 6, x = c * (1 - Math.abs((hp % 2) - 1)), m = l - c / 2;
    const [r, g, b] = hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
    return [r + m, g + m, b + m];
}
/** 按 HSL 矩阵变换一个颜色（色相取模，饱和度 / 明度裁到 0..1） */
export function applyHslMatrix(M: number[], rgb: RGB): RGB {
    const v = [...rgbToHsl(rgb), 1];
    const row = (i: number) => M[i * 5] * v[0] + M[i * 5 + 1] * v[1] + M[i * 5 + 2] * v[2] + M[i * 5 + 3] * v[3] + M[i * 5 + 4];
    return hslToRgb([row(0), clamp01(row(1)), clamp01(row(2))]);
}

/* ---------- 旧近似（51950 前在用，已停用，仅留作对比测试）：最小二乘拟合单个 RGB 仿射矩阵。深色上误差极大，见下方“现用”说明 ---------- */
/** 采样网格：sRGB 每通道 N 级（默认 7 级 = 343 色，覆盖灰阶、饱和色和中间色） */
export function sampleColors(n = 7): RGB[] {
    const out: RGB[] = [];
    for (let r = 0; r < n; r++) for (let g = 0; g < n; g++) for (let b = 0; b < n; b++) out.push([r / (n - 1), g / (n - 1), b / (n - 1)]);
    return out;
}

/** 解 4×4 正规方程（高斯消元） */
function solve4(A: number[][], y: number[]): number[] {
    const m = A.map((row, i) => [...row, y[i]]);
    for (let c = 0; c < 4; c++) {
        let p = c; for (let r = c + 1; r < 4; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
        [m[c], m[p]] = [m[p], m[c]];
        const d = m[c][c] || 1e-12;
        for (let r = 0; r < 4; r++) if (r !== c) { const f = m[r][c] / d; for (let k = c; k < 5; k++) m[r][k] -= f * m[c][k]; }
    }
    return m.map((row, i) => row[4] / (row[i] || 1e-12));
}

/** 在采样色上拟合 out ≈ W·[r,g,b,1]，返回 feColorMatrix 的 20 个值（sRGB 空间，第 4 行保持 alpha） */
export function fitRgbMatrix(M: number[], samples: RGB[] = sampleColors()): number[] {
    const AtA = [0, 1, 2, 3].map(() => [0, 0, 0, 0]);
    const Aty = [0, 1, 2].map(() => [0, 0, 0, 0]);
    for (const c of samples) {
        const x = [c[0], c[1], c[2], 1], y = applyHslMatrix(M, c);
        for (let i = 0; i < 4; i++) { for (let j = 0; j < 4; j++) AtA[i][j] += x[i] * x[j]; for (let o = 0; o < 3; o++) Aty[o][i] += x[i] * y[o]; }
    }
    const rows = [0, 1, 2].map(o => solve4(AtA, Aty[o]));
    const out: number[] = [];
    for (const [a, b, c, d] of rows) out.push(a, b, c, 0, d);
    out.push(0, 0, 0, 1, 0);
    return out.map(v => Math.round(v * 1e4) / 1e4);
}

export function applyRgbMatrix(W: number[], [r, g, b]: RGB): RGB {
    const f = (i: number) => clamp01(W[i * 5] * r + W[i * 5 + 1] * g + W[i * 5 + 2] * b + W[i * 5 + 4]);
    return [f(0), f(1), f(2)];
}

/** 拟合误差：采样色上与 Arc 参考结果的平均 / 最大通道误差（0..255） */
export function fitError(M: number[], W: number[], samples: RGB[] = sampleColors()): { mean: number; max: number } {
    let sum = 0, max = 0, n = 0;
    for (const c of samples) {
        const a = applyHslMatrix(M, c), b = applyRgbMatrix(W, c);
        for (let i = 0; i < 3; i++) { const e = Math.abs(a[i] - b[i]) * 255; sum += e; max = Math.max(max, e); n++; }
    }
    return { mean: sum / n, max };
}

/* ---------- 浏览器近似（现用）：精确求输入 L 与色度 C，再按 L 查表 ----------
 * 验收 51950：单个 RGB 仿射矩阵在深色上严重失真（#222 → (0,139,14)，Arc 公式应为约 (41,68,57)）。参数传递、sRGB 插值、行列顺序、0..1 偏移都没错，
 * 原因是 Arc 的 H 行 = (p−s)·L + s、L 行只含 L、S 行只含 S：输出色相随输入明度变，这在 RGB 里是非线性的，一个矩阵拟合不出来。
 * 推导：H、L 输出只依赖输入 L；S 输出 = pS·S + c0；HSL→RGB 在 H、L 固定时对饱和度线性，所以
 *   out = G(L) + C · W(L)，G(L) = 同明度灰色套公式的结果，C = max−min，W(L) = pS·(1−|2L′−1|)/(1−|2L−1|)·(e(H(L)) − ½)。
 * L = (max+min)/2 和 C 都能用 SVG 滤镜精确求：|x| 用 feComponentTransfer 表 [1 0 1]（对 ½+x/2 取值），
 *   max(r,g) = (r+g+|r−g|)/2、min 同理，再和 b 比一次；三数两两差绝对值之和 = 2(max−min)。
 * 剩余误差只来自查表插值和输出饱和度超过 1 时的裁剪（Arc 在 HSL 里裁到 1，这里在 RGB 里裁）。
 * 滤镜链定义为数据（TINT_CHAIN），tint.ts 照着建 DOM，测试用 runTintChain 逐步模拟（每步裁到 0..1，同 SVG），两边是同一份定义。 */
export const LUT_SIZE = 65;

export interface TintFilter {
    /** G(L)：feFuncR / G / B 的 tableValues */
    gray: [number[], number[], number[]];
    /** W′(L) = ½ + W/(2K)：feFuncR / G / B 的 tableValues */
    chroma: [number[], number[], number[]];
    /** W 的缩放（≥ ½，保证 alpha 仍为 1） */
    k: number;
}

/** feComponentTransfer type="table" 的线性插值（同 SVG 规范） */
export function lookup(table: number[], x: number): number {
    const n = table.length - 1, t = clamp01(x) * n, k = Math.min(n - 1, Math.floor(t));
    return table[k] + (t - k) * (table[k + 1] - table[k]);
}

export function buildTintFilter(M: number[]): TintFilter {
    const gray: TintFilter["gray"] = [[], [], []];
    const w: number[][] = [[], [], []];
    const pS = M[6];
    for (let i = 0; i < LUT_SIZE; i++) {
        const L = i / (LUT_SIZE - 1);
        const g = applyHslMatrix(M, [L, L, L]);
        const H = M[2] * L + M[4], L2 = clamp01(M[12] * L + M[14]);
        const e = hslToRgb([H, 1, 0.5]);
        const den = 1 - Math.abs(2 * L - 1);
        const f = den > 1e-3 ? (1 - Math.abs(2 * L2 - 1)) / den : 0; // L 接近 0 / 1 时 C 也趋近 0
        for (let ch = 0; ch < 3; ch++) { gray[ch].push(g[ch]); w[ch].push(pS * Math.min(f, 50) * (e[ch] - 0.5)); }
    }
    const k = Math.max(0.5, ...w.flat().map(Math.abs));
    const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
    return { gray: gray.map(t => t.map(r4)) as TintFilter["gray"], chroma: w.map(t => t.map(v => r4(0.5 + v / (2 * k)))) as TintFilter["chroma"], k: r4(k) };
}

/** SVG 滤镜原语（只用到这三种） */
export type TintPrim =
    | { op: "matrix"; in: string; result: string; values: number[] }
    | { op: "table"; in: string; result: string; tables: [number[], number[], number[]] }
    | { op: "arith"; in: string; in2: string; result: string; k: [number, number, number, number] };

const ABS = [1, 0, 1];
const mat = (rows: number[][]) => [...rows.flat(), 0, 0, 0, 1, 0];
const row = (r: number, g: number, b: number, c: number) => [r, g, b, 0, c];

/** 滤镜链（in = "SourceGraphic" 表示 backdrop）；最后一个原语的结果就是输出 */
export function tintChain(f: TintFilter): TintPrim[] {
    const h = 0.5;
    return [
        // 两两差：R = ½+(r−g)/2，G = ½+(g−b)/2，B = ½+(b−r)/2 → 取绝对值
        { op: "matrix", in: "SourceGraphic", result: "d", values: mat([row(h, -h, 0, h), row(0, h, -h, h), row(-h, 0, h, h)]) },
        { op: "table", in: "d", result: "ad", tables: [ABS, ABS, ABS] }, // |r−g|, |g−b|, |b−r|
        // C = (|r−g|+|g−b|+|b−r|)/2，放到三个通道
        { op: "matrix", in: "ad", result: "C", values: mat([row(h, h, h, 0), row(h, h, h, 0), row(h, h, h, 0)]) },
        // R = ½+(max(r,g)−b)/2 = ½ + (r+g−2b)/4 + |r−g|/4；G = ½+(min(r,g)−b)/2 = ½ + (r+g−2b)/4 − |r−g|/4
        { op: "matrix", in: "SourceGraphic", result: "x", values: mat([row(0.25, 0.25, -0.5, h), row(0.25, 0.25, -0.5, h), row(0, 0, 0, 0)]) },
        { op: "matrix", in: "ad", result: "rg", values: mat([row(0.25, 0, 0, h), row(-0.25, 0, 0, h), row(0, 0, 0, 0)]) },
        { op: "arith", in: "x", in2: "rg", result: "mb", k: [0, 1, 1, -h] },
        { op: "table", in: "mb", result: "amb", tables: [ABS, ABS, ABS] }, // R = |max(r,g)−b|，G = |min(r,g)−b|
        // L = (max+min)/2 = (r+g+2b)/4 + (|max(r,g)−b| − |min(r,g)−b|)/4
        { op: "matrix", in: "SourceGraphic", result: "s", values: mat([row(0.25, 0.25, h, 0), row(0.25, 0.25, h, 0), row(0.25, 0.25, h, 0)]) },
        { op: "matrix", in: "amb", result: "t", values: mat([row(0.25, -0.25, 0, h), row(0.25, -0.25, 0, h), row(0.25, -0.25, 0, h)]) },
        { op: "arith", in: "s", in2: "t", result: "L", k: [0, 1, 1, -h] },
        // 按 L 查表
        { op: "table", in: "L", result: "G", tables: f.gray },
        { op: "table", in: "L", result: "W", tables: f.chroma },
        // E = ½ + C·W = 2K·W′·C − K·C + ½；out = G + E − ½
        { op: "arith", in: "W", in2: "C", result: "E", k: [2 * f.k, 0, -f.k, h] },
        { op: "arith", in: "G", in2: "E", result: "out", k: [0, 1, 1, -h] },
    ];
}

/** 逐步模拟浏览器执行滤镜链（只看 RGB，alpha 恒为 1；每步结果裁到 0..1，同 SVG） */
/** quantize = true 时每步按 8 位缓冲取整（模拟浏览器中间结果的精度损失） */
export function runTintChain(chain: TintPrim[], src: RGB, quantize = false): RGB {
    const img: Record<string, RGB> = { SourceGraphic: src };
    let last: RGB = src;
    for (const p of chain) {
        const a = img[p.in];
        last = p.op === "matrix" ? [0, 1, 2].map(i => clamp01(p.values[i * 5] * a[0] + p.values[i * 5 + 1] * a[1] + p.values[i * 5 + 2] * a[2] + p.values[i * 5 + 3] + p.values[i * 5 + 4])) as RGB
            : p.op === "table" ? [0, 1, 2].map(i => clamp01(lookup(p.tables[i], a[i]))) as RGB
            : [0, 1, 2].map(i => { const b = img[p.in2][i]; return clamp01(p.k[0] * a[i] * b + p.k[1] * a[i] + p.k[2] * b + p.k[3]); }) as RGB;
        if (quantize) last = last.map(v => Math.round(v * 255) / 255) as RGB;
        img[p.result] = last;
    }
    return last;
}

/** 滤镜链与 Arc 公式的误差（0..255） */
export function tintError(M: number[], samples: RGB[] = sampleColors(), quantize = false): { mean: number; max: number } {
    const chain = tintChain(buildTintFilter(M));
    let sum = 0, max = 0, n = 0;
    for (const c of samples) {
        const a = applyHslMatrix(M, c), b = runTintChain(chain, c, quantize);
        for (let i = 0; i < 3; i++) { const e = Math.abs(a[i] - b[i]) * 255; sum += e; max = Math.max(max, e); n++; }
    }
    return { mean: sum / n, max };
}

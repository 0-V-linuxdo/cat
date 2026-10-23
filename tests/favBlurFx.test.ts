/* 收藏磁贴模糊底层的图像处理（fav-tile-blur.md §1–§3，等价 web 做法 §5.1）：模糊 radius 5 在源图像素（SVG viewBox 64×64 用户单位），调色 saturate 1.5 / 亮度 +.05 / 对比度 .85，
 * 画布 47、favicon 绘制边长 = 画布宽 / 5 × renderSize 16（= 320%），居中，两轴拉伸，无 outset。 */
import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { FAV_BLUR, contrastTransfer, blurDrawPercent } from "../src/plugins/spaces/favorites/blurFx";
const r = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const style = r("src/plugins/spaces/style.ts"), css = style.replace(/\/\*[\s\S]*?\*\//g, ""), fav = r("src/plugins/spaces/favorites/index.ts");

test("参数 = Rea 文档：radius 5、饱和度 1.5、亮度 +0.05、对比度 0.85、画布 47、renderSize 16", () => {
    expect(FAV_BLUR).toMatchObject({ radius: 5, saturation: 1.5, brightness: 0.05, contrast: 0.85, canvas: 47, renderSize: 16, srcPx: 64 });
});
test("亮度（加法）+ 对比度（绕 0.5）合成线性变换：slope .85、intercept .1175（⛔ 内部公式 / 顺序为假定）", () => {
    expect(contrastTransfer()).toEqual({ slope: 0.85, intercept: 0.1175 });
    expect(contrastTransfer(1, 0)).toEqual({ slope: 1, intercept: 0 }); // 无调整 = 恒等
});
test("绘制边长占磁贴 = renderSize / 5 = 320%，CSS --fav-render 与之一致；多项 12 → 240%", () => {
    expect(blurDrawPercent()).toBe(320); expect(blurDrawPercent(12)).toBe(240);
    expect(style).toContain(`--fav-render: ${FAV_BLUR.renderSize};`);
    expect(style).toMatch(/\.arc-fav-blur > svg \{[^}]*width: calc\(var\(--fav-render\) \* 20%\); height: calc\(var\(--fav-render\) \* 20%\);[^}]*translate\(-50%, -50%\)/);
});
test("模糊在 viewBox（源图像素）里：svg viewBox 0 0 srcPx、preserveAspectRatio none（两轴拉伸）；滤镜 stdDeviation = radius、saturate、feComponentTransfer；不用 CSS blur / cover / outset", () => {
    expect(fav).toMatch(/viewBox: `0 0 \$\{srcPx\} \$\{srcPx\}`, preserveAspectRatio: "none"/);
    expect(fav).toContain('mk("feGaussianBlur", { stdDeviation: String(radius) })');
    expect(fav).toContain('type: "saturate", values: String(saturation)');
    expect(fav).toContain("feComponentTransfer");
    expect(fav).toContain('"color-interpolation-filters": "sRGB"');
    expect(css).not.toMatch(/cover|inset: calc|filter: blur|--fav-blur-r/);
});
test("层 inset:0（Arc 无 outset），裁剪靠磁贴 overflow:hidden；⛔ 项都写在注释里", () => {
    expect(style).toContain(".arc-fav-blur { position: absolute; inset: 0; opacity: var(--fav-blur-a); pointer-events: none; }");
    for (const k of ["CIContext() 默认工作色彩空间", "continuous", "isDimmed 未追到", "磁贴实际宽高", "favicon 实际像素尺寸", "明暗切换是否触发重新生成"]) expect(style).toContain(k);
});

/* 收藏磁贴模糊底层的图像处理参数（Arc AppTrayVisualEffectImageProvider；/workspace/arc-analysis/fav-tile-blur.md）。
 * 数值全部来自 Rea 文档：§1.3 CIGaussianBlur radius 5（源图像素、缩放前）→ CIColorControls 饱和度 1.5 / 亮度 +0.05 / 对比度 0.85；
 * §1.4 单项磁贴画布 47×47、favicon 绘制边长 = 画布宽 / 5 × renderSize（renderSize 单项 16 / 多项 12）、居中；§2 两轴各自拉伸铺满。没有主色提取、没有 tint。
 * 下面「等价 web 做法」是由这些数值推出来的，不是源码常量（§5.1），见 spaces/style.ts .arc-fav-blur 的 ⛔ 注释；repro 验证见 patches/fav-tile-blur2/README.md。 */
export const FAV_BLUR = {
    /** 源图像素边长：faviconUrl(url, 64) 请求 64px；Arc 实际 favicon 的像素尺寸 ⛔。模糊半径按这个坐标系（SVG viewBox）算，等价于“缩放前的源图像素” */
    srcPx: 64,
    radius: 5, saturation: 1.5, brightness: 0.05, contrast: 0.85,
    /** 单项磁贴的画布边长（pt，与磁贴真实 bounds 无关）；favicon renderSize 单项 16 / 多项 12（收藏磁贴 items.count == 1 是推断 ⛔） */
    canvas: 47, renderSize: 16,
} as const;

/** CIColorControls 的亮度（加法 +0.05）和对比度（绕 0.5）合成一次线性变换 out = slope·in + intercept：
 * ⛔ CoreImage 内部公式 / 运算顺序 / 工作色彩空间没追到（Rea §1.3、§6.5）。这里假定 饱和度 → (+亮度) → 绕 0.5 的对比度：out = (in + b − 0.5)·c + 0.5 = c·in + (0.5·(1 − c) + b·c) = 0.85·in + 0.1175；
 * CSS brightness() 是乘法，不能直接用。 */
export function contrastTransfer(c: number = FAV_BLUR.contrast, b: number = FAV_BLUR.brightness): { slope: number; intercept: number } {
    return { slope: c, intercept: +(0.5 * (1 - c) + b * c).toFixed(4) };
}

/** 磁贴里模糊图的边长占磁贴宽 / 高的百分比：(画布宽 / 5 × renderSize) ÷ 画布宽 = renderSize / 5（单项 16 → 320%）。两轴各自拉伸时宽按磁贴宽、高按磁贴高（高 47 = 画布高）算 */
export const blurDrawPercent = (renderSize: number = FAV_BLUR.renderSize): number => renderSize / 5 * 100;

/* Peek 几何（sidebar-features.md:472，T-S23）：卡片宽 = 父窗口宽 × 0.8（cardWidthFactor）。
 * 不再夹 720 / pw−160 / 1280（审计 52193 M-02：无出处）。高度公式、Little Arc 尺寸 ⛔（M-03，未改）。 */
export const PEEK_CARD_WIDTH_FACTOR = 0.8;
export const peekWidth = (parentWidth: number) => Math.round(parentWidth * PEEK_CARD_WIDTH_FACTOR);

/* 高度（M-03 ⛔：Rea 无 Peek 高度公式）。默认公式沿用插件原值（k = 0.8）：min(ph − 48, ph × min(0.94, k + 0.1))，⛔ 无出处。
 * 「自定义大小」是 Arc 没有的额外选项（Cat 决定：保留、默认关闭）：只有用户显式打开（customSize = true）时，size% 才代入 k。
 * 宽度始终 = 父窗口 × 0.8，不受该选项影响。 */
export const PEEK_DEFAULT_K = 0.8;
export function peekHeight(parentHeight: number, customSize: boolean, sizePct: number): number {
    const k = customSize && Number.isFinite(sizePct) ? sizePct / 100 : PEEK_DEFAULT_K;
    return Math.round(Math.min(parentHeight - 48, parentHeight * Math.min(0.94, k + 0.1)));
}

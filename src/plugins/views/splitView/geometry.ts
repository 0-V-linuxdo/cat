/* 分屏拖动比例：最小窗格 220（sidebar-features.md:471，T-S16）。替换原无出处的 0.1 / 0.9 夹值。
 * 两窗格合计不足 2×220 时无法同时满足 → 居中 0.5（⛔ Arc 此时行为未知）。 */
export const SPLIT_MIN_PANE = 220;
export function splitRatio(pos: number, total: number, min = SPLIT_MIN_PANE): number {
    if (!(total > 0)) return 0.5;
    const lo = min / total, hi = 1 - lo;
    if (lo > hi) return 0.5;
    return Math.min(hi, Math.max(lo, pos / total));
}

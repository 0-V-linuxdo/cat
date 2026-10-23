/* Library 共用搜索框的占位符（Rea library-search-placeholder.md，PageHeaderView，rIon/1026e91d0.c L257–271）：
 * 标题（PageHeaderView.title，即页面标题）为空 → "Search…"；否则 "Search " + 标题 + "…"（U+2026，不是三个点）。
 * 各页传入的标题（PageItemsContainer 构造点）：Archive 页恒为 "Archive"（"Search Archive…"）；Boosts 页恒为 "Boosts"（"Search Boosts…"）；
 * Downloads 页条件为真时 "Downloads"（"Search Downloads…"），否则空串（"Search…"）——条件字段 ⛔ 未解码（rJ2/1027685b4.c L80–92），暂按 "Downloads" 处理。
 * Media / Easels & Notes / Spaces 页没找到搜索框（⛔ 只有反向推断）。
 * 本地化：en 用 "Search {0}…"；zh 的 "搜索{0}…" 是沿用原译文的形式，Arc 中文本地化 ⛔ 未找到。 */
import { tr } from "@api/i18n";

export function searchPlaceholder(title: string): string {
    return title ? tr("library.searchTitled", title) : tr("library.search");
}

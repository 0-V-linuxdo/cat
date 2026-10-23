/* 左右边距检查（仿 align.ts）：以地址栏 .arc-urlbar 左右边为基准，量各区块的左右偏移（px，正 = 比地址栏更靠内）。
 * 收藏网格：第一行首格左边 / 末格右边应与地址栏左右边一致（≤1px，favorites-grid.md：等分铺满）。 */
export interface InsetRow { name: string; dL: number; dR: number }
export interface InsetReport { urlbar: [number, number] | null; rows: InsetRow[]; fav: InsetRow | null }

const SECTIONS: Array<[string, string]> = [
    ["space", ".arc-space-title"], ["pinned", ".arc-slot-pinned .arc-tab, .arc-slot-pinned .arc-folder-head"], ["pinnedDivider", ".arc-divider"],
    ["todayHead", ".arc-today-head"], ["today", ".arc-slot-today .arc-tab"], ["newtab", ".arc-newtab"], ["bottom", ".arc-slot-bottom"],
];

export function measureInsets(doc: Document): InsetReport {
    const bar = doc.querySelector<HTMLElement>(".arc-urlbar");
    if (!bar?.offsetParent) return { urlbar: null, rows: [], fav: null };
    const u = bar.getBoundingClientRect();
    const rel = (name: string, l: number, r: number): InsetRow => ({ name, dL: +(l - u.left).toFixed(2), dR: +(u.right - r).toFixed(2) });
    const rows: InsetRow[] = [];
    for (const [name, sel] of SECTIONS) {
        const el = [...doc.querySelectorAll<HTMLElement>(sel)].find(e => e.offsetParent);
        if (el) { const b = el.getBoundingClientRect(); rows.push(rel(name, b.left, b.right)); }
    }
    const tiles = [...doc.querySelectorAll<HTMLElement>(".arc-fav-grid .arc-fav-tile")].filter(t => t.offsetParent).map(t => t.getBoundingClientRect());
    let fav: InsetRow | null = null;
    if (tiles.length) { const row1 = tiles.filter(t => Math.abs(t.top - tiles[0].top) < 1); fav = rel("favorites", row1[0].left, row1[row1.length - 1].right); }
    return { urlbar: [u.left, u.right], rows, fav };
}

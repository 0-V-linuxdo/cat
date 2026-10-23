/* 行对齐检查：每一行“图标中心 y”与“文字中心 y”的差 ≤ 1px；同一列中的行（标签 / 文件夹 / 新标签页 / Space 标题）图标左边 x 一致（缩进行按层级 16px 递增） */
/** drift：偏离固定网址的固定行里的斜杠（.arc-drift，4×15）。Rea（pinned-hover.md）：图标→斜杠 0、斜杠→标题 4，所以标题起点比普通行晚 2px（42 对 40）——这是设计，不算未对齐 */
export interface AlignRow { kind: string; text: string; dy: number; x: number; depth: number; tx: number | null; drift?: { gapIcon: number; gapTitle: number } }
export interface AlignReport { rows: AlignRow[]; badY: AlignRow[]; badX: AlignRow[]; badTextX: AlignRow[]; baseX: number | null; baseTextX: number | null }

const KINDS: Array<[string, string]> = [
    ["tab", ".arc-tab"], ["folder", ".arc-folder-head"], ["newtab", ".arc-newtab"], ["space", ".arc-space-title"],
    ["menu", ".arc-menu:not([hidden]) .arc-menu-item"], ["cmd", ".arc-cmd-results .arc-list-row"], ["list", ".arc-overlay .arc-list-row"],
    ["bottom", ".arc-slot-bottom button"],
];
const ICON = ".arc-fav, .arc-folder-icon, .arc-space-icon, .arc-svg, img";
/** 行里第一个图标。Space 标题行：idle 可见的是 .arc-space-icon（折叠箭头与它共用一个 24×24 槽，idle opacity 0），所以优先量它；没有图标时才退回箭头 */
function pickIcon(row: Element): Element | null {
    if (row.classList.contains("arc-space-title")) return row.querySelector(".arc-space-icon .arc-svg, .arc-space-icon img, .arc-space-icon") ?? row.querySelector(ICON);
    return row.querySelector(ICON);
}
/** 进入左侧图标列的行 */
const COLUMN = new Set(["tab", "folder", "newtab", "space"]);

function textRect(el: Element, skip: Element | null): DOMRect | null {
    const w = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
        if (!n.textContent?.trim() || (skip && skip.contains(n))) continue;
        const r = el.ownerDocument.createRange(); r.selectNodeContents(n);
        const b = r.getBoundingClientRect();
        if (b.height) return b;
    }
    return null;
}

function driftOf(row: Element, ib: DOMRect | undefined, tb: DOMRect | null): { drift?: { gapIcon: number; gapTitle: number } } {
    const sl = row.querySelector(".arc-drift"); if (!sl || !ib || !tb) return {};
    const sb = sl.getBoundingClientRect(); if (!sb.width) return {};
    return { drift: { gapIcon: +(sb.left - ib.right).toFixed(2), gapTitle: +(tb.left - sb.right).toFixed(2) } };
}

export function measureAlign(doc: Document): AlignReport {
    const rows: AlignRow[] = [];
    const seen = new Set<Element>();
    for (const [kind, sel] of KINDS) {
        for (const row of doc.querySelectorAll(sel)) {
            if (seen.has(row) || !(row as HTMLElement).offsetParent) continue;
            seen.add(row);
            const icon = pickIcon(row);
            const rr = row.getBoundingClientRect();
            const ib = icon?.getBoundingClientRect();
            const tb = textRect(row, icon);
            const ref = ib ?? tb;
            if (!ref) continue;
            const iconCy = ref.top + ref.height / 2;
            const textCy = tb ? tb.top + tb.height / 2 : rr.top + rr.height / 2; // 纯图标按钮：和按钮中心比
            const pl = parseFloat((row as HTMLElement).style.paddingLeft || "0");
            const depth = pl ? Math.round((pl - 10) / 16) : 0;
            rows.push({ kind, text: (tb ? (row.textContent ?? "") : `[${kind} icon]`).trim().slice(0, 24), dy: +(textCy - iconCy).toFixed(2), x: +(kind === "space" && ib ? ib.left + ib.width / 2 - 8 : ref.left).toFixed(2), depth, tx: tb ? +tb.left.toFixed(2) : null , ...driftOf(row, ib, tb) });
        }
    }
    const col = rows.filter(r => COLUMN.has(r.kind));
    const base = col.find(r => r.depth === 0)?.x ?? null;
    // 标题起始列（相对关系，Rea pinned-slash.md ★ 结论 / space-header-layout.md §1.2 / §4.6）。全部相对「图标槽」量（槽 24，16 图标居中 → 槽左缘 = 图标左缘 − 4），不写绝对像素：
    //   非 drift（标签 / 新标签页 / 文件夹）：标题 = 槽左 + 24 + 4（customSpacing）+ 2（titleStack inset）= 图标左缘 + 26（图标 x 18 → 44；文件夹图标 17 也是 +26，Rea 44，不再有 +1）
    //   drift：槽后 0 + 斜杠 4 + 斜杠→标题 4 + inset 0 = 图标左缘 + 28（46）；图标右缘 → 斜杠左缘 = (24−16)/2 = 4（槽右留白，斜杠不贴图标）；斜杠 → 标题 4
    //   Space 标题 = 标签标题 −2（Arc：42 对 44；依赖设置页去掉 .arc-space-name 的 −4 外边距，见补丁 README）。基准 = 标签行（折算到 depth 0）标题起点的中位数（个别行带徽标 / 特殊结构时不被带偏）
    const SLOT = 24, FAV = 16, SLASH_W = 4, SLASH_TITLE = 4, CUSTOM_SP = 4, INSET = 2;
    const padR = (SLOT - FAV) / 2, titleFromIcon = (SLOT - padR) + CUSTOM_SP + INSET, driftFromIcon = (SLOT - padR) + SLASH_W + SLASH_TITLE;
    const tabTx = col.filter(r => r.kind === "tab" && r.tx != null && !r.drift).map(r => r.tx! - r.depth * 16).sort((a, b) => a - b);
    const baseT = tabTx.length ? tabTx[Math.floor(tabTx.length / 2)]! : null;
    const dTx: Record<string, number> = { tab: 0, newtab: 0, folder: 0, space: -2 };
    return {
        rows, baseX: base, baseTextX: baseT,
        badTextX: baseT == null ? [] : col.filter(r => r.tx != null && (r.drift
            ? Math.abs(r.drift.gapIcon - padR) > 1 || Math.abs(r.drift.gapTitle - SLASH_TITLE) > 1 || Math.abs(r.tx - r.x - driftFromIcon) > 1.5 // 偏离行：图标→斜杠 4（槽右留白）、斜杠→标题 4、标题 = 图标左缘 + 28（相对图标 / 斜杠量，不对基准列）
            : Math.abs(r.tx - (baseT + r.depth * 16 + (dTx[r.kind] ?? 0))) > 1.5 || (r.kind !== "space" && Math.abs(r.tx - r.x - titleFromIcon) > 1.5))), // 非 drift：同列 + 绝对关系 = 图标左缘 + 26（防整列一起偏时中位数跟着偏）
        badY: rows.filter(r => Math.abs(r.dy) > 1),
        badX: base == null ? [] : col.filter(r => Math.abs(r.x - (base + r.depth * 16)) > 1),
    };
}

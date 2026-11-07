/* 补丁 rel65-pin-unpin（用户 11/2 定，Arc 行为）：
 * ① Remove Pin（固定行右键 / 多选 Remove Pins）不再关标签：固定项移除，打开着的标签保持打开、回到 Today 顶部；不关 → 不进「最近关闭」。没打开的固定项只移除条目。
 * ② Today 行右键「Pin Tab」= 拖进「Drag tabs here to pin」区（handleDrop(tab:<id>, {})）。
 * 本文件只放纯逻辑（不 import chrome / store），单测见 tests/pinUnpinRel65.test.ts。 */

export type TodayOrder = "top" | "bottom";

export interface TabPos { id?: number; index: number }

/** 「Today 顶部」对应的 chrome.tabs.move 目标 index。
 *  order = "top"（默认，新标签在顶部）：Today 按标签条倒序显示 → 顶部 = 标签条末尾 → -1；
 *  order = "bottom"：Today 按标签条正序显示 → 顶部 = 第一个 Today 标签之前。index 是移动后的最终位置，
 *  所以按「不被移动、且排在第一个 Today 标签之前的标签数」算（被移动的标签本身在它前面时不能算进去）。没有 Today 标签 → -1。 */
export function todayTopIndex(order: TodayOrder | string | undefined, windowTabs: readonly TabPos[], todayIds: Iterable<number>, moving: Iterable<number>): number {
    if (order !== "bottom") return -1;
    const mv = new Set(moving), today = new Set(todayIds);
    const firstToday = windowTabs.filter(t => t.id != null && today.has(t.id) && !mv.has(t.id)).reduce((m, t) => Math.min(m, t.index), Infinity);
    if (firstToday === Infinity) return -1;
    return windowTabs.filter(t => t.id != null && !mv.has(t.id) && t.index < firstToday).length;
}

/** 移除的固定项里还开着的标签（含文件夹里的子项；alive 判断标签是否还在） */
export function openTabIdsOf(nodes: Iterable<{ tabId?: number; children?: unknown[] }>, alive: (id: number) => boolean): number[] {
    const out: number[] = [];
    const visit = (n: { tabId?: number; children?: unknown[] }) => {
        if (n.tabId != null && alive(n.tabId) && !out.includes(n.tabId)) out.push(n.tabId);
        for (const c of (n.children ?? []) as { tabId?: number; children?: unknown[] }[]) visit(c);
    };
    for (const n of nodes) visit(n);
    return out;
}

/* 补丁 rel63-fav-reattach（rel63 #2 (b)）：收藏 / 固定项绑定的标签被关掉时，在 tabs.onRemoved 里把 tabId 清掉（回到「未打开」）。
 * 原来关掉后留着死 id：磁贴 / 行照样显示未打开，但死 id 会让 reattachByUrl 判成「需要重新挂接」，把一个无关的同网址 Today 标签吞进收藏。
 * · 窗口整个关闭（isWindowClosing，含退出浏览器）不清：重启 / 恢复窗口后由 spaceManager 快照映射或 reattachOnRestart 按网址挂回；
 * · 旧 id 记进 closedTabId：撤销重新打开刚关闭的标签（undo reopenTabs）时据此重新关联（原来靠留着的死 id），只在 tabId 为空时用。
 * 纯逻辑：不 import chrome，原地改传进来的数据（store.update 的草稿），返回是否改动。单测见 tests/favReattachRestart.test.ts。 */
export interface ClosableItem { tabId?: number; closedTabId?: number }

/** 一组条目里，tabId === id 的清掉（记 closedTabId）。返回改了几个 */
export function clearClosedTabId(items: Iterable<ClosableItem>, id: number): number {
    let n = 0;
    for (const it of items) if (it.tabId === id) { it.closedTabId = id; delete it.tabId; n++; }
    return n;
}

/** 关标签事件要不要处理：窗口整个关闭时不处理（见文件头） */
export const shouldClearOnRemoved = (info: { isWindowClosing?: boolean } | undefined) => !info?.isWindowClosing;

/** 撤销重开：旧 id → 新 id。条目还绑着旧 id（窗口关闭等没被清的情况）照旧改；已被清的（tabId 为空）按 closedTabId 改；
 *  条目已经绑了别的活标签（关掉后又点开过）就不动。返回改了几个 */
export function rebindReopened(items: Iterable<ClosableItem>, map: Map<number, number>): number {
    let n = 0;
    for (const it of items) {
        const byLive = it.tabId != null ? map.get(it.tabId) : undefined;
        const byClosed = it.tabId == null && it.closedTabId != null ? map.get(it.closedTabId) : undefined;
        const to = byLive ?? byClosed;
        if (to != null) { it.tabId = to; delete it.closedTabId; n++; }
    }
    return n;
}

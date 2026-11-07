/*
 * 文件夹展开动画只在「刚从折叠变成展开」那一次渲染播（favicon-jitter）：
 * 原先 CSS 写成 .arc-folder[data-collapsed="false"] > .arc-folder-body { animation: arc-folder-open }，整屏重绘每次新建文件夹节点 → 动画重播，
 * 展开着的文件夹里的所有行（含 favicon）在每次标签事件时都 opacity 0→1 + 上移 4px 抖一下。
 * 现在由渲染方按 id 记住上次是否折叠：折叠 → 展开才返回 true（加 .arc-folder-opening 触发一次动画）；首次渲染 / 重绘 / 一直展开都不播。
 */
const last = new Map<string, boolean>();
export function folderOpening(id: string, collapsed: boolean): boolean {
    const prev = last.get(id);
    last.set(id, collapsed);
    return prev === true && !collapsed;
}
export const _resetFolderAnim = () => last.clear();

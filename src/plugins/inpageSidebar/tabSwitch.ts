/* 页内侧栏：切标签 / 换页面后 iframe 重建，列表滚动位置要接回去（补丁 inpage-tab-switch；纯逻辑，无 chrome / DOM 依赖，单测见 tests/inpageTabSwitch.test.ts）。
 * 背景：裁定 F（一个窗口一个活动 iframe）让 iframe 在每次切标签 / 每次导航都销毁重建；sidepanel 自己只在「同一个文档里整屏重绘」时保住 scrollTop（PanelShell.renderAll），重建后列表回到顶部。
 * 做法：iframe 里把 `.arc-scroll` 的 scrollTop 按「窗口」（不是按标签：侧栏是窗口级的，切标签应当看到同一个位置）存进 chrome.storage.session（只有扩展页 / SW 可读，页面读不到），启动时接回。
 * 约束：本文件不 import chrome.* / 不出现控制台调用。 */

/** 每个窗口一个键：互不覆盖（读改写一个大对象在多窗口会互相冲掉） */
export const scrollKey = (win: number | undefined): string | undefined => (typeof win === "number" && Number.isInteger(win) && win > 0 ? `inpageScroll:${win}` : undefined);

/** 存储里读出来的值 → 合法滚动位置（非有限数 / 负数 / 超大 = 无） */
export const parseScroll = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1e6 ? Math.round(v) : undefined);

export const SCROLL = {
    /** 启动后最长等多久（列表内容是 tabState 异步查询之后才有的）；超时按能滚到的最大值落位，之后不再干预 */
    restoreMs: 2000,
    /** 写盘去抖 */
    saveDebounceMs: 150,
} as const;

/** 一次落位尝试：内容还不够高（要滚到 saved，需要 scrollHeight − clientHeight ≥ saved）→ "wait"；够了 → 返回要设的 scrollTop；超时 → 夹到最大可滚动值（可能 0） */
export function restoreStep(i: { saved: number; scrollHeight: number; clientHeight: number; elapsedMs: number }): "wait" | number {
    const max = Math.max(0, i.scrollHeight - i.clientHeight);
    if (i.saved <= max) return i.saved === 0 ? "wait" : i.saved; // saved = 0：不用动；返回 "wait" 让调用方直到超时都不改（用户自己滚过就停）
    return i.elapsedMs >= SCROLL.restoreMs ? max : "wait";
}

/* 可降级的核心接入（提案见 /workspace/cat-plugins/core-api-proposal.md §「Tidy Tab Titles」）。
 * 按名字在 @api/Tabs 上查找导出：有就用，没有返回 null，插件不做任何改名（降级为无操作）。核心加上后不用改插件。 */
import * as Tabs from "@api/Tabs";

export interface PinnedTabInfo { nodeId: string; tabId?: number; url: string; title: string }
export interface PinnedTitleState { customTitle?: string; titleSource?: "user" | "auto" }

const pick = <F>(name: string): F | null => { const f = (Tabs as unknown as Record<string, unknown>)[name]; return typeof f === "function" ? f as F : null; };

/** 标签被固定（或加入收藏）后回调；返回注销函数 */
export const onTabPinned = (plugin: string, cb: (info: PinnedTabInfo) => void) =>
    pick<(p: string, cb: (i: PinnedTabInfo) => void) => () => void>("onTabPinned")?.(plugin, cb) ?? null;
/** 设置固定标签显示标题；source "auto" 表示插件改的（核心据此区分手动改名） */
export const setPinnedTitle = (nodeId: string, title: string, source: "auto") =>
    pick<(id: string, t: string, o: { source: "auto" }) => Promise<void> | void>("setPinnedTitle")?.(nodeId, title, { source }) ?? null;
export const getPinnedTitleState = (nodeId: string) =>
    pick<(id: string) => PinnedTitleState | undefined>("getPinnedTitleState")?.(nodeId) ?? null;
export const resetPinnedTitle = (nodeId: string) =>
    pick<(id: string) => Promise<void> | void>("resetPinnedTitle")?.(nodeId) ?? null;

export const coreReady = () => !!(pick("onTabPinned") && pick("setPinnedTitle") && pick("getPinnedTitleState"));

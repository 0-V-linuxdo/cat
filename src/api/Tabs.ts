/* 核心标签 API。discardKeep：丢弃（休眠）标签；Chromium 丢弃时可能换新 id，这里统一迁移所有按 tabId 记的状态
 * （Space 归属 / lastTab、固定项、收藏、文件夹里的固定项、自定义标题、自动归档时间……，均通过 @api/TabIdRemap 注册），
 * 并广播核心事件 tabReplaced。浏览器自身的 tabs.onReplaced 也走同一条路径（spaceManager）。 */
import { dispatch } from "@api/Events";
import { emitTabIdRemap } from "@api/TabIdRemap";

/** 标签 id 换了（丢弃 / 预渲染 / 重启映射）：迁移状态并广播 tabReplaced(from, to) */
export async function notifyTabReplaced(from: number, to: number) {
    if (from === to) return;
    await emitTabIdRemap(new Map([[from, to]]));
    dispatch("tabReplaced", { from, to }, { broadcast: true });
}

/** 丢弃标签；返回丢弃后的 id（可能是新 id），失败返回 undefined */
export async function discardKeep(tabId: number): Promise<number | undefined> {
    const nt = await chrome.tabs.discard(tabId).catch(() => undefined); /* 预期：活动标签 / 已关标签不能丢弃，返回 undefined 由调用方处理 */
    if (nt?.id == null) return undefined;
    if (nt.id !== tabId) await notifyTabReplaced(tabId, nt.id);
    return nt.id;
}

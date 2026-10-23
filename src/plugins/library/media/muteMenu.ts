/*
 * 右键菜单 “Mute” 的验证与动作规则（urlbar-menus-followup.md L467–572「Mute 细节」；构造器 out7/0x102ec18e8.c，验证器 rM/102eb7de8.c，动作 rM/1028c44b4.c）。
 * 纯函数，不依赖插件状态，标签 / 固定 / 收藏 / 多选菜单共用。
 *
 * 标题与可用（验证器 FUN_102eb7de8）：构造器总是 “Mute”（enabled = 1）；
 *   - 所有选中项都已静音（未打开的项按未静音计）→ 标题换成 “Unmute”，可点；
 *   - 否则：选中项里没有任何一个正在发声（isAudible）→ 置灰（未打开的项 isAudible = false）；至少一个在发声 → 可点。
 *   已打开但没在发声的标签，Mute 也是灰的。选中集为空时 allSatisfy 为真 → Unmute（只是理论情况）。
 * 点击（FUN_1028c44b4）：newMuted = 存在“已打开且未静音”的项；对**所有**选中项写 SidebarTab.savedMuteStatus = newMuted，再对已打开的项实际静音 / 取消静音。
 *   多选统一设成同一个状态，不是逐个翻转。
 * ⛔ savedMuteStatus 的持久化：固定项（PinNode）/ 收藏（Fav）数据里没有对应字段，Arc 重新打开时怎么用它也未分析，所以未打开的项不写任何东西（未发明存储）。
 * ⛔ 实际静音接口（local_7f0 闭包）的实现未找到；这里用 chrome.tabs.update({ muted })。
 */
import { safe } from "@api/ErrorLog";

export interface MuteItem { open: boolean; muted: boolean; audible: boolean }

/** 由标签对象得到状态；undefined = 未打开（没有 WebContentState） */
export const muteItemOf = (tab: Pick<chrome.tabs.Tab, "audible" | "mutedInfo"> | undefined): MuteItem => ({ open: !!tab, muted: !!tab?.mutedInfo?.muted, audible: !!tab?.audible });

export function muteMenuState(items: MuteItem[]): { unmute: boolean; disabled: boolean } {
    if (items.every(i => i.muted)) return { unmute: true, disabled: false };
    return { unmute: false, disabled: !items.some(i => i.audible) };
}

/** 点击后的目标状态：任一已打开且未静音 → 全部静音；否则全部取消静音 */
export const newMutedFor = (items: MuteItem[]) => items.some(i => i.open && !i.muted);

/** 菜单点击：ids 里 undefined / 已关闭的标签算未打开 */
export async function muteTabs(ids: (number | undefined)[]) {
    const tabs = await Promise.all(ids.map(id => (id == null ? undefined : chrome.tabs.get(id).catch(() => undefined /* 预期失败：标签已关 = 未打开 */))));
    const muted = newMutedFor(tabs.map(muteItemOf));
    await Promise.all(tabs.filter(t => t?.id != null).map(t => safe(chrome.tabs.update(t!.id!, { muted }), "tabs.update")));
}

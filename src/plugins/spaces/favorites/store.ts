/* 收藏数据（单独成模块，供固定区 / 今日区 / 空间的拖放处理引用，不必加载收藏界面） */
import { createPluginStore } from "@api/Storage";

export interface Fav {
    id: string; url: string; title: string; tabId?: number;
    /** 补丁 rel63-fav-reattach：绑定的标签被关掉时记下的旧 id（tabId 同时清空），只给撤销重开重新关联用（pinnedTabs/closedTab.ts） */ closedTabId?: number;
    /** 自定义图标：emoji 或图片网址 */ icon?: string;
    /** 自定义名称（右键 Rename…，Arc renameFavorite(12)）；设了就优先于标签标题 / 收藏时的标题 */ customTitle?: string;
    /** 保存的 favicon（Arc SidebarTab.savedFavicon）：只由 Replace Pinned URL with Current 写入（新值非空才覆盖），Duplicate 复制；磁贴在没有自定义图标、也没有打开的标签的 favicon 时用它。⛔ 回退顺序未追到 */ favicon?: string;
}
/** 收藏显示的名称：非空自定义名称 → 打开的标签标题 → 保存的标题 → 网址（Replace 会把保存的标题无条件写成当前页标题，可能为空） */
export const favTitle = (f: Pick<Fav, "title" | "customTitle"> & { url?: string }, tab?: { title?: string }) => f.customTitle || tab?.title || f.title || f.url || "";
export const favStore = createPluginStore<{ items: Fav[] }>("favorites", () => ({ items: [] }));
/** 改收藏名称；空字符串 = 清除自定义名称（⛔ Arc 清空后的行为待 Rea 核对） */
export const renameFav = (id: string, title: string) => favStore.update(x => { const it = x.items.find(i => i.id === id); if (it) it.customTitle = title.trim() || undefined; });

/** 恢复默认图标：Change Icon… 弹出框头部的删除按钮（canRemoveIcon，点击 = didSelectIcon(nil)）调用；清空后沿用现有 favicon 显示（⛔ Arc 的回退代码未追到） */
export const resetFavIcon = (id: string) => favStore.update(x => { const it = x.items.find(i => i.id === id); if (it) delete it.icon; });

/** Replace Pinned URL with Current（Arc FUN_1029e32d4，urlbar-menus-followup.md L513–534）：只写三个 saved 字段——
 *  savedURL = 当前页网址；savedTitle = 当前页标题（无条件，没有标题就写成空）；savedFavicon 仅在新值非空时覆盖。
 *  不碰 customTitle / 自定义图标（icon）。没有当前页网址（标签没打开）= 什么也不做，返回 false。
 *  ⛔ 后续 effect（FUN_1029e3470）、自定义图标是否真的存在 customInfo 里、undo 是否注册，Rea 都没确定。 */
export function replaceFavUrl(f: Fav, tab?: { url?: string; title?: string; favIconUrl?: string }): boolean {
    if (!tab?.url) return false;
    f.url = tab.url;
    f.title = tab.title ?? "";
    if (tab.favIconUrl) f.favicon = tab.favIconUrl;
    return true;
}

/** Duplicate（Arc FUN_102933e9c / FUN_102a18524 / FUN_1029dd06c，urlbar-menus-followup.md「H1」）：返回复制出的收藏（不含 id / tabId）。
 *  网址 = 打开的标签的当前页网址，没有（未打开）取保存的网址；保存的标题 / favicon / 自定义图标原样复制；
 *  自定义标题保留——只有“已打开且当前页网址偏离了保存的网址”时才不带（Arc：FUN_1029dd06c 返回 true → title = nil）。
 *  ⛔ “偏离”的精确比较（Arc 用 host 比较 + ==，这里按去掉 #片段后的网址不等）；新项的落点（现为紧跟原项后）；偏离时 savedTitle 是否也换成当前页标题（现保持复制源）。 */
export function dupFav(f: Fav, tab?: { url?: string }): Omit<Fav, "id" | "tabId"> {
    const live = tab?.url || undefined;
    const strip = (u: string) => u.replace(/#.*$/, "");
    const deviated = !!live && strip(live) !== strip(f.url);
    const out: Omit<Fav, "id" | "tabId"> = { url: live ?? f.url, title: f.title };
    if (f.customTitle && !deviated) out.customTitle = f.customTitle;
    if (f.icon) out.icon = f.icon;
    if (f.favicon) out.favicon = f.favicon;
    return out;
}

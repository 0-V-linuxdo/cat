/*
 * 复制一个固定项（Duplicate，urlbar-menus-followup.md L661「H1」，rH/102933e9c.c L438–L449 / L535 / FUN_1029dd06c；与收藏的 dupFav 同一规则）：
 * 新项网址 = 打开的标签的当前页网址，没打开取保存的网址；保存的标题 / 自定义图标（customInfo）原样复制；
 * 自定义标题保留——只有“已打开且当前页网址偏离了保存的网址”时才不带（FUN_1029dd06c 返回 true → title = nil）。
 * ⛔ PinNode 没有 savedFavicon 字段（favicon 由网址 / 标签推出），不拷贝；“偏离”按去掉 #片段后的网址不等（Arc 用 host 比较 + ==）；
 * ⛔ 新项落点 Arc 未确认（处理函数没给策略、默认位置没追到）：放在原项之后（同一文件夹内）。只有 kind "tab" 能复制。
 */
import { locate, type PinNode } from "./model";

export function dupPinFields(n: PinNode, tab?: { url?: string }): Pick<PinNode, "url" | "title" | "customTitle" | "customIcon"> {
    const live = tab?.url || undefined;
    const strip = (u: string) => u.replace(/#.*$/, "");
    const deviated = !!live && !!n.url && strip(live) !== strip(n.url);
    const out: Pick<PinNode, "url" | "title" | "customTitle" | "customIcon"> = { url: live ?? n.url, title: n.title };
    if (n.customTitle && !deviated) out.customTitle = n.customTitle;
    if (n.customIcon) out.customIcon = n.customIcon;
    return out;
}

export function duplicatePinNode(list: PinNode[], id: string, newId: string, tab?: { url?: string }): PinNode | undefined {
    const loc = locate(list, id);
    const src = loc?.list[loc.index];
    if (!loc || !src || src.kind !== "tab") return undefined;
    const copy: PinNode = { id: newId, kind: "tab", ...dupPinFields(src, tab) };
    loc.list.splice(loc.index + 1, 0, copy);
    return copy;
}

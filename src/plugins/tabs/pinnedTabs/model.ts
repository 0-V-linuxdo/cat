import { createPluginStore } from "@api/Storage";

export interface PinNode {
    id: string;
    kind: "tab" | "folder";
    url?: string;
    title?: string;
    customTitle?: string;
    /** Change Icon 设的图标（emoji 或 "sym:<名>"），代替 favicon（审计 52193 X-04） */
    customIcon?: string;
    tabId?: number;
    /** 补丁 rel63-fav-reattach：绑定的标签被关掉时记下的旧 id（tabId 同时清空），只给撤销重开重新关联用（closedTab.ts） */
    closedTabId?: number;
    children?: PinNode[];
    collapsed?: boolean;
}

/** 标签的网址：已提交的 url 优先，首次导航还没提交时 url 是空串（不是 undefined），退到 pendingUrl，所以用 || 而不是 ??。都没有返回 undefined。 */
export const tabUrl = (t?: { url?: string; pendingUrl?: string }): string | undefined => t?.url || t?.pendingUrl || undefined;

/** 从标签生成固定项（pinTab / 拖放共用）：网址存 tabUrl（首次加载中的标签也有网址，重启后才挂得回） */
export const pinNodeFromTab = (tab: { id?: number; url?: string; pendingUrl?: string; title?: string }, id: string): PinNode => ({ id, kind: "tab", url: tabUrl(tab), title: tab.title, tabId: tab.id });

export interface PinnedData { bySpace: Record<string, PinNode[]>; collapsed: Record<string, boolean> }
export const pinnedStore = createPluginStore<PinnedData>("pinned", () => ({ bySpace: {}, collapsed: {} }));

export function* walk(nodes: PinNode[] | undefined): Generator<PinNode> {
    for (const n of nodes ?? []) { yield n; yield* walk(n.children); }
}

/** 在树中找到节点所在的数组与下标 */
export function locate(nodes: PinNode[], id: string): { list: PinNode[]; index: number } | null {
    const i = nodes.findIndex(n => n.id === id);
    if (i >= 0) return { list: nodes, index: i };
    for (const n of nodes) {
        const r = n.children && locate(n.children, id);
        if (r) return r;
    }
    return null;
}

export function detach(nodes: PinNode[], id: string): PinNode | null {
    const loc = locate(nodes, id);
    return loc ? loc.list.splice(loc.index, 1)[0] : null;
}

export function allPinnedTabIds(): number[] {
    const out: number[] = [];
    for (const list of Object.values(pinnedStore.get().bySpace)) for (const n of walk(list)) if (n.tabId != null) out.push(n.tabId);
    return out;
}

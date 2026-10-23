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
    children?: PinNode[];
    collapsed?: boolean;
}

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

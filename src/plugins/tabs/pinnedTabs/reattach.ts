/*
 * 浏览器重启后标签 id 全部变了：固定项 / 收藏记着的 tabId 失效。
 * 按网址把它们重新挂到 Chrome 恢复出来的同网址标签上（每个标签只挂一次）；找不到的标为未加载。
 */
import { favStore } from "@plugins/spaces/favorites/store";
import { pinnedStore, walk } from "./model";

const norm = (u?: string) => (u ?? "").replace(/#.*$/, "").replace(/\/$/, "");

export async function reattachByUrl() {
    const tabs = await chrome.tabs.query({});
    const alive = new Set(tabs.map(t => t.id));
    const used = new Set<number>();
    for (const l of Object.values(pinnedStore.get().bySpace)) for (const n of walk(l)) if (n.tabId != null && alive.has(n.tabId)) used.add(n.tabId);
    for (const f of favStore.get().items) if (f.tabId != null && alive.has(f.tabId)) used.add(f.tabId);
    const take = (url?: string) => {
        if (!url) return undefined;
        const t = tabs.find(x => x.id != null && !used.has(x.id) && norm(x.url ?? x.pendingUrl) === norm(url));
        if (t?.id != null) used.add(t.id);
        return t?.id;
    };
    let stale = false;
    for (const l of Object.values(pinnedStore.get().bySpace)) for (const n of walk(l)) if (n.tabId != null && !alive.has(n.tabId)) stale = true;
    if (favStore.get().items.some(f => f.tabId != null && !alive.has(f.tabId))) stale = true;
    if (!stale) return 0;
    let n = 0;
    await pinnedStore.update(d => { for (const l of Object.values(d.bySpace)) for (const x of walk(l)) if (x.kind === "tab" && x.tabId != null && !alive.has(x.tabId)) { x.tabId = take(x.url); if (x.tabId != null) n++; } });
    await favStore.update(d => { for (const f of d.items) if (f.tabId != null && !alive.has(f.tabId)) { f.tabId = take(f.url); if (f.tabId != null) n++; } });
    return n;
}

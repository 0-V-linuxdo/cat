/* 标签 id 不跨浏览器重启（也会在丢弃 / 预渲染时换新，onReplaced）。所有按 tabId 持久化的状态都注册到这里：
 * spaceManager 启动时按快照（网址 + 标题 + 窗口内位置）把旧 id 对应到新 id，然后通知各注册者搬运；
 * map 之外、已不存在的旧 id 由注册者自行清掉（alive 为当前存活的 id）。 */
export type TabIdRemapFn = (map: Map<number, number>, alive: Set<number>) => void | Promise<void>;
const fns: TabIdRemapFn[] = [];
export function onTabIdRemap(fn: TabIdRemapFn): () => void {
    fns.push(fn);
    return () => { const i = fns.indexOf(fn); if (i >= 0) fns.splice(i, 1); };
}
export async function emitTabIdRemap(map: Map<number, number>, alive?: Set<number>) {
    const live = alive ?? new Set((await chrome.tabs.query({})).map(t => t.id!).filter(x => x != null));
    for (const fn of fns.slice()) { try { await fn(map, live); } catch (e) { console.warn("tab id remap failed", e); } }
}
/** 工具：搬运 Record<tabId, V>（映射到的换 key；不存活且没映射的删掉） */
export function remapRecord<V>(rec: Record<string, V>, map: Map<number, number>, alive: Set<number>) {
    const out: Record<string, V> = {};
    for (const [k, v] of Object.entries(rec)) {
        const id = Number(k), to = map.get(id);
        if (to != null) out[to] = v; else if (alive.has(id) && !(id in out)) out[id] = v;
    }
    return out;
}

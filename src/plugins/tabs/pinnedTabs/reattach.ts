/*
 * 浏览器重启后标签 id 全部变了：固定项 / 收藏记着的 tabId 失效。
 * 按网址把它们重新挂到 Chrome 恢复出来的同网址标签上（每个标签只挂一次）；找不到的标为未加载。
 * 补丁 rel63-fav-reattach（rel63 #2）：只在**真的浏览器重启**后跑（reattachOnRestart，storage.session 标记），不再每次 panel.start 都跑——
 * 原来 in-page 模式下每个标签的 iframe 每次加载都会 start 一次，收藏 / 固定项的标签被关掉后留下的死 id 会在下一次 start 时
 * 按网址把一个无关的 Today 标签吞进收藏（Rea 无 adopt-by-URL：源码未找到）。关标签清 tabId 见 closedTab.ts。
 */
import { favStore } from "@plugins/spaces/favorites/store";
import { pinnedStore, tabUrl, walk } from "./model";

const norm = (u?: string) => (u ?? "").replace(/#.*$/, "").replace(/\/$/, "");

/** stores 默认用真实的两个 store；参数只给单元测试注入隔离的 store 用 */
export async function reattachByUrl(stores: { pinned: typeof pinnedStore; favs: typeof favStore } = { pinned: pinnedStore, favs: favStore }) {
    const { pinned: pinnedStore, favs: favStore } = stores;
    // 两个 store 都是异步从 chrome.storage 读的：没等 ready 就读会拿到空默认值 → 判成“没有失效项”直接返回 0，且之后不再重试
    await Promise.all([pinnedStore.ready, favStore.ready]);
    const tabs = await chrome.tabs.query({});
    const alive = new Set(tabs.map(t => t.id));
    const used = new Set<number>();
    for (const l of Object.values(pinnedStore.get().bySpace)) for (const n of walk(l)) if (n.tabId != null && alive.has(n.tabId)) used.add(n.tabId);
    for (const f of favStore.get().items) if (f.tabId != null && alive.has(f.tabId)) used.add(f.tabId);
    const take = (url?: string) => {
        if (!url) return undefined;
        const t = tabs.find(x => x.id != null && !used.has(x.id) && norm(tabUrl(x)) === norm(url));
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

/** 补丁 rel63-fav-reattach：会话标记。storage.session 在浏览器重启（以及扩展重载 / 更新）时清空，SW 回收不清——与 rel62 inpageSidebarAlive 同一思路 */
export const REATTACH_SESSION_KEY = "pinnedReattach:session";
/** 标记写下后这段时间内的 panel.start 仍然挂接（重启时恢复出来的标签 / 多个侧栏实例陆续启动），之后一律不跑 */
export const REATTACH_WINDOW_MS = 60_000;

/** 纯逻辑：没有标记 = 本会话第一次（浏览器刚重启 / 扩展刚重载）→ 跑并写标记；有标记 = 只在窗口内跑；时钟倒退（age < 0）不跑 */
export function planReattach(mark: unknown, now: number): { run: boolean; mark?: { at: number } } {
    const at = typeof (mark as { at?: unknown } | null | undefined)?.at === "number" ? (mark as { at: number }).at : undefined;
    if (at == null) return { run: true, mark: { at: now } };
    const age = now - at;
    return { run: age >= 0 && age < REATTACH_WINDOW_MS };
}

/** panel.start 调用：按会话标记决定要不要跑 reattachByUrl。没有 storage.session（单测 / 老环境）= 不跑（宁可不挂，也不误吞）。参数只给单元测试注入 */
export async function reattachOnRestart(deps: { area?: Pick<chrome.storage.StorageArea, "get" | "set">; run?: () => Promise<number>; now?: () => number } = {}): Promise<number | "skip"> {
    const area = deps.area ?? (typeof chrome !== "undefined" ? chrome.storage?.session : undefined);
    if (!area) return "skip";
    const got = await Promise.resolve(area.get(REATTACH_SESSION_KEY)).catch(() => ({} as Record<string, unknown>)); /* 预期：上下文失效时读不到，当作没有标记 */
    const p = planReattach((got as Record<string, unknown>)?.[REATTACH_SESSION_KEY], (deps.now ?? Date.now)());
    if (p.mark) await Promise.resolve(area.set({ [REATTACH_SESSION_KEY]: p.mark })).catch(() => undefined); /* 预期：写失败只会让下一次 start 再判一次 */
    if (!p.run) return "skip";
    return (deps.run ?? reattachByUrl)();
}

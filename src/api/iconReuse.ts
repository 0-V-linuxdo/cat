/*
 * favicon 节点跨整屏重绘复用（favicon-jitter）：
 * PanelShell.renderAll 每次标签事件都整棵重建侧栏，每行的 favicon <img> 都是新节点 → 重新请求 / 重新解码 / 失败图标重新走 error → 占位，
 * 站点图标就在每次重绘时闪一下（有页面持续触发 onUpdated 时表现为“不停抖动”）。
 * 做法：重绘提交后，按「行 key（data-sel）+ 行内第几个图标」找上一次渲染留下、已经脱离文档的同款图标节点（同标签、同属性 = 同 src、同 class），
 * 且它已成功加载完（img.complete && naturalWidth > 0；svg 占位无条件可复用），就把它换回去，丢掉新建的那个。
 * 只拿「已脱离文档」的旧节点，不动仍在文档里的（keepHover 保住的悬停链），所以不影响 morphInto 的子节点对位。
 * src 只在 URL 真正变化时才变：URL 变了 → 属性不同 → 不复用 → 新节点（一次加载）。
 */
const ICON = ".arc-fav:not(.arc-fav-custom)";
const cache = new Map<string, Element>();

function shallowSame(a: Element, b: Element): boolean {
    if (a.tagName !== b.tagName || a.attributes.length !== b.attributes.length) return false;
    for (const at of Array.from(a.attributes)) if (b.getAttribute(at.name) !== at.value) return false;
    return true;
}
/** 旧节点能否替代新节点：同款，且（img）已成功加载完 —— 加载中 / 失败 / 已被换成占位的不复用 */
export function reusable(old: Element, cur: Element): boolean {
    if (old === cur || old.isConnected || !shallowSame(old, cur)) return false;
    if (old instanceof HTMLImageElement) return old.complete && old.naturalWidth > 0;
    return true;
}

/** 在 root 内按行 key 复用 favicon 节点；返回复用个数（测试 / 诊断用） */
export function reuseFavicons(root: ParentNode): number {
    const seen = new Set<string>(), dup = new Set<string>();
    let n = 0;
    for (const row of Array.from(root.querySelectorAll("[data-sel]"))) {
        const key = row.getAttribute("data-sel")!;
        Array.from(row.querySelectorAll(ICON)).forEach((cur, i) => {
            const k = `${key}#${i}`;
            if (seen.has(k)) { dup.add(k); return; } // 重复 key（同一标签出现在两处）：不缓存也不复用，免得两处抢同一个节点
            seen.add(k);
            const old = cache.get(k);
            if (old && reusable(old, cur)) { cur.replaceWith(old); n++; } else cache.set(k, cur);
        });
    }
    for (const k of dup) { cache.delete(k); seen.delete(k); }
    for (const k of Array.from(cache.keys())) if (!seen.has(k)) cache.delete(k);
    return n;
}
export const _iconCacheSize = () => cache.size;
export const _resetIconReuse = () => cache.clear();

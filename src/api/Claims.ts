/*
 * “标签认领”：Favorites / Pinned / Folders 等插件声明哪些打开的标签归它们管。
 * Today 列表只显示没被认领的标签；自动归档也会跳过被认领的标签。
 */
const providers = new Map<string, () => Iterable<number>>();
export function addClaimProvider(plugin: string, fn: () => Iterable<number>) {
    providers.set(plugin, fn);
    return () => { providers.delete(plugin); };
}
export function claimedTabIds(): Set<number> {
    const s = new Set<number>();
    for (const fn of providers.values()) for (const id of fn()) s.add(id);
    return s;
}

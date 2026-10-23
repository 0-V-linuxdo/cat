/* 命令栏搜索源注册表：任何插件都能往命令栏里贡献结果 */
import { createRegistry } from "@api/registry";

export interface SearchResult {
    id: string;
    title: string;
    subtitle?: string;
    icon?: string;
    /** 用于排序，越大越靠前 */
    score?: number;
    run(): unknown;
    remove?(): unknown;
}
export interface SearchProvider {
    order?: number;
    label: string;
    search(q: string): Promise<SearchResult[]> | SearchResult[];
}
export const searchProviders = createRegistry<SearchProvider & { plugin: string }>();
export function addSearchProvider(id: string, plugin: string, p: SearchProvider) {
    searchProviders.set(id, { ...p, plugin });
    return () => { searchProviders.delete(id); };
}

export function fuzzyScore(q: string, text: string): number {
    if (!q) return 1;
    const t = text.toLowerCase();
    const s = q.toLowerCase();
    const i = t.indexOf(s);
    if (i >= 0) return 100 - Math.min(i, 50) + (i === 0 ? 50 : 0);
    let ti = 0;
    for (const ch of s) { ti = t.indexOf(ch, ti); if (ti < 0) return 0; ti++; }
    return 10;
}

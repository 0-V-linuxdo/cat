export function mapGetOrCreate<K, V>(map: Map<K, V>, key: K, make: () => V): V {
    let v = map.get(key);
    if (v === undefined) { v = make(); map.set(key, v); }
    return v;
}

export interface ExternalStore { subscribe(fn: () => void): () => void; notify(): void }

export function createExternalStore(): ExternalStore {
    const subs = new Set<() => void>();
    return {
        subscribe(fn) { subs.add(fn); return () => { subs.delete(fn); }; },
        notify() { for (const fn of Array.from(subs)) fn(); },
    };
}

export function sortedEntries<V extends { order?: number }>(map: Map<string, V>): [string, V][] {
    return Array.from(map.entries()).toSorted((a, b) => (a[1].order ?? 0) - (b[1].order ?? 0));
}

export function debounce<A extends unknown[]>(fn: (...a: A) => void, ms: number) {
    let t: ReturnType<typeof setTimeout> | undefined;
    return (...a: A) => { if (t) clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export function looksLikeUrl(q: string): boolean {
    return /^[a-z][\w+.-]*:\/\//i.test(q) || /^[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/.test(q) || /^localhost(:\d+)?/.test(q);
}

export function toUrl(q: string): string {
    return /^[a-z][\w+.-]*:\/\//i.test(q) ? q : `https://${q}`;
}

export function faviconUrl(pageUrl: string | undefined, size = 32): string {
    if (typeof chrome === "undefined" || !chrome.runtime?.getURL || !pageUrl) return "";
    const u = new URL(chrome.runtime.getURL("/_favicon/"));
    u.searchParams.set("pageUrl", pageUrl);
    u.searchParams.set("size", String(size));
    return u.toString();
}

/** 串行执行：快速连按的命令（下一个标签 / 下一个空间）排队执行，每次都基于上一次的结果前进 */
export function serial() {
    let p: Promise<unknown> = Promise.resolve();
    return <T>(fn: () => T | Promise<T>): Promise<T> => { const r = p.then(fn, fn); p = r.catch(() => { }); return r; }; /* 不是吞错：只让串行链不中断，错误仍经 r 交给调用方 */
}

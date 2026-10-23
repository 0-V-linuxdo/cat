/*
 * B-09 撤销删除 Space：删除时会把空间里的标签 / 固定网址写入归档；撤销恢复空间后，要把“这次删除新增的”归档项删掉，
 * 否则撤销后归档里留下重复项。只删本次新增的 id，删除前就有的归档项（哪怕同一网址）一律不动。
 */
import type { ArchivedTab } from "@plugins/tabs/archive";

/** Archive 插件不归档的网址（与 tabs/archive/index.ts:29 的 skip 同规则） */
export const archiveSkips = (url?: string) => !url || /^(chrome|edge|about|chrome-extension):/.test(url) && !url.includes("split.html");

/**
 * 本次删除新增的归档项 id。
 * direct：spaces:delete 直接写入的（未打开的固定项）；closedUrls：被关闭的打开标签的网址，由 Archive 的 tabs.onRemoved 异步写入，
 * 按网址多重集逐个认领：不在 before 里、closedAt ≥ start、无 spaceId（删除前已去掉 tabSpace 归属，别的空间同时关闭的标签带 spaceId，不会被认领）。
 */
export function pickCreatedArchiveIds(items: readonly ArchivedTab[], before: ReadonlySet<string>, direct: readonly string[], closedUrls: readonly string[], start: number): string[] {
    const out = new Set(direct.filter(id => !before.has(id) && items.some(i => i.id === id)));
    const want = new Map<string, number>();
    for (const u of closedUrls) if (!archiveSkips(u)) want.set(u, (want.get(u) ?? 0) + 1);
    for (const it of items) {
        if (before.has(it.id) || out.has(it.id) || it.spaceId || it.closedAt < start) continue;
        const n = want.get(it.url) ?? 0;
        if (n > 0) { want.set(it.url, n - 1); out.add(it.id); }
    }
    return [...out];
}

/** 预期新增条数（用于等待 onRemoved 写完） */
export const expectedArchiveCount = (direct: readonly string[], closedUrls: readonly string[]) => direct.length + closedUrls.filter(u => !archiveSkips(u)).length;

/** 撤销：只去掉这些 id */
export function withoutArchiveIds(items: readonly ArchivedTab[], ids: readonly string[]): ArchivedTab[] {
    const s = new Set(ids);
    return items.filter(i => !s.has(i.id));
}

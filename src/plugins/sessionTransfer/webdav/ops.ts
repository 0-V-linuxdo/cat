import { collect } from "../collect";
import { ensureCookies } from "../perm";
import type { Parsed } from "../container";
import { davDelete, davGet, davList, davPut, type DavConn } from "./client";
import { DavError } from "./errors";
import { NAME_RE, nameExpired, nameExpiry, openDav, sealDav, type DavMeta } from "./format";

export const MAX_LIST = 50, MAX_CLEAN = 10;

export interface DavExported { name: string; size: number; expiresAt: number }
/** 导出：采集 → ARCDAV 加密（口令校验在内）→ PUT。不写日志、不落盘明文。 */
export async function davExport(tab: chrome.tabs.Tab, conn: DavConn, pass: string, o: { label: string; ttlMs: number; now?: number }): Promise<DavExported> {
    await ensureCookies();
    const payload = await collect(tab);
    const s = await sealDav(payload, pass, { ...o, davSecret: conn.auth.secret, davUser: conn.auth.user });
    await davPut(conn, s.name, s.bytes);
    return { name: s.name, size: s.bytes.length, expiresAt: s.expiresAt };
}

export interface DavItem { name: string; size?: number; mtime?: number; expiresHint: number; expired: boolean }
/** 列表：只留文件名符合规则的文件（别人的文件不展示、不清理），mtime 倒序，最多 50 项 */
export async function davListItems(conn: DavConn, now = Date.now()): Promise<DavItem[]> {
    const es = await davList(conn);
    return es.filter(e => !e.isDir && NAME_RE.test(e.name))
        .map(e => ({ name: e.name, size: e.size, mtime: e.mtime, expiresHint: nameExpiry(e.name)!, expired: nameExpired(e.name, now) }))
        .sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0)).slice(0, MAX_LIST);
}

/** 清理：删除文件名提示已过期的项，每次最多 10 个，失败静默；返回成功删除的文件名 */
export async function cleanupExpired(conn: DavConn, items: DavItem[], now = Date.now()): Promise<string[]> {
    const n: string[] = [];
    for (const it of items.filter(i => i.expired && NAME_RE.test(i.name) && nameExpired(i.name, now)).slice(0, MAX_CLEAN)) {
        try { await davDelete(conn, it.name); n.push(it.name); } catch { /* 静默 */ }
    }
    return n;
}

/** 下载（预检文件名提示 + 32 MiB 上限）。已过期提示 → dav-expired，不发请求 */
export async function davDownload(conn: DavConn, name: string, now = Date.now()): Promise<Uint8Array> {
    if (!NAME_RE.test(name)) throw new DavError("dav-bad-format");
    if (nameExpired(name, now)) throw new DavError("dav-expired");
    return davGet(conn, name);
}

export const davDecrypt = (bytes: Uint8Array, pass: string, now = Date.now()): Promise<{ parsed: Parsed; meta: DavMeta }> => openDav(bytes, pass, now);

/** 导入成功后的远端删除：失败不致命，只返回 false 供界面提示 */
export async function deleteRemote(conn: DavConn, name: string): Promise<boolean> {
    try { await davDelete(conn, name); return true; } catch { return false; }
}

import { DavError } from "./errors";

/* 目录 URL 校验：只接受 https；http 仅限 localhost / 127.0.0.1 / [::1]（精确主机名，localhost.evil.com 之类不算）。
 * 不接受内嵌 user:pass@、查询串、片段；返回以 / 结尾的规范化目录 URL。 */
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function normalizeDir(input: string): string {
    const raw = input.trim();
    let u: URL;
    try { u = new URL(raw); } catch { throw new DavError("dav-bad-url"); }
    if (u.protocol !== "https:" && u.protocol !== "http:") throw new DavError("dav-https-required");
    if (u.protocol === "http:" && !LOOPBACK.has(u.hostname)) throw new DavError("dav-https-required");
    if (u.username || u.password || u.search || u.hash || !u.hostname) throw new DavError("dav-bad-url");
    const path = u.pathname.endsWith("/") ? u.pathname : `${u.pathname}/`;
    return `${u.origin}${path}`;
}

/** 目录 URL → 解码后的路径段数组（不含空段） */
export const dirSegments = (dir: string): string[] => new URL(dir).pathname.split("/").filter(Boolean).map(s => decodeURIComponent(s));

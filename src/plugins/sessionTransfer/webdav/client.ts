import { DavError, type DavCode } from "./errors";
import { assertDavBytes, NAME_RE } from "./format";
import { normalizeDir } from "./url";
import { MAX_XML_BYTES, parseMultistatus, type DavEntry } from "./xml";

/* WebDAV 客户端——整个插件里唯一出现 fetch 的文件。
 * 每个请求：credentials:"omit"、redirect:"manual"、cache:"no-store"、逐请求 AbortController 超时（用完即清）；
 * redirect:"manual"：浏览器不跟随，3xx 得到 opaqueredirect → dav-redirect（用 "error" 会让 fetch 直接抛 TypeError，只能报 dav-network，H9 实测）；
 * 带 Authorization 的请求只发给配置的目录，绝不会被转到别处。
 * 不写日志，错误只抛 DavError(枚举码)，不含 URL / 用户名 / 响应体。 */
const hasCtl = (s: string) => s.includes("\r") || s.includes("\n") || s.includes("\0");
export interface DavAuth { kind: "basic" | "bearer"; user: string; secret: string }
export interface DavConn { dir: string; auth: DavAuth }

export const MAX_GET_BYTES = 32 * 1024 * 1024;
const MIB = 1024 * 1024;
const enc = new TextEncoder();
const PROPFIND_BODY = `<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:getlastmodified/><d:getcontentlength/><d:resourcetype/></d:prop></d:propfind>`;

function authHeader(a: DavAuth): string {
    if (!a.secret || hasCtl(a.secret + a.user)) throw new DavError("dav-bad-config");
    if (a.kind === "bearer") return `Bearer ${a.secret}`;
    if (a.user.includes(":")) throw new DavError("dav-bad-config");
    let bin = ""; for (const b of enc.encode(`${a.user}:${a.secret}`)) bin += String.fromCharCode(b);
    return `Basic ${btoa(bin)}`;
}

function failFor(status: number): DavCode {
    if (status >= 300 && status < 400) return "dav-redirect";
    switch (status) {
        case 401: return "dav-auth";
        case 403: case 405: return "dav-forbidden";
        case 404: return "dav-not-found";
        case 409: return "dav-dir-missing";
        case 413: return "dav-too-large";
        case 507: return "dav-quota";
        default: return "dav-server";
    }
}
const need = (status: number, ok: readonly number[]) => { if (!ok.includes(status)) throw new DavError(failFor(status)); };

interface Res { status: number; bytes: Uint8Array }
async function send(conn: DavConn, method: string, name: string | undefined, o: { body?: Uint8Array | string; headers?: Record<string, string>; cap?: number; overflow?: DavCode } = {}): Promise<Res> {
    if (name !== undefined && !NAME_RE.test(name)) throw new DavError("dav-bad-format");
    if (normalizeDir(conn.dir) !== conn.dir) throw new DavError("dav-https-required"); // 纵深防御：配置层已校验，这里在任何请求（含 Authorization）发出前再校验一次
    const url = name === undefined ? conn.dir : conn.dir + encodeURIComponent(name);
    const headers: Record<string, string> = { Authorization: authHeader(conn.auth), ...o.headers };
    const sizeHint = typeof o.body === "string" ? o.body.length : (o.body?.length ?? o.cap ?? 0);
    const ms = Math.min(120_000, 30_000 + Math.floor(sizeHint / MIB) * 1000);
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), ms);
    try {
        let res: Response;
        try {
            res = await fetch(url, { method, headers, body: o.body as BodyInit | undefined, credentials: "omit", redirect: "manual", cache: "no-store", signal: ac.signal });
        } catch (e) {
            throw new DavError((e as { name?: string })?.name === "AbortError" ? "dav-timeout" : "dav-network");
        }
        if (res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400)) { void res.body?.cancel().catch(() => undefined); throw new DavError("dav-redirect"); }
        const cap = o.cap ?? 0;
        const wantsBody = res.status >= 200 && res.status < 300 && cap > 0 && method !== "DELETE";
        if (!wantsBody) { void res.body?.cancel().catch(() => undefined); return { status: res.status, bytes: new Uint8Array(0) }; }
        const over = o.overflow ?? "dav-too-large";
        const cl = Number(res.headers.get("content-length"));
        if (Number.isFinite(cl) && cl > cap) { void res.body?.cancel().catch(() => undefined); throw new DavError(over); }
        const parts: Uint8Array[] = []; let total = 0;
        try {
            const rd = res.body?.getReader();
            if (rd) for (;;) {
                const { done, value } = await rd.read();
                if (done) break;
                total += value.length;
                if (total > cap) { void rd.cancel().catch(() => undefined); throw new DavError(over); }
                parts.push(value);
            }
        } catch (e) {
            if (e instanceof DavError) throw e;
            throw new DavError(ac.signal.aborted ? "dav-timeout" : "dav-network");
        }
        const bytes = new Uint8Array(total); let p = 0;
        for (const x of parts) { bytes.set(x, p); p += x.length; }
        return { status: res.status, bytes };
    } finally { clearTimeout(timer); }
}

/** PROPFIND Depth:1 → 目录里的直接子项 */
export async function davList(conn: DavConn): Promise<DavEntry[]> {
    const r = await send(conn, "PROPFIND", undefined, { body: PROPFIND_BODY, headers: { Depth: "1", "Content-Type": "application/xml; charset=utf-8" }, cap: MAX_XML_BYTES, overflow: "dav-bad-xml" });
    if (r.status === 404) throw new DavError("dav-dir-absent"); // 目录还没建：不是「文件找不到」；这里不创建（导出时才 MKCOL 最后一级）
    need(r.status, [207]);
    return parseMultistatus(new TextDecoder().decode(r.bytes), conn.dir);
}

export async function davMkcol(conn: DavConn): Promise<void> {
    const r = await send(conn, "MKCOL", undefined);
    if (r.status === 405) return; // 已存在
    if (r.status === 403 || r.status === 409 || r.status === 404) throw new DavError("dav-dir-missing");
    need(r.status, [200, 201]);
}

/** 上传 ARCDAV 字节；目录不存在（404 / 409）时只 MKCOL 一次最后一级再重试一次 */
export async function davPut(conn: DavConn, name: string, bytes: Uint8Array): Promise<void> {
    assertDavBytes(bytes); // 在任何网络请求之前
    const put = () => send(conn, "PUT", name, { body: bytes, headers: { "Content-Type": "application/octet-stream" } });
    let r = await put();
    if (r.status === 404 || r.status === 409) { await davMkcol(conn); r = await put(); }
    if (r.status === 404 || r.status === 409) throw new DavError("dav-dir-missing");
    need(r.status, [200, 201, 204]);
}

export async function davGet(conn: DavConn, name: string): Promise<Uint8Array> {
    const r = await send(conn, "GET", name, { cap: MAX_GET_BYTES });
    need(r.status, [200]);
    return r.bytes;
}

export async function davDelete(conn: DavConn, name: string): Promise<void> {
    const r = await send(conn, "DELETE", name);
    need(r.status, [200, 202, 204]);
}

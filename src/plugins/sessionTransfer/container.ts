/* 会话容器的编解码（纯函数，不碰 chrome / DOM，不写日志）。
 * 默认格式与 Session Copy v2 互通（RESEARCH §A）：载荷 {v:2,o,t,l,s,c} → gzip → AES-256-GCM（32 字节随机密钥放在令牌里）；
 *   字节 = [0x02][key32][iv12][密文]；令牌 = "sc:v2:" + base64url(字节)；文件 = "SESSIONCOPY\x1e"（12 字节魔数）+ 同样字节。
 * 可选口令格式（A3，SC 读不了）：PBKDF2-SHA256 600000 + AES-256-GCM，头部作 AAD；令牌 "arc:v1:"，文件魔数 "ARCSESSION\x1e"。
 * 所有错误只抛 SessionError(code)，message 就是枚举码——不含 cookie 名 / 值 / 站点。 */

export type ErrorCode =
    | "no-token" | "bad-version" | "truncated" | "truncated-file" | "bad-magic" | "bad-token" | "bad-origin" | "bad-scheme" | "bad-payload"
    | "bad-passphrase" | "need-passphrase" | "too-large" | "no-tab" | "perm-denied" | "no-cookies-api" | "tab-timeout" | "all-skipped"
    | "collect-failed" | "storage-failed" | "aborted";

export class SessionError extends Error {
    constructor(public readonly code: ErrorCode) { super(code); this.name = "SessionError"; }
}
export const errCode = (e: unknown): ErrorCode | "failed" => e instanceof SessionError ? e.code : "failed";

const enc = new TextEncoder();
export const SC_PREFIX = "sc:v2:";
export const PASS_PREFIX = "arc:v1:";
export const SC_MAGIC = enc.encode("SESSIONCOPY\x1e"); // 12 字节（0x1E 是魔数的一部分）
export const PASS_MAGIC = enc.encode("ARCSESSION\x1e");
/** SC 的阈值：令牌字符串长度超过它改存文件 */
export const TOKEN_MAX_CHARS = 450_000;
/** 解压后 JSON 上限（防解压炸弹）与条目上限，远大于正常值 */
export const MAX_PLAIN_BYTES = 64 * 1024 * 1024;
export const MAX_COOKIES = 5000;
export const MAX_STORAGE_ITEMS = 100_000;
export const PBKDF2_ITERATIONS = 600_000;

const HDR_SC = 45; // 1 + 32 + 12
const MIN_SC = 61; // + GCM tag 16
const HDR_PASS = 1 + 16 + 4 + 12;

export interface CookieRec {
    name: string; value: string; domain?: string; path: string; secure: boolean; httpOnly: boolean;
    sameSite: "no_restriction" | "lax" | "strict" | "unspecified"; expirationDate?: number;
    hostOnly?: boolean; session?: boolean; storeId?: string; partitionKey?: { topLevelSite: string; hasCrossSiteAncestor?: boolean };
}
export interface Payload { v: 2; o: string; t: number; l: Record<string, string>; s: Record<string, string>; c: CookieRec[] }
export interface Parsed {
    origin: string; createdAt: number;
    local: Array<[string, string]>; session: Array<[string, string]>;
    cookies: CookieRec[];
    /** 被严格校验丢弃的条目数 */
    dropped: number;
}

/* ---- base64url（与 SC 的 os.enc / os.dec 同行为；分块避免大数组 apply 溢栈） ---- */
export function b64uEncode(bytes: Uint8Array): string {
    let s = "";
    for (let i = 0; i < bytes.length; i += 32768) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 32768) as unknown as number[]);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function b64uDecode(text: string): Uint8Array {
    try {
        let t = text.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
        t += "===".slice((t.length + 3) % 4);
        const bin = atob(t);
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
    } catch { throw new SessionError("bad-token"); }
}

/* ---- gzip（解压带上限） ---- */
export async function gzip(data: Uint8Array): Promise<Uint8Array> {
    return new Uint8Array(await new Response(new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer());
}
export async function gunzip(data: Uint8Array, max = MAX_PLAIN_BYTES): Promise<Uint8Array> {
    const reader = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip")).getReader();
    const parts: Uint8Array[] = []; let total = 0;
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            total += value.length;
            if (total > max) { void reader.cancel().catch(() => undefined); throw new SessionError("too-large"); }
            parts.push(value);
        }
    } catch (e) { if (e instanceof SessionError) throw e; throw new SessionError("bad-payload"); }
    const out = new Uint8Array(total); let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
}

const toPlain = async (p: Payload) => gzip(enc.encode(JSON.stringify(p)));
async function fromPlain(gz: Uint8Array): Promise<Parsed> {
    const json = new TextDecoder().decode(await gunzip(gz));
    let obj: unknown;
    try { obj = JSON.parse(json); } catch { throw new SessionError("bad-payload"); }
    return parsePayload(obj);
}

/* ---- 严格 schema：非法条目整项丢弃并计数；存储用 [k,v] 数组（防 __proto__ 污染） ---- */
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const SAME = new Set(["no_restriction", "lax", "strict", "unspecified"]);

function entries(x: unknown, dropped: { n: number }): Array<[string, string]> {
    if (x == null) return [];
    if (!isObj(x)) { dropped.n++; return []; }
    const out: Array<[string, string]> = [];
    for (const [k, v] of Object.entries(x)) { if (typeof v === "string") out.push([k, v]); else dropped.n++; }
    if (out.length > MAX_STORAGE_ITEMS) throw new SessionError("too-large");
    return out;
}
function cookie(x: unknown): CookieRec | null {
    if (!isObj(x) || typeof x.name !== "string" || typeof x.value !== "string" || !x.name) return null;
    const c: CookieRec = {
        name: x.name, value: x.value,
        path: typeof x.path === "string" && x.path.startsWith("/") ? x.path : "/",
        secure: x.secure === true, httpOnly: x.httpOnly === true,
        sameSite: typeof x.sameSite === "string" && SAME.has(x.sameSite) ? x.sameSite as CookieRec["sameSite"] : "unspecified",
    };
    if (typeof x.domain === "string" && x.domain) c.domain = x.domain;
    if (typeof x.expirationDate === "number" && Number.isFinite(x.expirationDate)) c.expirationDate = x.expirationDate;
    if (typeof x.hostOnly === "boolean") c.hostOnly = x.hostOnly;
    if (typeof x.session === "boolean") c.session = x.session;
    if (typeof x.storeId === "string") c.storeId = x.storeId;
    if (isObj(x.partitionKey) && typeof x.partitionKey.topLevelSite === "string") {
        c.partitionKey = { topLevelSite: x.partitionKey.topLevelSite };
        if (typeof x.partitionKey.hasCrossSiteAncestor === "boolean") c.partitionKey.hasCrossSiteAncestor = x.partitionKey.hasCrossSiteAncestor;
    }
    return c;
}
export function originOf(url: unknown): string {
    try {
        const u = new URL(String(url));
        if (u.protocol !== "http:" && u.protocol !== "https:") throw new SessionError("bad-origin");
        return u.origin;
    } catch { throw new SessionError("bad-origin"); }
}
export function parsePayload(obj: unknown): Parsed {
    if (!isObj(obj) || obj.v !== 2) throw new SessionError("bad-payload"); // SC：invalid-payload
    const origin = originOf(obj.o);
    const dropped = { n: 0 };
    const rawC = obj.c == null ? [] : Array.isArray(obj.c) ? obj.c : (dropped.n++, []);
    if (rawC.length > MAX_COOKIES) throw new SessionError("too-large");
    const cookies: CookieRec[] = [];
    for (const x of rawC) { const c = cookie(x); if (c) cookies.push(c); else dropped.n++; }
    return {
        origin, createdAt: typeof obj.t === "number" && Number.isFinite(obj.t) ? obj.t : 0,
        local: entries(obj.l, dropped), session: entries(obj.s, dropped), cookies, dropped: dropped.n,
    };
}

/* ---- SC 互通容器 ---- */
const rand = (n: number) => crypto.getRandomValues(new Uint8Array(n));
export async function sealSC(p: Payload): Promise<Uint8Array> {
    const key = rand(32), iv = rand(12);
    const k = await crypto.subtle.importKey("raw", key as BufferSource, "AES-GCM", false, ["encrypt"]);
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, k, await toPlain(p) as BufferSource));
    const out = new Uint8Array(HDR_SC + ct.length);
    out[0] = 2; out.set(key, 1); out.set(iv, 33); out.set(ct, HDR_SC);
    return out;
}
export async function openSC(bytes: Uint8Array): Promise<Parsed> {
    if (bytes.length < MIN_SC) throw new SessionError("truncated");
    if (bytes[0] !== 2) throw new SessionError("bad-version");
    let plain: Uint8Array;
    try {
        const k = await crypto.subtle.importKey("raw", bytes.subarray(1, 33) as BufferSource, "AES-GCM", false, ["decrypt"]);
        plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.subarray(33, 45) as BufferSource }, k, bytes.subarray(HDR_SC) as BufferSource));
    } catch { throw new SessionError("bad-payload"); }
    return fromPlain(plain);
}

/* ---- 口令容器（A3） ---- */
export async function passKey(pass: string, salt: Uint8Array, iters: number): Promise<CryptoKey> {
    const base = await crypto.subtle.importKey("raw", enc.encode(pass.normalize("NFC")) as BufferSource, "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations: iters }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
export async function sealPass(p: Payload, pass: string): Promise<Uint8Array> {
    if (!pass) throw new SessionError("need-passphrase");
    const salt = rand(16), iv = rand(12);
    const hdr = new Uint8Array(21); hdr[0] = 1; hdr.set(salt, 1); new DataView(hdr.buffer).setUint32(17, PBKDF2_ITERATIONS);
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource, additionalData: hdr as BufferSource }, await passKey(pass, salt, PBKDF2_ITERATIONS), await toPlain(p) as BufferSource));
    const out = new Uint8Array(HDR_PASS + ct.length);
    out.set(hdr, 0); out.set(iv, 21); out.set(ct, HDR_PASS);
    return out;
}
export async function openPass(bytes: Uint8Array, pass: string): Promise<Parsed> {
    if (bytes.length < HDR_PASS + 16) throw new SessionError("truncated");
    if (bytes[0] !== 1) throw new SessionError("bad-version");
    // 迭代数硬编码：头部里是别的值就拒绝，不做 PBKDF2（防被构造的巨大迭代数拖死面板）
    if (new DataView(bytes.buffer, bytes.byteOffset, bytes.length).getUint32(17) !== PBKDF2_ITERATIONS) throw new SessionError("bad-version");
    if (!pass) throw new SessionError("need-passphrase");
    let plain: Uint8Array;
    try {
        plain = new Uint8Array(await crypto.subtle.decrypt(
            { name: "AES-GCM", iv: bytes.subarray(21, 33) as BufferSource, additionalData: bytes.subarray(0, 21) as BufferSource },
            await passKey(pass, bytes.subarray(1, 17), PBKDF2_ITERATIONS), bytes.subarray(HDR_PASS) as BufferSource));
    } catch { throw new SessionError("bad-passphrase"); }
    return fromPlain(plain);
}

/* ---- 令牌 / 文件封装与识别 ---- */
export type Kind = "sc" | "pass";
export const toToken = (bytes: Uint8Array, kind: Kind = "sc") => (kind === "sc" ? SC_PREFIX : PASS_PREFIX) + b64uEncode(bytes);
export function toFile(bytes: Uint8Array, kind: Kind = "sc"): Uint8Array {
    const m = kind === "sc" ? SC_MAGIC : PASS_MAGIC;
    const out = new Uint8Array(m.length + bytes.length);
    out.set(m, 0); out.set(bytes, m.length);
    return out;
}
const startsWith = (b: Uint8Array, m: Uint8Array) => b.length >= m.length && m.every((x, i) => b[i] === x);

/** 识别输入（令牌文本或文件字节）→ 种类 + 容器字节。不解密。 */
export function detect(input: string | Uint8Array): { kind: Kind; bytes: Uint8Array } {
    if (typeof input === "string") {
        const t = input.trim();
        if (t.startsWith(SC_PREFIX)) return { kind: "sc", bytes: b64uDecode(t.slice(SC_PREFIX.length)) };
        if (t.startsWith(PASS_PREFIX)) return { kind: "pass", bytes: b64uDecode(t.slice(PASS_PREFIX.length)) };
        throw new SessionError("no-token");
    }
    if (startsWith(input, SC_MAGIC)) {
        if (input.length < SC_MAGIC.length + MIN_SC) throw new SessionError("truncated-file");
        return { kind: "sc", bytes: input.subarray(SC_MAGIC.length) };
    }
    if (startsWith(input, PASS_MAGIC)) {
        if (input.length < PASS_MAGIC.length + HDR_PASS + 16) throw new SessionError("truncated-file");
        return { kind: "pass", bytes: input.subarray(PASS_MAGIC.length) };
    }
    throw new SessionError("bad-magic");
}

/** 解码任意输入。口令容器没给口令 → need-passphrase（调用方弹口令框后重试） */
export async function decode(input: string | Uint8Array, passphrase?: string): Promise<Parsed> {
    const d = detect(input);
    return d.kind === "sc" ? openSC(d.bytes) : openPass(d.bytes, passphrase ?? "");
}
export const needsPassphrase = (input: string | Uint8Array) => { try { return detect(input).kind === "pass"; } catch { return false; } };

export interface Artifact { kind: "token"; text: string; chars: number; passphrase: boolean }
export interface FileArtifact { kind: "file"; bytes: Uint8Array; passphrase: boolean }
/** 打包：默认 SC 格式；token 超过阈值（按字符串长度）改成文件 */
/** 令牌放得下吗（按字符串长度，与 SC 的 450 000 一致：恰好 450 000 仍是令牌，450 001 起改文件） */
export const tokenFits = (text: string) => text.length <= TOKEN_MAX_CHARS;
export async function pack(p: Payload, passphrase?: string, forceFile = false): Promise<Artifact | FileArtifact> {
    const pass = !!passphrase;
    const bytes = pass ? await sealPass(p, passphrase!) : await sealSC(p);
    const kind: Kind = pass ? "pass" : "sc";
    if (!forceFile) {
        const text = toToken(bytes, kind);
        if (tokenFits(text)) return { kind: "token", text, chars: text.length, passphrase: pass };
    }
    return { kind: "file", bytes: toFile(bytes, kind), passphrase: pass };
}

const clean = (s: string) => s.replace(/[^a-zA-Z0-9.-]/g, "_").slice(0, 80) || "site";
/** session-<host>-<ISO时间>.session（口令格式 .arcsession） */
export function fileName(origin: string, pass: boolean, now = new Date()): string {
    let host = "site"; try { host = new URL(origin).hostname; } catch { /* 默认 site */ }
    return `session-${clean(host)}-${now.toISOString().replace(/[:.]/g, "-")}.${pass ? "arcsession" : "session"}`;
}

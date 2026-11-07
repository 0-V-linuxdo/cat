import { gunzip, gzip, parsePayload, passKey, PBKDF2_ITERATIONS, SessionError, type Parsed, type Payload } from "../container";
import { DavError } from "./errors";

/* ARCDAV 容器（DESIGN §5A）：WebDAV 通道唯一允许上传的格式，强制口令加密，不与 Session Copy 互通。
 * 0..6 "ARCDAV"+0x1E | 7 ver=1 | 8 kdf=1 | 9..12 iterations u32BE | 13..28 salt16 | 29..40 iv12 | 41..48 createdAt u64BE ms | 49..56 expiresAt u64BE ms
 * 57.. AES-256-GCM(明文)‖tag16，AAD = 字节 [0,57)；明文 = u32BE gzipLen ‖ gzip(JSON) ‖ 0 填充到 4096 的整数倍。 */
export const DAV_MAGIC = new Uint8Array([0x41, 0x52, 0x43, 0x44, 0x41, 0x56, 0x1e]);
export const DAV_HDR = 57;
export const DAV_PAD = 4096;
export const MIN_PASS = 12;
export const TTL_CHOICES = [15 * 60_000, 3_600_000, 24 * 3_600_000, 7 * 24 * 3_600_000] as const;
export const DEFAULT_TTL = 3_600_000;
export const NAME_RE = /^[0-9a-f]{32}-[0-9a-z]{1,8}\.arcdav$/;
const HOUR = 3_600_000;
const enc = new TextEncoder();

const rand = (n: number) => crypto.getRandomValues(new Uint8Array(n));
const hex = (b: Uint8Array) => [...b].map(x => x.toString(16).padStart(2, "0")).join("");
const startsWith = (b: Uint8Array, p: Uint8Array | string) => { const q = typeof p === "string" ? enc.encode(p) : p; return b.length >= q.length && q.every((x, i) => b[i] === x); };

export interface DavMeta { label: string; created: number; exp: number }
export interface DavSealed { bytes: Uint8Array; name: string; createdAt: number; expiresAt: number }

/** 上传前的最后一道闸：只有 ARCDAV 才放行（明文 JSON / sc:v2: / SESSIONCOPY / ARCSESSION / 空 / 其它一律拒绝） */
export function assertDavBytes(b: Uint8Array): void {
    if (!startsWith(b, DAV_MAGIC) || b.length < DAV_HDR + 16) throw new DavError("dav-plaintext-refused");
}

/** 80 位随机口令，XXXX-XXXX-XXXX-XXXX（RFC 4648 base32 字母表，10 字节 = 16 个字符，无填充） */
export function generatePassphrase(): string {
    const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    const bits = [...rand(10)].map(x => x.toString(2).padStart(8, "0")).join("");
    let s = "";
    for (let i = 0; i < 80; i += 5) s += A[parseInt(bits.slice(i, i + 5), 2)];
    return s.match(/.{4}/g)!.join("-");
}

/** 口令 ≥ 12 个字符，且不能等于 DAV 密码 / 用户名 */
export function checkPassphrase(pass: string, davSecret?: string, davUser?: string): void {
    const p = pass.normalize("NFC");
    if ([...p].length < MIN_PASS) throw new DavError("dav-pass-short");
    for (const o of [davSecret, davUser]) if (o && p === o.normalize("NFC")) throw new DavError("dav-pass-same");
}

export const expHint = (expiresAt: number) => Math.ceil(expiresAt / HOUR).toString(36);
/** 文件名里的过期提示（向上取整到整点，所以不会比真实过期更早）；不匹配文件名规则 → undefined */
export function nameExpiry(name: string): number | undefined {
    if (!NAME_RE.test(name)) return undefined;
    const t = parseInt(name.slice(33, name.length - 7), 36);
    return Number.isFinite(t) ? t * HOUR : undefined;
}
export const nameExpired = (name: string, now: number) => { const e = nameExpiry(name); return e !== undefined && now > e; };

export async function sealDav(payload: Payload, pass: string, o: { label: string; ttlMs: number; now?: number; davSecret?: string; davUser?: string }): Promise<DavSealed> {
    checkPassphrase(pass, o.davSecret, o.davUser);
    const now = o.now ?? Date.now(), exp = now + o.ttlMs;
    const json = JSON.stringify({ ...payload, x: { app: "arc-st", ver: 1, label: o.label, created: now, exp } });
    const gz = await gzip(enc.encode(json));
    const plain = new Uint8Array(Math.ceil((4 + gz.length) / DAV_PAD) * DAV_PAD);
    new DataView(plain.buffer).setUint32(0, gz.length); plain.set(gz, 4);
    const hdr = new Uint8Array(DAV_HDR), dv = new DataView(hdr.buffer), salt = rand(16), iv = rand(12);
    hdr.set(DAV_MAGIC, 0); hdr[7] = 1; hdr[8] = 1; dv.setUint32(9, PBKDF2_ITERATIONS); hdr.set(salt, 13); hdr.set(iv, 29);
    dv.setBigUint64(41, BigInt(now)); dv.setBigUint64(49, BigInt(exp));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource, additionalData: hdr as BufferSource }, await passKey(pass, salt, PBKDF2_ITERATIONS), plain as BufferSource));
    const bytes = new Uint8Array(DAV_HDR + ct.length); bytes.set(hdr, 0); bytes.set(ct, DAV_HDR);
    return { bytes, name: `${hex(rand(16))}-${expHint(exp)}.arcdav`, createdAt: now, expiresAt: exp };
}

/** 结构检查（不做 PBKDF2）：魔数 / 版本 / KDF / 迭代次数 / 长度 → dav-bad-format */
export function checkDavHeader(b: Uint8Array): { createdAt: number; expiresAt: number } {
    if (b.length < DAV_HDR + 16 || !startsWith(b, DAV_MAGIC)) throw new DavError("dav-bad-format");
    const dv = new DataView(b.buffer, b.byteOffset, b.length);
    if (b[7] !== 1 || b[8] !== 1 || dv.getUint32(9) !== PBKDF2_ITERATIONS) throw new DavError("dav-bad-format");
    return { createdAt: Number(dv.getBigUint64(41)), expiresAt: Number(dv.getBigUint64(49)) };
}

/** 解密；口令错 / 篡改（含头部任一字节）统一 SessionError("bad-passphrase")；已过期 → dav-expired（用解密后已认证的头部判断） */
export async function openDav(bytes: Uint8Array, pass: string, now = Date.now()): Promise<{ parsed: Parsed; meta: DavMeta }> {
    const { createdAt, expiresAt } = checkDavHeader(bytes);
    let plain: Uint8Array;
    try {
        plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(29, 41) as BufferSource, additionalData: bytes.slice(0, DAV_HDR) as BufferSource },
            await passKey(pass, bytes.slice(13, 29), PBKDF2_ITERATIONS), bytes.slice(DAV_HDR) as BufferSource));
    } catch { throw new SessionError("bad-passphrase"); }
    if (now > expiresAt) throw new DavError("dav-expired");
    if (plain.length < 4) throw new DavError("dav-bad-format");
    const n = new DataView(plain.buffer, plain.byteOffset, plain.length).getUint32(0);
    if (n > plain.length - 4) throw new DavError("dav-bad-format");
    let obj: unknown;
    try { obj = JSON.parse(new TextDecoder().decode(await gunzip(plain.subarray(4, 4 + n)))); } catch (e) { if (e instanceof SessionError) throw e; throw new DavError("dav-bad-format"); }
    const x = (obj as { x?: { label?: unknown } } | null)?.x;
    return { parsed: parsePayload(obj), meta: { label: typeof x?.label === "string" ? x.label.slice(0, 200) : "", created: createdAt, exp: expiresAt } };
}

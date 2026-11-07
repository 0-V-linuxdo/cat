/* 把会话写回浏览器（DESIGN §2 #18-#21、A2 快照 / 回滚 / 撤销、A5 读回校验）。
 * 快照只存在内存里（模块变量，不进 storage、不落盘）；写入前先读旧值。不写日志，失败只计数。 */
import { SessionError, type CookieRec } from "./container";
import { cookieKey, listCookies } from "./collect";

type SetDetails = chrome.cookies.SetDetails & { partitionKey?: { topLevelSite: string; hasCrossSiteAncestor?: boolean } };
type RawCookie = chrome.cookies.Cookie & { partitionKey?: { topLevelSite: string; hasCrossSiteAncestor?: boolean } };
const api = () => chrome.cookies as unknown as {
    set(d: SetDetails): Promise<RawCookie | null>;
    get(d: Record<string, unknown>): Promise<RawCookie | null>;
    remove(d: Record<string, unknown>): Promise<unknown>;
};

const stripDot = (d: string) => d.replace(/^\./, "");
const domainMatches = (host: string, domain: string) => { const d = stripDot(domain).toLowerCase(), h = host.toLowerCase(); return h === d || h.endsWith("." + d); };

/** 一个 cookie 的写入参数；不合规（域名与目标不匹配 / 非法）返回 null（计入 skipped） */
export function setDetails(c: CookieRec, origin: string): SetDetails | null {
    let u: URL; try { u = new URL(origin); } catch { return null; }
    const hostPrefix = c.name.startsWith("__Host-"), securePrefix = hostPrefix || c.name.startsWith("__Secure-");
    const path = hostPrefix ? "/" : c.path || "/";
    const d: SetDetails = { url: `${u.origin}${path}`, name: c.name, value: c.value, path, secure: c.secure || securePrefix, httpOnly: c.httpOnly };
    if (!hostPrefix && c.domain) {
        // hostOnly 明示为 true，或（SC 令牌，没有该字段）domain 不以 "." 开头 → 还原成 host-only（不传 domain）
        const hostOnly = c.hostOnly ?? !c.domain.startsWith(".");
        if (!hostOnly) {
            if (!domainMatches(u.hostname, c.domain)) return null; // 载荷里别的站点的 cookie：不写
            d.domain = c.domain;
        } else if (stripDot(c.domain).toLowerCase() !== u.hostname.toLowerCase()) return null;
    }
    if (c.sameSite !== "unspecified") d.sameSite = c.sameSite;
    if (c.session !== true && typeof c.expirationDate === "number") d.expirationDate = c.expirationDate;
    if (c.partitionKey) d.partitionKey = { ...c.partitionKey };
    return d;
}

/** 内存里的写入前快照 */
export interface Snapshot {
    origin: string; tabId?: number; createdTab: boolean;
    cookies: Map<string, { url: string; name: string; partitionKey?: SetDetails["partitionKey"]; old: RawCookie | null }>;
    local: Map<string, string | null>; session: Map<string, string | null>;
}
export const newSnapshot = (origin: string): Snapshot => ({ origin, createdTab: false, cookies: new Map(), local: new Map(), session: new Map() });

const oldToDetails = (c: RawCookie): SetDetails => {
    const host = stripDot(c.domain);
    const d: SetDetails = { url: `${c.secure ? "https" : "http"}://${host}${c.path}`, name: c.name, value: c.value, path: c.path, secure: c.secure, httpOnly: c.httpOnly };
    if (!c.hostOnly) d.domain = c.domain;
    if (c.sameSite && c.sameSite !== "unspecified") d.sameSite = c.sameSite;
    if (!c.session && typeof c.expirationDate === "number") d.expirationDate = c.expirationDate;
    if (c.partitionKey) d.partitionKey = { ...c.partitionKey };
    return d;
};

/** 写 cookie。snap 给了就先记下被覆盖的旧值（同一键只记第一次，第二次写入不会把我们自己写的值当旧值）。 */
export async function applyCookies(cookies: CookieRec[], origin: string, snap?: Snapshot): Promise<{ applied: number; skipped: number }> {
    let applied = 0, skipped = 0;
    for (const c of cookies) {
        const d = setDetails(c, origin);
        if (!d) { skipped++; continue; }
        const key = cookieKey({ name: c.name, domain: d.domain ?? new URL(origin).hostname, path: d.path ?? "/", partitionKey: d.partitionKey });
        if (snap && !snap.cookies.has(key)) {
            let old: RawCookie | null = null;
            try { old = await api().get({ url: d.url, name: c.name, ...(d.partitionKey ? { partitionKey: d.partitionKey } : {}) }); } catch { old = null; }
            snap.cookies.set(key, { url: d.url, name: c.name, partitionKey: d.partitionKey, old });
        }
        try { if (await api().set(d)) applied++; else skipped++; } catch { skipped++; }
    }
    return { applied, skipped };
}

/** 注入页面执行（自包含）：逐键 setItem，不清空其它键；返回被覆盖的旧值 */
export function writeStorageInPage(local: Array<[string, string]>, session: Array<[string, string]>): { ol: Array<[string, string | null]>; os: Array<[string, string | null]>; fail: number } {
    const out = { ol: [] as Array<[string, string | null]>, os: [] as Array<[string, string | null]>, fail: 0 };
    const put = (st: Storage, items: Array<[string, string]>, old: Array<[string, string | null]>) => { for (const [k, v] of items) { try { old.push([k, st.getItem(k)]); st.setItem(k, v); } catch { out.fail++; } } };
    try { put(localStorage, local, out.ol); } catch { out.fail += local.length; }
    try { put(sessionStorage, session, out.os); } catch { out.fail += session.length; }
    return out;
}
/** 注入页面执行（自包含）：读回指定键 */
export function readKeysInPage(local: string[], session: string[]): { l: Array<string | null>; s: Array<string | null> } {
    const get = (st: Storage, ks: string[]) => ks.map(k => { try { return st.getItem(k); } catch { return null; } });
    let l: Array<string | null> = local.map(() => null), s: Array<string | null> = session.map(() => null);
    try { l = get(localStorage, local); } catch { /* */ }
    try { s = get(sessionStorage, session); } catch { /* */ }
    return { l, s };
}
/** 注入页面执行（自包含）：还原旧值（null = 原来没有 → 删除） */
export function restoreStorageInPage(local: Array<[string, string | null]>, session: Array<[string, string | null]>): number {
    let fail = 0;
    const back = (st: Storage, items: Array<[string, string | null]>) => { for (const [k, v] of items) { try { if (v == null) st.removeItem(k); else st.setItem(k, v); } catch { fail++; } } };
    try { back(localStorage, local); } catch { fail += local.length; }
    try { back(sessionStorage, session); } catch { fail += session.length; }
    return fail;
}
/** 注入页面执行（自包含）：清空 */
export function clearStorageInPage(local: boolean, session: boolean): void {
    try { if (local) localStorage.clear(); } catch { /* */ }
    try { if (session) sessionStorage.clear(); } catch { /* */ }
}

export async function applyStorage(tabId: number, local: Array<[string, string]>, session: Array<[string, string]>, snap?: Snapshot): Promise<number> {
    if (!local.length && !session.length) return 0;
    let r: ReturnType<typeof writeStorageInPage> | undefined;
    try { r = (await chrome.scripting.executeScript({ target: { tabId }, func: writeStorageInPage, args: [local, session] }))?.[0]?.result as typeof r; } catch { throw new SessionError("storage-failed"); }
    if (!r) throw new SessionError("storage-failed");
    if (snap) { for (const [k, v] of r.ol) if (!snap.local.has(k)) snap.local.set(k, v); for (const [k, v] of r.os) if (!snap.session.has(k)) snap.session.set(k, v); }
    return r.fail;
}

/** A5：读回校验——返回与期望不一致的键数 */
export async function verifyStorage(tabId: number, local: Array<[string, string]>, session: Array<[string, string]>): Promise<number> {
    if (!local.length && !session.length) return 0;
    try {
        const r = (await chrome.scripting.executeScript({ target: { tabId }, func: readKeysInPage, args: [local.map(x => x[0]), session.map(x => x[0])] }))?.[0]?.result as ReturnType<typeof readKeysInPage> | undefined;
        if (!r) return local.length + session.length;
        return local.filter((x, i) => r.l[i] !== x[1]).length + session.filter((x, i) => r.s[i] !== x[1]).length;
    } catch { return local.length + session.length; }
}

/** 回滚 / 撤销 cookie：有旧值写回旧值，没有旧值（新建的）删除。返回失败数。 */
export async function restoreCookies(snap: Snapshot): Promise<number> {
    let fail = 0;
    for (const e of snap.cookies.values()) {
        try {
            if (e.old) await api().set(oldToDetails(e.old));
            else await api().remove({ url: e.url, name: e.name, ...(e.partitionKey ? { partitionKey: e.partitionKey } : {}) });
        } catch { fail++; }
    }
    return fail;
}
export async function restoreStorage(snap: Snapshot): Promise<number> {
    if (snap.tabId == null || (!snap.local.size && !snap.session.size)) return 0;
    try {
        const r = (await chrome.scripting.executeScript({ target: { tabId: snap.tabId }, func: restoreStorageInPage, args: [[...snap.local], [...snap.session]] }))?.[0]?.result as number | undefined;
        return r ?? 1;
    } catch { return snap.local.size + snap.session.size; }
}

/* ---- 清除站点数据（#26）：不用 browsingData，按 cookie 逐个 remove，保证「只清当前 origin」并可选存储 ---- */
export async function removeSiteCookies(url: string, tabId?: number): Promise<number> {
    let n = 0;
    for (const c of await listCookies(url, tabId)) {
        const u = `${c.secure ? "https" : "http"}://${stripDot(c.domain)}${c.path}`;
        try { await api().remove({ url: u, name: c.name, ...(c.storeId ? { storeId: c.storeId } : {}), ...(c.partitionKey ? { partitionKey: c.partitionKey } : {}) }); n++; } catch { /* 跳过 */ }
    }
    return n;
}
export async function clearStorage(tabId: number, local: boolean, session: boolean): Promise<void> {
    if (!local && !session) return;
    try { await chrome.scripting.executeScript({ target: { tabId }, func: clearStorageInPage, args: [local, session] }); } catch { throw new SessionError("storage-failed"); }
}

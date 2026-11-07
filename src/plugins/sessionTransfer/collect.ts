/* 采集当前标签页的会话（SC 对齐：DESIGN §2 #8-#13）。只读：不写任何东西，不写日志。 */
import { MAX_COOKIES, SessionError, originOf, type CookieRec, type Payload } from "./container";

type RawCookie = chrome.cookies.Cookie & { partitionKey?: { topLevelSite: string; hasCrossSiteAncestor?: boolean } };
const cookiesApi = () => chrome.cookies as unknown as {
    getAll(d: Record<string, unknown>): Promise<RawCookie[]>;
    getAllCookieStores?(): Promise<Array<{ id: string; tabIds: number[] }>>;
    getPartitionKey?(d: Record<string, unknown>): Promise<{ partitionKey?: { topLevelSite: string; hasCrossSiteAncestor?: boolean } }>;
};

export const cookieKey = (c: { name: string; domain?: string; path: string; partitionKey?: { topLevelSite: string } }) =>
    `${c.name}\0${c.domain ?? ""}\0${c.path}\0${c.partitionKey?.topLevelSite ?? ""}`;

/** 标签页所在的 cookie store（普通 / 无痕）；接口缺失或失败则不指定 */
export async function storeIdOf(tabId: number | undefined): Promise<string | undefined> {
    try {
        const stores = await cookiesApi().getAllCookieStores?.();
        return stores?.find(s => tabId != null && s.tabIds.includes(tabId))?.id;
    } catch { return undefined; }
}

/** SC 的三条查询（url / domain=host / domain=.host，含 HttpOnly），按 name\0domain\0path 去重；另加（Chrome ≥132）顶层 frame 的分区 cookie。 */
export async function listCookies(url: string, tabId?: number): Promise<RawCookie[]> {
    const host = new URL(url).hostname;
    const storeId = await storeIdOf(tabId);
    const base = storeId ? { storeId } : {};
    const api = cookiesApi();
    const qs: Array<Record<string, unknown>> = [{ url, ...base }, { domain: host, ...base }, { domain: "." + host, ...base }];
    let pk: { topLevelSite: string; hasCrossSiteAncestor?: boolean } | undefined;
    if (tabId != null && typeof api.getPartitionKey === "function") {
        try { pk = (await api.getPartitionKey({ tabId, frameId: 0 }))?.partitionKey; } catch { pk = undefined; }
    }
    if (pk) qs.push({ url, partitionKey: pk, ...base });
    const seen = new Map<string, RawCookie>();
    for (const q of qs) {
        let got: RawCookie[] = [];
        try { got = await api.getAll(q); } catch { got = []; }
        for (const c of got) { const k = cookieKey(c); if (!seen.has(k)) seen.set(k, c); }
    }
    return [...seen.values()];
}

const toRec = (c: RawCookie): CookieRec => {
    const r: CookieRec = { name: c.name, value: c.value, domain: c.domain, path: c.path, secure: c.secure, httpOnly: c.httpOnly, sameSite: c.sameSite, hostOnly: c.hostOnly, session: c.session };
    if (!c.session && typeof c.expirationDate === "number") r.expirationDate = c.expirationDate;
    if (c.storeId) r.storeId = c.storeId;
    if (c.partitionKey) r.partitionKey = { topLevelSite: c.partitionKey.topLevelSite, ...(c.partitionKey.hasCrossSiteAncestor != null ? { hasCrossSiteAncestor: c.partitionKey.hasCrossSiteAncestor } : {}) };
    return r;
};

/** 注入页面执行（必须自包含）：读 localStorage / sessionStorage 全部条目 */
export function readStorageInPage(): { o: string; l: Array<[string, string]>; s: Array<[string, string]> } {
    const dump = (st: Storage | null) => { const out: Array<[string, string]> = []; try { if (st) for (let i = 0; i < st.length; i++) { const k = st.key(i); if (k != null) { const v = st.getItem(k); if (v != null) out.push([k, v]); } } } catch { /* 沙箱页 */ } return out; };
    let ls: Storage | null = null, ss: Storage | null = null;
    try { ls = localStorage; } catch { ls = null; }
    try { ss = sessionStorage; } catch { ss = null; }
    return { o: location.origin, l: dump(ls), s: dump(ss) };
}

export const isWebUrl = (u?: string) => !!u && /^https?:\/\//i.test(u);

export async function collect(tab: chrome.tabs.Tab): Promise<Payload> {
    if (tab.id == null) throw new SessionError("no-tab");
    if (!isWebUrl(tab.url)) throw new SessionError("bad-scheme");
    const url = tab.url!, origin = originOf(url);
    let cookies: CookieRec[];
    try { cookies = (await listCookies(url, tab.id)).map(toRec); } catch { throw new SessionError("collect-failed"); }
    if (cookies.length > MAX_COOKIES) throw new SessionError("too-large");
    let l: Array<[string, string]> = [], s: Array<[string, string]> = [];
    try {
        // 仅顶层 frame（不带 allFrames）；ISOLATED 世界与页面共享同源存储
        const res = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: readStorageInPage });
        const r = res?.[0]?.result as ReturnType<typeof readStorageInPage> | undefined;
        if (!r || r.o !== origin) throw new SessionError("collect-failed"); // 采集期间页面已跳转到别的 origin
        l = r.l; s = r.s;
    } catch (e) { throw e instanceof SessionError ? e : new SessionError("collect-failed"); }
    return { v: 2, o: origin, t: Date.now(), l: Object.fromEntries(l), s: Object.fromEntries(s), c: cookies };
}

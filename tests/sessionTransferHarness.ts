/* SessionTransfer 测试夹具：最小假 DOM + 假 chrome（cookies / permissions / tabs / scripting / downloads）。
 * 不含任何真实站点数据；全部在内存里。bun test 里各文件共享模块，所以每个文件自己 install，用完 uninstall。 */

/* ---------------- 最小 DOM ---------------- */
type L = (...e: any[]) => void;
export class FakeEl {
    tag: string; children: Array<FakeEl | FakeText> = []; parent: FakeEl | null = null;
    attrs = new Map<string, string>(); dataset: Record<string, string> = {}; style: Record<string, any> & { setProperty(k: string, v: string): void } = { setProperty() { } };
    className = ""; id = ""; innerHTML = ""; viewBox = ""; value = ""; checked = false; disabled = false; hidden = false; type = ""; placeholder = ""; spellcheck = true; role = ""; title = ""; href = "";
    private ls = new Map<string, L[]>();
    classList = { add: (c: string) => { if (!this.className.split(" ").includes(c)) this.className = (this.className + " " + c).trim(); }, remove: (c: string) => { this.className = this.className.split(" ").filter(x => x !== c).join(" "); }, contains: (c: string) => this.className.split(" ").includes(c) };
    constructor(tag: string) { this.tag = tag; }
    get isConnected(): boolean { return this === (globalThis as any).document?.documentElement || (!!this.parent && this.parent.isConnected); }
    get textContent(): string { return this.children.map(c => c instanceof FakeText ? c.text : c.textContent).join(""); }
    set textContent(v: string) { this.children = [v ? new FakeText(v) : null].filter(Boolean) as FakeText[]; }
    appendChild<T extends FakeEl | FakeText>(c: T): T { if (c instanceof FakeEl) { c.remove(); c.parent = this; } this.children.push(c); return c; }
    append(...cs: Array<FakeEl | FakeText | string>) { for (const c of cs) this.appendChild(typeof c === "string" ? new FakeText(c) : c); }
    remove() { if (this.parent) { this.parent.children = this.parent.children.filter(c => c !== this); this.parent = null; } }
    setAttribute(k: string, v: string) { this.attrs.set(k, v); if (k.startsWith("data-")) this.dataset[k.slice(5).replace(/-(\w)/g, (_, c) => c.toUpperCase())] = v; }
    getAttribute(k: string) { return this.attrs.get(k) ?? null; }
    addEventListener(t: string, f: L) { (this.ls.get(t) ?? this.ls.set(t, []).get(t)!).push(f); }
    removeEventListener(t: string, f: L) { this.ls.set(t, (this.ls.get(t) ?? []).filter(x => x !== f)); }
    dispatch(t: string, ev: Record<string, any> = {}) {
        const e = { type: t, target: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { }, ...ev };
        for (const f of (this.ls.get(t) ?? []).slice()) f(e);
        return e;
    }
    click() { return this.dispatch("click"); }
    focus() { (globalThis as any).document.activeElement = this; } select() { } setPointerCapture() { }
    all(): FakeEl[] { return this.children.flatMap(c => c instanceof FakeEl ? [c, ...c.all()] : []); }
    querySelectorAll(sel: string): FakeEl[] {
        const m = /^\[data-test="([^"]+)"\]$/.exec(sel);
        if (m) return this.all().filter(e => e.attrs.get("data-test") === m[1]);
        if (sel.startsWith(".")) return this.all().filter(e => e.classList.contains(sel.slice(1)));
        return this.all().filter(e => e.tag === sel);
    }
    querySelector(sel: string) { return this.querySelectorAll(sel)[0] ?? null; }
}
export class FakeText { text: string; parent: FakeEl | null = null; constructor(t: string) { this.text = t; } }

export function installDom() {
    const docLs = new Map<string, L[]>();
    const body = new FakeEl("body"), head = new FakeEl("head"), root = new FakeEl("html");
    root.append(head, body);
    const doc: any = {
        body, head, documentElement: root, activeElement: null, execCommandCalls: [] as string[],
        createElement: (t: string) => new FakeEl(t), createElementNS: (_ns: string, t: string) => new FakeEl(t), createTextNode: (t: string) => new FakeText(t),
        addEventListener: (t: string, f: L) => { (docLs.get(t) ?? docLs.set(t, []).get(t)!).push(f); },
        removeEventListener: (t: string, f: L) => { docLs.set(t, (docLs.get(t) ?? []).filter(x => x !== f)); },
        listenerCount: (t: string) => (docLs.get(t) ?? []).length,
        querySelector: (s: string) => root.querySelector(s), querySelectorAll: (s: string) => root.querySelectorAll(s),
        execCommand(c: string) { doc.execCommandCalls.push(c); return true; },
    };
    const g = globalThis as any, had = { d: "document" in g, doc: g.document, n: "Node" in g, node: g.Node };
    g.document = doc;
    g.Node = FakeEl; // h() 只用类型
    doc.uninstall = () => { if (had.d) g.document = had.doc; else delete g.document; if (had.n) g.Node = had.node; else delete g.Node; };
    return doc as { uninstall(): void; createElement: (t: string) => FakeEl; body: FakeEl; head: FakeEl; documentElement: FakeEl; execCommandCalls: string[]; listenerCount(t: string): number; addEventListener: any };
}

/* ---------------- 假 chrome ---------------- */
export interface Ck { name: string; value: string; domain: string; hostOnly: boolean; path: string; secure: boolean; httpOnly: boolean; sameSite: string; session: boolean; expirationDate?: number; storeId: string; partitionKey?: { topLevelSite: string; hasCrossSiteAncestor?: boolean } }
const strip = (d: string) => d.replace(/^\./, "");
const hostMatch = (c: Ck, host: string) => c.hostOnly ? strip(c.domain) === host : host === strip(c.domain) || host.endsWith("." + strip(c.domain));
const pkEq = (a?: { topLevelSite: string }, b?: { topLevelSite: string }) => (a?.topLevelSite ?? "") === (b?.topLevelSite ?? "");
const same = (a: Ck, b: Ck) => a.name === b.name && a.domain === b.domain && a.path === b.path && pkEq(a.partitionKey, b.partitionKey);

export interface FakeTab { id: number; url: string; status: "loading" | "complete"; session: Map<string, string> }
export interface Fc {
    jar: Ck[];
    setCalls: any[]; removeCalls: any[]; getAllCalls: any[]; getCalls: any[];
    failSet?: (d: any) => boolean;
    perm: { granted: boolean; contains: number; request: number; remove: number; requestResult: boolean | "throw"; removeArgs: any[]; requestArgs: any[] };
    tabs: Map<number, FakeTab>; nextTab: number; created: any[]; reloads: number[]; removedTabs: number[];
    onUpdated: Set<L>;
    localByOrigin: Map<string, Map<string, string>>;
    /** SPA 回写：reload 后把这些键写回指定值（次数用完为止） */
    spa?: { remaining: number; values: Record<string, string> };
    exec: any[];
    downloads: any[]; onChanged: Set<L>; onCreated: Set<L>; erased: number[];
    cookiesApiTouches: number;
    hasPartitionKey: boolean; partitionKey?: { topLevelSite: string };
    tabPartition?: boolean;
}

export function installChrome(init: Partial<Fc> = {}) {
    const fc: Fc = {
        jar: [], setCalls: [], removeCalls: [], getAllCalls: [], getCalls: [],
        perm: { granted: false, contains: 0, request: 0, remove: 0, requestResult: true, removeArgs: [], requestArgs: [] },
        tabs: new Map(), nextTab: 100, created: [], reloads: [], removedTabs: [], onUpdated: new Set(), localByOrigin: new Map(), exec: [],
        downloads: [], onChanged: new Set(), onCreated: new Set(), erased: [], cookiesApiTouches: 0, hasPartitionKey: false, ...init,
    };
    const fire = (id: number) => queueMicrotask(() => { const t = fc.tabs.get(id); if (!t) return; t.status = "complete"; for (const l of Array.from(fc.onUpdated)) l(id, { status: "complete" }); });
    const touch = () => { fc.cookiesApiTouches++; };
    const urlOk = (c: Ck, q: any) => {
        const u = new URL(q.url);
        return hostMatch(c, u.hostname) && u.pathname.startsWith(c.path) && (!c.secure || u.protocol === "https:");
    };
    const cookies: any = {
        async getAll(q: any) {
            touch(); fc.getAllCalls.push(structuredClone(q));
            return fc.jar.filter(c => {
                if (q.partitionKey ? !pkEq(c.partitionKey, q.partitionKey) : c.partitionKey) return false;
                if (q.url && !urlOk(c, q)) return false;
                if (q.domain) { const d = strip(q.domain); if (!(strip(c.domain) === d || strip(c.domain).endsWith("." + d))) return false; }
                return true;
            }).map(c => structuredClone(c));
        },
        async get(q: any) { touch(); fc.getCalls.push(structuredClone(q)); const r = fc.jar.find(c => c.name === q.name && urlOk(c, q) && pkEq(c.partitionKey, q.partitionKey)); return r ? structuredClone(r) : null; },
        async set(d: any) {
            touch(); fc.setCalls.push(structuredClone(d));
            if (fc.failSet?.(d)) throw new Error("boom");
            const u = new URL(d.url);
            const c: Ck = {
                name: d.name, value: d.value, hostOnly: d.domain == null, domain: d.domain == null ? u.hostname : (d.domain.startsWith(".") ? d.domain : "." + d.domain),
                path: d.path ?? "/", secure: !!d.secure, httpOnly: !!d.httpOnly, sameSite: d.sameSite ?? "unspecified", session: d.expirationDate == null, storeId: "0",
                ...(d.expirationDate != null ? { expirationDate: d.expirationDate } : {}), ...(d.partitionKey ? { partitionKey: d.partitionKey } : {}),
            };
            const i = fc.jar.findIndex(x => same(x, c)); if (i >= 0) fc.jar[i] = c; else fc.jar.push(c);
            return structuredClone(c);
        },
        async remove(q: any) { touch(); fc.removeCalls.push(structuredClone(q)); const n = fc.jar.length; fc.jar = fc.jar.filter(c => !(c.name === q.name && urlOk(c, q) && pkEq(c.partitionKey, q.partitionKey))); return n === fc.jar.length ? null : q; },
        async getAllCookieStores() { touch(); return [{ id: "0", tabIds: [...fc.tabs.keys()] }]; },
    };
    if (fc.hasPartitionKey) cookies.getPartitionKey = async () => ({ partitionKey: fc.partitionKey });
    const storageOf = (tab: FakeTab, which: "l" | "s") => {
        const m = which === "s" ? tab.session : (fc.localByOrigin.get(new URL(tab.url).origin) ?? fc.localByOrigin.set(new URL(tab.url).origin, new Map()).get(new URL(tab.url).origin)!);
        return { get length() { return m.size; }, key: (i: number) => [...m.keys()][i] ?? null, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, String(v)); }, removeItem: (k: string) => { m.delete(k); }, clear: () => m.clear() };
    };
    const g = globalThis as any;
    const chromeObj: any = {
        runtime: { id: "test", lastError: undefined },
        permissions: {
            async contains(p: any) { fc.perm.contains++; return fc.perm.granted && JSON.stringify(p) === JSON.stringify({ permissions: ["cookies"] }); },
            async request(p: any) { fc.perm.request++; fc.perm.requestArgs.push(structuredClone(p)); if (fc.perm.requestResult === "throw") throw new Error("no gesture"); if (fc.perm.requestResult) fc.perm.granted = true; return fc.perm.requestResult; },
            async remove(p: any) { fc.perm.remove++; fc.perm.removeArgs.push(structuredClone(p)); if (p.permissions?.includes("cookies")) fc.perm.granted = false; return true; },
        },
        tabs: {
            onUpdated: { addListener: (l: L) => fc.onUpdated.add(l), removeListener: (l: L) => fc.onUpdated.delete(l) },
            async create(o: any) { fc.created.push(structuredClone(o)); const id = fc.nextTab++; const t: FakeTab = { id, url: o.url, status: "loading", session: new Map() }; fc.tabs.set(id, t); fire(id); return { id, url: o.url, status: "loading" }; },
            async get(id: number) { const t = fc.tabs.get(id); if (!t) throw new Error("no tab"); return { id, url: t.url, status: t.status }; },
            async reload(id: number) {
                fc.reloads.push(id); const t = fc.tabs.get(id); if (!t) throw new Error("no tab"); t.status = "loading";
                if (fc.spa && fc.spa.remaining > 0) { fc.spa.remaining--; const l = storageOf(t, "l"); for (const [k, v] of Object.entries(fc.spa.values)) l.setItem(k, v); }
                fire(id);
            },
            async remove(id: number) { fc.removedTabs.push(id); fc.tabs.delete(id); },
        },
        scripting: {
            async executeScript(o: { target: { tabId: number }; func: (...a: any[]) => any; args?: any[] }) {
                const t = fc.tabs.get(o.target.tabId); if (!t) throw new Error("no tab");
                fc.exec.push(o.func.name);
                const saved = ["localStorage", "sessionStorage", "location"].map(k => [k, Object.getOwnPropertyDescriptor(g, k)] as const);
                Object.defineProperty(g, "localStorage", { configurable: true, get: () => storageOf(t, "l") });
                Object.defineProperty(g, "sessionStorage", { configurable: true, get: () => storageOf(t, "s") });
                Object.defineProperty(g, "location", { configurable: true, get: () => ({ origin: new URL(t.url).origin }) });
                try { return [{ result: structuredClone(o.func(...structuredClone(o.args ?? []))) }]; }
                finally { for (const [k, d] of saved) { if (d) Object.defineProperty(g, k, d); else delete g[k]; } }
            },
        },
        downloads: {
            async download(o: any) { fc.downloads.push(o); return 7; },
            async erase(q: any) { fc.erased.push(q.id); return [q.id]; },
            onChanged: { addListener: (l: L) => fc.onChanged.add(l), removeListener: (l: L) => fc.onChanged.delete(l) },
            onCreated: { addListener: (l: L) => fc.onCreated.add(l), removeListener: (l: L) => fc.onCreated.delete(l) },
        },
        storage: { local: { get: async () => ({}), set: async () => { } } },
    };
    Object.defineProperty(chromeObj, "cookies", { get: () => (fc.perm.granted ? cookies : undefined), enumerable: true });
    const prev = g.chrome; g.chrome = chromeObj;
    const addTab = (url: string, session: Record<string, string> = {}) => { const id = fc.nextTab++; fc.tabs.set(id, { id, url, status: "complete", session: new Map(Object.entries(session)) }); return { id, url } as chrome.tabs.Tab; };
    const ck = (o: Partial<Ck> & { name: string; value: string; domain: string }): Ck => ({ hostOnly: !o.domain.startsWith("."), path: "/", secure: true, httpOnly: false, sameSite: "lax", session: o.expirationDate == null, storeId: "0", ...o });
    return { fc, addTab, ck, local: (origin: string) => fc.localByOrigin.get(origin) ?? fc.localByOrigin.set(origin, new Map()).get(origin)!, uninstall() { g.chrome = prev; } };
}

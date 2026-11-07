/* WebDAV 单测用的内存假服务器：替换 globalThis.fetch（只在测试里；扩展代码里 fetch 只出现在 webdav/client.ts）。
 * 只模拟协议行为（状态码 / 认证 / 207 的几种前缀写法）——不是真实服务；真实 wsgidav 夹具见 T-D9 与 fixtures/webdav/。 */
export interface Req { method: string; url: string; headers: Record<string, string>; body?: Uint8Array | string; init: RequestInit }
export type Style = "d" | "D" | "ns0" | "default" | "x";

const enc = new TextEncoder();
const bytesOf = (b: unknown): Uint8Array | string | undefined => b == null ? undefined : typeof b === "string" ? b : new Uint8Array(b as ArrayBufferLike);

export class FakeDav {
    origin = "https://dav.example.com";
    dir = "/dav/arc/";
    files = new Map<string, { bytes: Uint8Array; mtime: number }>();
    others = new Map<string, number>();   // 目录里别人的文件（名字不符合规则）
    dirExists = true;
    /** 设置后所有请求都得到这个 3xx，并按浏览器 fetch 的 redirect 语义处理：error → 抛 TypeError；manual → opaqueredirect（status 0）；follow → 真的去请求 Location（记进 reqs） */
    redirect?: { status: number; to: string };
    user = "cat"; pass = "pw-test"; bearer?: string;
    style: Style = "d";
    reqs: Req[] = [];
    /** 返回 Response 覆盖默认行为；返回 Error 则让 fetch 抛出；返回 undefined 走默认 */
    override?: (r: Req) => Response | Error | undefined | Promise<Response | Error | undefined>;
    get dirUrl() { return this.origin + this.dir; }
    put(name: string, bytes: Uint8Array, mtime = Date.now()) { this.files.set(name, { bytes, mtime }); }
    count(method: string) { return this.reqs.filter(r => r.method === method).length; }

    private authed(h: Record<string, string>) {
        const a = h.Authorization ?? "";
        if (this.bearer) return a === `Bearer ${this.bearer}`;
        return a === "Basic " + Buffer.from(`${this.user}:${this.pass}`, "utf8").toString("base64");
    }
    private xml(): string {
        const t = (s: string, inner = "") => this.style === "default" ? `<${s}>${inner}</${s}>` : `<${this.p}${s}>${inner}</${this.p}${s}>`;
        const root = (inner: string) => this.style === "default" ? `<multistatus xmlns="DAV:">${inner}</multistatus>` : `<${this.p}multistatus xmlns${this.nsDecl}="DAV:">${inner}</${this.p}multistatus>`;
        const coll = this.style === "default" ? "<collection/>" : `<${this.p}collection/>`;
        const resp = (href: string, isDir: boolean, size?: number, mtime?: number) =>
            t("response", t("href", href) + t("propstat", t("prop", (mtime ? t("getlastmodified", new Date(mtime).toUTCString()) : "") + (size !== undefined ? t("getcontentlength", String(size)) : "") + t("resourcetype", isDir ? coll : "")) + t("status", "HTTP/1.1 200 OK")));
        let body = resp(this.dir, true, undefined, Date.now());
        body += resp(this.dir + "sub/", true);
        for (const [n, f] of this.files) body += resp(this.dir + encodeURIComponent(n), false, f.bytes.length, f.mtime);
        for (const [n, m] of this.others) body += resp(this.dir + encodeURIComponent(n), false, 3, m);
        return `<?xml version="1.0" encoding="utf-8"?>` + root(body);
    }
    private get p() { return this.style === "d" ? "d:" : this.style === "D" ? "D:" : this.style === "ns0" ? "ns0:" : this.style === "x" ? "weird:" : ""; }
    private get nsDecl() { return this.style === "default" ? "" : ":" + this.p.slice(0, -1); }

    fetch = async (input: unknown, init: RequestInit = {}): Promise<Response> => {
        const url = String(input), method = String(init.method ?? "GET").toUpperCase();
        const req: Req = { method, url, headers: { ...(init.headers as Record<string, string>) }, body: bytesOf(init.body), init };
        this.reqs.push(req);
        const o = await this.override?.(req);
        if (o instanceof Error) throw o;
        if (o) return o;
        if (this.redirect) {
            const mode = init.redirect ?? "follow";
            if (mode === "error") throw new TypeError("Failed to fetch");
            if (mode === "manual") { const r = new Response(null, { status: 200 }); Object.defineProperty(r, "type", { value: "opaqueredirect" }); Object.defineProperty(r, "status", { value: 0 }); return r; }
            this.reqs.push({ method, url: this.redirect.to, headers: { ...req.headers }, body: req.body, init }); // follow：浏览器会带着同样的头去请求目标
            return new Response("", { status: 200 });
        }
        if (!this.authed(req.headers)) return new Response("no", { status: 401 });
        const u = new URL(url);
        if (!u.pathname.startsWith(this.dir) && u.pathname + "/" !== this.dir) return new Response("", { status: 404 });
        const name = decodeURIComponent(u.pathname.slice(this.dir.length));
        switch (method) {
            case "MKCOL": if (this.dirExists) return new Response("", { status: 405 }); this.dirExists = true; return new Response("", { status: 201 });
            case "PROPFIND": return this.dirExists ? new Response(this.xml(), { status: 207, headers: { "content-type": "application/xml" } }) : new Response("", { status: 404 });
            case "PUT": {
                if (!this.dirExists) return new Response("", { status: 409 });
                const had = this.files.has(name);
                this.files.set(name, { bytes: new Uint8Array(req.body as Uint8Array), mtime: Date.now() });
                return new Response("", { status: had ? 204 : 201 });
            }
            case "GET": { const f = this.files.get(name); return f ? new Response(f.bytes as BodyInit, { status: 200, headers: { "content-length": String(f.bytes.length) } }) : new Response("", { status: 404 }); }
            case "DELETE": return this.files.delete(name) ? new Response("", { status: 204 }) : new Response("", { status: 404 });
            default: return new Response("", { status: 405 });
        }
    };
    /** 把 fetch 换成本假服务器，返回还原函数 */
    install(): () => void { const prev = globalThis.fetch; globalThis.fetch = this.fetch as unknown as typeof fetch; return () => { globalThis.fetch = prev; }; }
}
export const utf8 = (s: string) => enc.encode(s);

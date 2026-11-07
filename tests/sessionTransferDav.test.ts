/* 会话传递 · WebDAV 通道单测（DESIGN v3 §8：T-D1…T-D9）。
 * 用内存假 WebDAV（tests/sessionTransferDavHarness.ts，替换 globalThis.fetch）与假 chrome / 假秘密库。
 * ⚠ 全部是协议层单测：扩展页真实 fetch（CORS 绕过 / PROPFIND / Authorization）在 Chrome 里的行为、真实云服务（坚果云 / Nextcloud / Synology…）都没有测（见 HEADED-TODO.md H9–H12）。
 * T-D9 只在设置了 DAV_FIXTURE=http://127.0.0.1:18080 时运行（盒内 wsgidav 夹具，跳过则标 skip）。 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";

import { FakeDav, utf8 } from "./sessionTransferDavHarness";
import { installChrome, installDom } from "./sessionTransferHarness";

const dir = "src/plugins/sessionTransfer/webdav";
const src = (f: string) => readFileSync(`${dir}/${f}`, "utf8");
const code0 = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\s\/\/ .*$/gm, "");

/* ---------- 环境：假 chrome（含 storage.local 记录）/ 控制台计数 / 假秘密库 ---------- */
const mem: Record<string, unknown> = {};
const storageWrites: string[] = [];
const dom = installDom();
const T = installChrome();
const C = chrome as any;
const ev = () => ({ addListener() { }, removeListener() { } });
C.runtime.reload = () => { }; C.runtime.onMessage = ev();
C.storage = {
    local: {
        get: async (k?: string | null) => (k == null ? structuredClone(mem) : k in mem ? { [k]: structuredClone(mem[k]) } : {}),
        set: async (o: Record<string, unknown>) => { storageWrites.push(JSON.stringify(o)); Object.assign(mem, structuredClone(o)); },
        clear: async () => { for (const k of Object.keys(mem)) delete mem[k]; },
        remove: async (k: string) => { delete mem[k]; },
    },
    sync: { set: async (o: Record<string, unknown>) => { storageWrites.push(JSON.stringify(o)); } },
    onChanged: ev(),
};
(globalThis as any).IS_DEV = false; (globalThis as any).VERSION = "test";
const consoleCalls: string[] = [];
const savedConsole: Record<string, unknown> = {};
for (const k of ["log", "info", "warn", "error", "debug", "trace"] as const) { savedConsole[k] = console[k]; (console as any)[k] = (...a: unknown[]) => { consoleCalls.push(`${k}:${a.map(String).join(" ")}`); }; }
const idb = { ops: [] as string[], map: new Map<string, unknown>() };
const fakeArea = {
    async get(k: string) { idb.ops.push(`get:${k}`); return idb.map.has(k) ? { [k]: structuredClone(idb.map.get(k)) } : {}; },
    async set(o: Record<string, unknown>) { idb.ops.push(`set:${Object.keys(o).join(",")}`); for (const [k, v] of Object.entries(o)) idb.map.set(k, structuredClone(v)); },
    async remove(k: string) { idb.ops.push(`remove:${k}`); idb.map.delete(k); },
};

const { PBKDF2_ITERATIONS, parsePayload } = await import("../src/plugins/sessionTransfer/container");
const { DavError } = await import("../src/plugins/sessionTransfer/webdav/errors");
const { normalizeDir } = await import("../src/plugins/sessionTransfer/webdav/url");
const { parseMultistatus, MAX_XML_BYTES } = await import("../src/plugins/sessionTransfer/webdav/xml");
const F = await import("../src/plugins/sessionTransfer/webdav/format");
const K = await import("../src/plugins/sessionTransfer/webdav/client");
const O = await import("../src/plugins/sessionTransfer/webdav/ops");
const Cfg = await import("../src/plugins/sessionTransfer/webdav/config");
const { dump, restore, stripSecrets, isSecretKey } = await import("../src/plugins/data/backup/index");
const { pickSyncable } = await import("../src/plugins/data/backup/sync");

const dav = new FakeDav();
let restoreFetch = () => { };
const realSetTimeout = globalThis.setTimeout, realClearTimeout = globalThis.clearTimeout;
const PAYLOAD = { v: 2 as const, o: "https://app.example.com", t: 1, l: { theme: "dark" }, s: {}, c: [{ name: "sid", value: "COOKIE-SENTINEL-1", domain: "app.example.com", path: "/", secure: true, httpOnly: true, sameSite: "lax" as const, hostOnly: true, session: true }] };
const PASS = "correct horse battery";
const conn = (over: Partial<import("../src/plugins/sessionTransfer/webdav/client").DavAuth> = {}) => ({ dir: dav.dirUrl, auth: { kind: "basic" as const, user: "cat", secret: "pw-test", ...over } });
const code = async (p: Promise<unknown>) => { try { await p; return "ok"; } catch (e) { return (e as { code?: string }).code ?? `other:${String(e)}`; } };
const methods = () => dav.reqs.map(r => r.method);
const latin1 = (b: Uint8Array | string | undefined) => b == null ? "" : typeof b === "string" ? b : new TextDecoder("latin1").decode(b);

beforeAll(() => { restoreFetch = dav.install(); Cfg.setConfigStore(fakeArea); });
afterAll(() => {
    restoreFetch(); Cfg.setConfigStore(undefined);
    for (const [k, v] of Object.entries(savedConsole)) (console as any)[k] = v;
    globalThis.setTimeout = realSetTimeout; globalThis.clearTimeout = realClearTimeout;
    T.uninstall(); dom.uninstall();
});
beforeEach(() => {
    dav.reqs.length = 0; dav.files.clear(); dav.others.clear(); dav.dirExists = true; dav.override = undefined; dav.style = "d"; dav.bearer = undefined; dav.user = "cat"; dav.pass = "pw-test";
    consoleCalls.length = 0; storageWrites.length = 0; idb.ops.length = 0; idb.map.clear(); for (const k of Object.keys(mem)) delete mem[k];
    globalThis.setTimeout = realSetTimeout; globalThis.clearTimeout = realClearTimeout;
    T.fc.perm.granted = true; T.fc.jar.length = 0;
});

const wrap = (inner: string, ns = 'xmlns:d="DAV:"', p = "d:") => `<?xml version="1.0"?><${p}multistatus ${ns}>${inner}</${p}multistatus>`;
const resp = (href: string, props = "", status = "HTTP/1.1 200 OK", p = "d:") => `<${p}response><${p}href>${href}</${p}href><${p}propstat><${p}prop>${props}</${p}prop><${p}status>${status}</${p}status></${p}propstat></${p}response>`;
const D1 = "https://dav.example.com/dav/arc/";
const NAME_A = "0123456789abcdef0123456789abcdef-zzzz.arcdav";

/* ====================== T-D1 PROPFIND 解析 ====================== */
describe("T-D1 PROPFIND（207）解析", () => {
    const fx = (f: string) => readFileSync(`tests/fixtures/${f}`, "utf8");
    test("真实 wsgidav 抓取（ns0: 前缀）：两个文件，目录自身被丢弃，中文 / 空格 / %2B 文件名解码", () => {
        const es = parseMultistatus(fx("webdav-propfind-2files-ns0.xml"), "https://127.0.0.1:18080/cat-session/");
        expect(es.map(e => e.name)).toEqual(["会话 a+b.arcdav", "193e2caedf71b4fc45be111a12357990-zz.arcdav"]);
        expect(es.map(e => e.size)).toEqual([1, 2]);
        expect(es.every(e => !e.isDir && e.mtime === Date.parse("Wed, 28 Oct 2026 08:55:37 GMT"))).toBe(true);
    });
    test("真实抓取：空目录 → []", () => { expect(parseMultistatus(fx("webdav-propfind-empty-ns0.xml"), "https://127.0.0.1:18080/cat-session/")).toEqual([]); });
    for (const style of ["d", "D", "default", "x"] as const) {
        test(`合成样例：前缀写法 ${style}（经 davList 走完整请求路径）`, async () => {
            dav.style = style; dav.put(NAME_A, new Uint8Array(5), 1_700_000_000_000); dav.others.set("别人的.txt", 1);
            const es = await K.davList(conn());
            expect(es.map(e => [e.name, e.isDir, e.size])).toEqual([["sub", true, undefined], [NAME_A, false, 5], ["别人的.txt", false, 3]]);
            expect(es[1]!.mtime).toBe(Date.parse(new Date(1_700_000_000_000).toUTCString()));
        });
    }
    test("请求：PROPFIND、Depth:1、请求体只要 getlastmodified / getcontentlength / resourcetype", async () => {
        await K.davList(conn());
        const r = dav.reqs[0]!;
        expect(r.method).toBe("PROPFIND"); expect(r.headers.Depth).toBe("1"); expect(r.url).toBe(D1);
        expect(String(r.body)).toMatch(/getlastmodified.*getcontentlength.*resourcetype/);
        expect(String(r.body)).not.toMatch(/allprop/);
    });
    test("属性名大小写混合 + 多 propstat：只采用 200 的那一组；404 组里的值被忽略", () => {
        const x = wrap(`<d:response><d:href>/dav/arc/${NAME_A}</d:href>
            <d:propstat><d:prop><d:GetContentLength>999</d:GetContentLength></d:prop><d:status>HTTP/1.1 404 Not Found</d:status></d:propstat>
            <d:propstat><d:prop><D:x xmlns:D="urn:other"/><d:GETLASTMODIFIED>Wed, 28 Oct 2026 08:55:37 GMT</d:GETLASTMODIFIED><d:getContentLength>12</d:getContentLength></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`);
        const [e] = parseMultistatus(x, D1);
        expect(e).toEqual({ name: NAME_A, isDir: false, size: 12, mtime: Date.parse("Wed, 28 Oct 2026 08:55:37 GMT") });
    });
    test("只有 404 的 propstat（排在 200 组之后 / 单独出现）：其中的大小 / 时间 / 目录标记一律不采用", () => {
        const NAME_B = "fedcba9876543210fedcba9876543210-zzzz.arcdav";
        const x = wrap(`<d:response><d:href>/dav/arc/${NAME_A}</d:href>
            <d:propstat><d:prop><d:getcontentlength>12</d:getcontentlength></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>
            <d:propstat><d:prop><d:getcontentlength>999</d:getcontentlength><d:getlastmodified>Wed, 28 Oct 2026 08:55:37 GMT</d:getlastmodified><d:resourcetype><d:collection/></d:resourcetype></d:prop><d:status>HTTP/1.1 404 Not Found</d:status></d:propstat></d:response>`);
        expect(parseMultistatus(x, D1)).toEqual([{ name: NAME_A, isDir: false, size: 12 }]);
        const y = wrap(`<d:response><d:href>/dav/arc/${NAME_B}</d:href>
            <d:propstat><d:prop><d:getcontentlength>7</d:getcontentlength></d:prop><d:status>HTTP/1.1 403 Forbidden</d:status></d:propstat></d:response>`);
        expect(parseMultistatus(y, D1)).toEqual([{ name: NAME_B, isDir: false }]);
    });
    test("目录判定：<collection/> 的几种写法 / href 末尾斜杠；普通文件不是目录", () => {
        const mk = (rt: string) => parseMultistatus(wrap(resp("/dav/arc/f", `<d:resourcetype>${rt}</d:resourcetype>`)), D1)[0]!.isDir;
        expect(mk("<d:collection/>")).toBe(true); expect(mk("<d:collection />")).toBe(true); expect(mk("<d:collection></d:collection>")).toBe(true);
        expect(mk("")).toBe(false);
        expect(parseMultistatus(wrap(resp("/dav/arc/sub/", "")), D1)[0]!.isDir).toBe(true);
    });
    test("缺失 / 非数字 / 非法日期的属性 → undefined，不抛错", () => {
        const [e] = parseMultistatus(wrap(resp(`/dav/arc/${NAME_A}`, "<d:getcontentlength>12abc</d:getcontentlength><d:getlastmodified>not a date</d:getlastmodified>")), D1);
        expect(e).toEqual({ name: NAME_A, isDir: false });
        expect(parseMultistatus(wrap(resp(`/dav/arc/${NAME_A}`, "")), D1)[0]).toEqual({ name: NAME_A, isDir: false });
        expect(parseMultistatus(wrap(resp(`/dav/arc/${NAME_A}`, "<d:getcontentlength>-5</d:getcontentlength>")), D1)[0]!.size).toBeUndefined();
    });
    test("实体 / CDATA / 注释 / 处理指令", () => {
        const x = wrap(`<!-- c --><?pi x?>` + resp(`/dav/arc/a%26b.arcdav`, "<d:getcontentlength><![CDATA[7]]></d:getcontentlength>"));
        expect(parseMultistatus(x, D1)).toEqual([{ name: "a&b.arcdav", isDir: false, size: 7 }]);
        expect(parseMultistatus(wrap(`<d:response><d:href>/dav/arc/a&amp;b</d:href></d:response>`), D1)[0]!.name).toBe("a&b");
    });
    test("拒绝：超过 2 MiB / DOCTYPE / ENTITY（任意大小写）/ HTML 登录页 / 非 multistatus / 命名空间不对 / 未闭合 / 乱序闭合 / 未声明前缀", () => {
        const bad = (x: string) => { try { parseMultistatus(x, D1); return "ok"; } catch (e) { return (e as { code: string }).code; } };
        expect(bad(wrap("x".repeat(MAX_XML_BYTES)))).toBe("dav-bad-xml");
        expect(bad(`<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY a "b">]>` + wrap(""))).toBe("dav-bad-xml");
        expect(bad(wrap("") + "<!doctype x>")).toBe("dav-bad-xml");
        expect(bad(wrap(`<!ENTITY x "y">`))).toBe("dav-bad-xml");
        expect(bad(`<!-- ok --><!DocType html>`)).toBe("dav-bad-xml");
        expect(bad("<html><body><form>Please sign in</form></body></html>")).toBe("dav-bad-xml");
        expect(bad("<!DOCTYPE html><html></html>")).toBe("dav-bad-xml");
        expect(bad("")).toBe("dav-bad-xml");
        expect(bad("just text")).toBe("dav-bad-xml");
        expect(bad(`<multistatus xmlns="urn:not-dav"></multistatus>`)).toBe("dav-bad-xml");
        expect(bad(`<d:prop xmlns:d="DAV:"/>`)).toBe("dav-bad-xml");
        expect(bad(`<d:multistatus xmlns:d="DAV:"><d:response>`)).toBe("dav-bad-xml");
        expect(bad(`<d:multistatus xmlns:d="DAV:"><d:response></d:multistatus></d:response>`)).toBe("dav-bad-xml");
        expect(bad(`<q:multistatus xmlns:d="DAV:"></q:multistatus>`)).toBe("dav-bad-xml");
        expect(bad(wrap("") + wrap(""))).toBe("dav-bad-xml");
        expect(bad(wrap(`<d:response><d:href>&bogus;</d:href></d:response>`))).toBe("dav-bad-xml");
        expect(bad("<a>".repeat(100))).toBe("dav-bad-xml");
    });
    test("客户端：响应体超过 2 MiB 时不读完整个响应，直接 dav-bad-xml；非 207 / HTML 登录页（200）→ 错误码", async () => {
        dav.override = r => r.method === "PROPFIND" ? new Response("x".repeat(MAX_XML_BYTES + 10), { status: 207 }) : undefined;
        expect(await code(K.davList(conn()))).toBe("dav-bad-xml");
        dav.override = () => new Response("<html>login</html>", { status: 200 });
        expect(await code(K.davList(conn()))).toBe("dav-server");
        dav.override = () => new Response("<html>login</html>", { status: 207 });
        expect(await code(K.davList(conn()))).toBe("dav-bad-xml");
    });
});

/* ====================== T-D2 路径与编码 ====================== */
describe("T-D2 路径 / 编码 / 文件名规则", () => {
    const names = (x: string, d = D1) => parseMultistatus(x, d).map(e => e.name);
    test("href：百分号编码（中文 / 空格 / %2B），'+' 不是空格；绝对 URL；子路径前缀", () => {
        expect(names(wrap(resp("/dav/arc/%E4%BC%9A%E8%AF%9D%20a%2Bb") + resp("/dav/arc/a+b") + resp("https://other-host.example.org/dav/arc/abs.arcdav")))).toEqual(["会话 a+b", "a+b", "abs.arcdav"]);
        const d2 = "https://cloud.example.com/remote.php/dav/files/u/arc%20dir/";
        expect(names(wrap(resp("/remote.php/dav/files/u/arc%20dir/") + resp("/remote.php/dav/files/u/arc%20dir/x.arcdav")), d2)).toEqual(["x.arcdav"]);
    });
    test("目录自身的各种写法都被丢弃：无尾斜杠 / 大小写不同 / 编码不同 / 绝对 URL", () => {
        expect(names(wrap(resp("/dav/arc") + resp("/DAV/ARC/") + resp("/dav/%61rc/") + resp("https://dav.example.com/dav/arc/") + resp("/dav/") + resp("/")))).toEqual([]);
    });
    test("目录之外 / 越级 / 更深层 / 前缀相似的 href 一律丢弃", () => {
        expect(names(wrap(resp("/other/x.arcdav") + resp("/dav/arc/../etc/x.arcdav") + resp("/dav/arc/sub/deep.arcdav") + resp("/dav/arcx/y.arcdav") + resp("/dav/arc/%2E%2E/z") + resp("/dav/arc/a%2Fb.arcdav") + resp("/dav/arc/%E4%BC%9A%") + resp("/dav/arc/ok.arcdav")))).toEqual(["ok.arcdav"]);
    });
    test("urlFor：名字只能是 32 位十六进制-过期.arcdav，否则在发请求前拒绝；合法名字原样进入 URL", async () => {
        for (const bad of ["../x.arcdav", "a/b.arcdav", "x.arcdav", "0123456789ABCDEF0123456789ABCDEF-zz.arcdav", "0123456789abcdef0123456789abcdef-.arcdav", "0123456789abcdef0123456789abcdef-zzzzzzzzz.arcdav", "0123456789abcdef0123456789abcdef-zz.arcdav.bak", " 0123456789abcdef0123456789abcdef-zz.arcdav"]) {
            expect(await code(K.davGet(conn(), bad))).toBe("dav-bad-format");
            expect(await code(K.davDelete(conn(), bad))).toBe("dav-bad-format");
        }
        expect(dav.reqs.length).toBe(0);
        dav.put(NAME_A, new Uint8Array([1, 2]));
        expect([...await K.davGet(conn(), NAME_A)]).toEqual([1, 2]);
        expect(dav.reqs[0]!.url).toBe(D1 + NAME_A);
    });
    test("文件名规则：NAME_RE 接受与拒绝", () => {
        for (const ok of [NAME_A, "00000000000000000000000000000000-1.arcdav", "ffffffffffffffffffffffffffffffff-zzzzzzzz.arcdav"]) expect(F.NAME_RE.test(ok)).toBe(true);
        for (const bad of ["", "abc.arcdav", NAME_A + "x", "0123456789abcdef0123456789abcde-zz.arcdav", "0123456789abcdef0123456789abcdef-ZZ.arcdav", "0123456789abcdef0123456789abcdef_zz.arcdav"]) expect(F.NAME_RE.test(bad)).toBe(false);
    });
    test("列表只含文件名规则内的文件：别人的文件、子目录不出现；且 mtime 倒序、最多 50 项", async () => {
        dav.others.set("notes.txt", 5); dav.style = "ns0";
        for (let i = 0; i < 60; i++) dav.put(`${i.toString(16).padStart(32, "0")}-zzzz.arcdav`, new Uint8Array(1), 1_700_000_000_000 + i * 1000);
        const items = await O.davListItems(conn(), 1);
        expect(items.length).toBe(50);
        expect(items.every(i => F.NAME_RE.test(i.name))).toBe(true);
        const mt = items.map(i => i.mtime!); expect(mt).toEqual([...mt].sort((a, b) => b - a));
        expect(items[0]!.name).toBe(`${(59).toString(16).padStart(32, "0")}-zzzz.arcdav`);
    });
});

/* ====================== T-D3 状态码 / 网络错误 / 请求选项 ====================== */
describe("T-D3 状态码与错误映射", () => {
    const status = (n: number, only?: string) => (r: { method: string }) => (only && r.method !== only ? undefined : new Response("SECRET-BODY-text", { status: n }));
    const PUTB = () => F.sealDav(PAYLOAD, PASS, { label: "l", ttlMs: 60_000 });
    test("401：不重试，只发一个请求（PROPFIND / GET / DELETE / PUT）", async () => {
        dav.pass = "other";
        expect(await code(K.davList(conn()))).toBe("dav-auth");
        expect(await code(K.davGet(conn(), NAME_A))).toBe("dav-auth");
        expect(await code(K.davDelete(conn(), NAME_A))).toBe("dav-auth");
        expect(await code(PUTB().then(s => K.davPut(conn(), s.name, s.bytes)))).toBe("dav-auth");
        expect(methods()).toEqual(["PROPFIND", "GET", "DELETE", "PUT"]);
    });
    test("403 / 404 / 405 / 413 / 507 / 5xx / 其它 4xx → 对应枚举码", async () => {
        const table: Array<[number, string]> = [[403, "dav-forbidden"], [405, "dav-forbidden"], [404, "dav-not-found"], [413, "dav-too-large"], [507, "dav-quota"], [500, "dav-server"], [502, "dav-server"], [503, "dav-server"], [418, "dav-server"], [412, "dav-server"]];
        for (const [s, c] of table) { dav.override = status(s, "GET"); expect(await code(K.davGet(conn(), NAME_A))).toBe(c); }
        for (const [s, c] of table.filter(([s]) => s !== 404)) { dav.override = status(s, "PROPFIND"); expect(await code(K.davList(conn()))).toBe(c); }
        const s = await PUTB();
        for (const [st, c] of [[403, "dav-forbidden"], [413, "dav-too-large"], [507, "dav-quota"], [500, "dav-server"]] as Array<[number, string]>) { dav.override = status(st, "PUT"); expect(await code(K.davPut(conn(), s.name, s.bytes))).toBe(c); }
    });
    test("目录还没建：PROPFIND 404 → dav-dir-absent（不是 dav-not-found「File not found」）；只发 1 个 PROPFIND，不 MKCOL / 不 PUT（不自动创建）；GET / DELETE 的 404 仍是 dav-not-found", async () => {
        dav.dirExists = false;
        expect(await code(K.davList(conn()))).toBe("dav-dir-absent"); expect(methods()).toEqual(["PROPFIND"]);
        expect(await code(O.davListItems(conn()))).toBe("dav-dir-absent"); expect(dav.count("MKCOL")).toBe(0); expect(dav.count("PUT")).toBe(0);
        dav.dirExists = true; dav.reqs.length = 0;
        expect(await code(K.davGet(conn(), NAME_A))).toBe("dav-not-found"); expect(await code(K.davDelete(conn(), NAME_A))).toBe("dav-not-found");
        dav.override = status(404, "PROPFIND"); expect(await code(K.davList(conn()))).toBe("dav-dir-absent");
    });
    test("PUT 目录不存在（409 或 404）→ 只 MKCOL 最后一级一次，再 PUT 一次", async () => {
        const s = await PUTB();
        dav.dirExists = false;
        await K.davPut(conn(), s.name, s.bytes);
        expect(methods()).toEqual(["PUT", "MKCOL", "PUT"]);
        expect(dav.reqs[1]!.url).toBe(D1); expect(dav.files.has(s.name)).toBe(true);
        dav.reqs.length = 0; dav.files.clear();
        let first = true; dav.override = r => { if (r.method === "PUT" && first) { first = false; return new Response("", { status: 404 }); } return undefined; };
        await K.davPut(conn(), s.name, s.bytes);
        expect(methods()).toEqual(["PUT", "MKCOL", "PUT"]);
    });
    test("MKCOL：405（已存在）算成功；403 / 409 / 404 → dav-dir-missing（不再重试 PUT）；创建后 PUT 仍 404/409 → dav-dir-missing", async () => {
        const s = await PUTB();
        dav.override = r => r.method === "PUT" ? new Response("", { status: 409 }) : r.method === "MKCOL" ? new Response("", { status: 405 }) : undefined;
        expect(await code(K.davPut(conn(), s.name, s.bytes))).toBe("dav-dir-missing"); expect(methods()).toEqual(["PUT", "MKCOL", "PUT"]);
        for (const st of [403, 409, 404]) {
            dav.reqs.length = 0;
            dav.override = r => r.method === "PUT" ? new Response("", { status: 409 }) : r.method === "MKCOL" ? new Response("", { status: st }) : undefined;
            expect(await code(K.davPut(conn(), s.name, s.bytes))).toBe("dav-dir-missing"); expect(methods()).toEqual(["PUT", "MKCOL"]);
        }
        dav.reqs.length = 0; dav.override = r => r.method === "MKCOL" ? new Response("", { status: 507 }) : r.method === "PUT" ? new Response("", { status: 409 }) : undefined;
        expect(await code(K.davPut(conn(), s.name, s.bytes))).toBe("dav-quota");
    });
    test("H9-redirect：服务器回 3xx（浏览器语义：redirect 选项决定行为）→ dav-redirect，而不是 dav-network；每个动作只发 1 个请求、0 次跟随、没有任何请求发到 Location", async () => {
        try { for (const st of [301, 302, 307, 308]) {
            dav.redirect = { status: st, to: "https://evil.example.org/steal" };
            const s = await F.sealDav(PAYLOAD, PASS, { label: "x", ttlMs: 60_000 });
            for (const [m, run] of [["PROPFIND", () => K.davList(conn())], ["GET", () => K.davGet(conn(), NAME_A)], ["DELETE", () => K.davDelete(conn(), NAME_A)], ["PUT", () => K.davPut(conn(), s.name, s.bytes)], ["MKCOL", () => K.davMkcol(conn())]] as Array<[string, () => Promise<unknown>]>) {
                dav.reqs.length = 0;
                expect(await code(run())).toBe("dav-redirect"); expect(methods()).toEqual([m]);
                expect(dav.reqs.every(r => r.url.startsWith(dav.origin))).toBe(true);
            }
        } } finally { dav.redirect = undefined; }
    });
    test("网络错误（TypeError）→ dav-network；中止 → dav-timeout；3xx / opaqueredirect → dav-redirect", async () => {
        dav.override = () => new TypeError("Failed to fetch SECRET-URL");
        expect(await code(K.davList(conn()))).toBe("dav-network");
        for (const st of [301, 302, 307, 308]) { dav.override = () => new Response("", { status: st, headers: { location: "https://evil.example.org/" } }); expect(await code(K.davGet(conn(), NAME_A))).toBe("dav-redirect"); }
        const op = new Response("", { status: 200 }); Object.defineProperty(op, "type", { value: "opaqueredirect" });
        dav.override = () => op; expect(await code(K.davGet(conn(), NAME_A))).toBe("dav-redirect");
        dav.override = () => Object.assign(new Error("x"), { name: "AbortError" });
        expect(await code(K.davGet(conn(), NAME_A))).toBe("dav-timeout");
    });
    test("超时：每个请求 30 s + 1 s/MiB（≤120 s）；到时 abort → dav-timeout；成功后计时器被清掉", async () => {
        const live = new Set<unknown>(); const delays: number[] = [];
        globalThis.setTimeout = ((fn: () => void, ms?: number, ...a: unknown[]) => { const h = realSetTimeout(fn, (ms ?? 0) >= 30000 ? 0 : ms, ...a); if ((ms ?? 0) >= 30000) { delays.push(ms!); live.add(h); } return h; }) as never;
        globalThis.clearTimeout = ((h: never) => { live.delete(h); return realClearTimeout(h); }) as never;
        dav.override = r => new Promise((_, rej) => { (r.init.signal as AbortSignal).addEventListener("abort", () => rej(Object.assign(new Error("a"), { name: "AbortError" }))); });
        expect(await code(K.davList(conn()))).toBe("dav-timeout"); expect(delays).toEqual([30_000]);
        dav.override = undefined; delays.length = 0; live.clear();
        const big = new Uint8Array(3 * 1024 * 1024 + 1); big.set(F.DAV_MAGIC); // 仅测超时计算；魔数通过上传闸
        await K.davPut(conn(), NAME_A, big);
        expect(delays).toEqual([33_000]); expect(live.size).toBe(0);
        await K.davGet(conn(), NAME_A); expect(live.size).toBe(0); expect(delays.at(-1)).toBe(30_000 + 32 * 1000); // 下载按 32 MiB 上限估算
        await code(K.davGet(conn(), "ffffffffffffffffffffffffffffffff-zz.arcdav")); expect(live.size).toBe(0);
    });
    test("错误对象 / 文案不含 URL、用户名、密码、响应体、Cookie；控制台与 arc-errlog 零写入", async () => {
        const secretsInErr: string[] = [];
        const runs: Array<() => Promise<unknown>> = [
            () => { dav.override = status(401); return K.davList(conn({ user: "USER-SENTINEL", secret: "PW-SENTINEL" })); },
            () => { dav.override = () => new TypeError("boom https://dav.example.com USER-SENTINEL"); return K.davGet(conn(), NAME_A); },
            () => { dav.override = status(500); return K.davDelete(conn(), NAME_A); },
            () => { dav.override = status(302); return K.davGet(conn(), NAME_A); },
        ];
        for (const r of runs) { try { await r(); } catch (e) { secretsInErr.push(`${(e as Error).message}|${String(e)}|${JSON.stringify(e)}|${(e as Error).stack?.split("\n")[0]}`); } }
        expect(secretsInErr.length).toBe(4);
        for (const s of secretsInErr) for (const bad of ["dav.example.com", "USER-SENTINEL", "PW-SENTINEL", "SECRET-BODY", "Basic ", "/dav/arc"]) expect(s).not.toContain(bad);
        expect(consoleCalls).toEqual([]); expect(Object.keys(mem)).not.toContain("arc-errlog");
    });
    test("每个请求的 fetch 选项：credentials omit / redirect manual（不跟随，3xx → dav-redirect）/ cache no-store / 有 signal / 带 Authorization / 不带 Cookie", async () => {
        dav.put(NAME_A, new Uint8Array(1));
        await K.davList(conn()); await K.davGet(conn(), NAME_A); await K.davDelete(conn(), NAME_A);
        const s = await F.sealDav(PAYLOAD, PASS, { label: "x", ttlMs: 60_000 }); await K.davPut(conn(), s.name, s.bytes);
        dav.dirExists = false; await K.davPut(conn(), s.name, s.bytes);
        expect(methods()).toEqual(["PROPFIND", "GET", "DELETE", "PUT", "PUT", "MKCOL", "PUT"]);
        for (const r of dav.reqs) {
            expect(r.init.credentials).toBe("omit"); expect(r.init.redirect).toBe("manual"); expect(r.init.cache).toBe("no-store"); expect(r.init.signal).toBeDefined();
            expect(Object.keys(r.headers).map(k => k.toLowerCase())).toContain("authorization"); expect(Object.keys(r.headers).map(k => k.toLowerCase())).not.toContain("cookie");
        }
        expect(dav.reqs.find(r => r.method === "PUT")!.headers["Content-Type"]).toBe("application/octet-stream");
    });
    test("下载上限：Content-Length > 32 MiB 或流式累计超过 → dav-too-large；不把超大内容读进内存", async () => {
        dav.override = r => r.method === "GET" ? new Response("x", { status: 200, headers: { "content-length": String(K.MAX_GET_BYTES + 1) } }) : undefined;
        expect(await code(K.davGet(conn(), NAME_A))).toBe("dav-too-large");
        let pulled = 0;
        const stream = new ReadableStream<Uint8Array>({ pull(c) { pulled++; c.enqueue(new Uint8Array(8 * 1024 * 1024)); if (pulled > 20) c.close(); } });
        dav.override = r => r.method === "GET" ? new Response(stream, { status: 200 }) : undefined;
        expect(await code(K.davGet(conn(), NAME_A))).toBe("dav-too-large"); expect(pulled).toBeLessThan(8);
    });
});

/* ====================== T-D4 有效期与一次性 ====================== */
describe("T-D4 有效期 / 清理 / 一次性", () => {
    const hr = 3_600_000;
    const nameFor = (i: number, exp: number) => `${i.toString(16).padStart(32, "0")}-${F.expHint(exp)}.arcdav`;
    test("文件名里的过期提示：向上取整到整点，永不早于真实过期；不合规的文件名没有提示", () => {
        for (const exp of [1_700_000_000_000, 1_700_000_000_001, 1_700_003_600_000, 1]) {
            const hint = F.nameExpiry(nameFor(1, exp))!;
            expect(hint).toBeGreaterThanOrEqual(exp); expect(hint - exp).toBeLessThan(hr);
        }
        expect(F.nameExpiry("notes.txt")).toBeUndefined();
        expect(F.nameExpired(nameFor(1, 5 * hr), 5 * hr)).toBe(false); expect(F.nameExpired(nameFor(1, 5 * hr), 5 * hr + 1)).toBe(true);
    });
    test("列表：按文件名提示置灰过期项（expired=true），别人的文件不进列表", async () => {
        const now = 10 * hr;
        dav.put(nameFor(1, now - 2 * hr), new Uint8Array(1)); dav.put(nameFor(2, now + 2 * hr), new Uint8Array(1)); dav.others.set("x.txt", 1);
        const items = await O.davListItems(conn(), now);
        expect(items.map(i => [i.name, i.expired]).sort()).toEqual([[nameFor(1, now - 2 * hr), true], [nameFor(2, now + 2 * hr), false]].sort());
    });
    test("清理：只删文件名提示已过期且规则内的项，每次最多 10 个；失败静默；别人的 / 未过期的不动", async () => {
        const now = 100 * hr;
        for (let i = 0; i < 15; i++) dav.put(nameFor(i, now - 5 * hr), new Uint8Array(1), 1000 + i);
        dav.put(nameFor(100, now + hr), new Uint8Array(1)); dav.others.set("keep.txt", 1);
        const items = await O.davListItems(conn(), now);
        const gone = await O.cleanupExpired(conn(), items, now);
        expect(gone.length).toBe(10); expect(dav.count("DELETE")).toBe(10);
        expect(dav.reqs.filter(r => r.method === "DELETE").every(r => F.NAME_RE.test(decodeURIComponent(r.url.slice(D1.length))))).toBe(true);
        expect(dav.files.has(nameFor(100, now + hr))).toBe(true); expect(dav.files.size).toBe(6);
        dav.override = r => r.method === "DELETE" ? new Response("", { status: 500 }) : undefined;
        expect(await O.cleanupExpired(conn(), items, now)).toEqual([]); // 全部失败 → 静默
        dav.override = () => new TypeError("x"); expect(await O.cleanupExpired(conn(), items, now)).toEqual([]);
    });
    test("头部过期：now == expiresAt 仍可导入，now = expiresAt+1 → dav-expired；文件名提示未来也救不了（以头部为准）", async () => {
        const t0 = 1_800_000_000_000;
        const s = await F.sealDav(PAYLOAD, PASS, { label: "l", ttlMs: 1000, now: t0 });
        expect((await F.openDav(s.bytes, PASS, t0 + 1000)).parsed.origin).toBe(PAYLOAD.o);
        expect(await code(F.openDav(s.bytes, PASS, t0 + 1001))).toBe("dav-expired");
        dav.put(s.name, s.bytes); // 文件名提示 = 向上取整到整点 > 真实过期
        expect(F.nameExpired(s.name, t0 + 1001)).toBe(false);
        expect(await code(O.davDecrypt(await O.davDownload(conn(), s.name, t0 + 1001), PASS, t0 + 1001))).toBe("dav-expired");
    });
    test("文件名提示已过期 → davDownload 直接 dav-expired（0 个请求）；篡改文件名里的过期不影响头部判断", async () => {
        const name = nameFor(1, 5 * hr);
        expect(await code(O.davDownload(conn(), name, 6 * hr))).toBe("dav-expired"); expect(dav.reqs.length).toBe(0);
        const t0 = 1_800_000_000_000, s = await F.sealDav(PAYLOAD, PASS, { label: "l", ttlMs: 1000, now: t0 });
        dav.put(nameFor(2, t0 + 99 * hr), s.bytes); // 把文件名里的过期改成很久以后
        const bytes = await O.davDownload(conn(), nameFor(2, t0 + 99 * hr), t0 + 5000);
        expect(await code(O.davDecrypt(bytes, PASS, t0 + 5000))).toBe("dav-expired");
    });
    test("头部任一字节被篡改（含 createdAt / expiresAt）→ 解密失败 bad-passphrase，不会被当成有效", async () => {
        const t0 = 1_800_000_000_000, s = await F.sealDav(PAYLOAD, PASS, { label: "l", ttlMs: 1000, now: t0 });
        for (const i of [13, 28, 29, 40, 41, 48, 49, 56]) {
            const b = s.bytes.slice(); b[i]! ^= 1;
            expect(await code(F.openDav(b, PASS, t0))).toBe("bad-passphrase");
        }
        const b = s.bytes.slice(); new DataView(b.buffer).setBigUint64(49, BigInt(t0 + 10 * hr)); // 想把有效期延长
        expect(await code(F.openDav(b, PASS, t0 + 5 * hr))).toBe("bad-passphrase");
    });
    test("deleteRemote：成功 true；失败（4xx/5xx/网络）→ false 且不抛", async () => {
        dav.put(NAME_A, new Uint8Array(1));
        expect(await O.deleteRemote(conn(), NAME_A)).toBe(true); expect(dav.files.size).toBe(0);
        expect(await O.deleteRemote(conn(), NAME_A)).toBe(false); // 404
        dav.override = () => new Response("", { status: 500 }); expect(await O.deleteRemote(conn(), NAME_A)).toBe(false);
        dav.override = () => new TypeError("x"); expect(await O.deleteRemote(conn(), NAME_A)).toBe(false);
    });
});

/* ====================== T-D5 强制加密 ====================== */
describe("T-D5 强制口令加密（ARCDAV）", () => {
    const refuse = async (b: Uint8Array) => { dav.reqs.length = 0; const c = await code(K.davPut(conn(), NAME_A, b)); return [c, dav.reqs.length]; };
    test("明文 JSON / sc:v2: 令牌 / SESSIONCOPY / ARCSESSION / 空 / 缺 0x1E 的 ARCDAV / 太短的 ARCDAV → dav-plaintext-refused，fetch 次数 0", async () => {
        const mk = (s: string) => utf8(s);
        const lead = (b: number[], n = 200) => { const u = new Uint8Array(n); u.set(b); return u; };
        for (const b of [mk(JSON.stringify(PAYLOAD)), mk("sc:v2:AAAA"), mk("SESSIONCOPY\x1e" + "x".repeat(100)), mk("ARCSESSION\x1e" + "x".repeat(100)), new Uint8Array(0), mk("ARCDAV" + "x".repeat(100)), lead([...F.DAV_MAGIC].slice(0, 6)), new Uint8Array([...F.DAV_MAGIC, 1, 1]), new Uint8Array(500)])
            expect(await refuse(b)).toEqual(["dav-plaintext-refused", 0]);
    });
    test("sealDav 输出以 ARCDAV\\x1e + ver 1 + kdf 1 开头；迭代 600000；往返可解；元数据只在密文里", async () => {
        const t0 = 1_800_000_000_000;
        const s = await F.sealDav(PAYLOAD, PASS, { label: "LABEL-SENTINEL", ttlMs: 3_600_000, now: t0 });
        expect([...s.bytes.subarray(0, 9)]).toEqual([0x41, 0x52, 0x43, 0x44, 0x41, 0x56, 0x1e, 1, 1]);
        const dv = new DataView(s.bytes.buffer, s.bytes.byteOffset); expect(dv.getUint32(9)).toBe(PBKDF2_ITERATIONS); expect(dv.getBigUint64(41)).toBe(BigInt(t0)); expect(dv.getBigUint64(49)).toBe(BigInt(t0 + 3_600_000));
        expect(latin1(s.bytes)).not.toContain("LABEL-SENTINEL"); expect(latin1(s.bytes)).not.toContain("COOKIE-SENTINEL"); expect(latin1(s.bytes)).not.toContain("app.example.com");
        const o = await F.openDav(s.bytes, PASS, t0 + 1);
        expect(o.parsed.cookies[0]!.value).toBe("COOKIE-SENTINEL-1"); expect(o.meta).toEqual({ label: "LABEL-SENTINEL", created: t0, exp: t0 + 3_600_000 });
        expect(parsePayload(JSON.parse(JSON.stringify(PAYLOAD))).origin).toBe(PAYLOAD.o);
        await K.davPut(conn(), s.name, s.bytes); expect(dav.reqs[0]!.method).toBe("PUT");
    });
    test("口令错 / 密文或标签被改 / 截断 → bad-passphrase；结构错（魔数 / 版本 / KDF / 迭代次数≠600000 / 太短）→ dav-bad-format，且后者不做 PBKDF2", async () => {
        const s = await F.sealDav(PAYLOAD, PASS, { label: "l", ttlMs: 60_000 });
        expect(await code(F.openDav(s.bytes, "wrong wrong wrong"))).toBe("bad-passphrase");
        for (const mut of [(b: Uint8Array) => { b[100]! ^= 1; }, (b: Uint8Array) => { b[b.length - 1]! ^= 1; }, (b: Uint8Array) => { b[57]! ^= 0x80; }]) { const b = s.bytes.slice(); mut(b); expect(await code(F.openDav(b, PASS))).toBe("bad-passphrase"); }
        expect(await code(F.openDav(s.bytes.slice(0, s.bytes.length - 1), PASS))).toBe("bad-passphrase");
        expect(await code(F.openDav(s.bytes.slice(0, 80), PASS))).toBe("bad-passphrase");
        const derive = crypto.subtle.deriveKey; let derived = 0;
        (crypto.subtle as any).deriveKey = (...a: unknown[]) => { derived++; return (derive as any).apply(crypto.subtle, a); };
        try {
            for (const mut of [(b: Uint8Array) => { b[0] = 0; }, (b: Uint8Array) => { b[6] = 0; }, (b: Uint8Array) => { b[7] = 2; }, (b: Uint8Array) => { b[8] = 2; }, (b: Uint8Array) => { b[7] = 0; }, (b: Uint8Array) => { new DataView(b.buffer).setUint32(9, 1000); }, (b: Uint8Array) => { new DataView(b.buffer).setUint32(9, 10_000_000); }]) {
                const b = s.bytes.slice(); mut(b); expect(await code(F.openDav(b, PASS))).toBe("dav-bad-format");
            }
            expect(await code(F.openDav(s.bytes.slice(0, 40), PASS))).toBe("dav-bad-format"); expect(await code(F.openDav(new Uint8Array(0), PASS))).toBe("dav-bad-format");
            expect(derived).toBe(0);
            await F.openDav(s.bytes, PASS); expect(derived).toBe(1);
        } finally { (crypto.subtle as any).deriveKey = derive; }
    });
    test("口令规则：< 12 个字符、等于 DAV 密码、等于 DAV 用户名 → 拒绝（上传前、不做 PBKDF2、0 个请求）；12 个字符通过", async () => {
        expect(() => F.checkPassphrase("a".repeat(11))).toThrow(DavError);
        expect(() => F.checkPassphrase("a".repeat(12))).not.toThrow();
        expect(() => F.checkPassphrase("密".repeat(11))).toThrow(); expect(() => F.checkPassphrase("密".repeat(12))).not.toThrow();
        expect(await code(Promise.resolve().then(() => F.checkPassphrase("short")))).toBe("dav-pass-short");
        expect(await code(Promise.resolve().then(() => F.checkPassphrase("the-dav-password", "the-dav-password")))).toBe("dav-pass-same");
        expect(await code(Promise.resolve().then(() => F.checkPassphrase("the-dav-username", "x", "the-dav-username")))).toBe("dav-pass-same");
        const derive = crypto.subtle.deriveKey; let derived = 0;
        (crypto.subtle as any).deriveKey = (...a: unknown[]) => { derived++; return (derive as any).apply(crypto.subtle, a); };
        try {
            expect(await code(F.sealDav(PAYLOAD, "short", { label: "l", ttlMs: 1 }))).toBe("dav-pass-short");
            expect(await code(F.sealDav(PAYLOAD, "pw-test-pw-test", { label: "l", ttlMs: 1, davSecret: "pw-test-pw-test" }))).toBe("dav-pass-same");
            expect(derived).toBe(0);
        } finally { (crypto.subtle as any).deriveKey = derive; }
        const tab = T.addTab("https://app.example.com/");
        expect(await code(O.davExport(tab, conn({ secret: "pw-test-pw-test" }), "pw-test-pw-test", { label: "l", ttlMs: 60_000 }))).toBe("dav-pass-same");
        expect(dav.reqs.length).toBe(0);
    });
    test("明文长度按 4096 填充：不同大小的载荷，密文长度 − 57 − 16 都是 4096 的整数倍", async () => {
        const big = { ...PAYLOAD, l: Object.fromEntries(Array.from({ length: 400 }, (_, i) => [`k${i}`, crypto.randomUUID() + crypto.randomUUID()])) };
        const a = await F.sealDav(PAYLOAD, PASS, { label: "", ttlMs: 1 }), b = await F.sealDav(big, PASS, { label: "", ttlMs: 1 });
        for (const s of [a, b]) expect((s.bytes.length - 57 - 16) % 4096).toBe(0);
        expect(b.bytes.length).toBeGreaterThan(a.bytes.length);
    });
    test("随机文件名：32 位十六进制 + 过期提示，互不相同，不含主机 / 备注 / 创建时间；同一载荷两次密文完全不同", async () => {
        const seen = new Set<string>(); let prev: Uint8Array | undefined;
        for (let i = 0; i < 30; i++) {
            const s = await F.sealDav(PAYLOAD, PASS, { label: "app.example.com", ttlMs: 3_600_000, now: 1_800_000_000_000 });
            expect(F.NAME_RE.test(s.name)).toBe(true); expect(s.name).not.toContain("app"); expect(s.name).not.toContain("example"); expect(s.name).not.toContain("1800000000000");
            expect(s.name.slice(33)).toBe(`${F.expHint(1_800_000_000_000 + 3_600_000)}.arcdav`);
            seen.add(s.name.slice(0, 32)); if (prev) expect([...s.bytes].join() === [...prev].join()).toBe(false); prev = s.bytes;
        }
        expect(seen.size).toBe(30);
    }, 60_000);
    test("生成口令：XXXX-XXXX-XXXX-XXXX（base32），80 位随机，互不相同，能通过口令规则", () => {
        const s = new Set<string>();
        for (let i = 0; i < 200; i++) { const p = F.generatePassphrase(); expect(p).toMatch(/^[A-Z2-7]{4}(-[A-Z2-7]{4}){3}$/); expect(() => F.checkPassphrase(p)).not.toThrow(); s.add(p); }
        expect(s.size).toBe(200);
    });
    test("导出全流程：所有请求（URL / 头 / 体）与所有存储写入都不含口令、备注、站点主机、Cookie 值；PUT 体以 ARCDAV 开头", async () => {
        const tab = T.addTab("https://app.example.com/page");
        T.fc.jar.push(T.ck({ name: "sid", value: "COOKIE-SENTINEL-2", domain: "app.example.com" }));
        const pass = "PASSPHRASE-SENTINEL-xyz";
        Cfg.setConfigStore(fakeArea);
        await Cfg.saveConfig({ url: dav.dirUrl, kind: "basic", user: "cat", secret: "pw-test" }, false);
        const r = await O.davExport(tab, conn(), pass, { label: "LABEL-SENTINEL-host", ttlMs: 3_600_000 });
        expect(r.expiresAt).toBeGreaterThan(Date.now()); expect(F.NAME_RE.test(r.name)).toBe(true);
        const put = dav.reqs.find(q => q.method === "PUT")!;
        expect(latin1(put.body).startsWith("ARCDAV\x1e\x01\x01")).toBe(true);
        const hay = [...dav.reqs.map(q => `${q.url}\n${JSON.stringify(q.headers)}\n${latin1(q.body)}`), ...storageWrites, ...idb.ops, JSON.stringify([...idb.map])].join("\n");
        for (const s of ["PASSPHRASE-SENTINEL", "LABEL-SENTINEL", "app.example.com", "COOKIE-SENTINEL"]) expect(hay).not.toContain(s);
        expect((await F.openDav(dav.files.get(r.name)!.bytes, pass)).parsed.cookies.some(c => c.value === "COOKIE-SENTINEL-2")).toBe(true);
        expect(consoleCalls).toEqual([]);
    });
});

/* ====================== T-D6 HTTPS 校验 / 认证头 ====================== */
describe("T-D6 URL 校验与认证", () => {
    test("接受：https；http 仅限 localhost / 127.0.0.1 / [::1]（含端口 / 子路径）；规范化为以 / 结尾", () => {
        expect(normalizeDir("https://dav.example.com/a/b")).toBe("https://dav.example.com/a/b/");
        expect(normalizeDir("  https://dav.example.com:8443/dir/ ")).toBe("https://dav.example.com:8443/dir/");
        expect(normalizeDir("https://dav.example.com")).toBe("https://dav.example.com/");
        expect(normalizeDir("http://localhost:5000/d")).toBe("http://localhost:5000/d/");
        expect(normalizeDir("http://127.0.0.1:18080/")).toBe("http://127.0.0.1:18080/");
        expect(normalizeDir("http://[::1]:8080/x")).toBe("http://[::1]:8080/x/");
        expect(normalizeDir("https://例え.jp/日本/")).toMatch(/^https:\/\/xn--/);
    });
    test("拒绝 http 非回环 / 仿冒主机名 / 0.0.0.0 / 其它协议 → dav-https-required", () => {
        for (const u of ["http://dav.example.com/", "http://localhost.evil.com/", "http://127.0.0.1.evil.com/", "http://evil.com/localhost", "http://0.0.0.0/", "http://127.0.0.2/", "http://192.168.1.5/", "http://[::2]/", "ftp://x.example.com/", "file:///etc/passwd", "javascript:alert(1)", "data:text/plain,x", "ws://localhost/", "HTTP://EVIL.example.com/"]) {
            let c = "ok"; try { normalizeDir(u); } catch (e) { c = (e as { code: string }).code; }
            expect([u, c]).toEqual([u, "dav-https-required"]);
        }
    });
    test("客户端自己再校验目录 URL（纵深防御）：未规范化 / http 非回环 / 带 user:pw@ / 带查询串的 conn 即使被直接传进来 → 0 个请求（Authorization 不会发出去）", async () => {
        const bytes = new Uint8Array(100); bytes.set(F.DAV_MAGIC); bytes[7] = 1; bytes[8] = 1;
        const name = `${"a".repeat(32)}-zzzz.arcdav`;
        for (const dir of ["http://dav.example.com/dav/", "http://localhost.evil.com/dav/", "https://dav.example.com/dav", "https://u:p@dav.example.com/dav/", "https://dav.example.com/dav/?x=1", "ftp://dav.example.com/dav/", "https://dav.example.com/a/../dav/x"]) {
            const c = { dir, auth: { kind: "basic" as const, user: "cat", secret: "pw-test" } };
            for (const [m, run] of [["PROPFIND", () => K.davList(c)], ["GET", () => K.davGet(c, name)], ["PUT", () => K.davPut(c, name, bytes)], ["DELETE", () => K.davDelete(c, name)]] as const) {
                dav.reqs.length = 0;
                expect([dir, m, await code(run()), dav.reqs.length]).toEqual([dir, m, expect.stringMatching(/^dav-(https-required|bad-url)$/), 0]);
            }
        }
        dav.reqs.length = 0; expect(await code(K.davList({ dir: "http://127.0.0.1:18080/dav/", auth: conn().auth }))).not.toMatch(/^dav-(https-required|bad-url)$/); // 回环 http 仍放行（走到网络层，夹具里没有 → dav-network / 其它）
    });
    test("拒绝内嵌用户名密码 / 查询串 / 片段 / 无法解析 / 空 → dav-bad-url", () => {
        for (const u of ["https://user:pw@dav.example.com/", "https://user@dav.example.com/", "https://h.example.com/a?x=1", "https://h.example.com/a#f", "not a url", "", "https://", "//dav.example.com/"]) {
            let c = "ok"; try { normalizeDir(u); } catch (e) { c = (e as { code: string }).code; }
            expect([u, c]).toEqual([u, "dav-bad-url"]);
        }
    });
    test("Basic = base64(UTF-8 user:pass)（含中文 / 重音字符）；Bearer = Bearer <token>；回环 http 可用", async () => {
        dav.user = "用户名"; dav.pass = "密码üß:冒号";
        await K.davList(conn({ user: "用户名", secret: "密码üß:冒号" }));
        expect(dav.reqs[0]!.headers.Authorization).toBe("Basic " + Buffer.from("用户名:密码üß:冒号", "utf8").toString("base64"));
        dav.bearer = "tok-123"; dav.reqs.length = 0;
        await K.davList({ dir: dav.dirUrl, auth: { kind: "bearer", user: "", secret: "tok-123" } });
        expect(dav.reqs[0]!.headers.Authorization).toBe("Bearer tok-123");
        expect(await code(K.davList({ dir: dav.dirUrl, auth: { kind: "bearer", user: "", secret: "bad" } }))).toBe("dav-auth");
    });
    test("凭据里有换行 / NUL / 空密码 / Basic 用户名含冒号 → dav-bad-config，不发请求", async () => {
        for (const a of [{ kind: "bearer" as const, user: "", secret: "tok\r\nX-Evil: 1" }, { kind: "basic" as const, user: "u\n", secret: "p" }, { kind: "basic" as const, user: "u", secret: "" }, { kind: "basic" as const, user: "a:b", secret: "p" }, { kind: "basic" as const, user: "u", secret: "p\0" }])
            expect(await code(K.davList({ dir: dav.dirUrl, auth: a }))).toBe("dav-bad-config");
        expect(dav.reqs.length).toBe(0);
    });
});

/* ====================== T-D7 凭据不进备份 / 快照 / 同步 ====================== */
describe("T-D7 凭据只在 IndexedDB 秘密库，不进备份 / 快照 / storage.sync / 设置 / 日志", () => {
    const SENT = { kind: "basic" as const, url: "https://dav-SENTINEL-host.example.com/SENTINEL-dir/", user: "SENTINEL-user", secret: "SENTINEL-pass" };
    test("存储键以 secret: 开头、被备份的 isSecretKey 识别；只经 idbArea（_shared/llm）读写", () => {
        expect(Cfg.DAV_KEY).toBe("secret:sessionTransferDav"); expect(isSecretKey(Cfg.DAV_KEY)).toBe(true);
        const s = code0(src("config.ts"));
        expect(s).toMatch(/import \{ idbArea, type Area \} from "\.\.\/\.\.\/_shared\/llm"/); expect(s).toContain("let store: Area = idbArea");
        expect(s).not.toMatch(/chrome\.storage|localStorage|sessionStorage|indexedDB/);
    });
    test("saveConfig：记住 = 只写进秘密库（含密码）；不记住 = 记录里没有密码；storage.local / sync 零写入", async () => {
        await Cfg.saveConfig(SENT, false);
        expect(JSON.stringify([...idb.map])).not.toContain("SENTINEL-pass"); expect(idb.map.get(Cfg.DAV_KEY)).toEqual({ url: normalizeDir(SENT.url), kind: "basic", user: "SENTINEL-user" });
        expect(await Cfg.loadConfig()).toEqual({ url: normalizeDir(SENT.url), kind: "basic", user: "SENTINEL-user" });
        await Cfg.saveConfig(SENT, true);
        expect((idb.map.get(Cfg.DAV_KEY) as { secret: string }).secret).toBe("SENTINEL-pass");
        expect(storageWrites).toEqual([]); expect(Object.keys(mem)).toEqual([]);
        expect(idb.ops.every(o => o.endsWith(Cfg.DAV_KEY) || o === `set:${Cfg.DAV_KEY}`)).toBe(true);
    });
    test("不合格的 URL 在写入前就被拒：什么都不存", async () => {
        expect(await code(Cfg.saveConfig({ ...SENT, url: "http://dav.example.com/" }, true))).toBe("dav-https-required");
        expect(await code(Cfg.saveConfig({ ...SENT, url: "https://u:p@dav.example.com/" }, true))).toBe("dav-bad-url");
        expect(idb.map.size).toBe(0);
    });
    test("备份 dump()：即使有人把记录放进 storage.local，secret:* 也被排除；快照走同一条 dump + stripSecrets；restore() 保留现有秘密", async () => {
        mem["data:x"] = 1; mem["secret:sessionTransferDav"] = { ...SENT }; mem["secret:llmApiKey"] = "sk-1";
        const d = await dump();
        expect(JSON.stringify(d)).not.toContain("SENTINEL"); expect(d).toEqual({ "data:x": 1 });
        expect(stripSecrets({ "secret:sessionTransferDav": SENT, a: 1 })).toEqual({ a: 1 });
        await restore({ "data:y": 2, "secret:sessionTransferDav": { url: "ATTACKER" } });
        expect(mem["secret:sessionTransferDav"]).toEqual({ ...SENT }); expect(mem["data:y"]).toBe(2); expect(JSON.stringify(mem)).not.toContain("ATTACKER");
        expect(code0(readFileSync("src/plugins/data/backup/index.ts", "utf8"))).toMatch(/stripSecrets\(s\.data\)/);
    });
    test("同步 pickSyncable() 只取 spaces / pinned / favorites；storage.sync 不会带上凭据", () => {
        const p = pickSyncable({ "secret:sessionTransferDav": SENT, "data:spaces": { spaces: [1], routes: [] }, "data:pinned": [], ArcSidebarSettings: { plugins: { SessionTransfer: { webdavEnabled: true } } } });
        expect(JSON.stringify(p)).not.toMatch(/SENTINEL|webdav/i); expect(Object.keys(p).sort()).toEqual(["favorites", "pinned", "spaces"]);
    });
    test("设置里只有布尔值：webdavEnabled（默认关）/ deleteAfterImport / cleanupExpired；没有 URL / 用户名 / 密码类设置项", async () => {
        const { settings } = await import("../src/plugins/sessionTransfer/settings");
        const defs = settings.def as Record<string, { type: unknown; default: unknown; sensitive?: boolean }>;
        const dav = ["webdavEnabled", "deleteAfterImport", "cleanupExpired"];
        for (const k of dav) expect(typeof defs[k]!.default).toBe("boolean");
        expect(defs.webdavEnabled!.default).toBe(false); expect(defs.deleteAfterImport!.default).toBe(true); expect(defs.cleanupExpired!.default).toBe(true);
        for (const [k, d] of Object.entries(defs)) { expect(typeof d.default).toBe("boolean"); expect(k).not.toMatch(/url|username|password|secret|token|dir/i); }
    });
    test("清除配置：secret:sessionTransferDav 被删除（含记住的密码）；clearConfig 只动这一条", async () => {
        await Cfg.saveConfig(SENT, true); idb.map.set("secret:llmApiKey", "sk"); idb.ops.length = 0;
        await Cfg.clearConfig();
        expect(idb.map.has(Cfg.DAV_KEY)).toBe(false); expect(idb.map.get("secret:llmApiKey")).toBe("sk"); expect(idb.ops).toEqual([`remove:${Cfg.DAV_KEY}`]);
        expect(await Cfg.loadConfig()).toBeUndefined();
    });
    test("toConn：没有配置 / 没有密码 → dav-not-configured；本次输入的密码优先于记住的", () => {
        expect(() => Cfg.toConn(undefined, "x")).toThrow(DavError); expect(() => Cfg.toConn({ url: D1, kind: "basic", user: "u" })).toThrow(DavError);
        expect(Cfg.toConn({ url: D1, kind: "basic", user: "u", secret: "kept" }, "typed").auth.secret).toBe("typed");
        expect(Cfg.toConn({ url: D1, kind: "basic", user: "u", secret: "kept" }).auth.secret).toBe("kept");
        expect(() => Cfg.toConn({ url: "http://evil.example.com/", kind: "basic", user: "u", secret: "k" })).toThrow(DavError);
    });
    test("全流程（保存 → 导出 → 列表 → 下载 → 解密 → 删除）里 console / arc-errlog 零调用，storage.local 只有测试自己放的键", async () => {
        const tab = T.addTab("https://app.example.com/");
        await Cfg.saveConfig({ ...SENT, url: dav.dirUrl, user: "cat", secret: "pw-test" }, true);
        const cfg = (await Cfg.loadConfig())!;
        const c = Cfg.toConn(cfg);
        const r = await O.davExport(tab, c, "a-long-passphrase-1", { label: "x", ttlMs: 3_600_000 });
        const items = await O.davListItems(c); expect(items.map(i => i.name)).toEqual([r.name]);
        const parsed = await O.davDecrypt(await O.davDownload(c, r.name), "a-long-passphrase-1");
        expect(parsed.parsed.origin).toBe("https://app.example.com");
        expect(await O.deleteRemote(c, r.name)).toBe(true);
        expect(consoleCalls).toEqual([]); expect(Object.keys(mem)).toEqual([]); expect(storageWrites).toEqual([]);
    });
});

/* ====================== T-D8 静态约束 ====================== */
describe("T-D8 零常驻 / 零权限 / 无日志（webdav/ 目录静态扫描）", () => {
    const files = readdirSync(dir).filter(f => f.endsWith(".ts"));
    const all = files.map(f => [f, code0(src(f))] as const);
    test("目录里的模块", () => { expect(files.sort()).toEqual(["client.ts", "config.ts", "errors.ts", "format.ts", "i18n.ts", "ops.ts", "register.ts", "style.ts", "ui.ts", "url.ts", "xml.ts"]); });
    for (const bad of [/console\./, /\bsafe\(/, /\bsetInterval\b/, /chrome\.alarms/, /\.addListener\(/, /onMessage/, /sendMessage/, /chrome\.storage/, /\blocalStorage\b/, /\bsessionStorage\b/, /\bindexedDB\b/, /\.permissions\./, /declarativeNetRequest/, /XMLHttpRequest/, /WebSocket/, /EventSource/, /sendBeacon/, /importScripts/, /\beval\(/, /new Function/, /DOMParser/, /\bpermissions:/, /chrome\.cookies/, /chrome\.runtime/, /chrome\.downloads/])
        test(`没有 ${bad.source}`, () => { expect(all.filter(([, s]) => bad.test(s)).map(([f]) => f)).toEqual([]); });
    test("fetch( 只在 client.ts 且只有一处", () => {
        expect(all.filter(([, s]) => /\bfetch\(/.test(s)).map(([f]) => f)).toEqual(["client.ts"]);
        expect((all.find(([f]) => f === "client.ts")![1].match(/\bfetch\(/g) ?? []).length).toBe(1);
        const top = readdirSync("src/plugins/sessionTransfer").filter(f => f.endsWith(".ts")).map(f => code0(readFileSync(`src/plugins/sessionTransfer/${f}`, "utf8")));
        expect(top.filter(s => /\bfetch\(/.test(s))).toEqual([]);
    });
    test("setTimeout 只在 client.ts（逐请求超时），并有 clearTimeout；其它文件没有定时器", () => {
        expect(all.filter(([, s]) => /setTimeout/.test(s)).map(([f]) => f)).toEqual(["client.ts"]);
        expect(all.find(([f]) => f === "client.ts")![1]).toContain("clearTimeout(timer)");
        expect(all.find(([f]) => f === "client.ts")![1]).toMatch(/finally \{ clearTimeout/);
    });
    test("请求选项写死：credentials omit / redirect manual / cache no-store；错误只抛 DavError", () => {
        const s = all.find(([f]) => f === "client.ts")![1];
        expect(s).toContain('credentials: "omit"'); expect(s).toContain('redirect: "manual"'); expect(s).not.toContain('redirect: "follow"'); expect(s).toContain('cache: "no-store"');
        expect(s).not.toMatch(/\.message|\.stack|JSON\.stringify/);
    });
    test("manifest 不变：没有 webdav 相关权限；host_permissions 仍是 <all_urls>；optional_permissions 仍只有 cookies", () => {
        const m = JSON.parse(readFileSync("static/manifest.json", "utf8"));
        expect(m.host_permissions).toEqual(["<all_urls>"]); expect(m.optional_permissions).toEqual(expect.arrayContaining(["cookies"]));
        expect(JSON.stringify(m)).not.toMatch(/webdav|optional_host_permissions/i);
        const idx = code0(readFileSync("src/plugins/sessionTransfer/index.ts", "utf8"));
        expect(idx).toContain('optionalPermissions: { "*": ["cookies"] }'); expect([...idx.matchAll(/^import .*?from "([^"]+)"/gm)].map(m => m[1]).filter(i => i!.includes("webdav"))).toEqual(["./webdav/register"]);
    });
    test("settings.ts 只用动态 import 引入 webdav/config（轻量入口不拉 WebDAV 代码）", () => {
        const s = code0(readFileSync("src/plugins/sessionTransfer/settings.ts", "utf8"));
        expect([...s.matchAll(/^import .*?from "([^"]+)"/gm)].map(m => m[1])).toEqual(["@api/Settings", "@utils/types"]);
        expect(s).toContain('import("./webdav/config")');
    });
    test("register.ts 只静态引入 channels / settings / i18n / style；重代码只在点击后 import('./ui')", () => {
        const s = all.find(([f]) => f === "register.ts")![1];
        expect([...s.matchAll(/^import .*?from "([^"]+)"|^import "([^"]+)"/gm)].map(m => m[1] ?? m[2])).toEqual(["../channels", "../settings", "./i18n"]);
        expect(s).toContain('import("./ui")');
    });
    test("WebDAV 文案：en / zh 键集合一致、非空；每个错误码都有 st.dav.err.*；风险提示有中英文", async () => {
        const { DAV_STRINGS: D0 } = await import("../src/plugins/sessionTransfer/webdav/i18n");
        expect(D0.en["st.dav.err.dav-dir-absent"]).toMatch(/does not exist/i); expect(D0.en["st.dav.err.dav-dir-absent"]).toMatch(/created|create/i); expect(D0.en["st.dav.err.dav-dir-absent"]).not.toMatch(/not found/i);
        expect(D0.zh["st.dav.err.dav-dir-absent"]).toContain("目录不存在"); expect(D0.zh["st.dav.err.dav-dir-absent"]).toContain("自动创建");
        const { DAV_STRINGS, DAV_RISK_EN, DAV_RISK_ZH } = await import("../src/plugins/sessionTransfer/webdav/i18n");
        expect(Object.keys(DAV_STRINGS.en).sort()).toEqual(Object.keys(DAV_STRINGS.zh).sort());
        for (const l of ["en", "zh"] as const) for (const v of Object.values(DAV_STRINGS[l])) expect(v.length).toBeGreaterThan(0);
        const codes = [...code0(src("errors.ts")).match(/export type DavCode =([\s\S]*?);/)![1]!.matchAll(/"(dav-[a-z-]+)"/g)].map(m => m[1]!);
        expect(codes.length).toBeGreaterThanOrEqual(20);
        for (const c of codes) expect(Object.keys(DAV_STRINGS.en)).toContain(`st.dav.err.${c}`);
        expect(DAV_RISK_EN).toMatch(/server/i); expect(DAV_RISK_ZH).toMatch(/服务器/);
        const { STRINGS } = await import("../src/plugins/sessionTransfer/i18n");
        for (const k of Object.keys(DAV_STRINGS.en)) expect(Object.keys(STRINGS.en)).not.toContain(k);
        const used = new Set<string>();
        for (const f of ["ui.ts", "register.ts"]) for (const m of src(f).matchAll(/(?:tr\(|label: )["'`](st\.dav\.[A-Za-z.-]+)["'`]/g)) used.add(m[1]!);
        for (const k of used) expect(Object.keys(DAV_STRINGS.en)).toContain(k);
    });
});

/* ====================== T-D9 真实 wsgidav 夹具（可选） ====================== */
const FX = process.env.DAV_FIXTURE;
describe.skipIf(!FX)("T-D9 盒内 wsgidav 夹具端到端（DAV_FIXTURE；⚠ 不是 Chrome、不是真实云服务）", () => {
    const url = `${FX}/arcdav-t9/`;
    const fc = (user = "cat", secret = "pw-test") => ({ dir: normalizeDir(url), auth: { kind: "basic" as const, user, secret } });
    test("MKCOL → PUT → PROPFIND → GET → 解密 → DELETE；错误密码 401；覆盖；别人的中文 / 空格 / + 文件名不进列表；20 MB 与 >32 MiB 边界", async () => {
        const real = globalThis.fetch; restoreFetch(); // 用 bun 自带的真实 fetch
        try {
            const tab = T.addTab("https://app.example.com/");
            T.fc.jar.push(T.ck({ name: "sid", value: "FIXTURE-COOKIE", domain: "app.example.com" }));
            expect(await code(K.davList(fc("cat", "wrong")))).toBe("dav-auth");
            const r = await O.davExport(tab, fc(), "fixture-passphrase-1", { label: "e2e", ttlMs: 3_600_000 }); // 目录不存在 → PUT 409 → MKCOL → PUT
            const items = await O.davListItems(fc()); expect(items.map(i => i.name)).toContain(r.name);
            const bytes = await O.davDownload(fc(), r.name);
            expect((await O.davDecrypt(bytes, "fixture-passphrase-1")).parsed.cookies.some(c => c.value === "FIXTURE-COOKIE")).toBe(true);
            const s2 = { ...(await F.sealDav(PAYLOAD, PASS, { label: "o", ttlMs: 3_600_000 })), name: r.name };
            await K.davPut(fc(), r.name, s2.bytes); // 覆盖同名
            expect((await F.openDav(await K.davGet(fc(), r.name), PASS)).meta.label).toBe("o");
            const big = new Uint8Array(20_000_000); big.set(F.DAV_MAGIC); big[7] = 1; big[8] = 1;
            const bigName = `${"b".repeat(32)}-zzzz.arcdav`; await K.davPut(fc(), bigName, big);
            expect((await K.davGet(fc(), bigName)).length).toBe(20_000_000);
            const huge = new Uint8Array(K.MAX_GET_BYTES + 1); huge.set(F.DAV_MAGIC);
            const hugeName = `${"c".repeat(32)}-zzzz.arcdav`; await K.davPut(fc(), hugeName, huge);
            expect(await code(K.davGet(fc(), hugeName))).toBe("dav-too-large");
            for (const n of [r.name, bigName, hugeName]) await K.davDelete(fc(), n);
            expect(await code(K.davGet(fc(), r.name))).toBe("dav-not-found");
            expect((await K.davList(fc())).filter(e => !e.isDir)).toEqual([]);
            const auth = { Authorization: "Basic " + Buffer.from("cat:pw-test").toString("base64") };
            await fetch(`${normalizeDir(url)}${encodeURIComponent("会话 a+b.txt")}`, { method: "PUT", headers: auth, body: "hi" }); // 别人的文件
            expect((await K.davList(fc())).map(e => e.name)).toContain("会话 a+b.txt");
            expect(await O.davListItems(fc())).toEqual([]);
            await fetch(`${normalizeDir(url)}${encodeURIComponent("会话 a+b.txt")}`, { method: "DELETE", headers: auth });
            await fetch(normalizeDir(url), { method: "DELETE", headers: { Authorization: "Basic " + Buffer.from("cat:pw-test").toString("base64") } }); // 清理夹具目录
        } finally { globalThis.fetch = real; }
    }, 120_000);
});

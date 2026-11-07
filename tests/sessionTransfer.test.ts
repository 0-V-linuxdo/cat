/* 会话传递（SessionTransfer）核心逻辑单测：容器（SC 兼容字节布局 / 阈值 / 口令格式 / 严格解析 / 解压上限）、采集（SC 三条查询）、
 * 写回（cookie 字段还原规则 / 覆盖语义 / 快照回滚撤销 / 读回校验）、静态约束（零常驻、不写日志、不明文落盘）、i18n 对齐。
 * 用 tests/sessionTransferHarness.ts 的内存假 chrome；Chrome 里才能验证的行为见 HEADED-TODO.md（H 系列，⚠ 未验证）。 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";

import { b64uEncode, decode, errCode, fileName, MAX_COOKIES, needsPassphrase, pack, parsePayload, PASS_MAGIC, PBKDF2_ITERATIONS, SC_MAGIC, sealPass, sealSC, SessionError, TOKEN_MAX_CHARS, tokenFits, toFile, toToken, type CookieRec, type Payload } from "../src/plugins/sessionTransfer/container";
import { installChrome } from "./sessionTransferHarness";

const dir = "src/plugins/sessionTransfer";
const src = (f: string) => readFileSync(`${dir}/${f}`, "utf8");
const payload = (over: Partial<Payload> = {}): Payload => ({
    v: 2, o: "https://app.example.com", t: 1_700_000_000_000, l: { theme: "dark" }, s: { tab: "1" },
    c: [{ name: "sid", value: "abc", domain: "app.example.com", path: "/", secure: true, httpOnly: true, sameSite: "lax", hostOnly: true, session: false, expirationDate: 1_893_456_000 }], ...over,
});
const code = async (p: Promise<unknown>) => { try { await p; return "ok"; } catch (e) { return errCode(e); } };

describe("容器：SC 兼容字节布局", () => {
    test("魔数 = 'SESSIONCOPY' + 0x1E，共 12 字节", () => {
        expect([...SC_MAGIC]).toEqual([83, 69, 83, 83, 73, 79, 78, 67, 79, 80, 89, 0x1e]);
        expect(SC_MAGIC.length).toBe(12);
        expect(new TextDecoder().decode(PASS_MAGIC)).toBe("ARCSESSION\x1e");
    });
    test("字节 = [0x02][key32][iv12][密文]；令牌前缀 sc:v2:；文件 = 魔数 + 同样字节", async () => {
        const b = await sealSC(payload());
        expect(b[0]).toBe(2);
        expect(b.length).toBeGreaterThanOrEqual(61);
        expect(toToken(b).startsWith("sc:v2:")).toBe(true);
        const f = toFile(b);
        expect([...f.subarray(0, 12)]).toEqual([...SC_MAGIC]);
        expect([...f.subarray(12)]).toEqual([...b]);
    });
    test("令牌 / 文件往返", async () => {
        const p = payload();
        const b = await sealSC(p);
        for (const input of [toToken(b), toFile(b), "  " + toToken(b) + "\n"]) {
            const r = await decode(input);
            expect(r.origin).toBe(p.o); expect(r.local).toEqual([["theme", "dark"]]); expect(r.session).toEqual([["tab", "1"]]);
            expect(r.cookies[0]!.name).toBe("sid"); expect(r.cookies[0]!.hostOnly).toBe(true);
        }
    });
    test("每次加密的密钥 / iv 都是新的（同一载荷两次结果不同）", async () => {
        const a = await sealSC(payload()), b = await sealSC(payload());
        expect(b64uEncode(a)).not.toBe(b64uEncode(b));
    });
});

describe("容器：错误码（只有枚举码，没有 cookie / 站点内容）", () => {
    test("no-token / bad-magic / truncated / truncated-file / bad-version / bad-token / bad-payload", async () => {
        const b = await sealSC(payload());
        expect(await code(decode("hello"))).toBe("no-token");
        expect(await code(decode(new Uint8Array(200)))).toBe("bad-magic");
        expect(await code(decode(toToken(b.subarray(0, 60))))).toBe("truncated");
        expect(await code(decode(toFile(b.subarray(0, 40))))).toBe("truncated-file");
        const v3 = b.slice(); v3[0] = 3;
        expect(await code(decode(toToken(v3)))).toBe("bad-version");
        expect(await code(decode("sc:v2:***not base64***"))).toBe("bad-token");
        const bad = b.slice(); bad[bad.length - 1]! ^= 1;
        expect(await code(decode(toToken(bad)))).toBe("bad-payload");
    });
    test("错误消息就是枚举码本身", async () => {
        try { await decode("sc:v2:" + b64uEncode(new Uint8Array(100))); } catch (e) {
            expect(e).toBeInstanceOf(SessionError); expect((e as Error).message).toBe((e as SessionError).code);
        }
    });
});

describe("容器：阈值（令牌 ≤ 450000 字符，超过改文件）", () => {
    test("TOKEN_MAX_CHARS = 450000；恰好 450000 字符仍是令牌，450001 起是文件", () => {
        expect(TOKEN_MAX_CHARS).toBe(450_000);
        expect(tokenFits("x".repeat(450_000))).toBe(true);
        expect(tokenFits("x".repeat(450_001))).toBe(false);
    });
    test("恰在边界两侧：450000 以内是令牌，多 1 个字符以上是文件", async () => {
        // 确定性不可压缩载荷：令牌长度只取决于载荷长度（密钥 / iv 定长）
        let x = 123456789; const rnd = () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return (x >>> 0).toString(16).padStart(8, "0"); };
        const big = (n: number) => { let s = ""; while (s.length < n) s += rnd(); return s.slice(0, n); };
        const mk = (n: number) => payload({ l: { k: big(n) } });
        const chars = async (n: number) => { const a = await pack(mk(n)); return a.kind === "token" ? a.chars : Infinity; };
        let lo = 300_000, hi = 1_000_000;
        while (hi - lo > 8) { const mid = (lo + hi) >> 1; if (await chars(mid) <= TOKEN_MAX_CHARS) lo = mid; else hi = mid; }
        let n = lo; while (await chars(n + 1) <= TOKEN_MAX_CHARS) n++;
        const a = await pack(mk(n)), b = await pack(mk(n + 1));
        expect(a.kind).toBe("token"); expect((a as { chars: number }).chars).toBeLessThanOrEqual(TOKEN_MAX_CHARS); expect((a as { chars: number }).chars).toBeGreaterThan(TOKEN_MAX_CHARS - 200);
        expect(b.kind).toBe("file");
        const r = await decode((b as { bytes: Uint8Array }).bytes);
        expect(r.local[0]![1].length).toBe(n + 1);
    }, 60_000);
    test("导出文件总是文件", async () => { expect((await pack(payload(), undefined, true)).kind).toBe("file"); });
});

describe("容器：严格解析", () => {
    test("v≠2 → bad-payload；origin 缺失 / 非 http(s) → bad-origin", () => {
        expect(() => parsePayload({ v: 1, o: "https://a.com" })).toThrow("bad-payload");
        expect(() => parsePayload(null)).toThrow("bad-payload");
        expect(() => parsePayload({ v: 2 })).toThrow("bad-origin");
        expect(() => parsePayload({ v: 2, o: "ftp://a.com" })).toThrow("bad-origin");
        expect(() => parsePayload({ v: 2, o: "chrome://settings" })).toThrow("bad-origin");
        expect(() => parsePayload({ v: 2, o: "javascript:alert(1)" })).toThrow("bad-origin");
    });
    test("坏 cookie / 非字符串存储值被丢弃并计数；多余字段不保留", () => {
        const r = parsePayload({ v: 2, o: "https://a.com/x?y", l: { a: "1", b: 2 }, s: null, c: [{ name: "n", value: "v", path: "/", secure: true, httpOnly: false, sameSite: "lax", evil: { z: 1 } }, { name: 5 }, "x", null] });
        expect(r.origin).toBe("https://a.com");
        expect(r.local).toEqual([["a", "1"]]);
        expect(r.cookies.length).toBe(1);
        expect("evil" in r.cookies[0]!).toBe(false);
        expect(r.dropped).toBeGreaterThanOrEqual(3);
    });
    test("__proto__ 键只是普通条目，不污染原型", () => {
        const o = JSON.parse('{"v":2,"o":"https://a.com","l":{"__proto__":"x","constructor":"y"},"s":{},"c":[]}');
        const r = parsePayload(o);
        expect(r.local.map(e => e[0]).sort()).toEqual(["__proto__", "constructor"]);
        expect(({} as Record<string, unknown>).polluted).toBeUndefined();
        expect(Object.getPrototypeOf({})).toBe(Object.prototype);
    });
    test("cookie 数量超上限 → too-large", () => {
        expect(MAX_COOKIES).toBe(5000);
        const c = { name: "n", value: "v", path: "/", secure: true, httpOnly: false, sameSite: "lax" };
        expect(() => parsePayload({ v: 2, o: "https://a.com", c: Array.from({ length: MAX_COOKIES + 1 }, () => c) })).toThrow("too-large");
    });
    test("解压上限：压缩炸弹（> 64 MiB 明文）→ too-large，不会撑爆内存", async () => {
        const zeros = new Uint8Array(70 * 1024 * 1024);
        const gz = new Uint8Array(await new Response(new Blob([zeros]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer());
        const key = crypto.getRandomValues(new Uint8Array(32)), iv = crypto.getRandomValues(new Uint8Array(12));
        const k = await crypto.subtle.importKey("raw", key, "AES-GCM", false, ["encrypt"]);
        const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, k, gz));
        const out = new Uint8Array(45 + ct.length); out[0] = 2; out.set(key, 1); out.set(iv, 33); out.set(ct, 45);
        expect(await code(decode(toToken(out)))).toBe("too-large");
    }, 60_000);
});

describe("口令格式（SC 读不了；PBKDF2-SHA256 600000 + AES-GCM，头部作 AAD）", () => {
    test("往返：令牌 + 文件；needsPassphrase；缺口令 → need-passphrase；错口令 → bad-passphrase", async () => {
        expect(PBKDF2_ITERATIONS).toBe(600_000);
        const p = payload();
        const b = await sealPass(p, "correct horse");
        const tok = toToken(b, "pass");
        expect(tok.startsWith("arc:v1:")).toBe(true);
        expect(needsPassphrase(tok)).toBe(true);
        expect(needsPassphrase(toToken(await sealSC(p)))).toBe(false);
        expect((await decode(tok, "correct horse")).origin).toBe(p.o);
        expect((await decode(toFile(b, "pass"), "correct horse")).cookies.length).toBe(1);
        expect(await code(decode(tok))).toBe("need-passphrase");
        expect(await code(decode(tok, "wrong"))).toBe("bad-passphrase");
        expect(await code(sealPass(p, ""))).toBe("need-passphrase");
    }, 30_000);
    test("头部被改（盐 / 版本）→ 解不开；迭代数 ≠ 600000 → 直接拒绝且不跑 PBKDF2", async () => {
        const b = await sealPass(payload(), "pw");
        const salt = b.slice(); salt[3]! ^= 1;
        expect(await code(decode(toToken(salt, "pass"), "pw"))).toBe("bad-passphrase");
        const ver = b.slice(); ver[0] = 9;
        expect(await code(decode(toToken(ver, "pass"), "pw"))).toBe("bad-version");
        const it = b.slice(); new DataView(it.buffer).setUint32(17, 0xffffffff);
        const t0 = performance.now();
        expect(await code(decode(toToken(it, "pass"), "pw"))).toBe("bad-version");
        expect(performance.now() - t0).toBeLessThan(150); // 若真去算 4e9 次迭代会卡死
    }, 30_000);
    test("pack(payload, 口令) 产出 arc:v1 令牌 / .arcsession 文件名", async () => {
        const a = await pack(payload(), "pw");
        expect(a.kind === "token" && a.text.startsWith("arc:v1:") && a.passphrase).toBe(true);
        expect(fileName("https://app.example.com", true, new Date(0))).toBe("session-app.example.com-1970-01-01T00-00-00-000Z.arcsession");
    }, 30_000);
});

describe("文件名", () => {
    test("session-<host>-<ISO>.session；主机名里的怪字符被替换；限长", () => {
        expect(fileName("https://app.example.com:8443/x", false, new Date(Date.UTC(2026, 9, 28, 1, 2, 3, 4)))).toBe("session-app.example.com-2026-10-28T01-02-03-004Z.session");
        expect(fileName("https://xn--e1afmkfd.xn--p1ai", false, new Date(0))).toMatch(/^session-xn--e1afmkfd\.xn--p1ai-/);
        expect(fileName("https://" + "a".repeat(200) + ".com", false, new Date(0)).length).toBeLessThan(140);
        expect(fileName("garbage", false, new Date(0))).toMatch(/^session-site-/);
    });
});

/* ------------------------------------------------------------------ 采集 / 写回 / 流程（假 chrome） */
describe("采集（SC 的三条查询 + 去重 + 分区）", () => {
    let T: ReturnType<typeof installChrome>;
    beforeEach(() => { T = installChrome({ perm: { granted: true, contains: 0, request: 0, remove: 0, requestResult: true, removeArgs: [], requestArgs: [] } } as never); });
    afterEach(() => T.uninstall());

    test("发 url / domain=host / domain=.host 三条查询，按 name+domain+path 去重，包含 HttpOnly 与父域 cookie", async () => {
        const { listCookies } = await import("../src/plugins/sessionTransfer/collect");
        T.fc.jar.push(
            T.ck({ name: "host", value: "1", domain: "app.example.com", httpOnly: true }),
            T.ck({ name: "dom", value: "2", domain: ".example.com" }),
            T.ck({ name: "sub", value: "3", domain: ".app.example.com" }),
            T.ck({ name: "other", value: "4", domain: "other.com" }),
        );
        const tab = T.addTab("https://app.example.com/page");
        const got = await listCookies("https://app.example.com/page", tab.id);
        expect(T.fc.getAllCalls.filter(q => !q.partitionKey).map(q => q.url ? "url" : q.domain)).toEqual(["url", "app.example.com", ".app.example.com"]);
        expect(got.map(c => c.name).sort()).toEqual(["dom", "host", "sub"]);
        expect(new Set(got.map(c => `${c.name}${c.domain}${c.path}`)).size).toBe(got.length);
    });
    test("有 getPartitionKey（Chrome ≥132）时多发一条分区查询；没有则不发", async () => {
        const { listCookies } = await import("../src/plugins/sessionTransfer/collect");
        T.uninstall(); T = installChrome({ hasPartitionKey: true, partitionKey: { topLevelSite: "https://app.example.com" }, perm: { granted: true, contains: 0, request: 0, remove: 0, requestResult: true, removeArgs: [], requestArgs: [] } } as never);
        T.fc.jar.push(T.ck({ name: "chips", value: "p", domain: "app.example.com", partitionKey: { topLevelSite: "https://app.example.com" } }), T.ck({ name: "plain", value: "q", domain: "app.example.com" }));
        const tab = T.addTab("https://app.example.com/");
        const got = await listCookies("https://app.example.com/", tab.id);
        expect(T.fc.getAllCalls.some(q => q.partitionKey?.topLevelSite === "https://app.example.com")).toBe(true);
        expect(got.map(c => c.name).sort()).toEqual(["chips", "plain"]);
    });
    test("collect：载荷形状（v2 / origin / localStorage / sessionStorage / cookies，保留 hostOnly 与 session 标志）", async () => {
        const { collect } = await import("../src/plugins/sessionTransfer/collect");
        T.fc.jar.push(T.ck({ name: "sid", value: "x", domain: "app.example.com", httpOnly: true, expirationDate: 1_893_456_000 }), T.ck({ name: "ses", value: "y", domain: ".example.com", sameSite: "strict" }));
        const tab = T.addTab("https://app.example.com/a?b#c", { s1: "v1" });
        T.local("https://app.example.com").set("l1", "v2");
        const p = await collect(tab);
        expect(p.v).toBe(2); expect(p.o).toBe("https://app.example.com");
        expect(p.l).toEqual({ l1: "v2" }); expect(p.s).toEqual({ s1: "v1" });
        const sid = p.c.find(c => c.name === "sid")!, ses = p.c.find(c => c.name === "ses")!;
        expect(sid).toMatchObject({ hostOnly: true, session: false, httpOnly: true, expirationDate: 1_893_456_000 });
        expect(ses).toMatchObject({ hostOnly: false, session: true, sameSite: "strict" }); expect("expirationDate" in ses).toBe(false);
    });
    test("非 http(s) 页面 → bad-scheme；无标签 id → no-tab；采集期间 origin 变了 → collect-failed；cookie 过多 → too-large", async () => {
        const { collect } = await import("../src/plugins/sessionTransfer/collect");
        expect(await code(collect({ id: 1, url: "chrome://settings" } as chrome.tabs.Tab))).toBe("bad-scheme");
        expect(await code(collect({ url: "https://a.com" } as chrome.tabs.Tab))).toBe("no-tab");
        const tab = T.addTab("https://app.example.com/");
        T.fc.tabs.get(tab.id!)!.url = "https://evil.example.org/"; // 页面在采集前已跳到别的 origin（脚本读到的 origin ≠ tab.url 的 origin）
        expect(await code(collect(tab))).toBe("collect-failed");
        for (let i = 0; i < MAX_COOKIES + 1; i++) T.fc.jar.push(T.ck({ name: "c" + i, value: "v", domain: "big.example.net" }));
        expect(await code(collect(T.addTab("https://big.example.net/")))).toBe("too-large");
    });
});

describe("写回：cookie 字段还原规则", () => {
    const rec = (o: Partial<CookieRec> & { name: string }): CookieRec => ({ value: "v", path: "/", secure: true, httpOnly: false, sameSite: "lax", ...o });
    const O = "https://app.example.com";
    test("hostOnly → 不传 domain；域 cookie → 传 domain；url 由 origin 构造而不是 cookie 域", async () => {
        const { setDetails } = await import("../src/plugins/sessionTransfer/apply");
        const h = setDetails(rec({ name: "a", domain: "app.example.com", hostOnly: true }), O)!;
        expect("domain" in h).toBe(false); expect(h.url).toBe("https://app.example.com/");
        const d = setDetails(rec({ name: "b", domain: ".example.com", hostOnly: false, path: "/p" }), O)!;
        expect(d.domain).toBe(".example.com"); expect(d.url).toBe("https://app.example.com/p");
    });
    test("SC 令牌里的 cookie 没有 hostOnly 字段：domain 无前导点 → host-only，有前导点 → 域 cookie", async () => {
        const { setDetails } = await import("../src/plugins/sessionTransfer/apply");
        expect("domain" in setDetails(rec({ name: "a", domain: "app.example.com" }), O)!).toBe(false);
        expect(setDetails(rec({ name: "b", domain: ".example.com" }), O)!.domain).toBe(".example.com");
    });
    test("域名与目标 origin 不匹配 → null（跳过，不往别的站点写）", async () => {
        const { setDetails } = await import("../src/plugins/sessionTransfer/apply");
        expect(setDetails(rec({ name: "a", domain: ".evil.com", hostOnly: false }), O)).toBeNull();
        expect(setDetails(rec({ name: "a", domain: "other.example.com", hostOnly: true }), O)).toBeNull();
        expect(setDetails(rec({ name: "a", domain: ".ample.com", hostOnly: false }), O)).toBeNull(); // 后缀但不是子域
    });
    test("__Host-：强制 path=/、无 domain、secure；__Secure-：强制 secure", async () => {
        const { setDetails } = await import("../src/plugins/sessionTransfer/apply");
        const h = setDetails(rec({ name: "__Host-x", domain: ".example.com", hostOnly: false, path: "/deep", secure: false }), O)!;
        expect(h).toMatchObject({ path: "/", secure: true, url: "https://app.example.com/" }); expect("domain" in h).toBe(false);
        expect(setDetails(rec({ name: "__Secure-y", domain: "app.example.com", secure: false }), O)!.secure).toBe(true);
        expect(setDetails(rec({ name: "plain", domain: "app.example.com", secure: false }), O)!.secure).toBe(false);
    });
    test("sameSite：unspecified 不传；其它原样。expiration：session 不传，持久传。partitionKey 原样传", async () => {
        const { setDetails } = await import("../src/plugins/sessionTransfer/apply");
        expect("sameSite" in setDetails(rec({ name: "a", sameSite: "unspecified" }), O)!).toBe(false);
        expect(setDetails(rec({ name: "a", sameSite: "no_restriction" }), O)!.sameSite).toBe("no_restriction");
        expect("expirationDate" in setDetails(rec({ name: "a", session: true, expirationDate: 9 }), O)!).toBe(false);
        expect(setDetails(rec({ name: "a", session: false, expirationDate: 1_893_456_000 }), O)!.expirationDate).toBe(1_893_456_000);
        expect(setDetails(rec({ name: "a", partitionKey: { topLevelSite: "https://t.com" } }), O)).toMatchObject({ partitionKey: { topLevelSite: "https://t.com" } });
    });
    test("origin 非法 → null", async () => {
        const { setDetails } = await import("../src/plugins/sessionTransfer/apply");
        expect(setDetails(rec({ name: "a" }), "not a url")).toBeNull();
    });
});

describe("导入流程（快照 / 回滚 / 撤销 / 读回校验）", () => {
    let T: ReturnType<typeof installChrome>;
    const P = { origin: "https://app.example.com", createdAt: 0, local: [["theme", "dark"]] as Array<[string, string]>, session: [["tab", "1"]] as Array<[string, string]>, dropped: 0,
        cookies: [{ name: "sid", value: "NEW", domain: "app.example.com", path: "/", secure: true, httpOnly: true, sameSite: "lax", hostOnly: true, session: false, expirationDate: 1_893_456_000 }, { name: "pref", value: "p", domain: ".example.com", path: "/", secure: false, httpOnly: false, sameSite: "unspecified", hostOnly: false, session: true }] as CookieRec[] };
    beforeEach(() => { T = installChrome(); T.fc.perm.granted = true; });
    afterEach(() => T.uninstall());

    test("先写 cookie → 再开标签（首个请求就带登录态）→ 补写 cookie + 存储 → reload → 校验；监听都移除", async () => {
        const { importSession } = await import("../src/plugins/sessionTransfer/transfer");
        const order: string[] = [];
        const create = chrome.tabs.create; chrome.tabs.create = (async (o: any) => { order.push(`create@set=${T.fc.setCalls.length}`); return create(o); }) as never;
        const r = await importSession(P, { reload: true });
        expect(order).toEqual(["create@set=2"]);
        expect(T.fc.created[0]).toMatchObject({ url: "https://app.example.com", active: true });
        expect(r).toMatchObject({ applied: 2, skipped: 0, reloaded: true, drift: 0, storageFailed: 0 });
        expect(T.fc.jar.find(c => c.name === "sid")!.value).toBe("NEW");
        expect(T.local("https://app.example.com").get("theme")).toBe("dark");
        expect(T.fc.tabs.get(r.tabId)!.session.get("tab")).toBe("1");
        expect(T.fc.reloads).toEqual([r.tabId]);
        expect(T.fc.onUpdated.size).toBe(0);
    });
    test("reload:false → 不刷新、不校验", async () => {
        const { importSession } = await import("../src/plugins/sessionTransfer/transfer");
        const r = await importSession(P, { reload: false });
        expect(r.reloaded).toBe(false); expect(T.fc.reloads).toEqual([]);
    });
    test("覆盖语义：同键 cookie 被替换，别的 cookie / 存储键不动、不删除", async () => {
        const { importSession } = await import("../src/plugins/sessionTransfer/transfer");
        T.fc.jar.push(T.ck({ name: "sid", value: "OLD", domain: "app.example.com" }), T.ck({ name: "keep", value: "k", domain: "app.example.com" }));
        T.local("https://app.example.com").set("untouched", "u");
        await importSession(P, { reload: false });
        expect(T.fc.jar.filter(c => c.name === "sid").length).toBe(1);
        expect(T.fc.jar.find(c => c.name === "keep")!.value).toBe("k");
        expect(T.local("https://app.example.com").get("untouched")).toBe("u");
    });
    test("域不匹配的 cookie 计入 skipped；全部被跳过 → all-skipped，且不开标签、不留任何写入", async () => {
        const { importSession } = await import("../src/plugins/sessionTransfer/transfer");
        const mixed = { ...P, cookies: [...P.cookies, { ...P.cookies[0]!, name: "foreign", domain: ".evil.com", hostOnly: false }] };
        expect((await importSession(mixed, { reload: false })).skipped).toBe(1);
        T.uninstall(); T = installChrome(); T.fc.perm.granted = true;
        const none = { ...P, cookies: [{ ...P.cookies[0]!, domain: ".evil.com", hostOnly: false }] };
        expect(await code(importSession(none, { reload: false }))).toBe("all-skipped");
        expect(T.fc.created.length).toBe(0); expect(T.fc.jar.length).toBe(0);
    });
    test("存储写入失败 → 回滚：旧 cookie 复原、新建 cookie 删除、新标签关闭，错误码 storage-failed", async () => {
        const { importSession } = await import("../src/plugins/sessionTransfer/transfer");
        T.fc.jar.push(T.ck({ name: "sid", value: "OLD", domain: "app.example.com", httpOnly: true, sameSite: "strict", expirationDate: 1_900_000_000 }));
        const exec = chrome.scripting.executeScript; chrome.scripting.executeScript = (async (o: any) => { if (o.func.name === "writeStorageInPage") throw new Error("denied"); return exec(o); }) as never;
        expect(await code(importSession(P, { reload: true }))).toBe("storage-failed");
        const sid = T.fc.jar.find(c => c.name === "sid")!;
        expect(sid).toMatchObject({ value: "OLD", httpOnly: true, sameSite: "strict", expirationDate: 1_900_000_000, hostOnly: true });
        expect(T.fc.jar.some(c => c.name === "pref")).toBe(false);
        expect(T.fc.removedTabs.length).toBe(1);
        expect(T.fc.onUpdated.size).toBe(0);
    });
    test("标签一直不 complete → 30 s 超时的同一代码路径：tab-timeout，监听与定时器都清掉", async () => {
        const { armLoadWait } = await import("../src/plugins/sessionTransfer/transfer");
        const w = armLoadWait(999, 20);
        expect(T.fc.onUpdated.size).toBe(1);
        expect(await code(w.done)).toBe("tab-timeout");
        expect(T.fc.onUpdated.size).toBe(0);
    });
    test("撤销：写回旧 cookie 与存储旧值；新建的删除；之后标签刷新", async () => {
        const { importSession, undoImport } = await import("../src/plugins/sessionTransfer/transfer");
        T.fc.jar.push(T.ck({ name: "sid", value: "OLD", domain: "app.example.com" }));
        T.local("https://app.example.com").set("theme", "light");
        const r = await importSession(P, { reload: true });
        expect(T.fc.jar.find(c => c.name === "sid")!.value).toBe("NEW");
        const fail = await undoImport(r.snapshot);
        expect(fail).toBe(0);
        expect(T.fc.jar.find(c => c.name === "sid")!.value).toBe("OLD");
        expect(T.fc.jar.some(c => c.name === "pref")).toBe(false);
        expect(T.local("https://app.example.com").get("theme")).toBe("light");
        expect(T.fc.tabs.get(r.tabId)!.session.has("tab")).toBe(false);
        expect(T.fc.reloads.length).toBe(2);
    });
    test("读回校验：SPA 把旧值写回一次 → 补写并再 reload 一次，最终 drift=0；一直写回 → drift>0 如实上报而不是假装成功", async () => {
        const { importSession } = await import("../src/plugins/sessionTransfer/transfer");
        T.fc.spa = { remaining: 1, values: { theme: "STALE" } };
        const r = await importSession(P, { reload: true });
        expect(r.drift).toBe(0); expect(T.fc.reloads.length).toBe(2);
        expect(T.local("https://app.example.com").get("theme")).toBe("dark");
        T.uninstall(); T = installChrome(); T.fc.perm.granted = true;
        T.fc.spa = { remaining: 99, values: { theme: "STALE" } };
        const r2 = await importSession(P, { reload: true });
        expect(r2.drift).toBeGreaterThan(0);
    });
    test("清除站点数据：只清当前 origin 的 cookie（含父域 cookie）与所选存储，别的站点不动", async () => {
        const { clearSite } = await import("../src/plugins/sessionTransfer/transfer");
        T.fc.jar.push(T.ck({ name: "a", value: "1", domain: "app.example.com" }), T.ck({ name: "b", value: "2", domain: ".example.com" }), T.ck({ name: "z", value: "3", domain: "other.com" }));
        const tab = T.addTab("https://app.example.com/", { s: "1" }); T.local("https://app.example.com").set("l", "1");
        await clearSite(tab, { cookies: true, local: true, session: false });
        expect(T.fc.jar.map(c => c.name)).toEqual(["z"]);
        expect(T.local("https://app.example.com").size).toBe(0);
        expect(T.fc.tabs.get(tab.id!)!.session.get("s")).toBe("1");
        expect(await code(clearSite(tab, { cookies: false, local: false, session: false }))).toBe("aborted");
        expect(await code(clearSite({ id: 1, url: "about:blank" } as chrome.tabs.Tab, { cookies: true, local: false, session: false }))).toBe("bad-scheme");
    });
    test("复制 / 导出：令牌或文件里是加密载荷，且令牌 / 明文 cookie 值不会出现在任何 chrome 调用参数里（只有 downloads 收到密文字节）", async () => {
        const { copySession, exportFileSession } = await import("../src/plugins/sessionTransfer/transfer");
        T.fc.jar.push(T.ck({ name: "sid", value: "SECRET-VALUE-123", domain: "app.example.com" }));
        const tab = T.addTab("https://app.example.com/");
        const a = await copySession(tab);
        expect(a.kind).toBe("token");
        expect((a as { text: string }).text).not.toContain("SECRET");
        expect((await decode((a as { text: string }).text)).cookies[0]!.value).toBe("SECRET-VALUE-123");
        const f = await exportFileSession(tab);
        expect(f.name).toMatch(/^session-app\.example\.com-.*\.session$/);
        expect(new TextDecoder("latin1").decode(f.bytes)).not.toContain("SECRET");
        expect([...f.bytes.subarray(0, 12)]).toEqual([...SC_MAGIC]);
    });
});

describe("静态约束（零常驻 / 不写日志 / 不明文落盘 / 不碰剪贴板读取）", () => {
    const files = readdirSync(dir).filter(f => f.endsWith(".ts"));
    const all = files.map(f => [f, src(f)] as const);
    const code0 = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\s\/\/ .*$/gm, "");
    for (const bad of [/console\./, /\bsafe\(/, /\bsetInterval\b/, /chrome\.alarms/, /runtime\.onMessage/, /runtime\.sendMessage/, /chrome\.storage/, /indexedDB/, /createPluginStore/, /\bflog\(/, /clipboardRead/, /clipboardWrite/, /readText\(/, /\.permissions\.request\(/ , /declarativeNetRequest/, /\bfetch\(/, /XMLHttpRequest/, /sendBeacon/, /\beval\(/, /new Function/]) {
        test(`没有 ${bad.source}`, () => {
            const hit = all.filter(([f, s]) => bad.test(code0(s)) && !(bad.source.includes("permissions") && f === "perm.ts")).map(([f]) => f);
            expect(hit).toEqual([]);
        });
    }
    test("permissions.request 只出现在 perm.ts（且只有一处）", () => {
        expect(all.filter(([, s]) => /permissions\.request/.test(code0(s))).map(([f]) => f)).toEqual(["perm.ts"]);
        expect((code0(src("perm.ts")).match(/permissions\.request/g) ?? []).length).toBe(1);
    });
    test("只有 tabs.onUpdated 与 downloads.onChanged / onCreated 三种临时监听，且都有对应的 removeListener", () => {
        const adds = all.flatMap(([f, s]) => [...code0(s).matchAll(/(chrome\.[a-zA-Z.]+)\.addListener/g)].map(m => `${f}:${m[1]}`)).sort();
        expect(adds).toEqual(["transfer.ts:chrome.tabs.onUpdated", "ui.ts:chrome.downloads.onChanged", "ui.ts:chrome.downloads.onCreated"]);
        expect(code0(src("transfer.ts"))).toContain("chrome.tabs.onUpdated.removeListener");
        expect(code0(src("ui.ts"))).toContain("chrome.downloads.onChanged.removeListener");
        expect(code0(src("ui.ts"))).toContain("chrome.downloads.onCreated.removeListener");
    });
    test("没有定时器之外的常驻：setTimeout 只出现在 transfer.ts 的 armLoadWait 与 ui.ts 的 watchDownload（点击被拦截时的清理），并各有 clearTimeout", () => {
        expect(all.filter(([, s]) => /setTimeout/.test(code0(s))).map(([f]) => f).sort()).toEqual(["transfer.ts", "ui.ts"]);
        expect(code0(src("transfer.ts"))).toContain("clearTimeout");
        expect(code0(src("ui.ts"))).toContain("clearTimeout");
    });
    test("入口 index.ts：无 background / content / page 钩子；只静态引入核心 API 与 ./i18n ./section ./settings ./state ./webdav/register；重模块只用 import()", () => {
        const s = code0(src("index.ts"));
        expect(s).not.toMatch(/\b(background|content|page|options)\s*:\s*\{/);
        const imports = [...s.matchAll(/^import .*?from "([^"]+)"|^import "([^"]+)"/gm)].map(m => m[1] ?? m[2]!);
        expect(imports.filter(i => i.startsWith("."))).toEqual(["./i18n", "./section", "./settings", "./state", "./webdav/register"]);
        expect(imports.filter(i => !i.startsWith("."))).toEqual(["@api/Slots", "@utils/constants", "@utils/types"]);
        expect(s).toContain('import("./ui")');
        expect(s).not.toMatch(/defaultKey|shortcut/);
    });
    test("section.ts 只静态引入 @api/dom / @api/i18n / @utils/zLayers / ./channels（轻量），ui 只在点击后 import()", () => {
        const s = code0(src("section.ts"));
        expect([...s.matchAll(/^import .*?from "([^"]+)"/gm)].map(m => m[1])).toEqual(["@api/dom", "@api/i18n", "@utils/zLayers", "./channels"]);
        expect(s).toContain('import("./ui")');
    });
    test("下载只接收容器打包后的字节：ui.ts 里 downloadOwn（rel61：代替 downloads.download，见 @utils/ownDownload）的 url 来自 saveBytes 的 Blob，没有别的调用点", () => {
        const s = code0(src("ui.ts"));
        expect((s.match(/downloads\.download\(/g) ?? []).length).toBe(0);
        expect((s.match(/downloadOwn\(/g) ?? []).length).toBe(1);
        expect((s.match(/registerOwnIntent\(/g) ?? []).length).toBe(1); // <a download> 路径只登记意图（同一个 url / name）
        expect(s).toMatch(/new Blob\(\[bytes/);
        expect((s.match(/createObjectURL\(/g) ?? []).length).toBe(1); // 两条路径（<a download> / saveAs 的 downloads.download）共用同一个 Blob URL
        expect(s).not.toMatch(/data:|JSON\.stringify|\.cookies\b[^;]*download/);
    });
    test("声明：manifest 只在 optional_permissions 加 cookies；入口 optionalPermissions = {'*':['cookies']}", () => {
        const m = JSON.parse(readFileSync("static/manifest.json", "utf8"));
        expect(m.permissions ?? []).not.toContain("cookies");
        expect(m.optional_permissions).toContain("cookies");
        expect(code0(src("index.ts"))).toContain('optionalPermissions: { "*": ["cookies"] }');
    });
});

describe("i18n：中英文齐全，错误码与风险提示都有文案", () => {
    test("en / zh 键集合完全一致，值非空；每个错误码都有 st.err.*", async () => {
        const { STRINGS, RISK_EN, RISK_ZH } = await import("../src/plugins/sessionTransfer/i18n");
        const en = Object.keys(STRINGS.en).sort(), zh = Object.keys(STRINGS.zh).sort();
        expect(en).toEqual(zh);
        for (const l of ["en", "zh"] as const) for (const k of en) expect((STRINGS[l] as Record<string, string>)[k]!.length).toBeGreaterThan(0);
        const codes = [...src("container.ts").match(/export type ErrorCode =([\s\S]*?);/)![1]!.matchAll(/"([a-z-]+)"/g)].map(m => m[1]!);
        for (const c of [...codes, "failed", "aborted"]) expect(en).toContain(`st.err.${c}`);
        expect(RISK_EN).toMatch(/login|sign in/i); expect(RISK_ZH).toMatch(/登录|会话|cookie/i);
        expect(STRINGS.en["st.risk"]).toBe(RISK_EN); expect(STRINGS.zh["st.risk"]).toBe(RISK_ZH);
    });
    test("代码里用到的 st.* / sessionTransfer.* 键都已登记", async () => {
        const { STRINGS } = await import("../src/plugins/sessionTransfer/i18n");
        const { DAV_STRINGS } = await import("../src/plugins/sessionTransfer/webdav/i18n");
        const all = { ...STRINGS.en, ...DAV_STRINGS.en };
        const used = new Set<string>();
        for (const f of ["ui.ts", "section.ts", "index.ts", "settings.ts"]) for (const m of src(f).matchAll(/(?:tr\(|label: |description: |\btag: )["'`]((?:st|sessionTransfer|plugin\.sessionTransfer)\.[A-Za-z.${}()-]+)["'`]/g)) used.add(m[1]!);
        const missing = [...used].filter(k => !k.includes("${") && !(k in all));
        expect(missing).toEqual([]);
    });
});

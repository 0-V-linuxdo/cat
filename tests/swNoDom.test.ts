/* 51999 验收 HIGH：后台 SW 里 “Settings listener error: ReferenceError: document is not defined”。
 * 在没有 document / window 的 vm 里执行真实构建产物 dist/background.js（chrome.* 全部用 Proxy 假实现），
 * 等 bootstrap 完成后把每个插件的每个设置项都改一遍，断言没有任何 console.error / 未捕获错误。没有 dist 时跳过。 */
import { test, expect } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";

const BG = resolve(import.meta.dir, "../dist/background.js");

function chromeMock() {
    const listeners: Record<string, Function[]> = {};
    const event = (name: string) => ({ addListener: (f: Function) => (listeners[name] ??= []).push(f), removeListener() { }, hasListener: () => false });
    const store: Record<string, unknown> = {};
    const area = (n: string) => ({
        get: async (k?: unknown) => (typeof k === "string" ? { [k]: store[`${n}:${k}`] } : {}),
        set: async (o: Record<string, unknown>) => { for (const [k, v] of Object.entries(o)) store[`${n}:${k}`] = v; },
        remove: async () => { }, clear: async () => { }, onChanged: event(`${n}.onChanged`), setAccessLevel: async () => { },
    });
    const any = (path: string): any => new Proxy(function () { }, {
        get: (_t, k: string) => {
            if (k === "then") return undefined;
            if (k.startsWith("on")) return event(`${path}.${k}`);
            if (k === "id") return "testext";
            if (k === "lastError") return undefined;
            if (k === "WINDOW_ID_NONE") return -1;
            return any(`${path}.${k}`);
        },
        apply: (_t, _this, args) => {
            if (path.endsWith("getURL")) return `chrome-extension://testext/${args[0] ?? ""}`;
            if (path.endsWith("getManifest")) return { version: "0.0.0", permissions: [], optional_permissions: [] };
            if (path.endsWith("getMessage")) return "";
            if (path.endsWith("getUILanguage")) return "zh-CN";
            if (path.endsWith("create") && path.includes("contextMenus")) { const cb = args.find((a: unknown) => typeof a === "function"); cb?.(); return 1; }
            if (path.endsWith("connect")) return { postMessage() { }, onMessage: event("p"), onDisconnect: event("p"), disconnect() { } };
            if (/\.(query|getAll|getTree|search|getContexts)$/.test(path)) return Promise.resolve([]);
            return Promise.resolve({});
        },
    });
    const c: any = any("chrome");
    const storage = { local: area("local"), session: area("session"), sync: area("sync"), onChanged: event("storage.onChanged") };
    return new Proxy(c, { get: (t, k: string) => (k === "storage" ? storage : t[k]) });
}

test.skipIf(!existsSync(BG))("SW（无 document/window）：执行后台包并切换全部设置，无错误", async () => {
    const errors: string[] = [];
    const push = (...a: unknown[]) => errors.push(a.map(x => (x && typeof x === "object" && "message" in (x as object) ? `${(x as Error).name}: ${(x as Error).message} @ ${String((x as Error).stack).split("\n").slice(1, 4).join(" < ")}` : String(x))).join(" "));
    const ctx: any = {
        chrome: chromeMock(), console: { log() { }, info() { }, debug() { }, warn() { }, error: push },
        setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask, structuredClone, URL, URLSearchParams, TextEncoder, TextDecoder,
        crypto: globalThis.crypto, fetch: async () => new Response("{}"), performance, Intl, navigator: { userAgent: "Mac", platform: "MacIntel", language: "zh-CN" },
        Blob, Response, Request, Headers, AbortController, atob, btoa,
        addEventListener() { }, removeEventListener() { },
    };
    ctx.self = ctx; ctx.globalThis = ctx;
    vm.createContext(ctx);
    process.on("unhandledRejection", e => push("unhandled", e));
    vm.runInContext(readFileSync(BG, "utf8"), ctx, { filename: "background.js" });
    for (let i = 0; i < 50 && !ctx.ArcSidebar?.plugins; i++) await new Promise(r => setTimeout(r, 20));
    await new Promise(r => setTimeout(r, 300));
    expect(ctx.ArcSidebar).toBeTruthy();
    expect(vm.runInContext("typeof document + typeof window", ctx)).toBe("undefinedundefined");
    const plugins = ctx.ArcSidebar.plugins as Record<string, { settings?: { def: Record<string, unknown>; store: Record<string, unknown> } }>;
    const all = ctx.ArcSidebar.Settings.plugins as Record<string, Record<string, unknown>>;
    let toggled = 0;
    const flip = (v: unknown) => typeof v === "boolean" ? !v : typeof v === "number" ? v + 1 : typeof v === "string" ? v + "x" : v && typeof v === "object" ? JSON.parse(JSON.stringify(v)) : true;
    for (const [name, p] of Object.entries(plugins)) {
        const ps = all[name] ?? (all[name] = {});
        for (const k of ["enabled", ...Object.keys(p.settings?.def ?? {})]) {
            const target = k === "enabled" || !p.settings ? ps : p.settings.store;
            const v = target[k];
            try { target[k] = flip(v); target[k] = v; toggled++; } catch (e) { push(`set ${name}.${k}`, e); }
        }
    }
    await new Promise(r => setTimeout(r, 300));
    expect(toggled).toBeGreaterThan(20);
    if (process.env.SW_DUMP) console.log(JSON.stringify(errors, null, 1));
    // DataCloneError：测试环境把宿主 structuredClone 注入 vm，跨 realm 克隆失败，属测试假象
    expect(errors.filter(e => !/DataCloneError/.test(e))).toEqual([]);
}, 20000);

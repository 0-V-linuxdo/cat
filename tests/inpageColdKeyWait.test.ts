/* 第 8 层 cold-key-wait：冷启动那次 ⌃S（SW 休眠后按键）——命令在 start() 之前到达，路由没装，SPG 冷分支同步开了原生（保住手势）并记 cold；
 * start() 后在 COLD_KEY_WAIT_MS 有界窗口内等宿主 hello / 原生端口，来了且页内可显示 → 收起原生、恢复页内；窗口过了 = 保留原生。
 * 这里用假 SPG（模块级 installed 标志已被别的测试文件占用）+ chrome mock，直接给 start() 一个 cold 记录来模拟「命令已经在 start 之前到达」。无 Chrome。 */
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { COLD_KEY_WAIT, COLD_KEY_WAIT_MS, COLD_START_CORRECTION, PREWARM } from "../src/plugins/inpageSidebar/constants";

const DIR = resolve(import.meta.dir, "../src/plugins/inpageSidebar");
const SPG_PATH = resolve(DIR, "../../api/SidePanelGesture.ts");

describe("cold-key-wait（chrome mock）", () => {
    const g = globalThis as Record<string, unknown>;
    const keep = { chrome: g.chrome, document: g.document, now: Date.now };
    let realSettings: Record<string, unknown>; let realSPG: Record<string, unknown>;
    const prefs: Record<string, unknown> = { defaultMode: "inpage", showHandle: false, hoverReveal: false, prewarm: "off" };
    const L: Record<string, Function[]> = {}; const ev = (k: string) => ({ addListener: (f: Function) => { (L[k] ??= []).push(f); }, removeListener: (f: Function) => { L[k] = (L[k] ?? []).filter(x => x !== f); } });
    const calls: string[] = []; const urlOf: Record<number, { windowId: number; url: string }> = {};
    const openSet = new Set<number>(); let coldVal: unknown; let skew = 0; let n = 0; let cleanup: unknown; // startBackground() 返回清理函数**数组**（不是函数）：原先 cleanup?.() 对数组抛 TypeError 被 catch 吞掉 → 每个 boot 起的后台实例的心跳 setInterval(25s) 泄漏
    const runCleanup = () => { for (const c of ([] as unknown[]).concat(cleanup ?? [])) { try { (c as () => void)(); } catch { /* 清理失败不影响其它用例 */ } } cleanup = undefined; };
    const chromeMock = {
        runtime: { onMessage: ev("msg"), onConnect: ev("conn"), lastError: undefined, id: "x", getManifest: () => ({ version: "0.0.0" }) }, commands: { onCommand: ev("cmd") },
        contextMenus: { onClicked: ev("menu"), create: (_p: unknown, cb?: () => void) => { cb?.(); }, remove: (_id: string, cb?: () => void) => cb?.(), update: (_i: string, _p: unknown, cb?: () => void) => cb?.() },
        sidePanel: { open: async (o: { windowId: number }) => { calls.push("open:" + o.windowId); }, close: async (o: { windowId: number }) => { calls.push("close:" + o.windowId); }, setOptions: async () => { calls.push("setOptions"); }, setPanelBehavior: async () => undefined, getOptions: async () => ({}) },
        webNavigation: { onBeforeNavigate: ev("nav") },
        tabs: { update: async () => undefined, onActivated: ev("act"), onUpdated: ev("upd"), onRemoved: ev("rem"), query: async () => [], get: async (id: number) => ({ id, ...(urlOf[id] ?? { windowId: 8, url: "https://x.test/" }) }), sendMessage: async () => ({ ok: true, proto: 1 }) },
        windows: { onRemoved: ev("wrem"), onFocusChanged: ev("foc"), getAll: async () => [{ id: 8 }, { id: 9 }], getLastFocused: async () => ({ id: 8 }), WINDOW_ID_NONE: -1 },
        action: { setBadgeText: async () => undefined },
        storage: { local: { get: async () => ({}), set: async () => undefined }, onChanged: ev("sc") },
    };
    // 心跳 setInterval 的泄漏探测：只记 delay === PREWARM.heartbeatMs 的（后台实例的 25s 心跳）；清理后应该一个不剩
    const liveHb = new Set<unknown>(); const realSetInterval = globalThis.setInterval; const realClearInterval = globalThis.clearInterval;
    beforeAll(async () => {
        (globalThis as any).setInterval = ((fn: any, ms?: number, ...a: unknown[]) => { const id = (realSetInterval as any)(fn, ms, ...a); if (ms === PREWARM.heartbeatMs) liveHb.add(id); return id; }) as typeof setInterval;
        (globalThis as any).clearInterval = ((id: any) => { liveHb.delete(id); return (realClearInterval as any)(id); }) as typeof clearInterval;
        realSettings = { ...(await import("../src/plugins/inpageSidebar/settings")) }; realSPG = { ...(await import("../src/api/SidePanelGesture")) };
        mock.module(SPG_PATH, () => ({
            ...realSPG, setGestureRouter: () => undefined, isPanelOpen: (w: number) => openSet.has(w), takeColdGesture: () => { const c = coldVal; coldVal = undefined; return c; },
            closePanel: (w: number) => { openSet.delete(w); return chromeMock.sidePanel.close({ windowId: w }); },
            openPanelInGesture: (w: number, cb?: (ok: boolean) => void) => { void chromeMock.sidePanel.open({ windowId: w }).then(() => cb?.(true)); },
        }));
        delete g.document; g.chrome = chromeMock;
        mock.module(resolve(DIR, "settings.ts"), () => ({ settings: { store: prefs, def: {} } }));
    });
    afterAll(() => { runCleanup(); Date.now = keep.now; globalThis.setInterval = realSetInterval; globalThis.clearInterval = realClearInterval; for (const id of liveHb) realClearInterval(id as any); liveHb.clear(); mock.module(resolve(DIR, "settings.ts"), () => realSettings); mock.module(SPG_PATH, () => realSPG); mock.restore(); g.chrome = keep.chrome; if (keep.document !== undefined) g.document = keep.document; });
    const wait = (ms = 8) => new Promise(r => setTimeout(r, ms));
    const mkPort = (name: string, sender: unknown) => {
        const m: Function[] = []; const d: Function[] = []; const sent: any[] = [];
        return { name, sender, sent, postMessage: (x: unknown) => { sent.push(x); }, disconnect() { for (const f of d) f(); },
            onMessage: { addListener: (f: Function) => m.push(f), removeListener: (f: Function) => { const i = m.indexOf(f); if (i >= 0) m.splice(i, 1); } },
            onDisconnect: { addListener: (f: Function) => d.push(f) }, say: (x: unknown) => { for (const f of m) f(x); } };
    };
    const host = (tabId: number, windowId: number, url: string) => { urlOf[tabId] = { windowId, url }; return mkPort("inpage:host", { tab: { id: tabId, windowId, url }, frameId: 0 }); };
    const conn = (p: { name: string; onDisconnect: { addListener: (f: Function) => void } }) => { const m = /^panel:(\d+)$/.exec(p.name); if (m) { openSet.add(Number(m[1])); p.onDisconnect.addListener(() => openSet.delete(Number(m[1]))); } for (const f of L.conn!) f(p); };
    const last = (p: { sent: any[] }) => p.sent.filter(s => s.type === "inpage:state").at(-1);
    const NATIVE = "chrome-extension://x/sidepanel.html";
    /** 新起一个「冷」SW 实例：cold = SPG 冷分支在命令到达时记下的那次手势（命令在 start 之前到达） */
    const boot = async (cold: unknown, mode = "inpage") => {
        runCleanup();
        for (const k of Object.keys(L)) L[k] = []; calls.length = 0; openSet.clear(); skew = 0; prefs.defaultMode = mode;
        Date.now = () => keep.now() + skew; coldVal = cold;
        const BG: any = await import(resolve(DIR, "background.ts") + "?ckw" + (n++)); cleanup = BG.startBackground(); await wait();
    };
    const coldAt = (tabId: number, w = 8, opened = true) => ({ t: keep.now(), windowId: w, tabId, url: "https://a.test/", opened });
    const keyOpenedNative = async (w = 8) => { openSet.add(w); const p = mkPort(`panel:${w}`, { url: NATIVE }); conn(p); await wait(); return p; }; // 冷分支同步 open 之后，原生面板端口连上来

    test("常量：默认开、窗口 400 ms（有界，不是 3 s 手势预算）；COLD_START_CORRECTION 仍默认关", () => {
        expect(COLD_KEY_WAIT).toBe(true); expect(COLD_KEY_WAIT_MS).toBe(400); expect(COLD_START_CORRECTION).toBe(false);
    });
    test("SW 休眠后按键：原生先开（手势保住）→ 窗口内 hello 到达 → 收起原生、恢复页内（只 close，不再 open / setOptions）", async () => {
        await boot(coldAt(31)); const h = host(31, 8, "https://a.test/"); (L.act![0]!)({ tabId: 31, windowId: 8 });
        const panel = await keyOpenedNative(); expect(calls).toEqual([]); // 原生端口先到、hello 还没来：先不动
        conn(h); h.say({ type: "hello", proto: 1, frame: "none" }); await wait();
        expect(calls).toEqual(["close:8"]); panel.disconnect(); await wait();
        expect(last(h)).toMatchObject({ show: true, nativeOpen: false }); expect(calls.filter(c => c.startsWith("open") || c.startsWith("setOptions"))).toEqual([]);
    });
    test("hello 先到、原生端口后到（nativeChanged 路径）→ 同样纠偏", async () => {
        await boot(coldAt(32)); const h = host(32, 8, "https://a.test/"); (L.act![0]!)({ tabId: 32, windowId: 8 });
        conn(h); h.say({ type: "hello", proto: 1, frame: "none" }); await wait(); expect(calls).toEqual([]); // 原生还没出现
        const panel = await keyOpenedNative(); expect(calls).toEqual(["close:8"]); panel.disconnect(); await wait(); expect(last(h)).toMatchObject({ show: true, nativeOpen: false });
    });
    test("超时：窗口（start 起 400 ms）过了才来的 hello → 保留原生（旧行为），不 close", async () => {
        await boot(coldAt(33)); const h = host(33, 8, "https://a.test/"); (L.act![0]!)({ tabId: 33, windowId: 8 }); await keyOpenedNative();
        skew = COLD_KEY_WAIT_MS + 50; conn(h); h.say({ type: "hello", proto: 1, frame: "none" }); await wait();
        expect(calls).toEqual([]); expect(last(h)).toMatchObject({ nativeOpen: true, show: false });
    });
    test("不纠偏的情形：默认方式 = 原生 / 目的标签不是触发的那个 / 受限页 / 那次手势其实是关面板（opened=false）", async () => {
        await boot(coldAt(34), "native"); let h = host(34, 8, "https://a.test/"); L.act![0]!({ tabId: 34, windowId: 8 }); await keyOpenedNative(); conn(h); h.say({ type: "hello", proto: 1, frame: "none" }); await wait(); expect(calls).toEqual([]);
        await boot(coldAt(35)); h = host(36, 8, "https://b.test/"); L.act![0]!({ tabId: 36, windowId: 8 }); await keyOpenedNative(); conn(h); h.say({ type: "hello", proto: 1, frame: "none" }); await wait(); expect(calls).toEqual([]);
        await boot(coldAt(37)); h = host(37, 8, "https://chromewebstore.google.com/detail/x"); L.act![0]!({ tabId: 37, windowId: 8 }); await keyOpenedNative(); conn(h); h.say({ type: "hello", proto: 1, frame: "none" }); await wait(); expect(calls).toEqual([]);
        await boot(coldAt(38, 8, false)); h = host(38, 8, "https://a.test/"); L.act![0]!({ tabId: 38, windowId: 8 }); await keyOpenedNative(); conn(h); h.say({ type: "hello", proto: 1, frame: "none" }); await wait(); expect(calls).toEqual([]);
    });
    test("一次性：纠偏后用户再自己开原生，之后的 hello 不会再被收起", async () => {
        await boot(coldAt(39)); const h = host(39, 8, "https://a.test/"); L.act![0]!({ tabId: 39, windowId: 8 }); const p1 = await keyOpenedNative(); conn(h); h.say({ type: "hello", proto: 1, frame: "none" }); await wait(); expect(calls).toEqual(["close:8"]); p1.disconnect(); await wait();
        calls.length = 0; await keyOpenedNative(); h.say({ type: "hello", proto: 1, frame: "none" }); await wait(); expect(calls).toEqual([]);
    });
    test("没有 cold 记录（正常热 SW）：什么都不做", async () => {
        await boot(undefined); const h = host(40, 8, "https://a.test/"); L.act![0]!({ tabId: 40, windowId: 8 }); await keyOpenedNative(); conn(h); h.say({ type: "hello", proto: 1, frame: "none" }); await wait(); expect(calls).toEqual([]);
    });
    test("源码约束：手势栈内不新增 await / setTimeout；SPG 冷分支未改；没有新增顶层 onMessage / onCommand 监听；窗口常量有界", () => {
        const spg = readFileSync(SPG_PATH, "utf8"); const cold = spg.slice(spg.indexOf("const onToggleGesture"), spg.indexOf("chrome.runtime.onConnect.addListener"));
        expect(cold).toMatch(/cold = \{ t: Date\.now\(\)/); expect(cold).toMatch(/togglePanelInGesture\(tab\?\.windowId\)/); expect(cold).not.toMatch(/await |setTimeout|Promise|\.then\(/);
        const bg = readFileSync(resolve(DIR, "background.ts"), "utf8"); const f = bg.slice(bg.indexOf("const tryColdKey"), bg.indexOf("const nativeChanged"));
        expect(f).toMatch(/closePanel\(w\)/); expect(f).not.toMatch(/openPanelInGesture|sidePanel\.open|await |setTimeout/);
        expect((bg.match(/runtime\?\.onMessage\?\.addListener/g) ?? []).length).toBe(1); expect((bg.match(/onCommand\.addListener/g) ?? []).length).toBe(0);
    });
    test("泄漏探测：每次 boot 清掉上一个实例的心跳（只剩当前实例的 1 个）；清理当前实例后一个不剩（startBackground 返回的是清理函数数组，不能当函数调用）", () => {
        expect(liveHb.size).toBe(1); runCleanup(); expect(liveHb.size).toBe(0);
    });
});

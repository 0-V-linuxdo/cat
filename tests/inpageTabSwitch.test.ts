/* 补丁 inpage-tab-switch：切标签时「展开」不重播。
 * 静态能验证的：后台 show 与 active 无关；内容脚本的 pinned / 动画 / iframe 规则（源码约束）；滚动位置的纯逻辑。真实观感（帧序列、页面是否被重新推开）要 headed：见 shots/measure-tabswitch.ts，这里不声称。 */
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { parseScroll, restoreStep, SCROLL, scrollKey } from "../src/plugins/inpageSidebar/tabSwitch";

const DIR = resolve(import.meta.dir, "../src/plugins/inpageSidebar");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const code = (f: string) => strip(readFileSync(resolve(DIR, f), "utf8"));

describe("后台：show 与 active 无关（chrome mock，无 Chrome）", () => {
    const g = globalThis as Record<string, unknown>;
    const keep = { chrome: g.chrome, document: g.document };
    let realSettings: Record<string, unknown>;
    const prefs: Record<string, unknown> = { defaultMode: "inpage", showHandle: false, hoverReveal: false, prewarm: "off" };
    const L: Record<string, Function[]> = {}; const ev = (k: string) => ({ addListener: (f: Function) => { (L[k] ??= []).push(f); }, removeListener: (f: Function) => { L[k] = (L[k] ?? []).filter(x => x !== f); } });
    const chromeMock = {
        runtime: { onMessage: ev("msg"), onConnect: ev("conn"), lastError: undefined, id: "x", getManifest: () => ({ version: "0.0.0" }) },
        contextMenus: { onClicked: ev("menu"), create: (_p: unknown, cb?: () => void) => { cb?.(); }, remove: (_id: string, cb?: () => void) => cb?.(), update: (_i: string, _p: unknown, cb?: () => void) => cb?.() },
        sidePanel: { open: async () => undefined, close: async () => undefined, setOptions: async () => undefined },
        webNavigation: { onBeforeNavigate: ev("nav") },
        tabs: { onActivated: ev("act"), onUpdated: ev("upd"), onRemoved: ev("rem"), query: async () => [], get: async (id: number) => ({ id, url: "https://a.test/" }), sendMessage: async () => ({ ok: true, proto: 1 }) },
        windows: { onRemoved: ev("wrem"), onFocusChanged: ev("foc"), getAll: async () => [{ id: 8 }], getLastFocused: async () => ({ id: 8 }), WINDOW_ID_NONE: -1 },
        action: { setBadgeText: async () => undefined },
        storage: { local: { get: async () => ({ "data:inpageSidebar": { openByWin: {}, lastOpen: false } }) /* rel62-intent-persist：老用户「上次收起」——未知窗口继承 false（本文件测的不是继承） */, set: async () => undefined }, onChanged: ev("sc") },
    };
    let BG: any;
    beforeAll(async () => {
        realSettings = { ...(await import("../src/plugins/inpageSidebar/settings")) };
        delete g.document; g.chrome = chromeMock;
        mock.module(resolve(DIR, "settings.ts"), () => ({ settings: { store: prefs, def: {} } }));
        BG = await import(resolve(DIR, "background.ts") + "?tabswitch");
    });
    afterAll(() => { for (const c of ((globalThis as { __cleanups?: (() => void)[] }).__cleanups ?? [])) { try { c(); } catch { /* 清理失败不影响其它文件 */ } } delete (globalThis as { __cleanups?: unknown }).__cleanups; mock.module(resolve(DIR, "settings.ts"), () => realSettings); mock.restore(); g.chrome = keep.chrome; if (keep.document !== undefined) g.document = keep.document; });
    const port = (tabId: number, windowId: number, url: string) => {
        const sent: any[] = []; const m: Function[] = [];
        return { name: "inpage:host", sender: { tab: { id: tabId, windowId, url }, frameId: 0 }, sent, postMessage: (x: unknown) => { sent.push(x); }, onMessage: { addListener: (f: Function) => m.push(f), removeListener: (f: Function) => { const i = m.indexOf(f); if (i >= 0) m.splice(i, 1); } }, onDisconnect: { addListener: () => undefined }, say: (x: unknown) => { for (const f of m.slice()) f(x); } };
    };
    const last = (p: { sent: any[] }) => p.sent.filter(s => s.type === "inpage:state").at(-1);
    const wait = () => new Promise(r => setTimeout(r, 5));

    test("展开后：活动标签与非活动标签都 show:true（只有 active 不同）；切走 / 切回 show 不变；收起 → 两边一起 false", async () => {
        (globalThis as { __cleanups?: unknown }).__cleanups = BG.startBackground(); await wait();
        const a = port(5, 8, "https://a.test/"), b = port(6, 8, "https://b.test/");
        L.conn![0]!(a); L.conn![0]!(b); a.say({ type: "hello", proto: 1, frame: "none" }); b.say({ type: "hello", proto: 1, frame: "none" }); await wait();
        L.act![0]!({ tabId: 5, windowId: 8 });
        expect(last(a)).toMatchObject({ active: true, show: false }); expect(last(b)).toMatchObject({ active: false, show: false });
        L.menu![0]!({ menuItemId: "inpage-toggle-page" }, { id: 5, windowId: 8, url: "https://a.test/" }); await wait();
        expect(last(a)).toMatchObject({ active: true, show: true });
        expect(last(b)).toMatchObject({ active: false, show: true }); // 补丁前：false（非活动标签被收起 = 切回来时重新展开的根因）
        L.act![0]!({ tabId: 6, windowId: 8 });
        expect(last(a)).toMatchObject({ active: false, show: true }); expect(last(b)).toMatchObject({ active: true, show: true }); // 切走的标签保持展开
        L.act![0]!({ tabId: 5, windowId: 8 });
        expect(last(a)).toMatchObject({ active: true, show: true }); expect(last(b)).toMatchObject({ active: false, show: true });
        L.menu![0]!({ menuItemId: "inpage-toggle-page" }, { id: 5, windowId: 8, url: "https://a.test/" }); await wait();
        expect(last(a)).toMatchObject({ show: false }); expect(last(b)).toMatchObject({ show: false });
    });
    test("别的窗口不受影响：窗口 9 的标签 show 仍随它自己的意图（false）", async () => {
        const c = port(7, 9, "https://c.test/"); L.conn![0]!(c); c.say({ type: "hello", proto: 1, frame: "none" }); await wait();
        expect(last(c)).toMatchObject({ show: false });
        const a = port(15, 8, "https://a.test/"); L.conn![0]!(a); a.say({ type: "hello", proto: 1, frame: "none" }); await wait();
        L.menu![0]!({ menuItemId: "inpage-toggle-page" }, { id: 15, windowId: 8, url: "https://a.test/" }); await wait();
        expect(last(a)).toMatchObject({ show: true }); expect(last(c)).toMatchObject({ show: false });
        L.menu![0]!({ menuItemId: "inpage-toggle-page" }, { id: 15, windowId: 8, url: "https://a.test/" }); await wait();
    });
});

describe("内容脚本（源码约束）：非活动标签保持展开、隐藏时不播动画、可见时无动画补画", () => {
    const c = code("content.ts");
    test("pinned 与 active 无关；iframe 只给 active；active = 后台 active 或「可见 + 已有真实状态」", () => {
        expect(c).toMatch(/const pinned = !!st\?\.show && !blocked;/); expect(c).not.toMatch(/const pinned = active &&/);
        expect(c).toMatch(/const active = !!st\?\.active \|\| \(vis && realSeen && !!st\);/);
        expect(c).toMatch(/frameDecision\(\{ teardown: false, active, shown, blocked,[^\n]*\}\);[^\n]*\n\s*if \(fd\.destroy\) destroyFrame\(\);\s*\n\s*if \(fd\.park\) parkFrame\(\);\s*\n\s*if \(fd\.unpark\) unparkFrame\(\);\s*\n\s*if \(fd\.build\) ensureFrame\(\);/); /* 补丁 tab-shake：失活 = 停放，不再立刻销毁；决策表见 frameLife.ts / tests/inpageFrameLife.test.ts */
        expect(c).toMatch(/const hoverOn = active && !!st\?\.hover/); // 悬停浮出只在活动标签
    });
    test("隐藏标签里的状态变化一律 instant（切回来时已是终态，不会在可见的那一刻补播过渡）", () => {
        expect(c).toMatch(/const vis = document\.visibilityState === "visible";\s*\n\s*instant = prepareRender\(\{ instant, visible: vis, host, box, raf: requestAnimationFrame \}\);/); // 补丁 prepare-render：顺序修正——先算有效 instant（含隐藏）再压过渡（tests/inpagePrepareRender.test.ts）
        expect(c).toMatch(/syncPush\(!instant && !dragging\)/); expect(c).not.toMatch(/instant = instant \|\| !vis/); // 旧写法（先写 noanim、后抬 instant）已去掉
    });
    test("切回（visibilitychange → visible）：用手里的状态同步 render(true)，没状态就读提示；bfcache 恢复：t0 / activated 重置 + render(true) + 重连", () => {
        expect(c).toMatch(/const onVisibility = \(\) => \{[^}]*document\.visibilityState !== "visible" \|\| stopped\) return;\s*\n\s*if \(st\) render\(true\); else loadHint\(\);\s*\n\s*resume\(\);/);
        expect(c).toMatch(/document\.addEventListener\("visibilitychange", onVisibility\)/); expect(c).toMatch(/document\.removeEventListener\("visibilitychange", onVisibility\)/);
        expect(c).toMatch(/if \(!e\.persisted\) return;\s*\n\s*t0 = performance\.now\(\); activated = false; if \(st\) render\(true\);\s*\n\s*resume\(\);/);
        expect(c).toMatch(/let t0 = performance\.now\(\)/);
    });
    test("后台：stateFor 的 show = shouldShowHost(f)（不再 active &&）", () => {
        const b = code("background.ts"); expect(b).toMatch(/show: shouldShowHost\(f\), nativeOpen/); expect(b).not.toMatch(/show: active && shouldShowHost/);
    });
    test("panel.ts：滚动位置经 chrome.storage.session（按窗口键），不碰 localStorage / sessionStorage；用户一动就停止接回；清理函数摘掉监听", () => {
        const p = code("panel.ts"); expect(p).toMatch(/scrollKey\(hostWindowId\(\)\)/); expect(p).toMatch(/chrome\.storage\.session\.get\(sk\)/); expect(p).toMatch(/chrome\.storage\.session\.set\(\{ \[sk\]:/);
        expect(p).not.toMatch(/localStorage|sessionStorage/); expect(p).toMatch(/for \(const ev of \["wheel", "pointerdown", "keydown", "touchstart"\]\) document\.addEventListener\(ev, userActed/);
        expect(p).toMatch(/document\.removeEventListener\("scroll", onScroll/);
    });
    test("tabSwitch.ts：纯逻辑文件不 import chrome / 无控制台", () => { expect(code("tabSwitch.ts")).not.toMatch(/chrome\.|console\.|import /); });
});

describe("滚动位置的纯逻辑", () => {
    test("scrollKey：按窗口；非法窗口 id = 无键（不存不取）", () => {
        expect(scrollKey(7)).toBe("inpageScroll:7"); for (const v of [undefined, 0, -1, 1.5, Number.NaN]) expect(scrollKey(v as number)).toBeUndefined();
    });
    test("parseScroll：只认有限、非负、不超大的数；取整", () => {
        expect(parseScroll(120.4)).toBe(120); expect(parseScroll(0)).toBe(0);
        for (const v of [-1, Number.NaN, Infinity, "12", null, undefined, 1e7, {}]) expect(parseScroll(v)).toBeUndefined();
    });
    test("restoreStep：内容够高 → 落到 saved；不够 → 等；超时 → 夹到最大可滚；saved = 0 → 一直 wait（不干预）", () => {
        const base = { saved: 300, scrollHeight: 1000, clientHeight: 600, elapsedMs: 0 };
        expect(restoreStep(base)).toBe(300); // max = 400 ≥ 300
        expect(restoreStep({ ...base, scrollHeight: 800 })).toBe("wait"); // max = 200 < 300：列表还没加载完
        expect(restoreStep({ ...base, scrollHeight: 800, elapsedMs: SCROLL.restoreMs })).toBe(200); // 超时：夹到 200
        expect(restoreStep({ ...base, scrollHeight: 500, elapsedMs: SCROLL.restoreMs })).toBe(0);
        expect(restoreStep({ ...base, saved: 0 })).toBe("wait"); expect(restoreStep({ ...base, saved: 400 })).toBe(400); expect(restoreStep({ ...base, saved: 401 })).toBe("wait");
        expect(SCROLL.restoreMs).toBeGreaterThan(0); expect(SCROLL.saveDebounceMs).toBeGreaterThan(0);
    });
});

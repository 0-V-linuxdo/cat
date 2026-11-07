import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { STORAGE_KEY } from "../src/utils/SettingsStore";
import { startContent } from "../src/plugins/inpageSidebar/content";
import { adoptEarly, clearEarly, type EarlyHandle, registerEarly } from "../src/plugins/inpageSidebar/earlyHandle";
import { type EarlyDeps, runEarly } from "../src/plugins/inpageSidebar/earlyEntry";
import { EARLY, earlyPluginEnabled, type Hint, hintEnv, hintFromState, parseHint, sameHint, withoutIds } from "../src/plugins/inpageSidebar/earlyShow";

/* 补丁 inpage-residual-rel53（② 早实例：新建 tab / 跨源导航赶不上首帧；① prepareRender 已在 rel52 第 5 层，其单测在 tests/inpagePrepareRender.test.ts）。
 * 真实时序（首帧 vs 壳出现）要真浏览器——见 shots/retest-residual.ts（只写没跑）；这里只证明逻辑、顺序与接线，不声称时序。 */

const ROOT = resolve(import.meta.dir, "..");
const read = (f: string) => readFileSync(resolve(ROOT, f), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("② 提示新增字段（dm / hv / hd）与设置判断", () => {
    const GOOD: Hint = { v: 1, show: true, width: 300, base: "rgb(30, 32, 32)", scheme: "dark", win: 7, tab: 9, dm: "overlay", hv: true, hd: true };
    test("parseHint：合法字段原样；坏的被丢弃；旧提示（没有这三个字段）仍然合法", () => {
        expect(parseHint(GOOD)).toEqual(GOOD);
        const r = parseHint({ ...GOOD, dm: "evil", hv: "yes", hd: 1 })!; expect(r.dm).toBeUndefined(); expect(r.hv).toBeUndefined(); expect(r.hd).toBeUndefined();
        expect(parseHint({ v: 1, show: true, width: 228 })).toEqual({ v: 1, show: true, width: 228 });
    });
    test("hintFromState 带上真实状态里的 displayMode / hover / handle；sameHint 对它们敏感；withoutIds 保留它们", () => {
        const st = { active: true, show: true, width: 300, windowId: 7, tabId: 9, displayMode: "overlay" as const, hover: true, handle: false };
        const h = hintFromState({ st, theme: undefined, blocked: false, visible: true, real: true })!;
        expect(h.dm).toBe("overlay"); expect(h.hv).toBe(true); expect(h.hd).toBe(false);
        expect(sameHint(h, { ...h, dm: "push" })).toBe(false); expect(sameHint(h, { ...h })).toBe(true);
        const w = withoutIds(h); expect(w.win).toBeUndefined(); expect(w.dm).toBe("overlay"); expect(w.hv).toBe(true); expect(w.hd).toBe(false);
    });
    test("hintEnv：没记就用默认（hover 关、handle 取调用方给的默认）；记了就用记的", () => {
        expect(hintEnv({ v: 1, show: true, width: 228 }, false)).toEqual({ displayMode: undefined, hover: false, handle: false });
        expect(hintEnv({ v: 1, show: true, width: 228, dm: "overlay", hv: true, hd: true }, false)).toEqual({ displayMode: "overlay", hover: true, handle: true });
    });
    test("earlyPluginEnabled：只认 plugins.InpageSidebar.enabled === true（默认关）", () => {
        expect(earlyPluginEnabled({ plugins: { InpageSidebar: { enabled: true } } })).toBe(true);
        for (const bad of [undefined, null, 1, {}, { plugins: null }, { plugins: {} }, { plugins: { InpageSidebar: {} } }, { plugins: { InpageSidebar: { enabled: false } } }, { plugins: { InpageSidebar: { enabled: "true" } } }, { plugins: { Other: { enabled: true } } }]) expect(earlyPluginEnabled(bad)).toBe(false);
    });
});

/* —— 早脚本（假依赖）—— */
const HINT: Hint = { v: 1, show: true, width: 260, base: "rgb(30, 32, 32)", scheme: "dark", win: 3, tab: 4, dm: "push", hv: false, hd: false };
const ENABLED = { plugins: { InpageSidebar: { enabled: true } } };
function deps(over: Partial<EarlyDeps> & { l1?: Hint; store?: Record<string, unknown>; storeErr?: boolean } = {}) {
    const calls = { start: [] as unknown[], stop: 0, clear: 0, get: [] as string[][] };
    const d: EarlyDeps = {
        isTop: () => true, hasRuntime: () => true, visible: () => true, prerendering: () => false,
        readSession: () => over.l1,
        getStorage: keys => { calls.get.push(keys); return over.storeErr ? Promise.reject(new Error("x")) : Promise.resolve(over.store); },
        clearHints: () => { calls.clear++; },
        start: o => { calls.start.push(o); return () => { calls.stop++; }; },
        ...over,
    };
    return { d, calls };
}
const tick = () => new Promise(r => setTimeout(r, 0));

describe("② runEarly：赶在 content.js 整包之前决定要不要先建壳", () => {
    test("第 1 层命中：同步起实例（early:true、带提示），之后设置确认启用 → 不重复起", async () => {
        const { d, calls } = deps({ l1: HINT, store: { [STORAGE_KEY]: ENABLED, [EARLY.localKey]: HINT } });
        runEarly(d);
        expect(calls.start).toHaveLength(1); expect(calls.start[0]).toEqual({ early: true, hint: HINT }); // 同步（还没 await）
        await tick(); expect(calls.start).toHaveLength(1); expect(calls.stop).toBe(0); expect(calls.clear).toBe(0);
    });
    test("只有第 2 层（新建 tab / 跨源）：一次读 [提示, 设置]；启用 + show → 异步起、提示不带 win / tab", async () => {
        const { d, calls } = deps({ store: { [STORAGE_KEY]: ENABLED, [EARLY.localKey]: HINT } });
        runEarly(d);
        expect(calls.get).toEqual([[EARLY.localKey, STORAGE_KEY]]); expect(calls.start).toHaveLength(0);
        await tick();
        expect(calls.start).toHaveLength(1);
        const o = calls.start[0] as { early: boolean; hint: Hint }; expect(o.early).toBe(true); expect(o.hint.win).toBeUndefined(); expect(o.hint.tab).toBeUndefined(); expect(o.hint.width).toBe(260); expect(o.hint.dm).toBe("push");
    });
    test("设置里没启用（或没存）：第 2 层有提示也不起，并清提示（别让每个页面白建一次壳）", async () => {
        for (const store of [{ [EARLY.localKey]: HINT }, { [STORAGE_KEY]: { plugins: { InpageSidebar: { enabled: false } } }, [EARLY.localKey]: HINT }]) {
            const { d, calls } = deps({ store });
            runEarly(d); await tick();
            expect(calls.start).toHaveLength(0); expect(calls.clear).toBe(1);
        }
    });
    test("第 1 层已起实例、设置却说没启用（陈旧的 sessionStorage 提示）：撤实例 + 清提示", async () => {
        const { d, calls } = deps({ l1: HINT, store: { [STORAGE_KEY]: { plugins: {} } } });
        runEarly(d); expect(calls.start).toHaveLength(1);
        await tick(); expect(calls.stop).toBe(1); expect(calls.clear).toBe(1);
    });
    test("没有任何提示（用户没开过 / 上次是收起的）：什么都不起、不清；启用与否都一样", async () => {
        for (const store of [{ [STORAGE_KEY]: ENABLED }, { [STORAGE_KEY]: ENABLED, [EARLY.localKey]: { ...HINT, show: false } }]) {
            const { d, calls } = deps({ store });
            runEarly(d); await tick(); expect(calls.start).toHaveLength(0); expect(calls.stop).toBe(0); expect(calls.clear).toBe(0);
        }
        const { d, calls } = deps({ store: undefined }); runEarly(d); await tick(); expect(calls.start).toHaveLength(0); expect(calls.clear).toBe(0); // 没有任何存储 = 未启用、也没有提示：不动
    });
    test("后台标签 / 预渲染：不乐观起（和 loadHint 同一个 mayShowOptimistic）", async () => {
        for (const o of [{ visible: () => false }, { prerendering: () => true }]) {
            const { d, calls } = deps({ l1: HINT, store: { [STORAGE_KEY]: ENABLED, [EARLY.localKey]: HINT }, ...o });
            runEarly(d); await tick(); expect(calls.start).toHaveLength(0);
        }
    });
    test("子 frame / 没有扩展上下文：不做任何事（也不读存储）", async () => {
        for (const o of [{ isTop: () => false }, { hasRuntime: () => false }]) {
            const { d, calls } = deps({ l1: HINT, store: { [STORAGE_KEY]: ENABLED }, ...o });
            runEarly(d); await tick(); expect(calls.start).toHaveLength(0); expect(calls.get).toHaveLength(0);
        }
    });
    test("读存储失败 / 同步抛错：吞掉（不影响页面与主脚本）；第 1 层已起的保留", async () => {
        const a = deps({ l1: HINT, storeErr: true }); runEarly(a.d); await tick(); expect(a.calls.start).toHaveLength(1); expect(a.calls.stop).toBe(0);
        const b = deps({ getStorage: () => { throw new Error("context invalidated"); } }); expect(() => runEarly(b.d)).not.toThrow();
    });
    test("返回的停止函数撤掉已起的实例", async () => {
        const { d, calls } = deps({ l1: HINT, store: { [STORAGE_KEY]: ENABLED } });
        const stop = runEarly(d); stop(); expect(calls.stop).toBe(1);
    });
});

describe("② 接管：adoptEarly（earlyHandle.ts 登记簿）/ content.start", () => {
    const mk = (alive: boolean, log: { adopted?: unknown; stops: number }): EarlyHandle => ({ alive: () => alive, stop: () => { log.stops++; }, adopt: t => { log.adopted = t; } });
    const T = (k: string) => k;
    test("没有登记 → undefined（调用方走 startContent）；实例已停（alive=false）→ undefined", () => {
        expect(adoptEarly(T)).toBeUndefined();
        const log = { stops: 0 }, h = mk(false, log); registerEarly(h);
        expect(adoptEarly(T)).toBeUndefined(); expect(log.stops).toBe(0);
        clearEarly(h);
    });
    test("有活着的早实例 → 把主脚本的 tr 交给它，返回它的 stop（插件停用时由插件管理器调）", () => {
        const log: { adopted?: unknown; stops: number } = { stops: 0 }, h = mk(true, log); registerEarly(h);
        const stop = adoptEarly(T); expect(stop).toBe(h.stop); expect(log.adopted).toBe(T); expect(log.stops).toBe(0);
        stop!(); expect(log.stops).toBe(1);
        clearEarly(h); expect(adoptEarly(T)).toBeUndefined();
    });
    test("clearEarly 只清自己：别的实例登记后，旧实例的 clear 不能把新的清掉", () => {
        const a = mk(true, { stops: 0 }), b = mk(true, { stops: 0 }); registerEarly(a); registerEarly(b); clearEarly(a);
        expect(adoptEarly(T)).toBe(b.stop); clearEarly(b);
    });
    test("没有 DOM 的环境里 startContent({early}) 直接返回（守卫不变），不登记", () => {
        expect(startContent({ early: true })).toBeUndefined();
        expect(adoptEarly(T)).toBeUndefined();
    });
    test("接线（源码）：index.ts 的 content.start = adoptEarly(tr) ?? startContent()；早实例登记 / 注销；早实例不读设置、不读第 2 层、接管前不显示需要 i18n 的提示", () => {
        const idx = strip(read("src/plugins/inpageSidebar/index.ts"));
        expect(idx).toContain("content: { start: () => adoptEarly(tr) ?? startContent() }");
        const c = strip(read("src/plugins/inpageSidebar/content.ts"));
        expect(c).toContain("registerEarly(me);");
        expect(c).toContain("const stop = () => { clearEarly(me); teardown(); };");
        expect(c).toContain("opts.early ? hintEnv(h, HANDLE.defaultOn) : {"); // 早实例不碰 settings.store
        expect(c).toContain("if (opts.early) {"); // 早实例的 loadHint 不自己读第 2 层
        expect(c).toContain('m.hint === "switch-failed" && trFn');
        expect(c).toContain("let trFn: ((key: string) => string) | undefined = opts.early ? undefined : tr;");
        expect(c).not.toContain("globalThis");
    });
});

describe("② 入口接线", () => {
    test("entries/content.ts：bootstrap 之前（顶层 + 守卫活着）先 runEarly；原有那行 bootstrap 守卫原样保留（contentGuard.test 依赖它）", () => {
        const e = strip(read("src/entries/content.ts"));
        expect(e).toContain("if (window.top === window && contentGuard.alive()) runEarly();");
        expect(e).toContain('if (contentGuard.alive()) void bootstrap("content");');
        expect(e.indexOf("runEarly();")).toBeLessThan(e.indexOf('void bootstrap("content")'));
    });
    test("manifest / build 不变：仍是单个 content.js（没有第二个入口）", () => {
        const m = JSON.parse(read("static/manifest.json")) as { content_scripts: Array<{ js: string[]; run_at: string; all_frames: boolean }> };
        expect(m.content_scripts).toHaveLength(1);
        expect(m.content_scripts[0]!.js).toEqual(["content.js"]);
        expect(m.content_scripts[0]!.run_at).toBe("document_start"); expect(m.content_scripts[0]!.all_frames).toBe(true);
        expect(read("build.ts")).not.toContain("contentEarly");
    });
    test("earlyEntry.ts / earlyHandle.ts 不 import ErrorLog / PluginManager / 控制台（内容脚本约束），earlyHandle 无 chrome / DOM", () => {
        const s = strip(read("src/plugins/inpageSidebar/earlyEntry.ts"));
        expect(s).not.toMatch(/ErrorLog|PluginManager|console\./);
        const h = strip(read("src/plugins/inpageSidebar/earlyHandle.ts"));
        expect(h).not.toMatch(/chrome\.|document|window|import /);
    });
});

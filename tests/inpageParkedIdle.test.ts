/* 补丁 inpage-parked-idle（rel55 第 17 层）：停放的（非活动标签的）页内侧栏不做没人看得见的活。
 * ① ParkGate：停放且隐藏 → 只记脏位（同 key 合并），切回补一次；停放但已可见 / 隐藏但没停放 → 照常（切回那一拍起不落后）；
 * ② 接线：PanelShell 整屏重绘 / liveCalendar / liveFolders / libraryView / adaptive 面板端 → 全走 unlessParked；panel.ts idle:false 兜底 flush；
 * ③ pagePush.browserDeps.observe：隐藏时页面节点变化 / 滚动只记脏位，切回可见立刻补扫（immediate）；pagePush 把 immediate 当 0 ms 去抖；
 * ④ background：onUpdated 只推本标签（不再整窗口 O(N)）；⑤ 不累积：监听只挂一次、flush 后清空；定时器数不随停放次数增长。
 * 真实 CPU / 内存 / 计时器触发次数要真浏览器（见 REL55-TABSWITCH-PLAN F2 与 r56d-*），这里不声称。 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { createPagePush, type PagePushDeps } from "../src/plugins/inpageSidebar/pagePush";
import { PUSH } from "../src/plugins/inpageSidebar/constants";

const SRC = resolve(import.meta.dir, "../src");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const code = (f: string) => strip(readFileSync(resolve(SRC, f), "utf8"));

type L = (...a: unknown[]) => void;
const g = globalThis as unknown as Record<string, unknown>;
const saved = { document: g.document, location: g.location, window: g.window, MutationObserver: g.MutationObserver };
let docListeners: Array<{ type: string; fn: L }>; let doc: { visibilityState: string; documentElement: { dataset: Record<string, string> }; body: object; addEventListener(t: string, f: L): void; removeEventListener(t: string, f: L): void };
const fireDoc = (type: string) => { for (const l of docListeners) if (l.type === type) l.fn(); };
beforeEach(() => {
    docListeners = [];
    doc = { visibilityState: "visible", documentElement: { dataset: {} }, body: {}, addEventListener: (type, fn) => { docListeners.push({ type, fn }); }, removeEventListener: (type, fn) => { docListeners = docListeners.filter(l => !(l.type === type && l.fn === fn)); } };
    g.document = doc; g.location = { search: "?host=inpage&win=1&tab=2" };
});
afterEach(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete g[k]; else g[k] = v; } });
const park = (on: boolean) => { if (on) doc.documentElement.dataset.inpageParked = "1"; else delete doc.documentElement.dataset.inpageParked; };
let n = 0;
const gate = async () => await import("../src/api/ParkGate?t=" + ++n) as typeof import("../src/api/ParkGate");

describe("① ParkGate：停放且隐藏 → 记脏位；切回补一次", () => {
    test("不停放：立即执行（原行为不变）", async () => {
        const { unlessParked } = await gate(); let k = 0; unlessParked("a", () => { k++; }); expect(k).toBe(1);
    });
    test("停放 + 隐藏：不执行；flush 才执行一次；同 key 合并、保留最后一次；不同 key 各一次（按首次记下的顺序）", async () => {
        const { unlessParked, flushParked } = await gate(); park(true); doc.visibilityState = "hidden"; const out: string[] = [];
        unlessParked("a", () => out.push("a1")); unlessParked("b", () => out.push("b")); unlessParked("a", () => out.push("a2"));
        expect(out).toEqual([]); flushParked(); expect(out).toEqual(["a2", "b"]); flushParked(); expect(out).toEqual(["a2", "b"]);
    });
    test("停放标记还在但文档已可见（切回的第一拍，标记由宿主异步撤）→ 照常执行，状态不落后", async () => {
        const { unlessParked } = await gate(); park(true); doc.visibilityState = "visible"; let k = 0; unlessParked("a", () => { k++; }); expect(k).toBe(1);
    });
    test("隐藏但没停放（窗口最小化 / 被遮挡的前台标签）→ 照常执行", async () => {
        const { unlessParked } = await gate(); park(false); doc.visibilityState = "hidden"; let k = 0; unlessParked("a", () => { k++; }); expect(k).toBe(1);
    });
    test("非 inpage 宿主（原生侧栏 / 弹窗）：永远照常执行", async () => {
        const { unlessParked } = await gate(); g.location = { search: "" }; park(true); doc.visibilityState = "hidden"; let k = 0; unlessParked("a", () => { k++; }); expect(k).toBe(1);
    });
    test("文档变可见（visibilitychange）→ 自动补做；监听只挂一次（再多次记脏位也不增加）", async () => {
        const { unlessParked } = await gate(); park(true); doc.visibilityState = "hidden"; let k = 0;
        for (let i = 0; i < 1000; i++) unlessParked("a", () => { k++; });
        expect(docListeners.filter(l => l.type === "visibilitychange").length).toBe(1); expect(k).toBe(0);
        doc.visibilityState = "hidden"; fireDoc("visibilitychange"); expect(k).toBe(0); // 仍隐藏：不补
        doc.visibilityState = "visible"; fireDoc("visibilitychange"); expect(k).toBe(1); // 1000 次合并成 1 次
        doc.visibilityState = "hidden"; unlessParked("a", () => { k++; }); expect(docListeners.filter(l => l.type === "visibilitychange").length).toBe(1);
        doc.visibilityState = "visible"; fireDoc("visibilitychange"); expect(k).toBe(2);
    });
    test("flush 里一个 fn 抛错不影响其余；无脏位的 flush 零开销（不抛、不动 pending）", async () => {
        const { unlessParked, flushParked } = await gate(); flushParked(); park(true); doc.visibilityState = "hidden"; const out: string[] = [];
        const e = console.error; console.error = () => { }; try {
            unlessParked("x", () => { throw new Error("boom"); }); unlessParked("y", () => out.push("y")); flushParked();
        } finally { console.error = e; }
        expect(out).toEqual(["y"]);
    });
    test("模块无定时器：ParkGate 不含 setTimeout / setInterval / requestAnimationFrame，也不碰 DOM 节点（不删、不改 src）", () => {
        const c = code("api/ParkGate.ts"); expect(c).not.toMatch(/setTimeout|setInterval|requestAnimationFrame|\.remove\(|\.src\b|replaceChildren|innerHTML/);
        expect(Object.keys(require(resolve(SRC, "api/ParkGate.ts"))).toSorted()).toEqual(["flushParked", "unlessParked"]);
    });
});

describe("② 接线：渲染 / 轮询 / 联网刷新在停放时只记脏位", () => {
    test("PanelShell：整屏重绘的去抖回调走 unlessParked('shell.render', renderAll)；mountShell 末尾的首次 renderAll() 不动", () => {
        const c = code("api/PanelShell.ts");
        expect(c).toMatch(/import \{ unlessParked \} from "@api\/ParkGate";/);
        expect(c).toMatch(/const render = debounce\(\(\) => unlessParked\("shell\.render", renderAll\), 16\);/);
        expect(c).toMatch(/\n    renderAll\(\);\n\}/);
    });
    test("panel.ts：idle:false 撤停放标记后 flushParked()；idle:true 不 flush", () => {
        const c = code("plugins/inpageSidebar/panel.ts");
        expect(c).toMatch(/import \{ flushParked \} from "@api\/ParkGate";/);
        expect(c).toMatch(/if \(idle\) root\.dataset\.inpageParked = "1"; else \{ delete root\.dataset\.inpageParked; flushParked\(\); \}/);
    });
    // 第 18 层（inpage-parked-timers-stop）把下面几处的「到点记脏位」升级成「真停表」：定时器改走 ParkLife.parkedInterval（接线断言见 inpageParkedTimers.test.ts）；事件驱动的脏位仍走 unlessParked
    test("liveCalendar：15 分钟联网刷新 / 30 s 重绘 tick 走 parkedInterval（第 18 层：停放时不再调度）；清理调两个停止函数", () => {
        const c = code("plugins/library/liveCalendar/index.ts");
        expect(c).toMatch(/parkedInterval\(\(\) => void load\(\), 15 \* 60000\)/);
        expect(c).toMatch(/parkedInterval\(refresh, 30000\)/);
        expect(c).toMatch(/\(\) => \{ reload\(\); tick\(\); \}/);
    });
    test("liveFolders：10 分钟联网刷新走 parkedInterval", () => {
        expect(code("plugins/tabs/liveFolders/index.ts")).toMatch(/parkedInterval\(\(\) => void load\(\), 10 \* 60000\)/);
    });
    test("libraryView：下载列表 2 s 重建、下载托盘 1 s 轮询走 parkedInterval；下载事件回调第 18b 层起直接 poll（不再 unlessParked，接线断言见 inpageParkedTimersB.test.ts）；没有裸 setInterval", () => {
        const c = code("plugins/library/libraryView/index.ts");
        expect(c).toMatch(/parkedInterval\(\(\) => void draw\(\), 2000\)/);
        expect(c).toMatch(/timer = parkedInterval\(\(\) => void poll\(\), 1000\)/);
        expect(c).toMatch(/const onEv = \(\) => void poll\(\);/); // 第 18b 层
        expect(c).not.toMatch(/setInterval\(/);
    });
    test("adaptive 面板端：tabs.onActivated / session.onChanged 的重涂走 unlessParked（tabId 状态照常更新）；content 端 2.5 s 取色第 18 层改 visibleInterval（隐藏时真停表）", () => {
        const c = code("plugins/adaptive/index.ts");
        expect(c).toMatch(/tabId = i\.tabId; unlessParked\("adaptive\.paint", \(\) => void refreshPaint\(\)\);/);
        expect(c).toMatch(/KEY\(tabId\) in ch\) unlessParked\("adaptive\.paint", \(\) => void refreshPaint\(\)\);/);
        expect(c).toMatch(/const iv = visibleInterval\(soon, 2500\);/); // 第 18 层：隐藏时 clearInterval
    });
    test("tabState（第 16 层）不动：schedule 的守卫 + onVisible 切回 reload 仍在", () => {
        const c = code("plugins/_core/tabState/index.ts");
        expect(c).toMatch(/const schedule = debounce\(\(\) => \{ if \(isParkedHost\(\)\) return; void reload\(\); \}, 40\);/);
        expect(c).toMatch(/const onVisible = \(\) => \{ if \(document\.visibilityState === "visible"\) void reload\(\); \};/);
    });
    test("所有 unlessParked 调用 key 唯一约定：每个 key 只在一个功能里用（同功能可多处共用同一 key = 合并）", () => {
        const files = ["api/PanelShell.ts", "plugins/library/liveCalendar/index.ts", "plugins/tabs/liveFolders/index.ts", "plugins/library/libraryView/index.ts", "plugins/adaptive/index.ts"];
        const keys = files.flatMap(f => [...code(f).matchAll(/unlessParked\("([\w.]+)"/g)].map(m => m[1]!));
        expect(new Set(keys)).toEqual(new Set(["shell.render", "adaptive.paint"])); // 第 18 层：cal.* / liveFolders.load / lib.draw 已改 parkedInterval；第 18b 层：lib.dlPoll（下载事件）改为直接 poll，都不再需要脏位 key
    });
});

describe("③ pagePush：隐藏时不扫页面，切回可见立刻补扫", () => {
    class FakeMO { static all: FakeMO[] = []; connected = true; constructor(public cb: () => void) { FakeMO.all.push(this); } observe() { } disconnect() { this.connected = false; } }
    const mkObserve = async () => {
        FakeMO.all = []; const winL: Array<{ type: string; fn: L }> = [];
        g.MutationObserver = FakeMO; g.window = { addEventListener: (type: string, fn: L) => { winL.push({ type, fn }); }, removeEventListener: (type: string, fn: L) => { const i = winL.findIndex(l => l.type === type && l.fn === fn); if (i >= 0) winL.splice(i, 1); }, innerWidth: 1000 };
        const { browserDeps } = await import("../src/plugins/inpageSidebar/pagePush?t=" + ++n); const calls: unknown[][] = [];
        const stop = browserDeps({ contains: () => false } as unknown as Element).observe((...a: unknown[]) => { calls.push(a); });
        const mut = () => FakeMO.all[0]!.cb(); const scroll = () => winL.filter(l => l.type === "scroll").forEach(l => l.fn());
        return { calls, stop, mut, scroll, winL };
    };
    test("可见：节点变化 / 滚动照常回调 cb()（无参 = 走去抖）；原行为不变", async () => {
        const o = await mkObserve(); doc.visibilityState = "visible"; o.mut(); o.scroll(); expect(o.calls).toEqual([[], []]);
    });
    test("隐藏：节点变化 / 滚动 100 次 → 0 次回调；切回可见 → 恰好 1 次 cb(true)", async () => {
        const o = await mkObserve(); doc.visibilityState = "hidden"; for (let i = 0; i < 100; i++) { o.mut(); o.scroll(); }
        expect(o.calls.length).toBe(0); doc.visibilityState = "visible"; fireDoc("visibilitychange"); expect(o.calls).toEqual([[true]]);
        fireDoc("visibilitychange"); expect(o.calls.length).toBe(1); // 没有新积压：不重复补扫
    });
    test("隐藏期间没有任何变化 → 切回不补扫（不白扫）", async () => {
        const o = await mkObserve(); doc.visibilityState = "hidden"; fireDoc("visibilitychange"); doc.visibilityState = "visible"; fireDoc("visibilitychange"); expect(o.calls.length).toBe(0);
    });
    test("停掉观察：observer 断开、scroll / visibilitychange 监听都摘掉（不泄漏）", async () => {
        const o = await mkObserve(); o.stop(); expect(FakeMO.all[0]!.connected).toBe(false); expect(o.winL.filter(l => l.type === "scroll").length).toBe(0); expect(docListeners.filter(l => l.type === "visibilitychange").length).toBe(0);
    });
    test("pagePush.startObserve：cb(true) → 0 ms 去抖；cb() → PUSH.scanDebounceMs", () => {
        let obs: ((i?: boolean) => void) | undefined; const timers: number[] = [];
        const deps: PagePushDeps = {
            scan: () => [], isOwn: () => false, position: () => "static", marginLeft: () => 0, clientWidth: () => 1000, rtlScrollbar: () => 0, flush: () => { }, reducedMotion: () => true,
            sheet: { set: () => { }, clear: () => { } }, observe: cb => { obs = cb; return () => { obs = undefined; }; }, setTimer: (_fn, ms) => { timers.push(ms); return timers.length; }, clearTimer: () => { },
        };
        const p = createPagePush(deps); p.set(228, { animate: false }); expect(obs).toBeDefined();
        timers.length = 0; obs!(); expect(timers).toEqual([PUSH.scanDebounceMs]); timers.length = 0; obs!(true); expect(timers).toEqual([0]);
    });
    test("源码：browserDeps.observe 带隐藏脏位 + 清理对称", () => {
        const c = code("plugins/inpageSidebar/pagePush.ts");
        expect(c).toMatch(/doc\.visibilityState === "hidden"\) \{ dirty = true; return; \} cb\(\);/);
        expect(c).toMatch(/doc\.addEventListener\("visibilitychange", onVis\);/); expect(c).toMatch(/doc\.removeEventListener\("visibilitychange", onVis\)/);
    });
});

describe("④ background：onUpdated 只推本标签", () => {
    test("onUpdated：pushRec(r) + 仅活动标签 syncBadge；不再 pushWindow(整窗口)", () => {
        const c = code("plugins/inpageSidebar/background.ts");
        const body = /const onUpdated = \(id: number, info[^\n]*\n([\s\S]*?)\n    \};/.exec(c)?.[1] ?? ""; expect(body.length).toBeGreaterThan(20);
        expect(body).toMatch(/r\.url = info\.url; pushRec\(r\); if \(activeByWin\[r\.windowId\] === id\) syncBadge\(r\.windowId\);/);
        expect(body).not.toMatch(/pushWindow/);
    });
    test("没有改动的东西（保持）：onActivated 仍走 planActivation（只推状态变了的 2 个标签）+ retab 自带去重；pushRec 的 memReady 门（第 15 层）原样", () => {
        const c = code("plugins/inpageSidebar/background.ts");
        expect(c).toMatch(/for \(const c of planActivation\(hosts, activeByWin, lastActive\)\) \{ const r = tabs\.get\(c\.tabId\); if \(r\) pushRec\(r\); \}/);
        expect(c).toMatch(/if \(!rec\.port \|\| \(!memReady && !hint\)\) return;/);
        expect(code("plugins/inpageSidebar/prewarmOpened.ts")).toMatch(/const r = this\.recs\.get\(w\); if \(!r \|\| r\.tabId === tabId\) return;/);
    });
});

describe("⑤ 不累积：长期停放不增长", () => {
    test("1 万次「停放期间的刷新请求」→ pending 只有各 key 一份；flush 后清空；之后再停放再记也是 O(key 数)", async () => {
        const { unlessParked, flushParked } = await gate(); park(true); doc.visibilityState = "hidden"; let runs = 0;
        for (let i = 0; i < 10_000; i++) { unlessParked("shell.render", () => { runs++; }); unlessParked("adaptive.paint", () => { runs++; }); }
        expect(runs).toBe(0); flushParked(); expect(runs).toBe(2); flushParked(); expect(runs).toBe(2);
        for (let i = 0; i < 10_000; i++) unlessParked("shell.render", () => { runs++; }); flushParked(); expect(runs).toBe(3);
    });
});

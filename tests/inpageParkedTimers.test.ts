/* 补丁 inpage-parked-timers-stop（rel55 第 18 层）：停放的（非活动标签的）页内侧栏「真停表」，不只是到点不干活。
 * ① ParkLife.parkedInterval：停放且隐藏 → clearTimeout（队列里 0 个定时器、0 次触发）；切回：已到点 → 补**一次**并按原周期重启，没到点 → 只补足剩余时间；长停放不补发多次；
 * ② ParkLife.whileActive：停放且隐藏 → 摘 chrome.* 事件监听；切回重挂 + onResume 补读；挂 / 摘成对不累积；
 * ③ ParkLife.visibleInterval（页面侧取色用）：隐藏 = clearInterval，可见 = 重启；
 * ④ 与 ParkGate（第 17 层）并存：同一次切回各补一次、不重复；ParkLife 不碰 DOM / src（不闪、不重放、不重载）；非 inpage 宿主行为不变；
 * ⑤ 接线（comment-stripped 源码断言）：liveCalendar / liveFolders / libraryView / tabState / media / adaptive；panel.ts idle 消息 → parkLifeChanged；
 * ⑥ SW pushRec 去重：同端口状态没变不再发；变了照发；hello 应答 / hint 永远发；第 15 层 memReady 闸与 lastActive 保持；第 14 层 onActivated 路径、restoreOnClose 不碰。
 * 真实触发次数 / 空闲 CPU / SW 推送条数要真浏览器（REL55-TABSWITCH-PLAN G 与 r56e-*），这里不声称。 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";


const SRC = resolve(import.meta.dir, "../src");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const code = (f: string) => strip(readFileSync(resolve(SRC, f), "utf8"));

type L = (...a: unknown[]) => void;
const g = globalThis as unknown as Record<string, unknown>;
const saved = { document: g.document, location: g.location, setTimeout: g.setTimeout, clearTimeout: g.clearTimeout, setInterval: g.setInterval, clearInterval: g.clearInterval, now: Date.now };
let docListeners: Array<{ type: string; fn: L }>; let doc: { visibilityState: string; documentElement: { dataset: Record<string, string> }; addEventListener(t: string, f: L): void; removeEventListener(t: string, f: L): void };
const fireDoc = (type: string) => { for (const l of Array.from(docListeners)) if (l.type === type) l.fn(); };
const visL = () => docListeners.filter(l => l.type === "visibilitychange").length;

/* 虚拟时钟：setTimeout / setInterval / Date.now 全由它驱动 */
let clock = 0, nid = 0; let timers: Map<number, { at: number; fn: () => void; every?: number }>;
const fakeSet = (fn: () => void, ms: number) => { const id = ++nid; timers.set(id, { at: clock + ms, fn }); return id; };
const fakeSetI = (fn: () => void, ms: number) => { const id = ++nid; timers.set(id, { at: clock + ms, fn, every: ms }); return id; };
const fakeClear = (id: number) => { timers.delete(id); };
const advance = (ms: number) => {
    const end = clock + ms;
    for (;;) {
        let next: [number, { at: number; fn: () => void; every?: number }] | undefined;
        for (const e of timers) if (e[1].at <= end && (!next || e[1].at < next[1].at)) next = e;
        if (!next) break;
        clock = next[1].at; if (next[1].every) next[1].at += next[1].every; else timers.delete(next[0]);
        next[1].fn();
    }
    clock = end;
};
beforeEach(() => {
    clock = 0; nid = 0; timers = new Map(); docListeners = [];
    doc = {
        visibilityState: "visible", documentElement: { dataset: {} },
        addEventListener: (type, fn) => { docListeners.push({ type, fn }); },
        removeEventListener: (type, fn) => { const i = docListeners.findIndex(l => l.type === type && l.fn === fn); if (i >= 0) docListeners.splice(i, 1); },
    };
    g.document = doc; g.location = { search: "?host=inpage&win=1&tab=2" };
    g.setTimeout = fakeSet; g.clearTimeout = fakeClear; g.setInterval = fakeSetI; g.clearInterval = fakeClear; Date.now = () => 1_000_000 + clock;
});
afterEach(() => { for (const [k, v] of Object.entries(saved)) { if (k === "now") Date.now = v as () => number; else if (v === undefined) delete g[k]; else g[k] = v; } });
const parkAndHide = () => { doc.documentElement.dataset.inpageParked = "1"; doc.visibilityState = "hidden"; fireDoc("visibilitychange"); };
const showAndUnpark = () => { delete doc.documentElement.dataset.inpageParked; doc.visibilityState = "visible"; fireDoc("visibilitychange"); };
let n = 0;
const dedupMod = async () => await import("../src/plugins/inpageSidebar/pushDedup");
const life = async () => await import("../src/api/ParkLife?t=" + ++n) as typeof import("../src/api/ParkLife");
const gateMod = async () => await import("../src/api/ParkGate?t=" + ++n) as typeof import("../src/api/ParkGate");

describe("① parkedInterval：停放时真停表，切回补一次并重启", () => {
    test("不停放：按周期照常触发（行为不变）", async () => {
        const { parkedInterval } = await life(); let k = 0; parkedInterval(() => { k++; }, 1000); advance(3500); expect(k).toBe(3);
    });
    test("停放 + 隐藏：队列里 0 个定时器、1 小时 0 次触发、0 次广播（不再调度）", async () => {
        const { parkedInterval } = await life(); let k = 0; parkedInterval(() => { k++; }, 1000); advance(500);
        parkAndHide(); expect(timers.size).toBe(0); advance(3_600_000); expect(k).toBe(0); expect(timers.size).toBe(0);
    });
    test("切回时已到点（长停放）：只补一次（不是 3600 次），并立刻按原周期重启", async () => {
        const { parkedInterval } = await life(); let k = 0; parkedInterval(() => { k++; }, 1000); parkAndHide(); advance(3_600_000);
        showAndUnpark(); expect(k).toBe(1); expect(timers.size).toBe(1); advance(999); expect(k).toBe(1); advance(1); expect(k).toBe(2); advance(5000); expect(k).toBe(7);
    });
    test("切回时还没到点：不补（不白联网），只补足剩余时间再按周期", async () => {
        const { parkedInterval } = await life(); let k = 0; parkedInterval(() => { k++; }, 30000); advance(10000); parkAndHide(); advance(10000); showAndUnpark();
        expect(k).toBe(0); advance(9999); expect(k).toBe(0); advance(1); expect(k).toBe(1); advance(30000); expect(k).toBe(2);
    });
    test("创建时已停放 + 隐藏：不装表；切回时距创建 ≥ 周期才补，之后按周期", async () => {
        const { parkedInterval } = await life(); parkAndHide(); let k = 0; parkedInterval(() => { k++; }, 1000);
        expect(timers.size).toBe(0); advance(5000); expect(k).toBe(0); showAndUnpark(); expect(k).toBe(1); advance(1000); expect(k).toBe(2);
    });
    test("门判据 = 与 ParkGate 相同：停放标记在但文档可见 → 不停；隐藏但没停放（前台最小化）→ 不停", async () => {
        const { parkedInterval } = await life(); let k = 0; parkedInterval(() => { k++; }, 1000);
        doc.documentElement.dataset.inpageParked = "1"; fireDoc("visibilitychange"); advance(1000); expect(k).toBe(1); expect(timers.size).toBe(1);
        delete doc.documentElement.dataset.inpageParked; doc.visibilityState = "hidden"; fireDoc("visibilitychange"); advance(1000); expect(k).toBe(2);
    });
    test("panel.ts 的 idle 消息入口 parkLifeChanged：先标 parked（可见时不停）→ 隐藏（visibilitychange）停 → 撤标记 + parkLifeChanged（文档仍隐藏也算门开）", async () => {
        const { parkedInterval, parkLifeChanged } = await life(); let k = 0; parkedInterval(() => { k++; }, 1000);
        doc.documentElement.dataset.inpageParked = "1"; parkLifeChanged(); expect(timers.size).toBe(1);
        doc.visibilityState = "hidden"; fireDoc("visibilitychange"); expect(timers.size).toBe(0);
        parkLifeChanged(); expect(timers.size).toBe(0); // 没变化：不抖
        delete doc.documentElement.dataset.inpageParked; parkLifeChanged(); expect(timers.size).toBe(1); // idle:false 先到
        expect(k).toBe(0); advance(1000); expect(k).toBe(1);
    });
    test("stop 幂等：停后再停放 / 再切回都不再触发，也不留定时器", async () => {
        const { parkedInterval } = await life(); let k = 0; const stop = parkedInterval(() => { k++; }, 1000); advance(1000); stop(); stop(); expect(timers.size).toBe(0);
        parkAndHide(); showAndUnpark(); advance(10_000); expect(k).toBe(1); expect(timers.size).toBe(0);
    });
    test("fn 抛错不断链（下个周期仍触发）；切回补发时抛错也不影响重启", async () => {
        const { parkedInterval } = await life(); let k = 0; const e = console.error; console.error = () => { };
        try {
            parkedInterval(() => { k++; throw new Error("boom"); }, 1000); advance(2000); expect(k).toBe(2);
            parkAndHide(); advance(5000); showAndUnpark(); expect(k).toBe(3); advance(1000); expect(k).toBe(4);
        } finally { console.error = e; }
    });
    test("不累积：监听只挂一次；100 轮停放 / 切回后定时器数 = 订阅数、visibilitychange 监听数不变", async () => {
        const { parkedInterval } = await life(); for (let i = 0; i < 5; i++) parkedInterval(() => { }, 1000 * (i + 1));
        for (let i = 0; i < 100; i++) { parkAndHide(); expect(timers.size).toBe(0); showAndUnpark(); advance(1); }
        expect(timers.size).toBe(5); expect(visL()).toBe(1);
    });
    test("非 inpage 宿主（原生侧栏 / 弹窗）：普通 setInterval，不挂任何监听，停放标记 / 隐藏都不影响", async () => {
        const { parkedInterval } = await life(); g.location = { search: "" }; let k = 0; const stop = parkedInterval(() => { k++; }, 1000);
        doc.documentElement.dataset.inpageParked = "1"; doc.visibilityState = "hidden"; advance(3000); expect(k).toBe(3); expect(visL()).toBe(0); stop(); expect(timers.size).toBe(0);
    });
});

describe("② whileActive：停放时摘 chrome.* 事件监听，切回重挂并补读", () => {
    const ev = () => { const s = { n: 0, adds: 0, removes: 0 }; return { s, add: () => { s.n++; s.adds++; }, remove: () => { s.n--; s.removes++; } }; };
    test("起始挂一次；停放 + 隐藏 → 摘；切回 → 重挂 + onResume 恰好一次", async () => {
        const { whileActive } = await life(); const e = ev(); let r = 0; whileActive(e.add, e.remove, () => { r++; });
        expect(e.s.n).toBe(1); expect(r).toBe(0); parkAndHide(); expect(e.s.n).toBe(0); showAndUnpark(); expect(e.s.n).toBe(1); expect(r).toBe(1);
    });
    test("重复通知不重复挂 / 摘（parkLifeChanged 多次、visibilitychange 抖动）；挂摘始终成对（n ∈ {0,1}）", async () => {
        const { whileActive, parkLifeChanged } = await life(); const e = ev(); whileActive(e.add, e.remove);
        for (let i = 0; i < 50; i++) { parkAndHide(); parkLifeChanged(); parkLifeChanged(); expect(e.s.n).toBe(0); showAndUnpark(); parkLifeChanged(); expect(e.s.n).toBe(1); }
        expect(e.s.adds).toBe(51); expect(e.s.removes).toBe(50);
    });
    test("创建时已停放：不挂；切回才挂并 onResume", async () => {
        const { whileActive } = await life(); parkAndHide(); const e = ev(); let r = 0; whileActive(e.add, e.remove, () => { r++; });
        expect(e.s.n).toBe(0); showAndUnpark(); expect(e.s.n).toBe(1); expect(r).toBe(1);
    });
    test("stop：挂着就摘、已摘不重复摘；之后切回不再挂", async () => {
        const { whileActive } = await life(); const e = ev(); const stop = whileActive(e.add, e.remove); stop(); stop(); expect(e.s.n).toBe(0); expect(e.s.removes).toBe(1);
        parkAndHide(); showAndUnpark(); expect(e.s.n).toBe(0);
        const e2 = ev(); const stop2 = whileActive(e2.add, e2.remove); parkAndHide(); stop2(); expect(e2.s.removes).toBe(1); showAndUnpark(); expect(e2.s.n).toBe(0);
    });
    test("非 inpage 宿主：直接 attach，不挂监听，stop 才 detach", async () => {
        const { whileActive } = await life(); g.location = { search: "" }; const e = ev(); const stop = whileActive(e.add, e.remove, () => { throw new Error("不该调"); });
        doc.documentElement.dataset.inpageParked = "1"; doc.visibilityState = "hidden"; fireDoc("visibilitychange"); expect(e.s.n).toBe(1); expect(visL()).toBe(0); stop(); expect(e.s.n).toBe(0);
    });
});

describe("③ visibleInterval（页面侧 2.5 s 取色用）：隐藏 = clearInterval，可见 = 重启", () => {
    test("可见时按周期触发；隐藏后队列 0 个定时器 1 小时 0 次；可见后重启（不补发）", async () => {
        const { visibleInterval } = await life(); let k = 0; visibleInterval(() => { k++; }, 2500); advance(5000); expect(k).toBe(2);
        doc.visibilityState = "hidden"; fireDoc("visibilitychange"); expect(timers.size).toBe(0); advance(3_600_000); expect(k).toBe(2);
        doc.visibilityState = "visible"; fireDoc("visibilitychange"); expect(k).toBe(2); expect(timers.size).toBe(1); advance(2500); expect(k).toBe(3);
    });
    test("创建时已隐藏：不装表；重复 visibilitychange 不叠定时器；stop 清定时器 + 摘监听", async () => {
        const { visibleInterval } = await life(); doc.visibilityState = "hidden"; let k = 0; const stop = visibleInterval(() => { k++; }, 2500);
        expect(timers.size).toBe(0); doc.visibilityState = "visible"; for (let i = 0; i < 10; i++) fireDoc("visibilitychange"); expect(timers.size).toBe(1);
        advance(2500); expect(k).toBe(1); stop(); stop(); expect(timers.size).toBe(0); expect(visL()).toBe(0);
    });
    test("不看停放标记（页面侧没有这个概念）：只要文档隐藏就停", async () => {
        const { visibleInterval } = await life(); visibleInterval(() => { }, 2500); doc.visibilityState = "hidden"; fireDoc("visibilitychange"); expect(timers.size).toBe(0);
    });
});

describe("④ 与 ParkGate 并存；不闪 / 不重放 / 不重载", () => {
    test("同一次切回：ParkGate 脏位补一次 + parkedInterval 补一次 + whileActive 重挂一次，互不重复", async () => {
        const gm = await gateMod(); const lf = await life(); const out: string[] = [];
        lf.parkedInterval(() => out.push("tick"), 1000); lf.whileActive(() => out.push("attach"), () => out.push("detach"), () => out.push("resume"));
        out.length = 0; parkAndHide(); advance(10_000); gm.unlessParked("shell.render", () => out.push("render")); gm.unlessParked("shell.render", () => out.push("render"));
        expect(out).toEqual(["detach"]);
        showAndUnpark(); expect(out.filter(x => x === "render").length).toBe(1); expect(out.filter(x => x === "tick").length).toBe(1);
        expect(out.filter(x => x === "attach").length).toBe(1); expect(out.filter(x => x === "resume").length).toBe(1);
        const c = out.length; gm.flushParked(); expect(out.length).toBe(c); // idle:false 兜底 flush 不重放
    });
    test("ParkGate 仍是纯模块（第 17 层断言不被破坏）：新模块是独立文件，ParkGate 无定时器 / 不 import ParkLife", () => {
        const c = code("api/ParkGate.ts"); expect(c).not.toMatch(/setTimeout|setInterval|requestAnimationFrame|ParkLife/);
    });
    test("ParkLife 不碰 DOM / iframe（不删、不改 src、不重载、不 location）：切回零重建", () => {
        const c = code("api/ParkLife.ts");
        expect(c).not.toMatch(/\.remove\(|\.src\b|replaceChildren|innerHTML|appendChild|insertBefore|querySelector|createElement|location\.(reload|href|replace)|iframe/i);
    });
    test("ParkLife 只在需要时挂一个 visibilitychange 监听（模块加载本身零副作用）", async () => {
        const lf = await life(); expect(visL()).toBe(0); lf.parkedInterval(() => { }, 1000); lf.whileActive(() => { }, () => { }); expect(visL()).toBe(1);
    });
    test("切回首帧：门开那一拍同步完成（定时器补发 / 重挂都在 visibilitychange 同步栈里，不排 setTimeout 0 / rAF 之后）", async () => {
        const lf = await life(); let k = 0; let attached = 0; lf.parkedInterval(() => { k++; }, 1000); lf.whileActive(() => { attached++; }, () => { attached--; });
        parkAndHide(); advance(5000); showAndUnpark(); expect(k).toBe(1); expect(attached).toBe(1); // 没有 advance：同步完成
        expect(code("api/ParkLife.ts")).not.toMatch(/requestAnimationFrame|queueMicrotask|setTimeout\([^,]*,\s*0\)/);
    });
});

describe("⑤ 接线（源码断言）", () => {
    test("panel.ts：idle 消息处理末尾调 parkLifeChanged（撤标记后）", () => {
        const c = code("plugins/inpageSidebar/panel.ts");
        expect(c).toMatch(/import \{ parkLifeChanged \} from "@api\/ParkLife";/);
        expect(c).toMatch(/else \{ delete root\.dataset\.inpageParked; flushParked\(\); \} parkLifeChanged\(\);/);
    });
    test("liveCalendar / liveFolders / libraryView：无 setInterval，全走 parkedInterval；停止函数接进清理", () => {
        for (const f of ["plugins/library/liveCalendar/index.ts", "plugins/tabs/liveFolders/index.ts", "plugins/library/libraryView/index.ts"]) {
            const c = code(f); expect(c).not.toMatch(/setInterval\(|clearInterval\(/); expect(c).toMatch(/parkedInterval/);
        }
        const lv = code("plugins/library/libraryView/index.ts");
        expect(lv).toMatch(/let timer: \(\(\) => void\) \| undefined;/); expect(lv).toMatch(/if \(!active\.length && timer\) \{ timer\(\); timer = undefined; \}/);
        expect(lv).toMatch(/return t;\n\}/);
        expect(code("plugins/tabs/liveFolders/index.ts")).toMatch(/return \[t, addSection\("pinned", "LiveFolders"/);
    });
    // 第 18b 层（inpage-parked-timers-stop-b）：下载事件监听停放时不再摘（切回首帧托盘行必须在）；接线断言见 inpageParkedTimersB.test.ts
    test("libraryView 下载事件（18b）：onCreated / onChanged 直接 poll 并保持挂着，清理时才摘；onDlDone（完成角标，罕见事件）不动", () => {
        const c = code("plugins/library/libraryView/index.ts");
        expect(c).toMatch(/chrome\.downloads\.onCreated\.addListener\(onEv\);\s*chrome\.downloads\.onChanged\.addListener\(onEv\);/);
        expect(c).toMatch(/\(\) => \{ chrome\.downloads\.onCreated\.removeListener\(onEv\); chrome\.downloads\.onChanged\.removeListener\(onEv\); if \(timer\) timer\(\); timer = undefined; \}/);
        expect(c).toMatch(/chrome\.downloads\.onChanged\.addListener\(onDlDone\)/);
    });
    test("tabState：8 个 tabs 事件监听走 whileActive；onVisible 切回 reload 与 schedule 的停放守卫（第 16 层）都还在；stop 清理", () => {
        const c = code("plugins/_core/tabState/index.ts");
        expect(c).toMatch(/offLife = whileActive\(\(\) => \{ for \(const e of evs\(\)\) e\.addListener\(schedule\); \}, \(\) => \{ for \(const e of evs\(\)\) e\.removeListener\(schedule\); \}\);/);
        expect(c).toMatch(/const schedule = debounce\(\(\) => \{ if \(isParkedHost\(\)\) return; void reload\(\); \}, 40\);/);
        expect(c).toMatch(/const onVisible = \(\) => \{ if \(document\.visibilityState === "visible"\) void reload\(\); \};/);
        expect(c).toMatch(/stop\(\) \{ offLife\?\.\(\); offLife = undefined;/);
    });
    test("media（18b）：tabs.onUpdated / onRemoved 停放时保持挂着，走 parkFilter 过滤；签名没变（停放重读）不 refresh；清理时才摘", () => {
        const c = code("plugins/library/media/index.ts");
        expect(c).toMatch(/const schedule = debounce\(\(\) => void reload\(parkClosed\(\)\), 100\);/);
        expect(c).toMatch(/if \(!\(onlyIfChanged && same\)\) refresh\(\);/); expect(c).toMatch(/const sigOf = \(\) => JSON\.stringify\(\[media, meets, \[\.\.\.paused\], \[\.\.\.meetState\], \[\.\.\.dismissed\]\]\);/);
        expect(c).not.toMatch(/whileActive|unlessParked/);
    });
    test("adaptive 页面侧：soon 隐藏时只记脏位；可见时有脏位 → 立刻 send（不等 120 ms 去抖），否则 soon；2.5 s 走 visibleInterval；清理调停止函数", () => {
        const c = code("plugins/adaptive/index.ts");
        expect(c).toMatch(/const soon = \(\) => \{ if \(document\.visibilityState === "hidden"\) \{ dirty = true; return; \} clearTimeout\(t\); t = setTimeout\(send, 120\); \};/);
        expect(c).toMatch(/const vis = \(\) => \{ if \(document\.visibilityState === "visible"\) \{ last = ""; if \(dirty\) \{ dirty = false; clearTimeout\(t\); send\(\); \} else soon\(\); \} \};/);
        expect(c).toMatch(/const iv = visibleInterval\(soon, 2500\);/); expect(c).toMatch(/iv\(\); clearTimeout\(t\);/); expect(c).not.toMatch(/setInterval\(/);
    });
    test("adaptive 面板端：监听走 whileActive，onResume = resync（重查活动标签 + 读 storage.session 缓存色先涂），onAct / onSess 的 unlessParked 仍在；清理调 offLife", () => {
        const c = code("plugins/adaptive/index.ts");
        expect(c).toMatch(/const resync = \(\) => void safe\(currentWindowId\(\)\.then\(wid => chrome\.tabs\.query\(\{ active: true, windowId: wid \}\)\)\.then\(\(\[t\]\) => \{ tabId = t\?\.id; void refreshPaint\(\); \}\), "tabs\.query"\);/);
        expect(c).toMatch(/const offLife = whileActive\(\(\) => \{ chrome\.tabs\.onActivated\.addListener\(onAct\); chrome\.storage\.session\.onChanged\.addListener\(onSess\); \}, \(\) => \{ chrome\.tabs\.onActivated\.removeListener\(onAct\); chrome\.storage\.session\.onChanged\.removeListener\(onSess\); \}, resync\);/);
        expect(c).toMatch(/const v = \(await chrome\.storage\.session\.get\(KEY\(tabId\)\)\)\[KEY\(tabId\)\]/); // 读缓存色
        expect(c).toMatch(/return \(\) => \{ offLife\(\); unsub\(\); paint\(\); \};/);
        expect(c).toMatch(/unlessParked\("adaptive\.paint"/);
    });
});

describe("⑥ SW pushRec 去重 + 与第 14 / 15 层、restoreOnClose 不冲突", () => {
    const msg = (o: Record<string, unknown> = {}) => ({ type: "inpage:state", windowId: 1, tabId: 2, active: true, show: true, nativeOpen: false, prewarm: false, warm: false, width: 300, displayMode: "push", hover: false, handle: true, ...o });
    test("nextPushKey：没发过 → 发；同状态 → null；任何字段变了 → 发；force 永远发", async () => {
        const { nextPushKey } = await dedupMod();
        const k0 = nextPushKey(undefined, msg(), false); expect(k0).toBeString();
        expect(nextPushKey(k0!, msg(), false)).toBeNull();
        for (const ch of [{ active: false }, { show: false }, { width: 301 }, { nativeOpen: true }, { displayMode: "overlay" }, { hover: true }, { handle: false }, { prewarm: true }, { trace: true }, { hint: "switch-failed" }])
            expect(nextPushKey(k0!, msg(ch), false)).not.toBeNull();
        expect(nextPushKey(k0!, msg(), true)).toBe(k0);
    });
    test("状态变了照发、变回去也照发（A→B→A 不被误去重，切回首帧的新状态不延后）", async () => {
        const { nextPushKey } = await dedupMod();
        let sent: string | undefined; const out: number[] = [];
        const push = (w: number) => { const k = nextPushKey(sent, msg({ width: w }), false); if (k != null) { sent = k; out.push(w); } };
        push(300); push(300); push(400); push(400); push(300); expect(out).toEqual([300, 400, 300]);
    });
    test("pushRec 接线：memReady 闸在去重之前（第 15 层），lastActive 照记，发成功才记 sentKey，跳过有 trace", () => {
        const c = code("plugins/inpageSidebar/background.ts");
        expect(c).toMatch(/const pushRec = \(rec: TabRec, hint\?: StateMsg\["hint"\], force\?: boolean\) => \{/);
        const i0 = c.indexOf("const pushRec"); const body = c.slice(i0, c.indexOf("const syncBadge", i0));
        expect(body.indexOf("if (!rec.port || (!memReady && !hint)) return;")).toBeGreaterThan(0);
        expect(body.indexOf("!memReady")).toBeLessThan(body.indexOf("nextPushKey"));
        expect(body.indexOf("lastActive.set(rec.tabId, s.active)")).toBeLessThan(body.indexOf("nextPushKey"));
        expect(body).toMatch(/nextPushKey\(rec\.sentKey, s, !!hint \|\| !!force\)/);
        expect(body).toMatch(/trace\("pushRec\.skip"/);
        expect(body).toMatch(/try \{ rec\.port\.postMessage\(s\); rec\.sentKey = key;\s*\}/);
        expect(body.indexOf("postMessage")).toBeLessThan(body.indexOf("rec.sentKey = key"));
    });
    test("hello 的回复强制发（内容脚本在等应答）；onUpdated / onActivated（第 14 层）的 pushRec 调用不带 force", () => {
        const c = code("plugins/inpageSidebar/background.ts");
        expect(c).toMatch(/pushRec\(rec, undefined, true\); syncBadge\(rec\.windowId\);/);
        expect(c.match(/pushRec\([^)]*true\)/g)?.length).toBe(1);
        expect(c).toMatch(/planActivation/);
    });
    test("sentKey 只出现在 TabRec 定义与 pushRec 里；每个连接新建 rec（端口换了去重自动清空）；restoreOnClose / prewarmOpened 路径不引用它", () => {
        const c = code("plugins/inpageSidebar/background.ts");
        const lines = c.split("\n").filter(l => l.includes("sentKey")); expect(lines.length).toBe(3);
        expect(lines.some(l => l.includes("interface TabRec"))).toBe(true);
        expect(c).toMatch(/const rec: TabRec = \{ tabId: tab\.id, windowId: tab\.windowId, url: tab\.url, port, hostAlive: false, blocked: false \};/); // 每个连接新 rec，没有 sentKey
        for (const f of ["plugins/inpageSidebar/prewarmOpened.ts", "plugins/inpageSidebar/tabSwitch.ts"]) expect(code(f)).not.toMatch(/sentKey|pushDedup|ParkLife/);
        expect(c).toMatch(/RestoreOnClose/);
    });
    test("syncBadge 没有被去重（导航会重置徽标，必须每次下发）；SW 没有 setInterval（心跳只服务原生面板端口，与停放 iframe 无关）", () => {
        const c = code("plugins/inpageSidebar/background.ts");
        const s = c.slice(c.indexOf("const syncBadge"), c.indexOf("const syncBadge") + 400); expect(s).not.toMatch(/sentKey|nextPushKey/);
        expect(code("plugins/inpageSidebar/pushDedup.ts")).not.toMatch(/setTimeout|setInterval|document|chrome\./);
    });
});

/* 补丁 inpage-parked-timers-stop-b（rel55 第 18b 层，叠在第 18 层之后）：托盘 / 媒体切回「第 0 帧就在」。
 * 背景（r56e 实测）：第 18 层停放时摘掉了 media 的 tabs.onUpdated / onRemoved 与 libraryView 下载托盘的 downloads.onCreated / onChanged，
 *   停放期间才出现的媒体行 / 下载托盘行要等切回后的异步重读（tabs.query + executeScript 探测 / downloads.search），前 4 帧（0–3）为空，第 4 帧才出现。DOM 并没有被丢弃（停放时不碰 DOM），只是「新内容的数据」那时还不存在。
 * 18b：这两处监听停放时保持挂着（回到 17 层的「数据照常更新」），但
 *   · 媒体：只对「会改变托盘内容」的事件重读（parkFilter：url 变化只在新网址是 Meet 或标签已在托盘里时相关；关闭只在已在托盘里时相关；audible / mutedInfo 永远相关），停放时的重读签名没变就不 refresh；
 *   · 下载托盘：事件直接 poll（onChanged 不含 bytesReceived / estimatedEndTime，只在状态变化时触发），每秒进度轮询仍由 parkedInterval 停表；
 *   · 渲染仍由 ParkGate 的 shell.render 脏位推迟，切回在 visibilitychange 同步栈里补一次渲染（第 0 帧）。
 * 另：PanelShell 的 windows.onFocusChanged 停放时不再 flog（每次 = setTimeout + storage.local 读改写，N 个 iframe 同写一个 key）。
 * 这里只证明接线 / 判据 / 同步补渲染的契约；真实首帧要真浏览器（r56f-*）。 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SRC = resolve(import.meta.dir, "../src");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const code = (f: string) => strip(readFileSync(resolve(SRC, f), "utf8"));

type L = (...a: unknown[]) => void;
const g = globalThis as unknown as Record<string, unknown>;
const saved = { document: g.document, location: g.location };
let docListeners: Array<{ type: string; fn: L }>; let doc: { visibilityState: string; documentElement: { dataset: Record<string, string> }; addEventListener(t: string, f: L): void; removeEventListener(t: string, f: L): void };
const fireDoc = (type: string) => { for (const l of Array.from(docListeners)) if (l.type === type) l.fn(); };
beforeEach(() => {
    docListeners = [];
    doc = {
        visibilityState: "visible", documentElement: { dataset: {} },
        addEventListener: (type, fn) => { docListeners.push({ type, fn }); },
        removeEventListener: (type, fn) => { const i = docListeners.findIndex(l => l.type === type && l.fn === fn); if (i >= 0) docListeners.splice(i, 1); },
    };
    g.document = doc; g.location = { search: "?host=inpage&win=1&tab=2" };
});
afterEach(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete g[k]; else g[k] = v; } });
const parkAndHide = () => { doc.documentElement.dataset.inpageParked = "1"; doc.visibilityState = "hidden"; fireDoc("visibilitychange"); };
const showAndUnpark = () => { delete doc.documentElement.dataset.inpageParked; doc.visibilityState = "visible"; fireDoc("visibilitychange"); };
let n = 0;
const filt = async () => await import("../src/plugins/library/media/parkFilter") as typeof import("../src/plugins/library/media/parkFilter");
const life = async () => await import("../src/api/ParkLife?t=" + ++n) as typeof import("../src/api/ParkLife");
const gateMod = async () => await import("../src/api/ParkGate?t=" + ++n) as typeof import("../src/api/ParkGate");

describe("① parkFilter：停放时哪些 tabs.onUpdated / onRemoved 值得重读（纯函数）", () => {
    const none = new Set<number>(); const tracked = new Set([7]);
    test("未停放：与原行为逐字一致（任何 url / audible / mutedInfo 变化都重读；其它键不重读）", async () => {
        const { updateMatters } = await filt();
        const orig = (c: Record<string, unknown>) => "url" in c || "audible" in c || "mutedInfo" in c; // 18 / 17 层 onUpdated 的判据
        const cases: Array<Record<string, unknown>> = [{}, { url: "https://a.com/" }, { audible: true }, { audible: false }, { mutedInfo: { muted: true } }, { title: "t" }, { status: "loading" }, { favIconUrl: "x" }, { url: "https://a.com/", title: "t" }, { pinned: true }];
        for (const c of cases) expect(updateMatters(3, c, none, false)).toBe(orig(c));
    });
    test("停放：audible / mutedInfo 变化永远相关（媒体行的出现 / 消失）", async () => {
        const { updateMatters } = await filt();
        expect(updateMatters(3, { audible: true }, none, true)).toBe(true); expect(updateMatters(3, { audible: false }, none, true)).toBe(true); expect(updateMatters(3, { mutedInfo: { muted: true } }, none, true)).toBe(true);
    });
    test("停放：url 变化只在「标签已在托盘里」或「新网址是 Meet 通话」时相关；其余标签换网址与托盘无关", async () => {
        const { updateMatters } = await filt();
        expect(updateMatters(3, { url: "https://news.example/a" }, none, true)).toBe(false);
        expect(updateMatters(7, { url: "https://news.example/a" }, tracked, true)).toBe(true);
        expect(updateMatters(3, { url: "https://meet.google.com/abc-defg-hij" }, none, true)).toBe(true);
        expect(updateMatters(3, { url: "https://meet.google.com/landing" }, none, true)).toBe(false);
    });
    test("停放：title / status / favIconUrl / pinned 等与托盘行集合无关的键不重读（原来就不重读）", async () => {
        const { updateMatters } = await filt();
        for (const c of [{ title: "t" }, { status: "complete" }, { favIconUrl: "x" }, { pinned: true }, {}] as Array<Record<string, unknown>>) expect(updateMatters(7, c, tracked, true)).toBe(false);
    });
    test("tabs.onRemoved：未停放一律重读（原行为）；停放只在已在托盘里的标签关闭时重读", async () => {
        const { removalMatters } = await filt();
        expect(removalMatters(3, none, false)).toBe(true); expect(removalMatters(7, tracked, false)).toBe(true);
        expect(removalMatters(3, none, true)).toBe(false); expect(removalMatters(7, tracked, true)).toBe(true);
    });
    test("MEET_RE 与原 reload 里的正则一致（同一份，不会漂移）", async () => {
        const { MEET_RE } = await filt(); const c = code("plugins/library/media/index.ts");
        expect(c).toMatch(/meets = tabs\.filter\(t => MEET_RE\.test\(t\.url \?\? ""\)\);/);
        expect(MEET_RE.test("https://meet.google.com/abc-defg-hij?x=1")).toBe(true); expect(MEET_RE.test("http://meet.google.com/abc-defg-hij")).toBe(false);
        expect(code("plugins/library/media/parkFilter.ts")).not.toMatch(/import |setTimeout|setInterval|chrome\./);
    });
});

describe("② 契约：停放期间数据照常更新，渲染只记脏位，切回同一拍同步补渲染（第 0 帧）", () => {
    test("事件在停放时到达 → 数据立刻更新（不推迟）；渲染被 ParkGate 推迟；切回在 visibilitychange 同步栈里渲染一次且看到最新数据", async () => {
        const gm = await gateMod(); await life();
        let rows: string[] = []; const painted: string[][] = [];
        const render = () => { painted.push([...rows]); };
        parkAndHide();
        rows = ["MEDIA-new"]; gm.unlessParked("shell.render", render); // 停放时：数据已更新；渲染只记脏位
        expect(painted.length).toBe(0);
        showAndUnpark(); // 切回：这一次 fireDoc 之后（同步）渲染已完成
        expect(painted).toEqual([["MEDIA-new"]]);
        gm.flushParked(); expect(painted.length).toBe(1); // idle:false 兜底 flush 不重放
    });
    test("没有变化（停放期间无事件）：切回不渲染（第 18b 层的签名守卫：停放重读签名没变不 refresh → 不记脏位）", async () => {
        const gm = await gateMod(); let painted = 0; parkAndHide(); showAndUnpark(); gm.flushParked(); expect(painted).toBe(0);
        const c = code("plugins/library/media/index.ts");
        expect(c).toMatch(/const sig = sigOf\(\), same = sig === shownSig; shownSig = sig;\s*if \(!\(onlyIfChanged && same\)\) refresh\(\);/);
    });
    test("ParkLife.parkClosed：与门同一判据（停放且隐藏）；只读，不订阅、不排定时器", async () => {
        const lf = await life();
        expect(lf.parkClosed()).toBe(false); parkAndHide(); expect(lf.parkClosed()).toBe(true); showAndUnpark(); expect(lf.parkClosed()).toBe(false);
        doc.visibilityState = "hidden"; expect(lf.parkClosed()).toBe(false); // 只隐藏没停放（窗口最小化等）：不算
        const src = code("api/ParkLife.ts"); expect(src).toMatch(/export const parkClosed = \(\): boolean => closedNow\(\);/);
    });
    test("ParkLife 仍不碰 DOM / iframe、ParkGate 仍是纯模块（第 17 / 18 层断言不被破坏）", () => {
        expect(code("api/ParkLife.ts")).not.toMatch(/\.remove\(|\.src\b|replaceChildren|innerHTML|appendChild|insertBefore|querySelector|createElement|location\.(reload|href|replace)|iframe/i);
        expect(code("api/ParkGate.ts")).not.toMatch(/setTimeout|setInterval|requestAnimationFrame|ParkLife/);
    });
});

describe("③ 接线（comment-stripped 源码断言）", () => {
    test("media：监听停放时保持挂着（无 whileActive / unlessParked），onUpdated / onRemoved 走 parkFilter，清理时才摘", () => {
        const c = code("plugins/library/media/index.ts");
        expect(c).not.toMatch(/whileActive|unlessParked|ParkGate/);
        expect(c).toMatch(/import \{ parkClosed \} from "@api\/ParkLife";/);
        expect(c).toMatch(/chrome\.tabs\.onUpdated\.addListener\(onUpdated\);\s*chrome\.tabs\.onRemoved\.addListener\(onRemoved\);/);
        expect(c).toMatch(/\(\) => \{ chrome\.tabs\.onUpdated\.removeListener\(onUpdated\); chrome\.tabs\.onRemoved\.removeListener\(onRemoved\); \}/);
        expect(c).toMatch(/if \(c\.audible === false\) dismissed\.delete\(id\);\s*if \(updateMatters\(id, c, trackedIds\(\), parkClosed\(\)\)\) schedule\(\);/);
        expect(c).toMatch(/const onRemoved = \(id: number\) => \{ if \(removalMatters\(id, trackedIds\(\), parkClosed\(\)\)\) schedule\(\); \};/);
        expect(c).toMatch(/const schedule = debounce\(\(\) => void reload\(parkClosed\(\)\), 100\);/);
        expect(c).toMatch(/const trackedIds = \(\): ReadonlySet<number> => new Set\(\[\.\.\.media, \.\.\.meets\]\.map\(t => t\.id!\)\);/);
    });
    test("media：dismissed.delete 对停放照样执行（不被过滤吞掉）；reload 先取数再赋值，没有先清空 media / meets 的步骤（DOM 内容在新数据到之前保持）", () => {
        const c = code("plugins/library/media/index.ts");
        expect(c).toMatch(/if \(c\.audible === false\) dismissed\.delete\(id\);/);
        const r = c.slice(c.indexOf("async function reload"), c.indexOf("const trackedIds"));
        expect(r).not.toMatch(/media = \[\]|meets = \[\]|replaceChildren|innerHTML/);
        expect(r.indexOf("await chrome.tabs.query")).toBeLessThan(r.indexOf("meets ="));
    });
    test("libraryView 下载托盘：事件监听停放时也挂着，事件直接 poll；清理时才摘；进度轮询仍是 parkedInterval", () => {
        const c = code("plugins/library/libraryView/index.ts");
        expect(c).not.toMatch(/whileActive|unlessParked|ParkGate/);
        expect(c).toMatch(/const onEv = \(\) => void poll\(\);\s*chrome\.downloads\.onCreated\.addListener\(onEv\);\s*chrome\.downloads\.onChanged\.addListener\(onEv\);/);
        expect(c).toMatch(/\(\) => \{ chrome\.downloads\.onCreated\.removeListener\(onEv\); chrome\.downloads\.onChanged\.removeListener\(onEv\); if \(timer\) timer\(\); timer = undefined; \}/);
        expect(c).toMatch(/timer = parkedInterval\(\(\) => void poll\(\), 1000\)/); expect(c).toMatch(/parkedInterval\(\(\) => void draw\(\), 2000\)/);
        expect(c).toMatch(/chrome\.downloads\.onChanged\.addListener\(onDlDone\)/);
    });
    test("whileActive 只剩 tabState 与 adaptive（面板端）两处使用；其余 18 层接线不变", () => {
        const files = ["api/PanelShell.ts", "plugins/library/liveCalendar/index.ts", "plugins/tabs/liveFolders/index.ts", "plugins/library/libraryView/index.ts", "plugins/library/media/index.ts", "plugins/_core/tabState/index.ts", "plugins/adaptive/index.ts"];
        const users = files.filter(f => /\bwhileActive\(/.test(code(f))).toSorted();
        expect(users).toEqual(["plugins/_core/tabState/index.ts", "plugins/adaptive/index.ts"]);
    });
    test("PanelShell：窗口焦点变化监听里，停放（且隐藏）先 return，再 flog / dismiss", () => {
        const c = code("api/PanelShell.ts");
        expect(c).toMatch(/import \{ parkClosed \} from "@api\/ParkLife";/);
        expect(c).toMatch(/chrome\.windows\.onFocusChanged\.addListener\(w => \{\s*if \(parkClosed\(\)\) return;\s*flog\(where, `onFocusChanged \$\{w\} \(mine \$\{me\.id\}\)`\);/);
    });
    test("切回时不动 DOM：panel.ts 的 idle 消息处理里没有清空 / 重置 / 摘除（只写 data-inpage-parked 与调 flush / parkLifeChanged）", () => {
        const c = code("plugins/inpageSidebar/panel.ts"); const a = c.indexOf("const onIdle ="), b = c.indexOf('window.addEventListener("message", onIdle)');
        expect(a).toBeGreaterThan(0); expect(b).toBeGreaterThan(a);
        expect(c.slice(a, b)).not.toMatch(/replaceChildren|innerHTML|\.remove\(|\.src\b|\.append\(|location\./);
    });
});

describe("④ 与 14 / 15 / 16 / 17 / 18 层及 restoreOnClose 不冲突", () => {
    test("SW 侧（background.ts）18b 不动：pushRec 去重 / memReady 闸 / lastActive 仍是 18 的形态", () => {
        const c = code("plugins/inpageSidebar/background.ts");
        expect(c).toMatch(/nextPushKey\(rec\.sentKey, s, !!hint \|\| !!force\)/); expect(c).toMatch(/pushRec\(rec, undefined, true\)/);
        expect(c).not.toMatch(/parkClosed|ParkLife|parkFilter/);
    });
    test("tabState（16 层）/ adaptive 面板端 / liveCalendar / liveFolders 的 18 层接线保持", () => {
        expect(code("plugins/_core/tabState/index.ts")).toMatch(/offLife = whileActive\(\(\) => \{ for \(const e of evs\(\)\) e\.addListener\(schedule\); \}/);
        expect(code("plugins/adaptive/index.ts")).toMatch(/const offLife = whileActive\(/);
        expect(code("plugins/library/liveCalendar/index.ts")).toMatch(/parkedInterval\(refresh, 30000\)/);
        expect(code("plugins/tabs/liveFolders/index.ts")).toMatch(/parkedInterval\(\(\) => void load\(\), 10 \* 60000\)/);
    });
    test("没有新增定时器 / 轮询：parkFilter 与 media / libraryView 里的 18b 改动不引入 setInterval；PanelShell 的新分支是 return", () => {
        for (const f of ["plugins/library/media/parkFilter.ts", "plugins/library/media/index.ts", "plugins/library/libraryView/index.ts"]) expect(code(f)).not.toMatch(/setInterval\(/);
    });
});

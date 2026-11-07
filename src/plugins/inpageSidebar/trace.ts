/* 页内侧边栏：调试追踪（补丁 inpage-debug-trace；**默认关**，关着时零副作用）。
 * 目的：真机上「⌘R 重载中途出现带 Cat 📌 × 头的面板」这类时序问题，只靠静态推演分不清是原生面板还是页内壳；开了它就能把 prewarm → openNativeForWindow → nativeChanged → pushWindow(show) →
 *   页内 iframe 建 / 毁 / 可见 → restoreOnClose 的先后和时间戳记下来，事后导出。
 * 开关（任一）：① chrome.storage.local["debug:inpageTrace"] === true（SW 起来时读一次 + storage.onChanged 即时生效；SW 随后经状态消息的 trace:true 告诉内容脚本，内容脚本自己不读 storage、不多一次 IPC）；
 *   ② globalThis.__arcInpageTrace = true（当前 JS 环境；SW / 内容脚本隔离世界各自设）。
 * 关着时：trace() 第一行就返回；不建环形缓冲、不挂全局函数、不碰 chrome.storage.session、不打控制台、不加事件监听（onTraceEnabled 的回调只在开着时才执行）。调用点一律写成 `traceOn() && trace(...)`，关着时连参数对象都不构造。
 * 开着时：环形缓冲 TRACE_MAX 条（{n, t = Date.now(), p = performance.now(), src, ev, d}）+ console.debug("[arc-trace]")；SW 把整个缓冲节流（TRACE_FLUSH_MS）写进 chrome.storage.session["debug:inpageTrace:log"]（SW 被回收后还在）；
 *   内容脚本把每条经 inpage:host 端口发给 SW（src = cs:<tabId>），所以页面重载 / 卸载前的记录也在 SW 的缓冲里。导出：globalThis.__arcInpageTraceDump() / __arcInpageTraceText() / __arcInpageTraceClear()，或读 storage.session 那个键。
 * 约束：不 import chrome 类型以外的东西；SW 里没有 window / document（tests/swNoDom），所以只用 globalThis。 */

export const TRACE_KEY = "debug:inpageTrace";
export const TRACE_FLAG = "__arcInpageTrace";
export const TRACE_LOG_KEY = "debug:inpageTrace:log";
export const TRACE_MAX = 600;
export const TRACE_FLUSH_MS = 300;
export const TRACE_MSG = "inpage:trace";

export interface TraceRec { n: number; t: number; p: number; src: string; ev: string; d?: unknown }

let fromSwitch = false; // storage 键 / SW 状态消息
let buf: TraceRec[] = [];
let seq = 0;
let sink: ((r: TraceRec) => void) | undefined;
let pending: TraceRec[] = []; // 还没有 sink（内容脚本端口没连上）时先存着，sink 装上后一次发出
let flushTimer: ReturnType<typeof setTimeout> | undefined;
let persist = false; // SW：写 storage.session
let srcName = "ctx";
let installed = false;
const onEnable: Array<() => void> = [];

const g = globalThis as Record<string, unknown>;
export const traceOn = (): boolean => fromSwitch || g[TRACE_FLAG] === true;

const now = (): number => (typeof performance !== "undefined" ? performance.now() : 0);
function ensureGlobals() {
    if (installed) return; installed = true;
    g.__arcInpageTraceDump = () => traceDump();
    g.__arcInpageTraceText = () => traceText(traceDump());
    g.__arcInpageTraceClear = () => { buf = []; pending = []; seq = 0; schedule(); };
    for (const f of onEnable) { try { f(); } catch { /* 调试回调失败不影响功能 */ } }
}
function schedule() {
    if (!persist || flushTimer) return;
    flushTimer = setTimeout(() => {
        flushTimer = undefined;
        try { void Promise.resolve((globalThis as { chrome?: typeof chrome }).chrome?.storage?.session?.set({ [TRACE_LOG_KEY]: buf })).catch(() => undefined); } catch { /* 无 session 存储 */ }
    }, TRACE_FLUSH_MS);
}
function push(r: TraceRec) {
    buf.push(r); if (buf.length > TRACE_MAX) buf.splice(0, buf.length - TRACE_MAX);
    try { console.debug("[arc-trace]", r.src, r.ev, r.d ?? ""); } catch { /* 无控制台 */ }
    schedule();
}

/** 记一条。关着 = 第一行返回（调用点用 traceOn() && trace(...) 连参数都不构造）。 */
export function trace(ev: string, d?: unknown): void {
    if (!traceOn()) return;
    ensureGlobals();
    const r: TraceRec = { n: ++seq, t: Date.now(), p: Math.round(now() * 10) / 10, src: srcName, ev, ...(d === undefined ? {} : { d }) };
    push(r);
    if (sink) { try { sink(r); } catch { /* 端口已断 */ } } else if (pending.length < TRACE_MAX) pending.push(r);
}
/** SW 收到内容脚本转来的记录：并入缓冲（带 tabId 标签）；SW 自己没开就丢掉 */
export function traceFromHost(r: unknown, tabId: number): void {
    if (!traceOn()) return;
    const o = r as Partial<TraceRec> | null;
    if (!o || typeof o.ev !== "string" || typeof o.t !== "number") return;
    ensureGlobals();
    push({ n: ++seq, t: o.t, p: typeof o.p === "number" ? o.p : 0, src: `cs:${tabId}`, ev: o.ev, ...(o.d === undefined ? {} : { d: o.d }) });
}
/** 开关来源之一：storage 键 / 状态消息（true = 开）。变成开的那一刻补跑 onTraceEnabled 回调 */
export function setTraceSwitch(v: boolean): void {
    const was = traceOn(); fromSwitch = !!v;
    if (!was && traceOn()) ensureGlobals();
}
/** 当前 JS 环境的名字（"sw" / "cs"）、是否写 storage.session（SW） */
export function traceConfigure(o: { src: string; persist?: boolean }): void { srcName = o.src; persist = !!o.persist; }
/** 装 / 撤 sink（内容脚本：端口发出）；装上时把没发出去的记录补发 */
export function setTraceSink(fn: ((r: TraceRec) => void) | undefined): void {
    sink = fn;
    if (fn && pending.length) { const p = pending; pending = []; for (const r of p) { try { fn(r); } catch { break; } } }
}
/** 回调只在追踪开着时执行（已经开着 = 立刻；之后才开 = 开的那一刻）；用来挂「只为追踪才需要」的事件监听，关着时零监听 */
export function onTraceEnabled(fn: () => void): void {
    onEnable.push(fn);
    if (!traceOn()) return;
    if (installed) { try { fn(); } catch { /* 调试回调失败不影响功能 */ } } else ensureGlobals();
}

export const traceDump = (): TraceRec[] => buf.slice().sort((a, b) => a.t - b.t || a.n - b.n);
export function traceText(recs: readonly TraceRec[]): string {
    const t0 = recs[0]?.t ?? 0;
    return recs.map(r => `${new Date(r.t).toISOString().slice(11, 23)} +${String(r.t - t0).padStart(5)}ms ${r.src.padEnd(7)} ${r.ev}${r.d === undefined ? "" : " " + JSON.stringify(r.d)}`).join("\n");
}
/** 测试用：回到出厂状态 */
export function traceReset(): void {
    fromSwitch = false; buf = []; pending = []; seq = 0; sink = undefined; if (flushTimer) clearTimeout(flushTimer); flushTimer = undefined; persist = false; srcName = "ctx"; onEnable.length = 0;
    if (installed) { delete g.__arcInpageTraceDump; delete g.__arcInpageTraceText; delete g.__arcInpageTraceClear; installed = false; }
}

/** 带追踪的 Set（只重写 add / delete）：restoreOnClose / pendingWin / prewarmOpened 的每次改动都进追踪，不用改调用点（现有正则测试依赖那些源码行）。关着时的额外开销 = 一次 traceOn() */
export class TracedSet extends Set<number> {
    constructor(private readonly label: string) { super(); }
    override add(v: number): this { const had = this.has(v); super.add(v); if (traceOn()) trace(`${this.label}.add`, { w: v, had }); return this; }
    override delete(v: number): boolean { const r = super.delete(v); if (r && traceOn()) trace(`${this.label}.delete`, { w: v }); return r; }
    override clear(): void { const n = this.size; super.clear(); if (n && traceOn()) trace(`${this.label}.clear`, { n }); }
}

/** 调试追踪开关（storage 键 debug:inpageTrace === true）：起来时读一次 + onChanged 即时生效；开 / 关变化时重推状态（状态里的 trace:true 让内容脚本跟着开）。关着时只有这一次读 + 一个 onChanged 监听。 */
export function startTraceSwitch(onChange: () => void): () => void {
    traceConfigure({ src: "sw", persist: true });
    const st = (globalThis as { chrome?: typeof chrome }).chrome?.storage;
    try { void Promise.resolve(st?.local?.get?.(TRACE_KEY)).then(r => { if ((r as Record<string, unknown> | undefined)?.[TRACE_KEY] === true) { setTraceSwitch(true); trace("trace.on", { via: "storage" }); onChange(); } }).catch(() => undefined); } catch { /* 无 storage */ }
    const l = (ch: Record<string, chrome.storage.StorageChange>, area: string) => {
        if (area !== "local" || !(TRACE_KEY in ch)) return;
        const v = ch[TRACE_KEY]!.newValue === true; setTraceSwitch(v); if (v) trace("trace.on", { via: "onChanged" }); onChange();
    };
    try { st?.onChanged?.addListener?.(l); } catch { /* 无 onChanged */ }
    return () => { try { st?.onChanged?.removeListener?.(l); } catch { /* 无 onChanged */ } };
}

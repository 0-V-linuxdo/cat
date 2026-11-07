/* 时钟跳变 / 进程冻结检测（rel45）——harness（Bun）与自测页（Chrome）共用的纯逻辑，不依赖 DOM / chrome / Bun API。
 *
 * 背景：box 会被 VM 快照 / 恢复（dmesg “virtual machine fork”），冻结期间进程不跑，恢复后 wall-clock（Date.now）可能一次跳几分钟，
 * 单调时钟（performance.now / hrtime）要么没走（冻结）、要么一次补上。凡是靠 setTimeout / Date.now 差判超时的地方都可能因此“随机超时 / 卡死 120s”，
 * 而且每次是不同的步骤（rel44 三轮各一个、都没有断言失败）。
 *
 * 做法：
 *  1. 周期采样（每 ~250ms，另在超时回调里补采一次）同时读 wall 与 mono，和上一次比：
 *       skew = Δwall − Δmono   （|skew| > jumpMs → wall-clock 被调整 / 跳变）
 *       gap  = Δmono − 采样间隔（> jumpMs → 进程 / 事件循环这段时间没跑：冻结、被挂起、节流，或单调时钟一次补上了暂停时间）
 *  2. 超时判定用“单调时钟差，扣掉检测到的冻结 gap”（effectiveElapsed）：扣完还没到上限 → 顺延剩余时间（最多 maxExt 次）；
 *     扣完仍到了上限（真超时）→ 照常失败，不放松任何断言；只有 wall-jump（单调时钟没问题）也不扣时间。
 *  3. 重试（harness 的步骤级）：该步超时且这一步期间检测到事件 → 有限次重试并写日志。 */

export interface ClockEvent {
    /** "freeze"：进程 / 事件循环停顿或单调时钟补跳（gap > jumpMs）；"wall-jump"：wall 与 mono 的走速不一致（|skew| > jumpMs） */
    kind: "freeze" | "wall-jump";
    /** 单调时钟读数（ms） */
    at: number;
    wallDelta: number; monoDelta: number;
    /** Δwall − Δmono */
    skew: number;
    /** 要从超时判定里扣掉的停顿时间（freeze 才有；= Δmono − 采样间隔，其余为 0） */
    gap: number;
}
export interface Clocks { wall(): number; mono(): number }
export interface Sample { wall: number; mono: number }

export const CLOCK_INTERVAL_MS = 250;
export const CLOCK_JUMP_MS = 2000;

/** 两次采样之间有没有发生跳变 / 冻结（纯函数） */
export function classifyTick(prev: Sample, cur: Sample, interval = CLOCK_INTERVAL_MS, jumpMs = CLOCK_JUMP_MS): ClockEvent | null {
    const wallDelta = cur.wall - prev.wall, monoDelta = cur.mono - prev.mono;
    const skew = wallDelta - monoDelta;
    const gap = monoDelta - interval;
    const frozen = gap > jumpMs, jumped = Math.abs(skew) > jumpMs;
    if (!frozen && !jumped) return null;
    return { kind: frozen ? "freeze" : "wall-jump", at: cur.mono, wallDelta, monoDelta, skew, gap: frozen ? gap : 0 };
}

/** 单调时钟差扣掉已检测到的冻结 gap */
export const effectiveElapsed = (monoElapsed: number, events: readonly ClockEvent[]) => Math.max(0, monoElapsed - events.reduce((s, e) => s + e.gap, 0));

export type TimeoutDecision = { action: "fail"; effective: number } | { action: "extend"; effective: number; remaining: number };
/** 超时定时器触发时怎么判（纯函数）：窗口内有事件、已用顺延次数没到上限、扣掉 gap 后还没到上限 → 顺延；否则失败 */
export function decideTimeout(a: { monoElapsed: number; limit: number; events: readonly ClockEvent[]; extensionsUsed: number; maxExt: number }): TimeoutDecision {
    const effective = effectiveElapsed(a.monoElapsed, a.events);
    if (a.events.length && a.extensionsUsed < a.maxExt && effective < a.limit) return { action: "extend", effective, remaining: Math.max(250, Math.ceil(a.limit - effective)) };
    return { action: "fail", effective };
}

export const describeEvent = (e: ClockEvent) =>
    e.kind === "freeze" ? `进程停顿 / 冻结 ${(e.gap / 1000).toFixed(1)}s（Δmono ${Math.round(e.monoDelta)}ms，Δwall ${Math.round(e.wallDelta)}ms）` : `wall-clock 与单调时钟走速不一致 ${(e.skew / 1000).toFixed(1)}s（Δwall ${Math.round(e.wallDelta)}ms，Δmono ${Math.round(e.monoDelta)}ms）`;

export class ClockWatch {
    events: ClockEvent[] = [];
    private last: Sample; private base: number;
    onEvent?: (e: ClockEvent) => void;
    constructor(readonly clocks: Clocks, readonly interval = CLOCK_INTERVAL_MS, readonly jumpMs = CLOCK_JUMP_MS) {
        this.last = { wall: clocks.wall(), mono: clocks.mono() }; this.base = this.last.wall - this.last.mono;
    }
    /** 采样一次（周期定时器和超时回调都调）；有事件就记下并返回 */
    sample(): ClockEvent | null {
        const cur: Sample = { wall: this.clocks.wall(), mono: this.clocks.mono() };
        const e = classifyTick(this.last, cur, this.interval, this.jumpMs); this.last = cur;
        if (e) { this.events.push(e); this.onEvent?.(e); }
        return e;
    }
    /** 已知的同步阻塞（Bun.spawnSync 构建等）之后调用：把“上次采样”挪到现在，这段不算冻结 */
    resync() { this.last = { wall: this.clocks.wall(), mono: this.clocks.mono() }; }
    mark() { return this.events.length; }
    since(mark: number) { return this.events.slice(mark); }
    /** wall 相对单调时钟自创建以来累计漂移（ms；0 = 同步） */
    skewMs() { return Math.round((this.clocks.wall() - this.clocks.mono()) - this.base); }
    /** 周期采样；返回停止函数 */
    start(setI: (f: () => void, ms: number) => unknown, clearI: (h: any) => void) { const h = setI(() => { this.sample(); }, this.interval); return () => clearI(h); }
    summary() { return { skewMs: this.skewMs(), events: this.events.length, last: this.events.slice(-3).map(describeEvent) }; }
}

export interface ClockTimeoutOpts {
    ms: number; watch: ClockWatch;
    /** 真超时（顺延用尽 / 扣完 gap 仍到上限）时造错误；info 带窗口内的事件和已顺延次数 */
    mkError: (info: { events: ClockEvent[]; extensions: number; monoElapsed: number; effective: number }) => Error;
    maxExt?: number;
    onExtend?: (info: { events: ClockEvent[]; extension: number; effective: number; remaining: number }) => void;
    now?: () => number; setT?: (f: () => void, ms: number) => unknown; clearT?: (h: any) => void;
}
/** Promise.race(p, 超时)，超时判定走 decideTimeout（单调时钟差 − 冻结 gap；检测到事件时顺延而不是直接失败） */
export function raceWithClockTimeout<T>(p: Promise<T>, o: ClockTimeoutOpts): Promise<T> {
    const now = o.now ?? (() => o.watch.clocks.mono()), setT = o.setT ?? ((f, ms) => setTimeout(f, ms)), clearT = o.clearT ?? (h => clearTimeout(h as any));
    const maxExt = o.maxExt ?? 2, t0 = now(), mark = o.watch.mark();
    return new Promise<T>((res, rej) => {
        let timer: unknown, ext = 0, done = false;
        const fin = () => { done = true; clearT(timer); };
        const arm = (d: number) => {
            timer = setT(() => {
                if (done) return;
                o.watch.sample(); // 定时器和周期采样谁先跑不确定：这里补采，保证“冻结后第一个回调”就能看到事件
                const events = o.watch.since(mark), monoElapsed = now() - t0;
                const d2 = decideTimeout({ monoElapsed, limit: o.ms, events, extensionsUsed: ext, maxExt });
                if (d2.action === "extend") { ext++; o.onExtend?.({ events, extension: ext, effective: d2.effective, remaining: d2.remaining }); arm(d2.remaining); }
                else { fin(); rej(o.mkError({ events, extensions: ext, monoElapsed, effective: d2.effective })); }
            }, d);
        };
        arm(o.ms);
        p.then(v => { if (!done) { fin(); res(v); } }, e => { if (!done) { fin(); rej(e); } });
    });
}

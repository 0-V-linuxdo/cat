import { test, expect } from "bun:test";
import { ClockWatch, classifyTick, decideTimeout, effectiveElapsed, raceWithClockTimeout, type ClockEvent } from "../src/selftest/clockWatch";

/** 假时钟 + 假定时器：测试里手动推进 wall / mono，不依赖真实时间 */
function fake() {
    const c = { wall: 1_700_000_000_000, mono: 5000 };
    const timers: { id: number; at: number; f: () => void }[] = []; let id = 0;
    const clocks = { wall: () => c.wall, mono: () => c.mono };
    const setT = (f: () => void, ms: number) => { const t = { id: ++id, at: c.mono + ms, f }; timers.push(t); return t.id; };
    const clearT = (h: number) => { const i = timers.findIndex(t => t.id === h); if (i >= 0) timers.splice(i, 1); };
    /** 假 setInterval（自重排的 setT），模拟生产里 250ms 周期采样 */
    const setI = (cb: () => void, ms: number) => { const h = { stop: false }; const tick = () => { if (h.stop) return; cb(); setT(tick, ms); }; setT(tick, ms); return h; };
    const clearI = (h: { stop: boolean }) => { h.stop = true; };
    /** 正常流逝：wall 和 mono 一起走，到点的定时器按顺序触发 */
    const advance = (ms: number) => { const end = c.mono + ms; for (;;) { timers.sort((a, b) => a.at - b.at); const t = timers[0]; if (!t || t.at > end) break; timers.shift(); const d = t.at - c.mono; c.mono += d; c.wall += d; t.f(); } const rest = end - c.mono; c.mono += rest; c.wall += rest; };
    /** 冻结 / 恢复：单调时钟补上 mono ms、wall 跳 wall ms，然后到期的定时器一起触发 */
    const thaw = (mono: number, wall: number) => { c.mono += mono; c.wall += wall; timers.sort((a, b) => a.at - b.at); while (timers[0] && timers[0].at <= c.mono) timers.shift()!.f(); };
    return { c, clocks, setT, clearT, setI, clearI, advance, thaw };
}

test("classifyTick：正常抖动不算事件；wall 跳变 / 冻结分别归类", () => {
    const p = { wall: 1000, mono: 1000 };
    expect(classifyTick(p, { wall: 1260, mono: 1255 })).toBeNull();
    expect(classifyTick(p, { wall: 1900, mono: 1900 })).toBeNull();                 // 事件循环忙 0.9s：不算
    const wj = classifyTick(p, { wall: 1000 + 300_000, mono: 1250 })!;              // wall 向前跳 5 分钟，mono 正常
    expect(wj.kind).toBe("wall-jump"); expect(wj.gap).toBe(0); expect(wj.skew).toBeGreaterThan(299_000);
    const bj = classifyTick(p, { wall: 1000 - 120_000, mono: 1250 })!;              // wall 向回跳
    expect(bj.kind).toBe("wall-jump"); expect(bj.skew).toBeLessThan(-100_000);
    const fz = classifyTick(p, { wall: 1000 + 300_250, mono: 1000 + 300_250 })!;    // 冻结 5 分钟后 wall / mono 都补上
    expect(fz.kind).toBe("freeze"); expect(fz.gap).toBe(300_000); expect(Math.abs(fz.skew)).toBeLessThan(1);
    const fz2 = classifyTick(p, { wall: 1000 + 301_000, mono: 1000 + 400 })!;       // 单调时钟没走、wall 跳 → wall-jump
    expect(fz2.kind).toBe("wall-jump");
});

test("decideTimeout：无事件 = 失败；有冻结事件且扣完没到上限 = 顺延；扣完仍到上限 / 顺延用尽 = 失败", () => {
    const fz: ClockEvent = { kind: "freeze", at: 0, wallDelta: 0, monoDelta: 0, skew: 0, gap: 55_000 };
    const wj: ClockEvent = { kind: "wall-jump", at: 0, wallDelta: 0, monoDelta: 0, skew: 300_000, gap: 0 };
    expect(decideTimeout({ monoElapsed: 60_000, limit: 60_000, events: [], extensionsUsed: 0, maxExt: 2 }).action).toBe("fail");
    const d = decideTimeout({ monoElapsed: 60_100, limit: 60_000, events: [fz], extensionsUsed: 0, maxExt: 2 });
    expect(d.action).toBe("extend"); expect(d.action === "extend" && d.remaining).toBe(54_900);   // 有效 5.1s，还剩 54.9s
    expect(decideTimeout({ monoElapsed: 60_100, limit: 60_000, events: [fz], extensionsUsed: 2, maxExt: 2 }).action).toBe("fail");
    expect(decideTimeout({ monoElapsed: 70_000, limit: 60_000, events: [wj], extensionsUsed: 0, maxExt: 2 }).action).toBe("fail");  // 只有 wall 跳变：单调时钟已满 → 真超时
    expect(decideTimeout({ monoElapsed: 130_000, limit: 60_000, events: [fz], extensionsUsed: 0, maxExt: 2 }).action).toBe("fail");   // 扣掉 55s 仍有 75s ≥ 60s
    expect(effectiveElapsed(10_000, [fz])).toBe(0);
});

test("ClockWatch：周期采样捕获 wall 跳变；skewMs 累计漂移", () => {
    const f = fake(); const w = new ClockWatch(f.clocks); const stop = w.start(f.setI, f.clearI);
    f.advance(2_000); expect(w.events).toHaveLength(0); expect(w.skewMs()).toBe(0);
    f.c.wall += 600_000; f.advance(300);              // wall 一次跳 10 分钟，下一次周期采样捕获
    const e = w.events[0]!; stop();
    expect(e.kind).toBe("wall-jump"); expect(w.skewMs()).toBe(600_000); expect(w.mark()).toBe(1);
    expect(w.since(0)).toHaveLength(1); expect(w.since(1)).toHaveLength(0);
});

test("raceWithClockTimeout：正常 → 到点失败（真超时）", async () => {
    const f = fake(); const w = new ClockWatch(f.clocks); w.start(f.setI, f.clearI);
    const never = new Promise<never>(() => { });
    const r = raceWithClockTimeout(never, { ms: 60_000, watch: w, setT: f.setT as any, clearT: f.clearT as any, mkError: i => new Error(`超时 ext=${i.extensions} eff=${i.effective}`) });
    const out = r.then(() => "ok", e => e.message);
    f.advance(59_000); f.advance(1_001);
    expect(await out).toBe("超时 ext=0 eff=60000");
});

test("raceWithClockTimeout：冻结 / 恢复（mono 补跳 + wall 跳变）时顺延，不误判；顺延后真挂住仍失败", async () => {
    const f = fake(); const w = new ClockWatch(f.clocks); w.start(f.setI, f.clearI); const logs: string[] = [];
    let resolve!: (v: string) => void; const p = new Promise<string>(r => { resolve = r; });
    const r = raceWithClockTimeout(p, { ms: 60_000, watch: w, setT: f.setT as any, clearT: f.clearT as any, mkError: i => new Error(`超时 ext=${i.extensions}`), onExtend: i => logs.push(`顺延#${i.extension} 剩 ${i.remaining}`) });
    f.advance(5_000);
    f.thaw(300_000, 300_000);                         // 冻结 5 分钟：定时器到期但有效时间只有 ~5s
    expect(logs).toHaveLength(1); expect(logs[0]).toMatch(/顺延#1 剩 5\d{4}/);
    f.advance(10_000); resolve("done");               // 恢复后步骤正常完成 → 不失败
    expect(await r).toBe("done");

    // 顺延后真的卡住：有效时间用满后仍然失败
    const g = fake(); const w2 = new ClockWatch(g.clocks); w2.start(g.setI, g.clearI);
    const r2 = raceWithClockTimeout(new Promise<never>(() => { }), { ms: 60_000, watch: w2, setT: g.setT as any, clearT: g.clearT as any, mkError: i => new Error(`超时 ext=${i.extensions} ev=${i.events.length}`) });
    const out2 = r2.then(() => "ok", e => e.message);
    g.advance(5_000); g.thaw(300_000, 300_000); g.advance(61_000);
    expect(await out2).toBe("超时 ext=1 ev=1");
});

test("raceWithClockTimeout：只有 wall-clock 跳变（单调时钟正常）不顺延，到点仍失败", async () => {
    const f = fake(); const w = new ClockWatch(f.clocks); w.start(f.setI, f.clearI);
    const r = raceWithClockTimeout(new Promise<never>(() => { }), { ms: 30_000, watch: w, setT: f.setT as any, clearT: f.clearT as any, mkError: i => new Error(`超时 ext=${i.extensions} ev=${i.events.length}`) });
    const out = r.then(() => "ok", e => e.message);
    f.advance(10_000); f.c.wall += 900_000;           // wall 突然跳 15 分钟（Date.now 差判超时会立刻误判）
    f.advance(20_001);
    expect(await out).toBe("超时 ext=0 ev=1");        // 单调时钟满 30s → 真超时，不放松
});

test("raceWithClockTimeout：最多顺延 maxExt 次", async () => {
    const f = fake(); const w = new ClockWatch(f.clocks); w.start(f.setI, f.clearI); let n = 0;
    const r = raceWithClockTimeout(new Promise<never>(() => { }), { ms: 60_000, watch: w, maxExt: 2, setT: f.setT as any, clearT: f.clearT as any, onExtend: () => { n++; }, mkError: i => new Error(`超时 ext=${i.extensions}`) });
    const out = r.then(() => "ok", e => e.message);
    f.advance(1_000); f.thaw(100_000, 100_000);       // 第 1 次
    f.advance(1_000); f.thaw(100_000, 100_000);       // 第 2 次
    f.advance(1_000); f.thaw(100_000, 100_000);       // 第 3 次：已用尽 → 失败
    expect(await out).toBe("超时 ext=2"); expect(n).toBe(2);
});

/* 真时钟冒烟：harness 里实际用的 withTimeout / clock（不碰 UI、不起浏览器） */
test("harness withTimeout（真定时器）：真超时仍抛 StepTimeout；Date.now 向前跳 10 分钟不顺延也不误杀正常完成", async () => {
    const { withTimeout, StepTimeout, clock } = await import("../scripts/lib/cdp-harness");
    const t0 = performance.now();
    await expect(withTimeout("真挂住", 300, new Promise(() => { }))).rejects.toBeInstanceOf(StepTimeout);
    expect(performance.now() - t0).toBeGreaterThanOrEqual(290);
    const realNow = Date.now; let off = 0; Date.now = () => realNow() + off;
    try {
        const n0 = clock.events.length;
        const slow = new Promise<string>(r => setTimeout(() => r("done"), 500));
        off += 600_000; // 等待期间 wall-clock 突然 +10 分钟
        expect(await withTimeout("wall 跳变下正常完成", 2000, slow)).toBe("done");
        await Bun.sleep(300); // 让 250ms 采样捕获跳变
        expect(clock.events.length).toBeGreaterThan(n0);
        expect(clock.events.at(-1)!.kind).toBe("wall-jump");
        // wall-only 跳变：不顺延——真挂住的调用仍按单调时钟到点失败
        await expect(withTimeout("wall 跳变后真挂住", 300, new Promise(() => { }))).rejects.toBeInstanceOf(StepTimeout);
    } finally { Date.now = realNow; }
});

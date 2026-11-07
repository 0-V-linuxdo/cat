import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { LOCALES } from "@api/i18n";

import { ARC, DEFAULT_DISPLAY, PUSH, SPRING } from "../src/plugins/inpageSidebar/constants";
import { fitDecision, type FitFacts, fixedShift, NO_FIT, parseDisplayMode, pushCss, pushOffset, pushTiming, shouldPush } from "../src/plugins/inpageSidebar/logic";
import { createPagePush, type ElLike, type PagePushDeps, type StyleLike } from "../src/plugins/inpageSidebar/pagePush";

/* 补丁 09「推开页面」：bun 没有 jsdom，所以 pagePush 的 DOM 依赖全部注入，这里用假环境（假 style / 假元素 / 手动时钟 / 记录样式表写入）测它的状态机。
 * 真实布局（html margin 是否真把页面推开、fixed 补偿是否对位、动画是否抖）要真浏览器——见 shots/shots-push.ts 与 MANUAL I23–I30，这里不声称。 */

const DIR = resolve(import.meta.dir, "../src/plugins/inpageSidebar");
const src = (f: string) => readFileSync(resolve(DIR, f), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

class FakeStyle implements StyleLike {
    props = new Map<string, [string, string]>();
    getPropertyValue(p: string) { return this.props.get(p)?.[0] ?? ""; }
    getPropertyPriority(p: string) { return this.props.get(p)?.[1] ?? ""; }
    setProperty(p: string, v: string, pr = "") { this.props.set(p, [v, pr]); }
    removeProperty(p: string) { const o = this.getPropertyValue(p); this.props.delete(p); return o; }
}
interface FakeEl extends ElLike { style: FakeStyle; id: string; pos: string; rect: { left: number; right: number; width: number; height: number }; ml: number; own?: boolean }
const el = (id: string, o: Partial<FakeEl> = {}): FakeEl => ({ id, pos: "static", rect: { left: 0, right: 100, width: 100, height: 20 }, ml: 0, style: new FakeStyle(), getBoundingClientRect() { return this.rect; }, ...o } as FakeEl);

function env(init: { rootMl?: number; vw?: number; reduced?: boolean; els?: FakeEl[] } = {}) {
    const log: string[] = [];
    let css = ""; let installed = false; let now = 0;
    const timers = new Map<number, { at: number; fn: () => void }>(); let tid = 0;
    let obsCb: (() => void) | undefined; let obsStops = 0;
    const els = init.els ?? [];
    const warns: string[] = []; let rootOverride: number | undefined; // 补丁 10：假的 html computed margin-left —— 默认「样式表写了多少就是多少」（过渡瞬间完成）；setRootMl(n) 模拟过渡中间 / 卡住，setRootMl() 恢复
    const deps: PagePushDeps = {
        scan: () => els, isOwn: e => !!(e as FakeEl).own, position: e => (e as FakeEl).pos,
        marginLeft: e => e === "root" ? (rootOverride ?? (css ? Number(/margin-left: ([\d.]+)px/.exec(css)?.[1] ?? init.rootMl ?? 0) : (init.rootMl ?? 0))) : (e as FakeEl).ml,
        clientWidth: () => init.vw ?? 1200, rtlScrollbar: () => 0, flush: () => { log.push("flush"); }, reducedMotion: () => !!init.reduced,
        sheet: { set: c => { css = c; installed = true; log.push(`set:${c}`); }, clear: () => { css = ""; installed = false; log.push("clear"); } },
        observe: cb => { obsCb = cb; return () => { obsCb = undefined; obsStops++; }; },
        setTimer: (fn, ms) => { const id = ++tid; timers.set(id, { at: now + ms, fn }); return id; },
        clearTimer: t => { timers.delete(t as number); },
        warn: m => { warns.push(m); },
    };
    return {
        deps, log, els, get css() { return css; }, get installed() { return installed; }, get obsStops() { return obsStops; }, get observing() { return !!obsCb; }, fireMutation: () => obsCb?.(),
        pending: () => timers.size, warns, setRootMl: (v?: number) => { rootOverride = v; },
        advance: (ms: number) => { now += ms; for (const [id, t] of timers) if (t.at <= now) { timers.delete(id); t.fn(); } },
        run: (ms: number) => { for (let i = 0; i < ms; i++) { now += 1; for (const [id, t] of timers) if (t.at <= now) { timers.delete(id); t.fn(); } } }, // 逐 ms 推进：连环定时器（重试链）按真实时间顺序触发；advance 一次只触发「到期的第一代」
        margin: () => /margin-left: ([\d.]+)px/.exec(css)?.[1],
    };
}

describe("显示方式与推开量（纯逻辑）", () => {
    test("默认推开；非法 / 缺失 / 旧值都回到默认；overlay 保留", () => {
        expect(DEFAULT_DISPLAY).toBe("push");
        for (const v of [undefined, null, "", "PUSH", "x", 1, true]) expect(parseDisplayMode(v)).toBe("push");
        expect(parseDisplayMode("overlay")).toBe("overlay"); expect(parseDisplayMode("push")).toBe("push");
    });
    test("推开量 = 侧栏宽 + 右留白 0（平贴态 x = 0、无 5 px 外边距：默认 228；Arc locked「内容区 x = 侧栏 maxX」）；RTL 少推一个滚动条宽；不为负", () => {
        expect(PUSH.gap).toBe(0); expect(ARC.inset).toBe(5); expect(pushOffset(ARC.defaultWidth)).toBe(228);
        expect(pushOffset(164)).toBe(164); expect(pushOffset(500)).toBe(500); expect(pushOffset(228.4)).toBe(228);
        expect(pushOffset(228, 15)).toBe(213); expect(pushOffset(228, -3)).toBe(228); expect(pushOffset(0, 9999)).toBe(0);
    });
    test("模式选择真值表：只有 push + 常驻 + 非元素全屏才让位（悬停浮出 = 非常驻 = 从不让位）", () => {
        for (const mode of ["push", "overlay"] as const) for (const pinned of [false, true]) for (const fullscreen of [false, true])
            expect(shouldPush({ mode, pinned, fullscreen })).toBe(mode === "push" && pinned && !fullscreen);
        expect(shouldPush({ mode: "push", pinned: false, fullscreen: false })).toBe(false); // hover-reveal 的 peek：pinned=false
    });
    test("过渡（Cat 裁定）：默认 arc80 = 0.08 s easeOutQuad（Arc locked 切换）；弹簧仍保留、悬停浮出继续用它", () => {
        expect(PUSH.curve).toBe("arc80"); expect(pushTiming()).toEqual({ ms: 80, easing: "cubic-bezier(.25,.46,.45,.94)" });
        expect(PUSH.arc80).toEqual({ ms: 80, easing: "cubic-bezier(.25,.46,.45,.94)" });
        expect(SPRING.durationMs).toBe(250); expect(SPRING.easing).toContain("linear(0,"); // 弹簧常量没动，悬停浮出的 .box 默认 transition 用它
    });
    test("样式文本：html:root 的 margin-left !important，@media screen；动画 = margin-left 过渡，否则 transition none；不碰 transform / width / padding", () => {
        const a = pushCss(250, true), n = pushCss(250, false);
        expect(a).toBe(`@media screen { html:root { margin-left: 250px !important; transition: margin-left 80ms cubic-bezier(.25,.46,.45,.94) !important; } }`);
        expect(n).toContain("margin-left: 250px !important"); expect(n).toContain("transition: none !important");
        for (const c of [a, n]) { expect(c).not.toMatch(/transform|padding|[^-]width|position/); expect(c.match(/margin-left/g)!.length).toBe(c === a ? 2 : 1); } // 没有 fit 时不碰 width
    });
    test("fixedShift：只处理压进占用区的可见固定元素", () => {
        const R = (left: number, width: number, height = 40) => ({ left, right: left + width, width, height });
        expect(fixedShift(R(0, 1200), 238, 1200)).toEqual({ dx: 238, maxWidth: 962 });
        expect(fixedShift(R(100, 300), 238, 1200)).toEqual({ dx: 138, maxWidth: 962 });
        expect(fixedShift(R(237.6, 100), 238, 1200)).toBeNull(); // 差 < 0.5：不动
        expect(fixedShift(R(238, 100), 238, 1200)).toBeNull(); expect(fixedShift(R(600, 100), 238, 1200)).toBeNull();
        expect(fixedShift(R(-300, 300), 238, 1200)).toBeNull(); // off-canvas：right = 0
        expect(fixedShift(R(-200, 300), 238, 1200)).toEqual({ dx: 438, maxWidth: 962 }); // 部分可见 → 右移到占用区之外
        expect(fixedShift(R(238, 1200), 238, 1200)).toEqual({ dx: 0, maxWidth: 962 }); // left:auto 随 html 右移、宽度还是视口宽：右缘越界 → 只夹 max-width
        expect(fixedShift(R(239.5, 1200), 238, 1200)).toEqual({ dx: 0, maxWidth: 962 }); expect(fixedShift(R(241, 1200), 238, 1200)).toBeNull(); // 左缘离占用区边界 > 2px：不是「随 html 右移」
        expect(fixedShift(R(238, 962), 238, 1200)).toBeNull(); // 没越界
        expect(fixedShift(R(0, 0), 238, 1200)).toBeNull(); expect(fixedShift(R(0, 100, 0), 238, 1200)).toBeNull();
        expect(fixedShift(R(0, 1200), 238, 100)!.maxWidth).toBe(0);
    });
});

describe("pagePush 控制器：样式表的安装 / 动画 / 还原", () => {
    test("推开：先以原值装一帧 + flush（过渡才有起点），再改成 原值+偏移 并带过渡；html 原 margin 保留在基数里", () => {
        const e = env({ rootMl: 12 }); const p = createPagePush(e.deps);
        p.set(238);
        expect(e.log).toEqual([`set:${pushCss(12, false)}`, "flush", `set:${pushCss(250, true)}`]);
        expect(p.state()).toEqual({ offset: 238, fixed: 0, installed: true }); expect(e.margin()).toBe("250"); expect(e.observing).toBe(true);
    });
    test("幂等：同一偏移再设不再写样式表；新偏移直接更新（带过渡）", () => {
        const e = env(); const p = createPagePush(e.deps); p.set(238); const n = e.log.length;
        p.set(238); p.set(238, { animate: false }); expect(e.log.length).toBe(n);
        p.set(300); expect(e.margin()).toBe("300"); expect(e.log.length).toBe(n + 1);
    });
    test("收回（动画）：先回到原值（带过渡），过渡结束后整张样式表摘掉；之后页面零残留", () => {
        const e = env({ rootMl: 8 }); const p = createPagePush(e.deps); p.set(238, { animate: false }); expect(e.margin()).toBe("246");
        p.set(0);
        expect(e.css).toBe(pushCss(8, true)); expect(e.installed).toBe(true); expect(p.state().offset).toBe(0); expect(e.observing).toBe(false);
        e.advance(pushTiming().ms + PUSH.settleExtraMs - 1); expect(e.installed).toBe(true);
        e.advance(1); expect(e.installed).toBe(false); expect(e.css).toBe(""); expect(p.state()).toEqual({ offset: 0, fixed: 0, installed: false }); expect(e.pending()).toBe(0);
    });
    test("收回（无动画）/ destroy：立刻零残留；destroy 之后没有任何挂起的定时器 / 观察者", () => {
        const e = env(); const p = createPagePush(e.deps); p.set(238, { animate: false }); p.set(0, { animate: false });
        expect(e.installed).toBe(false); expect(e.pending()).toBe(0);
        p.set(238); p.set(0); p.destroy(); expect(e.installed).toBe(false); expect(e.pending()).toBe(0); expect(e.observing).toBe(false);
        p.destroy(); expect(p.state()).toEqual({ offset: 0, fixed: 0, installed: false });
    });
    test("收回动画进行中再要求「不要动画」的 0 → 提前收尾（全屏）；再推开 → 取消收尾，基数不变", () => {
        const e = env({ rootMl: 4 }); const p = createPagePush(e.deps); p.set(238, { animate: false }); p.set(0);
        p.set(0, { animate: false }); expect(e.installed).toBe(false); expect(e.pending()).toBe(0);
        p.set(238, { animate: false }); p.set(0); p.set(238); // 收回途中又推开
        expect(e.installed).toBe(true); expect(e.margin()).toBe("242"); e.advance(1000); expect(e.installed).toBe(true); expect(p.state().offset).toBe(238);
    });
    test("prefers-reduced-motion：永远不带过渡、不装起点帧", () => {
        const e = env({ reduced: true }); const p = createPagePush(e.deps); p.set(238);
        expect(e.log).toEqual([`set:${pushCss(238, false)}`]); p.set(0); expect(e.installed).toBe(false);
    });
    test("非数 / 负数偏移 = 0", () => {
        const e = env(); const p = createPagePush(e.deps); p.set(Number.NaN); p.set(-5); expect(e.log).toEqual([]); expect(p.state().installed).toBe(false);
    });
});

describe("pagePush：position:fixed 补偿与还原", () => {
    const mk = () => {
        const header = el("header", { pos: "fixed", rect: { left: 0, right: 1200, width: 1200, height: 56 }, ml: 0 });
        const off = el("drawer", { pos: "fixed", rect: { left: -300, right: 0, width: 300, height: 600 } });
        const right = el("toast", { pos: "fixed", rect: { left: 900, right: 1100, width: 200, height: 40 } });
        const flow = el("p", { pos: "static" }); const sticky = el("nav", { pos: "sticky" });
        const own = el("host", { pos: "fixed", own: true });
        const centered = el("modal", { pos: "fixed", rect: { left: 100, right: 700, width: 600, height: 300 }, ml: 100 });
        return { header, off, right, flow, sticky, own, centered };
    };
    test("只补偿压进占用区的 fixed 元素（inline margin-left + max-width，!important）；off-canvas / 右侧 / 非 fixed / 宿主不动；sticky 不处理（随 html 走）", () => {
        const m = mk(); const e = env({ els: Object.values(m) }); const p = createPagePush(e.deps);
        p.set(238, { animate: false }); e.advance(PUSH.scanDebounceMs);
        expect(m.header.style.getPropertyValue("margin-left")).toBe("238px"); expect(m.header.style.getPropertyPriority("margin-left")).toBe("important");
        expect(m.header.style.getPropertyValue("max-width")).toBe("962px");
        expect(m.centered.style.getPropertyValue("margin-left")).toBe("238px"); // 100（原 margin）+ (238 − 100)
        for (const k of ["off", "right", "flow", "sticky", "own"] as const) expect((m[k].style as FakeStyle).props.size).toBe(0);
        expect(p.state().fixed).toBe(2);
    });
    test("收回：被补偿元素的 inline 值还原成原值（含原 !important 与「原本没有」）；页面中途改过的值不覆盖", () => {
        const m = mk(); m.header.style.setProperty("margin-left", "3px", "important"); m.header.style.setProperty("max-width", "90%");
        const e = env({ els: [m.header, m.centered] }); const p = createPagePush(e.deps);
        p.set(238, { animate: false }); e.advance(PUSH.scanDebounceMs);
        m.centered.style.setProperty("max-width", "50px"); // 页面自己后来改了
        p.set(0);
        expect(m.header.style.props.get("margin-left")).toEqual(["3px", "important"]); expect(m.header.style.props.get("max-width")).toEqual(["90%", ""]);
        expect(m.centered.style.props.has("margin-left")).toBe(false); expect(m.centered.style.getPropertyValue("max-width")).toBe("50px");
        expect(p.state().fixed).toBe(0);
    });
    test("原本没有 style 属性的元素：还原后摘掉空的 style=\"\"（真机 21:16 实测头部 null → \"\"）；原本有 style 属性的保留属性", () => {
        const attrs = (e: FakeEl, had: boolean) => { let a: string | null = had ? "color: red;" : null; const o = e as FakeEl & { removed: number };
            o.removed = 0; e.getAttribute = () => (e.style.props.size === 0 ? (a === null ? null : "") : "x: y;"); e.removeAttribute = () => { a = null; o.removed++; }; return o; };
        const a = attrs(el("a", { pos: "fixed", rect: { left: 0, right: 1200, width: 1200, height: 56 } }), false);
        const b = attrs(el("b", { pos: "fixed", rect: { left: 0, right: 1200, width: 1200, height: 56 } }), true);
        // 模拟浏览器：设过 inline 属性后，removeProperty 把属性留成空串
        const e = env({ els: [a, b] }); const p = createPagePush(e.deps);
        p.set(238, { animate: false }); e.advance(PUSH.scanDebounceMs);
        const aGet = a.getAttribute!; a.getAttribute = n => (a.style.props.size === 0 ? "" : aGet(n));
        p.set(0);
        expect(a.removed).toBe(1); expect(b.removed).toBe(0);
    });
    test("补偿过头自愈：扫描恰在 html 过渡起点测到 left 0（补 233），过渡走完后元素实际在 466 → 核对扫描还原并按稳定后的位置重测（真机 GitHub lp-IntroHero 的 466）", () => {
        // 假布局：元素 left = html 推开量（过渡完成后）+ 自己的 margin-left；「过渡未开始」时 html 推开量 = 0
        let htmlPush = 0;
        const hero = el("hero", { pos: "fixed", rect: { left: 0, right: 1200, width: 1200, height: 56 } });
        Object.defineProperty(hero, "rect", { get: () => { const ml = Number.parseFloat(hero.style.getPropertyValue("margin-left")) || 0; const l = htmlPush + ml; return { left: l, right: l + 1200, width: 1200, height: 56 }; } });
        const e = env({ els: [hero] }); const p = createPagePush(e.deps);
        p.set(233, { animate: false }); e.advance(PUSH.scanDebounceMs); // 全量扫描：此刻 htmlPush 还是 0 → 补 233
        expect(hero.style.getPropertyValue("margin-left")).toBe("233px");
        htmlPush = 233; // 过渡走完：元素实际 left = 466
        e.advance(PUSH.scanDebounceMs); // 全量扫描之后自动补的那次核对扫描
        expect(hero.style.getPropertyValue("margin-left")).toBe(""); expect(hero.rect.left).toBe(233); // 还原后左缘 233（不再 466）；它宽 1200 的右缘越界，所以只剩 max-width 夹取（dx 0，不写 margin）
        expect(hero.style.getPropertyValue("max-width")).toBe("967px"); expect(p.state().fixed).toBe(1);
        e.advance(10_000); expect(e.pending()).toBe(0); // 只核对一次，不自我循环
    });
    test("left:auto 的 fixed 元素随 html 右移但宽度仍是视口宽：只写 max-width（不写 margin-left），收回精确还原", () => {
        const hero = el("hero", { pos: "fixed", rect: { left: 238, right: 1438, width: 1200, height: 56 } });
        hero.style.setProperty("margin-left", "7px");
        const e = env({ els: [hero] }); const p = createPagePush(e.deps);
        p.set(238, { animate: false }); e.advance(PUSH.scanDebounceMs);
        expect(hero.style.getPropertyValue("max-width")).toBe("962px"); expect(hero.style.props.get("margin-left")).toEqual(["7px", ""]); expect(p.state().fixed).toBe(1);
        p.set(0); expect(hero.style.props.has("max-width")).toBe(false); expect(hero.style.props.get("margin-left")).toEqual(["7px", ""]);
    });
    test("核对扫描不动正常的补偿：补偿后左缘 = 推开量（含 ceil 的 <1px 误差）→ 保持", () => {
        const m = mk(); const e = env({ els: [m.header] }); const p = createPagePush(e.deps);
        p.set(238, { animate: false }); e.advance(PUSH.scanDebounceMs); // 假 rect 是静态的（left 0）：不会「补过头」
        e.advance(PUSH.scanDebounceMs * 3); expect(m.header.style.getPropertyValue("margin-left")).toBe("238px"); expect(p.state().fixed).toBe(1);
    });
    test("destroy 也还原；宽度变化 → 去抖后「还原→重测→重补偿」，新偏移生效、不叠加", () => {
        const m = mk(); const e = env({ els: [m.header] }); const p = createPagePush(e.deps);
        p.set(238, { animate: false }); e.advance(PUSH.scanDebounceMs); expect(m.header.style.getPropertyValue("margin-left")).toBe("238px");
        p.set(300, { animate: false }); expect(m.header.style.getPropertyValue("margin-left")).toBe("238px"); // 拖拽中不闪：还没重测
        e.advance(PUSH.scanDebounceMs); expect(m.header.style.getPropertyValue("margin-left")).toBe("300px"); expect(m.header.style.getPropertyValue("max-width")).toBe("900px");
        p.destroy(); expect((m.header.style as FakeStyle).props.size).toBe(0); expect(p.state().fixed).toBe(0);
    });
    test("动画推开时过渡结束后才测量（避免测到中间值）", () => {
        const m = mk(); const e = env({ els: [m.header] }); const p = createPagePush(e.deps); p.set(238);
        e.advance(pushTiming().ms); expect(p.state().fixed).toBe(0); e.advance(PUSH.settleExtraMs); expect(p.state().fixed).toBe(1);
    });
    test("DOM 增删（观察者）→ 去抖重扫，新出现的 fixed 元素被补偿；收回后观察者已停止", () => {
        const e = env(); const p = createPagePush(e.deps); p.set(238, { animate: false }); e.advance(PUSH.scanDebounceMs); expect(p.state().fixed).toBe(0);
        const late = el("cookie", { pos: "fixed", rect: { left: 0, right: 600, width: 600, height: 80 } }); e.els.push(late);
        e.fireMutation(); e.fireMutation(); expect(e.pending()).toBe(1); // 去抖：只有一个定时器
        e.advance(PUSH.scanDebounceMs); expect(late.style.getPropertyValue("margin-left")).toBe("238px");
        p.set(0, { animate: false }); expect(e.observing).toBe(false); expect(late.style.props.size).toBe(0);
    });
    test("增量重扫（滚动 / 增删）：已不再 fixed 的元素被还原（不能把放开的吸顶元素推歪）；仍 fixed 的保持、不重复保存", () => {
        const m = mk(); const e = env({ els: [m.header] }); const p = createPagePush(e.deps); p.set(238, { animate: false }); e.advance(PUSH.scanDebounceMs);
        expect(p.state().fixed).toBe(1); e.fireMutation(); e.advance(PUSH.scanDebounceMs); expect(p.state().fixed).toBe(1); expect(m.header.style.getPropertyValue("margin-left")).toBe("238px");
        m.header.pos = "static"; e.fireMutation(); e.advance(PUSH.scanDebounceMs);
        expect(p.state().fixed).toBe(0); expect(m.header.style.props.size).toBe(0);
    });
    test("扫描上限 PUSH.scanMax：只处理前 N 个元素（⚠ 超出的不补偿）", () => {
        const many = Array.from({ length: PUSH.scanMax + 10 }, (_, i) => el(`f${i}`, { pos: "fixed", rect: { left: 0, right: 500, width: 500, height: 30 } }));
        const e = env({ els: many }); const p = createPagePush(e.deps); p.set(238, { animate: false }); e.advance(PUSH.scanDebounceMs);
        expect(p.state().fixed).toBe(PUSH.scanMax);
    });
});

describe("补丁 10：扫描前先等 html margin-left 到位（真机 GitHub lp-IntroHero 的 72px 瞬跳）", () => {
    const OFF = 228, SETTLE = pushTiming().ms + PUSH.settleExtraMs; // 动画推开：第一次扫描排在 80 + 60 ms
    /** 假布局：left:auto 的 fixed 元素 left = 当前 html margin + 自己的 inline margin-left（过渡中随 html 走）；宽度 = 视口宽 */
    const autoHero = (e: ReturnType<typeof env>) => {
        const hero = el("hero", { pos: "fixed" });
        Object.defineProperty(hero, "rect", { get: () => { const html = e.deps.marginLeft("root") as number; const ml = Number.parseFloat(hero.style.getPropertyValue("margin-left")) || 0; const l = html + ml; return { left: l, right: l + 1200, width: 1200, height: 56 }; } });
        return hero;
    };
    const header = () => el("header", { pos: "fixed", rect: { left: 0, right: 1200, width: 1200, height: 56 } }); // left:0 显式：位置与相位无关
    test("(a) 过渡中间（html margin ≈155 / 目标 228）：不写任何补偿（hero 不会被写 margin-left 72）；一直在等，不量、不还原", () => {
        const e = env({ vw: 1200 }); const hero = autoHero(e); const hdr = header(); e.els.push(hero, hdr);
        const p = createPagePush(e.deps); p.set(OFF); e.setRootMl(155.4); // 时间线停在中间相位：计算样式读到的就是 155.4
        e.run(SETTLE);
        expect((hero.style as FakeStyle).props.size).toBe(0); expect((hdr.style as FakeStyle).props.size).toBe(0); expect(p.state().fixed).toBe(0); expect(e.pending()).toBe(1); // 只有一个重试定时器
        for (let i = 0; i < 10; i++) e.run(PUSH.settleRetryMs);
        expect((hero.style as FakeStyle).props.size).toBe(0); expect((hdr.style as FakeStyle).props.size).toBe(0); expect(e.warns.length).toBe(0); // 还没到 20 次：没超时、没写
        e.fireMutation(); e.run(PUSH.scanDebounceMs); expect((hero.style as FakeStyle).props.size).toBe(0); // 增量扫描（DOM 变动）同样被门控
    });
    test("(b) margin 到位后：left:auto 的 hero 终态 left=228，只夹 max-width（dx 0，没有 margin-left）；left:0 的头部照旧补偿 +228（含 max-width）", () => {
        const e = env({ vw: 1200 }); const hero = autoHero(e); const hdr = header(); e.els.push(hero, hdr);
        const p = createPagePush(e.deps); p.set(OFF); e.setRootMl(155.4); e.run(SETTLE + PUSH.settleRetryMs * 3);
        expect(p.state().fixed).toBe(0);
        e.setRootMl(); // 过渡走完 → computed margin = 228（样式表里的目标）
        e.run(PUSH.settleRetryMs);
        expect(hero.style.getPropertyValue("margin-left")).toBe(""); expect(hero.style.getPropertyValue("max-width")).toBe("972px"); expect(hero.rect.left).toBe(OFF);
        expect(hdr.style.getPropertyValue("margin-left")).toBe("228px"); expect(hdr.style.getPropertyPriority("margin-left")).toBe("important"); expect(hdr.style.getPropertyValue("max-width")).toBe("972px");
        expect(p.state().fixed).toBe(2); expect(e.warns.length).toBe(0);
        e.run(PUSH.scanDebounceMs); expect(hero.style.getPropertyValue("margin-left")).toBe(""); expect(hdr.style.getPropertyValue("margin-left")).toBe("228px"); // 核对扫描（也过门控）：不改动
        e.run(10_000); expect(e.pending()).toBe(0);
        p.set(0, { animate: false }); expect((hero.style as FakeStyle).props.size).toBe(0); expect((hdr.style as FakeStyle).props.size).toBe(0);
    });
    test("(b2) 核对扫描也被门控：补偿完成后 html margin 又处于中间相位（拖拽改宽度）时，不还原 / 不重测；到位后才处理", () => {
        const e = env({ vw: 1200 }); const hdr = header(); e.els.push(hdr);
        const p = createPagePush(e.deps); p.set(OFF, { animate: false }); e.run(PUSH.scanDebounceMs); expect(hdr.style.getPropertyValue("margin-left")).toBe("228px");
        hdr.pos = "static"; e.setRootMl(100); e.fireMutation(); e.run(PUSH.scanDebounceMs + PUSH.settleRetryMs * 2);
        expect(p.state().fixed).toBe(1); expect(hdr.style.getPropertyValue("margin-left")).toBe("228px"); // 门控中：「已不再 fixed」的还原也要等
        e.setRootMl(); e.run(PUSH.settleRetryMs); expect(p.state().fixed).toBe(0); expect((hdr.style as FakeStyle).props.size).toBe(0);
    });
    test("(c) 超时（20 × 50 ms 仍不到位）：照旧扫描 + 告警一次；之后同一次推开里不再门控 / 不再告警；偏移变化后重新门控", () => {
        const e = env({ vw: 1200 }); const hdr = header(); e.els.push(hdr);
        const p = createPagePush(e.deps); p.set(OFF); e.setRootMl(100); // 卡在 100，永远到不了 228
        const total = SETTLE + PUSH.settleMaxTries * PUSH.settleRetryMs;
        e.run(total - 1); expect(e.warns.length).toBe(0); expect(p.state().fixed).toBe(0);
        e.run(1); expect(e.warns.length).toBe(1); expect(e.warns[0]).toContain("228"); expect(p.state().fixed).toBe(1); expect(hdr.style.getPropertyValue("margin-left")).toBe("228px");
        e.run(PUSH.scanDebounceMs); // 之后的核对扫描：不再等
        const late = el("late", { pos: "fixed", rect: { left: 0, right: 600, width: 600, height: 80 } }); e.els.push(late);
        e.fireMutation(); e.run(PUSH.scanDebounceMs); expect(late.style.getPropertyValue("margin-left")).toBe("228px"); expect(e.warns.length).toBe(1);
        p.set(300, { animate: false }); e.run(PUSH.scanDebounceMs); expect(p.state().fixed).toBe(2); // 偏移变了：重新门控 → 卡在 100 ≠ 300 → 又在等
        expect(hdr.style.getPropertyValue("margin-left")).toBe("228px"); expect(e.pending()).toBe(1);
    });
    test("(d) 取消：等待中收回 / 销毁 / 改偏移 —— 没有残留定时器，没有迟到的写入", () => {
        // 收回（显示方式切走 / 全屏）：不动画
        let e = env({ vw: 1200 }); let hdr = header(); e.els.push(hdr); let p = createPagePush(e.deps); p.set(OFF); e.setRootMl(50); e.run(SETTLE + PUSH.settleRetryMs);
        expect(e.pending()).toBe(1); p.set(0, { animate: false }); expect(e.pending()).toBe(0); e.run(10_000); expect((hdr.style as FakeStyle).props.size).toBe(0); expect(e.warns.length).toBe(0);
        // 收回（动画）：只剩收尾定时器，到点后整张样式表摘掉；期间不写补偿
        e = env({ vw: 1200 }); hdr = header(); e.els.push(hdr); p = createPagePush(e.deps); p.set(OFF); e.setRootMl(50); e.run(SETTLE + PUSH.settleRetryMs);
        p.set(0); expect(e.pending()).toBe(1); e.setRootMl(); e.run(10_000); expect(e.pending()).toBe(0); expect(e.installed).toBe(false); expect((hdr.style as FakeStyle).props.size).toBe(0); expect(e.warns.length).toBe(0);
        // destroy
        e = env({ vw: 1200 }); hdr = header(); e.els.push(hdr); p = createPagePush(e.deps); p.set(OFF); e.setRootMl(50); e.run(SETTLE + PUSH.settleRetryMs);
        p.destroy(); expect(e.pending()).toBe(0); e.run(10_000); expect((hdr.style as FakeStyle).props.size).toBe(0); expect(e.warns.length).toBe(0); expect(e.installed).toBe(false);
        // 等待中改偏移（拖拽）：旧目标作废，用新目标；重试计数清零（不会因为旧的等待提前超时）
        e = env({ vw: 1200 }); hdr = header(); e.els.push(hdr); p = createPagePush(e.deps); p.set(OFF); e.setRootMl(50); e.run(SETTLE + PUSH.settleRetryMs * 15);
        p.set(300); e.run(SETTLE + PUSH.settleRetryMs * 10); expect(e.warns.length).toBe(0); expect(p.state().fixed).toBe(0);
        e.setRootMl(); e.run(PUSH.settleRetryMs); expect(hdr.style.getPropertyValue("margin-left")).toBe("300px"); expect(hdr.style.getPropertyValue("max-width")).toBe("900px");
    });
    test("门控只读 computed margin（不改样式表 / 不加依赖）；常量与注入的 warn 接线", () => {
        const c = strip(src("constants.ts")), pp = strip(src("pagePush.ts"));
        expect(PUSH.settleRetryMs).toBe(50); expect(PUSH.settleMaxTries).toBe(20); expect(PUSH.settleTol).toBe(0.5);
        expect(c).toContain("settleRetryMs"); expect(pp).toContain("htmlSettled"); expect(pp).toContain("d.warn?.");
        expect(pp).not.toMatch(/console\./); expect(strip(src("content.ts"))).toMatch(/warn: \(m: string\) => console\.warn\(m\)/);
    });
});

describe("占满视口页面的横向溢出缓解（DESIGN 3.8.6，用户 / Cat 裁定 2）", () => {
    // 夹具 = shots/shots-push.ts 里的 /overflow.html：html{width:100%} + body{width:100vw}；视口 1653 + 滚动条 15 = innerWidth 1668（真机 21:16 实测：推开前 scrollW/clientW 1668/1653，推开后 1906/1653）
    const F = (o: Partial<FitFacts> = {}): FitFacts => ({ htmlW: 1653, htmlMl: 0, clientW: 1653, innerW: 1668, bodyW: 1668, bodyMinW: 0, ...o });
    test("决策：html{width:100%} → html auto；body{width:100vw} → body max-width:100%；body{min-width:100vw} → min-width:0；其余不动", () => {
        expect(fitDecision(F())).toEqual({ html: true, body: true, bodyMin: false });
        expect(fitDecision(F({ bodyW: 1637, bodyMinW: 1668 }))).toEqual({ html: true, body: true, bodyMin: true }); // 默认 8px 边距的 auto body 也在范围内（夹 100% 无副作用）
        expect(fitDecision(F({ htmlW: 1200 }))).toEqual({ html: false, body: true, bodyMin: false }); // 固定宽 html（居中设计）不改
        expect(fitDecision(F({ bodyW: 960 }))).toMatchObject({ body: false }); // 窄 body 本来就放得下
        expect(fitDecision(F({ htmlW: 2600, bodyW: 2600 }))).toEqual(NO_FIT); // 自身横向滚动的宽页面：不夹，保留它的横向滚动
        expect(fitDecision(F({ htmlW: 1645, htmlMl: 8 }))).toMatchObject({ html: true }); // html 自带 8px margin-left：htmlW + ml 占满
        expect(fitDecision(null)).toEqual(NO_FIT); expect(fitDecision(undefined)).toEqual(NO_FIT); expect(fitDecision(F({ clientW: 0 }))).toEqual(NO_FIT);
    });
    test("样式文本：fit.html → html 规则里加 width:auto !important；fit.body / bodyMin → 单独一条 html:root > body 规则；NO_FIT 时与补丁 09 初版逐字相同", () => {
        expect(pushCss(233, false, NO_FIT)).toBe(pushCss(233, false));
        const c = pushCss(233, false, { html: true, body: true, bodyMin: true });
        expect(c).toBe("@media screen { html:root { margin-left: 233px !important; transition: none !important; width: auto !important; } html:root > body { max-width: 100% !important; min-width: 0 !important; } }");
        expect(pushCss(233, false, { html: true, body: false, bodyMin: false })).not.toContain("html:root > body");
    });
    test("控制器：安装前量一次、同一张样式表里带上缓解；推开中 / 拖拽 / 收回动画中都保持；收回结束整张表摘掉（没有任何残留）", () => {
        const e = env(); let reads = 0; e.deps.fitFacts = () => { reads++; return F(); };
        const p = createPagePush(e.deps);
        p.set(233); expect(reads).toBe(1); expect(e.css).toContain("width: auto !important"); expect(e.css).toContain("max-width: 100% !important");
        expect(e.log[0]).toContain("width: auto"); // 先以原值装的第一帧（过渡起点）里就带 width:auto：html 宽度不会在动画中途跳变
        p.set(300, { animate: false }); expect(reads).toBe(1); expect(e.css).toContain("margin-left: 300px"); expect(e.css).toContain("width: auto");
        p.set(0); expect(e.css).toContain("margin-left: 0px"); expect(e.css).toContain("width: auto"); // 收回动画进行中：缓解还在（页面不会先溢出再回位）
        e.advance(1000); expect(e.installed).toBe(false); expect(e.css).toBe(""); expect(p.state().installed).toBe(false);
        p.set(233, { animate: false }); expect(reads).toBe(2); // 每次重新推开都重新量（页面可能已变）
    });
    test("控制器：宽页面 / 没有 fitFacts / 量出来 null → 样式表里没有任何 width / max-width / min-width", () => {
        const e = env(); e.deps.fitFacts = () => F({ htmlW: 2600, bodyW: 2600 }); const p = createPagePush(e.deps); p.set(233, { animate: false });
        expect(e.css).not.toMatch(/width/); expect(p.fit()).toEqual(NO_FIT);
        const e2 = env(); const p2 = createPagePush(e2.deps); p2.set(233, { animate: false }); expect(e2.css).not.toMatch(/width/);
        const e3 = env(); e3.deps.fitFacts = () => null; createPagePush(e3.deps).set(233, { animate: false }); expect(e3.css).not.toMatch(/width/);
    });
});

describe("接线与源码约束（内容脚本 / 后台 / 设置 / 文案）", () => {
    test("content.ts：只有 pinned（不是 shown / peek）会推开；元素全屏立即恢复且 documentElement 全屏不算；teardown 先 pager.destroy；每次拖拽都不动画", () => {
        const c = strip(src("content.ts"));
        expect(c).toMatch(/pinnedNow = pinned;/); expect(c).not.toMatch(/pinnedNow = shown/);
        expect(c).toMatch(/fsActive = !!fe && fe !== document\.documentElement/); expect(c).toMatch(/host\.dataset\.fs = fsActive \? "1" : "0"; syncPush\(false\)/);
        expect(c.indexOf("pager.destroy()")).toBeGreaterThan(0); expect(c.indexOf("pager.destroy()")).toBeLessThan(c.indexOf("host.remove();"));
        expect(c).toMatch(/syncPush\(!instant && !dragging\)/); expect(c).toMatch(/setWidth\(r\.width\); syncPush\(false\)/);
        expect(c).toMatch(/render\(first\)/); // 新页面第一次状态不播推开动画
        expect(c).not.toMatch(/documentElement\.style|document\.body\.style|\.style\.setProperty\("margin/); // content.ts 自己不碰页面样式
    });
    test("pagePush.ts：唯一的页面样式写入口——adoptedStyleSheets（<style> 仅作兜底）+ 两处 inline 属性；没有 transform / padding / width / 控制台输出 / ErrorLog / chrome.*", () => {
        const c = strip(src("pagePush.ts"));
        expect(c).toMatch(/adoptedStyleSheets/); expect(c).not.toMatch(/documentElement\.style|body\.style|\.transform|zoom|\.padding/);
        expect(c.match(/setProperty\("(\w[\w-]*)"/g)!.toSorted()).toEqual(['setProperty("margin-left"', 'setProperty("margin-left"', 'setProperty("max-width"', 'setProperty("max-width"']);
        expect(c).not.toMatch(/@api\/ErrorLog|safe\(|console\.(error|log|warn)|chrome\./);
    });
    test("后台把 displayMode 放进状态消息；设置默认 push、选项 push / overlay；文案 zh / en 都有", async () => {
        await import("../src/plugins/inpageSidebar/i18n");
        const b = strip(src("background.ts"));
        expect(b).toMatch(/displayMode: DisplayMode;/); expect(b).toMatch(/displayMode: parseDisplayMode\(settings\.store\.displayMode\)/);
        for (const k of ["inpageSidebar.displayMode", "inpageSidebar.displayMode.push", "inpageSidebar.displayMode.overlay"]) for (const l of ["en", "zh"] as const) expect(LOCALES[l][k]).toBeTruthy();
        expect(LOCALES.zh["inpageSidebar.displayMode.push"]).toBe("推开页面"); expect(LOCALES.zh["inpageSidebar.displayMode.overlay"]).toBe("浮在页面上");
        expect(LOCALES.en["inpageSidebar.displayMode.push"]).toBe("Push the page"); expect(LOCALES.en["inpageSidebar.displayMode.overlay"]).toBe("Float over the page");
    });
    test("悬停浮出继续用弹簧：.box 默认 transition 仍是 SPRING；只有 data-curve=\"locked\"（进入 / 保持 / 离开推开）才换成 PUSH 曲线；content.ts 只在推开状态变化时设它", async () => {
        const { hostCss } = await import("../src/plugins/inpageSidebar/host.css"); const css = hostCss(); const sp = `transform ${SPRING.durationMs}ms ${SPRING.easing}`;
        expect(css).toContain(`.box { position: fixed;`); expect(css.match(new RegExp(sp.replace(/[().]/g, "\\$&"), "g"))!.length).toBe(2); // 隐藏态 + 展示态各一处，都是弹簧
        expect(css).toContain(':host([data-curve="locked"]) .box { transition: transform 80ms cubic-bezier(.25,.46,.45,.94), visibility 0s linear 80ms, left 80ms');
        expect(css).toContain(':host([data-curve="locked"]) .box[data-shown="1"] { transition: transform 80ms cubic-bezier(.25,.46,.45,.94), visibility 0s, left 80ms');
        const c = strip(src("content.ts"));
        expect(c).toMatch(/host\.dataset\.curve = on \|\| wasPush \? "locked" : "float";\s*\n\s*wasPush = on;/);
        // 悬停浮出只调 render()，不碰 data-curve / pager（pinned=false → on=false 且 wasPush=false → "float"）
    });
    test("设置对话框文案记着 ⚠ 已知限制（RTL 滚动条仍在侧栏下 / 视口宽度不变）：zh / en", async () => {
        await import("../src/plugins/inpageSidebar/i18n");
        expect(LOCALES.zh["inpageSidebar.displayMode.detail"]).toContain("RTL"); expect(LOCALES.zh["inpageSidebar.displayMode.detail"]).toContain("滚动条"); expect(LOCALES.zh["inpageSidebar.displayMode.detail"]).toContain("媒体查询");
        expect(LOCALES.en["inpageSidebar.displayMode.detail"]).toContain("scrollbar"); expect(LOCALES.en["inpageSidebar.displayMode.detail"]).toContain("media queries"); expect(LOCALES.en["inpageSidebar.displayMode.detail"]).toContain("vw");
    });
    test("host.css：调宽把手 = 8 px 热区（left = --i + --w − 4、top 11、高 100vh − 22）+ 4 px 可见竖条（平时透明，JS 悬停 .25 s 后 data-hot 淡入 .5，拖动常显）；旧「↗」按钮的样式已删", async () => {
        const { hostCss } = await import("../src/plugins/inpageSidebar/host.css"); const css = hostCss();
        expect(css).toContain(".handle { position: fixed; left: calc(var(--i) + var(--w) - 4px); top: 11px; width: 8px; height: calc(100vh - 22px); z-index: 2; cursor: ew-resize;");
        expect(css).toContain("left: -2px; top: 4px; width: 4px; height: calc(100% - 8px); border-radius: 4px; background: var(--bar);");
        expect(css).toContain("opacity: 0; transition: opacity 200ms linear 0s;"); expect(css).toContain('.handle[data-hot="1"] i { opacity: 0.5; }'); expect(css).toContain('.handle[data-drag="1"] i { opacity: 0.5; transition: none; }');
        expect(css).not.toContain(".native");
    });
});

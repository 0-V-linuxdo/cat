/*
 * 内容脚本“上下文失效”守卫（accept-live-52187 #1/#3）：扩展重载 / 卸载后，旧页面里残留的内容脚本仍在运行，
 * 每次事件 / 定时器 / 写盘都会报 “Extension context invalidated”（SettingsStore save/flush、peek 资格检查的 console.warn）。
 * 一旦发现 chrome.runtime.id 消失，或任何调用抛出 / 拒绝 /context invalidated/i，就整体停用本内容脚本：
 *   - 移除本脚本登记过的所有 DOM / window / document 监听，以及 chrome.runtime / storage 事件监听；
 *   - 清掉所有 setTimeout / setInterval / requestAnimationFrame / requestIdleCallback，断开所有 Mutation / Resize / Intersection 观察者；
 *     （SettingsStore 的防抖写盘定时器随之清掉；pagehide → flush 的监听随之移除；它自己的 save 也会因 runtime.id 缺失直接停写）
 *   - 之后 console.error / warn / log / info / debug 全部静默，未处理的错误 / Promise 拒绝也不再上报。
 * 做法：在内容脚本的隔离世界里（只影响本扩展自己的代码，不影响网页）包装这些入口；包装后的回调先检查上下文是否存活。
 * 只在 content 入口安装（src/entries/contentGuardInstall.ts 必须是 content.ts 的第一个 import）。
 */
export const INVALIDATED = /context invalidated/i;
export const isInvalidated = (e: unknown) => INVALIDATED.test(String((e as Error)?.message ?? e ?? ""));

type AnyFn = (...a: any[]) => any;
interface ChromeEvent { addListener(fn: AnyFn): void; removeListener(fn: AnyFn): void }
export interface GuardEnv {
    g: any;
    /** 当前扩展 id；失效时 undefined 或抛错 */
    runtimeId: () => string | undefined;
    /** 要接管 addListener 的 chrome 事件（runtime.onMessage 等） */
    chromeEvents: () => (ChromeEvent | undefined)[];
}
export interface ContentGuard { readonly dead: boolean; alive(): boolean; deactivate(): void; uninstall(): void; stats(): { listeners: number; timers: number; observers: number; chrome: number } }

const defaultEnv = (): GuardEnv => ({
    g: globalThis,
    runtimeId: () => (globalThis as any).chrome?.runtime?.id,
    chromeEvents: () => { const c = (globalThis as any).chrome; return [c?.runtime?.onMessage, c?.runtime?.onConnect, c?.storage?.onChanged, c?.storage?.local?.onChanged]; },
});

export function installContentGuard(env: GuardEnv = defaultEnv()): ContentGuard {
    const { g } = env;
    let dead = false;
    const restore: (() => void)[] = [];
    const patch = (obj: any, key: string, make: (orig: any) => any) => {
        if (!obj || typeof obj[key] !== "function") return;
        const orig = obj[key]; obj[key] = make(orig); restore.push(() => { obj[key] = orig; });
    };

    // ── 监听 / 定时器 / 观察者登记 ──
    const listeners = new Set<{ t: any; type: string; w: any; opts: any; rm: AnyFn }>();
    const wrapped = new WeakMap<object, AnyFn>();
    const timers = new Map<any, AnyFn>(); // id → clear
    const observers = new Set<{ disconnect(): void }>();
    const chromeL = new Set<{ ev: ChromeEvent; w: AnyFn }>();

    const alive = () => {
        if (dead) return false;
        let id: string | undefined; try { id = env.runtimeId(); } catch { id = undefined; }
        if (!id) { deactivate(); return false; }
        return true;
    };
    /** 回调包装：先查存活；同步抛出 / 异步拒绝 “context invalidated” → 停用并吞掉 */
    const guardFn = <F extends AnyFn>(fn: F): F => {
        if (typeof fn !== "function") return fn;
        let w = wrapped.get(fn);
        if (!w) {
            w = function (this: unknown, ...a: unknown[]) {
                if (!alive()) return undefined;
                try {
                    const r = fn.apply(this, a);
                    if (r && typeof (r as Promise<unknown>).then === "function") (r as Promise<unknown>).then(undefined, (e: unknown) => { if (isInvalidated(e)) deactivate(); });
                    return r;
                } catch (e) { if (isInvalidated(e) || dead) { deactivate(); return undefined; } throw e; }
            };
            wrapped.set(fn, w);
        }
        return w as F;
    };

    const ET = g.EventTarget?.prototype;
    let origRemove: AnyFn | undefined;
    const origAdd: AnyFn | undefined = ET?.addEventListener;
    if (ET) {
        origRemove = ET.removeEventListener;
        patch(ET, "addEventListener", orig => function (this: any, type: string, fn: any, opts?: any) {
            if (dead) return;
            const w = typeof fn === "function" ? guardFn(fn) : fn;
            if (w) listeners.add({ t: this, type, w, opts, rm: origRemove! });
            return orig.call(this, type, w, opts);
        });
        patch(ET, "removeEventListener", orig => function (this: any, type: string, fn: any, opts?: any) {
            const w = (typeof fn === "function" && wrapped.get(fn)) || fn;
            const cap = typeof opts === "boolean" ? opts : !!opts?.capture;
            for (const l of listeners) if (l.t === this && l.type === type && l.w === w && (typeof l.opts === "boolean" ? l.opts : !!l.opts?.capture) === cap) listeners.delete(l);
            return orig.call(this, type, w, opts);
        });
    }

    const timerPair = (setKey: string, clearKey: string) => {
        const clr = g[clearKey]?.bind(g);
        if (!clr) return;
        patch(g, setKey, orig => (fn: any, ...rest: unknown[]) => {
            if (dead) return 0;
            const once = setKey !== "setInterval";
            let id: any;
            const body = typeof fn === "function" ? guardFn(fn) : fn;
            const cb = typeof body === "function" && once ? function (this: unknown, ...a: unknown[]) { timers.delete(id); return body.apply(this, a); } : body;
            id = orig.call(g, cb, ...rest);
            timers.set(id, () => clr(id));
            return id;
        });
        patch(g, clearKey, orig => (id: any) => { timers.delete(id); return orig.call(g, id); });
    };
    timerPair("setTimeout", "clearTimeout");
    timerPair("setInterval", "clearInterval");
    timerPair("requestAnimationFrame", "cancelAnimationFrame");
    timerPair("requestIdleCallback", "cancelIdleCallback");

    for (const name of ["MutationObserver", "ResizeObserver", "IntersectionObserver", "PerformanceObserver"]) {
        const Orig = g[name];
        if (typeof Orig !== "function") continue;
        const Guarded = class extends Orig {
            constructor(cb: AnyFn, ...rest: unknown[]) { super(guardFn(cb), ...rest); observers.add(this as unknown as { disconnect(): void }); }
            observe(...a: unknown[]) { if (dead) return; return (super.observe as AnyFn)(...a); }
        };
        g[name] = Guarded; restore.push(() => { g[name] = Orig; });
    }

    for (const ev of env.chromeEvents()) {
        if (!ev || typeof ev.addListener !== "function") continue;
        const add = ev.addListener, rm = ev.removeListener;
        ev.addListener = function (fn: AnyFn) { if (dead) return; const w = guardFn(fn); chromeL.add({ ev, w }); try { return add.call(ev, w); } catch (e) { if (isInvalidated(e)) deactivate(); else throw e; } };
        ev.removeListener = function (fn: AnyFn) { const w = wrapped.get(fn) ?? fn; for (const x of chromeL) if (x.ev === ev && x.w === w) chromeL.delete(x); try { return rm.call(ev, w); } catch { /* 已失效 */ } };
        restore.push(() => { ev.addListener = add; ev.removeListener = rm; });
    }

    // ── console：失效相关的日志 → 停用并吞掉；停用后全部静默 ──
    const con = g.console;
    for (const k of ["error", "warn", "log", "info", "debug"]) patch(con, k, orig => (...a: unknown[]) => {
        if (dead) return;
        if (a.some(isInvalidated)) { deactivate(); return; }
        return orig.apply(con, a);
    });

    // ── 未处理的错误 / 拒绝：用原始 addEventListener 注册（不进登记表），停用后仍要吞 ──
    const onErr = (e: any) => { const r = e?.reason ?? e?.error ?? e?.message; if (dead || isInvalidated(r)) { deactivate(); e.preventDefault?.(); e.stopImmediatePropagation?.(); } };
    if (origAdd && origRemove && typeof g.addEventListener === "function") {
        for (const t of ["error", "unhandledrejection"]) origAdd.call(g, t, onErr, true);
        restore.push(() => { for (const t of ["error", "unhandledrejection"]) origRemove!.call(g, t, onErr, true); });
    }

    function deactivate() {
        if (dead) return;
        dead = true;
        for (const l of listeners) { try { l.rm.call(l.t, l.type, l.w, l.opts); } catch { /* */ } }
        listeners.clear();
        for (const clr of timers.values()) { try { clr(); } catch { /* */ } }
        timers.clear();
        for (const o of observers) { try { o.disconnect(); } catch { /* */ } }
        observers.clear();
        for (const { ev, w } of chromeL) { try { ev.removeListener.call(ev, w); } catch { /* 已失效 */ } }
        chromeL.clear();
    }

    return {
        get dead() { return dead; },
        alive, deactivate,
        uninstall() { for (const r of restore.reverse()) r(); restore.length = 0; },
        stats: () => ({ listeners: listeners.size, timers: timers.size, observers: observers.size, chrome: chromeL.size }),
    };
}

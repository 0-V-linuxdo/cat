/* 停表门（补丁 inpage-parked-timers-stop，rel55 第 18 层）：第 17 层的 ParkGate 让停放的 iframe「到点了也不做事」，但定时器仍在转、chrome.* 事件监听仍在收。
 * 本模块让它们**真的停**：门 = 与 ParkGate 同一判据（页内侧栏宿主 + 停放标记 + 文档隐藏）；门关上 → 清掉定时器 / 摘掉事件监听，门打开 → 补一次并立即重启。
 *   · parkedInterval(fn, ms)：门关 = clearTimeout（不再调度）；门开：距上次执行已 ≥ ms → 立刻补一次再按 ms 重启，否则只补足剩余时间（不会因为切回就多联网一次）。
 *   · whileActive(attach, detach, onResume?)：门关 = detach（摘 chrome.* 事件监听）；门开 = attach，再调 onResume（把摘掉期间可能错过的变化一次读回来）。
 *   · visibleInterval(fn, ms)：页面侧（内容脚本）用，门 = 文档隐藏；没有「停放」概念，不补执行（调用方在 visible 时自己补）。
 * 不碰 DOM、不重置 src、不摘 iframe：所以切回零重建；非页内侧栏宿主（原生侧栏 / 弹窗）一律退化成普通 setInterval / 直接 attach，行为不变。
 * 门状态由 visibilitychange 与 panel.ts 的 idle 消息（parkLifeChanged）两个入口驱动；只在第一次需要时挂一个 visibilitychange 监听。 */
import { isInpageHost, isParkedHost } from "@api/HostMode";

interface Sub { pause(): void; resume(): void }
const subs = new Set<Sub>();
let armed = false, gate = false;
const closedNow = () => isParkedHost() && document.visibilityState === "hidden";
/** 补丁 inpage-parked-timers-stop-b：当前是否「停放且隐藏」（与门同一判据，只读，不订阅）。停放时仍保持挂着的事件监听（媒体 / 下载托盘）用它决定走「便宜路径」 */
export const parkClosed = (): boolean => closedNow();

/** 门状态可能变了（panel.ts 撤 / 打停放标记后、文档可见性变化后调）：只在真的变化时通知订阅者 */
export function parkLifeChanged(): void {
    if (!armed) return;
    const c = closedNow(); if (c === gate) return;
    gate = c;
    for (const s of Array.from(subs)) { try { if (c) s.pause(); else s.resume(); } catch (e) { console.error("[ParkLife]", e); } }
}
const ensure = () => { if (!armed) { armed = true; gate = closedNow(); document.addEventListener("visibilitychange", parkLifeChanged); } else parkLifeChanged(); };

/** 定时器：停放且隐藏时不再调度；切回时若已到点补一次，并按原周期重启。返回停止函数（幂等） */
export function parkedInterval(fn: () => void, ms: number): () => void {
    if (!isInpageHost()) { const t = setInterval(fn, ms); return () => clearInterval(t); }
    ensure();
    let last = Date.now(), t: ReturnType<typeof setTimeout> | undefined, dead = false;
    const run = () => { last = Date.now(); try { fn(); } catch (e) { console.error("[ParkLife]", e); } };
    const arm = (d: number) => { t = setTimeout(() => { t = undefined; run(); if (!dead && !gate && t === undefined) arm(ms); }, d); };
    const sub: Sub = {
        pause() { if (t !== undefined) clearTimeout(t); t = undefined; },
        resume() { if (dead || t !== undefined) return; const el = Date.now() - last; if (el >= ms) { run(); if (!dead && t === undefined) arm(ms); } else arm(ms - el); },
    };
    subs.add(sub); if (!gate) arm(ms);
    return () => { dead = true; if (t !== undefined) clearTimeout(t); t = undefined; subs.delete(sub); };
}

/** 事件监听：停放且隐藏时摘掉（attach / detach 由调用方提供，须成对、可重复调用）；切回时重挂并调 onResume 补读。返回停止函数（幂等，会 detach） */
export function whileActive(attach: () => void, detach: () => void, onResume?: () => void): () => void {
    if (!isInpageHost()) { attach(); return () => detach(); }
    ensure();
    let on = false, dead = false;
    const sub: Sub = {
        pause() { if (on) { on = false; detach(); } },
        resume() { if (dead || on) return; on = true; attach(); onResume?.(); },
    };
    subs.add(sub); if (!gate) { on = true; attach(); }
    return () => { dead = true; subs.delete(sub); if (on) { on = false; detach(); } };
}

/** 页面侧：文档可见时才跑的周期任务（隐藏 = clearInterval，可见 = 重启）；不补执行。返回停止函数（幂等） */
export function visibleInterval(fn: () => void, ms: number): () => void {
    let t: ReturnType<typeof setInterval> | undefined;
    const start = () => { if (t === undefined) t = setInterval(fn, ms); };
    const stop = () => { if (t !== undefined) clearInterval(t); t = undefined; };
    const on = () => { if (document.visibilityState === "hidden") stop(); else start(); };
    on(); document.addEventListener("visibilitychange", on);
    return () => { stop(); document.removeEventListener("visibilitychange", on); };
}

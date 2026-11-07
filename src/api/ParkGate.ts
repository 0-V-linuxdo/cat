/* 停放门（补丁 inpage-parked-idle，rel55 第 17 层）：页内侧栏里「停放」（所在标签不是前台）且文档隐藏的 iframe，不做没人看得见的活。
 * 做法 = 只记脏位：停放时 unlessParked(key, fn) 不执行 fn，只记「key → 最后一次 fn」（同 key 合并）；切回（visibilitychange → visible，或宿主发来 idle:false）flushParked() 各执行一次。
 * 为什么是「停放 且 隐藏」而不是只看停放标记：停放标记由宿主 postMessage 异步打上 / 去掉，切回时文档先变可见、标记后撤；两者都成立才推迟 = 切回那一拍起所有工作立刻照常（首帧状态不落后），
 *   而只是隐藏没停放（窗口最小化 / 当前标签被遮挡）的 iframe 完全不受影响。
 * 不碰 DOM、不重置 src、不摘监听：只是推迟「渲染 / 轮询 / 网络刷新」，数据层（store / 监听）照常更新，所以切回时一次渲染就是最新状态。 */
import { isParkedHost } from "@api/HostMode";

const pending = new Map<string, () => void>();
let armed = false;

const idleNow = () => isParkedHost() && document.visibilityState === "hidden";

/** 执行 fn；停放（且隐藏）时改为只记脏位（同 key 合并，保留最后一次 fn），切回时由 flushParked 补做一次 */
export function unlessParked(key: string, fn: () => void): void {
    if (!idleNow()) { fn(); return; }
    pending.set(key, fn);
    if (!armed) { armed = true; document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") flushParked(); }); }
}

/** 补做停放期间记下的脏位：每个 key 一次（顺序 = 首次记下的顺序）。无脏位时零开销 */
export function flushParked(): void {
    if (!pending.size) return;
    const fns = [...pending.values()]; pending.clear();
    for (const f of fns) { try { f(); } catch (e) { console.error("[ParkGate]", e); } }
}

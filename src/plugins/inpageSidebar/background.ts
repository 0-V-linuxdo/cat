/* 页内侧边栏：后台（service worker）。
 * 约束（DESIGN.md 3.2 / 裁定 B）：sidePanel.open 只在**顶层同步监听**里调；本文件的 3 个顶层监听（contextMenus.onClicked、runtime.onMessage 的「切到 Chrome 侧边栏」、runtime.onConnect）
 * 在模块加载时同步注册，不经 @api/ChromeEvents（它在 bootstrap 之前缓冲），前面不 await；open 一律走 openPanelInGesture（core:sidePanelViolations 保持 []）。
 * E3：**不对任何标签调 setOptions({enabled:false})**（标签级预热已移除：Chrome ≥132 里它藏不住原生面板，见 patches/inpage-prewarm-tab/downgrade/README.md）；本文件唯一的 setOptions 是启动对账里的
 * setOptions({tabId, enabled:true})（不带 path，不创建标签级面板实例）。预热（prewarm）是设置项、默认关；「进受限页之前先切原生」（ensure-native）不碰任何标签选项，始终可用。 */
import { subscribe } from "@api/Events";
import { createPluginStore, type PluginStore } from "@api/Storage";
import { destinationNeedsNative, ENSURE_NATIVE_ACK, ENSURE_NATIVE_MSG, ensureTargetWindow, noteEnsureNative, senderIsInpageContext, setInpageProbe, SIDEBAR_SWITCH_ACK, SIDEBAR_SWITCH_MSG, type EnsureNativeMsg, type SidebarSwitchMsg } from "@api/HostMode";
import { closePanel, isPanelOpen, openPanelInGesture, setGestureRouter, takeColdGesture, takeColdReopenClose } from "@api/SidePanelGesture";
import { tr } from "@api/i18n";
import type { Cleanup } from "@utils/types";

import { ARC, AUTO_SWITCH, STATE_RESTORE, SUPPRESS_RESTORE, BADGE_TEXT, COLD_KEY_WAIT, COLD_KEY_WAIT_MS, COLD_START_CORRECTION, type DisplayMode, MENU_PREFIX, MENU_TOGGLE_ACTION, MENU_TOGGLE_PAGE, type Mode, MSG, NATIVE_SWITCH, PORT_NAME, PREWARM, PROTOCOL, STORE_KEY, TIMING } from "./constants";
import {
    clampWidth, decideEnsure, decideSwitchNative, decideToggle, type Facts, inheritIntent, isVisible, nextLastOpen, needsBadge, onNativeChanged, pageKind, parseDisplayMode, parsePrewarmMode, pingWithRetry, planActivation, planReconcile, planWindowOpen,
    planOffClose, shouldCorrectCold, shouldPinInpageAfterToggle, shouldRestoreInpage, shouldShowHost,
} from "./logic";
import { migratePrewarmTab, settings } from "./settings";
import { startTraceSwitch, trace, TRACE_MSG, TracedSet, traceFromHost, traceOn } from "./trace";
import { arrivedDuringOpen, decideSidebarSwitch, type HostWait, hostWaitValid } from "./switchAuto";
import { PREWARM_OPENED, RESTORE_ON_CLOSE } from "./constants";
import { nextPushKey } from "./pushDedup";
import { PrewarmOpened, RestoreOnClose, type StorageAreaLike } from "./prewarmOpened";

/** 后台 → 内容的完整状态（幂等：内容脚本每次都按它整体对齐） */
export interface StateMsg {
    type: "inpage:state";
    windowId: number; tabId: number;
    /** 本窗口的活动 iframe 是不是这个标签（裁定 F：一个窗口只保留一个） */
    active: boolean;
    show: boolean;
    nativeOpen: boolean;
    /** 预热设置开着（内容脚本据此决定要不要监听首次手势）；warm 恒为 false（标签级预热已移除，字段保留是为了与内容脚本 / 早实例的状态消息兼容） */
    prewarm: boolean; warm: boolean;
    /** 调试追踪开着（补丁 inpage-debug-trace）：只在开着时才有这个字段，内容脚本据此开自己的追踪；关着时消息与以前逐字节一致 */
    trace?: true;
    width: number;
    /** 显示方式（push | overlay）：content 据此决定常驻时是否推开页面 */
    displayMode: DisplayMode;
    hover: boolean;
    /** 设置 showHandle（补丁 12）：内容脚本据此渲染 / 摘掉右缘调宽把手的 3px 竖条（热区始终在；取代旧的「↗」切换按钮字段） */
    handle: boolean;
    /** 一次性提示：按钮切原生失败 */
    hint?: "switch-failed";
    /** 补丁 pinned-first-frame：原生→页内交接中（已发 close、原生端口还没断）的状态：内容脚本不播推开动画，直接摆上。只在交接窗口里才有这个字段，其余时候消息与以前逐字节一致 */
    instant?: true;
}
export interface HelloMsg { type: "hello"; proto: number; frame: "none" | "ready" | "blocked" }

interface Persist {
    /** 窗口意图：true / false 都落盘（补丁 rel62-intent-persist：false 也记 = 「用户在这个窗口收起过」；没有键 = 未知窗口 → 继承 lastOpen） */
    openByWin: Record<string, boolean>; width: number;
    /** 补丁 rel62-intent-persist：全局最近意图（只由 toggleFor 的用户决定改，见 logic.ts nextLastOpen）；新窗口 / 浏览器重启后的窗口继承它，没有 = 默认方式 inpage 时 true */
    lastOpen?: boolean;
    /** 补丁 rel62-intent-persist：开原生（预热 / ensure）而收起页内的窗口：落盘意图保持 true、内存里为 false；扩展重载 / 重启后据此恢复（restoreOnClose 只在 storage.session，会被清） */
    suppressedByWin?: Record<string, true>; /** 旧版本（标签级预热）落盘的「被我们 disable 的标签」；已不再读写，启动时删除 */ warmByWin?: Record<string, number[]> }
interface TabRec { tabId: number; windowId: number; url?: string; port?: chrome.runtime.Port; hostAlive: boolean; blocked: boolean; sentKey?: string /* 补丁 inpage-parked-timers-stop：这个端口上最近一次真正发出的状态（序列化）；rec 随端口新建，所以端口换了自然清空 */ }

export interface Controller {
    toggle(tab: chrome.tabs.Tab | undefined): void;
    nativeChanged(windowId: number): void;
    afterNativeSwitch(windowId: number, tabId: number | undefined, ok: boolean): void;
    /** 进受限页之前先切原生（同步，手势栈里） */
    ensure(m: EnsureNativeMsg, sender: chrome.runtime.MessageSender): void;
    /** 首次手势预热（同步，手势栈里；设置关 / 不满足条件 = 什么都不做） */
    prewarm(tab: chrome.tabs.Tab | undefined): void;
    /** 补丁 switch-auto：原生侧栏里点了标签行（激活已有标签）。**不需要手势**（只 close），异步判定也行 */
    sidebarSwitch(m: SidebarSwitchMsg): void;
    /** 层 6：同步裁定（只用 SW 内存里的宿主记录）；true = 已 close 原生并安排 SW 在关完后激活目标（调用方回 handled:true） */
    sidebarSwitchSync(m: SidebarSwitchMsg): boolean;
    host(port: chrome.runtime.Port): void;
    refresh(): void;
}

let bgActive = false;
let ctl: Controller | undefined;
/** 本窗口当前连着的原生面板端口数（顶层、不依赖核心的 open 集合：隐藏的预热面板会报 visible:false 把核心的 open 清掉） */
const panelPorts = new Map<number, Set<chrome.runtime.Port>>();
const panelAlive = (w: number) => (panelPorts.get(w)?.size ?? 0) > 0;
/** 补丁 inpage-off-wake-close：当前连着 ":r" 重连端口的窗口（_core/sidebar：「这个面板页在上一个 SW 之前就开着」才带 ":r"）。顶层同步登记（ctl 还没起来时到的端口也不丢）、端口断开时撤。
 *  只用于「SW 被设置写入唤醒、读到的设置已经是 Off」时认出「预热开的那个面板」（见 closeWokenOff）；用户之后自己新开的原生没有 ":r"，不会被认成它。 */
const reconnectedPanels = new Set<number>();
/** 控制器（ctl）还没起来时到的内容脚本端口（SW 冷启动：bootstrap 是异步的）。**必须在 onConnect 里同步挂一个 onMessage 监听把消息缓下来**：
 * 端口上没有监听器时收到的消息会被丢弃——内容脚本连上后只在 connect() 里发**一次** hello，丢了它 rec.hostAlive 就永远是 false，之后每次 Alt+S 都判「宿主不在」→ 回落原生（实测，见 patches/inpage-cold-start/README.md）。
 * ctl 起来后 onHost 先装自己的监听、摘掉这个缓冲监听，再把缓下来的消息按序重放。 */
interface PendingPort { port: chrome.runtime.Port; msgs: unknown[]; tap: (m: unknown) => void }
/** 层 6：close 之后最多等这么久再由 SW 激活目标（close 的 promise 没回也照样激活） */
const CLOSE_WAIT_MS = 400;
const pendingPorts: PendingPort[] = [];
const isServiceWorker = typeof document === "undefined";

/** 「切到 Chrome 侧边栏」按钮的消息（⚠ 待 E8 实测）：必须同步、顶层、前面没有 await。
 * 没有 bgActive 判断：SW 冷启动时 bootstrap 还没完成，手势不能等；这条消息只会来自已启用插件的内容脚本 / iframe。 */
function onSwitchNativeMessage(msg: unknown, sender: chrome.runtime.MessageSender): void {
    const m = msg as { type?: string; source?: "host" | "frame" } | undefined;
    if (m?.type !== MSG.switchNative || !NATIVE_SWITCH.viaClick || !m.source || !NATIVE_SWITCH.sources.includes(m.source)) return;
    const wid = sender.tab?.windowId, tabId = sender.tab?.id;
    if (wid == null) return;
    // E8 变体：先同栈 setOptions（只「启用」，绝不 disable，E3），再 open。默认关
    if (NATIVE_SWITCH.setOptionsFirst && tabId != null) chrome.sidePanel.setOptions({ tabId, path: "sidepanel.html", enabled: true }).catch(() => undefined);
    if (isPanelOpen(wid)) { ctl?.afterNativeSwitch(wid, tabId, true); return; } // 已开着：不再 open；预热窗口里还要把当前标签 enable（afterNativeSwitch 里做）
    openPanelInGesture(wid, ok => ctl?.afterNativeSwitch(wid, tabId, ok)); // 同一调用栈
}

/** 进受限页之前先切原生（⚠ 待 E8：手势经 iframe / 弹窗 / 内容脚本的 runtime.sendMessage 到 SW 是否有效；内容脚本这条路 E7 实测可用）。
 * 必须同步、顶层、前面没有 await；没有 bgActive 判断（冷启动 SW 的手势不能等）。只信自己扩展的发送者。 */
function onEnsureNativeMessage(msg: unknown, sender: chrome.runtime.MessageSender, sendResponse?: (r?: unknown) => void): void {
    const m = msg as Partial<EnsureNativeMsg> | undefined;
    if (m?.type !== ENSURE_NATIVE_MSG || sender.id !== chrome.runtime?.id || (m.kind !== "create" && m.kind !== "activate" && m.kind !== "navigate") || !destinationNeedsNative(m.url, m.kind)) return;
    // patch 07：open 在上面这一栈里同步发出之后，**同步** sendResponse(ack)，页面端等到 ack 才导航（顺序保证；ack = open 已发出，不等它 resolve）。finally：哪怕里面抛错也要应答，页面端不用等满超时
    try {
        noteEnsureNative(); // patch 08：命令栏弹窗的失焦即关据此延后（sidePanel.open 会让焦点离开弹窗）
        if (ctl) { ctl.ensure(m as EnsureNativeMsg, sender); return; }
        const wid = ensureTargetWindow(sender.url, sender.tab?.windowId, m.windowId); // 冷启动：路由 / 状态还没起来，只做最小动作——没开就开（已开着再 open 无害）
        if (wid != null && !isPanelOpen(wid)) openPanelInGesture(wid);
    } finally { try { sendResponse?.({ type: ENSURE_NATIVE_ACK }); } catch { /* 发送端已走 */ } }
}
/** 首次手势预热：只有 ctl 起来了才处理（预热要读设置和窗口状态；冷启动 SW 里的首次手势不预热，下一次再来） */
function onPrewarmMessage(msg: unknown, sender: chrome.runtime.MessageSender): void {
    if ((msg as { type?: string } | undefined)?.type !== MSG.prewarm || sender.id !== chrome.runtime?.id) return;
    if (traceOn()) trace("prewarm.msg", { tab: sender.tab?.id, win: sender.tab?.windowId, from: (msg as { source?: string }).source, ctl: !!ctl }); // ctl 不在 = SW 冷启动，这次手势被丢（下一次再来）
    ctl?.prewarm(sender.tab);
}

/** 补丁 switch-auto：原生侧栏 / 非页内弹窗里点了标签行 → 目的地是普通网页 → 后台把原生关掉、恢复页内。
 * 只信自己扩展的发送者；页内 iframe / via=inpage 弹窗不处理（它们的方向是 ensure-native）。不需要手势（close），所以这里没有「必须同步」的约束，但仍放在同一个顶层监听里（SW 冷启动时 ctl 还没起来 = 丢弃，原生保持，行为同补丁前）。 */
function onSidebarSwitchMessage(msg: unknown, sender: chrome.runtime.MessageSender, sendResponse?: (r?: unknown) => void): void {
    const m = msg as Partial<SidebarSwitchMsg> | undefined;
    if (m?.type !== SIDEBAR_SWITCH_MSG || sender.id !== chrome.runtime?.id || !Number.isInteger(m.tabId) || senderIsInpageContext(sender.url)) return;
    const sm: SidebarSwitchMsg = { type: SIDEBAR_SWITCH_MSG, tabId: m.tabId!, ...(typeof m.url === "string" ? { url: m.url } : {}) };
    if (m.activate === true) { // 层 6：同步裁定 + 同步 ack（顶层同步 onMessage；冷 SW / 无记录 = handled:false，页面照老路自己激活）
        let handled = false; try { handled = ctl?.sidebarSwitchSync(sm) ?? false; } finally { try { sendResponse?.({ type: SIDEBAR_SWITCH_ACK, handled }); } catch { /* 发送端已走（原生页被销毁） */ } }
        return;
    }
    ctl?.sidebarSwitch(sm);
}

if (isServiceWorker && typeof chrome !== "undefined") {
    chrome.contextMenus?.onClicked?.addListener((info, tab) => {
        if (!bgActive || typeof info.menuItemId !== "string" || !info.menuItemId.startsWith(MENU_PREFIX)) return;
        ctl?.toggle(tab); // 同一调用栈（里面最多同步 openPanelInGesture / closePanel）
    });
    chrome.runtime?.onMessage?.addListener((msg, sender, sendResponse) => { onSwitchNativeMessage(msg, sender); onEnsureNativeMessage(msg, sender, sendResponse); onPrewarmMessage(msg, sender); onSidebarSwitchMessage(msg, sender, sendResponse); return false; }); // ensure 的 ack 是同步 sendResponse，所以仍返回 false（不保持通道）
    chrome.runtime?.onConnect?.addListener(port => {
        if (port.name === PORT_NAME) {
            if (ctl) ctl.host(port);
            else {
                const msgs: unknown[] = []; const tap = (m: unknown) => { msgs.push(m); }; port.onMessage.addListener(tap); // 同步、在任何 await 之前
                const entry: PendingPort = { port, msgs, tap }; pendingPorts.push(entry);
                setTimeout(() => { if (pendingPorts.includes(entry)) { pendingPorts.splice(pendingPorts.indexOf(entry), 1); try { port.disconnect(); } catch { /* 已断 */ } } }, 10_000);
            }
            return;
        }
        const m = /^panel:(\d+)(:r)?$/.exec(port.name); // 原生侧栏的端口：核心的监听稍后才登记 open 集合，所以延后一拍再读 isPanelOpen
        if (m) {
            const w = Number(m[1]); const set = panelPorts.get(w) ?? new Set<chrome.runtime.Port>(); set.add(port); panelPorts.set(w, set);
            if (m[2]) reconnectedPanels.add(w);
            if (traceOn()) trace("panelPort.connect", { w, name: port.name, ports: set.size, ctl: !!ctl });
            setTimeout(() => ctl?.nativeChanged(w), 0);
            port.onDisconnect.addListener(() => { set.delete(port); if (m[2] && !set.size) reconnectedPanels.delete(w); if (traceOn()) trace("panelPort.disconnect", { w, name: port.name, ports: set.size }); setTimeout(() => ctl?.nativeChanged(w), 0); });
        }
    });
}

let storeRef: PluginStore<Persist> | undefined;
const getStore = () => storeRef ??= createPluginStore<Persist>(STORE_KEY, () => ({ openByWin: {}, width: ARC.defaultWidth }));

export function startBackground(): Cleanup {
    const store = getStore();
    const offTrace = startTraceSwitch(() => pushAll());
    const tabs = new Map<number, TabRec>();
    const activeByWin: Record<number, number | undefined> = {};
    const lastActive = new Map<number, boolean>();
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const later = (fn: () => void, ms: number) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); };
    const cold = takeColdGesture();
    const coldCandidate = COLD_START_CORRECTION ? cold : undefined;
    let coldKey = COLD_KEY_WAIT && !COLD_START_CORRECTION && cold?.opened ? cold : undefined; // 第 8 层：冷启动那次 ⌃S 开了原生 → 有界窗口内等宿主 hello / 原生端口，来了就纠偏
    const coldKeyUntil = Date.now() + COLD_KEY_WAIT_MS; // 从 start() 起算（SW 启动时间不占窗口）；过期 = 保留原生

    /* 内存镜像是权威（store.update 是异步的：update 返回前 store.get() 还是旧值）；store 只负责落盘 + SW 重启后恢复。 */
    const mem: Persist = { openByWin: {}, width: ARC.defaultWidth };
    let widthTouched = false;
    /** 补丁 rel62-intent-persist：意图三态——有键 = 这个窗口自己的记录；没键 = 未知窗口（新窗口 / 重启后 id 变了 / 全新安装）→ 继承全局最近意图（logic.ts inheritIntent） */
    const knownWin = (w: number) => Object.prototype.hasOwnProperty.call(mem.openByWin, w);
    let lastOpen: boolean | undefined; let lastOpenTouched = false;
    const suppressed = new Set<number>(); // 内存镜像：落盘 suppressedByWin 的窗口
    const bootSuppressed = new Set<number>(); // 启动时从落盘 suppressedByWin 恢复、还没定夺的窗口
    let bootFresh = false; // 本次启动是扩展重载 / 浏览器重启（storage.session 里没有存活键）；SW 回收 = false（见 constants.ts SUPPRESS_RESTORE）
    const intentOf = (w: number) => knownWin(w) ? !!mem.openByWin[w] : inheritIntent(lastOpen, settings.store.defaultMode === "native" ? "native" : "inpage");
    /** o.suppress：开原生而收起页内（openNativeForWindow 且原来开着）——内存意图 false，落盘意图保持 true + suppressedByWin 标记。
     *  其余 false（没带 suppress）若内存已是 false：不动（保留已有的 suppressed 标记，例如原生打开后 nativeChanged 的 onNativeChanged 再清一次）；true 一律清标记。 */
    const setIntent = (w: number, v: boolean, o: { suppress?: boolean } = {}) => {
        const sup = !v && !!o.suppress;
        if (knownWin(w) && intentOf(w) === v && (v ? !suppressed.has(w) : !sup || suppressed.has(w))) return;
        if (traceOn()) trace("intent", { w, from: intentOf(w), to: v, ...(sup ? { suppress: true } : {}) });
        mem.openByWin[w] = v; if (sup) suppressed.add(w); else { suppressed.delete(w); bootSuppressed.delete(w); }
        void store.update(d => { // 只有后台写 data:inpageSidebar
            if (sup) { d.openByWin[w] = true; (d.suppressedByWin ??= {})[w] = true; return; }
            d.openByWin[w] = v; if (d.suppressedByWin) { delete d.suppressedByWin[w]; if (!Object.keys(d.suppressedByWin).length) delete d.suppressedByWin; }
        });
    };
    /** 强制清 suppressed（不恢复的分支：restoreOnClose 作废 / 恢复被设置关掉）：落盘意图跟内存（false）走 */
    const dropSuppressed = (w: number) => { if (!suppressed.has(w)) return; if (traceOn()) trace("intent.unsuppress", { w }); suppressed.delete(w); bootSuppressed.delete(w); const v = intentOf(w); void store.update(d => { d.openByWin[w] = v; if (d.suppressedByWin) { delete d.suppressedByWin[w]; if (!Object.keys(d.suppressedByWin).length) delete d.suppressedByWin; } }); };
    const forgetWin = (w: number) => { delete mem.openByWin[w]; suppressed.delete(w); bootSuppressed.delete(w); void store.update(d => { delete d.openByWin[w]; if (d.suppressedByWin) { delete d.suppressedByWin[w]; if (!Object.keys(d.suppressedByWin).length) delete d.suppressedByWin; } }); };
    const setLastOpen = (v: boolean | undefined) => { if (v === undefined) return; lastOpenTouched = true; if (lastOpen === v) return; if (traceOn()) trace("lastOpen", { from: lastOpen ?? null, to: v }); lastOpen = v; void store.update(d => { d.lastOpen = v; }); };
    /* —— 窗口级预热状态（内存） —— */
    /** 补丁 t903u-tab-switch：窗口级预热 open 是哪个标签里的手势发起的（windowId → tabId）；只活在「open 已发出、面板端口还没落定」这一段。见 nativeChanged 末尾的到达复查 */
    const prewarmOrigin = new Map<number, number>();
    const pendingWin = new TracedSet("pendingWin"); // 窗口级 open（ensure 冷路径 / 窗口级预热）已发出、面板端口还没出现
    const prewarmOpened = new PrewarmOpened({ // 补丁 inpage-prewarmopened-persist：和原来的 Set 同接口，另外镜像到 chrome.storage.session（SW 回收后恢复；不可用 = 回退内存）。追踪：经 onOp 进 debug-trace（语义同 TracedSet）
        now: () => Date.now(), area: (chrome.storage as { session?: StorageAreaLike } | undefined)?.session, tabOf: w => activeByWin[w],
        getTab: id => Promise.resolve().then(() => chrome.tabs.get(id)), hasWindow: id => Promise.resolve().then(() => chrome.windows.get(id)).then(() => true, () => false),
        onOp: (op, info) => { if (traceOn()) trace(`prewarmOpened.${op}`, info); },
    }); // 窗口的原生是**首次手势预热（window）**开的（只记内存、只由 prewarmNow 打标；ensure / Alt+S 回落 / 图标 / 用户自己开的都没有）：预热方式改成 off 时据此 close({windowId})。SW 重启后丢失 = 不关（保守：宁可留着也不误关用户自己开的）
    const restoreOnClose = new RestoreOnClose({ // 为进受限页 / 窗口级预开而收起了页内的窗口：原生关了要恢复。补丁 inpage-restoreonclose-persist：同第 10 层的存取层（另一个 session 键），SW 回收后恢复；不可用 = 回退内存。追踪名不变（restoreOnClose.add / delete / clear）
        now: () => Date.now(), area: (chrome.storage as { session?: StorageAreaLike } | undefined)?.session, tabOf: w => activeByWin[w],
        getTab: id => Promise.resolve().then(() => chrome.tabs.get(id)), hasWindow: id => Promise.resolve().then(() => chrome.windows.get(id)).then(() => true, () => false),
        key: RESTORE_ON_CLOSE.key, ttlMs: RESTORE_ON_CLOSE.ttlMs, loadTimeoutMs: RESTORE_ON_CLOSE.loadTimeoutMs,
        onOp: (op, info) => { if (traceOn()) trace(`restoreOnClose.${op}`, info); },
    });
    /** 「到达 / 握手」类自动切换（原生 → 页内）只认**本 SW 生命里打的标**：从存储恢复来的标记（restored）只用于「原生关了 → 恢复页内」。
     *  SW 回收后所有标签的内容脚本会重连、各发一次 hello——如果恢复来的标记也算，重连的 hello 会被当成「到达普通页」，把用户正开着的原生关掉（误切）。 */
    const arrivalMarked = (w: number) => restoreOnClose.has(w) && !restoreOnClose.restored.has(w);
    const prewarmMode = () => parsePrewarmMode(settings.store.prewarm);
    /** 补丁 pinned-first-frame：原生→页内交接窗口。sidebarSwitch 一发 close，原生面板的页面要再过 ≈350 ms 端口才断（nativeChanged 才恢复意图并 push），这段时间视口早已变宽（≈+40 ms）、页内却还没展开 = 内容先全宽再被挤开。
     *  交接中的窗口在状态里按「意图已恢复」算（只影响状态下发，不改真正的意图 / 持久化——意图仍由端口断开后的 nativeChanged 恢复），close 发出后立刻 pushWindow；目的标签此时还没被激活（隐藏页：推开量静默写好），激活的第一帧就是推开的。
     *  清除：原生端口真的断了（nativeChanged）/ 窗口关了 / close 失败 / 插件停用。 */
    const handoff = new Set<number>();
    /** 交接时等目的标签「已摆好」的回执（内容脚本收到 instant 状态并渲染后发 {type:"applied"}）：先收到回执再激活，激活后的第一帧就是推开的；HANDOFF_ACK_MS 内没回（端口死 / 状态与上次相同没下发）= 照样激活 */
    const handoffAck = new Map<number, () => void>(); const HANDOFF_ACK_MS = 150;
    const showingNative = (w: number) => isPanelOpen(w);
    /** 启动对账（防御性）：标签级选项只在浏览器内存里（SW 重启保持、扩展重载清除、浏览器重启丢失），旧版本的标签级预热可能在 SW 重启后留下 enabled:false 的标签、而我们已没有记录。
     *  按 getOptions 的实际值把它们 enable。**只发 {tabId, enabled:true}，不带 path**：带 path 会创建标签级面板实例（与全局实例不同），close({windowId}) 在该标签活动时关不掉它（Chromium CloseGlobalExtensionSidePanel）。
     *  这是整个后台唯一的 sidePanel.setOptions；不 open、不 close，不会因此打开原生。返回 enable 的标签数（测试 / 诊断用）。 */
    const reconcileTabs = async (): Promise<number> => {
        try {
            const ts = await chrome.tabs.query({});
            const infos = await Promise.all(ts.filter(t => t.id != null).map(async t => ({
                id: t.id!, enabled: (await Promise.resolve(chrome.sidePanel.getOptions?.({ tabId: t.id! })).catch(() => undefined))?.enabled as boolean | undefined,
            })));
            const ids = planReconcile(infos);
            for (const id of ids) chrome.sidePanel.setOptions({ tabId: id, enabled: true }).catch(() => undefined);
            return ids.length;
        } catch { return 0; }
    };
    const factsFor = (w: number, rec: TabRec | undefined, url?: string): Facts => ({
        nativeOpen: showingNative(w), intent: intentOf(w) || handoff.has(w), defaultMode: (settings.store.defaultMode === "native" ? "native" : "inpage") as Mode,
        kind: pageKind(url ?? rec?.url), hostAlive: !!rec?.hostAlive, frameBlocked: !!rec?.blocked,
    });
    const stateFor = (rec: TabRec, hint?: StateMsg["hint"]): StateMsg => {
        const f = factsFor(rec.windowId, rec);
        const active = activeByWin[rec.windowId] === rec.tabId;
        return {
            type: "inpage:state", windowId: rec.windowId, tabId: rec.tabId, active, show: shouldShowHost(f), nativeOpen: f.nativeOpen,
            prewarm: prewarmMode() !== "off", warm: false, ...(traceOn() ? { trace: true as const } : {}), ...(handoff.has(rec.windowId) ? { instant: true as const } : {}),
            width: mem.width, displayMode: parseDisplayMode(settings.store.displayMode), hover: !!settings.store.hoverReveal, handle: !!settings.store.showHandle, ...(hint ? { hint } : {}),
        };
    };
    /** 补丁 inpage-tabswitch-noreload：意图 / 宽度（mem）要等 store 读完才是真值。冷 SW 里 hello 的重放在 start 同一拍、早于读完 → 第一条状态是 show:false + 默认宽，
     *  切回标签时内容脚本据此先收起再展开（页面推开量也 228↔真实宽来回）。读完（或失败 / 超时）之前不下发；读完后 restoreMem 里的 pushAll 补发（含这期间到的所有 hello）。
     *  带 hint 的（切原生失败提示）照发：它们只来自用户手势，不会出现在这几毫秒里。热路径（SW 活着）memReady 早已为真，行为不变。 */
    let memReady = false;
    const pushRec = (rec: TabRec, hint?: StateMsg["hint"], force?: boolean) => {
        if (!rec.port || (!memReady && !hint)) return;
        const s = stateFor(rec, hint); lastActive.set(rec.tabId, s.active);
        // 补丁 inpage-parked-timers-stop：同一个端口上状态与上次发出的完全相同就不再发（SPA 每次 pushState、设置刷新、重复 pushWindow 对 N 个标签各发一条「什么都没变」的状态，内容脚本收到还要走一遍 render）。
        // 状态变了照常发（切回首帧所需的新状态不延后）；hint（切原生失败提示）与 hello 的回复（force）永远发——它们是「请求—应答」，不是广播。
        const key = nextPushKey(rec.sentKey, s, !!hint || !!force); if (key == null) { if (traceOn()) trace("pushRec.skip", { tab: rec.tabId, w: rec.windowId }); return; }
        if (traceOn()) trace("pushRec", { tab: rec.tabId, w: rec.windowId, active: s.active, show: s.show, nativeOpen: s.nativeOpen, intent: intentOf(rec.windowId), hostAlive: rec.hostAlive, hint: hint ?? null });
        try { rec.port.postMessage(s); rec.sentKey = key; /* 发成功才记 */ } catch { /* 端口已断：onDisconnect 会清 */ }
    };
    const syncBadge = (w: number) => {
        const id = activeByWin[w]; if (id == null || !chrome.action?.setBadgeText) return;
        const rec = tabs.get(id);
        void chrome.action.setBadgeText({ tabId: id, text: needsBadge(factsFor(w, rec)) ? BADGE_TEXT : "" }).catch(() => undefined);
    };
    const pushWindow = (w: number) => { if (traceOn()) trace("pushWindow", { w, intent: intentOf(w), nativeOpen: showingNative(w), panelAlive: panelAlive(w), pending: pendingWin.has(w) }); for (const r of tabs.values()) if (r.windowId === w) pushRec(r); syncBadge(w); };
    const pushAll = () => { const ws = new Set<number>(); for (const r of tabs.values()) { pushRec(r); ws.add(r.windowId); } for (const w of ws) syncBadge(w); };

    /** L2 主动探测（tabs.sendMessage → 内容脚本，frameId 0）；失败 = hostAlive false */
    const verify = async (rec: TabRec) => {
        if (!rec.port) return;
        const r = await pingWithRetry<{ ok?: boolean; proto?: number }>(() => chrome.tabs.sendMessage(rec.tabId, { type: MSG.status }, { frameId: 0 }), { ms: TIMING.pingMs, retries: TIMING.pingRetries });
        if (!r?.ok || r.proto !== PROTOCOL) { rec.hostAlive = false; pushWindow(rec.windowId); }
    };

    /** 窗口级预热（设置 prewarm=window）：页面里的首次真实手势 → 同一调用栈里 open({windowId})，不 setOptions、不 disable 任何标签；原生打开后页内按互斥收起，原生关闭时恢复（restoreInpageOnClose）。 */
    const prewarmNow = (tab: Partial<chrome.tabs.Tab> | undefined) => {
        const w = tab?.windowId, id = tab?.id; if (w == null || id == null) return;
        activeByWin[w] = id;
        const wp = planWindowOpen({ mode: prewarmMode(), defaultMode: settings.store.defaultMode === "native" ? "native" : "inpage", nativeOpen: panelAlive(w) || isPanelOpen(w), pending: pendingWin.has(w), activeTabId: id, activeKind: pageKind(tab?.url ?? tabs.get(id)?.url) });
        if (traceOn()) trace("prewarm.plan", { w, tab: id, go: wp.go, why: wp.go ? undefined : wp.why, mode: prewarmMode(), panelAlive: panelAlive(w), panelOpen: isPanelOpen(w), pending: pendingWin.has(w), intent: intentOf(w) });
        if (wp.go) openNativeForWindow(w, "prewarm", id);
    };
    /** 窗口级 open（ensure 的冷路径 / 窗口级预热共用）：同一调用栈；成功后页内收起，并记住「原生关了要恢复页内」。 */
    const openNativeForWindow = (w: number, source: "prewarm" | "ensure" = "ensure", originTab?: number) => {
        const hadIntent = intentOf(w); pendingWin.add(w);
        if (source === "prewarm" && originTab != null) prewarmOrigin.set(w, originTab); else prewarmOrigin.delete(w); // 补丁 t903u-tab-switch
        if (traceOn()) trace("openNative.call", { w, source, hadIntent });
        if (source === "prewarm") prewarmOpened.add(w); else prewarmOpened.delete(w); // 打标在同一调用栈里（open 的 promise 回来之前设置就可能被改）；ensure 开的原生不属于「预热」，不随设置改 off 关闭
        openPanelInGesture(w, ok => {
            if (traceOn()) trace("openNative.result", { w, source, ok, hadIntent, intentNow: intentOf(w), panelAlive: panelAlive(w), panelOpen: isPanelOpen(w) });
            if (!ok) { pendingWin.delete(w); prewarmOpened.delete(w); prewarmOrigin.delete(w); return; }
            later(() => { pendingWin.delete(w); nativeChanged(w); }, PREWARM.connectWaitMs); // ⛔ 占位：一直没有端口 = 没开成
            if (hadIntent && PREWARM.restoreInpageOnClose) restoreOnClose.add(w);
            setIntent(w, false, { suppress: hadIntent && PREWARM.restoreInpageOnClose }); pushWindow(w); // 补丁 rel62-intent-persist：不删落盘意图，记 suppressed（重载 / 重启后恢复）
        });
    };
    const ensureNative = (m: EnsureNativeMsg, sender: chrome.runtime.MessageSender) => {
        const w = ensureTargetWindow(sender.url, sender.tab?.windowId, m.windowId); if (w == null) return; // patch 08：弹窗的 sender.tab 是弹窗自己的窗口
        const act = decideEnsure({ showing: showingNative(w) });
        if (act === "open") openNativeForWindow(w); // 同一调用栈；原生优先：开了就让页内收起，原生关了再恢复
    };

    /* —— 补丁 switch-auto：原生 → 页内（不需要手势：只 close）——
     * 判定全在纯函数 decideSidebarSwitch；这里只收集事实、执行。执行 = 打 restoreOnClose 标记 + closePanel(w)：意图**不在这里改**，等原生面板端口真的断开（nativeChanged）
     * 再由既有的「原生关了恢复页内」分支 setIntent(true) 并 pushWindow——这样中间任何一次 nativeChanged（原生还在 → onNativeChanged 清意图）都不会把刚设的意图冲掉。
     * 与 tab-switch 的 show / active 无关：show 只看窗口级意图，所以恢复意图的那一次 push，目的标签（哪怕还没激活）的宿主一起 show:true，到达时已展开。 */
    const awaitHost = new Map<number, HostWait>();
    const evalSidebarSwitch = (w: number, tabId: number, url: string | undefined, requireMarked: boolean, activate = false): boolean => {
        const rec = tabs.get(tabId);
        const d = decideSidebarSwitch({
            enabled: requireMarked ? AUTO_SWITCH.onArrive : AUTO_SWITCH.viaSidebar, requireMarked, restoreMarked: arrivalMarked(w), nativeOpen: showingNative(w),
            defaultMode: (settings.store.defaultMode === "native" ? "native" : "inpage") as Mode,
            targetKind: pageKind(rec?.url ?? url), targetHostAlive: !!rec?.hostAlive, targetBlocked: !!rec?.blocked,
        });
        if (d.act === "wait-host") { awaitHost.set(tabId, { windowId: w, until: Date.now() + AUTO_SWITCH.hostWaitMs, requireMarked }); return false; }
        awaitHost.delete(tabId);
        if (d.act !== "to-inpage") return false;
        restoreOnClose.add(w); pendingWin.delete(w);
        const closed = closePanel(w); // 不需要手势；状态立即更新（isPanelOpen 为假），面板端口断开后 nativeChanged 恢复意图并 push
        handoff.add(w); pushWindow(w); // 补丁 pinned-first-frame：不等端口断开（≈350 ms），close 一发就把「已展开」推给本窗口所有宿主（含还没激活的目的标签）
        void Promise.resolve(closed).catch(() => { if (handoff.delete(w)) pushWindow(w); }); // close 失败：原生还在，撤回
        if (activate) { // 层 6：关完原生再激活目标（原生页文档会被 close 销毁，激活不能交给它）；close 400 ms 内没回 = 照样激活
            const go = () => { handoffAck.delete(tabId); void chrome.tabs.update(tabId, { active: true }).catch(() => undefined); };
            const closeDone = new Promise<void>(res => { later(res, CLOSE_WAIT_MS); Promise.resolve(closed).then(() => res(), () => res()); });
            const applied = new Promise<void>(res => { if (!rec?.port) { res(); return; } handoffAck.set(tabId, res); later(res, HANDOFF_ACK_MS); }); // 补丁 pinned-first-frame：目的标签先摆好再激活
            void Promise.all([closeDone, applied]).then(go);
        }
        return true;
    };
    /** 到达某个标签（onActivated）：只处理「原生是我们为进受限页而开的」窗口；目的标签 url 未知（没握手过的普通页 / 受限页都不在 tabs 里）→ 问一次 tabs.get */
    const arriveCheck = (w: number, tabId: number) => {
        const url = tabs.get(tabId)?.url;
        if (url) { evalSidebarSwitch(w, tabId, url, true); return; }
        void chrome.tabs.get(tabId).then(t => { if (activeByWin[w] === tabId) evalSidebarSwitch(t.windowId, tabId, t.url || t.pendingUrl, true); }, () => undefined); // 补丁 inpage-discarded-tab：未提交 / 刚丢弃的标签 url 是空串（不是 undefined），退到 pendingUrl（同 pinnedTabs/model.ts tabUrl），否则 pageKind("") = no-url 被当成受限页
    };
    const sidebarSwitchSync = (m: SidebarSwitchMsg): boolean => {
        const rec = tabs.get(m.tabId); if (!rec) { sidebarSwitch(m); return false; } // 没有宿主记录（冷 SW / 没握手 / 休眠的标签）：不接管，页面照老路激活；补丁 inpage-discarded-tab：这里必须**自己**起异步的 sidebarSwitch（tabs.get → wait-host 登记等 hello），页面端在 handled:false 之后并不会再发老的不带 activate 的消息（navigateAfterNative 走了 sidebarSwitchAck 就不调 ensureNativeAck / notifySidebarSwitch），否则休眠标签重载握手后没人把原生切回页内
        return evalSidebarSwitch(rec.windowId, m.tabId, m.url, false, true);
    };
    const sidebarSwitch = (m: SidebarSwitchMsg) => {
        const rec = tabs.get(m.tabId);
        if (rec) { evalSidebarSwitch(rec.windowId, m.tabId, m.url, false); return; }
        void chrome.tabs.get(m.tabId).then(t => { if (t.windowId != null) evalSidebarSwitch(t.windowId, m.tabId, t.url || t.pendingUrl || m.url, false); }, () => undefined);
    };

    /** 手势里的切换：同步决定。viaRouter 时原生的开 / 关交回核心（返回 "native"），否则这里自己 openPanelInGesture / closePanel */
    const toggleFor = (tab: Partial<chrome.tabs.Tab> | undefined, viaRouter: boolean): "inpage" | "native" => {
        const w = tab?.windowId; if (w == null) return "native";
        if (tab?.id != null) activeByWin[w] = tab.id;
        const rec = tab?.id != null ? tabs.get(tab.id) : undefined;
        if (rec && tab?.url) rec.url = tab.url;
        const f = factsFor(w, rec, tab?.url);
        let d = decideToggle(f);
        if (!prewarmOpened.loaded && d.why === "hide-visible" && d.native === "close") { void prewarmOpened.ready.then(() => { toggleFor(tab, false); }); return "inpage"; } // 补丁 inpage-prewarmopened-persist：SW 刚起、预热标记还在异步加载——这一支只关原生、不需要手势，等加载完再判断（重跑一遍；viaRouter 时返回 "inpage" = 不让核心先把原生关掉）
        if (shouldPinInpageAfterToggle(d, f, prewarmOpened.has(w), PREWARM.restoreInpageOnClose)) { restoreOnClose.add(w); d = { ...d, intent: true, inpage: "show" }; } // 补丁 inpage-restore-pinned：预热开的原生被 ⌃S 关掉 → 页内以常驻恢复（意图先置 true，原生端口断开后 nativeChanged 的 restoreOnClose 兜底再推 show:true）
        if (traceOn()) trace("toggle", { w, tab: tab?.id, viaRouter, native: d.native, inpage: d.inpage, intent: d.intent, nativeOpen: f.nativeOpen, prewarmOpened: prewarmOpened.has(w) });
        setIntent(w, d.intent); setLastOpen(nextLastOpen(d)); // 补丁 rel62-intent-persist：用户的页内显示 / 收起决定 = 全局最近意图
        // 顺序（E3）：先让页内收起 / 显示，原生只 open / close
        if (!viaRouter) { if (d.native === "open") openPanelInGesture(w); else if (d.native === "close") closePanel(w); }
        pushWindow(w);
        if (d.inpage === "show") later(() => { if (rec) void verify(rec); }, TIMING.handshakeMs + TIMING.pingMs);
        return viaRouter && d.native !== "keep" ? "native" : "inpage";
    };

    /** 第 8 层：窗口内、目标标签宿主已握手、原生在显示（冷启动那次 ⌃S 开的）、可页内显示 → 收起原生、恢复页内；一次性。⚠ 在原生已开之后纠偏，会有一次短暂的原生闪现（≤ 窗口） */
    const tryColdKey = (w: number) => {
        const ck = coldKey; if (!ck || ck.windowId !== w) return;
        if (Date.now() > coldKeyUntil) { coldKey = undefined; return; }
        const rec = ck.tabId != null ? tabs.get(ck.tabId) : undefined; if (!rec || !rec.hostAlive || rec.windowId !== w) return;
        if (!shouldCorrectCold(factsFor(w, rec), ck, rec.tabId, w)) return;
        coldKey = undefined; restoreOnClose.add(w); pendingWin.delete(w); closePanel(w); setIntent(w, true); // restoreOnClose：端口断开后的 nativeChanged 再兜一次；这里先置意图，hello 随后的 pushRec 就带 show
    };
    /** 补丁 inpage-prewarmopened-persist：SW 回收后的首次 ⌃S 关掉了预热开的原生（标记来自 storage.session）→ 页内以常驻恢复（等价 shouldPinInpageAfterToggle；宿主还没握手，所以只看页面种类，意图先置 true，hello 之后 pushRec 带 show） */
    const restorePinnedAfterCold = (w: number, tabId: number | undefined) => {
        const id = tabId ?? activeByWin[w]; if (id == null || !PREWARM.restoreInpageOnClose || settings.store.defaultMode === "native") return;
        void Promise.resolve().then(() => chrome.tabs.get(id)).then(t => {
            if (t.windowId !== w || showingNative(w) || panelAlive(w)) return;
            if (pageKind(t.url || t.pendingUrl) !== "ok") return; // 受限页：保持「只关」
            setIntent(w, true); pushWindow(w);
        }, () => undefined);
    };
    const nativeChanged = (w: number) => {
        const t0 = traceOn() ? { intent: intentOf(w), restore: restoreOnClose.has(w), pending: pendingWin.has(w) } : undefined;
        if (panelAlive(w)) pendingWin.delete(w);
        const open = showingNative(w);
        if (!panelAlive(w) && !open && !pendingWin.has(w)) { // 原生没了（谁关的都一样）：标记作废，之后用户自己再开的原生不带标记
            const ci = takeColdReopenClose(w); // 冷 SW：重连的面板页被 SPG 当成「再点一次 = 关」关掉的（⌃S / 图标造成，不是用户点 ×）
            if (ci) { void prewarmOpened.ready.then(() => { const was = prewarmOpened.has(w), tabId = ci.tabId ?? prewarmOpened.tabIdOf(w); prewarmOpened.delete(w); if (was) restorePinnedAfterCold(w, tabId); }); } // 标记要等加载完才知道有没有；有 = 预热开的原生被 ⌃S 关了 → 页内常驻恢复
            else prewarmOpened.delete(w);
        }
        const n = onNativeChanged({ intent: intentOf(w) }, open);
        if (!n.intent) setIntent(w, false);
        const restoreInpage = (nativeShowing: boolean): boolean => { // 原生没了（用户关了）：恢复为进受限页而收起的页内（Vertitab 的 sidepanel_closed 重建；⚠ 默认开）
            if (!(restoreOnClose.has(w) && !panelAlive(w) && !pendingWin.has(w))) return false;
            restoreOnClose.delete(w); if (shouldRestoreInpage({ restoreMarked: true, nativeShowing, enabled: PREWARM.restoreInpageOnClose })) setIntent(w, true); else dropSuppressed(w); return true;
        };
        /* 补丁 rel62-intent-persist：扩展重载后（restoreOnClose 已随 session 清空）落盘 suppressed 的窗口，原生在这个 SW 生命里关掉了 → 同样恢复 */
        if (bootFresh && bootSuppressed.has(w) && restoreOnClose.loaded && !restoreOnClose.has(w) && !restoreOnClose.restored.has(w) && !panelAlive(w) && !open && !pendingWin.has(w)) { bootSuppressed.delete(w); if (PREWARM.restoreInpageOnClose && settings.store.defaultMode !== "native") setIntent(w, true); else dropSuppressed(w); }
        if (restoreOnClose.loaded) restoreInpage(open);
        else if (!panelAlive(w) && !pendingWin.has(w)) void restoreOnClose.ready.then(() => { if (restoreInpage(showingNative(w))) pushWindow(w); }); // 补丁 inpage-restoreonclose-persist：SW 刚起、标记还在异步加载（冷 SW 里原生被关得比加载快）：等加载完再按当时的状态判一次，恢复了就补一次 push
        if (t0) trace("nativeChanged", { w, open, panelAlive: panelAlive(w), pendingBefore: t0.pending, intentBefore: t0.intent, intentAfter: intentOf(w), restoreMarkedBefore: t0.restore, restoreFired: t0.restore && !restoreOnClose.has(w) });
        tryColdKey(w); // 第 8 层
        if (!panelAlive(w) && !isPanelOpen(w) && !pendingWin.has(w)) handoff.delete(w); // 补丁 pinned-first-frame：原生端口真的断了，交接结束（意图已由上面的 restoreInpage 恢复）
        pushWindow(w); // 原生优先：开着就让页内收起；从不为此 disable 原生
        /* 补丁 t903u-tab-switch：预热 open 落定（面板端口出现 / 等满 connectWaitMs）时复查一次「到达」。
         * 同一个真实手势既触发了预热（pointerdown → MSG.prewarm → open）又切走了标签（页内侧栏里点收藏 / 标签行 → tabs.update）时，
         * onActivated 在 open 还没落定时到达：showingNative 为假 → decideSidebarSwitch = keep/not-native，随后面板端口才连上，没有人再判 → 目的标签留在原生（rel56 起就有）。
         * 这里补判：活动标签已经不是发起预热的那个标签 + 窗口带到达标记 → 走与 onActivated 相同的 arriveCheck（普通页 = 关原生回页内；受限页 = 留原生）。 */
        const origin = prewarmOrigin.get(w);
        if (origin != null && !pendingWin.has(w)) {
            prewarmOrigin.delete(w);
            const re = arrivedDuringOpen({ origin, active: activeByWin[w], open, pending: false, marked: arrivalMarked(w) });
            if (traceOn()) trace("prewarm.arriveRecheck", { w, origin, active: activeByWin[w], open, marked: arrivalMarked(w), go: re });
            if (re) arriveCheck(w, activeByWin[w]!);
        }
    };

    const onHost = (port: chrome.runtime.Port, early?: PendingPort) => {
        const tab = port.sender?.tab;
        if (!tab || tab.id == null || tab.windowId == null || (port.sender?.frameId ?? 0) !== 0) { port.disconnect(); return; }
        const rec: TabRec = { tabId: tab.id, windowId: tab.windowId, url: tab.url, port, hostAlive: false, blocked: false };
        const old = tabs.get(tab.id); try { if (old?.port && old.port !== port) old.port.disconnect(); } catch { /* 已断 */ }
        tabs.set(tab.id, rec);
        const handle = (m: HelloMsg | { type: "frame"; state: "ready" | "blocked" } | { type: "width"; width: number } | { type: "collapse"; width: number } | { type: "applied" }) => {
            if (traceOn() && m?.type !== "hello" && (m as { type?: string })?.type !== TRACE_MSG) trace("host.msg", { tab: rec.tabId, type: (m as { type?: string })?.type });
            if ((m as { type?: string } | undefined)?.type === TRACE_MSG) { traceFromHost((m as { rec?: unknown }).rec, rec.tabId); return; } // 内容脚本转来的追踪记录
            if ((m as { type?: string } | undefined)?.type === "applied") { const r = handoffAck.get(rec.tabId); handoffAck.delete(rec.tabId); r?.(); return; } // 补丁 pinned-first-frame：目的标签已按交接状态摆好
            if (m?.type === "hello") {
                if (traceOn()) trace("host.hello", { tab: rec.tabId, w: rec.windowId, proto: m.proto, frame: m.frame, active: activeByWin[rec.windowId] === rec.tabId, intent: intentOf(rec.windowId), nativeOpen: showingNative(rec.windowId) });
                if (m.proto !== PROTOCOL) { rec.hostAlive = false; try { port.postMessage({ type: "inpage:stale" }); } catch { /* 已断 */ } return; } // L3
                rec.hostAlive = true; rec.blocked = m.frame === "blocked";
                { const aw = awaitHost.get(rec.tabId); awaitHost.delete(rec.tabId); // 补丁 switch-auto：等宿主握手的原生 → 页内（点了标签行 / 到达时宿主还没起来）
                  if (hostWaitValid(aw, Date.now())) evalSidebarSwitch(rec.windowId, rec.tabId, rec.url, aw.requireMarked);
                  else if (arrivalMarked(rec.windowId) && activeByWin[rec.windowId] === rec.tabId) evalSidebarSwitch(rec.windowId, rec.tabId, rec.url, true); } // 同标签内从受限页导航到普通页（新标签页里输入网址）：内容脚本握手 = 到达
                if (activeByWin[rec.windowId] == null) void chrome.tabs.query({ active: true, windowId: rec.windowId }).then(([t]) => { if (t?.id != null) { activeByWin[rec.windowId] = t.id; pushWindow(rec.windowId); } }, () => undefined);
                if (shouldCorrectCold(factsFor(rec.windowId, rec), coldCandidate, rec.tabId, rec.windowId)) { closePanel(rec.windowId); setIntent(rec.windowId, true); } else tryColdKey(rec.windowId); // ⚠ 默认关；第 8 层：else = 有界窗口版
                pushRec(rec, undefined, true); syncBadge(rec.windowId); // hello = 内容脚本在等应答：不做去重
            } else if (m?.type === "frame") { // L4：iframe 握手结果（内容脚本观察到的）
                rec.blocked = m.state === "blocked"; pushWindow(rec.windowId);
            } else if (m?.type === "width") {
                const w = clampWidth(m.width); mem.width = w; widthTouched = true; void store.update(d => { d.width = w; });
                later(() => pushAll(), 0);
            } else if (m?.type === "collapse") { // 补丁 12：把手拖到 ≤82 松手（Arc ended 分支：恢复起始宽 + 收起；locked / floating 同一分支，floating 时 isVisible 为 false → 只落盘宽度，宿主本地收回浮出）。宽度 = 起始宽（照常夹取落盘）；收起 = 与 Alt+S 页内关闭同一函数 toggleFor（decideToggle 的 hide-visible 分支）。
                // 只在页内侧栏正显示时才动：已经收起 / 原生在显示 / 宿主不可用时 toggleFor 会反过来「显示」或开原生，所以先用 isVisible 挡掉
                const w = clampWidth(m.width); mem.width = w; widthTouched = true; void store.update(d => { d.width = w; });
                if (isVisible(factsFor(rec.windowId, rec))) toggleFor({ id: rec.tabId, windowId: rec.windowId, url: rec.url }, false); else later(() => pushAll(), 0);
            }
        };
        port.onMessage.addListener(handle);
        if (early) { try { port.onMessage.removeListener(early.tap); } catch { /* 已断 */ } for (const m of early.msgs) handle(m as Parameters<typeof handle>[0]); } // 冷启动期间缓下的 hello 等：按序重放
        port.onDisconnect.addListener(() => { void chrome.runtime.lastError; if (traceOn()) trace("host.disconnect", { tab: rec.tabId, w: rec.windowId, current: tabs.get(rec.tabId) === rec }); if (tabs.get(rec.tabId) === rec) { rec.hostAlive = false; rec.port = undefined; lastActive.delete(rec.tabId); syncBadge(rec.windowId); } });
    };

    const onActivated = (i: { tabId: number; windowId: number }) => {
        activeByWin[i.windowId] = i.tabId;
        const hosts = [...tabs.values()].filter(r => r.port).map(r => ({ tabId: r.tabId, windowId: r.windowId }));
        for (const c of planActivation(hosts, activeByWin, lastActive)) { const r = tabs.get(c.tabId); if (r) pushRec(r); }
        syncBadge(i.windowId);
        restoreOnClose.retab(i.windowId, i.tabId); // 补丁 inpage-restoreonclose-persist：存储里的 tabId 跟随激活标签（标签关闭不清标记，所以它必须一直指向还在的标签）
        if (arrivalMarked(i.windowId)) arriveCheck(i.windowId, i.tabId); // 补丁 switch-auto：浏览器 UI 切标签（没有手势，事先切不了）→ 事后回落页内
        const rec = tabs.get(i.tabId); if (rec) later(() => void verify(rec), TIMING.debounceMs);
    };
    const onUpdated = (id: number, info: { url?: string; status?: string }) => {
        if (traceOn() && tabs.has(id)) trace("tab.updated", { tab: id, status: info.status, url: info.url ? info.url.slice(0, 80) : undefined }); // 重载 = status loading → complete；url 不变时后台什么都不做
        const r = tabs.get(id); if (r && info.url) { r.url = info.url; pushRec(r); if (activeByWin[r.windowId] === id) syncBadge(r.windowId); } // 补丁 inpage-parked-idle：状态 / 徽标只取决于本标签自己的网址——只推这一个标签（原 pushWindow = 窗口里每个标签都推一遍，SPA 每次 pushState 都 O(N)）；徽标只有活动标签才需要
    };
    const onTabRemoved = (id: number) => { tabs.delete(id); lastActive.delete(id); awaitHost.delete(id); prewarmOpened.removeTab(id); };
    const onWinRemoved = (w: number) => { handoff.delete(w); prewarmOrigin.delete(w); forgetWin(w); delete activeByWin[w]; pendingWin.delete(w); restoreOnClose.delete(w); prewarmOpened.delete(w); };

    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onTabRemoved);
    chrome.windows.onRemoved.addListener(onWinRemoved);
    void prewarmOpened.ready.then(() => { // 只由存储恢复、本生命里没等到对应面板端口的标记：作废（否则之后用户自己开的原生会被误当预热）
        if (prewarmOpened.restored.size) later(() => { for (const w of Array.from(prewarmOpened.restored)) if (!panelAlive(w) && !isPanelOpen(w) && !pendingWin.has(w)) prewarmOpened.delete(w); prewarmOpened.restored.clear(); }, PREWARM_OPENED.sweepMs);
    });

    void restoreOnClose.ready.then(() => { // 补丁 inpage-restoreonclose-persist：只由存储恢复、本生命里没等到对应原生面板（端口 / 正在打开）的标记：作废，**不恢复**，只清除（宁可不恢复，也不在很久以后误弹页内）。仍有原生的保留（继续等它被关）；restored 不清——它们永远只用于「原生关了 → 恢复」
        if (restoreOnClose.restored.size) later(() => { for (const w of Array.from(restoreOnClose.restored)) if (!panelAlive(w) && !isPanelOpen(w) && !pendingWin.has(w)) { restoreOnClose.delete(w); dropSuppressed(w); } }, RESTORE_ON_CLOSE.sweepMs); // rel62：作废 = 不恢复，落盘 suppressed 也一并作废（同一语义）
    });

    const mk = (id: string, contexts: string[], extra: object = {}) => chrome.contextMenus.create({ id, title: tr("inpageSidebar.menu.toggle"), contexts, ...extra } as chrome.contextMenus.CreateProperties, () => void chrome.runtime.lastError);
    mk(MENU_TOGGLE_PAGE, ["page"], { documentUrlPatterns: ["http://*/*", "https://*/*"] });
    mk(MENU_TOGGLE_ACTION, ["action"]); // 受限页（chrome:// 等）上页面右键菜单出不来，工具栏图标右键仍可用
    const offLang = subscribe("languageChange", () => { for (const id of [MENU_TOGGLE_PAGE, MENU_TOGGLE_ACTION]) chrome.contextMenus.update(id, { title: tr("inpageSidebar.menu.toggle") }, () => void chrome.runtime.lastError); });

    /** 设置变化（onSettingsChange → refresh）：预热方式已是 off 时，把「预热打开的」原生关掉（close({windowId})，不需要手势）。其余窗口 / 其它来源的原生不动。
     *  只发 close；页内意图由既有的 nativeChanged 在端口断开后恢复（预热时页内是开着的 → restoreOnClose 已打标；本来就没开 → 保持收起，同预热之前）。 */
    const closePrewarmedIfOff = () => {
        if (!prewarmOpened.loaded || !restoreOnClose.loaded) { void Promise.all([prewarmOpened.ready, restoreOnClose.ready]).then(closePrewarmedIfOff); return; } // 补丁 inpage-restoreonclose-persist：冷 SW 刚起、两份标记还在异步加载：等加载完再判（ready 从不 reject；加载后 loaded 恒真，不会循环）。热路径 loaded 已为真 = 同步，行为不变
        for (const w of prewarmOpened) {
            const act = planOffClose({ mode: prewarmMode(), marked: true, nativeShowing: panelAlive(w) || showingNative(w), pending: pendingWin.has(w) });
            if (act === "keep") continue;
            if (act === "clear") { prewarmOpened.delete(w); continue; }
            prewarmOpened.delete(w); // 只关这一次；close 之后用户再自己开的原生没有标记
            void closePanel(w).catch(() => undefined); // closePanel 已把拒绝记进 ErrorLog；这里只防未处理的 rejection
        }
    };
    /** 补丁 inpage-off-wake-close：SW 被「设置写入」本身唤醒（设置页改 Off 时 SW 已回收，storage.onChanged 把它拉起来）时，**没有任何「变化」事件**能触发 refresh → closePrewarmedIfOff：
     *  启动读到的设置已经是 Off（Settings.ts initSettings 读完才挂 onChanged 监听，且按读到的值当「现状」，比对不出变化），start() 又不对账 → 预热开的原生永远不关（实测 LOST，原生一直 1）。
     *  这里补一次「启动对账」，只处理**只由存储恢复**的预热标记（prewarmOpened.restored = 上一个 SW 生命里打的）：预热方式现在是 off + 该窗口的面板页已用 ":r" 端口重连（= 就是当初预热开的那个面板）→ close 一次
     *  （页内随后由既有的 nativeChanged + restoreOnClose 恢复，行为同热 SW 的 Off）。⚠ 必须等面板重连：重连之前 panelAlive / isPanelOpen 都是空的，planOffClose 会判 "clear" = 只清标记不关（再也关不掉）。
     *  触发：① 两份标记加载完（ready）；② 之后每次面板端口事件（nativeChanged 入口）。热路径（没有恢复来的标记）= 第一行就返回。幂等：先删标记再 close，重复触发不会再关；与 closePrewarmedIfOff 并发也只关一次。 */
    const closeWokenOff = () => {
        if (!prewarmOpened.restored.size) return; // 热路径 / 本生命里没有「恢复来的」预热标记：什么都不做
        if (!prewarmOpened.loaded || !restoreOnClose.loaded) return; // restoreOnClose 还在加载：等 ready 那一次触发（关完后的恢复要靠它）
        let mode: ReturnType<typeof prewarmMode>; try { mode = prewarmMode(); } catch { return; }
        if (mode !== "off") return;
        for (const w of Array.from(prewarmOpened.restored)) {
            if (!reconnectedPanels.has(w) || !panelAlive(w)) continue; // 面板还没重连（等它；sweep 兜底）/ 不是 ":r" 重连（用户之后自己开的原生）：不动
            if (planOffClose({ mode, marked: true, nativeShowing: true, pending: pendingWin.has(w) }) !== "close") continue;
            if (traceOn()) trace("offWake.close", { w });
            prewarmOpened.delete(w); // 只关这一次
            void closePanel(w).catch(() => undefined);
        }
    };
    void Promise.all([prewarmOpened.ready, restoreOnClose.ready]).then(closeWokenOff);
    const me: Controller = {
        toggle: tab => void toggleFor(tab, false),
        nativeChanged: w => { closeWokenOff(); nativeChanged(w); },
        afterNativeSwitch(w, tabId, ok) {
            const d = decideSwitchNative({ nativeOpen: isPanelOpen(w) });
            if (ok) { setIntent(w, d.intent); pushWindow(w); return; }
            const rec = tabId != null ? tabs.get(tabId) : undefined; if (rec) pushRec(rec, "switch-failed"); // E8 失败：提示走快捷键 / 右键菜单
        },
        ensure: ensureNative,
        prewarm: prewarmNow,
        sidebarSwitch, sidebarSwitchSync,
        host: onHost,
        refresh: () => { closePrewarmedIfOff(); pushAll(); }, // 设置变化：先关掉「预热打开的」原生（预热改 off 时），再重推状态（prewarm 开关由内容脚本据 state.prewarm 对齐）
    };
    // 路由：只接管 commands.onCommand 的 toggle-sidebar（patch 02）；没装 = 核心走原生
    setGestureRouter(tab => toggleFor(tab, true));
    setInpageProbe(w => bgActive && w != null && intentOf(w) && !showingNative(w)); // patch 07：Alt+T 全局命令弹窗据此带 via=inpage（commandBar 的 openCentered 同步询问）；冷 SW 里 start 还没跑 = 探针没装 = 不带（⚠ 降级）
    ctl = me; bgActive = true;
    for (const e of pendingPorts.splice(0)) onHost(e.port, e);

    /** 心跳（Vertitab 的 25 s heartbeat）：只在有原生面板端口且预热方式不是 off 时跑；panel 端不听 port 消息，所以这只是探活——向死端口 postMessage 抛错 = 当作断开。⚠ 能否延长 SW 寿命 ⛔ 未测 */
    const heartbeat = setInterval(() => {
        if (!PREWARM.heartbeatMs) return;
        let mode: string; try { mode = prewarmMode(); } catch { return; } // 设置未就绪 / 插件已卸载但定时器还在（测试里漏清理的实例）：跳过这一拍，不抛未处理错误
        if (mode === "off") return;
        for (const [w, set] of panelPorts) for (const p of set) { try { p.postMessage({ type: "heartbeat" }); } catch { set.delete(p); setTimeout(() => nativeChanged(w), 0); } }
    }, PREWARM.heartbeatMs);

    /** 补丁 rel62-intent-persist：storage.session 存活键——读到 = SW 回收（session 还在）；读不到 = 扩展重载 / 浏览器重启；session 不可用 / 读失败 = false（保守） */
    const sessionFresh: Promise<boolean> = (async () => {
        const area = (chrome.storage as { session?: StorageAreaLike } | undefined)?.session; if (!area) return false;
        const k = SUPPRESS_RESTORE.sessionKey;
        try { const got = await area.get(k); const fresh = !(got as Record<string, unknown> | undefined)?.[k]; await Promise.resolve(area.set({ [k]: true })).catch(() => undefined); return fresh; } catch { return false; }
    })();
    // 启动时清理已不存在窗口的意图（窗口 id 浏览器重启后会变）
    const restoreMem = () => { if (memReady) return; memReady = true; pushAll(); }; // 补丁 inpage-tabswitch-noreload：成功 / 失败 / 超时都放行一次（pushAll 把读完前到的 hello 一并补发）
    void store.ready.then(() => chrome.windows.getAll()).then(ws => {
        const alive = new Set(ws.map(w => String(w.id)));
        const saved = store.get();
        const stale = Object.keys(saved.openByWin).filter(k => !alive.has(k)), staleSup = Object.keys(saved.suppressedByWin ?? {}).filter(k => !alive.has(k));
        if (stale.length || staleSup.length) void store.update(d => { for (const k of stale) delete d.openByWin[k]; if (d.suppressedByWin) { for (const k of staleSup) delete d.suppressedByWin[k]; if (!Object.keys(d.suppressedByWin).length) delete d.suppressedByWin; } });
        if (!lastOpenTouched && typeof saved.lastOpen === "boolean") lastOpen = saved.lastOpen; // 补丁 rel62-intent-persist：全局最近意图（新窗口继承）
        const sup = saved.suppressedByWin ?? {};
        for (const k of Object.keys(saved.openByWin)) {
            if (!alive.has(k) || k in mem.openByWin || typeof saved.openByWin[k] !== "boolean") continue; // 只恢复本次会话没动过的窗口
            if (saved.openByWin[k] && sup[k]) { mem.openByWin[+k] = false; suppressed.add(+k); bootSuppressed.add(+k); continue; } // 补丁 rel62-intent-persist：开原生时收起的——先按收起，等 restoreOnClose 加载完再定（见下）
            mem.openByWin[+k] = saved.openByWin[k];
        }
        if (bootSuppressed.size) void Promise.all([restoreOnClose.ready, sessionFresh]).then(([, fresh]) => later(() => { // SW 回收 → 交给原来的 restoreOnClose 逻辑；扩展重载 / 重启 → 没有原生面板就恢复页内
            bootFresh = fresh;
            for (const w of Array.from(bootSuppressed)) {
                if (restoreOnClose.restored.has(w) || restoreOnClose.has(w)) { bootSuppressed.delete(w); continue; }
                if (!fresh) { dropSuppressed(w); continue; } // SW 回收且没有（有效的）restoreOnClose 标记：修前行为（不恢复）
                if (panelAlive(w) || isPanelOpen(w) || pendingWin.has(w)) continue; // 原生还开着：等它关（nativeChanged 里的 bootSuppressed 分支）
                bootSuppressed.delete(w);
                if (traceOn()) trace("intent.bootRestore", { w });
                if (PREWARM.restoreInpageOnClose && settings.store.defaultMode !== "native") { setIntent(w, true); pushWindow(w); } else dropSuppressed(w);
            }
        }, SUPPRESS_RESTORE.graceMs));
        if (!widthTouched) mem.width = clampWidth(saved.width);
        if (saved.warmByWin) void store.update(d => { delete d.warmByWin; }); // 旧版本（标签级预热）的落盘记录：不再使用，清掉
        restoreMem();
    }, () => { restoreMem(); });
    later(restoreMem, STATE_RESTORE.maxWaitMs); // 存储读不回来：不让宿主一直拿不到状态
    // 启动：先迁移已存的 prewarm 旧值（"tab" 等 → 删键 = 默认 off），再对账 enabled:false 的标签（只 enable、不带 path、不 open / close）。都在 store 就绪之后（设置已加载）；失败不影响启动
    void store.ready.then(() => { try { migratePrewarmTab(); } catch { /* 设置未就绪：parsePrewarmMode 对旧值本来就按 off 处理 */ } void reconcileTabs(); }, () => undefined);

    return [
        () => clearInterval(heartbeat),
        offTrace,
        () => { restoreOnClose.clear(); pendingWin.clear(); awaitHost.clear(); prewarmOpened.clear(); handoff.clear(); handoffAck.clear(); prewarmOrigin.clear(); },
        () => { bgActive = false; if (ctl === me) ctl = undefined; setGestureRouter(undefined); setInpageProbe(undefined); },
        // 清理：本插件不改任何原生侧栏设置（图标行为在 _core/sidebar，不归本插件），只撤自己加的东西
        () => { chrome.tabs.onActivated.removeListener(onActivated); chrome.tabs.onUpdated.removeListener(onUpdated); chrome.tabs.onRemoved.removeListener(onTabRemoved); chrome.windows.onRemoved.removeListener(onWinRemoved); },
        () => { for (const id of [MENU_TOGGLE_PAGE, MENU_TOGGLE_ACTION]) chrome.contextMenus.remove(id, () => void chrome.runtime.lastError); },
        () => { for (const t of timers) clearTimeout(t); timers.clear(); },
        () => { for (const r of tabs.values()) { try { r.port?.postMessage({ type: "inpage:stale" }); } catch { /* 已断 */ } if (chrome.action?.setBadgeText) void chrome.action.setBadgeText({ tabId: r.tabId, text: "" }).catch(() => undefined); } tabs.clear(); },
        offLang,
    ];
}

/** 设置变化（onSettingsChange）：重新下发状态 */
export function refreshBackground() { ctl?.refresh(); }

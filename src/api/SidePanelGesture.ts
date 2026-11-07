/*
 * 侧边栏开 / 关：必须在用户手势的同步调用栈里调 chrome.sidePanel.open。
 *
 * 51979 实机错误（Helium，background.js）：
 *   Uncaught (in promise) Error: sidePanel.open() may only be called in response to a user gesture.
 * 根因：toggle-sidebar 命令（Mac 上 Ctrl+S）经 @api/ChromeEvents 的 listen() 分发——service worker 刚被唤醒时，
 * 事件先进缓冲区，等 bootstrap（异步：读设置、启动插件）结束才 flush，open() 已不在手势里；
 * 另一路是 sidebar.toggle（Mod+S）经 RPC 从侧栏 / 网页转到后台，同样没有手势；toggle() 里还先 await getLastFocused。
 *
 * 做法：在 background 顶层同步注册 commands.onCommand / runtime.onConnect / windows.onFocusChanged，
 * 判定所需的状态（哪些窗口侧栏开着、最后聚焦的普通窗口）全部预先同步在内存里，命令到达时同步决定：
 * 开着 → close（不需要手势）；关着 → 立即 open（同一调用栈）。不经过 await / 存储 / 定时器 / 消息往返。
 * 没有手势的调用方（RPC、插件）只能关，不能开（requestToggleNoGesture）。
 *
 * 自测钩子：install 时包装 chrome.sidePanel.open；不在手势栈里调用就记一条违规
 * （globalThis.__arcSidePanelViolations + ErrorLog），由 RPC "core:sidePanelViolations" 读出。
 *
 * 页内侧边栏（可选插件 InpageSidebar，patch 02）：插件在 start() 里 setGestureRouter(fn) 装一个**同步**路由。
 * commands.onCommand（toggle-sidebar）和 action.onClicked（工具栏图标；补丁 inpage-action-click，_core/sidebar 关掉了 openPanelOnActionClick）经它转发；contextMenus.onClicked **不经**它
 * （右键菜单由插件在自己的顶层监听里直接走 ctl.toggle）。
 * 路由返回 "inpage" = 插件已自己处理（页内宿主显示 / 隐藏、必要时 closePanel），这里不再碰原生面板；其它返回值或抛错 = 原生（现有行为）。
 * 路由没装（SW 冷启动、插件未启用）= 原生；冷启动时记下这次手势（takeColdGesture），插件 start() 完成后可据此纠偏。
 *
 * 补丁 inpage-action-click v2（冷 SW + 原生本来就开着）：冷 SW 的 open 集合是空的，同步栈里分不出「原生已开」，所以仍照旧同栈 open（对已开的面板 ⚠ 预期是无操作）。
 * 但原生面板页在 SW 重启后会自己重连端口，重连的端口名带 ":r" 后缀（`panel:<winId>:r`，见 _core/sidebar）——它证明「这个面板在这次手势之前就开着」。
 * 冷手势之后 COLD_NATIVE_RECONNECT_MS 内、同窗口收到 ":r" 端口 → 把这次手势当成「再点一次 = 关」：closePanel（不需要手势），并且取走冷手势，不让 start() 把原生纠偏成页内（与热 SW / Alt+S 一致）。
 * 非 ":r" 端口（新开的面板）= 证明原生此前没开 → 撤销等待，保持旧行为（原生先开，随后纠偏成页内）。
 */
import { recordError } from "@api/ErrorLog";

const open = new Set<number>();
let lastWin: number | undefined;
let inGesture = 0;
export const violations: { t: number; stack: string }[] = [];
type SP = typeof chrome.sidePanel & { close?(o: { windowId: number }): Promise<void> };

export const isPanelOpen = (windowId: number) => open.has(windowId);
export const lastFocusedWindow = () => lastWin;

/** 页内侧栏路由：同步、不得 await；入参是 commands.onCommand 带的 tab（可能 undefined） */
export type GestureRouter = (tab: chrome.tabs.Tab | undefined) => "inpage" | "native";
let router: GestureRouter | undefined;
/** 插件 start() 装、cleanup 撤（传 undefined）。只路由 commands.onCommand 的 toggle-sidebar */
export function setGestureRouter(fn: GestureRouter | undefined) { router = fn; }
/** 路由没装时走了原生 toggle 的那次手势（供插件 start() 完成后纠偏）；只保留最近一次，takeColdGesture 取走即清 */
export interface ColdGesture { t: number; windowId: number | undefined; tabId: number | undefined; url: string | undefined; opened: boolean }
let cold: ColdGesture | undefined;
/** 冷手势在原生「看起来是新开的」时登记（open 集合里没有）；与 cold 分开存——start() 的 takeColdGesture 会取走 cold，但等待重连的判定要活到端口到达 / 超时 */
let coldNative: { t: number; windowId: number } | undefined;
/** 面板页重连的退避上限 5 s（_core/sidebar：delay 200 → ×2 → 5000，且从不复位）+ 余量；超时 = 不再把迟到的重连当作「本次手势之前就开着」 */
export const COLD_NATIVE_RECONNECT_MS = 5_500;
export const panelPortRe = /^panel:(\d+)(:r)?$/;
/** 补丁 inpage-prewarmopened-persist：冷 SW 里「重连的面板端口把冷手势当成再点一次 = 关」（下面 onConnect 的 wasOpen 分支）——这次关闭是 ⌃S / 图标造成的，不是用户点 ×。
 *  插件在原生消失（nativeChanged）时取走它，据此判断「⌃S 关掉了预热开的原生」→ 页内常驻恢复（仅在持久化的预热标记还有效时）。只留最近一次。 */
export interface ColdReopenClose { t: number; windowId: number; tabId: number | undefined }
let coldReopenClose: ColdReopenClose | undefined;
export function takeColdReopenClose(windowId: number, maxAgeMs = 15_000): ColdReopenClose | undefined { const c = coldReopenClose; if (!c || c.windowId !== windowId) return undefined; coldReopenClose = undefined; return Date.now() - c.t <= maxAgeMs ? c : undefined; }
export function takeColdGesture(maxAgeMs = 15_000): ColdGesture | undefined { const c = cold; cold = undefined; return c && Date.now() - c.t <= maxAgeMs ? c : undefined; }

export function closePanel(windowId: number): Promise<void> {
    const sp = chrome.sidePanel as SP;
    open.delete(windowId); // 关闭不需要手势；状态立即更新
    const p = sp.close ? sp.close({ windowId }) : chrome.sidePanel.setOptions({ enabled: false }).then(() => chrome.sidePanel.setOptions({ enabled: true, path: "sidepanel.html" }));
    p.catch(e => recordError("background", "rejection", e));
    return p as Promise<void>; // 层 6：调用方可以等「关完」再做下一步（switch-auto 的原生行点击：close 之后再由 SW 激活目标）；拒绝已在上面记录，调用方 .catch 即可
}

/** 只能在用户手势的同步处理函数里调用（commands.onCommand / action.onClicked / contextMenus.onClicked） */
export function openPanelInGesture(windowId: number, onResult?: (ok: boolean) => void) {
    inGesture++;
    try {
        chrome.sidePanel.open({ windowId }).then(() => onResult?.(true)).catch(e => { recordError("background", "rejection", e); onResult?.(false); }); // 保持「每个 open 都带 .catch(」（tests/scrollRegression.test.ts）
    } catch (e) { recordError("background", "error", e); /* 51997：同步抛错也不外泄 */ onResult?.(false); } finally { inGesture--; }
}

/** 手势处理函数里的切换：同步决定 */
export function togglePanelInGesture(windowId: number | undefined) {
    const id = windowId ?? lastWin; if (id == null) return;
    if (open.has(id)) closePanel(id); else openPanelInGesture(id);
}

/** 没有手势（RPC / 侧栏内快捷键）：开着就关；关着什么都不做（打不开，也不报错） */
export function requestToggleNoGesture(windowId?: number) {
    const id = windowId ?? lastWin; if (id != null && open.has(id)) closePanel(id);
}

let installed = false;
/** 必须在 background 顶层同步调用（在任何 await 之前） */
export function installSidePanelGesture() {
    if (installed) return; installed = true;
    // 违规检测：不在手势栈里的 open
    const sp = chrome.sidePanel as SP; const raw = sp.open.bind(sp);
    (sp as { open: typeof sp.open }).open = ((o: chrome.sidePanel.OpenOptions) => {
        if (!inGesture) {
            const stack = new Error("sidePanel.open outside a user-gesture handler").stack ?? "";
            violations.push({ t: Date.now(), stack }); (globalThis as { __arcSidePanelViolations?: typeof violations }).__arcSidePanelViolations = violations;
            recordError("background", "error", new Error("sidePanel.open outside a user-gesture handler"));
        }
        return raw(o);
    }) as typeof sp.open;
    (globalThis as { __arcSidePanelViolations?: typeof violations }).__arcSidePanelViolations = violations;
    /* 手势里的切换（toggle-sidebar 命令 / 工具栏图标 action.onClicked 共用一份，同步、无 await）：有路由 → 路由按页面性质决定页内 / 原生；没路由（冷启动 / 插件未启用）→ 原生 */
    const onToggleGesture = (tab: chrome.tabs.Tab | undefined) => {
        if (router) {
            coldNative = undefined; // 路由已装 = 热路径：不再等待旧面板的重连
            let r: "inpage" | "native" = "native";
            try { r = router(tab); } catch (e) { recordError("background", "error", e); /* 路由出错：回落原生 */ }
            if (r === "inpage") return;
        } else {
            const id = tab?.windowId ?? lastWin;
            cold = { t: Date.now(), windowId: id, tabId: tab?.id, url: tab?.url, opened: id != null && !open.has(id) };
            coldNative = cold.opened && id != null ? { t: cold.t, windowId: id } : undefined;
        }
        togglePanelInGesture(tab?.windowId);
    };
    chrome.commands.onCommand.addListener((cmd, tab) => { if (cmd === "toggle-sidebar") onToggleGesture(tab); });
    /* 补丁 inpage-action-click：工具栏图标（以及 _execute_action = Alt+Shift+A）。_core/sidebar 把 openPanelOnActionClick 关掉后，Chrome 才会派发 action.onClicked；
     * 这里和 Alt+S 走同一套判定（路由 → InpageSidebar 的 toggleFor → decideToggle）。顶层同步注册（和 commands.onCommand 一样），冷 SW 唤醒时事件不丢。 */
    chrome.action?.onClicked?.addListener(tab => onToggleGesture(tab));
    chrome.runtime.onConnect.addListener(port => {
        const m = panelPortRe.exec(port.name); if (!m) return;
        const id = Number(m[1]); open.add(id);
        if (coldNative?.windowId === id) {
            const wasOpen = !!m[2] && Date.now() - coldNative.t <= COLD_NATIVE_RECONNECT_MS; coldNative = undefined; // 重连端口 = 手势之前就开着；新开的面板端口 = 没开过：两种都结束等待
            if (wasOpen) { coldReopenClose = { t: Date.now(), windowId: id, tabId: cold?.tabId }; cold = undefined; closePanel(id); } // 同栈、无 await；cold 取走 = start() 不再纠偏成页内
        }
        port.onMessage.addListener((msg: { visible?: boolean }) => { if (msg?.visible === false) open.delete(id); else if (msg?.visible === true) open.add(id); });
        port.onDisconnect.addListener(() => { void chrome.runtime.lastError; open.delete(id); });
    });
    chrome.windows.onFocusChanged.addListener(w => { if (w !== chrome.windows.WINDOW_ID_NONE) lastWin = w; });
    chrome.windows.getLastFocused({ windowTypes: ["normal"] }).then(w => { if (lastWin == null && w.id != null) lastWin = w.id; }, () => undefined);
}

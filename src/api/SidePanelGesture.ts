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
 */
import { recordError } from "@api/ErrorLog";

const open = new Set<number>();
let lastWin: number | undefined;
let inGesture = 0;
export const violations: { t: number; stack: string }[] = [];
type SP = typeof chrome.sidePanel & { close?(o: { windowId: number }): Promise<void> };

export const isPanelOpen = (windowId: number) => open.has(windowId);
export const lastFocusedWindow = () => lastWin;

function closePanel(windowId: number) {
    const sp = chrome.sidePanel as SP;
    open.delete(windowId); // 关闭不需要手势；状态立即更新
    const p = sp.close ? sp.close({ windowId }) : chrome.sidePanel.setOptions({ enabled: false }).then(() => chrome.sidePanel.setOptions({ enabled: true, path: "sidepanel.html" }));
    p.catch(e => recordError("background", "rejection", e));
}

/** 只能在用户手势的同步处理函数里调用（commands.onCommand / action.onClicked / contextMenus.onClicked） */
export function openPanelInGesture(windowId: number) {
    inGesture++;
    try { chrome.sidePanel.open({ windowId }).catch(e => recordError("background", "rejection", e)); } catch (e) { recordError("background", "error", e); /* 51997：同步抛错也不外泄 */ } finally { inGesture--; }
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
    chrome.commands.onCommand.addListener((cmd, tab) => { if (cmd === "toggle-sidebar") togglePanelInGesture(tab?.windowId); });
    chrome.runtime.onConnect.addListener(port => {
        const m = /^panel:(\d+)$/.exec(port.name); if (!m) return;
        const id = Number(m[1]); open.add(id);
        port.onMessage.addListener((msg: { visible?: boolean }) => { if (msg?.visible === false) open.delete(id); else if (msg?.visible === true) open.add(id); });
        port.onDisconnect.addListener(() => { void chrome.runtime.lastError; open.delete(id); });
    });
    chrome.windows.onFocusChanged.addListener(w => { if (w !== chrome.windows.WINDOW_ID_NONE) lastWin = w; });
    chrome.windows.getLastFocused({ windowTypes: ["normal"] }).then(w => { if (lastWin == null && w.id != null) lastWin = w.id; }, () => undefined);
}

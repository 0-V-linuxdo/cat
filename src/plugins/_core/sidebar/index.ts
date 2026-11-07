/*
 * Sidebar（§1 / §14）：点击工具栏图标打开侧边栏；“显示 / 隐藏侧边栏”命令。
 * 位置（左 / 右）和宽度由 Chrome 侧边栏本身控制（chrome://settings/appearance 可选左右）。
 */
import { safe } from "@api/ErrorLog";
import { tr } from "@api/i18n";
import { subscribe } from "@api/Events";
import { requestToggleNoGesture } from "@api/SidePanelGesture";
import { isInpageHost } from "@api/HostMode";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";


/* 开 / 关逻辑在 @api/SidePanelGesture（background 顶层同步注册，手势里同步决定）。
 * 这里的 sidebar.toggle 命令（Mod+S，从侧栏 / 网页经 RPC 转来）没有用户手势：只能关，不能开。 */
export default definePlugin({
    name: "Sidebar",
    authors: [Devs.ArcSidebar],
    label: "plugin.sidebar.label",
    description: "plugin.sidebar.desc",
    required: true,
    hidden: true,
    commands: [{ id: "sidebar.toggle", label: "sidebar.toggle", context: "background", defaultKey: "Mod+S", run: () => requestToggleNoGesture() }],
    background: {
        async start() {
            /* 补丁 inpage-action-click：点击工具栏按钮（或 _execute_action / Alt+Shift+A）不再由 Chrome 自己开原生面板（openPanelOnActionClick 必须是 false，否则 action.onClicked 不派发）；
             * 改由 @api/SidePanelGesture 顶层的 action.onClicked 监听按页面性质决定：可注入 → 页内侧栏显示 / 收起；受限页 → 原生开 / 关（与 Alt+S 一致）。
             * 这个设置是**持久化**的（浏览器侧保存），旧版本留下的 true 靠这里每次启动显式写 false 迁移。设置在按钮右键菜单里（“选项” + “设置”） */
            await safe(chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }), "sidePanel.setPanelBehavior");
            chrome.contextMenus.create({ id: "arc-action-settings", title: tr("common.settings"), contexts: ["action"] }, () => void chrome.runtime.lastError);
            const onMenu = (info: chrome.contextMenus.OnClickData) => { if (info.menuItemId === "arc-action-settings") void safe(chrome.runtime.openOptionsPage(), "runtime.openOptionsPage"); };
            chrome.contextMenus.onClicked.addListener(onMenu);
            return [
                () => { chrome.contextMenus.onClicked.removeListener(onMenu); chrome.contextMenus.remove("arc-action-settings", () => void chrome.runtime.lastError); },
                subscribe("languageChange", () => chrome.contextMenus.update("arc-action-settings", { title: tr("common.settings") }, () => void chrome.runtime.lastError)),
            ];
        },
    },
    panel: {
        async start() {
            // 页内侧边栏（?host=inpage）：本页是网页里的 iframe，不是原生侧栏——不连 panel:<winId>，否则后台会把原生面板当成“开着”
            if (isInpageHost()) return;
            const w = await chrome.windows.getCurrent();
            // 扩展重载后 service worker 可能还没起来：断开时读取 lastError（避免 “Unchecked runtime.lastError”）并退避重连
            let port: chrome.runtime.Port | undefined;
            let stopped = false, delay = 200, reconnect = false; // 补丁 inpage-action-click v2：第二次起的连接带 ":r" 后缀 = 「这个面板页在上一个 SW 之前就开着」，冷 SW 的手势据此判定原生已开
            let timer: ReturnType<typeof setTimeout> | undefined;
            const connect = () => {
                if (stopped) return;
                const at = Date.now(); port = chrome.runtime.connect({ name: `panel:${w.id}${reconnect ? ":r" : ""}` });
                port.postMessage({ visible: !document.hidden });
                port.onDisconnect.addListener(() => {
                    void chrome.runtime.lastError;
                    port = undefined;
                    if (Date.now() - at > 1000) reconnect = true; // 连上过（活了 >1 s）才算「重连」；连接立刻失败（SW 还没起来）不算——否则新开的面板会被误认成旧面板
                    if (!stopped) { timer = setTimeout(connect, delay); delay = Math.min(delay * 2, 5000); }
                });
            };
            connect();
            const onVis = () => { try { port?.postMessage({ visible: !document.hidden }); } catch { /* 端口已断：重连时会再报 */ } };
            document.addEventListener("visibilitychange", onVis);
            return () => { document.removeEventListener("visibilitychange", onVis); stopped = true; if (timer) clearTimeout(timer); port?.disconnect(); };
        },
    },
});

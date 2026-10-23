/*
 * Sidebar（§1 / §14）：点击工具栏图标打开侧边栏；“显示 / 隐藏侧边栏”命令。
 * 位置（左 / 右）和宽度由 Chrome 侧边栏本身控制（chrome://settings/appearance 可选左右）。
 */
import { safe } from "@api/ErrorLog";
import { tr } from "@api/i18n";
import { subscribe } from "@api/Events";
import { requestToggleNoGesture } from "@api/SidePanelGesture";
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
            /* 点击工具栏按钮（或 _execute_action / Alt+Shift+A）直接打开侧边栏；设置在按钮右键菜单里（“选项” + “设置”） */
            await safe(chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }), "sidePanel.setPanelBehavior");
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
            const w = await chrome.windows.getCurrent();
            // 扩展重载后 service worker 可能还没起来：断开时读取 lastError（避免 “Unchecked runtime.lastError”）并退避重连
            let port: chrome.runtime.Port | undefined;
            let stopped = false, delay = 200;
            let timer: ReturnType<typeof setTimeout> | undefined;
            const connect = () => {
                if (stopped) return;
                port = chrome.runtime.connect({ name: `panel:${w.id}` });
                port.postMessage({ visible: !document.hidden });
                port.onDisconnect.addListener(() => {
                    void chrome.runtime.lastError;
                    port = undefined;
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

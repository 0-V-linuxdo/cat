/* 可选插件「Boosts」：按站点改造网页（配色、字体、Zap 隐藏元素、自定义 CSS；自定义 JS 为单独子开关）。默认关闭。
 * 规格：/workspace/arc-analysis/boosts.md。只存本地；CSS 用 chrome.scripting.insertCSS 注入，JS 用 userScripts（需权限，未获授权时不运行）。
 * 入口：命令栏「新建 Boost / 管理 Boosts」、页面右键「Create a new boost」，以及核心 @api/Slots 扩展点：资料库分类、“+”菜单、站点控制、地址栏指示（core-api-proposal.md §5）。
 * 编辑器：独立窗口 static/boost-editor.html。userScripts 只在打开「自定义 JS」开关时由核心按 optionalPermissions 申请，关闭时释放。 */
import { safe } from "@api/ErrorLog";
import { listen } from "@api/ChromeEvents";
import { runCommand } from "@api/Commands";
import { openPanelInGesture } from "@api/SidePanelGesture";
import { tr } from "@api/i18n";
import { handle } from "@api/RPC";
import { definePluginSettings } from "@api/Settings";
import { addLibrarySection, addOverlay, addPlusMenuItem, addSiteControlSection, addUrlbarIndicator, openOverlay } from "@api/Slots";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";

import "./i18n";
import { applyAll, applyToTab, forgetTab, removeAll, syncUserScripts, userScriptsApi } from "./apply";
import { activeBoostsFor, hostOf } from "./model";
import { startTint } from "./tint";
import { boostStore, updateBoost } from "./store";
import { createForActiveTab, mountEditorPage, openEditorWindow, renderBoosts } from "./view";
import { startZap, ZAP_MSG } from "./zap";

const MENU_ID = "cat-boost-new";

/* 右键「Create a new boost」：必须在 contextMenus.onClicked 的直接监听里同步调 sidePanel.open（不经 @api/ChromeEvents 缓冲层、前面无 await），
 * 否则 service worker 刚被唤醒时手势已过期。监听在模块加载时（background 顶层）同步注册；插件未启用时 bgActive=false，直接忽略。 */
let bgActive = false;
const isServiceWorker = typeof document === "undefined"; // background service worker 没有 document；侧栏 / 页面 / content 有
if (isServiceWorker && typeof chrome !== "undefined" && chrome.contextMenus?.onClicked) {
    chrome.contextMenus.onClicked.addListener((info, tab) => {
        if (!bgActive || info.menuItemId !== MENU_ID || tab?.windowId == null) return;
        openPanelInGesture(tab.windowId); // 同一调用栈，属于用户手势
        const url = tab.url;
        void safe(boostStore.ready.then(() => new Promise(r => setTimeout(r, 300))).then(() => runCommand("boosts.new", { url })), "boosts: open new boost");
    });
}

const settings = definePluginSettings({
    // 打开时核心设置页在点击处理里调用 requestPluginPermissions("Boosts", "jsEnabled")，拒绝则开关保持关闭；关闭时 releasePluginPermissions
    jsEnabled: { type: OptionType.BOOLEAN, description: "boosts.jsEnabled", default: false, onChange: () => void resyncJs() },
});

const resyncJs = () => typeof chrome !== "undefined" && chrome.userScripts !== undefined ? syncUserScripts(boostStore.get().boosts, !!settings.store.jsEnabled) : Promise.resolve("unavailable");

const viewOpts = { jsEnabled: () => !!settings.store.jsEnabled, jsAvailable: async () => !!await userScriptsApi(), openEditor: (id: string) => void openEditorWindow(id) };
const openEditor = async (url?: string) => { const id = await createForActiveTab(url); if (id) await openEditorWindow(id); };

export default definePlugin({
    name: "Boosts",
    label: "plugin.boosts.label",
    icon: "boost",
    description: "plugin.boosts.desc",
    authors: [Devs.ArcSidebar],
    tags: ["views"],
    settings,
    /** 自定义 JS 开关按需申请 userScripts（manifest optional_permissions） */
    optionalPermissions: { jsEnabled: ["userScripts"] },
    commands: [
        { id: "boosts.new", label: "boosts.new", keywords: ["boost", "customize page"], context: "panel", run: (a?: unknown) => openEditor((a as { url?: string } | undefined)?.url) },
        { id: "boosts.manage", label: "boosts.manage", keywords: ["boost", "boosts"], context: "panel", run: (a?: unknown) => openOverlay("boosts", a) },
    ],
    background: {
        async start() {
            bgActive = true;
            await boostStore.ready;
            void applyAll(); void resyncJs();
            const onCommitted = (d: chrome.webNavigation.WebNavigationTransitionCallbackDetails) => { if (d.frameId === 0) void applyToTab(d.tabId, d.url, true); };
            chrome.webNavigation?.onCommitted.addListener(onCommitted);
            chrome.contextMenus.create({ id: MENU_ID, title: tr("boosts.new"), contexts: ["page"], documentUrlPatterns: ["http://*/*", "https://*/*"] }, () => void chrome.runtime.lastError);
            return [
                boostStore.subscribe(() => { void applyAll(); void resyncJs(); }),
                listen("tabs.onUpdated", (id, info, tab) => { if (info.status === "complete") void applyToTab(id, tab.url); }),
                listen("tabs.onRemoved", id => forgetTab(id)),
                handle("boosts.addZap", ([id, sel]) => typeof id === "string" && typeof sel === "string" && sel.length < 2000
                    ? updateBoost(id, b => { if (!b.zaps.includes(sel)) b.zaps.push(sel); }) : undefined),
                () => chrome.webNavigation?.onCommitted.removeListener(onCommitted),
                () => void chrome.contextMenus.remove(MENU_ID, () => void chrome.runtime.lastError),
                () => void removeAll(),
                () => void syncUserScripts([], false),
                () => { bgActive = false; },
            ];
        },
    },
    panel: {
        start() {
            const offs: Array<() => void> = [addOverlay("boosts", "Boosts", { title: tr("boosts.title"), page: true, render: (el, arg) => renderBoosts(el, arg, viewOpts) })];
            offs.push(
                addLibrarySection("Boosts", { id: "boosts", label: tr("boosts.title"), icon: "boost", render: box => { const c = renderBoosts(box, undefined, viewOpts); return typeof c === "function" ? c : undefined; } }),
                addPlusMenuItem("Boosts", { id: "boost", label: tr("plus.newBoost"), icon: "boost", run: () => openEditor() }),
                addSiteControlSection("Boosts", { id: "boosts", render: (box, tab, close) => {
                    const btn = document.createElement("button");
                    btn.className = "arc-sc-action"; btn.textContent = tr("boosts.new");
                    btn.onclick = () => { close(); void openEditor(tab.url); };
                    box.append(btn);
                } }),
                addUrlbarIndicator("Boosts", { id: "boosts", state: t => activeBoostsFor(boostStore.get().boosts, t.url).length ? { icon: "boost", title: tr("boosts.active") } : null, onClick: () => openOverlay("boosts") }),
            );
            return offs;
        },
    },
    /** 独立编辑器页面（page 上下文，不加载侧边栏） */
    page: {
        async start() {
            if (!location.pathname.endsWith("/boost-editor.html")) return;
            await boostStore.ready;
            return mountEditorPage(location.pathname, location.search, { ...viewOpts, openEditor: undefined });
        },
    },
    content: {
        start() {
            if (!hostOf(location.href)) return;
            const stopTint = startTint();
            const onMsg = (m: { type?: string; boostId?: string }, _s: unknown, respond: (r: unknown) => void) => {
                if (m?.type !== ZAP_MSG || typeof m.boostId !== "string") return;
                startZap(m.boostId); respond(true);
            };
            chrome.runtime.onMessage.addListener(onMsg);
            return () => { chrome.runtime.onMessage.removeListener(onMsg); stopTint(); };
        },
    },
});

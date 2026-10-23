/*
 * Navigation（§2 / §3.1）：侧边栏顶部只有精简地址胶囊（只显示域名，加载中显示进度条），没有 后退 / 前进 / 刷新 按钮。
 * 点地址胶囊 = ⌘L（命令栏预填当前网址）；右键站点菜单 Arc 没有（审计 52193 多出项 #5），默认关闭，选项 siteMenu 打开。
 */
import { detectBrowserScheme, displayUrl, isBlankPage, loadCachedBrowserScheme } from "@api/displayUrl";
import "@components/ArcTooltip";
import { safe } from "@api/ErrorLog";
import { tr } from "@api/i18n";
import { urlbarIndicators, refresh } from "@api/Slots";

import { openMenu } from "@components/Menu";
import { copyUrlWithToast } from "@api/PanelShell";
import { icon } from "@api/icons";
import { h } from "@api/dom";
import { runCommand } from "@api/Commands";
import { addSection } from "@api/Slots";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { definePluginSettings } from "@api/Settings";
import { activeTab, getWindowId } from "@plugins/_core/tabState";

/** 地址胶囊显示（url-format.md：Top Bar FUN_10006dedc @0x10006e144 → FUN_10082283c(1,…)）：
 *   网页 = 只显示域名（去账号密码、截到第一个 ? 或 /、去 https:// 否则 http://、去 www.、host 小写）；
 *   内部页 = 浏览器自己的协议名 + host（helium://extensions，Cat 规则；Arc 内部 scheme 显示 ⛔）；
 *   扩展页 / file: 保留原有写法（Rea 未覆盖 ⛔）。空 = ""，胶囊渲染处显示占位符 “Search or Enter URL…”（NSLocalizedString @0x10393f350）。
 *   点击 / 编辑仍用真实网址（编辑态文本 ⛔）。 */
export function displayHost(url?: string, _title?: string) {
    if (!url || isBlankPage(url)) return ""; // 空占位符只在胶囊渲染处补（siteControls 用 displayHost(...) || "page" 拼文件名）
    try {
        const u = new URL(url);
        if (u.protocol === "chrome-extension:") return `${u.host === chrome.runtime.id ? "" : "chrome-extension://"}${u.host === chrome.runtime.id ? "" : u.host}${u.pathname}`.replace(/^\//, "");
        if (u.protocol === "file:") return decodeURIComponent(u.pathname);
        return displayUrl(url, "domain");
    } catch { return url; }
}


const settings = definePluginSettings({
    siteMenu: { type: OptionType.BOOLEAN, default: false, description: "nav.siteMenu" }, // Arc 没有地址胶囊右键菜单：默认关闭（审计 52193 多出项 #5）
    loadingBar: { type: OptionType.BOOLEAN, default: false, description: "nav.loadingBar" }, // Arc 没有地址栏加载进度条：默认关闭（审计 52193 多出项 #6；样式 command/style.ts :root[data-urlbar-progress]）
});
/** 进度条开关写到 <html data-urlbar-progress>（元素始终渲染，自测依赖它；只由 CSS 决定是否可见） */
const syncProgressAttr = () => { if (typeof document !== "undefined") document.documentElement.toggleAttribute("data-urlbar-progress", !!settings.store.loadingBar); };

/** 「视图 · 站点控制」启用时注册：点地址胶囊左侧图标打开 Arc 式站点控制面板 */
export const siteControlsHook: { open?: (at: { x: number; y: number }, t?: chrome.tabs.Tab) => unknown } = {};

/** 站点控制菜单（地址胶囊右键，需开启 siteMenu；站点控制插件关闭时也作为按钮的回退）：浏览器的权限面板不可用，提供最接近的常用项 */
function siteControls(e: MouseEvent, t: chrome.tabs.Tab) {
    let origin = ""; try { origin = new URL(t.url ?? "").origin; } catch { /* 非网页 */ }
    openMenu({ x: e.clientX, y: e.clientY }, [
        { label: tr("tab.copyLink"), test: "site:copy", run: () => void copyUrlWithToast(t.url ?? "") },
        ...(origin.startsWith("http") ? [{ label: tr("nav.siteSettings"), test: "site:settings", run: () => void safe(chrome.tabs.create({ url: `chrome://settings/content/siteDetails?site=${encodeURIComponent(origin)}` }), "tabs.create") }] : []),
        { label: tr("nav.hardReload"), test: "site:hardReload", run: () => void safe(chrome.tabs.reload(t.id!, { bypassCache: true }), "tabs.reload") },
        { label: tr("media.pip"), test: "site:pip", run: () => void safe(chrome.scripting.executeScript({ target: { tabId: t.id! }, func: () => { const v = Array.from(document.querySelectorAll("video")).toSorted((a, b) => b.clientWidth - a.clientWidth)[0]; if (v) void v.requestPictureInPicture().catch(() => { /* 页面上下文，无法用 safe */ }); } }), "scripting.executeScript") },
        { label: t.mutedInfo?.muted ? tr("tab.unmute") : tr("tab.mute"), test: "site:mute", run: () => void safe(chrome.tabs.update(t.id!, { muted: !t.mutedInfo?.muted }), "tabs.update") },
    ]);
}

export default definePlugin({
    name: "Navigation",
    authors: [Devs.ArcSidebar],
    label: "plugin.navigation.label",
    description: "plugin.navigation.desc",
    tags: ["command"],
    enabledByDefault: true,
    settings,
    onSettingsChange: syncProgressAttr,
    commands: [
        { id: "nav.back", label: "nav.back", keywords: ["back"], context: "panel", run: () => { const t = activeTab(); if (t?.id != null) void chrome.tabs.goBack(t.id).catch(() => { /* 无历史时 Cannot go back，属正常 */ }); } },
        { id: "nav.forward", label: "nav.forward", keywords: ["forward"], context: "panel", run: () => { const t = activeTab(); if (t?.id != null) void chrome.tabs.goForward(t.id).catch(() => { /* 无历史时 Cannot go forward，属正常 */ }); } },
        // ⌘Y / Ctrl+H 默认键 Arc 没有（审计 52193 多出项 #7）：默认不绑键，命令保留
        { id: "nav.history", label: "nav.history", keywords: ["history"], context: "panel", run: () => chrome.tabs.create({ url: "chrome://history", windowId: getWindowId() }) },
        { id: "nav.reload", label: "nav.reload", keywords: ["reload", "refresh"], context: "panel", run: () => { const t = activeTab(); if (t?.id != null) void safe(chrome.tabs.reload(t.id), "tabs.reload"); } },
    ],
    content: {
        start() {
            // 页面还在加载时按 Esc = 停止加载（同 Arc）
            const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && document.readyState !== "complete" && !e.defaultPrevented) window.stop(); };
            window.addEventListener("keydown", onKey, true);
            return () => window.removeEventListener("keydown", onKey, true);
        },
    },
    panel: {
        start: () => {
            // 内部页协议名（helium://）：Helium 的 UA 与 Chrome 相同，靠内置 uBO 识别（displayUrl.ts）；识别完重绘胶囊
            void safe(loadCachedBrowserScheme().then(() => detectBrowserScheme()).then(() => refresh()), "nav.detectScheme");
            syncProgressAttr();
            const off = addSection("top", "Navigation", {
            order: 0,
            render(el) {
                const t = activeTab();
                const loading = t?.status === "loading";
                const secure = t?.url?.startsWith("https://") || !/^https?:/.test(t?.url ?? "");
                const openSite = (e: Event) => {
                    e.stopPropagation();
                    if (!t) return;
                    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    if (siteControlsHook.open) void siteControlsHook.open({ x: r.right - 300, y: r.bottom + 8 }, t);
                    else siteControls(e as MouseEvent, t);
                };
                // 地址栏本体与内部图标都没有 tooltip（Rea arc-analysis/tooltip-urlbar.md：CommandBarPlaceholderView / CommandBarIconView 均无 tooltip），只留 aria-label
                // 左侧图标槽（urlbar-icon.md §1/§5，审计 52193 U-01）：文字左缘 无图标 13 / 有图标 34。
                // 图标映射（urlbar-menus-followup.md §2.1，闭包 0x1003adb04）：secureContext == insecure → 一律 insecureLock（lock.slash.fill，"Not secure"），不看 displayStyle；
                // 普通网页（selectedTab）且非 insecure → 收起图标（alpha 0、leading −22，FUN_1003ae008）= 不渲染。
                // lock.fill（secureLock）只在 displayStyle == privateCreativeTool 时出现：扩展没有这个状态，不显示。其余 creativeTool / unselectedTab / fullscreen / welcome 状态扩展也没有。
                // 按钮样式 iconOnly（§3，rUB/1003adbe4.c L98–103：无背景、无阴影），22×22（L70–74）；悬停 α .75 → .95 见 command/style.ts。
                // 点左侧图标 = onTapIconView → 打开站点控制（U-02；点击后的动作 ⛔，按 sidebar-features.md:128 站点控制中心只由点按打开）。
                // 右侧操作按钮（复制链接、站点控制）平时隐藏，悬停 / 键盘聚焦时出现；安全页没有左侧图标，站点控制暂由右侧按钮进入
                el.append(h("div", { class: "arc-nav" },
                    h("div", {
                        class: `arc-urlbar${loading ? " loading" : ""}${secure ? "" : " insecure has-icon"}`, "data-test": "urlbar", role: "button", tabindex: "0",
                        "aria-label": displayUrl(t?.url),
                        onclick: () => void runCommand("commandBar.editUrl"),
                        // 默认关闭：右键胶囊不弹任何菜单（preventDefault 也挡住 PanelShell 的空白处 sidebar 菜单和浏览器原生菜单）
                        oncontextmenu: (e: MouseEvent) => { e.preventDefault(); e.stopPropagation(); if (t && settings.store.siteMenu) siteControls(e, t); },
                    },
                    // SF lock.slash.fill 13pt Semibold → min(14/w,14/h,1) 重绘、setTemplate（§1，rUB2/1002a2b54.c L30–35 / L61–62）：用 Rea 的 14×14 导出 arc-icons/urlbar/lock.slash.fill_14x14.svg（icons.ts SF_GLYPHS.lockSlashFill，currentColor；不再用 alert 按 13→14 放大）
                    secure ? null : h("button", { class: "arc-urlbar-icon arc-insecure", "data-test": "urlbar-icon", "aria-label": tr("nav.insecure"), onclick: openSite }, icon("lockSlashFill", 14)),
                    // 审计 52193 U-04：没有网址时显示占位文字，加 .empty → 占位色 α.3（T-C20，command/style.ts）
                    h("span", { class: displayHost(t?.url || t?.pendingUrl, t?.title) ? "arc-urlbar-host" : "arc-urlbar-host empty" }, displayHost(t?.url || t?.pendingUrl, t?.title) || tr("cmdbar.placeholder")),
                    h("span", { class: "arc-urlbar-actions" },
                        // 插件指示（@api/Slots addUrlbarIndicator），常驻显示
                        ...(t ? urlbarIndicators.sorted().map(([id, d]) => { let st: ReturnType<typeof d.state> = null; try { st = d.state(t); } catch { st = null; } if (!st) return null; return h("button", { class: "arc-urlbar-btn arc-urlbar-ind", "data-test": `urlbar-ind-${id}`, "aria-label": st.title || undefined, style: st.color ? `color:${st.color}` : undefined, onclick: (e: MouseEvent) => { e.stopPropagation(); void d.onClick?.(t); } }, icon(st.icon, 13)); }) : []),

                        h("button", {
                            class: "arc-urlbar-btn", "aria-label": tr("tab.copyLink"), "data-test": "urlbar-copy",
                            onclick: (e: MouseEvent) => { e.stopPropagation(); if (t?.url) void copyUrlWithToast(t.url); },
                        }, icon("link", 13)),
                        h("button", {
                            class: "arc-urlbar-btn", "aria-label": tr("site.open"), "data-test": "site-controls-btn", onclick: openSite,
                        }, icon("sliders", 13))),
                    h("span", { class: "arc-urlbar-progress" }))));
            },
            });
            return () => { off(); document.documentElement.removeAttribute("data-urlbar-progress"); };
        },
    },
});

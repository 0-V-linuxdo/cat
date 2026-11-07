/*
 * Split View（§8）：一个扩展页 split.html 用 iframe 横向 / 纵向并排 2–4 个网页，
 * 在侧边栏里表现为一个标签。为让网站可被嵌入，启用期间添加一条 DNR 会话规则，
 * 仅对“由本扩展发起的子框架请求”去掉 X-Frame-Options / CSP（停用插件即撤销）。
 * 已知限制：第三方 Cookie 受限的网站在分屏中可能需要重新登录。
 */
import "@components/ArcTooltip";
import { splitRatio } from "./geometry";
import { safeExpected } from "@plugins/library/media/expectedErrors";
import { safe } from "@api/ErrorLog";
import { tr } from "@api/i18n";
import { h } from "@api/dom";
import { icon } from "@api/icons";
import { listen } from "@api/ChromeEvents";
import { subscribe } from "@api/Events";
import { call, handle } from "@api/RPC";
import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import style from "./style";
import { publishTheme, subscribeTheme } from "./theme";
import definePlugin, { OptionType } from "@utils/types";
import type { MenuItemDef } from "@api/ContextMenus";
import { paneMuted as paneMutedOf, splitMuteIcon } from "../../library/media/state";

const RULE_ID = 4242;
const PAGE = "split.html";
const settings = definePluginSettings({
    direction: { type: OptionType.SELECT, description: "split.direction", options: [{ label: "split.horizontal", value: "row", default: true }, { label: "split.vertical", value: "column" }] },
    splitExtraMenu: { type: OptionType.BOOLEAN, default: false, description: "split.extraMenu" }, // Arc 菜单里没有的项：默认关闭
});

const splitUrl = (urls: string[], dir = settings.store.direction) => {
    const u = new URL(chrome.runtime.getURL(PAGE));
    for (const x of urls) u.searchParams.append("u", x);
    u.searchParams.set("dir", String(dir));
    return u.toString();
};
const isSplit = (url?: string) => !!url?.startsWith(chrome.runtime.getURL(PAGE));
const urlsOf = (url: string) => new URL(url).searchParams.getAll("u");

async function activeTab() {
    const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return t;
}

/** 右键菜单 “Open in Split View”（urlbar-menus-followup.md L326–415 第 11 项，out5/0x102ec5d7c.c L1079 → out7/0x102ebea8c.c，action openInSplitView(11)）：无条件出现。
 *  标签 / 固定 / 收藏菜单是同一构造器 → 同一项注册到三处（P-04），不另写实现。
 *  固定 / 收藏项：原标签关掉后条目仍在（只是卸载）；Arc 对固定 / 收藏项是“移入分屏”还是“复制进分屏”未分析 ⛔，沿用标签菜单行为。 */
export const splitMenuItem: MenuItemDef = {
    id: "split", label: "split.withCurrent", command: "split.new", order: 30,
    run: async t => { const cur = await activeTab(); if (t.url && cur?.id !== t.tabId) { await addPane(t.url, cur); if (t.tabId) await chrome.tabs.remove(t.tabId).catch(() => { }); } }, // 预期：收藏 / 固定记着的标签可能已关闭，忽略
};

export async function addPane(link?: string, tab?: chrome.tabs.Tab, where?: "left" | "right" | "top" | "bottom") {
    const t = tab ?? await activeTab();
    if (t?.id == null) return;
    const urls = isSplit(t.url) ? urlsOf(t.url!) : [t.url ?? ""];
    if (urls.length >= 4) return;
    if (where === "left" || where === "top") urls.unshift(link ?? ""); else urls.push(link ?? "");
    const dir = where === "top" || where === "bottom" ? "column" : where ? "row" : isSplit(t.url) ? new URL(t.url!).searchParams.get("dir") ?? settings.store.direction : settings.store.direction;
    await chrome.tabs.update(t.id, { url: splitUrl(urls, dir) });
}

async function closePane() {
    const t = await activeTab();
    if (!t?.id || !isSplit(t.url)) return;
    const urls = urlsOf(t.url!);
    urls.pop();
    await chrome.tabs.update(t.id, { url: urls.length > 1 ? splitUrl(urls) : urls[0] || "chrome://newtab" });
}

/** 给当前标签里的分屏页发指令（关闭焦点面板 / 切换方向 / 聚焦第 N 个面板） */
async function toPage(type: string, extra: object = {}) {
    const t = await activeTab();
    if (t?.id == null || !isSplit(t.url)) return;
    await safeExpected(chrome.runtime.sendMessage({ type, tabId: t.id, ...extra }), "runtime.sendMessage", "message"); // 分屏页没开时无接收方属正常，静默
}

async function separate(tab?: chrome.tabs.Tab) {
    const t = tab ?? await activeTab();
    if (!t?.id || !isSplit(t.url)) return;
    const all = urlsOf(t.url!).filter(Boolean);
    const first = all.at(0);
    const rest = all.slice(1);
    for (const [i, u] of rest.entries()) await chrome.tabs.create({ url: u, index: t.index + 1 + i, active: false });
    await chrome.tabs.update(t.id, { url: first ?? "chrome://newtab" });
}

/** 把标签 dragged 拖到 target 上组成分屏（side = dragged 放在左 / 右），关闭被拖的标签 */
async function mergeTabs(targetId: number, draggedId: number, side: "left" | "right") {
    if (targetId === draggedId) return;
    const [a, b] = await Promise.all([chrome.tabs.get(targetId), chrome.tabs.get(draggedId)]);
    const left = isSplit(a.url) ? urlsOf(a.url!) : [a.url ?? ""];
    const add = isSplit(b.url) ? urlsOf(b.url!) : [b.url ?? ""];
    const urls = (side === "left" ? [...add, ...left] : [...left, ...add]).slice(0, 4);
    await chrome.tabs.update(targetId, { url: splitUrl(urls), active: true });
    await chrome.tabs.remove(draggedId);
}

/* ---------------- 分屏页（page 上下文） ---------------- */
function mountPage() {
    if (!location.pathname.endsWith(PAGE)) return;
    const params = new URLSearchParams(location.search);
    const urls = params.getAll("u");
    let dir = params.get("dir") === "column" ? "column" : "row";
    let focused = 0;
    // 各面板比例（可拖动分隔条调整，双击分隔条恢复均分）
    let ratios = (params.get("r") ?? "").split(",").map(Number).filter(x => x > 0);
    const fixRatios = () => { if (ratios.length !== urls.length) ratios = urls.map(() => 1); };
    const write = (next: string[]) => { fixRatios(); history.replaceState(null, "", `?${[...next.map(u => `u=${encodeURIComponent(u)}`), `dir=${dir}`, `r=${ratios.map(x => x.toFixed(3)).join(",")}`].join("&")}`); };
    const gutter = (i: number) => {
        const g = h("div", { class: `split-gutter ${dir}`, role: "separator", "aria-orientation": dir === "row" ? "vertical" : "horizontal", "data-tip": tr("split.resize"), "data-gutter": String(i) });
        g.addEventListener("dblclick", () => { ratios = urls.map(() => 1); write(urls); draw(); });
        g.addEventListener("pointerdown", (e: PointerEvent) => {
            e.preventDefault();
            g.setPointerCapture(e.pointerId);
            root.classList.add("resizing");
            const panes = [...root.querySelectorAll<HTMLElement>(".split-pane")];
            const a = panes[i].getBoundingClientRect(), b = panes[i + 1].getBoundingClientRect();
            const total = dir === "row" ? a.width + b.width : a.height + b.height;
            const sum = ratios[i] + ratios[i + 1];
            const start = dir === "row" ? a.left : a.top;
            const move = (ev: PointerEvent) => {
                const pos = (dir === "row" ? ev.clientX : ev.clientY) - start;
                const k = splitRatio(pos, total); // 最小窗格 220（T-S16）
                ratios[i] = sum * k; ratios[i + 1] = sum * (1 - k);
                panes[i].style.flex = `${ratios[i]} 1 0`; panes[i + 1].style.flex = `${ratios[i + 1]} 1 0`;
            };
            const up = () => { g.removeEventListener("pointermove", move); root.classList.remove("resizing"); write(urls); };
            g.addEventListener("pointermove", move);
            g.addEventListener("pointerup", up, { once: true });
        });
        return g;
    };
    const root = document.getElementById("split")!;
    const closeAt = (i: number) => { urls.splice(i, 1); ratios.splice(i, 1); focused = Math.min(focused, urls.length - 1); if (!urls.length) window.close(); else { write(urls); draw(); } };
    const toggleDir = () => { dir = dir === "row" ? "column" : "row"; write(urls); draw(); };
    const focusPane = (i: number) => { const f = root.querySelectorAll("iframe")[i]; if (f) { focused = i; f.focus(); mark(); } };
    const mark = () => root.querySelectorAll(".split-pane").forEach((p, i) => p.classList.toggle("focused", i === focused));
    // 记录最后获得焦点的面板（iframe 获焦时主文档 blur）
    window.addEventListener("blur", () => setTimeout(() => {
        const i = [...root.querySelectorAll("iframe")].indexOf(document.activeElement as HTMLIFrameElement);
        if (i >= 0) { focused = i; mark(); }
    }));
    const paneMuteState = new WeakMap<HTMLIFrameElement, boolean | null>();
    const muteButtons = new WeakMap<HTMLIFrameElement, HTMLElement>();
    window.addEventListener("message", e => {
        const d = e.data as { arcSplit?: string; muted?: boolean | null };
        if (d?.arcSplit !== "muteState") return;
        const frame = [...root.querySelectorAll("iframe")].find(f => f.contentWindow === e.source);
        if (!frame) return;
        paneMuteState.set(frame, d.muted ?? null);
        muteButtons.get(frame)?.replaceChildren(icon(splitMuteIcon(d.muted ?? null), 14));
    });
    const draw = () => {
        fixRatios();
        root.style.flexDirection = dir;
        root.replaceChildren(...urls.flatMap((u, i) => {
            const input = h("input", { class: "split-url", value: u, placeholder: tr("split.urlPlaceholder") });
            const frame = h("iframe", { src: u || "about:blank", allow: "fullscreen; clipboard-read; clipboard-write", referrerpolicy: "strict-origin-when-cross-origin" });
            input.addEventListener("keydown", e => {
                if (e.key !== "Enter") return;
                const v = input.value.trim();
                urls[i] = /^[a-z]+:\/\//i.test(v) ? v : `https://${v}`;
                write(urls); draw();
            });
            // 静音按钮：图标只跟随面板 iframe 里媒体的真实 muted（内容脚本回报 muteState），不在按钮上自存状态
            const muteBtn = h("button", { "data-tip": tr("split.mutePane"), "data-test": "split:mute", onclick: () => {
                frame.contentWindow?.postMessage({ arcSplit: "mute", on: !paneMuteState.get(frame) }, "*"); // 面板可跳到任意源，targetOrigin 只能 "*"；负载只是静音开关，不含数据；回报端已核对 e.source
            } }, icon(splitMuteIcon(null), 14));
            frame.addEventListener("load", () => frame.contentWindow?.postMessage({ arcSplit: "muteQuery" }, "*"));
            muteButtons.set(frame, muteBtn);
            const pane = h("div", { class: "split-pane", style: `flex:${ratios[i]} 1 0` },
                h("div", { class: "split-bar" }, input,
                    h("button", { "data-tip": tr("split.openInTab"), onclick: () => window.open(urls[i], "_blank") }, icon("splitSeparate", 14)),
                    muteBtn,
                    i === 0 ? h("button", { "data-tip": tr("split.toggleDir"), "data-test": "split:dir", onclick: toggleDir }, icon(dir === "row" ? "splitRows" : "splitCols", 14)) : null,
                    h("button", { "data-tip": tr("split.closePane"), onclick: () => closeAt(i) }, icon("x", 14))),
                frame);
            return i ? [gutter(i - 1), pane] : [pane];
        }));
        mark();
        document.title = tr("split.title", urls.map(u => { try { return new URL(u).hostname; } catch { return tr("split.newPane"); } }).join(" | "));
    };
    draw();
    // 面板 iframe 里的内容脚本转发 ⌘L：聚焦该面板自己的地址栏（只改这个面板）
    window.addEventListener("message", e => {
        if ((e.data as { arcSplit?: string })?.arcSplit !== "focusUrl") return;
        const frames = [...root.querySelectorAll("iframe")];
        const i = frames.findIndex(f => f.contentWindow === e.source);
        const inp = root.querySelectorAll<HTMLInputElement>(".split-url")[i];
        if (inp) { focused = i; mark(); inp.focus(); inp.select(); }
    });
    let myTab: number | undefined;
    void safe(chrome.tabs.getCurrent().then(t => { myTab = t?.id; }), "tabs.getCurrent");
    const onMsg = (m: { type?: string; url?: string; tabId?: number; n?: number }) => {
        if (m?.type === "split:add" && urls.length < 4) { urls.push(m.url ?? ""); write(urls); draw(); return; }
        // 快捷键：只作用于目标标签中的分屏页
        if (m?.tabId == null || m.tabId !== myTab) return;
        if (m.type === "split:closeFocused") closeAt(focused);
        else if (m.type === "split:toggleDir") toggleDir();
        else if (m.type === "split:focus" && m.n != null) focusPane(m.n);
    };
    chrome.runtime.onMessage.addListener(onMsg);
    return () => chrome.runtime.onMessage.removeListener(onMsg);
}

export default definePlugin({
    name: "SplitView",
    authors: [Devs.ArcSidebar],
    label: "plugin.splitView.label",
    description: "plugin.splitView.desc",
    tags: ["views"],
    enabledByDefault: true,
    settings,
    commands: [
        { id: "split.new", label: "split.cmdNew", keywords: ["split view", "new split"], context: "background", defaultKey: "Ctrl+Shift+=", run: () => addPane() },
        { id: "split.close", label: "split.cmdClose", context: "background", defaultKey: "Ctrl+Shift+-", run: closePane },
        ...(["left", "right", "top", "bottom"] as const).map(w => ({ id: `split.add_${w}`, label: `split.add_${w}`, keywords: ["split", w], context: "background" as const, run: () => addPane(undefined, undefined, w) })),
        { id: "split.closeFocused", label: "split.cmdCloseFocused", context: "background", run: () => toPage("split:closeFocused") },
        { id: "split.toggleDir", label: "split.toggleDir", keywords: ["split direction"], context: "background", run: () => toPage("split:toggleDir") },
        ...Array.from({ length: 4 }, (_, i) => ({
            // ⌃⇧1…4 默认键 Arc 没有（审计 52193 多出项 #7）：默认不绑键，命令保留
            id: `split.focus${i + 1}`, label: tr("split.focusN", i + 1), hidden: true, context: "background" as const, run: () => toPage("split:focus", { n: i }),
        })),
        { id: "split.separate", label: "split.cmdSeparate", keywords: ["separate"], context: "background", run: () => separate() },
    ],
    contextMenuItems: {
        tab: [
            splitMenuItem,
            { id: "separate", label: "split.separate", order: 31, visible: t => !!settings.store.splitExtraMenu && isSplit(t.url), run: async t => separate(await chrome.tabs.get(t.tabId!)) },
        ],
        // 固定 / 收藏菜单组 4 第一项：同一项；版式 split [3, 30] 见 ContextMenus.ts MENU_LAYOUT
        pinned: [splitMenuItem],
        favorite: [splitMenuItem],
    },
    background: {
        async start() {
            await chrome.declarativeNetRequest.updateSessionRules({
                removeRuleIds: [RULE_ID],
                addRules: [{
                    id: RULE_ID, priority: 1,
                    action: { type: chrome.declarativeNetRequest.RuleActionType.MODIFY_HEADERS, responseHeaders: [
                        { header: "x-frame-options", operation: chrome.declarativeNetRequest.HeaderOperation.REMOVE },
                        { header: "content-security-policy", operation: chrome.declarativeNetRequest.HeaderOperation.REMOVE },
                    ] },
                    condition: { initiatorDomains: [chrome.runtime.id], resourceTypes: [chrome.declarativeNetRequest.ResourceType.SUB_FRAME] },
                }],
            });
            chrome.contextMenus.create({ id: "arc-split-link", title: tr("split.openLink"), contexts: ["link"] }, () => void chrome.runtime.lastError);
            return [
                () => void safe(chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [RULE_ID] }), "declarativeNetRequest.updateSessionRules"),
                () => chrome.contextMenus.remove("arc-split-link", () => void chrome.runtime.lastError),
                subscribe("languageChange", () => chrome.contextMenus.update("arc-split-link", { title: tr("split.openLink") }, () => void chrome.runtime.lastError)),
                listen("contextMenus.onClicked", (info, tab) => { if (info.menuItemId === "arc-split-link" && info.linkUrl) void addPane(info.linkUrl, tab); }),
                handle("split:merge", ([t, d, side]) => mergeTabs(t as number, d as number, side as "left" | "right")),
                handle("split:openLink", ([url], sender) => addPane(url as string, sender.tab)),
            ];
        },
    },
    content: {
        start() {
            // 在分屏面板里：⌘L 交给分屏页聚焦本面板地址栏；接收“静音本面板”
            const extOrigin = new URL(chrome.runtime.getURL("")).origin;
            // 只认分屏页的直接子面板：父窗口源 = 扩展源（面板里再嵌的 iframe 不算面板，不转发 ⌘L、不收静音）
            const inPane = window.top !== window && location.ancestorOrigins?.[0] === extOrigin;
            const onPaneKey = (e: KeyboardEvent) => { if (inPane && (e.metaKey || e.ctrlKey) && e.code === "KeyL") { e.preventDefault(); e.stopImmediatePropagation(); window.parent.postMessage({ arcSplit: "focusUrl" }, extOrigin); } };
            let paneMuted = false;
            const applyMute = () => { for (const m of Array.from(document.querySelectorAll<HTMLMediaElement>("video,audio"))) m.muted = paneMuted; };
            const report = () => window.parent.postMessage({ arcSplit: "muteState", muted: paneMutedOf(Array.from(document.querySelectorAll<HTMLMediaElement>("video,audio"), m => m.muted)) }, extOrigin); // targetOrigin 固定扩展源（同 rel66），不用 "*"
            const onPaneMsg = (e: MessageEvent) => {
                if (!inPane || e.source !== window.parent) return;
                const k = (e.data as { arcSplit?: string })?.arcSplit;
                if (k === "mute") { paneMuted = !!(e.data as { on?: boolean }).on; applyMute(); report(); } else if (k === "muteQuery") report();
            };
            const onVol = () => report(); // 页面自己改 muted（如播放器静音键）也回报真实状态
            const mo = new MutationObserver(() => { if (paneMuted) applyMute(); });
            if (inPane) { window.addEventListener("keydown", onPaneKey, true); window.addEventListener("message", onPaneMsg); document.addEventListener("volumechange", onVol, true); mo.observe(document.documentElement, { childList: true, subtree: true }); report(); } // 内容脚本可能晚于 iframe load 注入：启动时主动回报一次
            const stopPane = () => { window.removeEventListener("keydown", onPaneKey, true); window.removeEventListener("message", onPaneMsg); document.removeEventListener("volumechange", onVol, true); mo.disconnect(); };
            const onClick = (e: MouseEvent) => {
                if (!e.altKey || e.button !== 0 || e.metaKey || e.ctrlKey) return;
                const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
                if (!a || !/^https?:/.test(a.href)) return;
                e.preventDefault(); e.stopImmediatePropagation();
                void call("split:openLink", a.href);
            };
            window.addEventListener("click", onClick, true);
            return () => { window.removeEventListener("click", onClick, true); stopPane(); };
        },
    },
    // 侧栏：把 Space 主题（data-theme / data-bb-dark）发布给分屏页
    panel: { start: () => publishTheme() },
    page: { start: () => { if (!location.pathname.endsWith(PAGE)) return; const off = subscribeTheme(); mountPage(); return off; }, managedStyle: style },
});

/*
 * Command Bar（§3.2 / §11）：新建标签、搜索打开的标签 / 历史 / 书签 / 命令 / Space，
 * 回车打开网址或用默认搜索引擎搜索。所有结果来源都走 api/Search 注册表，其他插件可扩展。
 * 浏览器保留了 Ctrl/⌘+T，所以全局快捷键默认是 Alt+T（manifest commands，可在 chrome://extensions/shortcuts 修改）。
 */
import { keyFor } from "@api/Commands";
import { displayUrl } from "@api/displayUrl";
import "@components/ArcTooltip";
import { safe } from "@api/ErrorLog";
import { flog } from "@api/FocusLog";
import { tr } from "@api/i18n";
import { siteSearch } from "./siteSearch";
import { icon } from "@api/icons";
import { commands, runCommand } from "@api/Commands";
import { h } from "@api/dom";
import { addSearchProvider, fuzzyScore, searchProviders, type SearchResult } from "@api/Search";
import { addOverlay, openOverlay } from "@api/Slots";
import { listen } from "@api/ChromeEvents";
import { faviconUrl, looksLikeUrl, toUrl } from "@utils/misc";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { definePluginSettings } from "@api/Settings";
import { call, handle } from "@api/RPC";
import { closeOverlay, currentOverlay } from "@api/PanelShell";
import { spacesStore } from "@plugins/spaces/spaceManager/store";
import { activeTab, getWindowId } from "@plugins/_core/tabState";

interface BarArg { replace?: boolean }

const openTab = (url?: string) => chrome.tabs.create({ url, windowId: getWindowId(), active: true });

function render(box: HTMLElement, arg: unknown, close: () => void) {
    const replace = !!(arg as BarArg | undefined)?.replace;
    const input = h("input", { class: "arc-input arc-cmd-input", placeholder: replace ? tr("cmdbar.editUrl") : tr("cmdbar.placeholder"), value: replace ? activeTab()?.url ?? "" : "" });
    const list = h("div", { class: "arc-list arc-cmd-results" });
    let results: SearchResult[] = [];
    let sel = 0;
    let seq = 0;
    // 结果是否对应当前输入：输入一变即置 stale，回车会等最新一轮搜索完成再执行（防旧高亮被执行）
    let stale = false;
    let pending: Promise<void> = Promise.resolve();
    let timer: ReturnType<typeof setTimeout> | undefined;

    const startUrl = input.value;
    const go = (q: string) => {
        if (!q.trim()) return;
        // ⌘L 后不改网址直接回车 = 刷新
        if (replace && q === startUrl) { const t = activeTab(); if (t?.id != null) void safe(chrome.tabs.reload(t.id), "tabs.reload"); close(); return; }
        if (looksLikeUrl(q.trim())) {
            const url = toUrl(q.trim());
            const t = activeTab();
            if (replace && t?.id != null) void safe(chrome.tabs.update(t.id, { url }), "tabs.update"); else void openTab(url);
        } else {
            const t = activeTab();
            const p = replace && t?.id != null ? Promise.resolve(t.id) : openTab().then(n => n.id);
            void p.then(tabId => chrome.search.query({ text: q, tabId }));
        }
        close();
    };
    const paint = () => {
        list.replaceChildren(...results.map((r, i) => h("div", {
            class: `arc-list-row${i === sel ? " sel" : ""}`,
            onclick: () => { void Promise.race([Promise.resolve(r.run()), new Promise(res => setTimeout(res, 1500))]).finally(() => setTimeout(close, 200)); },
            onmousemove: () => { if (sel !== i) { sel = i; paint(); } },
        },
        r.icon ? h("img", { class: "arc-fav", src: r.icon, alt: "" }) : h("span", { class: "arc-fav" }, icon("search", 14)),
        h("span", { class: "arc-tab-title" }, r.title),
        r.subtitle ? h("small", null, r.subtitle) : null,
        r.remove ? h("button", { class: "arc-icon-btn", "data-tip": tr("cmdbar.removeSuggestion"), onclick: (e: MouseEvent) => { e.stopPropagation(); void r.remove!(); void search(); } }, icon("x", 14)) : null)));
    };
    const doSearch = async () => {
        // “/” 开头 = 只搜动作（命令），同 Arc
        const actionsOnly = input.value.trimStart().startsWith("/");
        const q = actionsOnly ? input.value.trim().slice(1).trim() : input.value.trim();
        box.dataset.mode = actionsOnly ? "actions" : "all";
        const my = ++seq;
        const provs = searchProviders.sorted().filter(([id]) => !actionsOnly || id === "commands" || id === "moveToSpace");
        const all = await Promise.all(provs.map(([id, p]) => safe(Promise.resolve(p.search(q)), `cmdbar.search.${id}`, [] as SearchResult[])));
        if (my !== seq) return; // 乱序返回的旧结果丢弃
        results = all.flat().filter(r => (r.score ?? 0) > 0).toSorted((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 30);
        if (actionsOnly) results = results.map(r => ({ ...r, score: (r.score ?? 0) || 1 })).slice(0, 30);
        else if (q) {
            const goRow = { id: "go", title: looksLikeUrl(q) ? tr("cmdbar.open", toUrl(q)) : tr("cmdbar.search", q), score: 1e9, run: () => go(q) };
            if (siteSearch(q)) results.splice(1, 0, goRow); else results.unshift(goRow); // 站点搜索命中时排第一
        }
        sel = 0;
        stale = false;
        delete list.dataset.stale;
        paint();
    };
    const search = (): Promise<void> => {
        stale = true;
        list.dataset.stale = "1";
        list.querySelector(".sel")?.classList.remove("sel"); // 立即去掉旧高亮
        clearTimeout(timer);
        pending = new Promise<void>(res => { timer = setTimeout(() => { void doSearch().finally(res); }, 60); });
        return pending;
    };
    const waitFresh = async () => { while (stale) { const p = pending; await p; if (p === pending) break; } };

    input.addEventListener("input", () => void search());
    input.addEventListener("keydown", e => {
        const down = e.key === "ArrowDown" || e.code === "ArrowDown" || e.key === "Down" || (e.ctrlKey && e.code === "KeyN") || (e.key === "Tab" && !e.shiftKey);
        const up = e.key === "ArrowUp" || e.code === "ArrowUp" || e.key === "Up" || (e.ctrlKey && e.code === "KeyP") || (e.key === "Tab" && e.shiftKey);
        if (e.isComposing) return;
        // 再按一次 ⌘T / ⌘L 关闭命令栏
        if ((e.metaKey || e.ctrlKey) && (e.code === "KeyT" || e.code === "KeyL")) { e.preventDefault(); close(); return; }
        if ((down || up) && stale) { e.preventDefault(); return; }
        if (down) { sel = Math.min(sel + 1, results.length - 1); paint(); e.preventDefault(); }
        else if (up) { sel = Math.max(sel - 1, 0); paint(); e.preventDefault(); }
        else if (e.key === "Enter") {
            e.preventDefault();
            if (stale) { const shift = e.shiftKey; void waitFresh().then(() => enter(shift)); return; }
            enter(e.shiftKey);
        }
    });
    const enter = (shiftKey: boolean) => {
            if (stale) { go(input.value); return; } // 仍未就绪：按当前输入默认动作
            const r = results[sel];
            if (r && !(shiftKey && r.id === "go")) { const p = Promise.race([Promise.resolve(r.run()), new Promise(res => setTimeout(res, 1500))]); if (r.id !== "go") void p.finally(() => setTimeout(close, 200)); } else go(input.value);
    };
    box.append(input, list);
    void search();
    setTimeout(() => { input.focus(); input.select(); });
}

const providers = () => [
    addSearchProvider("siteSearch", "CommandBar", {
        label: tr("cmdbar.siteSearch"),
        search: q => { const s = siteSearch(q); return s ? [{ id: `site:${s.name}`, title: tr("cmdbar.searchOn", s.name, s.text), icon: faviconUrl(s.url), score: 2e9, run: () => openTab(s.url) }] : []; },
    }),
    addSearchProvider("commands", "CommandBar", {
        label: tr("plugin.command.label"),
        search: q => commands.sorted().filter(([, c]) => !c.hidden && c.id !== "commandBar.open").map(([id, c]) => ({
            id: `cmd:${id}`, title: tr(c.label), subtitle: keyFor(id) ?? tr("plugin.command.label"),
            score: Math.max(fuzzyScore(q, tr(c.label)), fuzzyScore(q, c.label), ...(c.keywords ?? []).map(k => fuzzyScore(q, tr(k)))) * (q ? 1 : 0.2),
            run: () => runCommand(id),
        })),
    }),
    addSearchProvider("tabs", "CommandBar", {
        label: tr("cmdbar.openTabs"),
        async search(q) {
            if (!q) return [];
            return (await chrome.tabs.query({})).map(t => ({
                id: `tab:${t.id}`, title: t.title || displayUrl(t.url, "domain"), subtitle: tr("cmdbar.switchToTab"), icon: t.favIconUrl || faviconUrl(t.url),
                // 当前空间的标签排在前面（同 Arc：建议随空间更新）
                score: Math.max(fuzzyScore(q, t.title ?? ""), fuzzyScore(q, t.url ?? "") * 0.8) * ((spacesStore.get().tabSpace[t.id!] ?? spacesStore.get().activeId) === spacesStore.get().activeId ? 1.5 : 1),
                run: async () => { await chrome.tabs.update(t.id!, { active: true }); await chrome.windows.update(t.windowId, { focused: true }); },
            }));
        },
    }),
    addSearchProvider("history", "CommandBar", {
        label: tr("cmdbar.history"),
        order: 10,
        async search(q) {
            if (!q) return [];
            return (await chrome.history.search({ text: q, maxResults: 12, startTime: 0 })).map(i => ({
                id: `hist:${i.id}`, title: i.title || displayUrl(i.url, "domain"), subtitle: displayUrl(i.url, "domain"), // 显示用；打开 / 删除 / 匹配仍用 i.url icon: faviconUrl(i.url),
                score: Math.max(fuzzyScore(q, i.title ?? ""), fuzzyScore(q, i.url ?? "")) * 0.7 + Math.min(i.visitCount ?? 0, 20),
                run: () => openTab(i.url),
                remove: () => chrome.history.deleteUrl({ url: i.url! }),
            }));
        },
    }),
    addSearchProvider("bookmarks", "CommandBar", {
        label: tr("cmdbar.bookmarks"),
        order: 20,
        async search(q) {
            if (!q) return [];
            return (await chrome.bookmarks.search(q)).filter(b => b.url).slice(0, 8).map(b => ({
                id: `bm:${b.id}`, title: b.title || displayUrl(b.url, "domain"), subtitle: tr("cmdbar.bookmarks"), icon: faviconUrl(b.url),
                score: fuzzyScore(q, b.title) * 0.9, run: () => openTab(b.url),
            }));
        },
    }),
];

/** 居中的独立命令栏小窗（同 Arc 的 ⌘T / ⌘L）：侧边栏无法从网页抢键盘焦点，所以开一个居中 popup 窗口 */
async function openCentered(windowId?: number, edit = false) {
    const win = windowId != null ? await chrome.windows.get(windowId) : await chrome.windows.getLastFocused({ windowTypes: ["normal"] });
    const width = 640, height = 460;
    const left = Math.round((win.left ?? 0) + ((win.width ?? width) - width) / 2);
    const top = Math.round((win.top ?? 0) + Math.max(60, ((win.height ?? height) - height) / 4));
    const w = await chrome.windows.create({ url: chrome.runtime.getURL(`sidepanel.html?popup=commandBar&win=${win.id}${edit ? "&edit=1" : ""}`), type: "popup", width, height, left, top, focused: true });
    if (w?.id == null) return;
    // 焦点去了任何别的窗口（包括 WINDOW_ID_NONE = 别的应用）→ 关闭；刚打开 500ms 内的不算
    const born = Date.now(), id = w.id;
    const onFocus = (f: number) => {
        flog("bg", `onFocusChanged ${f} (cmdbar ${id})`);
        if (f === id || Date.now() - born < 500) return;
        chrome.windows.onFocusChanged.removeListener(onFocus);
        // 弹窗可能已自行关闭：「No window with id」属正常，不记日志
        chrome.windows.remove(id).catch((e: unknown) => { if (!/No window with id/.test(String((e as Error)?.message ?? e))) void safe(Promise.reject(e), "windows.remove"); });
    };
    const onRemoved = (r: number) => { if (r === id) { chrome.windows.onFocusChanged.removeListener(onFocus); chrome.windows.onRemoved.removeListener(onRemoved); } };
    chrome.windows.onFocusChanged.addListener(onFocus);
    chrome.windows.onRemoved.addListener(onRemoved);
}

/** 新标签：设置为“居中小窗”时弹出居中命令栏，否则在侧边栏内打开 */
export function newTabBar() {
    if (settings.store.centered && !new URLSearchParams(location.search).get("popup")) return call("cmdbar:centered", getWindowId());
    openOverlay("commandBar");
}

/** ⌘L：命令栏已打开则关闭（再按一次关闭），否则打开并预填当前网址 */
function editUrl() {
    if (currentOverlay() === "commandBar") { closeOverlay(); return; }
    openOverlay("commandBar", { replace: true });
}

const settings = definePluginSettings({
    centered: { type: OptionType.BOOLEAN, default: true, description: "cmdbar.centered" },
});

export default definePlugin({
    name: "CommandBar",
    settings,
    authors: [Devs.ArcSidebar],
    label: "plugin.commandBar.label",
    description: "plugin.commandBar.desc",
    tags: ["command"],
    required: true,
    commands: [
        { id: "commandBar.open", label: "cmdbar.cmdOpen", context: "panel", run: () => openOverlay("commandBar") },
        { id: "commandBar.editUrl", label: "cmdbar.cmdEditUrl", keywords: ["edit url"], context: "panel", defaultKey: "Mod+L", run: editUrl },
        {
            // ⌘⌥V 默认键 Arc 没有（审计 52193 多出项 #7）：默认不绑键，命令保留
            id: "cmdbar.pasteUrl", label: "cmdbar.cmdPasteUrl", keywords: ["paste url"], context: "panel", run: async () => {
                const t = (await navigator.clipboard.readText().catch(() => "")).trim();
                if (!t) return;
                if (looksLikeUrl(t)) await openTab(toUrl(t)); else { const n = await openTab(); await chrome.search.query({ text: t, tabId: n.id }); }
            },
        },
        { id: "cmdbar.newWindow", label: "cmdbar.cmdNewWindow", keywords: ["new window"], context: "panel", run: () => chrome.windows.create({}) },
        { id: "commandBar.newTab", label: "cmdbar.cmdNewTab", keywords: ["new tab"], context: "panel", run: newTabBar },
    ],
    background: {
        start: () => [
            listen("commands.onCommand", (cmd, tab) => { if (cmd === "open-command-bar") void safe(openCentered(tab?.windowId), "cmdbar.openCentered"); }),
            handle("cmdbar:centered", ([windowId, edit]) => safe(openCentered(windowId as number | undefined, !!edit), "cmdbar.openCentered")),
        ],
    },
    panel: {
        start: () => [addOverlay("commandBar", "CommandBar", { title: tr("plugin.commandBar.label"), render }), ...providers()],
    },
});

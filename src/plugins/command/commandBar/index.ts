/*
 * Command Bar（§3.2 / §11）：新建标签、搜索打开的标签 / 历史 / 书签 / 命令 / Space，
 * 回车打开网址或用默认搜索引擎搜索。所有结果来源都走 api/Search 注册表，其他插件可扩展。
 * 浏览器保留了 Ctrl/⌘+T，所以全局快捷键默认是 Alt+T（manifest commands，可在 chrome://extensions/shortcuts 修改）。
 */
import { keyFor } from "@api/Commands";
import { displayUrl } from "@api/displayUrl";
import "@components/ArcTooltip";
import { safe } from "@api/ErrorLog";
import { commandBarPopupQuery, ENSURE_BLUR_GRACE_MS, ensureNativeAck, inpageActiveFor, isInpageHost, lastEnsureNativeAt, navigateAfterNative, popupBlurAction } from "@api/HostMode";
import { flog } from "@api/FocusLog";
import { tr } from "@api/i18n";
import { siteSearch } from "./siteSearch";
import { createCommitter, gestureNow } from "./popupLogic";
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

/** ensured：调用方（go）已经自己先切过原生了，不要再发一次 */
const openTab = (url?: string, o?: { ensured?: boolean }) => {
    const create = () => chrome.tabs.create({ url, windowId: getWindowId(), active: true });
    if (!url || o?.ensured) return create(); // 无 url（先开空白页再搜索）最终落在搜索结果页，不切
    // 书签 / 历史 / 站点搜索 / 直接输入网址都经这里：目的地是受限页就先切原生，等 ack（最多 500 ms）再建标签（patch 07）
    return Promise.resolve(navigateAfterNative(url, "create", undefined, create, { gestureAt: gestureNow() })); // patch 08：run 经 withGesture 同步调用，gestureAt = 回车 / 点击那一刻
};

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
    const committer = createCommitter(); // patch 08：回车 / 点行只提交一次（等 ack 的 ≤500 ms、stale 等待期间都不再接受第二次）
    const go = (q: string) => {
        if (!q.trim()) { committer.release(); return; }
        // ⌘L 后不改网址直接回车 = 刷新
        if (replace && q === startUrl) { const t = activeTab(); if (t?.id != null) void safe(chrome.tabs.reload(t.id), "tabs.reload"); close(); return; }
        if (looksLikeUrl(q.trim())) {
            const url = toUrl(q.trim());
            const t = activeTab();
            const target = replace && t?.id != null ? t.id : undefined;
            const nav = (): Promise<unknown> => target != null ? safe(chrome.tabs.update(target, { url }), "tabs.update") : safe(openTab(url, { ensured: true }), "tabs.create"); // 永不 reject：close 在它之后
            // patch 07：先切原生并等 ack 再导航。等待期间**不能**先 close()：命令栏弹窗一关，页面脚本就没了，导航发不出去（所以只在发了消息时才推迟 close）
            // patch 08：gestureAt = 回车 / 点击的时刻（stale 等待之后才走到这里）；导航**发出（promise 落定）之后**才 close，且失焦即关在 ensure 期间被延后（HostMode.popupBlurAction / pageBlurAction）
            const ack = ensureNativeAck(url, target != null ? "navigate" : "create", target, { gestureAt: gestureNow() });
            if (ack) { void ack.then(nav).then(close, close); return; }
            void nav();
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
            onclick: () => { committer.press(Date.now(), () => { void Promise.race([Promise.resolve(r.run()), new Promise(res => setTimeout(res, 1500))]).finally(() => setTimeout(close, 200)); }); },
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
            // patch 08：手势时刻在 keydown 当下取；stale 时等最新一轮搜索之后才 enter，但仍按 keydown 的时刻算预算；已提交过（ack 等待中）的第二次回车直接忽略
            const shift = e.shiftKey;
            committer.press(Date.now(), () => enter(shift), stale ? waitFresh() : undefined);
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
                run: async () => { const ack = ensureNativeAck(t.url, "activate", t.id, { gestureAt: gestureNow() }); if (ack) await ack; /* patch 07：等 ack 再激活；patch 08：gestureAt = 回车 / 点击时刻（run 的同步段里读） */ await chrome.tabs.update(t.id!, { active: true }); await chrome.windows.update(t.windowId, { focused: true }); },
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
async function openCentered(windowId?: number, edit = false, viaInpage = false) {
    const win = windowId != null ? await chrome.windows.get(windowId) : await chrome.windows.getLastFocused({ windowTypes: ["normal"] });
    // patch 07：Alt+T / open-command-bar 全局命令没有 iframe 参与，调用方不会带 via；插件在 SW 里注册的探针（同步）回答「这个窗口当前是不是页内侧栏在用」。冷 SW（插件 start 还没跑）= 探针没装 = 不带 via（⚠ 降级）
    viaInpage ||= inpageActiveFor(win.id);
    const width = 640, height = 460;
    const left = Math.round((win.left ?? 0) + ((win.width ?? width) - width) / 2);
    const top = Math.round((win.top ?? 0) + Math.max(60, ((win.height ?? height) - height) / 4));
    const w = await chrome.windows.create({ url: chrome.runtime.getURL(`sidepanel.html?${commandBarPopupQuery(win.id, edit, viaInpage)}`), type: "popup", width, height, left, top, focused: true });
    if (w?.id == null) return;
    // 焦点去了任何别的窗口（包括 WINDOW_ID_NONE = 别的应用）→ 关闭；刚打开 500ms 内的不算
    const born = Date.now(), id = w.id;
    // patch 08：sidePanel.open（ensure-native）会让焦点离开弹窗，这时立刻关弹窗 = 弹窗页里 ack.then(导航) 丢失。ensure-native 刚发过（HostMode.noteEnsureNative，grace 内）= 不立刻关，延后复查一次：那时弹窗仍没拿回焦点才关
    let lastFocus: number | undefined, deferred = false;
    const closeIt = () => {
        chrome.windows.onFocusChanged.removeListener(onFocus);
        // 弹窗可能已自行关闭：「No window with id」属正常，不记日志
        chrome.windows.remove(id).catch((e: unknown) => { if (!/No window with id/.test(String((e as Error)?.message ?? e))) void safe(Promise.reject(e), "windows.remove"); });
    };
    const onFocus = (f: number) => {
        flog("bg", `onFocusChanged ${f} (cmdbar ${id})`);
        lastFocus = f;
        const act = popupBlurAction({ focused: f, popupId: id, born, now: Date.now(), ensureAt: lastEnsureNativeAt() });
        if (act === "ignore") return;
        if (act === "defer") { if (!deferred) { deferred = true; setTimeout(() => { deferred = false; if (lastFocus !== id) closeIt(); }, ENSURE_BLUR_GRACE_MS); } return; }
        closeIt();
    };
    const onRemoved = (r: number) => { if (r === id) { chrome.windows.onFocusChanged.removeListener(onFocus); chrome.windows.onRemoved.removeListener(onRemoved); } };
    chrome.windows.onFocusChanged.addListener(onFocus);
    chrome.windows.onRemoved.addListener(onRemoved);
}

/** 新标签：设置为“居中小窗”时弹出居中命令栏，否则在侧边栏内打开 */
export function newTabBar() {
    if (settings.store.centered && !new URLSearchParams(location.search).get("popup")) return call("cmdbar:centered", getWindowId(), false, isInpageHost()); // 第三个参数：从页内侧栏发起 → 弹窗带 via=inpage，弹窗里的导航也能先切原生
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
            handle("cmdbar:centered", ([windowId, edit, via]) => safe(openCentered(windowId as number | undefined, !!edit, !!via), "cmdbar.openCentered")),
        ],
    },
    panel: {
        start: () => [addOverlay("commandBar", "CommandBar", { title: tr("plugin.commandBar.label"), render }), ...providers()],
    },
});

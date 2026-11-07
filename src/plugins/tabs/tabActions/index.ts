/*
 * Tab Actions（§10 / §16）：标签右键菜单与常用操作——复制链接（去追踪参数）、复制为 Markdown、
 * 复制标签、移动到其它 Space、关闭；以及按侧边栏顺序上 / 下一个标签。
 */
import { withEmptyFallback } from "@components/EmptyFavicon";
import { displayUrl } from "@api/displayUrl";
import { safe } from "@api/ErrorLog";
import { navigateAfterNative } from "@api/HostMode";
import { tr } from "@api/i18n";
import { applyUrlTransforms } from "@api/UrlTransforms";
import { quoteUrl } from "./quote";
import { copyText } from "@api/Clipboard";
import { faviconUrl, serial } from "@utils/misc";
import { h } from "@api/dom";
import { addOverlay, openOverlay } from "@api/Slots";
import { runCommand } from "@api/Commands";
import { closeOverlay, currentOverlay, toast, copyUrlWithToast } from "@api/PanelShell";
import { call } from "@api/RPC";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { definePluginSettings, onExternalSettingsChange } from "@api/Settings";
const settings = definePluginSettings({
    tabExtraMenu: { type: OptionType.BOOLEAN, default: false, description: "tab.extraMenu" }, // Arc 菜单里没有的项：默认关闭
    // 网页右键 “Copy link to highlight”：Arc 没有（审计 52193 多出项 #9），默认关闭；⌃⌘C Copy as Quote 命令保留
    quoteMenu: { type: OptionType.BOOLEAN, default: false, description: "tab.quoteMenu" },
});
import type { MenuItemDef, MenuTarget } from "@api/ContextMenus";
import { spacesStore } from "@plugins/spaces/spaceManager/store";
import { duplicatePin } from "@plugins/tabs/pinnedTabs";

async function current() {
    const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return t;
}
async function copyUrl(md: boolean) {
    const t = await current();
    if (!t?.url) return;
    const url = applyUrlTransforms("copy", t.url);
    const text = md ? `[${t.title ?? url}](${url})` : url;
    return (await copyText(text, t.id)) ? text : false;
}
const queue = serial();
/** 右键菜单 “Duplicate”（urlbar-menus-followup.md L326–415 第 12 项，out5/0x102ec5d7c.c L1082–1153，action Tab.duplicate(3)）：
 *  只要求 !anyLive，没有数量检查，也没有 live / WebContentState 检查 → 永远可用（L661 H1：固定没打开时不隐藏、不置灰）。
 *  标签 / 固定菜单是同一构造器 → 同一项注册到两处（P-04）。固定项（target 带 itemId）复制成一个新的固定项（打开着也一样，不再新开今日标签；
 *  rH/102933e9c.c：复制出的是侧栏条目），由 pinnedTabs 的 duplicatePin 完成；今日标签 = 新开一份标签。收藏的 Duplicate 由 favorites 自带。 */
export const dupMenuItem: MenuItemDef = {
    id: "dup", label: "tab.duplicate", order: 52,
    run: t => {
        if (t.itemId) return duplicatePin(t.itemId);
        if (t.tabId != null) void safe(chrome.tabs.duplicate(t.tabId), "tabs.duplicate");
    },
};
async function step(delta: number) {
    const gestureAt = Date.now(); // 手势时间（patch 07）：目的地要等下面两次查询才知道，所以消息只能在 await 之后发；超过 E8 的 3 s 手势预算就降级（不发）
    const t = await current();
    if (!t) return;
    const sp = spacesStore.get();
    const mine = sp.tabSpace[t.id!] ?? sp.activeId;
    const list = (await chrome.tabs.query({ windowId: t.windowId })).filter(x => (sp.tabSpace[x.id!] ?? sp.activeId) === mine);
    const i = list.findIndex(x => x.id === t.id);
    const next = list[(i + delta + list.length) % list.length];
    if (next?.id != null) await navigateAfterNative(next.url, "activate", next.id, () => chrome.tabs.update(next.id!, { active: true }), { gestureAt }); // ⚠ 前面有 await（current / tabs.query，通常几十 ms）：目的地未知所以无法提前；E8 手势预算内才发，超过降级
}

/** 按侧边栏可见顺序列出条目（收藏 → 固定（含文件夹）→ 今日），供 ⌘1–9 与上 / 下一个使用 */
const sidebarRows = () => [...document.querySelectorAll<HTMLElement>("#app .arc-fav-btn, #app .arc-tab")].filter(el => el.offsetParent !== null);

function jumpTo(n: number) {
    const rows = sidebarRows();
    const el = n === 9 ? rows.at(-1) : rows[n - 1];   // ⌘9 = 最后一个（同 Arc / 浏览器）
    el?.click();
}

async function stepSidebar(delta: number) {
    const rows = sidebarRows();
    if (!rows.length) return step(delta);
    const t = await current();
    // 先按标签 id 精确匹配（今日行 data-sel="tab:<id>"），再退回渲染出的 active 状态
    let i = rows.findIndex(el => el.dataset.sel === `tab:${t?.id}`);
    if (i < 0) i = rows.findIndex(el => el.classList.contains("active") || el.getAttribute("aria-current") === "true");
    if (i < 0) return step(delta); // 当前标签不在侧边栏里（如扩展页）：按标签条顺序
    rows[(i + delta + rows.length) % rows.length]?.click();
}

/** “Move to ›”（tab-tooltip-internal-moveto.md §2）：[Profile 子菜单（仅多 profile，扩展无 profile ⛔ 不做）] → 各 Space → 分隔线 → New Space…
 *  不含文件夹 / 收藏 / 固定 / 今日（源码未找到 ⛔，Cat 定不加）。当前 Space 是否列出 ⛔，沿用不列。 */
function moveToMenu(t: MenuTarget): MenuItemDef[] {
    const d = spacesStore.get();
    const mine = d.tabSpace[t.tabId!] ?? d.activeId;
    return [
        ...d.spaces.filter(s => s.id !== mine).map(s => ({ id: `space:${s.id}`, label: tr("tab.moveToSpace", s.icon, s.name), run: () => call("spaces:moveTab", t.tabId, s.id) })),
        { id: "sep", label: "", separator: true, run: () => { } },
        { id: "newSpace", label: "spaces.moveToNew", run: async () => { const id = await call<string>("spaces:create", tr("spaces.newName")); await call("spaces:moveTab", t.tabId, id); } },
    ];
}

/*
 * 最近标签切换器（同 macOS ⌃Tab；⌃Tab 被浏览器保留，改用 Alt+Q）：
 * 按住 Alt 连按 Q 沿“最近使用”列表前进（Shift+Alt+Q 后退，按住自动重复也算），松开 Alt 切到高亮的标签；
 * 快速按一下 = 切到上一个标签。打开期间列表冻结（不随激活顺序重排）。
 * 网页里按键由 content 的 Shortcuts 转发，松开 Alt 由本插件的 content 部分转发（tab.recentCommit）；
 * 看不到松开事件的页面（chrome:// 等）在最后一次按键后 RECENT_IDLE 毫秒自动确认。
 */
export const RECENT_IDLE = 900;
// at = 最近一次「激活触发事件」（Q 的 keydown / 列表里的点击 / Enter）的时间；松开 Alt（keyup）不是激活触发事件，所以松开时的手势是上一次 keydown（patch 07）。ready = 列表已查好（此时 recentCommit 到发消息之间没有 await）
const recent = { open: false, list: [] as chrome.tabs.Tab[], sel: 0, held: 0, at: 0, ready: false, timer: undefined as ReturnType<typeof setTimeout> | undefined, paint: () => { }, loading: undefined as Promise<void> | undefined };

function recentReset() {
    clearTimeout(recent.timer);
    Object.assign(recent, { open: false, list: [], sel: 0, at: 0, ready: false, timer: undefined, loading: undefined, paint: () => { } });
}

async function recentStep(dir: 1 | -1) {
    recent.at = Date.now();
    if (!recent.open) {
        recent.open = true;
        recent.loading = chrome.tabs.query({}).then(all => {
            recent.list = all.filter(t => !t.url?.startsWith(chrome.runtime.getURL(""))).toSorted((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0)).slice(0, 20);
            recent.sel = recent.list.length < 2 ? 0 : dir > 0 ? 1 : recent.list.length - 1;
            recent.ready = true;
        });
        if (currentOverlay() !== "recentTabs") openOverlay("recentTabs");
        await recent.loading;
    } else {
        await recent.loading;
        const n = recent.list.length;
        if (n) recent.sel = (recent.sel + dir + n) % n;
    }
    recent.paint();
    clearTimeout(recent.timer);
    // 只有拿不到“松开 Alt”的来源时才靠超时确认
    if (Date.now() - recent.held > 1500) recent.timer = setTimeout(() => void recentCommit(), RECENT_IDLE);
}

async function recentCommit() {
    if (!recent.open) return;
    const gestureAt = recent.at;
    if (!recent.ready) await recent.loading; // 正常情况下列表早已查好（打开时就查了），这里零 await；没查好才等（⚠ 此时手势预算照旧从最近一次 keydown 算起）
    const t = recent.list[recent.sel];
    recentReset();
    closeOverlay();
    // patch 07：消息在第一个 await 之前发出（列表已就绪时）；Alt 按住超过 E8 的 3 s 手势预算再松开 = 降级（不发，直接切换，兜底 = 按钮 / 角标）
    if (t?.id != null) await safe(Promise.resolve(navigateAfterNative(t.url, "activate", t.id, () => chrome.tabs.update(t.id!, { active: true }).then(() => chrome.windows.update(t.windowId, { focused: true })), { gestureAt })), "tabs.update+windows.update");
}

/** 有来源能报告“松开 Alt”：取消超时确认 */
function recentHeld() { recent.held = Date.now(); clearTimeout(recent.timer); }

function renderRecent(box: HTMLElement, _arg: unknown, close: () => void) {
    const list = h("div", { class: "arc-list", "data-test": "recent-list" });
    const go = (i: number) => { recent.sel = i; recent.at = Date.now(); void recentCommit(); }; // 点击是激活触发事件：手势时间 = 此刻（patch 07）
    recent.paint = () => list.replaceChildren(...recent.list.map((t, i) => h("div", { class: `arc-list-row${i === recent.sel ? " sel" : ""}`, "data-tab": t.id, onclick: () => go(i) },
        withEmptyFallback(h("img", { class: "arc-fav", src: t.favIconUrl || faviconUrl(t.url), alt: "" }) as HTMLImageElement), h("span", { class: "arc-tab-title" }, t.title || displayUrl(t.url)))));
    // 从命令栏 / 点击打开（不是 Alt+Q）：也建立一次会话，等用户选择，不自动确认
    if (!recent.open) { void recentStep(1).then(() => { clearTimeout(recent.timer); recent.held = Date.now(); }); }
    else recent.paint();
    const onKey = (e: KeyboardEvent) => {
        recent.at = Date.now(); // keydown 是激活触发事件（patch 07）
        if (e.altKey) recentHeld();
        const n = recent.list.length; if (!n) return;
        if (e.key === "ArrowDown") { recent.sel = (recent.sel + 1) % n; recent.paint(); e.preventDefault(); }
        else if (e.key === "ArrowUp") { recent.sel = (recent.sel - 1 + n) % n; recent.paint(); e.preventDefault(); }
        else if (e.key === "Enter") { void recentCommit(); e.preventDefault(); }
    };
    const onUp = (e: KeyboardEvent) => { if (e.key === "Alt") void recentCommit(); };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("keyup", onUp, true);
    box.append(list);
    void close;
    return () => { document.removeEventListener("keydown", onKey, true); document.removeEventListener("keyup", onUp, true); if (recent.open) recentReset(); };
}

export default definePlugin({
    settings,
    name: "TabActions",
    authors: [Devs.ArcSidebar],
    label: "plugin.tabActions.label",
    description: "plugin.tabActions.desc",
    tags: ["tabs"],
    required: true,
    commands: [
        { id: "tab.copyUrl", label: "tab.cmdCopyUrl", keywords: ["copy url"], context: "background", defaultKey: "Mod+Shift+C", run: () => copyUrl(false) },
        // ⌥⇧⌘C / ⌃⇧⌘C：Arc MainMenu.nib 的 keyEquivalent 为大写 “C”（隐含 Shift），见 /workspace/arcdl/menu_keys.tsv
        { id: "tab.copyMarkdown", label: "tab.cmdCopyMd", keywords: ["copy markdown"], context: "background", defaultKey: "Mod+Shift+Alt+C", run: () => copyUrl(true) },
        { id: "tab.mute", label: "tab.cmdMute", keywords: ["mute", "unmute"], context: "background", run: async () => { const t = await current(); if (t?.id) await chrome.tabs.update(t.id, { muted: !t.mutedInfo?.muted }); return !t?.mutedInfo?.muted; } },
        { id: "tab.duplicate", label: "tab.cmdDuplicate", keywords: ["duplicate"], context: "background", run: async () => { const t = await current(); if (!t?.id) return { ok: false, changed: false }; void safe(chrome.tabs.duplicate(t.id), "tabs.duplicate"); return { ok: true, changed: true }; } }, // 52005：tabs.duplicate 的 Promise 要等新标签加载完才结束，命令不等它
        // ⌥Q / ⌥⇧Q 是扩展自己加的默认键（Arc 是 ⌃Tab，浏览器保留），审计 52193 多出项 #7：默认不绑键，命令保留，可在快捷键设置里绑定
        { id: "tab.recent", label: "tab.recent", keywords: ["recent tabs", "mru"], context: "panel", run: () => recentStep(1) },
        { id: "tab.recentBack", label: "tab.recentBack", hidden: true, context: "panel", run: () => recentStep(-1) },
        { id: "tab.recentCommit", label: "tab.recent", hidden: true, context: "panel", run: () => recentCommit() },
        { id: "tab.recentHeld", label: "tab.recent", hidden: true, context: "panel", run: () => recentHeld() },
        // Arc ⌃⌘C Copy as Quote：选中文字 + 来源链接
        { id: "tab.copyQuote", label: "tab.copyQuote", keywords: ["quote"], context: "background", defaultKey: "Ctrl+Mod+Shift+C", run: async () => {
            const t = await current(); if (t?.id == null || !t.url) return;
            const [r] = await chrome.scripting.executeScript({ target: { tabId: t.id }, func: () => String(getSelection() ?? "") }).catch(() => [] as chrome.scripting.InjectionResult<string>[]);
            const sel = (r?.result ?? "").trim(); if (sel) await copyText(quoteUrl(applyUrlTransforms("copy", t.url), sel), t.id);
        } },
        // Arc ⌃Space：在侧边栏中定位当前标签
        { id: "tab.reveal", label: "tab.reveal", keywords: ["locate", "reveal"], context: "panel", defaultKey: "Ctrl+Space", run: () => { const el = document.querySelector<HTMLElement>(".arc-tab.active"); if (!el) return; el.scrollIntoView({ block: "center", behavior: "smooth" }); el.classList.add("arc-flash"); setTimeout(() => el.classList.remove("arc-flash"), 900); } },
        { id: "tab.next", label: "tab.cmdNext", context: "panel", defaultKey: "Mod+Alt+ArrowDown", run: () => queue(() => stepSidebar(1)) },
        // Arc ⌃⌘→ / ⌃⌘←：循环切换标签（与 ⌥⌘↓ / ↑ 同一顺序）
        { id: "tab.cycleNext", label: "tab.cmdNext", hidden: true, context: "panel", defaultKey: "Ctrl+Mod+ArrowRight", run: () => queue(() => stepSidebar(1)) },
        { id: "tab.cyclePrev", label: "tab.cmdPrev", hidden: true, context: "panel", defaultKey: "Ctrl+Mod+ArrowLeft", run: () => queue(() => stepSidebar(-1)) },
        { id: "tab.prev", label: "tab.cmdPrev", context: "panel", defaultKey: "Mod+Alt+ArrowUp", run: () => queue(() => stepSidebar(-1)) },
        ...Array.from({ length: 9 }, (_, i) => ({
            id: `tab.jump${i + 1}`, label: tr("tab.jumpN", i + 1), hidden: true, context: "panel" as const,
            defaultKey: `Mod+${i + 1}`, run: () => jumpTo(i + 1),
        })),
    ],
    panel: { start: () => addOverlay("recentTabs", "TabActions", { title: tr("tab.recent"), render: renderRecent }) },
    // 网页里：按住 Alt 按 Q 时告诉侧边栏“能收到松开事件”，松开 Alt 时确认切换
    content: {
        start() {
            let armed = false;
            const down = (e: KeyboardEvent) => { if (e.altKey && e.code === "KeyQ") { if (!armed) void runCommand("tab.recentHeld"); armed = true; } };
            const up = (e: KeyboardEvent) => { if (e.key === "Alt" && armed) { armed = false; void runCommand("tab.recentCommit"); } };
            const blur = () => { if (armed) { armed = false; void runCommand("tab.recentCommit"); } };
            window.addEventListener("keydown", down, true); window.addEventListener("keyup", up, true); window.addEventListener("blur", blur);
            return () => { window.removeEventListener("keydown", down, true); window.removeEventListener("keyup", up, true); window.removeEventListener("blur", blur); };
        },
    },
    background: {
        start() {
            // 只在 quoteMenu 打开时加网页右键项；设置改动（来自侧边栏 / 设置页）时同步增删
            const sync = () => settings.store.quoteMenu
                ? chrome.contextMenus.create({ id: "arc-quote", title: tr("tab.copyQuote"), contexts: ["selection"] }, () => void chrome.runtime.lastError)
                : chrome.contextMenus.remove("arc-quote", () => void chrome.runtime.lastError);
            sync();
            const offSettings = onExternalSettingsChange(changed => { if (changed.has("TabActions")) sync(); });
            const onClick = (info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab) => {
                if (info.menuItemId !== "arc-quote" || !settings.store.quoteMenu || !info.selectionText || !tab?.url) return;
                void copyText(quoteUrl(applyUrlTransforms("copy", tab.url), info.selectionText), tab.id);
            };
            chrome.contextMenus.onClicked.addListener(onClick);
            return () => { offSettings(); chrome.contextMenus.onClicked.removeListener(onClick); chrome.contextMenus.remove("arc-quote", () => void chrome.runtime.lastError); };
        },
    },
    contextMenuItems: {
        tab: [
            { id: "copy", label: "tab.copyLink", command: "tab.copyUrl", order: 50, run: async t => { if (t.url) await copyUrlWithToast(t.url); } },
            { id: "md", label: "tab.copyMd", command: "tab.copyMarkdown", order: 51, visible: () => !!settings.store.tabExtraMenu, run: async t => { if (t.url && await copyText(`[${t.title}](${applyUrlTransforms("copy", t.url)})`)) toast(tr("common.copied")); } },
            dupMenuItem,
            // Move to（urlbar-menus-followup.md「菜单定案」§2，out5/0x102ec5d7c.c L1157–1165）：非无痕窗口（FUN_102951fd0）且选中项没有 Live Folder 标签（local_1670；今日标签不会是）
            { id: "moveTo", label: "tab.moveTo", order: 60, visible: t => t.tabId != null && !chrome.extension?.inIncognitoContext, run: () => { }, submenu: moveToMenu },
            { id: "close", label: "tab.archiveTab", order: 99, shortcut: "Mod+W", run: t => t.tabId != null && chrome.tabs.remove(t.tabId) },
        ],
        // 固定菜单组 4（Open in Split View / Duplicate / Move to）的 Duplicate：同一项（收藏菜单的 Duplicate 由 favorites 插件自带——复制的是收藏项本身，见 favorites/index.ts duplicateFav）；版式 dup [3, 31] 见 ContextMenus.ts MENU_LAYOUT
        pinned: [dupMenuItem],
    },
});

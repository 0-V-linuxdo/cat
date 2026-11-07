/*
 * Today Tabs（§6.2）：分隔线下方的临时标签——当前 Space 中没有被收藏 / 固定认领的标签。
 * 待确认项的选择：新标签默认显示在顶部（可在设置中改为底部）。
 */
import { safe } from "@api/ErrorLog";
import { navigateAfterNative } from "@api/HostMode";
import { tr } from "@api/i18n";
import { todayHeaderState } from "@api/Slots";
import { onTabIdRemap, remapRecord } from "@api/TabIdRemap";
import { icon, type IconName } from "@api/icons";
import { expandDragData } from "@api/DragData";
import { claimedTabIds } from "@api/Claims";
import { commands, runCommand } from "@api/Commands";
import { h } from "@api/dom";
import { addSection, refresh } from "@api/Slots";
import { call } from "@api/RPC";
import { listen } from "@api/ChromeEvents";
import { isPluginEnabled } from "@api/PluginManager";
import { showContextMenu } from "@api/PanelShell";
import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { getTabs } from "@plugins/_core/tabState";
import { activeSpace, spaceOfTab } from "@plugins/spaces/spaceManager/store";
import { rowIconAnchor, TabRow } from "@components/TabRow";
import { openIconPicker } from "@components/IconPicker";
import { createPluginStore } from "@api/Storage";
import { recordStoreUndo } from "@api/Undo";
import { pinnedStore, unpin, walk } from "@plugins/tabs/pinnedTabs";
import { favStore } from "@plugins/spaces/favorites/store";

/** 从网页拖进来的链接 → 新标签；文字 → 用默认搜索引擎搜索（Arc） */
export function dropExternal(e: DragEvent): boolean {
    const dt = e.dataTransfer;
    if (!dt || dt.types.includes("text/arc-item")) return false;
    const link = dt.getData("text/uri-list").split("\n").find(l => l && !l.startsWith("#"));
    const text = dt.getData("text/plain").trim();
    if (!link && !text) return false;
    e.preventDefault();
    // patch 07：drop 不是激活触发事件 → needActive：本文档此刻没有瞬时激活（navigator.userActivation.isActive）就不发（Chrome 会拒），降级为直接新建，由按钮 / 角标 / 快捷键兜底（⚠ 降级路径，DESIGN 3.7）
    if (link || /^https?:\/\/\S+$/.test(text)) { const url = link || text; void safe(Promise.resolve(navigateAfterNative(url, "create", undefined, () => chrome.tabs.create({ url, active: true }), { needActive: true })), "tabs.create"); }
    else void safe(chrome.tabs.create({ active: true }).then(t => chrome.search.query({ text, tabId: t.id })), "tabs.create");
    return true;
}

/** 让某一行进入就地重命名（命令 / 右键菜单用） */
export function startRename(selKey: string) {
    const el = document.querySelector(`[data-sel="${selKey}"] .arc-tab-title`);
    el?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    return !!el;
}

/** 今日标签的自定义名称（双击标题重命名；Chrome 标签本身没有自定义标题），按 tabId 存 */
export const titleStore = createPluginStore<{ byTab: Record<string, string> }>("tabTitles", () => ({ byTab: {} }));
/** Change Icon（审计 52193 X-04）：今日标签的自定义图标，按 tabId 存（emoji 或 "sym:<名>"），清理同 titleStore */
export const iconStore = createPluginStore<{ byTab: Record<string, string> }>("tabIcons", () => ({ byTab: {} }));

/**
 * 拖到分隔线下方（今日区）：固定项 → 取消固定（未打开的先打开）；收藏 → 移出收藏（未打开的先打开）；
 * 今日标签 → 重新排序。refTabId / before 指定放在哪个标签前后。
 */
export async function dropToToday(data: string, refTabId?: number, before = true) {
    const moved: number[] = [];
    for (const k of expandDragData(data)) {
        if (k.startsWith("tab:")) moved.push(Number(k.slice(4)));
        else if (k.startsWith("pin:")) {
            const n = Object.values(pinnedStore.get().bySpace).flatMap(l => [...walk(l)]).find(x => x.id === k.slice(4));
            if (!n || n.kind !== "tab") continue;
            let id = n.tabId != null && getTabs().some(t => t.id === n.tabId) ? n.tabId : undefined;
            await unpin(n.id);
            if (id == null && n.url) id = (await chrome.tabs.create({ url: n.url, active: false })).id;
            if (id != null) moved.push(id);
        } else if (k.startsWith("fav:")) {
            const f = favStore.get().items.find(i => i.id === k.slice(4));
            if (!f) continue;
            recordStoreUndo(tr("fav.remove"), favStore);
            await favStore.update(x => { x.items = x.items.filter(i => i.id !== f.id); });
            let id = f.tabId != null && getTabs().some(t => t.id === f.tabId) ? f.tabId : undefined;
            if (id == null) id = (await chrome.tabs.create({ url: f.url, active: false })).id;
            if (id != null) moved.push(id);
        }
    }
    if (!moved.length || refTabId == null) return;
    const target = getTabs().find(x => x.id === refTabId);
    if (target) await safe(chrome.tabs.move(moved, { index: target.index + (before === (settings.store.order === "top") ? 1 : 0) }), "tabs.move");
}

const settings = definePluginSettings({
    order: { type: OptionType.SELECT, description: "today.order", options: [{ label: "today.top", value: "top", default: true }, { label: "today.bottom", value: "bottom" }] },
});

export function todayTabs(): chrome.tabs.Tab[] {
    const claimed = claimedTabIds();
    const sp = activeSpace().id;
    const list = getTabs().filter(t => t.id != null && !claimed.has(t.id) && spaceOfTab(t.id) === sp);
    return settings.store.order === "top" ? list.toReversed() : list;
}

export async function clearToday() {
    // 同 Arc：正在播放声音的标签不清掉
    const ids = todayTabs().filter(t => !t.audible).map(t => t.id!);
    if (ids.length) await chrome.tabs.remove(ids);
}

const newTab = () => {
    if (commands.get("commandBar.newTab")) return runCommand("commandBar.newTab"); // 命令栏：最终目的地在命令栏里选定时才切（commandBar 的调用点）
    return Promise.resolve(navigateAfterNative(undefined, "create", undefined, () => chrome.tabs.create({}))); // 无命令栏：新建标签 = chrome://newtab（受限页），先切原生（等 ack 再建，patch 07）
};

/** 侧边栏空白处：双击 = 新标签；拖进网页链接 / 文字 = 打开 / 搜索 */
function shellGestures() {
    const blank = (t: EventTarget | null) => {
        const el = t as Element | null;
        return !!el?.closest?.("#app") && !el.closest(".arc-tab, button, input, a, .arc-folder-head, .arc-fav-grid, .arc-overlay, .arc-menu, .arc-space-title");
    };
    const onDbl = (e: MouseEvent) => { if (blank(e.target)) newTab().catch(e => console.error("[todayTabs] newTab", e)); };
    const onOver = (e: DragEvent) => { if (blank(e.target) && !e.dataTransfer?.types.includes("text/arc-item")) e.preventDefault(); };
    const onDrop = (e: DragEvent) => { if (blank(e.target) && !e.defaultPrevented) dropExternal(e); };
    document.addEventListener("dblclick", onDbl);
    document.addEventListener("dragover", onOver);
    document.addEventListener("drop", onDrop);
    return () => { document.removeEventListener("dblclick", onDbl); document.removeEventListener("dragover", onOver); document.removeEventListener("drop", onDrop); };
}

export default definePlugin({
    name: "TodayTabs",
    authors: [Devs.ArcSidebar],
    label: "plugin.todayTabs.label",
    description: "plugin.todayTabs.desc",
    tags: ["tabs"],
    dependencies: ["SpaceManager"],
    required: true,
    settings,
    contextMenuItems: {
        tab: [
            { id: "changeIcon", label: "tab.changeIcon", visible: t => t.tabId != null, run: t => openIconPicker(rowIconAnchor(`tab:${t.tabId}`), iconStore.get().byTab[t.tabId!], v => void iconStore.update(x => { if (v) x.byTab[t.tabId!] = v; else delete x.byTab[t.tabId!]; })) },
            // Rename：Today 标签 rename(9) = 行内原地编辑（tab-rename.md 结论 1），与双击标题是同一个编辑框（startRename 触发行上的 onRename）；不调 arcRename（只有收藏用对话框）。
            // 初始文本 = 显示标题（自定义名非空用它，否则页面标题 → 网址，结论 2）；Enter 提交 / Esc 取消；trim 后为空 = 清除自定义名（回退页面标题，结论 3）。
            // ⛔ 菜单文字是否带省略号 Rea 没有结论 → 保持 tab.renameTab 原文案。
            { id: "rename", label: "tab.renameTab", order: 5, run: t => { startRename(`tab:${t.tabId}`); } },
        ],
        sidebar: [{ id: "newTab", label: "today.newTab", shortcut: "Mod+T", order: 10, run: () => newTab() }],
    },
    commands: [
        // Tidy Tabs 的非 AI 版：按网站把今日标签排在一起
        {
            id: "today.tidy", label: "today.tidy", keywords: ["tidy", "sort tabs"], context: "panel", run: async () => {
                const host = (u?: string) => { try { return new URL(u ?? "").hostname.replace(/^www\./, ""); } catch { return "~"; } };
                const tabs = todayTabs();
                const sorted = tabs.toSorted((a, b) => host(a.url).localeCompare(host(b.url)) || a.index - b.index);
                const base = Math.min(...tabs.map(t => t.index));
                for (const [i, t] of sorted.entries()) await safe(chrome.tabs.move(t.id!, { index: base + i }), "tabs.move");
            },
        },
        { id: "tab.rename", label: "tab.cmdRename", keywords: ["rename tab"], context: "panel", run: () => { const t = getTabs().find(x => x.active); if (t && !startRename(`tab:${t.id}`)) { const pin = document.querySelector(".arc-pinned .arc-tab.active .arc-tab-title"); pin?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); } } },
        { id: "today.clear", label: "today.cmdClear", keywords: ["clear unpinned"], context: "panel", defaultKey: "Mod+Shift+K", run: clearToday },
        { id: "tab.new", label: "today.newTab", keywords: ["new tab"], context: "panel", run: newTab },
    ],
    background: {
        start: () => [
            listen("tabs.onRemoved", id => { if (titleStore.get().byTab[id]) void titleStore.update(x => { delete x.byTab[id]; }); }),
            listen("tabs.onRemoved", id => { if (iconStore.get().byTab[id]) void iconStore.update(x => { delete x.byTab[id]; }); }),
            // 自定义标题 / 图标按 tabId 存：重启 / 替换后搬到新 id
            onTabIdRemap((map, alive) => titleStore.update(x => { x.byTab = remapRecord(x.byTab, map, alive); })),
            onTabIdRemap((map, alive) => iconStore.update(x => { x.byTab = remapRecord(x.byTab, map, alive); })),
        ],
    },
    panel: {
        start: () => [titleStore.subscribe(refresh), iconStore.subscribe(refresh), shellGestures(), addSection("today", "TodayTabs", {
            render(el) {
                const tabs = todayTabs();
                el.append(
                    // clear-button.md：分隔线 → 插件按钮（addTodayHeaderButton）→ Clear；显示条件（3 态触发）源码未找到 ⛔，沿用“有今日标签时”
                    // 51999 修正（Cat）：Arc 结构——一行：分隔线（左 18 起，到 Clear 左侧 8）→ 插件按钮 → “↓ Clear”；“+ New Tab” 卡片在下一行（sidebar-features.md §4.2 / clear-button.md §1、§3）
                    ...(tabs.length ? [h("div", { class: "arc-today-head", "data-test": "today-head" },
                        h("span", { class: "arc-today-sep" }),
                        ...todayHeaderState({ todayCount: tabs.length }).map(({ id, def: d, enabled }) => { const ic = (d as { icon?: string }).icon || ""; /* icon 可选（Slots.ts 改前改后都能编译）：缺省 = 只画标签，无图标、无竖线、无间距 */ return headButton(h("button", { class: `arc-today-hbtn arc-today-tidy${ic ? "" : " no-icon"}${enabled ? "" : " disabled"}`, disabled: !enabled, "aria-disabled": enabled ? null : "true", "data-test": `today-hbtn-${id}`, "data-tip": d.title ?? d.label },
                            ...(ic ? [icon(ic as IconName, 12), h("span", { class: "arc-today-vrule" })] : []), h("span", null, d.label)), () => d.run()); }),
                        headButton(h("button", { class: "arc-today-hbtn arc-today-clear", "data-test": "today-clear", "data-tip": tr("today.cmdClear") }, icon("arrowDownBold", 10), h("span", { class: "arc-today-clear-label" }, tr("today.clear"))), () => void clearToday()))] : []),
                    h("button", { class: "arc-newtab", onclick: () => newTab().catch(e => console.error("[todayTabs] newTab", e)) }, icon("plusMedium"), h("span", null, tr("today.newTab"))),
                    h("div", {
                        class: "arc-today arc-drop-zone",
                        ondragover: (e: DragEvent) => { e.preventDefault(); (e.currentTarget as HTMLElement).classList.add("drop"); },
                        ondragleave: (e: DragEvent) => (e.currentTarget as HTMLElement).classList.remove("drop"),
                        ondrop: (e: DragEvent) => { (e.currentTarget as HTMLElement).classList.remove("drop"); if (dropExternal(e)) return; const d = e.dataTransfer?.getData("text/arc-item"); if (!d) return; e.preventDefault();
                            // ⌥/Alt + 拖到今日区空白处 = 复制标签（同 Arc）
                            if (e.altKey) { for (const k of expandDragData(d)) if (k.startsWith("tab:")) void safe(chrome.tabs.duplicate(Number(k.slice(4))), "tabs.duplicate"); return; }
                            void dropToToday(d); },
                    }, tabs.map((t, i) => TabRow({
                        renamed: !!titleStore.get().byTab[t.id!],
                        customIcon: iconStore.get().byTab[t.id!],
                        title: titleStore.get().byTab[t.id!] || t.title || t.url || "", // 标题链：自定义名 → 页面标题 → 网址（tab-rename.md 结论 2；savedTitle 只属固定项）
                        onRename: v => void titleStore.update(x => { if (v) x.byTab[t.id!] = v; else delete x.byTab[t.id!]; }), url: t.url, favIconUrl: t.favIconUrl, active: t.active,
                        audible: t.audible, muted: t.mutedInfo?.muted,
                        tabId: t.id, tabUrl: t.url || t.pendingUrl || "", // 补丁 t903u-tab-switch v2
                        onClick: e => {
                            // ⌥ 单击 = 与当前标签组成分屏
                            const cur = getTabs().find(x => x.active);
                            if (e.altKey && cur?.id != null && cur.id !== t.id && isPluginEnabled("SplitView")) { void navigateAfterNative(chrome.runtime.getURL("split.html"), "navigate", cur.id, () => call("split:merge", cur.id, t.id, "right")); return; }
                            // 页内侧栏：点到受限页标签 → 先切原生（等 ack，最多 500 ms）再激活（patch 07）
                            void safe(Promise.resolve(navigateAfterNative(t.url, "activate", t.id, () => chrome.tabs.update(t.id!, { active: true }))), "tabs.update");
                        },
                        onClose: () => void safe(chrome.tabs.remove(t.id!), "tabs.remove"),
                        onContextMenu: e => showContextMenu(e, "tab", { tabId: t.id, url: t.url, title: t.title, below: tabs.slice(i + 1).map(x => x.id!), above: tabs.slice(0, i).map(x => x.id!) }),
                        selectKey: `tab:${t.id}`,
                        drag: { data: `tab:${t.id}`, onDrop: (data, before, e) => {
                            // ⌥/Alt + 拖到另一个标签上 = 与它组成分屏（落在行的左半边放左侧，右半边放右侧）
                            const keys = expandDragData(data);
                            if (e.altKey && keys.length === 1 && keys[0].startsWith("tab:") && isPluginEnabled("SplitView")) {
                                const r = (e.currentTarget as HTMLElement | null)?.getBoundingClientRect();
                                // ⚠ drop 事件本身不是激活触发事件，靠拖拽开始时的 pointerdown 激活（约 5 s 内）：needActive = 此刻没有瞬时激活就降级（不发消息，照常合并，兜底 = 按钮 / 角标 / 快捷键）（patch 07）
                                const side = r && e.clientX < r.left + r.width / 2 ? "left" : "right", from = Number(keys[0].slice(4));
                                void navigateAfterNative(chrome.runtime.getURL("split.html"), "navigate", t.id, () => call("split:merge", t.id, from, side), { needActive: true });
                                return;
                            }
                            void dropToToday(data, t.id, before);
                        } },
                    }))),
                );
            },
        })],
    },
});

/** 标题行按钮：点击在按钮内抬起时触发（clear-button.md）；tooltip 走 ArcTooltip（data-tip），延迟 0.45s ⛔ 由 ArcTooltip 决定 */
function headButton(b: HTMLElement, run: () => unknown) {
    let down = false;
    b.addEventListener("pointerdown", e => { if (e.button === 0 && !(b as HTMLButtonElement).disabled) { down = true; b.classList.add("pressed"); b.setPointerCapture?.(e.pointerId); } });
    b.addEventListener("pointerup", e => {
        const r = b.getBoundingClientRect(), inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
        b.classList.remove("pressed");
        if (down && inside) { if (b.classList.contains("arc-today-tidy")) { b.classList.add("spin"); setTimeout(() => b.classList.remove("spin"), 400); } void run(); }
        down = false;
    });
    // 拖出 / 取消 / 失去捕获 / 任意处抬起：解除按下态（箭头随 .pressed 复位）；点击只在按钮内抬起时触发（上面的 pointerup）
    const release = () => { down = false; b.classList.remove("pressed"); };
    b.addEventListener("pointercancel", release);
    b.addEventListener("lostpointercapture", () => b.classList.remove("pressed"));
    b.addEventListener("pointerleave", () => b.classList.remove("pressed"));
    const docUp = (e: PointerEvent) => { if (!b.isConnected) { document.removeEventListener("pointerup", docUp, true); return; } if (!b.contains(e.target as Node)) release(); }; // 重绘后旧按钮自行解绑
    document.addEventListener("pointerup", docUp, true);
    b.addEventListener("keydown", e => { if ((e.key === "Enter" || e.key === " ") && !(b as HTMLButtonElement).disabled) { e.preventDefault(); void run(); } });
    // tooltip 由 ArcTooltip 读 data-tip 显示；不再写原生 title（会与 ArcTooltip 重叠，dark-mode-title-audit.md）
    return b;
}

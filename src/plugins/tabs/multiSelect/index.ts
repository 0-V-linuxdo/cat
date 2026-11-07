/*
 * MultiSelect（§15，按 Arc 的交互）：⌘/Ctrl+单击切换、Shift+单击连续选择、普通单击只选中该标签；
 * 选中的标签有独立的淡强调色高亮（与当前标签样式不同，适配深色）。没有顶部批量工具栏：
 * 在任一选中标签上右键，菜单里的操作作用于全部选中项（关闭 / 固定 / 取消固定 / 收藏 / 移到文件夹 / 用所选新建文件夹 /
 * 移到空间 / 复制链接 / 复制标签 / 归档）。拖动任一选中项整组拖放；Delete / Backspace / ⌘W 关闭；Esc 或点空白处取消。
 * 只依赖 TabRow 输出的 data-sel 选择键，因此今日、固定区、文件夹里的标签都可多选。批量操作都可 ⌘Z 撤销。
 */
import { arcPrompt } from "@components/Dialog";
import { applyUrlTransforms } from "@api/UrlTransforms";
import { tr } from "@api/i18n";
import { iconText } from "@api/spaceIcons";
import { copyText } from "@api/Clipboard";
import { encodeMulti } from "@api/DragData";
import { eventToCombo, normalizeCombo } from "@api/Keys";
import { toast } from "@api/PanelShell";
import { isPluginEnabled } from "@api/PluginManager";
import { call } from "@api/RPC";
import { recordStoreUndo } from "@api/Undo";
import { type MenuEntry, openMenu } from "@components/Menu";
import { inDriftIconZone } from "@components/TabRow";
import { getTab } from "@plugins/_core/tabState";
import { muteTabs } from "@plugins/library/media";
import { muteItemOf, muteMenuState } from "@plugins/library/media/muteMenu";
import { addFavorite, favStore } from "@plugins/spaces/favorites";
import { duplicatePin, handleDrop, mutateSpace, pinTab, removePinsKeepOpen } from "@plugins/tabs/pinnedTabs";
import { detach, type PinNode, pinnedStore, walk } from "@plugins/tabs/pinnedTabs/model";
import { activeSpace, spacesStore } from "@plugins/spaces/spaceManager/store";
import { Devs } from "@utils/constants";
import { uid } from "@utils/misc";
import definePlugin from "@utils/types";

import { applyClick, splitKeys } from "./logic";

let sel = new Set<string>();
let anchor: string | null = null;

const rows = () => [...document.querySelectorAll<HTMLElement>(".arc-tab[data-sel]")];
const order = () => rows().map(r => r.dataset.sel!);
const paint = () => { const multi = sel.size > 1; for (const r of rows()) r.classList.toggle("selected", multi && sel.has(r.dataset.sel!)); document.body.classList.toggle("arc-multiselecting", multi); };
const setSel = (s: Set<string>, a: string | null) => { sel = s; anchor = a; paint(); };
export const clearSelection = () => { if (sel.size) setSel(new Set(), null); };
export const selectionSize = () => sel.size;
export const getSelection = () => splitKeys(order(), sel);

function resolved() {
    const { keys, tabIds, pinIds } = getSelection();
    const nodes = [...walk(pinnedStore.get().bySpace[activeSpace().id] ?? [])];
    const pins = pinIds.map(id => nodes.find(n => n.id === id)).filter(n => n != null);
    const openIds = [...tabIds, ...pins.flatMap(n => (n.tabId != null && getTab(n.tabId) ? [n.tabId] : []))];
    return { keys, tabIds, pins, openIds };
}

export const actions = {
    async close() { const { openIds } = resolved(); if (openIds.length) await chrome.tabs.remove(openIds); clearSelection(); },
    async pin() {
        const { tabIds } = resolved();
        if (!tabIds.length) return;
        recordStoreUndo(tr("multi.pinN", tabIds.length), pinnedStore);
        for (const id of tabIds) await pinTab(getTab(id));
        clearSelection();
    },
    async favorite() {
        const { openIds } = resolved();
        recordStoreUndo(tr("multi.favN", openIds.length), favStore);
        for (const id of openIds) await addFavorite(getTab(id));
        clearSelection();
    },
    /** Mute（Tab.toggleMuted(4)，rM/1028c44b4.c）：多选统一设成同一个状态——任一已打开且未静音 → 全部静音，否则全部取消静音（media 的 muteTabs，与单项菜单同一实现）。未打开的固定项只计入判断，不写 savedMuteStatus（⛔ 无存储字段） */
    async mute() { const { tabIds, pins } = resolved(); await muteTabs([...tabIds, ...pins.map(p => p.tabId)]); clearSelection(); },
    /** Duplicate（L661 H1：验证器没有 live 检查）：今日标签 → 新开一份标签；固定项（打开着 / 没打开都一样）→ 复制成新的固定项，放在原项之后 ⛔，保留 customTitle（pinnedTabs.duplicatePin）。
     *  只打开前 5 个新固定项，其余只创建（rH/102933c8c.c L64）。数量上限 ⛔（处理函数里没有）不设限。 */
    async duplicate() {
        const { tabIds, pins } = resolved();
        for (const id of tabIds) await chrome.tabs.duplicate(id);
        for (const [i, p] of pins.entries()) await duplicatePin(p.id, i < 5);
        clearSelection();
    },
    async newFolder() {
        const name = await arcPrompt(tr("folders.namePrompt"), tr("folders.newName"));
        if (!name) return;
        const { keys } = resolved();
        recordStoreUndo(tr("multi.newFolderUndo"), pinnedStore);
        const id = uid();
        await mutateSpace(list => { list.push({ id, kind: "folder", title: name, children: [] } as PinNode); });
        await handleDrop(encodeMulti(keys), { into: id });
        clearSelection();
    },
    /** Remove Pins：移除固定项，打开着的标签保持打开、回到 Today 顶部（同单项 Remove Pin，rel65 ①：pinnedTabs.removePinsKeepOpen） */
    async removePins() {
        const { pins } = resolved();
        if (!pins.length) return;
        await removePinsKeepOpen(pins.map(p => p.id), tr("pinned.removePins"));
        clearSelection();
    },
    /** Archive Tabs（混选）：今日标签关闭进归档；固定项一并移出固定区并关掉标签 */
    async archive() {
        const { pins, openIds } = resolved();
        if (pins.length) { recordStoreUndo(tr("tab.archiveTabs"), pinnedStore); await mutateSpace(list => { for (const p of pins) detach(list, p.id); }); }
        if (openIds.length) await chrome.tabs.remove(openIds).catch(() => { /* 标签已关 */ });
        clearSelection();
    },
    async moveToNewSpace() {
        // 先解析选择、记下来源空间：spaces:create 会切到新空间
        const r = resolved(), from = activeSpace().id;
        const id = await call<string>("spaces:create", tr("spaces.newName"));
        if (id) await actions.moveToSpace(id, from, r);
    },
    async unpin() {
        const { pins } = resolved();
        if (!pins.length) return;
        recordStoreUndo(tr("multi.unpinN", pins.length), pinnedStore);
        await mutateSpace(list => { for (const n of pins) detach(list, n.id); });
        clearSelection();
    },
    async moveToSpace(spaceId: string, from = activeSpace().id, r = resolved()) {
        const { openIds, pins } = r;
        if (pins.length) {
            recordStoreUndo(tr("multi.moveSpaceUndo"), pinnedStore);
            await pinnedStore.update(x => { const src = (x.bySpace[from] ??= []); const dst = (x.bySpace[spaceId] ??= []); for (const n of pins) { const d = detach(src, n.id); if (d) dst.push(d); } });
        }
        for (const id of openIds) await call("spaces:moveTab", id, spaceId);
        clearSelection();
    },
    async moveToFolder(folderId: string) {
        const { keys } = resolved();
        recordStoreUndo(tr("multi.moveFolderUndo"), pinnedStore);
        await handleDrop(encodeMulti(keys), { into: folderId });
        clearSelection();
    },
    async copyLinks() {
        const { tabIds, pins } = resolved();
        const urls = [...tabIds.map(id => getTab(id)?.url), ...pins.map(n => getTab(n.tabId)?.url || n.url)].filter(Boolean);
        await copyText(urls.map(u => applyUrlTransforms("copy", u ?? "")).join("\n"));
        toast(tr("multi.copiedN", urls.length));
    },
};

/** 多选右键菜单 = Arc 标签菜单同一构造器（out5/0x102ec5d7c.c）作用于整组选择，按 urlbar-menus-followup.md「菜单定案」：
 *  组 1 复制链接 | 组 3 Mute（第 8 项，单选多选都出现，只要求 !anyLive；P-04）| 组 5 Duplicate、Move to ▸（§2，非无痕窗口；选中项无 Live Folder 标签——扩展没有）、New Folder with N Items（§2，选中数 > 1，FUN_102ec13ec）
 *  | 组 6：全是固定项 → Remove Pins；含今日标签（混选）→ Archive Tabs（§4，ecb2ec L44–140）。Close Tabs 只在全是 Favorites 时出现（收藏不参与多选）→ 无。
 *  标签菜单没有 Pin / Unpin / Add to Favorites（§1、§4.2）→ 不放（命令 / 拖放保留）。多选复制文案 ⛔ 沿用。New Folder with N Items 的命名流程 ⛔，沿用输入名称。 */
function selectionMenu(): MenuEntry[] {
    const { tabIds, pins } = resolved();
    const n = sel.size;
    const spaces = spacesStore.get().spaces.filter(sp => sp.id !== activeSpace().id);
    const incognito = !!chrome.extension?.inIncognitoContext;
    const allPinned = pins.length > 0 && tabIds.length === 0;
    const mute = muteMenuState([...tabIds, ...pins.map(p => p.tabId)].map(id => muteItemOf(getTab(id))));
    const items: (MenuEntry | null)[] = [
        { label: tr("multi.copyN", n), run: actions.copyLinks, test: "multi:copy" },
        { separator: true, label: "" },
        // 组 3 Mute：规则同单项菜单（media/muteMenu.ts，urlbar-menus-followup.md L467–572）：全部已静音 → “Unmute” 可点；否则至少一个在发声才可点（未打开 / 没发声置灰）。Media 插件关闭时不显示
        isPluginEnabled("Media") ? { label: tr(mute.unmute ? "media.unmute" : "media.mute"), run: actions.mute, test: "multi:mute", disabled: mute.disabled } : null,
        { separator: true, label: "" },
        { label: tr("tab.duplicate"), run: actions.duplicate, test: "multi:dup" }, // 不再要求有打开的标签（L661 H1：不隐藏、不置灰）
        incognito ? null : {
            label: tr("tab.moveTo"), test: "multi:space",
            submenu: [...spaces.map(sp => ({ label: tr("tab.moveToSpace", iconText(sp.icon), sp.name), run: () => actions.moveToSpace(sp.id), test: `multi:space:${sp.name}` })),
                { separator: true, label: "" }, { label: tr("spaces.moveToNew"), run: actions.moveToNewSpace, test: "multi:space:new" }],
        },
        !incognito && n > 1 && isPluginEnabled("Folders") ? { label: tr("multi.newFolderWithN", n), run: actions.newFolder, test: "multi:newFolder" } : null,
        { separator: true, label: "" },
        allPinned ? { label: tr(pins.length > 1 ? "pinned.removePins" : "pinned.removePin"), run: actions.removePins, test: "multi:removePins" }
            : { label: tr(n > 1 ? "tab.archiveTabs" : "tab.archiveTab"), run: actions.archive, test: "multi:archive" },
    ];
    return items.filter((x, i, a): x is MenuEntry => !!x && !(x.separator && (!a[i - 1] || a[i - 1]!.separator || i === a.length - 1)));
}

const CLOSE_KEY = normalizeCombo("Mod+W");

function panelStart() {
    const onClick = (e: MouseEvent) => {
        const target = e.target as HTMLElement;
        if (target.closest(".arc-menu, .arc-overlay")) return;
        const row = target.closest<HTMLElement>(".arc-tab[data-sel]");
        if (!row) { if (!target.closest("button, input, a, .arc-folder-head")) clearSelection(); return; }
        if (target.closest(".arc-tab-close")) return;
        // rel47 ⑦：偏离固定行的图标区 ⌘ 单击 = “分离当前页”（pinned-icon-hover.md：只有 region0 发 action，Bool = ⌘ 位），不是 ⌘ 多选切换 → 放行给 TabRow 的图标点击
        if (e.metaKey && !e.shiftKey && inDriftIconZone(row, e)) return;
        const mode = e.shiftKey ? "range" : e.metaKey || e.ctrlKey ? "toggle" : null;
        if (!mode) { setSel(new Set([row.dataset.sel!]), row.dataset.sel!); return; }
        e.preventDefault();
        e.stopImmediatePropagation();
        const r = applyClick(order(), sel.size > 1 ? sel : new Set(anchor ? [anchor] : []), anchor, row.dataset.sel!, mode);
        setSel(r.sel, r.anchor);
    };
    const onContextMenu = (e: MouseEvent) => {
        const row = (e.target as HTMLElement).closest<HTMLElement>(".arc-tab[data-sel]");
        if (!row) return;
        if (sel.size < 2 || !sel.has(row.dataset.sel!)) { clearSelection(); return; }
        e.preventDefault();
        e.stopImmediatePropagation();
        openMenu({ x: e.clientX, y: e.clientY }, selectionMenu());
    };
    const onKey = (e: KeyboardEvent) => {
        if (sel.size < 2) return;
        if (document.querySelector(".arc-menu:not([hidden])")) return;
        const t = e.target as HTMLElement | null;
        if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
        if (e.key === "Escape") clearSelection();
        else if (e.key === "Delete" || e.key === "Backspace" || eventToCombo(e) === CLOSE_KEY) { e.preventDefault(); void actions.close(); }
    };
    // 冒泡阶段：在 TabRow 自己写入单项数据之后，用整组选择覆盖
    const onDragStart = (e: DragEvent) => {
        const row = (e.target as HTMLElement).closest?.<HTMLElement>(".arc-tab[data-sel]");
        if (!row || !sel.has(row.dataset.sel!) || sel.size < 2) return;
        e.dataTransfer?.setData("text/arc-item", encodeMulti(getSelection().keys));
    };
    // 不用 requestAnimationFrame：侧边栏隐藏时 rAF 会被暂停
    let pending = false;
    const mo = new MutationObserver(() => { if (pending) return; pending = true; queueMicrotask(() => { pending = false; mo.takeRecords(); paint(); }); });
    mo.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("click", onClick, true);
    document.addEventListener("contextmenu", onContextMenu, true);
    document.addEventListener("keydown", onKey);
    document.addEventListener("dragstart", onDragStart);
    return [
        () => { mo.disconnect(); document.removeEventListener("click", onClick, true); document.removeEventListener("contextmenu", onContextMenu, true); document.removeEventListener("keydown", onKey); document.removeEventListener("dragstart", onDragStart); sel.clear(); paint(); },
    ];
}

export default definePlugin({
    name: "MultiSelect",
    authors: [Devs.ArcSidebar],
    label: "plugin.multiSelect.label",
    description: "plugin.multiSelect.desc",
    tags: ["tabs"],
    dependencies: ["PinnedTabs"],
    enabledByDefault: true,
    commands: [
        { id: "multi.clear", label: "multi.cmdClear", keywords: ["deselect"], context: "panel", run: clearSelection },
        { id: "multi.close", label: "multi.cmdClose", keywords: ["close selected"], context: "panel", run: () => actions.close() },
        { id: "multi.copy", label: "multi.cmdCopy", keywords: ["copy links"], context: "panel", run: () => actions.copyLinks() },
    ],
    panel: { start: panelStart },
});

/*
 * Pinned Tabs（§6.1）：每个 Space 自己的固定区，关闭后条目仍保留；
 * 可重命名、重置为固定网址、拖动排序；固定区可折叠。
 * 文件夹（Folders 插件）通过 nodeRenderers 扩展本插件的树渲染。
 */
import { displayUrl } from "@api/displayUrl";
import "@components/ArcTooltip";
import { safe } from "@api/ErrorLog";
import { tr } from "@api/i18n";
import { onTabIdRemap } from "@api/TabIdRemap";
import { applyUrlTransforms } from "@api/UrlTransforms";
import { toast } from "@api/PanelShell";
import { icon } from "@api/icons";
import { expandDragData } from "@api/DragData";
import { recordStoreUndo } from "@api/Undo";
import { addClaimProvider } from "@api/Claims";
import type { MenuTarget } from "@api/ContextMenus";
import { copyText } from "@api/Clipboard";
import { h } from "@api/dom";
import { addSection, refresh } from "@api/Slots";
import { toUrl, uid } from "@utils/misc";
import { iconText } from "@api/spaceIcons";
import { showContextMenu } from "@api/PanelShell";
import { call } from "@api/RPC";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
import { activeTab, getTab, getTabs, getWindowId } from "@plugins/_core/tabState";
import { activeSpace, spacesStore } from "@plugins/spaces/spaceManager/store";
import { floatingEdit, focusOrOpen, inlineRename, rowIconAnchor, TabRow } from "@components/TabRow";
import { openIconPicker } from "@components/IconPicker";
import { favStore } from "@plugins/spaces/favorites/store";
import { reattachByUrl } from "./reattach";
import { editPinnedMenu, editPinnedUrlOf, editPinnedVisible } from "./editPinnedMenu";
import { detach, locate, type PinNode, pinnedStore, walk } from "./model";
import { duplicatePinNode } from "./dupNode";

export { type PinNode, pinnedStore, walk } from "./model";

export type NodeRenderer = (n: PinNode, depth: number, renderChildren: (list: PinNode[], depth: number) => HTMLElement[]) => HTMLElement;
export const nodeRenderers = new Map<string, NodeRenderer>();

const spaceList = (d = pinnedStore.get()) => d.bySpace[activeSpace().id] ?? [];

export async function mutateSpace(fn: (list: PinNode[]) => void, spaceId = activeSpace().id) {
    await pinnedStore.update(x => { fn((x.bySpace[spaceId] ??= [])); });
}

export async function pinTab(tab: chrome.tabs.Tab | undefined, opts?: { before?: string; into?: string }) {
    if (!tab?.id) return;
    if (pinnedOwner(tab.id)) return;
    const node: PinNode = { id: uid(), kind: "tab", url: tab.url, title: tab.title, tabId: tab.id };
    await mutateSpace(list => insertNode(list, node, opts));
}

function insertNode(list: PinNode[], node: PinNode, opts?: { before?: string; after?: string; into?: string }) {
    if (opts?.into) {
        const f = [...walk(list)].find(n => n.id === opts.into);
        if (f) { (f.children ??= []).push(node); return; }
    }
    const ref = opts?.before ?? opts?.after;
    const loc = ref ? locate(list, ref) : null;
    if (loc) loc.list.splice(loc.index + (opts?.after ? 1 : 0), 0, node);
    else list.push(node);
}

export function pinnedOwner(tabId: number | undefined) {
    if (tabId == null) return null;
    for (const [sid, list] of Object.entries(pinnedStore.get().bySpace)) for (const n of walk(list)) if (n.tabId === tabId) return { spaceId: sid, node: n };
    return null;
}

export async function unpin(id: string, close = false) {
    recordStoreUndo(close ? tr("pinned.delete") : tr("pinned.unpin"), pinnedStore);
    let tabId: number | undefined;
    await mutateSpace(list => { tabId = detach(list, id)?.tabId; });
    if (close && tabId != null) await chrome.tabs.remove(tabId).catch(() => { /* No tab with id：标签已关，属正常 */ });
}

async function togglePinActive() {
    const t = activeTab();
    const owner = pinnedOwner(t?.id);
    if (owner) await unpin(owner.node.id); else await pinTab(t);
}

async function openNode(n: PinNode) {
    const tabId = await focusOrOpen(n.tabId, n.url ?? "about:blank");
    if (tabId !== n.tabId) {
        await mutateSpace(list => { const f = [...walk(list)].find(x => x.id === n.id); if (f) f.tabId = tabId; });
        if (tabId != null) await safe(call("spaces:moveTab", tabId, activeSpace().id), "spaces:moveTab");
    }
}

/** Duplicate（urlbar-menus-followup.md L661 H1）：复制成一个新的固定项，放在原项之后 ⛔，保留 customTitle、拷 saved 字段（规则见 dupNode.ts），然后打开新项
 *  （rH/102933c8c.c L64：前 5 个会被打开，单个必在内；open = false 只创建不打开）。打开着 / 没打开都一样，不再 chrome.tabs.duplicate。固定项没有数量上限（收藏的 12 个上限在 favorites）。 */
export async function duplicatePin(id: string | undefined, open = true) {
    const src = id ? [...walk(spaceList())].find(x => x.id === id) : undefined;
    if (!src) return;
    const newId = uid();
    let made = false;
    await mutateSpace(list => { made = !!duplicatePinNode(list, src.id, newId, getTab(src.tabId)); });
    if (!made || !open) return;
    const n = [...walk(spaceList())].find(x => x.id === newId);
    if (n) await openNode(n);
}

/** 固定标签是否已偏离固定的网址（忽略 #hash） */
export function drifted(n: PinNode, tab?: chrome.tabs.Tab) {
    const cur = tab?.url ?? tab?.pendingUrl;
    if (!cur || !n.url) return false;
    const norm = (u: string) => u.replace(/#.*$/, "").replace(/\/$/, "");
    return norm(cur) !== norm(n.url);
}

export function resetNode(nodeId: string) {
    const n = [...walk(spaceList())].find(x => x.id === nodeId);
    if (n?.url && n.tabId != null) void safe(chrome.tabs.update(n.tabId, { url: n.url }), "tabs.update");
}

/** 固定项的显示标题（tab-rename.md 结论 2 的标题链）：customTitle 非空 → 页面标题 → 保存的标题 → 网址；行标题与菜单 / 双击编辑的初始文本共用 */
export const pinTitle = (n: PinNode, tab?: chrome.tabs.Tab) => n.customTitle || tab?.title || n.title || displayUrl(n.url);

/** 改名（空串 = 清除自定义名，回退页面标题；调用方已 trim 空白和换行） */
export function renameNode(nodeId: string, title: string) {
    return mutateSpace(l => { const n = [...walk(l)].find(x => x.id === nodeId); if (n) n.customTitle = title || undefined; });
}

/** 把一组拖放 / 选择键移到另一个 Space：固定项移到对方固定区，打开的标签移到对方 */
/** from：来源 Space。先 spaces:create 再移动时要传入建新空间之前的当前空间——spaces:create 会切到新空间，之后 activeSpace() 已是目标，不传就成了空操作 */
/** 无痕窗口（FUN_102951fd0 = StandardWindowState.sidebarContext == incognito，urlbar-menus-followup.md「菜单定案」§0）：Move to 不出现（§2） */
export const inIncognito = () => !!chrome.extension?.inIncognitoContext;

/** 固定项能解析出的网址（Edit Pinned Page 的前置条件，FUN_102a18f08 case 0）：当前页 URL 优先，没有打开 / 取不到才用保存的固定网址 */
const pinNodeUrl = (t: MenuTarget) => editPinnedUrlOf(getTab(t.tabId)?.url, [...walk(spaceList())].find(x => x.id === t.itemId)?.url);

/** “Move to ›” 子菜单（FUN_102ec118c / FUN_102eb11c8，「菜单定案」§2）：各 Space → 分隔线 → New Space…；固定项 / 文件夹共用（选择键 pin:<id>） */
export function pinMoveToMenu(itemId: string) {
    const key = `pin:${itemId}`;
    return [
        ...spacesStore.get().spaces.filter(s => s.id !== activeSpace().id).map(s => ({ id: `space:${s.id}`, label: tr("tab.moveToSpace", iconText(s.icon), s.name), run: () => moveKeysToSpace([key], s.id) })),
        { id: "sep", label: "", separator: true, run: () => { } },
        // 先记下来源空间：spaces:create 会切到新空间
        { id: "newSpace", label: "spaces.moveToNew", run: async () => { const from = activeSpace().id; const id = await call<string>("spaces:create", tr("spaces.newName")); await moveKeysToSpace([key], id, from); } },
    ];
}

export async function moveKeysToSpace(keys: string[], spaceId: string, from = activeSpace().id) {
    if (spaceId === from) return;
    const pins = keys.filter(k => k.startsWith("pin:")).map(k => k.slice(4));
    const tabIds = keys.filter(k => k.startsWith("tab:")).map(k => Number(k.slice(4)));
    if (pins.length) {
        recordStoreUndo(tr("multi.moveSpaceUndo"), pinnedStore);
        await pinnedStore.update(x => {
            const src = (x.bySpace[from] ??= []), dst = (x.bySpace[spaceId] ??= []);
            for (const id of pins) { const d = detach(src, id); if (d) { dst.push(d); for (const c of walk([d])) if (c.tabId != null) tabIds.push(c.tabId); } }
        });
    }
    for (const id of tabIds) await safe(call("spaces:moveTab", id, spaceId), "spaces:moveTab");
}

/** 处理拖放：data = "tab:<tabId>" | "pin:<nodeId>" | "fav:<id>"（收藏拖进固定区 = 移出收藏、变成固定项） */
export async function handleDrop(data: string, target: { before?: string; after?: string; into?: string }): Promise<void> {
    const items = expandDragData(data);
    if (items.length > 1) {
        // 多选拖放：逐项插入；放到某项之后时倒序插入以保持原顺序
        for (const it of target.after ? items.toReversed() : items) await handleDrop(it, target);
        return;
    }
    if (data.startsWith("tab:")) {
        const tab = getTabs().find(t => t.id === Number(data.slice(4)));
        if (tab?.id == null) return;
        await mutateSpace(list => { insertNode(list, { id: uid(), kind: "tab", url: tab.url, title: tab.title, tabId: tab.id }, target); });
    } else if (data.startsWith("fav:")) {
        const f = favStore.get().items.find(i => i.id === data.slice(4));
        if (!f) return;
        recordStoreUndo(tr("fav.remove"), favStore);
        await favStore.update(x => { x.items = x.items.filter(i => i.id !== f.id); });
        await mutateSpace(list => { insertNode(list, { id: uid(), kind: "tab", url: f.url, title: f.title, customTitle: f.customTitle, tabId: getTab(f.tabId) ? f.tabId : undefined }, target); });
    } else if (data.startsWith("pin:")) {
        const id = data.slice(4);
        if (id === target.before || id === target.after || id === target.into) return;
        await mutateSpace(list => {
            const n = detach(list, id);
            if (!n) return;
            // 不能拖进自己的子孙
            if (target.into && [...walk(n.children)].some(c => c.id === target.into)) { list.push(n); return; }
            insertNode(list, n, target);
        });
    }
}

function renderNodes(list: PinNode[], depth: number): HTMLElement[] {
    return list.map(n => {
        const custom = nodeRenderers.get(n.kind);
        if (n.kind !== "tab") return custom ? custom(n, depth, renderNodes) : h("div", null, renderNodes(n.children ?? [], depth));
        const tab = getTab(n.tabId);
        return TabRow({
            renamed: !!n.customTitle,
            customIcon: n.customIcon,
            title: pinTitle(n, tab),
            url: tab?.url ?? n.url, favIconUrl: tab?.favIconUrl,
            active: tab?.active, open: !!tab, audible: tab?.audible, muted: tab?.mutedInfo?.muted, indent: depth,
            // 右按钮按动作选字形 / 文案（pinned-hover.md §F、R3）：已打开 → “−” “Close this item”；未打开 → “✕” “Archive this item”（Rea 的 ctx=1 分支没有「不显示」；点击仍是取消固定，文案与实际动作不一致 ⛔）
            closeAction: tab ? "close" : "archive",
            onClick: () => void openNode(n),
            onClose: () => (tab ? void safe(chrome.tabs.remove(tab.id!), "tabs.remove") : void unpin(n.id)),
            onContextMenu: e => showContextMenu(e, "pinned", { itemId: n.id, tabId: tab?.id, url: tab?.url ?? n.url, title: n.customTitle ?? tab?.title ?? n.title }),
            selectKey: `pin:${n.id}`,
            drifted: drifted(n, tab),
            tabId: tab?.id,
            // 点图标重置；⌘ 单击 = 当前页移到新标签，固定标签重置（Arc）
            onIconClick: tab && drifted(n, tab) ? e => { if ((e.metaKey || e.ctrlKey) && tab.url) void safe(chrome.tabs.create({ url: tab.url, index: tab.index + 1, active: false }), "tabs.create"); resetNode(n.id); } : undefined,
            onRename: v => void renameNode(n.id, v),
            drag: { data: `pin:${n.id}`, onDrop: (data, before) => void handleDrop(data, before ? { before: n.id } : { after: n.id }) },
        });
    });
}

export default definePlugin({
    name: "PinnedTabs",
    authors: [Devs.ArcSidebar],
    label: "plugin.pinnedTabs.label",
    description: "plugin.pinnedTabs.desc",
    tags: ["tabs"],
    dependencies: ["SpaceManager"],
    required: true,
    commands: [
        {
            id: "pin.reset", label: "pinned.cmdReset", keywords: ["reset tab"], context: "panel", run: () => {
                const id = activeTab()?.id; const n = [...walk(spaceList())].find(x => x.tabId != null && x.tabId === id);
                if (n) resetNode(n.id); else toast(tr("pinned.notPinned"));
            },
        },
        { id: "pin.reattach", label: "pinned.cmdReattach", hidden: true, context: "panel", run: () => reattachByUrl() },
        { id: "pin.toggle", label: "pinned.cmdToggle", keywords: ["pin"], context: "panel", defaultKey: "Mod+D", run: togglePinActive },
        { id: "pin.collapse", label: "pinned.cmdCollapse", keywords: ["collapse pinned", "expand pinned"], context: "panel", run: () => pinnedStore.update(x => { const id = activeSpace().id; x.collapsed[id] = !x.collapsed[id]; }) },
    ],
    contextMenuItems: {
        pinned: [
            {
                id: "changeIcon", label: "tab.changeIcon", run: t => {
                    const n = [...walk(spaceList())].find(x => x.id === t.itemId);
                    openIconPicker(rowIconAnchor(`pin:${t.itemId}`), n?.customIcon, v => void mutateSpace(l => { const m = [...walk(l)].find(x => x.id === t.itemId); if (m) m.customIcon = v || undefined; }));
                },
            },
            // Rename（第 7 项，urlbar-menus-followup.md L349）：固定 / Today 标签的 rename(9) = 行内原地编辑，不是对话框（tab-rename.md 结论 1：FUN_1029ae924 只设 editingItem；只有收藏走 renameFavorite(12) 对话框）。
            // 点菜单与双击标题进入的是同一个编辑框（行上 onRename）：初始文本 = 当前显示标题（customTitle 非空用它，否则页面标题 → 保存的标题 → 网址，tab-rename.md 结论 2）；Enter 提交、Esc 取消并还原；
            // 提交前 trim 空白和换行，空串 = 清除自定义名（renameNode 存 undefined → 回退页面标题，结论 3）。不调 arcRename。
            // ⛔ 菜单文字 Arc 是否带省略号（"Rename" / "Rename…"）Rea 没有结论 → 保持原有 tab.renameTab 文案（"Rename Tab"）。
            { id: "rename", label: "tab.renameTab", run: t => { const n = [...walk(spaceList())].find(x => x.id === t.itemId); const span = document.querySelector<HTMLElement>(`.arc-tab[data-sel="pin:${t.itemId}"] .arc-tab-title`); if (n && span) inlineRename(span, pinTitle(n, getTab(n.tabId)), v => void renameNode(n.id, v)); } },
            // Mute（第 8 项，组 3，在 Edit Pinned Page 前）由 media 插件把标签菜单同一项 muteMenuItem 注册到 pinned / favorite（补丁 pinned-mute），这里不另写。
            // Edit Pinned Page ▸（urlbar-menus-followup.md L326–415 第 10 项，out7/0x102eb73c0.c；审计 52193 P-04）：① Replace Pinned URL with Current ② Edit…。
            // 出现：单选、非无痕、能取到网址（L797 / L806 / L989）。本菜单只在单项右键时弹出（多选由 multiSelect 自己的菜单接管），选中数 = 1。
            // 网址：当前页 URL 优先，否则 savedURL（FUN_102a18f08 case 0；L467–572）；两者都没有才整个子菜单不出现。
            // 没有打开的标签时 ① 照常显示、可点（不置灰），点了静默什么也不做、不弹 toast（FUN_1029e0704 拿不到 WebContentState 直接返回，L467–572）。
            // Replace 写入（urlbar-menus-followup.md「I) 追加」，FUN_1029e32d4）：只写 url、title（无条件取当前页标题）；不动 customTitle / customIcon。⛔ PinNode 没有 savedFavicon 字段，不新增。
            editPinnedMenu({
                visible: t => editPinnedVisible(1, inIncognito(), pinNodeUrl(t)),
                replace: t => mutateSpace(l => { const n = [...walk(l)].find(x => x.id === t.itemId); const tab = getTab(t.tabId); if (n && tab?.url) { n.url = tab.url; n.title = tab.title; } }),
                edit: t => {
                    const row = document.querySelector(`.arc-tab[data-sel="pin:${t.itemId}"]`); const n = [...walk(spaceList())].find(x => x.id === t.itemId);
                    if (row && n) floatingEdit(row, n.url ?? "", v => void mutateSpace(l => { const m = [...walk(l)].find(x => x.id === n.id); if (m) m.url = toUrl(v); }));
                },
            }),
            { id: "copy", label: "tab.copyLink", run: t => t.url && copyText(applyUrlTransforms("copy", t.url)) },
            // Move to（「菜单定案」§2，out5/0x102ec5d7c.c L1157–1165）：标签菜单同一构造器；无痕窗口或选中项含 Live Folder 标签时不出现（固定区没有 Live Folder 标签）
            { id: "moveTo", label: "tab.moveTo", visible: () => !inIncognito(), run: () => { }, submenu: t => pinMoveToMenu(t.itemId!) },
            // 组 6（urlbar-menus-followup.md「菜单定案」§4，out5/0x102ec5d7c.c L1196–1301）：右键菜单里没有 Reset / Unpin / Delete（§4.2，只在主菜单栏；命令 pin.reset / pin.toggle 保留）。
            // Close Tab(s) 只在选中项全是 Favorites 时出现（FUN_102ecb26c 要求 allFav）→ 固定区菜单没有。
            // 固定区 = Remove Pin（!allFav && allPinned && !anyLive，L134–140）。本菜单只作用于单个固定项；含 Live Folder 标签 / 混选 → Archive Tab(s) 的分支在多选菜单（multiSelect）里。
            { id: "removePin", label: "pinned.removePin", run: t => unpin(t.itemId!, true) },
        ],
    },
    background: {
        start: () => [addClaimProvider("PinnedTabs", () => {
            const out: number[] = [];
            for (const list of Object.values(pinnedStore.get().bySpace)) for (const n of walk(list)) if (n.tabId != null) out.push(n.tabId);
            return out;
        }),
        // 标签换 id（@api/Tabs discardKeep / 浏览器替换 / 重启映射）：固定项与文件夹里的项跟到新 id
        onTabIdRemap(map => { if (!Object.values(pinnedStore.get().bySpace).some(l => [...walk(l)].some(n => n.tabId != null && map.has(n.tabId)))) return; return pinnedStore.update(x => { for (const l of Object.values(x.bySpace)) for (const n of walk(l)) if (n.tabId != null && map.has(n.tabId)) n.tabId = map.get(n.tabId); }); })],
    },
    panel: {
        start() {
            return [
                pinnedStore.subscribe(refresh),
                spacesStore.subscribe(refresh),
                // 重启后按网址重新挂接固定项 / 收藏
                (void reattachByUrl(), () => { }),
                // 与 Chrome 自身的“固定标签”同步：在 Chrome 菜单里固定 → 进入当前空间的固定区；取消 Chrome 固定 → 移回 Today
                (() => {
                    const onUpd = (id: number, ch: { pinned?: boolean }, tab: chrome.tabs.Tab) => {
                        if (ch.pinned === undefined || tab.windowId !== getWindowId()) return;
                        const owner = pinnedOwner(id);
                        if (ch.pinned && !owner) void pinTab(tab);
                        else if (!ch.pinned && owner) void unpin(owner.node.id);
                    };
                    chrome.tabs.onUpdated.addListener(onUpd);
                    return () => chrome.tabs.onUpdated.removeListener(onUpd);
                })(),
                addClaimProvider("PinnedTabs", () => [...walk(spaceList())].flatMap(n => n.tabId != null && getTab(n.tabId) ? [n.tabId] : [])),
                addSection("header", "PinnedTabs", {
                    order: 10,
                    render(el) {
                        const collapsed = !!pinnedStore.get().collapsed[activeSpace().id];
                        el.append(h("button", { class: "arc-caret", "data-tip": collapsed ? tr("pinned.expand") : tr("pinned.collapse"), onclick: () => pinnedStore.update(x => { const id = activeSpace().id; x.collapsed[id] = !x.collapsed[id]; }) }, icon(collapsed ? "chevronRight" : "chevronDown", 14)));
                    },
                }),
                addSection("pinned", "PinnedTabs", {
                    render(el) {
                        const d = pinnedStore.get();
                        const box = h("div", { class: "arc-pinned" });
                        if (!d.collapsed[activeSpace().id]) box.append(...renderNodes(spaceList(d), 0));
                        else { // 折叠时仍显示当前激活的固定标签
                            const act = [...walk(spaceList(d))].find(n => getTab(n.tabId)?.active);
                            if (act) box.append(...renderNodes([act], 0));
                        }
                        box.addEventListener("dragover", e => e.preventDefault());
                        box.addEventListener("drop", e => { const data = e.dataTransfer?.getData("text/arc-item"); if (data) { e.preventDefault(); void handleDrop(data, {}); } });
                        if (!spaceList(d).length) box.append(h("div", { class: "arc-hint" }, tr("pinned.dropHint")));
                        el.append(box, h("div", { class: "arc-divider" }));
                    },
                }),
            ];
        },
    },
});

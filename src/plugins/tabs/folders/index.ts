import { arcTooltip } from "@components/ArcTooltip";
/*
 * Folders（§7）：固定区内的可嵌套文件夹；折叠 / 展开、重命名、删除、复制全部链接、粘贴网址为新标签。
 * 通过 PinnedTabs 导出的 nodeRenderers 扩展它的树（插件间依赖，同 Void++ 插件互相 import）。
 */
import { call } from "@api/RPC";
import { safe } from "@api/ErrorLog";
import { archiveStore } from "@plugins/tabs/archive";
import { applyUrlTransforms } from "@api/UrlTransforms";
import { arcConfirm } from "@components/Dialog";
import { definePluginSettings } from "@api/Settings";
import { spaceIconNode } from "@api/spaceIcons";
import { openIconPicker } from "@components/IconPicker";
import { activeSpace } from "@plugins/spaces/spaceManager/store";
import { tr } from "@api/i18n";
import { folderGlyph } from "@api/icons";
import { snapshotStores } from "@api/Undo";
import { copyText } from "@api/Clipboard";
import { h } from "@api/dom";
import { folderOpening } from "@components/folderAnim";
import { refresh } from "@api/Slots";
import { uid } from "@utils/misc";
import { showContextMenu } from "@api/PanelShell";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { getTab } from "@plugins/_core/tabState";
import { focusOrOpen, inlineRename } from "@components/TabRow";
import { openMenu } from "@components/Menu";
import { handleDrop, inIncognito, moveKeysToSpace, mutateSpace, nodeRenderers, pinMoveToMenu, type PinNode, pinnedStore, walk } from "@plugins/tabs/pinnedTabs";

const find = (l: PinNode[], id?: string) => [...walk(l)].find(n => n.id === id);

const settings = definePluginSettings({
    // Arc 文件夹菜单没有（sidebar-features.md §24 List Context Menu；审计 52193 多出项 #8）：默认关闭，功能保留
    pasteMenu: { type: OptionType.BOOLEAN, default: false, description: "folders.pasteMenu" },
});

/** 从当前空间的树里删掉文件夹（任意层） */
const removeFolder = (folderId: string, spaceId?: string) => mutateSpace(l => { for (const arr of [l, ...[...walk(l)].map(n => n.children ?? [])]) { const i = arr.findIndex(n => n.id === folderId); if (i >= 0) arr.splice(i, 1); } }, spaceId);

/** 文件夹里的链接（含嵌套子文件夹；是否包含嵌套 ⛔） */
const folderLinks = (f: PinNode | undefined) => [...walk(f?.children)].flatMap(n => n.url ? [{ title: n.customTitle || n.title || "", url: applyUrlTransforms("copy", n.url) }] : []);
/** Copy All Links（urlbar-menus-followup.md §5.2 非 Markdown 模式，rMD/0x1029a6bf8.c）：每项只输出网址，joined(separator: "\n")（L194） */
export function folderUrls(f: PinNode | undefined): string {
    return folderLinks(f).map(l => l.url).join("\n");
}
/** Copy All Links as Markdown（§5.2，候选：WindowData+Pasteboard 的多链接格式，与该菜单项的绑定 ⛔）：
 *  每项 前缀 + "[" + 标题 + "](" + URL + ")"，前缀在项数 != 1 时为 "- "（L108），标题为空 → "[](url)"；joined "\n"。只有一项且无标题时走另一路径 ⛔，按同一格式。 */
export function folderMarkdown(f: PinNode | undefined): string {
    const links = folderLinks(f), pre = links.length !== 1 ? "- " : "";
    return links.map(l => `${pre}[${l.title}](${l.url})`).join("\n");
}

/** Turn into Space（sidebar-features.md §24 / §5）：以文件夹名建新空间，文件夹里的项目成为新空间的固定项，原文件夹删除 */
async function turnIntoSpace(folderId: string) {
    const from = activeSpace().id;
    const f = find(pinnedStore.get().bySpace[from] ?? [], folderId);
    if (!f) return;
    const id = await call<string>("spaces:create", f.title || tr("folders.newName"));
    if (!id) return;
    await moveKeysToSpace((f.children ?? []).map(c => `pin:${c.id}`), id, from);
    await removeFolder(folderId, from);
}

/** 归档用的文件夹副本：整棵子树，去掉 tabId（取回时不带旧标签） */
export function archivedFolder(f: PinNode): PinNode {
    const c = structuredClone(f);
    for (const n of walk([c])) delete n.tabId;
    return c;
}

/** 删除确认（urlbar-menus-followup.md §5.3，0x102a6c918–0x102a6ccfc）：标题 “Delete your “%@” folder?”（名称为空 → “Are you sure?”），
 *  说明 “Deleting this folder will archive the tabs inside it.”，按钮 “Delete Folder” / “Cancel”（Dialog 默认）。按钮角色字节 1 / 0 的含义 ⛔，沿用 danger。
 *  「菜单定案」§3：Delete（FUN_102ebfd28）与 Archive Folder(s)（FUN_102ebf5e4）发出同一个动作 archive（tag 0xf）→ 不是真删除：
 *  文件夹连同子项进归档（Library → Archived Tabs，可 Put back 整体取回，collectChildren），其中打开的标签关闭；
 *  撤销提示 “Archive Tab” / “Archive Tabs”（FUN_1027f69f8 / FUN_1027f6b08，rUD/0x1029bc040.c L1321–1330）。单 / 复数按选中项数（文件夹菜单 = 1 项）挑选 ⛔ 未逐行核实。
 *  ⌘Z 是否重新打开这些标签 ⛔（undoCloseItems reducer 未找到）：沿用现状，只恢复文件夹。 */
async function deleteFolder(folderId: string, title?: string) {
    if (!await arcConfirm(title ? tr("folders.deleteConfirm", title) : tr("folders.deleteConfirmNoName"), { ok: tr("folders.delete"), danger: true, detail: tr("folders.deleteDetail") })) return;
    await archiveFolder(folderId);
}

export async function archiveFolder(folderId: string, spaceId = activeSpace().id) {
    const f = find(pinnedStore.get().bySpace[spaceId] ?? [], folderId);
    if (!f) return;
    const open = [...walk(f.children)].flatMap(n => n.tabId != null ? [n.tabId] : []);
    // 先快照（文件夹树 + 归档），关完标签再记撤销：关标签会压 tabsClosed，本条必须在栈顶（rel32 回归）
    const commit = snapshotStores([pinnedStore, archiveStore]);
    // 先把文件夹交给归档（这些标签由文件夹一并归档，归档插件不再逐个记成标签），再关标签
    await safe(call("archive:addFolder", archivedFolder(f), spaceId, open), "archive:addFolder");
    await removeFolder(folderId, spaceId);
    if (open.length) await chrome.tabs.remove(open).catch(() => { /* 标签已关 */ });
    commit(tr("tab.archiveTab"));
}

/** 新建文件夹：直接以“未命名”建好，随后在原位行内命名（同 Arc） */
async function newFolder(parentId?: string) {
    const id = uid();
    await mutateSpace(list => {
        const node: PinNode = { id, kind: "folder", title: tr("folders.newName"), children: [] };
        const parent = find(list, parentId);
        if (parent?.kind === "folder") { parent.collapsed = false; (parent.children ??= []).push(node); } else list.push(node);
    });
    renameFolder(id);
}

/** 行内重命名文件夹（等待渲染出标题后就地编辑） */
export function renameFolder(id: string) {
    const end = Date.now() + 1500;
    const tryIt = () => {
        const span = document.querySelector<HTMLElement>(`.arc-folder-head[data-folder="${id}"] .arc-tab-title`);
        if (!span) { if (Date.now() < end) setTimeout(tryIt, 50); return; }
        inlineRename(span, span.textContent ?? "", v => { if (v) void mutateSpace(l => { const f = find(l, id); if (f) f.title = v; }); });
    };
    tryIt();
}

/** 落点：头部上 25% → 之前，下 25% → 之后（折叠时），其余 → 放入 */
function dropZone(e: DragEvent, el: HTMLElement, collapsed?: boolean): "before" | "after" | "into" {
    if (!e.clientX && !e.clientY) return "into"; // 无坐标（键盘 / 合成事件）
    const r = el.getBoundingClientRect(); const y = (e.clientY - r.top) / (r.height || 1);
    return y < 0.25 ? "before" : y > 0.75 && collapsed ? "after" : "into";
}

let peekTimer: ReturnType<typeof setTimeout> | undefined;
function folderPeek(el: HTMLElement, n: PinNode) {
    if (peekTimer) clearTimeout(peekTimer);
    peekTimer = setTimeout(() => {
        if (!el.matches(":hover")) return;
        const items = [...walk(n.children)].filter(c => c.kind === "tab" && c.url).slice(0, 15);
        if (!items.length) return;
        const r = el.getBoundingClientRect();
        openMenu({ x: r.left + 24, y: r.bottom }, items.map(c => ({ label: c.customTitle ?? c.title ?? c.url!, test: "folder-peek", run: () => void focusOrOpen(c.tabId, c.url!) })));
    }, 650);
}

function renderFolder(n: PinNode, depth: number, children: (l: PinNode[], d: number) => HTMLElement[]) {
    const head = h("div", {
        class: "arc-folder-head", style: `padding-left:${10 + depth * 16}px`, draggable: "true", "data-folder": n.id,
        onclick: () => mutateSpace(l => { const f = find(l, n.id); if (f) f.collapsed = !f.collapsed; }),
        oncontextmenu: (e: MouseEvent) => showContextMenu(e, "folder", { itemId: n.id, title: n.title }),
        // 悬停折叠的文件夹：弹出其中内容的预览，可直接点开（同 Arc）
        onmouseenter: (e: MouseEvent) => { if (n.collapsed) folderPeek(e.currentTarget as HTMLElement, n); },
        onmouseleave: () => { if (peekTimer) clearTimeout(peekTimer); },
        ondragstart: (e: DragEvent) => e.dataTransfer!.setData("text/arc-item", `pin:${n.id}`),
        ondragover: (e: DragEvent) => { e.preventDefault(); const el = e.currentTarget as HTMLElement; el.dataset.drop = dropZone(e, el, n.collapsed); },
        ondragleave: (e: DragEvent) => { delete (e.currentTarget as HTMLElement).dataset.drop; },
        ondrop: (e: DragEvent) => {
            const el = e.currentTarget as HTMLElement; delete el.dataset.drop;
            const d = e.dataTransfer?.getData("text/arc-item"); if (!d) return;
            e.preventDefault(); e.stopPropagation();
            const z = dropZone(e, el, n.collapsed);
            void handleDrop(d, z === "into" ? { into: n.id } : { [z]: n.id });
        },
    // Change Icon 设的自定义图标（尺寸 ⛔，同标签行 16）；没有时用 SF folder 字形
    }, h("span", { class: "arc-folder-icon" }, n.customIcon ? spaceIconNode(n.customIcon, 16) : folderGlyph(!n.collapsed)), h("span", { class: "arc-tab-title" }, n.title ?? tr("plugin.folders.label")));
    // tooltip-row.md：ListHeaderCellView 仅标题（文件夹名）、无副标题、delay 1.5；anchor 8=cursor ⛔ ArcTooltip 仅支持 edge 0..7，暂用默认方向
    arcTooltip(head, () => n.title ?? tr("plugin.folders.label"), { delay: 1.5, anchor: "cursor" });
    // 折叠时仍显示其中当前激活的标签（Arc）
    const shown = n.collapsed ? [...walk(n.children)].filter(c => c.kind === "tab" && getTab(c.tabId)?.active) : n.children ?? [];
    return h("div", { class: "arc-folder", "data-collapsed": String(!!n.collapsed) }, head, h("div", { class: folderOpening(n.id, !!n.collapsed) ? "arc-folder-body arc-folder-opening" : "arc-folder-body" }, children(shown, depth + 1)));
}

export default definePlugin({
    name: "Folders",
    authors: [Devs.ArcSidebar],
    label: "plugin.folders.label",
    description: "plugin.folders.desc",
    tags: ["tabs"],
    dependencies: ["PinnedTabs"],
    enabledByDefault: true,
    settings,
    commands: [{ id: "folder.new", label: "folders.new", keywords: ["new folder"], context: "panel", run: () => newFolder() }],
    contextMenuItems: {
        sidebar: [{ id: "newFolder", label: "folders.new", order: 30, run: () => newFolder() }],
        // 顺序见 ContextMenus.ts MENU_LAYOUT.folder（urlbar-menus-followup.md §5.1）。Share Folder… ⛔ 扩展没有，不加。
        folder: [
            { id: "sub", label: "folders.newSub", run: t => newFolder(t.itemId) },
            { id: "toSpace", label: t => tr("folders.toSpace", t.title ?? ""), run: t => turnIntoSpace(t.itemId!) },
            // Copy All Links：文件夹有子项时出现（L302）。as Markdown 在 Arc 很可能是按 ⌥ 出现的替代项（alternate 字段 ⛔ 未读到），菜单不支持替代项 → 两项并列
            { id: "copyLinks", label: "folders.copyAll", visible: t => folderLinks(find(pinnedStore.get().bySpace[activeSpace().id] ?? [], t.itemId)).length > 0, run: async t => { const s = folderUrls(find(pinnedStore.get().bySpace[activeSpace().id] ?? [], t.itemId)); if (s) await copyText(s); } },
            { id: "copyMd", label: "folders.copyAllMd", visible: t => folderLinks(find(pinnedStore.get().bySpace[activeSpace().id] ?? [], t.itemId)).length > 0, run: async t => { const md = folderMarkdown(find(pinnedStore.get().bySpace[activeSpace().id] ?? [], t.itemId)); if (md) await copyText(md); } },
            { id: "paste", label: "folders.paste", visible: () => !!settings.store.pasteMenu, run: async t => { const url = (await navigator.clipboard.readText()).trim(); if (/^https?:\/\//.test(url)) await mutateSpace(l => { find(l, t.itemId)?.children?.push({ id: uid(), kind: "tab", url, title: url }); }); } },
            // Change Icon（FUN_102ed7130，L336）：出现条件“返回非空”⛔，总是显示
            {
                id: "changeIcon", label: "tab.changeIcon", run: t => {
                    const n = find(pinnedStore.get().bySpace[activeSpace().id] ?? [], t.itemId);
                    const el = document.querySelector(`.arc-folder-head[data-folder="${CSS.escape(t.itemId!)}"] .arc-folder-icon`)?.getBoundingClientRect();
                    openIconPicker(el ? { x: el.left, y: el.bottom + 4 } : { x: 40, y: 60 }, n?.customIcon, v => void mutateSpace(l => { const m = find(l, t.itemId); if (m) m.customIcon = v || undefined; }));
                },
            },
            { id: "rename", label: "folders.rename", run: t => renameFolder(t.itemId!) },
            { id: "dup", label: "folders.duplicate", run: t => mutateSpace(l => { const f = find(l, t.itemId); if (!f) return; const clone = structuredClone(f); for (const n of walk([clone])) { n.id = uid(); delete n.tabId; } l.push(clone); }) },
            // Move to（「菜单定案」§2）：§5.1 第 8 项 = FUN_102ebf3b4 的 “Move to” 子菜单（FUN_102ec118c）；非无痕窗口才有（rMenu2/0x102ea8d6c.c L487–495）。
            // 多选时追加的 “New Folder with N Items” 在多选菜单（multiSelect）里；本菜单只作用于单个文件夹。
            { id: "move", label: "tab.moveTo", visible: () => !inIncognito(), run: () => { }, submenu: t => pinMoveToMenu(t.itemId!) },
            // 菜单项文字 “Delete”（§5.1 第 9 项，FUN_102ebfd28；canArchiveFolders 为真时是 Archive Folder(s)，二者动作相同 = 归档，见 deleteFolder）
            { id: "delete", label: "common.delete", order: 99, run: t => deleteFolder(t.itemId!, t.title) },
        ],
    },
    panel: {
        start() {
            nodeRenderers.set("folder", renderFolder);
            refresh();
            return () => { nodeRenderers.delete("folder"); refresh(); };
        },
    },
});

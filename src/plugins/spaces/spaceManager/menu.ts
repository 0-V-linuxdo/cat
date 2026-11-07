/*
 * Arc 的空间菜单（标题行“…” / 右键空间）：顺序与分组同 Arc ——
 * 更改空间图标… / 重命名空间… / 编辑主题颜色… / 设置个人资料 › ‖ 新建文件夹 / 实时文件夹 › ‖
 * 分享空间… / 把“X”导出到文件夹 › ‖ 管理空间… ‖ 删除空间。
 * 图标、主题颜色、分享是弹出面板；管理空间是浮层（排序、重命名、图标、颜色、删除）。
 */
import { safe } from "@api/ErrorLog";
import { arcPrompt } from "@components/Dialog";
import { tr } from "@api/i18n";
import { h } from "@api/dom";
import "@components/ArcTooltip";
import { icon as svgIcon } from "@api/icons";
import { call } from "@api/RPC";
import { copyText } from "@api/Clipboard";
import { toast } from "@api/PanelShell";
import { commands, runCommand } from "@api/Commands";
import { snapshotStores } from "@api/Undo";
import { openOverlay, refresh } from "@api/Slots";
import { isPluginEnabled, setPluginOrFeature } from "@api/PluginManager";
import { closeMenus, openPanel } from "@components/Menu";
import { openIconPicker, PICKER_EMOJI } from "@components/IconPicker";
import { iconText, spaceIconNode } from "@api/spaceIcons";
import { inlineRename } from "@components/TabRow";
import type { MenuItemDef } from "@api/ContextMenus";
import { uid } from "@utils/misc";
import { getWindowId } from "@plugins/_core/tabState";
import { type PinNode, pinnedStore, walk } from "@plugins/tabs/pinnedTabs/model";
import { liveQuery, setLiveQuery } from "@plugins/tabs/liveFolders";
import { activeSpace, COLOR_HEX, SPACE_COLORS, type Space, spacesStore, themePickerHook } from "./store";

export const SPACE_EMOJI = PICKER_EMOJI;
const byId = (id?: string) => spacesStore.get().spaces.find(s => s.id === id);

/** 菜单关闭后在原位置（或标题行下方）弹出面板 */
let lastAt = { x: 40, y: 60 };
if (typeof document !== "undefined") document.addEventListener("contextmenu", e => { lastAt = { x: e.clientX, y: e.clientY }; }, true);
if (typeof document !== "undefined") document.addEventListener("click", e => { if ((e.target as Element | null)?.closest?.(".arc-space-more")) { const r = (e.target as Element).closest(".arc-space-more")!.getBoundingClientRect(); lastAt = { x: r.left, y: r.bottom + 4 }; } }, true);
const panelAt = () => lastAt;

/** 图标选择器：共享 IconPicker（Emoji / Icon 分段） */
export function iconPicker(id: string, at = panelAt()) {
    return openIconPicker(at, byId(id)?.icon, icon => void call("spaces:update", id, { icon }));
}

/** 主题颜色选择器：颜色色板 +（Themes 插件启用时）渐变 / 第二颜色 / 噪点 */
export function colorPicker(id: string, at = panelAt()) {
    if (themePickerHook.open) return themePickerHook.open(id, at);
    const cur = byId(id)?.color;
    const swatches = h("div", { class: "arc-swatches" }, SPACE_COLORS.map(c => h("button", {
        class: `arc-swatch${cur === c ? " on" : ""}`, "data-test": `color:${c}`, "data-tip": tr(`spaces.color.${c}`), style: `--sw:${COLOR_HEX[c]}`,
        onclick: (e: MouseEvent) => { void call("spaces:update", id, { color: c }); swatches.querySelectorAll(".on").forEach(n => n.classList.remove("on")); (e.currentTarget as HTMLElement).classList.add("on"); },
    })));
    openPanel(at, [h("div", { class: "arc-picker-label" }, tr("spaces.picker.color")), swatches], "arc-picker");
}

/** 分享空间：Chrome 没有在线分享链接 → 复制 Markdown 链接列表 / 复制或下载 JSON */
async function spaceExport(sp: Space) {
    const strip = (l: PinNode[]): unknown[] => l.map(n => n.kind === "folder" ? { folder: n.title, children: strip(n.children ?? []) } : { title: n.customTitle ?? n.title, url: n.url });
    const tabs = (await chrome.tabs.query({})).filter(x => spacesStore.get().tabSpace[x.id!] === sp.id && /^https?:/.test(x.url ?? ""));
    const pins = pinnedStore.get().bySpace[sp.id] ?? [];
    const pinnedIds = new Set([...walk(pins)].map(n => n.tabId));
    const today = tabs.filter(t => !pinnedIds.has(t.id));
    const md = [`## ${`${iconText(sp.icon)} ${sp.name}`.trim()}`, ...[...walk(pins)].filter(n => n.url).map(n => `- [${n.customTitle ?? n.title ?? n.url}](${n.url})`), ...today.map(x => `- [${x.title}](${x.url})`)].join("\n");
    const json = JSON.stringify({ arcSidebarSpace: 1, name: sp.name, icon: sp.icon, color: sp.color, theme: sp.theme, pinned: strip(pins), tabs: today.map(t => ({ title: t.title, url: t.url })) }, null, 2);
    return { md, json };
}
export function sharePanel(id: string, at = panelAt()) {
    const sp = byId(id); if (!sp) return;
    const done = () => { toast(tr("common.copied")); closeMenus(); };
    const btn = (test: string, label: string, run: () => unknown) => h("button", { class: "arc-menu-item", "data-test": test, onclick: () => void safe(Promise.resolve().then(run), test) }, h("span", { class: "arc-menu-label" }, tr(label)));
    openPanel(at, [
        h("div", { class: "arc-picker-label" }, tr("spaces.share.title", sp.name)),
        h("p", { class: "arc-picker-hint" }, tr("spaces.share.hint")),
        btn("share:links", "spaces.share.links", async () => { if (await copyText((await spaceExport(sp)).md)) done(); }),
        btn("share:json", "spaces.share.json", async () => { if (await copyText((await spaceExport(sp)).json)) done(); }),
        btn("share:download", "spaces.share.download", async () => {
            const a = h("a", { href: URL.createObjectURL(new Blob([(await spaceExport(sp)).json], { type: "application/json" })), download: `${sp.name || "space"}.arc-space.json` }) as HTMLAnchorElement;
            a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); closeMenus();
        }),
    ], "arc-picker arc-share");
}

/** 把整个空间导出到另一个空间的文件夹（固定项 + 今日标签都进文件夹，标签归到目标空间，原空间删除；可撤销） */
export async function exportIntoFolder(srcId: string, dstId: string) {
    const src = byId(srcId), dst = byId(dstId);
    if (!src || !dst || srcId === dstId) return;
    const push = snapshotStores([spacesStore, pinnedStore]);
    const d = spacesStore.get();
    const pins = pinnedStore.get().bySpace[srcId] ?? [];
    const claimed = new Set<number | undefined>([...walk(pins)].map(n => n.tabId).filter(x => x != null));
    // rel48 ②：首次导航未提交时 url 是空串（不是 undefined）→ 用 || 回退 pendingUrl（同 pinnedTabs/model.ts tabUrl）
    const tabs = (await chrome.tabs.query({})).filter(t => d.tabSpace[t.id!] === srcId && !claimed.has(t.id) && !t.pinned && /^(https?|file|chrome):/.test(t.url || t.pendingUrl || ""));
    const folder: PinNode = {
        id: uid(), kind: "folder", title: `${iconText(src.icon) ? `${iconText(src.icon)} ` : ""}${src.name}`, collapsed: false,
        children: [...structuredClone(pins), ...tabs.map(t => ({ id: uid(), kind: "tab" as const, url: t.url || t.pendingUrl, title: t.title, tabId: t.id }))],
    };
    await pinnedStore.update(x => { (x.bySpace[dstId] ??= []).push(folder); delete x.bySpace[srcId]; delete x.collapsed[srcId]; });
    await call("spaces:merge", srcId, dstId, getWindowId());
    push(tr("spaces.menu.export", src.name));
    toast(tr("spaces.exported", src.name, dst.name));
}

/** 实时文件夹 ›：接到现有 Live Folders 功能（GitHub 搜索）；会顺带打开该功能 */
function liveMenu(): MenuItemDef[] {
    const set = async (q: string) => { if (q) await setPluginOrFeature("LiveFolders", true); setLiveQuery(q); if (q) toast(tr("spaces.live.on")); refresh(); };
    const on = () => isPluginEnabled("LiveFolders") && !!liveQuery();
    const presets = [["prs", "is:open is:pr author:@me"], ["issues", "is:open is:issue assignee:@me"]] as const;
    return [
        ...presets.map(([k, q]) => ({ id: `live:${k}`, label: `spaces.live.${k}`, checked: () => on() && liveQuery() === q, run: () => set(q) })),
        { id: "live:custom", label: "spaces.live.custom", run: async () => { const q = await arcPrompt(tr("spaces.live.prompt"), liveQuery()); if (q != null && q.trim()) void set(q.trim()); } },
        ...(on() ? [{ id: "live:off", label: "spaces.live.off", run: () => set("") }] : []),
    ];
}

/** 不在当前空间时先切过去（新建文件夹、重命名都作用于当前空间） */
async function ensureActive(id: string) {
    if (activeSpace().id === id) return;
    await call("spaces:switch", id, getWindowId());
    await new Promise(r => setTimeout(r, 250));
}

export function spaceMenuItems(rename: (id: string) => unknown, del: (id: string) => unknown): MenuItemDef[] {
    return [
        { id: "icon", group: 1, order: 10, label: "spaces.menu.changeIcon", run: t => iconPicker(t.spaceId!) },
        { id: "rename", group: 1, order: 11, label: "spaces.menu.rename", run: t => rename(t.spaceId!) },
        { id: "theme", group: 1, order: 12, label: "spaces.menu.theme", run: t => colorPicker(t.spaceId!) },
        // Chrome 扩展无法按空间切换浏览器个人资料：保留位置，灰显并说明原因
        { id: "profile", group: 1, order: 13, label: "spaces.menu.profile", disabled: true, title: "spaces.menu.profileNA", run: () => { }, submenu: () => [] },
        { id: "newFolder", group: 2, order: 20, label: "spaces.menu.newFolder", visible: () => !!commands.get("folder.new"), run: async t => { await ensureActive(t.spaceId!); await runCommand("folder.new"); } },
        { id: "live", group: 2, order: 21, label: "spaces.menu.liveFolders", run: () => { }, submenu: () => liveMenu() },
        { id: "share", group: 3, order: 30, label: "spaces.menu.share", run: t => sharePanel(t.spaceId!) },
        {
            id: "export", group: 3, order: 31, label: t => tr("spaces.menu.export", byId(t.spaceId)?.name ?? ""), visible: () => spacesStore.get().spaces.length > 1,
            run: () => { }, submenu: t => spacesStore.get().spaces.filter(s => s.id !== t.spaceId).map(s => ({ id: `export:${s.id}`, label: `${iconText(s.icon)} ${s.name}`.trim(), run: () => void safe(exportIntoFolder(t.spaceId!, s.id), "exportIntoFolder") })),
        },
        { id: "manage", group: 4, order: 40, label: "spaces.menu.manage", run: () => openOverlay("manageSpaces") },
        { id: "delete", group: 5, order: 99, label: "spaces.menu.delete", danger: true, visible: () => spacesStore.get().spaces.length > 1, run: t => del(t.spaceId!) },
    ];
}

/** 管理空间浮层：拖动排序、图标、重命名、颜色、删除、新建 */
export function renderManage(box: HTMLElement, reorder: (id: string, before: string) => unknown, del: (id: string) => unknown, create: () => unknown) {
    const draw = () => {
        const d = spacesStore.get();
        // 51998：管理空间面板——在视口内、内部滚动（不论宿主是否已处理）
        box.style.minHeight = "0"; box.style.overflowY = "auto"; box.style.overscrollBehavior = "contain";
        box.replaceChildren(h("div", { class: "arc-manage" },
            d.spaces.map(s => {
                const row = h("div", {
                    class: "arc-manage-row", "data-space": s.id, draggable: "true",
                    ondragstart: (e: DragEvent) => e.dataTransfer!.setData("text/arc-space", s.id),
                    ondragover: (e: DragEvent) => { if (e.dataTransfer?.types.includes("text/arc-space")) { e.preventDefault(); row.classList.add("drop"); } },
                    ondragleave: () => row.classList.remove("drop"),
                    ondrop: (e: DragEvent) => { row.classList.remove("drop"); const m = e.dataTransfer?.getData("text/arc-space"); if (m) { e.preventDefault(); void reorder(m, s.id); } },
                },
                h("span", { class: "arc-manage-grip", "data-tip": tr("spaces.manage.drag") }, svgIcon("dragHandle", 16)), // Arc SpaceManagementDrggerView：icomoon U+E9A7 16pt template 16×16，居中在 28×28 的 HoverableView（audit-52193-answers.md #31）
                h("button", { class: "arc-manage-icon", "data-color": s.color, "data-tip": tr("spaces.changeIcon"), "data-test": "manage:icon", onclick: (e: MouseEvent) => { e.stopPropagation(); const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); iconPicker(s.id, { x: r.left, y: r.bottom + 4 }); } }, spaceIconNode(s.icon, 16)),
                h("span", { class: "arc-manage-name", "data-tip": tr("spaces.manage.name"), "data-test": "manage:name", ondblclick: (e: MouseEvent) => inlineRename(e.currentTarget as HTMLElement, s.name, name => { if (name) void call("spaces:update", s.id, { name }); }) }, s.name),
                h("button", { class: "arc-swatch on", style: `--sw:${COLOR_HEX[s.color]}`, "data-tip": tr("spaces.changeColor"), "data-test": "manage:color", onclick: (e: MouseEvent) => { e.stopPropagation(); const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); colorPicker(s.id, { x: r.left - 120, y: r.bottom + 4 }); } }),
                d.spaces.length > 1 ? h("button", { class: "arc-icon-btn", "data-tip": tr("spaces.menu.delete"), "data-test": "manage:delete", onclick: () => void del(s.id) }, svgIcon("trash", 14)) : null);
                return row;
            }),
            h("button", { class: "arc-btn arc-manage-new", "data-test": "manage:new", onclick: () => void create() }, svgIcon("plus", 14), tr("spaces.new"))));
    };
    draw();
    return spacesStore.subscribe(draw);
}

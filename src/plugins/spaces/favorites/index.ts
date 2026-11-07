/*
 * Favorites（§4）：顶部图标网格，所有 Space 共享；点击激活或打开；右键移除。
 * 收藏关联的已打开标签会被“认领”，不出现在 Today，也不会被自动归档。
 */
import { safe } from "@api/ErrorLog";
import { onTabIdRemap } from "@api/TabIdRemap";
import { listen } from "@api/ChromeEvents";
import { clearClosedTabId, shouldClearOnRemoved } from "@plugins/tabs/pinnedTabs/closedTab";
import { floatingEdit } from "@components/TabRow";
import { arcRename } from "@components/Dialog";
import { openIconPicker } from "@components/IconPicker";
import { isSym, symIcon } from "@api/spaceIcons";
import { toUrl } from "@utils/misc";
import { tr } from "@api/i18n";
import { recordStoreUndo } from "@api/Undo";
import { addClaimProvider } from "@api/Claims";
import { h } from "@api/dom";
import "@components/ArcTooltip";
import "./i18n";
import { addSection, refresh } from "@api/Slots";
import { faviconUrl, uid } from "@utils/misc";
import { FAV_BLUR, contrastTransfer } from "./blurFx";
import { copyUrlWithToast, showContextMenu, toast } from "@api/PanelShell";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { definePluginSettings } from "@api/Settings";
import { activeTab, getTab, getTabs } from "@plugins/_core/tabState";
import { focusOrOpen } from "@components/TabRow";
import { pinnedStore, unpin, walk } from "@plugins/tabs/pinnedTabs";

import { dupFav, type Fav, favStore, favTitle, renameFav, replaceFavUrl, resetFavIcon } from "./store";

export { resetFavIcon };
import { editPinnedMenu, editPinnedVisible } from "@plugins/tabs/pinnedTabs/editPinnedMenu";
import { favMenuState, favSelectionCount, resolveFavUrl } from "./menuState";

export { favStore } from "./store";

const incognito = () => !!chrome.extension?.inIncognitoContext;
/** 该收藏能解析出的网址（FUN_102a18f08 case 0，urlbar-menus-followup.md L467–512）：先取打开的标签的当前页网址，没有再取保存的网址；都没有 = undefined（Edit Pinned Page ▸ 整个不出现） */
export const favUrl = (t: { itemId?: string; url?: string }) => { const f = favStore.get().items.find(i => i.id === t.itemId); return resolveFavUrl(getTab(f?.tabId)?.url, f?.url ?? t.url); };

/** 同 Arc：收藏最多 12 个 */
export const MAX_FAVS = 12;
const full = () => { if (favStore.get().items.length < MAX_FAVS) return false; toast(tr("fav.full", MAX_FAVS)); return true; };

export async function addFavorite(tab?: chrome.tabs.Tab) {
    const t = tab ?? activeTab();
    if (!t?.url) return;
    if (favStore.get().items.some(f => f.tabId === t.id)) { toast(tr("fav.already")); return; }
    if (full()) return;
    await favStore.update(x => { x.items.push({ id: uid(), url: t.url!, title: t.title ?? t.url!, tabId: t.id }); });
}

async function openFav(f: Fav) {
    // 已经是当前标签且偏离了收藏的网址：再点一次 = 回到收藏的网址（Arc）
    const cur = getTab(f.tabId);
    if (cur?.active && cur.url && cur.url.replace(/#.*$/, "") !== f.url.replace(/#.*$/, "")) { await chrome.tabs.update(cur.id!, { url: f.url }); return; }
    const tabId = await focusOrOpen(f.tabId, f.url);
    if (tabId !== f.tabId) await favStore.update(x => { const it = x.items.find(i => i.id === f.id); if (it) it.tabId = tabId; });
}

/** 复制收藏（右键 Duplicate）：新项紧跟原项，保留 customTitle、复制 saved 字段，然后打开（Arc shouldOpen） */
export async function duplicateFav(id?: string) {
    const src = favStore.get().items.find(i => i.id === id);
    if (!src || full()) return;
    const copy: Fav = { id: uid(), ...dupFav(src, getTab(src.tabId)) };
    await favStore.update(x => { const i = x.items.findIndex(f => f.id === src.id); x.items.splice(i < 0 ? x.items.length : i + 1, 0, copy); });
    await openFav(copy);
}

async function moveFav(id: string, refId: string, after: boolean) {
    await favStore.update(x => {
        const i = x.items.findIndex(f => f.id === id);
        if (i < 0) return;
        const [it] = x.items.splice(i, 1);
        const j = x.items.findIndex(f => f.id === refId);
        x.items.splice(j < 0 ? x.items.length : j + (after ? 1 : 0), 0, it);
    });
}

/** 固定项拖进收藏网格 = 移到收藏 */
async function pinToFavorite(nodeId: string) {
    const all = Object.values(pinnedStore.get().bySpace).flatMap(l => [...walk(l)]);
    const n = all.find(x => x.id === nodeId);
    if (!n?.url || full()) return;
    await favStore.update(x => { x.items.push({ id: uid(), url: n.url!, title: n.title ?? n.url!, customTitle: n.customTitle, tabId: n.tabId }); });
    await unpin(n.id);
}

/* 旧的悬停预览卡（.arc-fav-preview：缩略图 + 标题 + host）已删除：与共享 ArcTooltip 叠加成两个提示（accept-live-52179 第 6 项），且显示 host 违反第 3 项。提示只用 data-tip。 */

/** F-03：Arc 没有“已打开”这一态（audit-52193-answers.md §2：只有 isDimmed，是否同义 ⛔）→ 已打开磁贴的底色 / 未打开降饱和作为多出项，默认关 */
const settings = definePluginSettings({
    openedStyle: { type: OptionType.BOOLEAN, default: false, description: "fav.openedStyle" },
});

/** F-03：磁贴底层的模糊 favicon 图层（Arc AppTrayItemBackgroundView.blurredImageView，rAT/101ceac7c.c；图的生成见 fav-tile-blur.md §1，参数见 blurFx.ts）。
 * Arc：favicon 先在源图像素上做 CIGaussianBlur radius 5 + CIColorControls，再画成 47×47 画布里 (47/5)×16 = 150.4pt 见方（只露出中间约 31%，边缘渐隐落在画布外），
 * 最后 NSImageView 两轴各自拉伸铺满磁贴（无 outset，由磁贴的 12 圆角 masksToBounds 裁剪）。
 * 等价 web 做法（推出来的，⛔ 需实机对照）：内联 <svg viewBox="0 0 64 64" preserveAspectRatio="none"> 里放 <image> + SVG 滤镜——滤镜在 viewBox 用户单位里算，
 * 所以 stdDeviation 5 就是“缩放前的源图像素”，之后 svg 以 320% × 320% 居中铺在磁贴里并随磁贴宽高各自拉伸（见 style.ts .arc-fav-blur > svg）。
 * 不能用 CSS filter: blur(5px) 套在已缩放的元素上：那是对变换后的像素模糊，源图放大 2.35 倍后等效半径差太多（repro：YouTube 平均差 25/255 vs 3/255）。 */
let blurSeq = 0;
function blurLayer(src: string): HTMLElement {
    const NS = "http://www.w3.org/2000/svg", { srcPx, radius, saturation } = FAV_BLUR, { slope, intercept } = contrastTransfer();
    const mk = (tag: string, attrs: Record<string, string>, ...kids: Element[]): SVGElement => {
        const e = document.createElementNS(NS, tag) as SVGElement;
        for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
        for (const c of kids) e.append(c);
        return e;
    };
    const id = `arc-fav-fx-${++blurSeq}`, fn = (t: "R" | "G" | "B") => mk(`feFunc${t}`, { type: "linear", slope: String(slope), intercept: String(intercept) });
    // 滤镜区域放大一倍：保留模糊外扩（Arc 的 extent 外扩，量 ⛔）；sRGB 插值：⛔ CIContext() 默认工作空间可能是线性（SVG 默认 linearRGB），差异大（repro：YouTube 平均 32/255），需实机对照
    const filter = mk("filter", { id, x: "-50%", y: "-50%", width: "200%", height: "200%", "color-interpolation-filters": "sRGB" },
        mk("feGaussianBlur", { stdDeviation: String(radius) }), mk("feColorMatrix", { type: "saturate", values: String(saturation) }),
        mk("feComponentTransfer", {}, fn("R"), fn("G"), fn("B")));
    const image = mk("image", { href: src, x: "0", y: "0", width: String(srcPx), height: String(srcPx), preserveAspectRatio: "none", filter: `url(#${id})` });
    const svg = mk("svg", { viewBox: `0 0 ${srcPx} ${srcPx}`, preserveAspectRatio: "none", focusable: "false", "aria-hidden": "true" }, mk("defs", {}, filter), image);
    const el = h("span", { class: "arc-fav-blur", "aria-hidden": "true" });
    el.append(svg);
    return el;
}

/** Arc EmptyFavicon（archive-page.md §9：ARCClients_BaseAssets EmptyFavicon，14×14 圆角方块，#FAFBFF α.1 + #86888D α.2，无字形）。
 * 无图标网址或加载失败（onerror）时显示。⛔ 收藏格内的尺寸未追到，按资源原尺寸 14×14；Chrome _favicon 对未知站点返回默认地球图标而非失败，此情形无法识别。 */
const EMPTY_FAVICON = "icons/favicon/EmptyFavicon.svg";
function favImg(src: string): HTMLElement {
    const empty = () => h("img", { class: "arc-fav-empty", "data-test": "fav-empty", src: EMPTY_FAVICON, alt: "" });
    if (!src) return empty();
    const img = h("img", { src, alt: "" });
    img.addEventListener("error", () => img.replaceWith(empty()), { once: true });
    return img;
}
/** 模糊底层 + 图标；加载失败时底层一并去掉（EmptyFavicon 无模糊层，⛔） */
function favTile(src: string): HTMLElement[] {
    const img = favImg(src);
    if (!src || img.classList.contains("arc-fav-empty")) return [img];
    const bg = blurLayer(src);
    img.addEventListener("error", () => bg.remove(), { once: true });
    return [bg, img];
}

/** 网格左右边对齐地址栏、按 Rea 规则算列数（favorites-grid.md §2–3；数值注释见 spaces/style.ts .arc-fav-grid） */
/* rel42 hover-rerender：指针停在收藏格上时整屏重绘，keepHover 保留旧网格并按新网格同步属性（syncAttrs）——新网格还没进文档、fit() 量不到，
 * style 为空 → 旧网格的 --fav-cols / --fav-pl / --fav-pr 被摘光（实测 2 列 → 4 列，直到下次窗口尺寸变化才恢复）。
 * 做法：记住上次量到的值，新网格创建时先写上（列数按本次项数重算），syncAttrs 搬过去的就是正确值。 */
let lastFit: { pl: number; pr: number; avail: number } | null = null;
function alignGrid(grid: HTMLElement, n: number): () => void {
    const set = (k: string, v: string) => { if (grid.style.getPropertyValue(k) !== v) grid.style.setProperty(k, v); };
    const apply = (f: { pl: number; pr: number; avail: number }) => {
        set("--fav-pl", `${f.pl}px`); set("--fav-pr", `${f.pr}px`);
        set("--fav-cols", String(Math.max(1, Math.min(n || 1, 4, Math.floor((f.avail + 8) / 55)))));
    };
    if (lastFit) apply(lastFit);
    const fit = () => {
        if (!grid.isConnected) return;
        const g = grid.getBoundingClientRect();
        if (g.width <= 0) return;
        const u = document.querySelector<HTMLElement>(".arc-urlbar")?.getBoundingClientRect();
        const on = !!u && u.width > 0;
        const pl = on ? Math.max(0, u.left - g.left) : 0, pr = on ? Math.max(0, g.right - u.right) : 0;
        apply(lastFit = { pl, pr, avail: g.width - pl - pr });
    };
    /* 52187：RO 回调里同步写 --fav-cols 会改网格高度 → "ResizeObserver loop completed"。回调只排一个合并的 rAF；值未变不写（set 内比较）。首帧仍同步 fit() 一次（挂载时，不在 RO 回调里）。 */
    let raf = 0;
    const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; fit(); }); };
    const ro = new ResizeObserver(schedule);
    ro.observe(grid);
    const bar = document.querySelector(".arc-urlbar"); if (bar) ro.observe(bar);
    fit();
    schedule();
    return () => { if (raf) cancelAnimationFrame(raf); ro.disconnect(); };
}

export default definePlugin({
    name: "Favorites",
    authors: [Devs.ArcSidebar],
    label: "common.favorites",
    description: "fav.desc",
    tags: ["spaces"],
    enabledByDefault: true,
    settings,
    onSettingsChange: () => refresh(),
    commands: [{ id: "fav.add", label: "fav.cmdAdd", keywords: ["favorite", "common.favorites"], context: "panel", run: () => addFavorite() }],
    contextMenuItems: {
        // 标签菜单没有 “Add to Favorites”（urlbar-menus-followup.md「菜单定案」§1：字符串表 / ContextMenus 模块 0 命中）；命令 fav.add 与拖入收藏区保留。
        // Close Tab + Remove Favorite（§4；“Close Favorite” 无调用点 ⛔ 不用；Remove Favorite 单复数 ⛔ 不改）。
        favorite: [
            // 收藏菜单 = Arc「收藏菜单完整结构」（urlbar-menus-followup.md L326–415）；分组 / 顺序见 ContextMenus.ts MENU_LAYOUT.favorite：
            // 组 1 Copy Link(s) | 组 3 Change Icon… / Rename…（renameFavorite，单选）/ Mute（media 插件注册）/ Edit Pinned Page ▸ | Open in Split View / Duplicate（splitView / tabActions 注册）| Close Tab / Remove Favorite。
            // 不做：Live Calendar、Top App 开关、Customize Page、Share / Share N Items…、Move to ▸（Profile 列表）。没有 “Reset icon” 菜单项（Arc 没有；恢复默认图标 = Change Icon… 弹出框头部的删除按钮）。
            { id: "copy", label: () => favMenuState(favSelectionCount()).copyLabel, run: async t => { if (t.url) await copyUrlWithToast(t.url); } },
            // Change Icon…：Arc 的 CustomInfoPicker 弹出框（Emoji / Icon 分段）；头部图标按钮（icomoon U+E9F0）只在已有自定义图标时出现，点击 = 清空自定义图标（resetFavIcon）。
            // 没有 “Reset / Remove” 文字项。⛔ 清空后磁贴的 favicon 回退（沿用现有显示）、按钮没有 tooltip。
            {
                id: "changeIcon", label: "fav.changeIcon", disabled: () => favMenuState(favSelectionCount()).changeIconDisabled, run: t => {
                    const el = document.querySelector(`[data-fav="${t.itemId}"]`); const f = favStore.get().items.find(i => i.id === t.itemId);
                    if (!el || !f) return;
                    const r = el.getBoundingClientRect();
                    openIconPicker({ x: r.left + r.width / 2, y: r.bottom + 4 }, f.icon, v => void (v ? favStore.update(x => { const it = x.items.find(i => i.id === f.id); if (it) it.icon = v; }) : resetFavIcon(f.id)));
                },
            },
            // Rename…（第 7 项，L685 只在单选时出现；收藏走 renameFavorite(12)）：对话框 “Rename Tab…”（TextInputDialog，与标签重命名共用文案，见 Dialog.ts arcRename）。
            // ⛔ 对话框尺寸 / 初始文本（现用当前显示名称）/ 空文本时 Rename 置灰 / 提交是否 trim、空串是否清除（现为 trim + 清除）。
            {
                id: "rename", label: "fav.rename", visible: () => favMenuState(favSelectionCount()).renameVisible, run: async t => {
                    const f = favStore.get().items.find(i => i.id === t.itemId); if (!f) return;
                    const v = await arcRename(favTitle(f, getTab(f.tabId)));
                    if (v != null) await renameFav(f.id, v);
                },
            },
            // Edit Pinned Page ▸（① Replace Pinned URL with Current ② Edit…）：与固定标签共用 pinnedTabs/editPinnedMenu.ts（审计 X-06 / P-04）
            editPinnedMenu({
                visible: t => editPinnedVisible(favSelectionCount(), incognito(), favUrl(t)),
                // 只写 saved 字段，保留 customTitle / 自定义图标（Rea L513–534）；未打开 = 无操作无提示
                replace: t => favStore.update(x => { const f = x.items.find(i => i.id === t.itemId); if (f) replaceFavUrl(f, getTab(f.tabId)); }),
                edit: t => {
                    const el = document.querySelector(`[data-fav="${t.itemId}"]`); const f = favStore.get().items.find(i => i.id === t.itemId);
                    if (el && f) floatingEdit(el, f.url, v => void favStore.update(x => { const it = x.items.find(i => i.id === f.id); if (it) it.url = toUrl(v); }));
                },
            }),
            // Duplicate（Rea H1）：没打开也照常可用（不置灰、不隐藏）；复制出新的收藏，保留自定义标题并复制 saved 字段（见 store.ts dupFav），再打开。
            // 取代 tabActions 共用的 dupMenuItem（它只会复制已打开的标签，且未打开时置灰）；⛔ 新项落点（现紧跟原项后）；受 12 个上限限制（Arc 的上限行为 ⛔）。
            { id: "dup", label: "tab.duplicate", run: t => duplicateFav(t.itemId) },
            { id: "closeTab", label: "fav.closeTab", visible: t => t.tabId != null && !!getTab(t.tabId), run: t => void safe(chrome.tabs.remove(t.tabId!), "tabs.remove") },
            { id: "remove", label: "fav.removeFrom", order: 99, run: t => { recordStoreUndo(tr("fav.remove"), favStore); return favStore.update(x => { x.items = x.items.filter(i => i.id !== t.itemId); }); } },
        ],
    },
    background: {
        start: () => [
            // 标签换 id：收藏跟到新 id
            onTabIdRemap(map => { if (!favStore.get().items.some(f => f.tabId != null && map.has(f.tabId))) return; return favStore.update(x => { for (const f of x.items) if (f.tabId != null && map.has(f.tabId)) f.tabId = map.get(f.tabId); }); }),
            addClaimProvider("Favorites", () => favStore.get().items.flatMap(f => f.tabId != null ? [f.tabId] : [])),
            // 补丁 rel63-fav-reattach（b）：收藏绑定的标签被关掉 → 清 tabId（回到未打开），不再留死 id 让 reattachByUrl 按网址吞并无关标签；窗口整个关闭不清
            listen("tabs.onRemoved", (id, info) => {
                if (!shouldClearOnRemoved(info) || !favStore.get().items.some(f => f.tabId === id)) return;
                void favStore.update(x => { clearClosedTabId(x.items, id); });
            }),
        ],
    },
    panel: {
        start() {
            return [
                favStore.subscribe(refresh),
                addClaimProvider("Favorites", () => favStore.get().items.flatMap(f => f.tabId != null && getTab(f.tabId) ? [f.tabId] : [])),
                addSection("favorites", "Favorites", {
                    render(el) {
                        const items = favStore.get().items;
                        const grid = h("div", { class: "arc-fav-grid" }, items.map(f => {
                            const tab = getTab(f.tabId);
                            return h("button", {
                                class: `arc-fav-tile${tab?.active ? " active" : ""}${tab ? " open" : ""}`, "aria-label": favTitle(f, tab), draggable: "true",
                                onclick: () => void openFav(f),
                                // 中键 = 关闭收藏打开的标签（磁贴保留）
                                onauxclick: (e: MouseEvent) => { if (e.button === 1 && tab?.id != null) { e.preventDefault(); void safe(chrome.tabs.remove(tab.id), "tabs.remove"); } },
                                oncontextmenu: (e: MouseEvent) => showContextMenu(e, "favorite", { itemId: f.id, url: f.url, tabId: f.tabId, title: favTitle(f, tab) }),
                                ondragstart: (e: DragEvent) => e.dataTransfer!.setData("text/arc-item", `fav:${f.id}`),
                                "data-fav": f.id,
                                // 补丁 t903u-tab-switch v2：已打开 = 按 tab.url 判（空 = 判不出 → 预热照发）；未打开 = 按收藏 URL 判
                                "data-pw-target": "fav", "data-pw-tab": tab?.id != null ? String(tab.id) : null, "data-pw-tab-url": tab?.id != null ? (tab.url || tab.pendingUrl || "") : null, "data-pw-url": f.url || null,
                                ondragover: (e: DragEvent) => e.preventDefault(),
                                // 收藏之间拖动排序：放在目标左半边 = 之前，右半边 = 之后
                                ondrop: (e: DragEvent) => {
                                    const data = e.dataTransfer?.getData("text/arc-item") ?? "";
                                    if (!data.startsWith("fav:") || data.slice(4) === f.id) return;
                                    e.preventDefault(); e.stopPropagation();
                                    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                                    void moveFav(data.slice(4), f.id, e.clientX > r.left + r.width / 2);
                                },
                            }, ...(f.icon && !/^(https?:|data:)/.test(f.icon) ? [h("span", { class: "arc-fav-emoji" }, isSym(f.icon) ? symIcon(f.icon.slice(4), 18) : f.icon)] : favTile(f.icon || tab?.favIconUrl || f.favicon || faviconUrl(f.url, 64))));
                        }));
                        if (settings.store.openedStyle) grid.dataset.openedStyle = "true";
                        grid.addEventListener("dragover", e => e.preventDefault());
                        grid.addEventListener("drop", e => {
                            const data = e.dataTransfer?.getData("text/arc-item") ?? "";
                            if (data.startsWith("tab:")) { e.preventDefault(); void addFavorite(getTabs().find(t => t.id === Number(data.slice(4)))); }
                            else if (data.startsWith("pin:")) { e.preventDefault(); void pinToFavorite(data.slice(4)); }
                        });
                        if (!items.length) grid.append(h("div", { class: "arc-hint", "data-test": "fav-empty-state" }, h("span", { class: "arc-hint-title" }, tr("fav.dropHint")), h("span", { class: "arc-hint-sub" }, tr("fav.dropHintSub"))));
                        el.append(grid);
                        return alignGrid(grid, items.length);
                    },
                }),
            ];
        },
    },
});

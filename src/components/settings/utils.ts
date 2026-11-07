/* 对应 Void++ src/components/settings/utils.ts：分类标签页、按分类 / 启用状态 / 搜索过滤插件 */
import { getLang, listSep, tr } from "@api/i18n";
import type { IconName } from "@api/icons";
import { dependentsOf, isPluginEnabled, plugins } from "@api/PluginManager";
import { getPinnedPlugins, getStarredPlugins } from "@api/Settings";
import type { Plugin, PluginTag } from "@utils/types";

export type ListFilter = "all" | "enabled" | "disabled";
export type PluginCategory = "favorites" | "all" | PluginTag;

/* S-04：分类图标只用 Arc 资源 / SF / Arc 自带 ionicons（不用 icons.ts 里原手绘的 command / views；data 已由图标线程换成 SF 条目）：
 * search = ionicons search-outline（命令栏）、splitCols = Arc split-add-right.svg（视图 / 分屏）、data = SF externaldrive.fill（ionGlyphs.ts 独立条目；Rea 建议，ionicons-to-arc.md L41，⛔ 源码未找到）。
 * Arc 没有插件分类页，用哪个图标没有 Rea 出处，属于选型（audit-arc-diff-52193 S-04） */
export const PLUGIN_CATEGORY_TABS: readonly { id: PluginCategory; label: string; icon: IconName }[] = [
    { id: "favorites", label: "common.favorites", icon: "star" },
    { id: "all", label: "common.all", icon: "plugin" },
    { id: "tabs", label: "plugin.tabs.label", icon: "tabs" },
    { id: "spaces", label: "plugin.spaces.label", icon: "spaces" },
    { id: "command", label: "plugin.command.label", icon: "search" },
    { id: "views", label: "plugin.views.label", icon: "splitCols" },
    { id: "library", label: "plugin.library.label", icon: "library" },
    { id: "data", label: "plugin.data.label", icon: "data" },
];

export const TAG_LABEL = Object.fromEntries(PLUGIN_CATEGORY_TABS.map(t => [t.id, t.label])) as Record<PluginCategory, string>;

export const label = (p: Plugin | undefined, fallback = "") => tr(p?.label ?? p?.name ?? fallback);

export function pluginMatchesCategory(p: Plugin, category: PluginCategory): boolean {
    if (category === "all") return true;
    if (category === "favorites") return getStarredPlugins().includes(p.name);
    return p.tags?.includes(category) ?? false;
}

export const searchText = (p: Plugin) => [p.name, label(p), tr(p.description ?? ""), ...(p.tags ?? []).map(t => tr(TAG_LABEL[t])), ...Object.values(p.settings?.def ?? {}).map(d => `${tr(d.feature)} ${tr(d.description)}`)].join(" ").toLowerCase();

/** ⛔ Arc 没有“插件管理页 / 插件卡片”（Arc 自身没有插件系统），Rea 的 arc-analysis / arc-ui 里没有对应卡片底部或功能列表样式 → 保持现有视觉，只统一内容来源，不对齐任何 Arc 样式。
 *  插件卡片底部的功能标签：features 的名称 → featureTags（i18n 键）→ 插件自己的名称（单功能插件显示该功能名）。永远不是作者名（原来 Devs.ArcSidebar = “Cat Contributors” 会回落出来） */
export function cardTags(p: Plugin): string[] {
    const feats = (p.features ?? []).map(f => label(f as Plugin));
    if (feats.length) return feats;
    const tags = (p.featureTags ?? []).map(k => tr(k));
    return tags.length ? tags : [label(p)];
}

/** 插件管理页卡片左上角图标：按插件 name 取（不再按分类取：同一分类的卡片原来共用一个图标，tabs 分类的 5 张卡全是 `tab` 位图 = Arc 里本来就是实心圆角方块，深色下就是“白方块”）。
 * 值 = icons.ts 的 IconName，或 "boxOfThings"（Library：Arc 底栏 Library 入口的 ARCUI BoxOfThingsIcon，DOM 多层叠加，不是单张 svg，见 libraryView 的 boxOfThings()）。
 * 来源分三类（Cat 裁定，arc-ui/plugin-icon-map.md）：
 *  A. Arc 原生资源：CleanUrls = copy-url.svg（`link`）、TidyTabs = broom-stick.svg（`clean`）、Boosts = boost.svg（`boost`）、Views = split-add-right.svg（`splitCols`）、
 *     InpageSidebar = icon-browser-navigation-sidebar.svg（`navSidebar`），
 *     Capture = SF camera 16pt Regular（`cameraRegular`，Arc 截图按钮用的就是它）、Library = BoxOfThings（Rea：LibraryIcon 勿用）。
 *  B. Arc 没有图标 → 语义最近的 SF Symbol，同一规格（Regular、16pt 导出、卡片里 14 盒；Tabs 也是）：⛔ SF closest, not from Arc（图标选择没有 Arc 依据）——
 *     TabSleep = moon.zzz、TidyTabTitles = textformat、DownloadRename = arrow.down.circle（`arrowDown`）、Adaptive = paintpalette、Data = externaldrive（线框）。
 *  C. 组卡：Tabs = SF rectangle.on.rectangle（⛔ SF closest；原 `tabs` 位图 tab__tab@2x.png 本身是实心圆角方块 = “白方块”，Cat 裁定不保留）；
 *     Spaces = `spaces`（Arc 位图遮罩，但轮廓是双卡片剪影，不是方块，保留）；Command = `search`（SF magnifyingglass 矢量，保留）。
 * 没有映射的插件（第三方 / 以后新增）：**不渲染图标容器**（不留空白方块 / 占位）。容器（24×24、圆角 7、--opt-sel）⛔ Arc 没有插件卡片（plugin-icons.md §2），保持现状。 */
export type CardIcon = IconName | "boxOfThings";
export const PLUGIN_CARD_ICON: Readonly<Record<string, CardIcon>> = {
    Adaptive: "paintpalette", CleanUrls: "link", TabSleep: "moonZzz", TidyTabs: "clean", TidyTabTitles: "textformat", DownloadRename: "arrowDown",
    Boosts: "boost", Capture: "cameraRegular", Views: "splitCols", Library: "boxOfThings", Data: "externaldrive",
    Tabs: "rectangleOnRectangle", Spaces: "spaces", Command: "search",
    SessionTransfer: "shareUp", // SF square.and.arrow.up（⛔ SF closest，Arc 没有对应图标；Arc 站点控制「Share」同款字形，已在 icons.ts）
    InpageSidebar: "navSidebar", // Arc icon-browser-navigation-sidebar.svg（vector/Arc_main，导航栏侧栏按钮；⛔ Arc 没有插件卡片，用在这里属 Cat 裁定）
};
export const cardIconOf = (p: Plugin): CardIcon | undefined => PLUGIN_CARD_ICON[p.name];

/** 设置页里可见的插件：同 Void++，hidden（_core / _api）不列出；required 的必需功能列出但没有开关 */
export const listedPlugins = () => Object.values(plugins).filter(p => !p.hidden);

export function filterPlugins(category: PluginCategory, query: string, filter: ListFilter = "all"): Plugin[] {
    const q = query.trim().toLowerCase();
    const pinned = getPinnedPlugins();
    const rank = (n: string) => pinned.includes(n) ? pinned.indexOf(n) : Infinity;
    return listedPlugins()
        .filter(p => pluginMatchesCategory(p, category) && (!q || searchText(p).includes(q)))
        .filter(p => filter === "all" || isPluginEnabled(p.name) === (filter === "enabled"))
        .toSorted((a, b) => rank(a.name) - rank(b.name) || Number(!!b.required) - Number(!!a.required) || label(a).localeCompare(label(b), getLang() === "zh" ? "zh-Hans-CN" : "en"));
}

/* —— 设置页分类栏（Void++ PluginsTab.tsx 134-163：visibleTabs / tabUser / tabRequired）。纯函数：list / isEnabled / starred 可注入，单测不碰全局状态 —— */
/** 设置页卡片的搜索文本：名称 / 描述 / 卡片底部功能标签 / 设置项描述（options.ts 原来内联的那一串，原样搬出来以便单测） */
export const optionsSearchText = (p: Plugin) => `${label(p)} ${tr(p.description ?? "")} ${cardTags(p).join(" ")} ${Object.values(p.settings?.def ?? {}).map(d => tr(d.description)).join(" ")}`.toLowerCase();

/** Void++ 134-137：favorites / all 永远显示，其余分类只有至少一个插件命中才显示（Void++ 的 recent 在 Cat 没有：Plugin 没有 updatedAt，⛔ 不做） */
export const visibleCategoryTabs = (list: readonly Plugin[] = listedPlugins(), starred: readonly string[] = getStarredPlugins()) =>
    PLUGIN_CATEGORY_TABS.filter(t => t.id === "favorites" || t.id === "all"
        || list.some(p => t.id === "favorites" ? starred.includes(p.name) : pluginMatchesCategory(p, t.id)));
/** Void++ 139-163：先按分类、再按「全部 / 已启用 / 已停用」得到该分类的卡片。
 *  all = 可选插件，然后（分隔线之后）必需插件；favorites = 只有收藏；其它分类 = 命中的可选 + 必需合并成一组（没有分隔线）。
 *  搜索（query）叠加在分类 + 筛选的结果上（Void++ 165-166 useFiltered 作用在 tabUser / tabRequired 上）。 */
export function categoryListing(list: readonly Plugin[], category: PluginCategory, filter: ListFilter = "all", query = "",
    isEnabled: (name: string) => boolean = isPluginEnabled, starred: readonly string[] = getStarredPlugins()): { user: Plugin[]; required: Plugin[] } {
    const hit = list.filter(p => (category === "favorites" ? starred.includes(p.name) : pluginMatchesCategory(p, category))
        && (filter === "all" || isEnabled(p.name) === (filter === "enabled")) && (!query || optionsSearchText(p).includes(query.toLowerCase())));
    const user = hit.filter(p => !p.required), required = hit.filter(p => p.required);
    return category === "all" ? { user, required } : { user: [...user, ...required], required: [] };
}

/** 为什么不能切换（Void++：required / isDependency 时 togglePlugin 直接拒绝） */
export function lockReason(p: Plugin): string | null {
    if (p.required) return tr("settings.requiredReason");
    if (!p.isDependency) return null;
    const by = dependentsOf(p.name).map(d => label(d));
    return by.length ? tr("settings.neededBy", by.join(listSep())) : tr("settings.dependedOn");
}

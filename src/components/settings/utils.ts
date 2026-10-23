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

/** 为什么不能切换（Void++：required / isDependency 时 togglePlugin 直接拒绝） */
export function lockReason(p: Plugin): string | null {
    if (p.required) return tr("settings.requiredReason");
    if (!p.isDependency) return null;
    const by = dependentsOf(p.name).map(d => label(d));
    return by.length ? tr("settings.neededBy", by.join(listSep())) : tr("settings.dependedOn");
}

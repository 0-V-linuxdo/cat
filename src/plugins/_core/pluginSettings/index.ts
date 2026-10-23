/*
 * 插件设置（必需）：对应 Void++ plugins/_core/settings + components/settings/tabs/PluginsTab——
 * 设置界面本身也是插件；列表完全由 definePlugin / definePluginSettings 生成（搜索、分类、启用筛选、收藏、开关、设置项）。
 */
import { tr } from "@api/i18n";
import { safe } from "@api/ErrorLog";
import { h } from "@api/dom";
import "@components/ArcTooltip";
import { subscribe } from "@api/Events";
import { toast } from "@api/PanelShell";
import { addOverlay, openOverlay } from "@api/Slots";
import { Dropdown } from "@components/Menu";
import { PluginCard } from "@components/settings/PluginCard";
import { filterPlugins, type ListFilter, PLUGIN_CATEGORY_TABS, type PluginCategory } from "@components/settings/utils";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { definePluginSettings } from "@api/Settings";
import { SettingFields } from "@components/settings/SettingField";

/** 核心设置：界面语言（自动 = 浏览器界面语言以 zh 开头用中文，否则英文） */
export const coreSettings = definePluginSettings({
    language: {
        type: OptionType.SELECT, description: "settings.language",
        options: [{ label: "settings.langAuto", value: "auto", default: true }, { label: "settings.langZh", value: "zh" }, { label: "settings.langEn", value: "en" }],
    },
});

function renderList(box: HTMLElement) {
    const search = h("input", { class: "arc-input", placeholder: tr("settings.searchPlugins"), oninput: () => draw() });
    let category: PluginCategory = "all";
    let state: ListFilter = "all";
    const categoryDd = Dropdown({ options: PLUGIN_CATEGORY_TABS.map(t => ({ label: t.label, value: t.id })), value: category, test: "category", title: tr("settings.category"), onChange: v => { category = v; draw(); } });
    const stateDd = Dropdown<ListFilter>({ options: [{ label: tr("common.all"), value: "all" }, { label: tr("settings.enabled"), value: "enabled" }, { label: tr("settings.disabled"), value: "disabled" }], value: state, test: "state", title: tr("settings.state"), onChange: v => { state = v; draw(); } });
    const list = h("div", { class: "arc-plugin-list" });
    const draw = () => {
        const shown = filterPlugins(category, search.value, state);
        list.replaceChildren(...shown.map(p => PluginCard(p, { onChange: draw, onMessage: toast })), shown.length ? "" : h("div", { class: "arc-hint" }, tr("settings.noMatch")));
    };
    box.append(
        h("div", { class: "arc-row" }, search, h("button", { class: "arc-btn", "data-tip": tr("settings.openFullTitle"), onclick: () => void safe(chrome.runtime.openOptionsPage(), "openOptionsPage") }, tr("settings.full"))),
        h("div", { class: "arc-row" }, categoryDd, stateDd),
        list,
        SettingFields(plugin, toast) ?? "");
    draw();
    search.focus();
    return [subscribe("pluginToggle", draw), subscribe("settingsChange", draw)];
}

const plugin = definePlugin({
    name: "PluginSettings",
    settings: coreSettings,
    authors: [Devs.ArcSidebar],
    label: "common.settings",
    description: "plugin.pluginSettings.desc",
    required: true,
    hidden: true,
    commands: [
        // ⌘, 默认键 Arc 没有（审计 52193 多出项 #7）：默认不绑键，命令保留
        { id: "settings.open", label: "settings.cmdOpen", keywords: ["settings", "plugins", "common.settings"], context: "panel", run: () => openOverlay("settings") },
        { id: "settings.page", label: "settings.cmdOpenFull", keywords: ["options", "settings page", "settings.page"], context: "panel", run: () => void safe(chrome.runtime.openOptionsPage(), "openOptionsPage") },
    ],
    panel: {
        start() {
            return [addOverlay("settings", "PluginSettings", { title: tr("settings.overlayTitle"), render: renderList })];
        },
    },
});
export default plugin;

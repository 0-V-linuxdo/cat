/*
 * 对应 Void++ src/components/settings/PluginCard.tsx + pluginBadges：一张插件卡片 = 开关 + 名称 + 徽标（新 / 依赖 / 需重载）+ 收藏 + 描述 + 设置项。
 * 侧边栏设置浮层使用；完整设置页用同一套数据（PluginCard 的行版本）。
 */
import { listSep, tr } from "@api/i18n";
import { h } from "@api/dom";
import "@components/ArcTooltip";
import { icon } from "@api/icons";
import { isNewPlugin, isPluginEnabled, plugins, requestPluginPermissions, togglePlugin } from "@api/PluginManager";
import { isPluginStarred, togglePluginStarred } from "@api/Settings";
import type { Plugin } from "@utils/types";

import { SettingFields } from "./SettingField";
import { label, lockReason } from "./utils";

export interface CardCallbacks { onChange(): void; onMessage(msg: string): void }

export function PluginBadges(p: Plugin) {
    return [
        p.required ? h("small", { class: "arc-badge arc-badge-required", "data-tip": tr("settings.requiredReason") }, tr("settings.required")) : null,
        isNewPlugin(p.name) ? h("small", { class: "arc-badge arc-badge-new" }, tr("settings.new")) : null,
        p.requiresRestart ? h("small", { class: "arc-badge" }, tr("settings.needsReload")) : null,
    ];
}

export function toggleWithFeedback(p: Plugin, cb: CardCallbacks): Promise<void> {
    // 打开带可选权限的插件：在点击的同步栈里先申请；被拒绝 → 开关回滚
    if (!isPluginEnabled(p.name) && p.optionalPermissions?.["*"]?.length) {
        return requestPluginPermissions(p.name, "*").then((ok): Promise<void> | void => { if (!ok) { cb.onMessage(tr("settings.permissionDenied")); cb.onChange(); return; } return toggleWithFeedback({ ...p, optionalPermissions: undefined } as Plugin, cb); });
    }
    return togglePlugin(p.name).then(r => {
        if (r === null) cb.onMessage(lockReason(p) ?? tr("settings.cannotToggle"));
        else if (r) cb.onMessage(tr("settings.reloadFully"));
        cb.onChange();
    });
}

export function PluginCard(p: Plugin, cb: CardCallbacks) {
    const on = isPluginEnabled(p.name);
    const lock = lockReason(p);
    const starred = isPluginStarred(p.name);
    return h("div", { class: `arc-plugin${on ? " on" : ""}`, "data-name": p.name },
        h("div", { class: "arc-plugin-head" },
            p.required ? null : h("input", { type: "checkbox", checked: on, disabled: !!lock, "data-tip": lock ?? "", onchange: () => void toggleWithFeedback(p, cb) }),
            h("b", null, label(p)), ...PluginBadges(p),
            h("button", { class: `arc-icon-btn arc-star${starred ? " on" : ""}`, "data-tip": starred ? tr("settings.unstar") : tr("common.favorites"), "data-star": p.name, onclick: () => { togglePluginStarred(p.name); cb.onChange(); } }, icon("star"))),
        h("div", { class: "arc-plugin-desc" }, tr(p.description ?? ""), p.dependencies?.length ? h("span", null, tr("settings.depsList", p.dependencies.map(d => label(plugins[d], d)).join(listSep()))) : null),
        on ? SettingFields(p, cb.onMessage) : null);
}

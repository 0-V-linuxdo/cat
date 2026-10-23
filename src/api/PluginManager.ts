/*
 * 插件管理器：照 Void++ src/api/PluginManager.ts 实现——
 *   registerPlugin（回填 settings.pluginName）、isPluginEnabled（required / isDependency 恒为启用，chrome 插件按环境）、
 *   togglePlugin（required / isDependency 不可切换）、startPlugin（递归启动依赖 + 循环检测 + markAsEnabledDependency）、
 *   stopPlugin（统一退订、移除 managedStyle / cleanupSelectors）、startAllPlugins(StartAt)、
 *   initPluginManager（清理孤立设置、登记新插件、标记依赖与所需 _api 插件）、isNewPlugin、onSettingsChange（前缀监听）。
 * 扩展特有：每个上下文（background / panel / content / page / options）各跑一份；生命周期取 plugin[context]；
 * Void++ 的 patches / zustand / chatBarButton 在扩展里没有对应物，换成 commands 与 contextMenuItems。
 */
import { safe } from "@api/ErrorLog";
import { flog } from "@api/FocusLog";
import { addCommand, removeCommand } from "@api/Commands";
import { addContextMenuItem, type MenuLocation, removeContextMenuItems } from "@api/ContextMenus";
import { disableStyle, enableStyle } from "@api/dom";
import { Logger } from "@utils/Logger";
import { type ContextHooks, type Plugin, StartAt } from "@utils/types";

import { getContext } from "./context";
import { type ArcEvent, dispatch, subscribe as subscribeEvent } from "./Events";
import { getSettingsPluginData, mergePluginSettings, onExternalSettingsChange, PlainSettings, pluginPath, Settings, SettingsStore, updateSettingsPluginData } from "./Settings";

const logger = new Logger("PluginManager", "#b4befe");

export const plugins: Record<string, Plugin> = {};
const pluginUnsubscribers = new Map<string, Array<() => void>>();
let initialized = false;

const hooksOf = (p: Plugin): ContextHooks | undefined => p[getContext()];
const canWriteSettings = () => getContext() !== "content" && getContext() !== "page";

function runUnsubs(pluginName: string) {
    for (const unsub of pluginUnsubscribers.get(pluginName) ?? []) {
        try { unsub(); } catch (e) { logger.error(`Unsub error in ${pluginName}:`, e); }
    }
    pluginUnsubscribers.delete(pluginName);
}

function markAsEnabledDependency(plugin: Plugin) {
    if (canWriteSettings() && !plugin.required) {
        if (plugin.parent) { if (PlainSettings.plugins[plugin.parent]?.[plugin.name] !== true) mergePluginSettings(plugin.parent, { [plugin.name]: true }); }
        else if (PlainSettings.plugins[plugin.name]?.enabled !== true) mergePluginSettings(plugin.name, { enabled: true });
    }
    plugin.isDependency = true;
}

/** 插件内某个功能的开关（存放在所属插件的设置里；必需功能没有开关） */
export function isFeatureOn(feature: Plugin): boolean {
    if (!feature.parent || feature.required) return true;
    const v = (Settings.plugins[feature.parent] as Record<string, unknown> | undefined)?.[feature.name];
    return v === undefined ? feature.enabledByDefault ?? true : !!v;
}

export function isPluginEnabled(pluginName: string): boolean {
    const plugin = plugins[pluginName];
    if (!plugin) return false;
    if (plugin.chrome && typeof chrome === "undefined") return false;
    if (plugin.parent) return isPluginEnabled(plugin.parent) && (plugin.isDependency || isFeatureOn(plugin));
    if (plugin.required || plugin.isDependency) return true;
    return (Settings.plugins[pluginName]?.enabled as boolean | undefined) ?? plugin.enabledByDefault ?? false;
}

/** 当前启用、且依赖了 name 的插件（用于界面提示为何不能关闭） */
export const dependentsOf = (name: string) => Object.values(plugins).filter(p => p.name !== name && depsOf(p).includes(name) && isPluginEnabled(p.name));

/** 声明的依赖 + 隐式 API 依赖（Void++ initPluginManager 的 neededApis：用到 commands 就需要 CommandsAPI） */
const depsOf = (p: Plugin) => p.commands?.length && plugins.CommandsAPI && p.name !== "CommandsAPI" ? [...p.dependencies ?? [], "CommandsAPI"] : p.dependencies ?? [];

function refreshDependencyMarks() {
    for (const p of Object.values(plugins)) if (!p.required) p.isDependency = false;
    let changed = true;
    while (changed) {
        changed = false;
        for (const p of Object.values(plugins)) {
            if (!isPluginEnabled(p.name)) continue;
            for (const d of depsOf(p)) {
                const dep = plugins[d];
                if (dep && !dep.isDependency && !dep.required) { dep.isDependency = true; changed = true; }
            }
        }
    }
}

/** 返回值同 Void++：是否需要重新加载才能完全生效；不可切换时返回 null */
/** 所有标了 sensitive: true 的设置项 [插件名, 键]（功能的设置已并入所属插件的 def） */
export function sensitiveSettingKeys(): [string, string][] {
    const out: [string, string][] = [];
    for (const p of Object.values(plugins)) {
        if (!p.settings || p.parent) continue;
        for (const [k, d] of Object.entries(p.settings.def ?? {})) if ((d as { sensitive?: boolean }).sensitive) out.push([p.name, k]);
    }
    return out;
}

/** 申请插件声明的可选权限（key = "*" 或设置项名）。必须在用户点击的同一同步调用栈里调用（权限申请需要用户手势）；没有声明则直接 true */
export function requestPluginPermissions(name: string, key: string): Promise<boolean> {
    const perms = plugins[name]?.optionalPermissions?.[key];
    if (!perms?.length || typeof chrome === "undefined" || !chrome.permissions?.request) return Promise.resolve(true);
    return safe(chrome.permissions.request({ permissions: perms }), "permissions.request", false);
}
/** 关闭开关 / 停用插件时移除权限（其它已启用插件仍声明同一权限则保留） */
export async function releasePluginPermissions(name: string, key?: string) {
    const own = plugins[name]?.optionalPermissions; if (!own || !chrome.permissions?.remove) return;
    const keys = key ? [key] : Object.keys(own);
    const mine = new Set(keys.flatMap(k => own[k] ?? []));
    for (const p of Object.values(plugins)) {
        if (p.name === name || !isPluginEnabled(p.name) || !p.optionalPermissions) continue;
        for (const v of Object.values(p.optionalPermissions)) for (const x of v) mine.delete(x);
    }
    if (mine.size) await safe(chrome.permissions.remove({ permissions: [...mine] }), "permissions.remove", false);
}

export async function togglePlugin(name: string, enable = !isPluginEnabled(name)): Promise<boolean | null> {
    const plugin = plugins[name];
    if (!plugin || plugin.required || plugin.isDependency || plugin.parent) return null;
    if (enable === isPluginEnabled(name)) return false;
    mergePluginSettings(name, { enabled: enable });
    await reconcile();
    if (!enable) void releasePluginPermissions(name);
    dispatch("pluginToggle", { name, enabled: enable });
    return !!plugin.requiresRestart;
}

/** 打开 / 关闭插件或插件内的功能（功能的开关存在所属插件的设置里） */
export async function setPluginOrFeature(name: string, enable: boolean) {
    const plugin = plugins[name];
    if (!plugin) return;
    if (!plugin.parent) { await togglePlugin(name, enable); return; }
    if (enable && !isPluginEnabled(plugin.parent)) await togglePlugin(plugin.parent, true);
    mergePluginSettings(plugin.parent, { [name]: enable });
    await reconcile();
    dispatch("pluginToggle", { name, enabled: enable });
}

async function startDependenciesRecursive(plugin: Plugin, visiting = new Set<string>()): Promise<boolean> {
    for (const depName of depsOf(plugin)) {
        const dep = plugins[depName];
        if (!dep) {
            logger.warn(`Missing dependency ${depName} for ${plugin.name}`);
            return false;
        }
        if (dep.started) continue;
        if (visiting.has(depName)) {
            logger.error(`Circular dependency detected: ${plugin.name} -> ${depName}`);
            return false;
        }
        markAsEnabledDependency(dep);
        visiting.add(depName);
        if (!await startDependenciesRecursive(dep, visiting)) return false;
        if (!await startPlugin(dep)) return false;
    }
    return true;
}

function ensureMethodsBound(plugin: Plugin) {
    for (const key of Object.keys(plugin)) {
        const val = (plugin as unknown as Record<string, unknown>)[key];
        if (typeof val === "function" && !(val as { $$arcBound?: boolean }).$$arcBound) {
            const bound = val.bind(plugin);
            (bound as { $$arcBound?: boolean }).$$arcBound = true;
            (plugin as unknown as Record<string, unknown>)[key] = bound;
        }
    }
}

const starting = new Map<string, Promise<boolean>>();
export function startPlugin(plugin: Plugin, silent = false): Promise<boolean> {
    if (plugin.started) return Promise.resolve(true);
    let p = starting.get(plugin.name);
    if (!p) {
        p = startPluginInner(plugin, silent).finally(() => starting.delete(plugin.name));
        starting.set(plugin.name, p);
    }
    return p;
}
async function startPluginInner(plugin: Plugin, silent: boolean): Promise<boolean> {
    const unsubs: Array<() => void> = [];
    try {
        if (!await startDependenciesRecursive(plugin)) {
            logger.error(`Failed to start dependencies for ${plugin.name}`); flog(getContext() === "background" ? "bg" : "panel", `plugin deps FAILED ${plugin.name}`);
            return false;
        }
        ensureMethodsBound(plugin);
        const hooks = hooksOf(plugin);
        pluginUnsubscribers.set(plugin.name, unsubs);
        if (hooks?.managedStyle && getContext() !== "background") enableStyle(`plugin:${plugin.name}`, hooks.managedStyle);
        for (const c of plugin.commands ?? []) { addCommand(plugin.name, c); unsubs.push(() => removeCommand(c.id)); }
        if (getContext() === "panel" && plugin.contextMenuItems) {
            for (const [loc, items] of Object.entries(plugin.contextMenuItems) as [MenuLocation, NonNullable<Plugin["contextMenuItems"]>[MenuLocation]][]) {
                for (const it of items ?? []) addContextMenuItem(loc, plugin.name, it);
                unsubs.push(() => removeContextMenuItems(loc, plugin.name));
            }
        }
        for (const [event, handler] of Object.entries(hooks?.events ?? {})) {
            if (handler) unsubs.push(subscribeEvent(event as ArcEvent, handler as (d: unknown) => void));
        }
        /* 51999 验收 HIGH：onSettingsChange 原来在所有上下文都注册，Themes 的 apply() 在后台 SW 里访问 document → ReferenceError。
         * 只在插件声明了本上下文钩子（或根本没有按上下文区分的钩子）时注册；没有 document 的上下文里另包一层防护。 */
        const CTX_KEYS = ["background", "panel", "content", "page", "options"] as const;
        const hasCtxHooks = CTX_KEYS.some(k => (plugin as unknown as Record<string, unknown>)[k]);
        if (plugin.onSettingsChange && (hooks || !hasCtxHooks)) {
            const prefix = pluginPath(plugin.parent ?? plugin.name);
            const listener = (path: string) => {
                if (path === prefix && !plugin.started) return;
                try { plugin.onSettingsChange!(); }
                catch (e) { if (typeof document === "undefined" && e instanceof ReferenceError) logger.warn(`${plugin.name}.onSettingsChange 访问了 DOM（无 document 上下文，已忽略）`); else throw e; }
            };
            SettingsStore.addPrefixChangeListener(prefix, listener);
            unsubs.push(() => SettingsStore.removePrefixChangeListener(prefix, listener));
        }
        plugin.started = true;
        if (!plugin.hidden && !silent) logger.debug(`Starting plugin ${plugin.name}`);
        const cleanup = await hooks?.start?.();
        if (typeof cleanup === "function") unsubs.push(cleanup);
        else if (Array.isArray(cleanup)) unsubs.push(...cleanup);
        return true;
    } catch (e) {
        logger.error(`Failed to start ${plugin.name}`, e); flog(getContext() === "background" ? "bg" : "panel", `plugin start FAILED ${plugin.name} ${String((e as Error)?.message ?? e)}`);
        plugin.started = false;
        runUnsubs(plugin.name);
        if (hooksOf(plugin)?.managedStyle) disableStyle(`plugin:${plugin.name}`);
        return false;
    }
}


export function stopPlugin(plugin: Plugin): boolean {
    if (!plugin.started) return true;
    try { hooksOf(plugin)?.stop?.(); } catch (e) { logger.error(`Error in ${plugin.name}.stop():`, e); }
    runUnsubs(plugin.name);
    if (hooksOf(plugin)?.managedStyle) disableStyle(`plugin:${plugin.name}`);
    if (plugin.cleanupSelectors && typeof document !== "undefined") for (const s of plugin.cleanupSelectors) for (const el of document.querySelectorAll(s)) el.remove();
    plugin.started = false;
    return true;
}

/** 让运行状态与开关一致（其他上下文改了设置后调用） */
async function reconcile() {
    refreshDependencyMarks();
    for (const p of Object.values(plugins).toReversed()) if (p.started && !isPluginEnabled(p.name)) stopPlugin(p);
    for (const p of Object.values(plugins)) if (!p.started && reachedTargets.has(p.startAt ?? StartAt.Init) && isPluginEnabled(p.name)) await startPlugin(p, true);
}
const reachedTargets = new Set<StartAt>();

export async function startAllPlugins(target: StartAt = StartAt.Init): Promise<void> {
    reachedTargets.add(target);
    for (const [name, plugin] of Object.entries(plugins)) {
        if (!isPluginEnabled(name)) continue;
        if ((plugin.startAt ?? StartAt.Init) !== target) continue;
        try { await startPlugin(plugin); } catch (e) { logger.error(`Unexpected error starting ${name}:`, e); }
    }
}

let reconcileQueued = false;
const queueReconcile = () => {
    if (reconcileQueued || !initialized) return;
    reconcileQueued = true;
    queueMicrotask(() => { reconcileQueued = false; void reconcile(); });
};

export function registerPlugin(plugin: Plugin) {
    if (plugins[plugin.name]) return;
    plugins[plugin.name] = plugin;
    plugin.started = false;
    for (const f of (plugin.features ?? []) as Plugin[]) {
        f.parent = plugin.name;
        f.hidden = true;
        registerPlugin(f);
    }
    if (plugin.settings && !plugin.parent) plugin.settings.pluginName = plugin.name;
    /* 功能开关是插件的设置项：本上下文改了就立即启停对应功能 */
    if (plugin.features?.length) SettingsStore.addPrefixChangeListener(pluginPath(plugin.name), queueReconcile);
}

const NEW_PLUGIN_TTL = 2 * 24 * 60 * 60 * 1000;

export function isNewPlugin(name: string): boolean {
    const seen = getSettingsPluginData().knownPlugins?.[name];
    return seen != null && Date.now() - seen < NEW_PLUGIN_TTL;
}

function trackNewPlugins() {
    const known = { ...getSettingsPluginData().knownPlugins };
    const fresh = Object.keys(plugins).filter(n => !plugins[n].hidden && !plugins[n].required && !(n in known));
    if (!fresh.length) return;
    const first = !Object.keys(known).length;
    for (const n of fresh) known[n] = first ? 0 : Date.now();
    updateSettingsPluginData({ knownPlugins: known });
}

function pruneOrphanedPluginSettings() {
    const stored = PlainSettings.plugins;
    const orphaned = Object.keys(stored).filter(name => !plugins[name] && name !== "Settings");
    for (const name of orphaned) {
        logger.info(`Pruning settings for removed plugin: ${name}`);
        delete stored[name];
    }
    if (orphaned.length) SettingsStore.markAsChanged();
}

/**
 * 迁移：功能曾经是独立插件（Settings.plugins[功能] = { enabled, ...设置 }），
 * 现在功能开关与设置都存放在所属插件里（Settings.plugins[插件][功能] / [设置键]）。
 */
function migrateFeaturesIntoPlugins() {
    const stored = PlainSettings.plugins;
    let changed = false;
    for (const f of Object.values(plugins)) {
        const bag = f.parent ? stored[f.name] : undefined;
        if (!bag || !f.parent) continue;
        const group = (stored[f.parent] ??= {});
        for (const [k, v] of Object.entries(bag)) {
            if (k === "enabled") { if (!f.required && !(f.name in group) && typeof v === "boolean") group[f.name] = v; }
            else if (!(k in group)) group[k] = v;
        }
        delete stored[f.name];
        changed = true;
    }
    if (changed) { logger.info("Migrated feature settings into their plugins"); SettingsStore.markAsChanged(); }
}

export function initPluginManager() {
    if (initialized) return;
    initialized = true;

    if (getContext() === "background") {
        migrateFeaturesIntoPlugins();
        pruneOrphanedPluginSettings();
        trackNewPlugins();
    }

    for (const [name, plugin] of Object.entries(plugins)) {
        if (!isPluginEnabled(name)) continue;
        for (const d of depsOf(plugin)) {
            const dep = plugins[d];
            if (dep) markAsEnabledDependency(dep);
            else logger.warn(`Plugin ${name} has unresolved dependency ${d}`);
        }
    }
    refreshDependencyMarks();

    onExternalSettingsChange(async changed => {
        await reconcile();
        for (const name of changed) if (plugins[name] || name === "Settings") dispatch("settingsChange", { plugin: name });
        dispatch("refresh");
    });
}

/*
 * 设置 API：对应 Void++ src/api/Settings.ts。
 * Settings.plugins[name].{enabled, ...}；definePluginSettings(def, checks)；插件注册时回填 pluginName 并登记默认值；
 * Settings.plugins.Settings 存放设置页自身数据（knownPlugins / pinnedPlugins / starredPlugins）；
 * migratePluginSettings / migratePluginSetting 用于改名迁移。
 * 存储：chrome.storage.local 键 ArcSidebarSettings，所有上下文共享，storage.onChanged 实时同步。
 */
import { Logger } from "@utils/Logger";
import { SettingsStore as SettingsStoreClass, STORAGE_KEY } from "@utils/SettingsStore";
import { type DefinedSettings, OptionType, type PluginSettingDef, type PluginSettingValue, type SettingsChecks, type SettingsDefinition } from "@utils/types";

export { STORAGE_KEY as SETTINGS_KEY };

const logger = new Logger("Settings");

export interface Settings {
    plugins: {
        [plugin: string]: {
            enabled?: boolean;
            [setting: string]: unknown;
        };
    };
}

const settings: Settings = { plugins: {} };

export const SettingsStore = new SettingsStoreClass(settings);
export const PlainSettings = settings;
export const Settings = SettingsStore.store;

export const pluginPath = (name: string, key?: string) => key ? `plugins.${name}.${key}` : `plugins.${name}`;

const externalHooks = new Set<(changedPlugins: Set<string>) => void>();
export const onExternalSettingsChange = (h: (changed: Set<string>) => void) => { externalHooks.add(h); return () => externalHooks.delete(h); };

export async function initSettings(): Promise<void> {
    const got = await chrome.storage.local.get(STORAGE_KEY);
    const saved = got[STORAGE_KEY] as Settings | undefined;
    if (saved?.plugins) settings.plugins = saved.plugins;
    SettingsStore.markReady();
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== "local" || !changes[STORAGE_KEY]) return;
        const next = (changes[STORAGE_KEY].newValue as Settings | undefined)?.plugins ?? {};
        const changed = new Set<string>();
        for (const n of new Set([...Object.keys(next), ...Object.keys(settings.plugins)])) {
            if (SettingsStore.isDirty(pluginPath(n))) continue; // 本地有更新的未保存修改：不让旧的外部值把它改回去
            if (JSON.stringify(next[n]) !== JSON.stringify(settings.plugins[n])) changed.add(n);
        }
        if (!changed.size) return;
        for (const n of changed) SettingsStore.applyExternal(pluginPath(n), next[n]);
        for (const h of externalHooks) h(changed);
    });
}

export function migratePluginSettings(name: string, ...oldNames: string[]) {
    const { plugins } = SettingsStore.plain;
    if (name in plugins) return;
    for (const oldName of oldNames) {
        if (!(oldName in plugins)) continue;
        logger.info(`Migrating settings from old name ${oldName} to ${name}`);
        plugins[name] = plugins[oldName];
        delete plugins[oldName];
        SettingsStore.markAsChanged();
        break;
    }
}

export function migratePluginSetting(pluginName: string, newKey: string, oldKey: string) {
    const pluginSettings = SettingsStore.plain.plugins[pluginName];
    if (!pluginSettings || !(oldKey in pluginSettings) || newKey in pluginSettings) return;
    logger.info(`Migrating setting ${oldKey} -> ${newKey} in ${pluginName}`);
    pluginSettings[newKey] = pluginSettings[oldKey];
    delete pluginSettings[oldKey];
    SettingsStore.markAsChanged();
}

/** 删除已下线功能留下的设置项（例如 PlusMenu.noteUrl） */
export function removePluginSetting(pluginName: string, key: string) {
    const pluginSettings = SettingsStore.plain.plugins[pluginName];
    if (!pluginSettings || !(key in pluginSettings)) return;
    delete pluginSettings[key];
    SettingsStore.markAsChanged();
}

export interface SettingsPluginData {
    knownPlugins?: Record<string, number>;
    pinnedPlugins?: string[];
    starredPlugins?: string[];
    [key: string]: unknown;
}

export function getSettingsPluginData(): SettingsPluginData {
    return (Settings.plugins.Settings as SettingsPluginData) ?? {};
}

export function updateSettingsPluginData(patch: Partial<SettingsPluginData>) {
    Settings.plugins.Settings = { ...(PlainSettings.plugins.Settings ?? { enabled: true }), ...patch };
}

const toggleIn = (key: "pinnedPlugins" | "starredPlugins", name: string) => {
    const current = getSettingsPluginData()[key] ?? [];
    const has = current.includes(name);
    updateSettingsPluginData({ [key]: has ? current.filter(n => n !== name) : [name, ...current] });
    return !has;
};

export const getPinnedPlugins = () => getSettingsPluginData().pinnedPlugins ?? [];
export const isPluginPinned = (name: string) => getPinnedPlugins().includes(name);
export const togglePluginPinned = (name: string) => toggleIn("pinnedPlugins", name);
export const getStarredPlugins = () => getSettingsPluginData().starredPlugins ?? [];
export const isPluginStarred = (name: string) => getStarredPlugins().includes(name);
export const togglePluginStarred = (name: string) => toggleIn("starredPlugins", name);

export function getPluginSettings(name: string) {
    return Settings.plugins[name] ?? {};
}

export function mergePluginSettings(name: string, patch: Record<string, unknown>) {
    Settings.plugins[name] = { ...(PlainSettings.plugins[name] ?? { enabled: false }), ...patch };
}

/** 恢复默认：只保留 enabled，删除其余键即回到声明的默认值 */
export function resetPluginSettings(name: string) {
    const cur = PlainSettings.plugins[name] ?? {};
    Settings.plugins[name] = "enabled" in cur ? { enabled: cur.enabled } : {};
}

export function resolveDefault(setting: PluginSettingDef): PluginSettingValue | undefined {
    if ("default" in setting) return setting.default as PluginSettingValue;
    if (setting.type === OptionType.SELECT) return setting.options.find(o => o.default)?.value ?? setting.options[0]?.value;
    return undefined;
}

export function definePluginSettings<Def extends SettingsDefinition, Checks extends SettingsChecks<Def>, PrivateSettings extends object = {}>(def: Def, checks?: Checks) {
    let boundName = "";

    type Store = DefinedSettings<Def, Checks, PrivateSettings>["store"];

    const definedSettings: DefinedSettings<Def, Checks, PrivateSettings> = {
        get store() {
            if (!boundName) throw new Error("Cannot access settings before plugin is initialized");
            if (!PlainSettings.plugins[boundName]) PlainSettings.plugins[boundName] = {};
            return Settings.plugins[boundName] as unknown as Store;
        },
        get plain() {
            if (!boundName) throw new Error("Cannot access settings before plugin is initialized");
            return (PlainSettings.plugins[boundName] ?? {}) as unknown as Store;
        },
        def,
        checks: (checks ?? {}) as Checks,
        get pluginName() {
            return boundName;
        },
        set pluginName(name: string) {
            boundName = name;
            if (!name) return;
            SettingsStore.setDefaultGetter(pluginPath(name), key => {
                const setting = def[key];
                return setting ? resolveDefault(setting) : undefined;
            });
        },
        use(listener, keys) {
            const prefix = pluginPath(boundName);
            const watched = keys?.map(k => `${prefix}.${String(k)}`);
            const l = watched?.length
                ? (path: string) => { if (watched.some(p => path.startsWith(p) || p.startsWith(`${path}.`) || path === prefix)) listener(path); }
                : listener;
            SettingsStore.addPrefixChangeListener(prefix, l);
            return () => SettingsStore.removePrefixChangeListener(prefix, l);
        },
        withPrivateSettings<T extends object>() {
            return this as unknown as DefinedSettings<Def, Checks, T>;
        },
    };

    return definedSettings;
}

/**
 * 插件内部功能 → 插件的设置项（同 Void++：一个插件 = 一个开关 + 一组设置）。
 * 每个可选功能变成一个 BOOLEAN 开关（键 = 功能名，默认取 enabledByDefault），紧跟它自己的设置项；
 * 必需功能（required: true）没有开关，只列出它的设置项。功能代码里原来的 settings 对象改为读写本插件的设置。
 */
export function featureSettings(features: (import("@utils/types").PluginDef & { settings?: DefinedSettings<any> })[], own: SettingsDefinition = {}) {
    const def: SettingsDefinition = { ...own };
    const checks: Record<string, { disabled?(): boolean; isValid?(v: unknown): unknown }> = {};
    const toggles = new Map<string, string>();
    for (const f of features) {
        const name = f.label ?? f.name;
        if (!f.required) {
            def[f.name] = { type: OptionType.BOOLEAN, default: f.enabledByDefault ?? true, description: f.description, feature: name, featureToggle: true } as PluginSettingDef;
            for (const dep of f.dependencies ?? []) {
                const d = features.find(x => x.name === dep);
                if (d && !d.required) checks[f.name] = { disabled: () => !(Settings.plugins[ds.pluginName]?.[dep] ?? d.enabledByDefault ?? true) };
            }
        }
        for (const [k, d] of Object.entries((f.settings?.def ?? {}) as SettingsDefinition)) {
            if (k in def) throw new Error(`Setting ${k} of ${f.name} clashes in plugin settings`);
            def[k] = { ...d, feature: name, ...(f.required ? {} : { parent: f.name }) } as PluginSettingDef;
            const own = (f.settings?.checks as Record<string, typeof checks[string]> | undefined)?.[k];
            if (own) checks[k] = { ...own };
            if (!f.required) toggles.set(k, f.name);
        }
    }
    for (const [k, feature] of toggles) {
        const prev = checks[k]?.disabled;
        checks[k] = { ...checks[k], disabled() { return !ds.store[feature] || !!prev?.call(this); } };
    }
    const ds = definePluginSettings(def, checks as never);
    /* 功能内部的 settings 对象改为指向本插件（pluginName 先绑定，插件注册时再绑定一次以覆盖默认值 getter） */
    const share = (f: { settings?: DefinedSettings<any> }) => {
        const fs = f.settings;
        if (!fs) return;
        Object.defineProperty(fs, "store", { get: () => ds.store });
        Object.defineProperty(fs, "plain", { get: () => ds.plain });
        Object.defineProperty(fs, "pluginName", { get: () => ds.pluginName, set: () => { } });
    };
    features.forEach(share);
    return ds;
}

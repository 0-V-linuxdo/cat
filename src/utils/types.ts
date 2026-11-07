/*
 * 插件类型：照搬 Void++ src/utils/types.ts（definePlugin / PluginDef / Plugin / OptionType / DefinedSettings）。
 * 扩展特有：Void++ 只有一个页面上下文（start / stop / managedStyle / events / patches），
 * 扩展有 background / panel / content / page / options 五个上下文，所以这些生命周期字段按上下文分组到 ContextHooks。
 */
import type { CommandDef } from "@api/Commands";
import type { MenuItemDef, MenuLocation } from "@api/ContextMenus";
import type { ArcEvent, ArcEventMap } from "@api/Events";
import type { IconName } from "@api/icons";

export default function definePlugin<P extends PluginDef>(p: P & Record<PropertyKey, any>) {
    return p as typeof p & Plugin;
}

export type ExtContext = "background" | "panel" | "content" | "page" | "options";

export type Cleanup = void | (() => void) | Array<() => void>;

/** 与 Void++ PluginTag 相同用途：设置页按标签分类（原来的 6 个插件组变成 6 个标签） */
export type PluginTag = "tabs" | "spaces" | "command" | "views" | "library" | "data" | "adaptive";

export type PluginSettingValue = string | number | bigint | boolean | undefined;

export interface ContextHooks {
    start?(): Cleanup | Promise<Cleanup>;
    stop?(): void;
    events?: { [K in ArcEvent]?: (data: ArcEventMap[K]) => void };
    managedStyle?: string;
}

export interface Plugin extends PluginDef {
    started: boolean;
    isDependency?: boolean;
}

export interface PluginDef {
    name: string;
    description: string;
    authors: string[];
    icon?: IconName;
    /** 中文显示名（Void++ 直接显示 name；这里界面是中文） */
    label?: string;
    chrome?: boolean;
    dependencies?: string[];
    required?: boolean;
    hidden?: boolean;
    dev?: boolean;
    enabledByDefault?: boolean;
    requiresRestart?: boolean;
    /** 插件自带文案：注册插件时（所有上下文、无论是否启用）经 registerLocale 合并，设置页就能显示名称 / 说明 */
    /** 可选权限：键为设置项名（BOOLEAN 子开关）或 "*"（插件本身），值为启用时要申请的权限（manifest optional_permissions 里必须有） */
    optionalPermissions?: Record<string, chrome.runtime.ManifestPermissions[]>;
    startAt?: StartAt;
    settings?: DefinedSettings;
    tags?: PluginTag[];
    updatedAt?: number;
    commands?: CommandDef[];
    contextMenuItems?: { [L in MenuLocation]?: MenuItemDef[] };
    cleanupSelectors?: string[];
    onSettingsChange?(): void;
    background?: ContextHooks;
    panel?: ContextHooks;
    content?: ContextHooks;
    page?: ContextHooks;
    options?: ContextHooks;
    /**
     * 插件内部的功能（不是插件）：每个功能的开关与设置都是本插件的设置项（见 featureSettings）。
     * 功能上 required: true 表示必需功能——始终运行，不出现开关。
     */
    features?: PluginDef[];
    /**
     * 插件卡片底部的功能标签（i18n 键，每个至少一个，取自插件实际提供的功能）。给没有 features 的单功能 / 小插件用；
     * 有 features 的插件卡片底部用 features 的名称（见 cardTags）。绝不回落成作者名。
     */
    featureTags?: string[];
    /** 由 PluginManager 回填：功能所属的插件 */
    parent?: string;
}

export const enum StartAt {
    Init = "Init",
    DOMContentLoaded = "DOMContentLoaded",
}

export const enum OptionType {
    STRING,
    NUMBER,
    BIGINT,
    BOOLEAN,
    SELECT,
    SLIDER,
    COMPONENT,
    CUSTOM,
}

export type SettingsDefinition = Record<string, PluginSettingDef>;

export type SettingsChecks<D extends SettingsDefinition> = {
    [K in keyof D]?: D[K] extends PluginSettingComponentDef ? IsDisabled<DefinedSettings<D>> : IsDisabled<DefinedSettings<D>> & IsValid<PluginSettingType<D[K]>, DefinedSettings<D>>;
};

export type PluginSettingDef =
    | (PluginSettingCustomDef & Partial<PluginSettingCommon>)
    | (PluginSettingComponentDef & Omit<PluginSettingCommon, "description" | "placeholder"> & Partial<Pick<PluginSettingCommon, "description" | "placeholder">>)
    | ((PluginSettingStringDef | PluginSettingNumberDef | PluginSettingBooleanDef | PluginSettingSelectDef | PluginSettingSliderDef | PluginSettingBigIntDef) & PluginSettingCommon);

export interface PluginSettingCommon {
    /** 文本键（显示时经 tr() 翻译） */
    description: string;
    /** featureSettings 填写：所属功能的名称键，显示为前缀 */
    feature?: string;
    /** featureSettings 填写：这是功能开关 */
    featureToggle?: boolean;
    /** featureSettings 填写：所属可选功能的开关键；设置页把本项缩进到开关下，开关关闭时隐藏 */
    parent?: string;
    /** 详细说明（文本键）：设置行不显示，悬停设置行文字时用项目的 ArcTooltip 显示——第一行 = 提示标题，其余行合成副标题（单行省略，所以每行都要短）。行内的 description 只放一句话 */
    detail?: string;
    placeholder?: string;
    /** 敏感值（API 密钥等）：设置页渲染为密码框；Data 插件的导出 / 备份跳过，导入时保留现有值 */
    sensitive?: boolean;
    onChange?(newValue: PluginSettingValue): void;
    restartNeeded?: boolean;
    componentProps?: Record<string, unknown>;
    hidden?: boolean;
}

interface IsDisabled<D = unknown> {
    disabled?(this: D): boolean;
}

interface IsValid<T, D = unknown> {
    isValid?(this: D, value: T): boolean | string;
}

export interface PluginSettingStringDef {
    type: OptionType.STRING;
    default?: string;
    multiline?: boolean;
}

export interface PluginSettingNumberDef {
    type: OptionType.NUMBER;
    default?: number;
    min?: number;
    max?: number;
}

export interface PluginSettingBigIntDef {
    type: OptionType.BIGINT;
    default?: bigint;
}

export interface PluginSettingBooleanDef {
    type: OptionType.BOOLEAN;
    default?: boolean;
}

export interface PluginSettingSelectDef {
    type: OptionType.SELECT;
    options: readonly PluginSettingSelectOption[];
}

export interface PluginSettingSelectOption {
    label: string;
    /** 补丁 inpage-settings-copy-fix：可选的「按钮短标签」（i18n 键）。下拉按钮是单行省略号、控件列只有 160–200px，整句长文案会被截成 "Window: Chrome panel ..."；
     *  给了 short 就让**按钮文字**用它，菜单项与悬停提示（data-tip）仍是完整 label。没给 = 与以前完全一致。 */
    short?: string;
    value: string | number | boolean;
    default?: boolean;
}

export interface PluginSettingCustomDef {
    type: OptionType.CUSTOM;
    default?: unknown;
}

export interface PluginSettingSliderDef {
    type: OptionType.SLIDER;
    min: number;
    max: number;
    default: number;
}

export interface IPluginOptionComponentProps {
    setValue(newValue: PluginSettingValue): void;
    option: PluginSettingComponentDef;
}

/** Void++ 的 component 返回 ReactNode；扩展界面是原生 DOM，所以返回 HTMLElement */
export interface PluginSettingComponentDef {
    type: OptionType.COMPONENT;
    component: (props: IPluginOptionComponentProps) => HTMLElement;
    default?: unknown;
}

type PluginSettingType<O extends PluginSettingDef> = O extends PluginSettingStringDef
    ? string
    : O extends PluginSettingNumberDef | PluginSettingSliderDef
      ? number
      : O extends PluginSettingBigIntDef
        ? bigint
        : O extends PluginSettingBooleanDef
          ? boolean
          : O extends PluginSettingSelectDef
            ? O["options"][number]["value"]
            : O extends { default: infer D }
              ? D
              : unknown;

type PluginSettingDefaultType<O extends PluginSettingDef> = O extends PluginSettingSelectDef
    ? O["options"] extends { default?: boolean }[]
        ? O["options"][number]["value"]
        : undefined
    : O extends { default: infer T }
      ? T
      : undefined;

type SettingsStore<D extends SettingsDefinition> = {
    [K in keyof D]: PluginSettingType<D[K]> | PluginSettingDefaultType<D[K]>;
};

export interface DefinedSettings<Def extends SettingsDefinition = SettingsDefinition, Checks extends SettingsChecks<Def> = {}, PrivateSettings extends object = {}> {
    store: SettingsStore<Def> & PrivateSettings;
    plain: SettingsStore<Def> & PrivateSettings;
    def: Def;
    checks: Checks;
    pluginName: string;
    /** Void++ 的 use() 是 React hook；这里是 DOM 版：订阅本插件设置变化，返回退订函数 */
    use(listener: (path: string) => void, settings?: (keyof Def | keyof PrivateSettings & string)[]): () => void;
    withPrivateSettings<T extends object>(): DefinedSettings<Def, Checks, T>;
}

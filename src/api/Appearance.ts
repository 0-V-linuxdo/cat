/*
 * 「外观」设置的公共读取：设置页（options）与内容脚本弹层（Capture 菜单等一次性弹层）按它决定明 / 暗。
 *   auto  = 跟随系统（含运行中切换：matchMedia change）；light / dark = 钉住，与系统无关。
 * 存储位置：Themes 是 Spaces 的功能（src/plugins/spaces/index.ts 的 features），featureSettings 把功能的设置并进所属插件，
 * 所以 mode 存在 Settings.plugins.Spaces.mode（不是 plugins.Themes.mode）；功能开关在 plugins.Spaces.Themes（关掉时侧栏不写 data-theme = 跟系统）。
 * 本文件只做「读 + 订阅」，不写设置、不含任何色值：颜色仍由既有 --arc-* / options.css 的 [data-theme] 规则决定。
 */
import { Settings, SETTINGS_KEY, SettingsStore, pluginPath } from "@api/Settings";
import { type CacheStore, writeAppearanceCache } from "@api/AppearanceCache";

export type AppearanceMode = "auto" | "light" | "dark";
/** 设置存放的插件名（Themes 的父插件） */
export const APPEARANCE_OWNER = "Spaces";
const DARK_MQ = "(prefers-color-scheme: dark)";

export const parseMode = (v: unknown): AppearanceMode => (v === "light" || v === "dark" ? v : "auto");

/** 从 Spaces 的设置包取模式；Themes 功能被关掉 = 不钉住 = auto */
export function modeFrom(bag: Record<string, unknown> | undefined | null): AppearanceMode {
    if (bag?.Themes === false) return "auto";
    return parseMode(bag?.mode);
}

export const resolveDark = (mode: AppearanceMode, systemDark: boolean): boolean => mode === "dark" || (mode === "auto" && systemDark);

export const appearanceMode = (): AppearanceMode => modeFrom(Settings.plugins[APPEARANCE_OWNER] as Record<string, unknown> | undefined);
export const systemIsDark = (): boolean => typeof matchMedia === "function" && matchMedia(DARK_MQ).matches;

/** 设置页 <html> 上的 data-theme：light / dark 钉住（options.css 与 sidepanel.css 已有对应规则）；auto 去掉，由 @media 跟随系统。值没变不写。 */
export function applyThemeAttr(root: { dataset: DOMStringMap }, mode: AppearanceMode) {
    if (mode === "auto") { if (root.dataset.theme !== undefined) delete root.dataset.theme; }
    else if (root.dataset.theme !== mode) root.dataset.theme = mode;
}

/** 首帧：设置完成加载之前先单独读一次存储，把钉住的模式写到 <html>（auto 什么都不做 = 与之前一致）。返回读到的模式。 */
export async function earlyAppearance(root: { dataset: DOMStringMap }, superseded: () => boolean = () => false): Promise<AppearanceMode | null> {
    try {
        const saved = (await chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY] as { plugins?: Record<string, Record<string, unknown>> } | undefined;
        const mode = modeFrom(saved?.plugins?.[APPEARANCE_OWNER]);
        if (!superseded()) applyThemeAttr(root, mode); // 设置已加载完则以设置为准，不回写旧值
        return mode;
    } catch { return null; }
}

export interface AppearanceState { mode: AppearanceMode; dark: boolean }
export interface WatchDeps {
    mode: () => AppearanceMode;
    mq: { matches: boolean; addEventListener(t: "change", l: () => void): void; removeEventListener(t: "change", l: () => void): void };
    onSettings: (l: () => void) => () => void;
}
const realDeps = (): WatchDeps => {
    const path = pluginPath(APPEARANCE_OWNER);
    return {
        mode: appearanceMode,
        mq: matchMedia(DARK_MQ),
        onSettings: l => { SettingsStore.addPrefixChangeListener(path, l); return () => SettingsStore.removePrefixChangeListener(path, l); },
    };
};

/**
 * 运行中跟随：系统明暗（matchMedia change）与设置变化都会触发，但只有「模式或解析后的明暗」真的变了才回调——
 * 不重载、不重复重绘；调用方只应换样式（CSS 变量 / 类 / <style> 文本），不要重建 DOM（否则会重放动画）。返回取消函数（两处监听都摘掉）。
 */
export function watchAppearance(cb: (s: AppearanceState) => void, deps: WatchDeps = realDeps()): () => void {
    const now = (): AppearanceState => { const mode = deps.mode(); return { mode, dark: resolveDark(mode, deps.mq.matches) }; };
    let last = now();
    const check = () => { const s = now(); if (s.mode === last.mode && s.dark === last.dark) return; last = s; cb(s); };
    deps.mq.addEventListener("change", check);
    const off = deps.onSettings(check);
    return () => { deps.mq.removeEventListener("change", check); off(); };
}

/* [system-color-scheme/3b] 把当前模式镜像到 localStorage 缓存（设置页首帧脚本读它，见 AppearanceCache.ts）。每个扩展 UI 上下文调用一次（bootstrap）：
 * 先写一次，之后设置变化再写（含从侧栏 / 菜单 / 设置页 / 导入备份改的）。内容脚本里 localStorage 是网页自己的 → 不碰（storage = null 时不订阅）。 */
export interface MirrorDeps { mode: () => AppearanceMode; storage: CacheStore | null; onSettings: (l: () => void) => () => void }
const realMirrorDeps = (): MirrorDeps => {
    const path = pluginPath(APPEARANCE_OWNER);
    return {
        mode: appearanceMode,
        storage: typeof location !== "undefined" && location.protocol === "chrome-extension:" ? localStorage : null,
        onSettings: l => { SettingsStore.addPrefixChangeListener(path, l); return () => SettingsStore.removePrefixChangeListener(path, l); },
    };
};
export function mirrorAppearanceCache(deps: MirrorDeps = realMirrorDeps()): () => void {
    if (!deps.storage) return () => { };
    const store = deps.storage, write = () => writeAppearanceCache(deps.mode(), store);
    write();
    return deps.onSettings(write);
}

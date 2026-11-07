/* [system-color-scheme/3b] 「外观」模式的 localStorage 缓存：只为设置页首帧。
 * 设置页 <head> 里的同步 classic 脚本（entries/options-theme-head.ts → options-theme-head.js）在首次 paint 之前读它并写 <html data-theme>；
 * 真正的设置仍在 chrome.storage.local（plugins.Spaces.mode），options.ts 加载完后以设置为准纠正（缓存缺失 / 过期 = 最多一帧旧值，不会更糟）。
 * 本文件刻意不 import 任何模块：head 脚本包要尽量小、同步。localStorage 是扩展页面同源共享的（chrome-extension://<id>）。
 * 约定：light / dark 存值；auto = 删除该键（auto 首帧什么都不写，跟系统由 CSS @media 负责）。不含任何色值。 */
export const APPEARANCE_CACHE_KEY = "cat-appearance-mode";
export type CachedMode = "auto" | "light" | "dark";
export interface CacheStore { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }

const realStore = (): CacheStore | null => { try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; } };

export function writeAppearanceCache(mode: CachedMode, store: CacheStore | null = realStore()): void {
    try {
        if (!store) return;
        if (mode === "light" || mode === "dark") store.setItem(APPEARANCE_CACHE_KEY, mode); else store.removeItem(APPEARANCE_CACHE_KEY);
    } catch { /* 存储不可用：忽略，首帧退回补丁前的行为 */ }
}

/** 同步套用缓存里钉住的模式；返回套用的值（auto / 无 / 脏值 / 存储不可用 → null，什么都不写） */
export function applyCachedTheme(root: { dataset: DOMStringMap }, store: CacheStore | null = realStore()): "light" | "dark" | null {
    try {
        const v = store?.getItem(APPEARANCE_CACHE_KEY);
        if (v !== "light" && v !== "dark") return null;
        root.dataset.theme = v;
        return v;
    } catch { return null; }
}

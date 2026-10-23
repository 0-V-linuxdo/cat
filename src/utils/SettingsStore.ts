/*
 * 与 Void++ src/utils/SettingsStore.ts 相同：Proxy 包装的设置树，按路径 / 前缀 / 全局通知监听者，
 * 读取缺省值时调用插件注册的默认值 getter，markReady 之后才写盘（防抖）。
 * 存储从 GM_* / IndexedDB 换成 chrome.storage.local（键 STORAGE_KEY），所有扩展上下文共享。
 */
import { isObject } from "./guards";
import { Logger } from "./Logger";
import { mapGetOrCreate } from "./misc";

const logger = new Logger("SettingsStore");

export const STORAGE_KEY = "ArcSidebarSettings";
const SAVE_DEBOUNCE_MS = 50;

type Listener = (path: string) => void;

export class SettingsStore<T extends object> {
    private globalListeners = new Set<Listener>();
    private pathListeners = new Map<string, Set<Listener>>();
    private prefixListeners = new Map<string, Set<Listener>>();
    private defaultGetters = new Map<string, (key: string) => unknown>();
    private saveTimer: ReturnType<typeof setTimeout> | null = null;
    /** 本上下文改过、尚未写入存储的路径（plugins.<名>）：外部回声不能用旧值覆盖它们 */
    private dirty = new Set<string>();
    public isDirty(path: string) { return this.dirty.has(path); }
    private proxyCache = new WeakMap<object, T>();
    private ready = false;
    /** 扩展已重载 / 卸载（旧内容脚本里 chrome.runtime.id 消失，或写入报 “Extension context invalidated”）：之后所有写盘都是空操作 */
    private dead = false;
    public get isDead() { return this.dead; }
    private kill() {
        this.dead = true;
        if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; }
    }

    public declare store: T;
    public declare plain: T;

    constructor(plain: T) {
        this.plain = plain;
        this.store = this.makeProxy(plain as Record<string, unknown>);
    }

    public markReady() {
        this.ready = true;
    }

    public flush() {
        if (!this.ready || this.dead) return Promise.resolve();
        if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; }
        return this.save();
    }

    public setDefaultGetter(prefix: string, getter: (key: string) => unknown): void {
        this.defaultGetters.set(prefix, getter);
    }

    private makeProxy(target: Record<string, unknown>, path = ""): T {
        const cached = this.proxyCache.get(target);
        if (cached) return cached as T;

        const proxy = new Proxy(target, {
            get: (t, key: string) => {
                let value = t[key];
                if (value === undefined && key !== "__proto__" && typeof key === "string") {
                    const fullPath = path ? `${path}.${key}` : key;
                    for (const [prefix, getter] of this.defaultGetters) {
                        if (!fullPath.startsWith(`${prefix}.`)) continue;
                        const settingKey = fullPath.slice(prefix.length + 1);
                        if (settingKey && !settingKey.includes(".")) {
                            value = getter(settingKey);
                            break;
                        }
                    }
                }
                if (isObject(value)) return this.makeProxy(value, path ? `${path}.${key}` : key);
                return value;
            },
            set: (t, key: string, value) => {
                if (t[key] === value) return true;
                t[key] = value;
                this.notifyListeners(path ? `${path}.${key}` : key);
                return true;
            },
            deleteProperty: (t, key: string) => {
                if (!(key in t)) return true;
                delete t[key];
                this.notifyListeners(path ? `${path}.${key}` : key);
                return true;
            },
        });

        this.proxyCache.set(target, proxy as T);
        return proxy as T;
    }

    private invokeListeners(listeners: Set<Listener>, path: string) {
        for (const l of Array.from(listeners)) {
            try { l(path); } catch (e) { logger.error("Settings listener error:", e); }
        }
    }

    private notifyListeners(path: string, save = true) {
        this.invokeListeners(this.globalListeners, path);
        const listeners = this.pathListeners.get(path);
        if (listeners) this.invokeListeners(listeners, path);
        for (const [prefix, set] of Array.from(this.prefixListeners)) {
            if (path.startsWith(prefix) || prefix.startsWith(`${path}.`) || !path) this.invokeListeners(set, path);
        }
        if (save) { this.dirty.add(path.split(".").slice(0, 2).join(".")); this.scheduleSave(); }
    }

    private scheduleSave() {
        if (!this.ready || this.dead || this.saveTimer) return;
        this.saveTimer = setTimeout(() => {
            this.saveTimer = null;
            void this.save();
        }, SAVE_DEBOUNCE_MS);
    }

    private async save() {
        if (!this.ready || this.dead) return;
        // 预期失败：扩展上下文已失效（旧内容脚本）→ 不记日志，停止后续写盘
        if (typeof chrome === "undefined" || !chrome.runtime?.id) { this.kill(); return; }
        this.dirty.clear();
        try {
            await chrome.storage.local.set({ [STORAGE_KEY]: structuredClone(this.plain) });
        } catch (e) {
            if (/context invalidated/i.test(String((e as Error)?.message ?? e))) { this.kill(); return; }
            logger.error("Failed to save settings:", e);
        }
    }

    /** 其他上下文写入了设置：就地替换并通知（不回写，避免回声） */
    public applyExternal(path: string, value: unknown) {
        const parts = path.split(".");
        const last = parts.pop()!;
        let t = this.plain as Record<string, any>;
        for (const p of parts) t = t[p] ??= {};
        if (value === undefined) delete t[last];
        else t[last] = value;
        this.notifyListeners(path, false);
    }

    public markAsChanged() {
        this.notifyListeners("");
    }

    public addGlobalChangeListener(listener: Listener) { this.globalListeners.add(listener); }
    public removeGlobalChangeListener(listener: Listener) { this.globalListeners.delete(listener); }

    private addToMap(map: Map<string, Set<Listener>>, key: string, listener: Listener) {
        mapGetOrCreate(map, key, () => new Set<Listener>()).add(listener);
    }

    private removeFromMap(map: Map<string, Set<Listener>>, key: string, listener: Listener) {
        const set = map.get(key);
        if (set) { set.delete(listener); if (!set.size) map.delete(key); }
    }

    public addChangeListener(path: string, listener: Listener) { this.addToMap(this.pathListeners, path, listener); }
    public removeChangeListener(path: string, listener: Listener) { this.removeFromMap(this.pathListeners, path, listener); }
    public addPrefixChangeListener(prefix: string, listener: Listener) { this.addToMap(this.prefixListeners, prefix, listener); }
    public removePrefixChangeListener(prefix: string, listener: Listener) { this.removeFromMap(this.prefixListeners, prefix, listener); }
}

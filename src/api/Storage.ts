/*
 * 插件数据存储 API（Void++ 用 IndexedDB "VoidPP"；这里用 chrome.storage.local 的 data:<key>）。
 * 每个插件用 createPluginStore 声明自己的数据，跨上下文自动同步。
 */
import { Logger } from "@utils/Logger";
import { createExternalStore } from "@utils/misc";

const logger = new Logger("Storage");

export interface PluginStore<T> {
    /** chrome.storage.local 中的键（撤销快照用） */
    readonly key: string;
    readonly ready: Promise<void>;
    get(): T;
    update(fn: (draft: T) => T | void): Promise<void>;
    subscribe(fn: (v: T) => void): () => void;
}

export function createPluginStore<T extends object>(key: string, defaults: () => T): PluginStore<T> {
    const storageKey = `data:${key}`;
    let value: T = defaults();
    const ext = createExternalStore();
    let queue: Promise<void> = Promise.resolve();

    const ready = (async () => {
        if (typeof chrome === "undefined" || !chrome.storage) return;
        const got = await chrome.storage.local.get(storageKey);
        if (got[storageKey]) value = { ...defaults(), ...(got[storageKey] as T) };
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area !== "local" || !(storageKey in changes)) return;
            value = { ...defaults(), ...(changes[storageKey].newValue as T) };
            ext.notify();
        });
    })();

    return {
        key: storageKey,
        ready,
        get: () => value,
        update(fn) {
            queue = queue.then(async () => {
                await ready;
                const draft = structuredClone(value);
                value = (fn(draft) as T | undefined) ?? draft;
                ext.notify();
                await chrome.storage.local.set({ [storageKey]: value }).catch(e => logger.error(storageKey, e));
            });
            return queue;
        },
        subscribe(fn) { return ext.subscribe(() => fn(value)); },
    };
}

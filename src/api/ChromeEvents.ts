/*
 * MV3 service worker 要求事件监听在顶层同步注册，否则被唤醒的那个事件会丢失。
 * 核心在 background 入口同步注册这些 chrome 事件并缓冲，插件启动后通过 listen() 订阅；
 * 停用插件时退订（PluginManager 风格的统一托管，类似 Void++ 托管 zustand 订阅）。
 */
type AnyFn = (...a: any[]) => unknown;

const EVENTS = {
    "tabs.onCreated": () => chrome.tabs.onCreated,
    "tabs.onUpdated": () => chrome.tabs.onUpdated,
    "tabs.onRemoved": () => chrome.tabs.onRemoved,
    "tabs.onActivated": () => chrome.tabs.onActivated,
    "tabs.onMoved": () => chrome.tabs.onMoved,
    "tabs.onAttached": () => chrome.tabs.onAttached,
    "tabs.onReplaced": () => chrome.tabs.onReplaced,
    "windows.onRemoved": () => chrome.windows.onRemoved,
    "windows.onCreated": () => chrome.windows.onCreated,
    "windows.onFocusChanged": () => chrome.windows.onFocusChanged,
    "alarms.onAlarm": () => chrome.alarms.onAlarm,
    "commands.onCommand": () => chrome.commands.onCommand,
    "contextMenus.onClicked": () => chrome.contextMenus.onClicked,
    "runtime.onInstalled": () => chrome.runtime.onInstalled,
    "runtime.onStartup": () => chrome.runtime.onStartup,
    "downloads.onChanged": () => chrome.downloads?.onChanged,
} satisfies Record<string, () => chrome.events.Event<AnyFn> | undefined>;

export type ChromeEventName = keyof typeof EVENTS;
type Params<N extends ChromeEventName> = ReturnType<typeof EVENTS[N]> extends chrome.events.Event<infer F> | undefined ? F extends AnyFn ? Parameters<F> : never : never;

const subs = new Map<string, Set<AnyFn>>();
let buffer: Array<[string, unknown[]]> | null = [];

function fire(name: string, args: unknown[]) {
    for (const fn of Array.from(subs.get(name) ?? [])) {
        try { void fn(...args); } catch (e) { console.error("[ArcSidebar]", name, e); }
    }
}

/** 必须在 background 顶层同步调用 */
export function registerChromeEvents() {
    for (const [name, get] of Object.entries(EVENTS)) {
        get()?.addListener((...args: unknown[]) => {
            if (buffer) buffer.push([name, args]); else fire(name, args);
        });
    }
}

export function flushChromeEvents() {
    const b = buffer ?? [];
    buffer = null;
    for (const [n, a] of b) fire(n, a);
}

export function listen<N extends ChromeEventName>(name: N, fn: (...args: Params<N>) => unknown): () => void {
    let set = subs.get(name);
    if (!set) { set = new Set(); subs.set(name, set); }
    set.add(fn as AnyFn);
    return () => { set.delete(fn as AnyFn); };
}

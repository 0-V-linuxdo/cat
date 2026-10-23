/*
 * 事件总线：与 Void++ src/api/Events.ts 同构（subscribe / dispatch + 强类型事件表），
 * 额外支持跨上下文（background / panel / content）广播：dispatch(..., { broadcast: true })。
 */
import { Logger } from "@utils/Logger";
import { mapGetOrCreate } from "@utils/misc";

export interface ArcEventMap {
    pluginToggle: { name: string; enabled: boolean };
    pluginPin: void;
    pluginStar: void;
    reloadNeeded: void;
    languageChange: void;
    settingsChange: { plugin: string };
    /** 侧边栏需要重绘（数据变更） */
    refresh: void;
    spaceSwitch: { spaceId: string };
    openOverlay: { id: string; arg?: unknown };
    tabArchived: { url: string; title: string; reason?: "closed" | "auto" };
    /** 标签换了 id（丢弃 / 浏览器替换），状态已迁移（@api/Tabs） */
    tabReplaced: { from: number; to: number };
    [custom: `${string}:${string}`]: unknown;
}

export type ArcEvent = keyof ArcEventMap & string;
type Handler = (data: unknown) => void;

const logger = new Logger("Events");
const listeners = new Map<string, Set<Handler>>();
const BUS_MSG = "arc-sidebar:bus";

export function subscribe<E extends ArcEvent>(event: E, handler: (data: ArcEventMap[E]) => void): () => void {
    const set = mapGetOrCreate(listeners, event, () => new Set<Handler>());
    set.add(handler as Handler);
    return () => { set.delete(handler as Handler); if (!set.size) listeners.delete(event); };
}

function local(event: string, data: unknown) {
    const set = listeners.get(event);
    if (!set?.size) return;
    for (const h of Array.from(set)) {
        try { h(data); } catch (e) { logger.error(`handler error (${event}):`, e); }
    }
}

export function dispatch<E extends ArcEvent>(event: E, data?: ArcEventMap[E], opts?: { broadcast?: boolean }): void {
    local(event, data);
    if (opts?.broadcast && typeof chrome !== "undefined" && chrome.runtime?.id) {
        chrome.runtime.sendMessage({ type: BUS_MSG, event, data }).catch(() => { /* 无接收方 */ });
    }
}

/** 由各入口调用一次：把其他上下文广播来的事件转发到本地总线 */
export function bridgeRuntimeEvents() {
    chrome.runtime.onMessage.addListener(msg => {
        if (msg?.type === BUS_MSG) local(msg.event, msg.data);
    });
}

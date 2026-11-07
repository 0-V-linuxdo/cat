/* 上一个标签（PrevTab）的纯逻辑：便于单测，不碰 chrome / DOM。补丁 rel64-prev-seed（rel64-logs/rootcause.md §1） */
export interface SeedTab { id?: number; active?: boolean; lastAccessed?: number }
export interface Activation { tabId: number; windowId: number }
export interface PrevState { prev?: number; cur?: number }

/** 侧栏文档启动时的“上一个标签”种子：同窗口里除当前标签外 lastAccessed 最大的那个（= 第二近访问的标签）。
 * 没有 lastAccessed（Chrome 121 以下）或没有别的标签 → undefined（回落到旧行为：等下一次激活才有 prev） */
export function pickSeedPrev(tabs: readonly SeedTab[], cur: number | undefined): number | undefined {
    let best: SeedTab | undefined;
    for (const t of tabs) {
        if (t.id == null || t.id === cur || typeof t.lastAccessed !== "number" || !(t.lastAccessed > 0)) continue;
        if (!best || t.lastAccessed > best.lastAccessed!) best = t;
    }
    return best?.id;
}

/** 一次 tabs.onActivated：别的窗口忽略（窗口未知时不过滤）；切到另一个标签 → prev = 原 cur */
export function applyActivation(s: PrevState, ev: Activation, winId: number | undefined): PrevState {
    if (winId != null && ev.windowId !== winId) return s;
    if (ev.tabId === s.cur) return s;
    return { prev: s.cur, cur: ev.tabId };
}

/** 启动快照（tabs.query 的结果）→ 初始状态；之后把快照发出之后才到的激活按顺序重放（快照发出之前的激活已反映在 lastAccessed / active 里） */
export function seedState(tabs: readonly SeedTab[], later: readonly Activation[], winId: number | undefined): PrevState {
    const cur = tabs.find(t => t.active)?.id;
    let s: PrevState = { prev: pickSeedPrev(tabs, cur), cur };
    for (const ev of later) s = applyActivation(s, ev, winId);
    return s;
}

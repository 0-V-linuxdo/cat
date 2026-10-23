/* 标签休眠的纯函数筛选逻辑（无 chrome 依赖，可单测） */

export interface SleepTab {
    id?: number; url?: string; active?: boolean; discarded?: boolean; audible?: boolean;
    pinned?: boolean; lastAccessed?: number; autoDiscardable?: boolean; status?: string;
}
export interface SleepOptions {
    now: number;
    /** 闲置多久后休眠（毫秒）；≤0 表示关闭 */
    idleMs: number;
    lastActive: Record<string, number>;
    /** Cat 的固定 / 收藏 / 文件夹认领的标签 */
    claimed: Set<number>;
    skipHosts: string[];
    /** 「固定和收藏的标签不休眠」（超出 Arc，默认 false）：true 时 Cat 认领的标签和 Chrome 原生固定标签都不休眠 */
    keepPinned: boolean;
    sleepAudible: boolean;
    /** 受保护的最近使用标签数（默认 PROTECTED_LRU_COUNT，测试可改） */
    protectedLru?: number;
}

/** 核心 discardKeep（0.1.0.51950）已通过 @api/TabIdRemap 迁移 Space 归属、固定（含文件夹内）、收藏的 tabId → 认领的标签可以按开关休眠 */
export const CLAIMED_MIGRATION_READY = true;

/** Arc protectedLRUTabCount：最近使用的 10 个标签不休眠（arc-analysis/tab-sleep.md） */
export const PROTECTED_LRU_COUNT = 10;
/** Arc timeToDiscardTab 默认 14400 s */
export const DEFAULT_IDLE_MIN = 240;

export const IDLE_CHOICES = [15, 60, 240, 720] as const; // 分钟

export function hostMatches(url: string | undefined, list: string[]): boolean {
    if (!url || !list.length) return false;
    let host: string;
    try { host = new URL(url).hostname.toLowerCase().replace(/^www\./, ""); } catch { return false; }
    return list.some(h => {
        h = h.trim().toLowerCase().replace(/^\*\./, "").replace(/^www\./, "");
        return !!h && (host === h || host.endsWith(`.${h}`));
    });
}

/** 只休眠普通网页：chrome://、扩展页、file:、about: 等一律跳过 */
export const isSleepableUrl = (url?: string) => !!url && /^https?:\/\//i.test(url);

/** 返回应休眠的标签 id（不含未保存表单检测，那一步需要注入脚本） */
export function pickSleepTargets(tabs: SleepTab[], o: SleepOptions): number[] {
    if (!(o.idleMs > 0)) return [];
    const lastOf = (t: SleepTab) => (t.id != null ? o.lastActive[t.id] : undefined) ?? (t.active ? o.now : -Infinity);
    const recent = new Set(tabs.filter(t => t.id != null).toSorted((a, b) => lastOf(b) - lastOf(a)).slice(0, o.protectedLru ?? PROTECTED_LRU_COUNT).map(t => t.id!));
    return tabs.filter(t => {
        if (t.id != null && recent.has(t.id)) return false;
        if (t.id == null || t.active || t.discarded || t.status === "loading") return false;
        if (t.autoDiscardable === false) return false; // 页面或用户声明不可丢弃
        if (!isSleepableUrl(t.url)) return false;
        if (t.audible && !o.sleepAudible) return false;
        // 超出 Arc 的保护（开关，默认关 = 与 Arc 一致：Arc 只有 protectedFromDiscard + 最近 10 个）
        if (o.keepPinned && (o.claimed.has(t.id) || t.pinned)) return false;
        // 开关关闭时 Cat 认领的标签也休眠（同 Arc）：核心 discardKeep 已迁移 Space 归属、固定（含文件夹）、收藏的 tabId。
        // CLAIMED_MIGRATION_READY 现为 true，这一行只作保险：若将来迁移失效改回 false，认领的标签会重新被跳过
        if (!CLAIMED_MIGRATION_READY && o.claimed.has(t.id)) return false;
        if (hostMatches(t.url, o.skipHosts)) return false;
        const last = o.lastActive[t.id];
        if (last == null) return false; // 本插件没记录到激活就不休眠（不回退 lastAccessed）
        return o.now - last >= o.idleMs;
    }).map(t => t.id!);
}

/** Arc timeToCloseTab 129600 s（36 小时）（tab-sleep.md）。开关默认值源码未找到（由调用方传入）；
 * 到时后关闭还是归档源码未找到。Cat 决定：开关默认关，打开时归档（见 index.ts）。与 Today 自动归档是两套独立机制。 */
export const CLOSE_AFTER_MIN = 36 * 60;
/** Arc timeToFreezeTab 1800 s：扩展无法实现（没有 freeze API），不做 */
export const FREEZE_UNSUPPORTED = true;

/** 36 小时关闭的候选：与休眠相同的例外（激活 / 最近 10 个 / 音频 / 不可丢弃 / 非网页 / 白名单 / 无激活记录），
 * 已休眠的标签也算（Arc 的 close 是 discard 之后的下一档）；Cat 认领的标签一律不关闭（关闭会让固定 / 收藏丢失对应标签）。 */
export function pickCloseTargets(tabs: SleepTab[], o: SleepOptions & { closeMs: number }): number[] {
    if (!(o.closeMs > 0)) return [];
    const ids = new Set(pickSleepTargets(tabs.map(t => ({ ...t, discarded: false })), { ...o, idleMs: o.closeMs, keepPinned: true }));
    return tabs.filter(t => t.id != null && ids.has(t.id) && !o.claimed.has(t.id)).map(t => t.id!);
}

/** 激活记录的附加信息，用于浏览器重启后按 URL + 窗口序号重新对上 */
export interface TabMeta { url?: string; win?: number }
export interface RemapTab { id?: number; url?: string; windowId?: number }

/** 窗口 id → 序号（按 id 升序）；重启后窗口 id 会变，序号相对稳定 */
export function windowOrdinals(tabs: RemapTab[]): Map<number, number> {
    const wins = [...new Set(tabs.map(t => t.windowId).filter((w): w is number => w != null))].toSorted((a, b) => a - b);
    return new Map(wins.map((w, i) => [w, i]));
}

/** 重启后重映射：旧记录按 URL + 窗口序号唯一匹配到新标签；匹配不上或有歧义的丢弃 */
export function remapAfterRestart(lastActive: Record<string, number>, meta: Record<string, TabMeta>, tabs: RemapTab[]): { lastActive: Record<string, number>; meta: Record<string, TabMeta> } {
    const ord = windowOrdinals(tabs);
    const key = (url?: string, win?: number) => url ? `${win ?? "?"}|${url}` : undefined;
    const newByKey = new Map<string, number[]>();
    for (const t of tabs) { const k = key(t.url, t.windowId != null ? ord.get(t.windowId) : undefined); if (k && t.id != null) newByKey.set(k, [...newByKey.get(k) ?? [], t.id]); }
    const oldByKey = new Map<string, string[]>();
    for (const [id, m] of Object.entries(meta)) { const k = key(m.url, m.win); if (k && lastActive[id] != null) oldByKey.set(k, [...oldByKey.get(k) ?? [], id]); }
    const out: Record<string, number> = {}, outMeta: Record<string, TabMeta> = {};
    for (const [k, olds] of oldByKey) {
        const news = newByKey.get(k);
        if (!news || news.length !== 1 || olds.length !== 1) continue;
        out[news[0]] = lastActive[olds[0]];
        outMeta[news[0]] = meta[olds[0]];
    }
    return { lastActive: out, meta: outMeta };
}

/** 各框架的检测结果合并：任一框架有未保存内容或没有返回结果，都算有 */
export const anyUnsaved = (results: { result?: unknown }[] | undefined) => !results?.length || results.some(r => r.result !== false);

/** 注入页面执行（每个框架各跑一次）：是否有未保存的输入（运行在网页里，不能引用外部变量）。
 * 覆盖：输入框（含密码框）、文本域、单选多选、下拉、任何有内容的可编辑区域（不要求聚焦，保守处理）。 */
export function pageHasUnsavedInput(): boolean {
    const fields = document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea");
    for (const f of fields) {
        if (f instanceof HTMLInputElement) {
            if (["hidden", "submit", "button", "reset", "image", "search"].includes(f.type)) continue;
            if (f.type === "checkbox" || f.type === "radio") { if (f.checked !== f.defaultChecked) return true; continue; }
        }
        if (f.value && f.value !== f.defaultValue) return true;
    }
    for (const s of document.querySelectorAll("select")) for (const o of s.options) if (o.selected !== o.defaultSelected) return true;
    for (const el of document.querySelectorAll<HTMLElement>("[contenteditable]:not([contenteditable=false])")) {
        if (el.isContentEditable && el.textContent?.trim()) return true;
    }
    return !!document.body?.isContentEditable || document.designMode === "on";
}

/** 注入页面主世界执行：页面是否设置了 onbeforeunload。
 * addEventListener("beforeunload") 注册的监听器检测不到：要可靠捕获需在 document_start 于 MAIN world 包装 addEventListener，
 * 只能靠 manifest 里 world:"MAIN" 的 content script（或新增打包文件 + registerContentScripts），属于 manifest / 构建改动，本插件不做。 */
export function pageHasBeforeUnload(): boolean {
    return typeof window.onbeforeunload === "function";
}

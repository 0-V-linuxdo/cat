/* 运行期错误记录（所有扩展上下文：后台 SW / 侧栏 / 弹窗 / 离屏 / 选项页）。
 * 未处理的 Promise rejection 会被 Chrome 记到扩展卡片的“错误”里（51979 实机：点 ＋ / Ctrl+S 后出现）。
 * 这里只记录（不 preventDefault，照常进卡片），同时写入 storage.local["arc-errlog"]（最近 30 条）并 console.debug，
 * 自测（scripts/click-audit-cdp.ts、selftest “运行期错误日志为空”）读这个日志，有任何一条就失败——问题不会被藏起来。 */
export const ERRLOG_KEY = "arc-errlog";
export type ErrEntry = { t: number; ctx: string; kind: "rejection" | "error"; msg: string; stack?: string; url?: string };
let installed = false;
const queue: ErrEntry[] = []; let flushing = false;

async function flush() {
    if (flushing || !queue.length) return; flushing = true;
    try {
        const cur = ((await chrome.storage.local.get(ERRLOG_KEY))[ERRLOG_KEY] as ErrEntry[] | undefined) ?? [];
        const next = [...cur, ...queue.splice(0)].slice(-30);
        await chrome.storage.local.set({ [ERRLOG_KEY]: next });
    } catch { /* 存储不可用：只留 console */ } finally { flushing = false; if (queue.length) void flush(); }
}

export function recordError(ctx: string, kind: ErrEntry["kind"], err: unknown, url?: string) {
    const e = err as { message?: string; stack?: string } | undefined;
    const entry: ErrEntry = { t: Date.now(), ctx, kind, msg: String(e?.message ?? err).slice(0, 300), stack: e?.stack?.split("\n").slice(0, 5).join("\n"), url };
    console.debug("[Cat] 运行期错误", entry);
    queue.push(entry); void flush();
}

export function installErrorLog(ctx: string) {
    currentCtx = ctx;
    if (installed || typeof addEventListener !== "function") return;
    installed = true;
    // 只记录、不拦截：不调用 preventDefault，错误照常进扩展卡片的“错误”
    addEventListener("unhandledrejection", (e: PromiseRejectionEvent) => { recordError(ctx, "rejection", e.reason); });
    addEventListener("error", (e: ErrorEvent) => { if (e.error || e.message) recordError(ctx, "error", e.error ?? e.message, e.filename); });
}

export async function readErrorLog(): Promise<ErrEntry[]> { return ((await chrome.storage.local.get(ERRLOG_KEY))[ERRLOG_KEY] as ErrEntry[] | undefined) ?? []; }
export async function clearErrorLog() { await chrome.storage.local.remove(ERRLOG_KEY); }

/** 扩展 API 调用的统一失败处理：等待调用、接住失败、记入错误日志（不再抛出），返回结果或 fallback。
 * 用法：void safe(chrome.tabs.update(id, { active: true }), "tabs.update") 代替 void chrome.tabs.update(...) */
export async function safe<T, F = undefined>(p: Promise<T> | T, what: string, fallback?: F): Promise<T | F> {
    try { return await p; } catch (e) { recordError(currentCtx, "rejection", Object.assign(new Error(`${what}: ${(e as Error)?.message ?? e}`), { stack: (e as Error)?.stack })); return fallback as F; }
}
let currentCtx = "unknown";
export const setErrorCtx = (c: string) => { currentCtx = c; };

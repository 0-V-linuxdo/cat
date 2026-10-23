import { ensureOffscreen } from "./Offscreen";
import { safe } from "./ErrorLog";

/** 超时：p 在 ms 内没结束就返回 fallback（p 的后续失败经 safe() 记入错误日志，不留未捕获 Promise） */
export function withTimeout<T, F>(p: Promise<T>, ms: number, what: string, fallback: F): Promise<T | F> {
    const guarded = safe(p, what, fallback);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const to = new Promise<F>(r => { timer = setTimeout(() => r(fallback), ms); });
    return Promise.race([guarded, to]).finally(() => clearTimeout(timer));
}
export const OFFSCREEN_TIMEOUT_MS = 1500;
export const INJECT_TIMEOUT_MS = 2000;

/* 在任意上下文复制文本：panel/page 直接写；background 先用离屏文档，失败 / 超时退回注入到当前标签执行。
 * 52005：离屏 sendMessage 可能永不回复（广播给所有扩展页，某监听器返回 true 却不回复）→ tab.copyUrl 永不返回。各步都加超时。 */
export async function copyText(text: string, tabId?: number): Promise<boolean> {
    if (typeof document !== "undefined" && typeof navigator.clipboard !== "undefined") {
        try { await navigator.clipboard.writeText(text); return true; } catch { /* 退回注入 */ }
    }
    if (typeof document === "undefined" && chrome.offscreen) {
        const ready = await withTimeout(ensureOffscreen().then(() => true), OFFSCREEN_TIMEOUT_MS, "clipboard.ensureOffscreen", false);
        if (ready) {
            const ok = await withTimeout(Promise.resolve(chrome.runtime.sendMessage({ type: "arc-offscreen-copy", text })), OFFSCREEN_TIMEOUT_MS, "clipboard.offscreenCopy", false);
            if (ok) return true;
        }
    }
    if (tabId == null || !chrome.scripting) return false;
    const res = await withTimeout(Promise.resolve(chrome.scripting.executeScript({
        target: { tabId },
        args: [text],
        func: async (t: string) => {
            try { await navigator.clipboard.writeText(t); return true; } catch {
                const ta = document.createElement("textarea");
                ta.value = t; document.body.appendChild(ta); ta.select();
                const ok = document.execCommand("copy"); ta.remove(); return ok;
            }
        },
    })), INJECT_TIMEOUT_MS, "clipboard.inject", undefined);
    return !!res?.[0]?.result;
}

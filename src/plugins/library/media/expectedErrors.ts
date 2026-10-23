/* 预期内的正常失败：按集成规则静默（不写 arc-errlog、不加白名单），其它错误照常 safe() 记录。
 * 只吞对应类别的已知错误消息；新错误不会被藏起来。media / capture / splitView 共用（局部 helper，不放 @api）。 */
import { safe } from "@api/ErrorLog";

export type ExpectedKind = "script" | "download" | "message";

// 只匹配 Chrome 原句（子串、忽略大小写），不用宽泛片段，避免误吞新错误
const PATTERNS: Record<ExpectedKind, string[]> = {
    // executeScript 打在受限页面（chrome://、扩展商店、其它扩展页、错误页）或标签已关
    script: [
        "Cannot access contents of the page",
        "Cannot access a chrome:// URL",
        "Cannot access a chrome-extension:// URL of different extension",
        "The extensions gallery cannot be scripted",
        "Frame with ID 0 is showing error page",
        "No tab with id",
    ],
    // removeFile：文件已被用户删掉 / 下载记录已不存在
    download: ["Download file already deleted", "Invalid download id"],
    // 接收方（分屏页）没有打开
    message: ["Receiving end does not exist", "Could not establish connection"],
};

export function isExpectedError(e: unknown, kind: ExpectedKind): boolean {
    const msg = e instanceof Error ? e.message : typeof e === "string" ? e : (e as { message?: unknown })?.message;
    return typeof msg === "string" && PATTERNS[kind].some(p => msg.toLowerCase().includes(p.toLowerCase()));
}

/** 与 safe() 同签名语义：预期类错误静默返回 fallback，其它错误交给 safe() 记录后返回 fallback。 */
export async function safeExpected<T, F = undefined>(p: Promise<T> | T, what: string, kind: ExpectedKind, fallback?: F): Promise<T | F> {
    try { return await p; } catch (e) {
        if (isExpectedError(e, kind)) return fallback as F; // 正常失败：静默
        return safe(Promise.reject(e), what, fallback as F);
    }
}

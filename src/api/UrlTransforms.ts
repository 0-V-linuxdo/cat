/* 复制网址的变换管线（供插件注册，如 Clean URLs 去跟踪参数）。每个上下文（sidepanel / background）各自持有注册表；
 * 离屏文档只负责写剪贴板，收到的是已变换的文本。插件关闭时复制原始网址。 */
import { Logger } from "@utils/Logger";

export type UrlTransformStage = "copy";
export interface UrlTransformResult { url: string; changed?: boolean; toastKey?: string }
export type UrlTransform = (url: string) => string | UrlTransformResult;
export type Cleanup = () => void;

const logger = new Logger("UrlTransforms");
const registry: Record<UrlTransformStage, UrlTransform[]> = { copy: [] };

/** 注册变换；按注册顺序执行。返回取消注册的函数 */
export function registerUrlTransform(stage: UrlTransformStage, fn: UrlTransform): Cleanup {
    registry[stage].push(fn);
    return () => { const i = registry[stage].indexOf(fn); if (i >= 0) registry[stage].splice(i, 1); };
}

/** 依次执行已注册的变换（抛错 / 返回值无效的跳过并记录）。changed：有变换报告 changed:true；toastKey：最后一个报告 changed 的变换给的键 */
export function applyUrlTransformsDetailed(stage: UrlTransformStage, url: string): { url: string; changed: boolean; toastKey?: string } {
    let out = url, changed = false, toastKey: string | undefined;
    for (const fn of registry[stage].slice()) {
        try {
            const r = fn(out);
            if (typeof r === "string") out = r;
            else if (r && typeof r.url === "string") { out = r.url; if (r.changed) { changed = true; if (r.toastKey) toastKey = r.toastKey; } }
            else logger.warn(`transform returned ${typeof r}, skipped`);
        } catch (e) { logger.warn("url transform threw, skipped", e); }
    }
    return { url: out, changed, toastKey };
}
export function applyUrlTransforms(stage: UrlTransformStage, url: string): string {
    return applyUrlTransformsDetailed(stage, url).url;
}
/** 复制提示：有变换报告了 toastKey 就用它，否则 Arc 默认 “Copied Current URL” */
export const copyToastKey = (r: { changed: boolean; toastKey?: string }) => (r.changed && r.toastKey) || "tab.copiedLink";

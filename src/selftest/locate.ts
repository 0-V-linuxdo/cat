/* 元素定位 / 读标签的统一助手（产品把原生 title 迁到 ArcTooltip 的 data-tip，旧 title 作为回退）：
 *   定位：[data-sel=X] → [data-tip=X] → [title=X] → [aria-label=X]
 *   读标签：labelOf = data-sel ?? data-tip ?? title ?? aria-label
 *           tipOf  = data-tip ?? title ?? aria-label（ArcTooltip 挂上后会移除 data-tip / title，把文案放进 aria-label）
 *   tipOf 不读 data-sel：标签行的 data-sel 是 id（"tab:12"），按网址 / 文案匹配时必须拿文案。
 *   例外：Clear 按钮只按 data-sel（data-test 回退）定位——它的 aria-label / title 悬停 450ms 后才出现。
 * 自测页直接 import；CDP 框架把 LOCATE_SRC 注入到页面里用同一份实现。 */
export function tipOf(e: Element | null | undefined): string {
    if (!e) return "";
    const h = e as HTMLElement;
    return h.dataset?.tip ?? h.getAttribute?.("title") ?? h.getAttribute?.("aria-label") ?? "";
}
export function labelOf(e: Element | null | undefined): string {
    if (!e) return "";
    const h = e as HTMLElement;
    return h.dataset?.sel ?? h.dataset?.tip ?? h.getAttribute?.("title") ?? h.getAttribute?.("aria-label") ?? "";
}
export function byKey<T extends Element = HTMLElement>(key: string, scope: ParentNode = document, base = ""): T | null {
    const q = JSON.stringify(key);
    for (const a of ["data-sel", "data-tip", "title", "aria-label"]) { const e = scope.querySelector<T>(`${base}[${a}=${q}]`); if (e) return e; }
    return null;
}
/** 注入到 CDP 评估代码前面：定义 globalThis.__hx = { tipOf, labelOf, byKey } */
export const LOCATE_SRC = `globalThis.__hx ??= (() => { ${tipOf.toString()}; ${labelOf.toString()}; ${byKey.toString()}; return { tipOf, labelOf, byKey }; })();`;

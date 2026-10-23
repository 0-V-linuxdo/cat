/* 空间 / 文件夹图标（Icon 页签）：Arc 原始字形（picker56），顺序同 Arc CustomIcon.Icon。
 * 存储："sym:<case 名>"；emoji 原样存。 */
import { ION_SYMBOLS } from "./ionSymbols";
const MAP = new Map(ION_SYMBOLS.map(x => [x[0], x] as const));
export const SPACE_SYMBOLS = ION_SYMBOLS.map(x => x[0]);
export const isSym = (icon?: string) => !!icon && icon.startsWith("sym:");
/** 文本场合（菜单标签、标签组标题）：符号图标不输出文字 */
export const iconText = (icon?: string) => (icon && !isSym(icon) ? icon : "");
export function symIcon(name: string, size = 20): SVGSVGElement {
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", MAP.get(name)?.[1] ?? "0 -511 512 512"); svg.setAttribute("width", String(size)); svg.setAttribute("height", String(size));
    svg.setAttribute("fill", "currentColor"); svg.setAttribute("stroke-linecap", "round"); svg.setAttribute("stroke-linejoin", "round"); svg.setAttribute("aria-hidden", "true");
    svg.classList.add("arc-svg", "arc-sym", `arc-sym-${name}`);
    svg.innerHTML = (MAP.get(name) ?? MAP.get("ellipse"))?.[2] ?? "";
    return svg;
}
/** 渲染空间 / 文件夹图标：sym:xxx → SVG；否则 emoji 文字 */
export function spaceIconNode(icon: string | undefined, size = 16): Node | string {
    if (isSym(icon)) return symIcon(icon!.slice(4), size);
    return icon ?? "";
}

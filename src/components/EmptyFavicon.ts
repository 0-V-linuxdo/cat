/*
 * 无 favicon 时的占位：Arc 资源 EmptyFavicon（ARCClients_BaseAssets.bundle，archive-page.md §9）。
 * 原件 /workspace/arc-icons/favicon-placeholder/EmptyFavicon.svg：14×14 连续曲线圆角方块（角半径≈6），
 * 双层填充 #FAFBFF α0.1 + #86888D α0.2，无字形 / monogram。不是模板图（颜色写死），所以原样内联，不走 currentColor。
 * 用法：emptyFavicon(size = 14) → <svg class="arc-fav arc-fav-empty">，可直接替代 <img class="arc-fav">。
 */
import { copyTip } from "@components/ArcTooltip";
const NS = "http://www.w3.org/2000/svg";
/** 原件路径（viewBox 0 0 14 14） */
export const EMPTY_FAVICON_PATH = "M0 6C0 3.17157 0 1.75736 0.87868 0.87868C1.75736 0 3.17157 0 6 0H8C10.8284 0 12.2426 0 13.1213 0.87868C14 1.75736 14 3.17157 14 6V8C14 10.8284 14 12.2426 13.1213 13.1213C12.2426 14 10.8284 14 8 14H6C3.17157 14 1.75736 14 0.87868 13.1213C0 12.2426 0 10.8284 0 8V6Z";
/** 两层填充（自下而上），与原件一致 */
export const EMPTY_FAVICON_LAYERS: readonly { fill: string; opacity: number }[] = [{ fill: "#FAFBFF", opacity: 0.1 }, { fill: "#86888D", opacity: 0.2 }];

export function emptyFavicon(size = 14): SVGSVGElement {
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("class", "arc-fav arc-fav-empty");
    svg.setAttribute("width", String(size)); svg.setAttribute("height", String(size));
    svg.setAttribute("viewBox", "0 0 14 14"); svg.setAttribute("fill", "none");
    svg.setAttribute("aria-hidden", "true"); svg.setAttribute("data-test", "empty-favicon");
    for (const l of EMPTY_FAVICON_LAYERS) {
        const p = document.createElementNS(NS, "path");
        p.setAttribute("d", EMPTY_FAVICON_PATH); p.setAttribute("fill", l.fill); p.setAttribute("fill-opacity", String(l.opacity));
        svg.append(p);
    }
    return svg;
}

/* ── 浏览器默认地球（chrome-extension://…/_favicon/ 对没有图标的站点返回）也换成占位 ── */
let globeSig: Promise<string> | undefined;
const sigCache = new Map<string, Promise<string>>();
function sigOf(src: string): Promise<string> {
    let p = sigCache.get(src);
    if (!p) {
        p = new Promise<string>(res => { const im = new Image(); im.onload = () => { try { const c = document.createElement("canvas"); c.width = c.height = 16; c.getContext("2d")!.drawImage(im, 0, 0, 16, 16); res(c.toDataURL()); } catch { res(""); } }; im.onerror = () => res(""); im.src = src; });
        if (sigCache.size > 500) sigCache.clear();
        sigCache.set(src, p);
    }
    return p;
}
/** 给 favicon <img> 装上兜底：加载失败、或只是 _favicon 的默认地球 → 原位换成 emptyFavicon(size)（保留 class / data-tip 等属性由调用方决定） */
export function withEmptyFallback(img: HTMLImageElement, size = 14): HTMLImageElement {
    const swap = () => { if (!img.isConnected && !img.parentNode) { img.dataset.emptyFav = "1"; return; } const e = emptyFavicon(size); for (const c of Array.from(img.classList)) e.classList.add(c); copyTip(img, e); /* data-tip* 在 img 进文档时已被 applyTip 消费（属性没了）→ 从 ArcTooltip 登记的声明里复制，否则 svg 占位丢 tooltip */ img.replaceWith(e); };
    img.addEventListener("error", swap, { once: true });
    const src = img.getAttribute("src") ?? "";
    if (src.includes("/_favicon/")) {
        const u = new URL(src); u.searchParams.set("pageUrl", "https://arc-no-favicon.invalid/");
        globeSig ??= sigOf(u.toString());
        void Promise.all([globeSig, sigOf(src)]).then(([g, s]) => { if (!s || s === g) swap(); });
    }
    return img;
}

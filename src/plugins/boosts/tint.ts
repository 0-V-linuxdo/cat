/* content 上下文：配色层 <cat-boost-tint>（说明见 model.ts TINT_TAG）。
 * 无法对齐：需要内核。Arc 用内核的 HSL 矩阵；整页还是逐层、图片和视频是否排除，源码未找到。 */
import type { TintPrim } from "./color";
import { activeBoostsFor, colorActionFor, TINT_FILTER_ID, TINT_TAG } from "./model";
import { boostStore } from "./store";
import { PAGE_Z_MAX } from "@utils/zLayers";

const SVG_NS = "http://www.w3.org/2000/svg";
const LAYER_STYLE: Record<string, string> = {
    display: "block", position: "fixed", inset: "0", "pointer-events": "none", "z-index": String(PAGE_Z_MAX),
    contain: "strict", transform: "translateZ(0)", margin: "0", padding: "0", border: "0", background: "transparent",
};

/** 按 color.ts 的 TintPrim 建 SVG 原语（同一份定义也被测试逐步模拟） */
function buildPrim(p: TintPrim): SVGElement {
    const mk = (tag: string, attrs: Record<string, string>) => { const e = document.createElementNS(SVG_NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
    if (p.op === "matrix") return mk("feColorMatrix", { in: p.in, result: p.result, type: "matrix", values: p.values.join(" ") });
    if (p.op === "arith") return mk("feComposite", { in: p.in, in2: p.in2, result: p.result, operator: "arithmetic", k1: String(p.k[0]), k2: String(p.k[1]), k3: String(p.k[2]), k4: String(p.k[3]) });
    const ct = mk("feComponentTransfer", { in: p.in, result: p.result });
    ["feFuncR", "feFuncG", "feFuncB"].forEach((tag, i) => ct.append(mk(tag, { type: "table", tableValues: p.tables[i].join(" ") })));
    ct.append(mk("feFuncA", { type: "identity" }));
    return ct;
}

export function startTint(): () => void {
    if (window !== window.top) return () => undefined;
    let el: HTMLElement | null = null;
    let filterEl: SVGFilterElement | null = null;
    let lastKey = "";

    const ensure = () => {
        if (el?.isConnected) return el;
        el = document.createElement(TINT_TAG);
        el.setAttribute("aria-hidden", "true");
        const svg = document.createElementNS(SVG_NS, "svg");
        svg.setAttribute("width", "0"); svg.setAttribute("height", "0");
        svg.setAttribute("style", "position:absolute;width:0;height:0");
        const filter = document.createElementNS(SVG_NS, "filter");
        filter.id = TINT_FILTER_ID;
        // 必须是 sRGB：滤镜链按 sRGB 数值推导（默认 linearRGB 会让结果偏亮偏灰）
        filter.setAttribute("color-interpolation-filters", "sRGB");
        filterEl = filter; lastKey = "";
        svg.append(filter); el.append(svg);
        for (const [k, v] of Object.entries(LAYER_STYLE)) el.style.setProperty(k, v, "important");
        (document.documentElement ?? document).appendChild(el);
        return el;
    };
    const remove = () => { el?.remove(); el = null; filterEl = null; lastKey = ""; };

    const sync = () => {
        const a = colorActionFor(activeBoostsFor(boostStore.get().boosts, location.href));
        if (a.kind === "keep") return; // themeDriven：既不应用也不移除（同 Arc）
        if (a.kind === "remove") { remove(); return; }
        const node = ensure();
        const key = JSON.stringify(a.chain);
        if (key !== lastKey) { filterEl!.replaceChildren(...a.chain.map(buildPrim)); lastKey = key; }
        const f = `url(#${TINT_FILTER_ID})`;
        node.style.setProperty("backdrop-filter", f, "important");
        node.style.setProperty("-webkit-backdrop-filter", f, "important");
    };

    void boostStore.ready.then(sync);
    const unsub = boostStore.subscribe(sync);
    return () => { unsub(); remove(); };
}

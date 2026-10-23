/* Zap 选择器生成（纯函数，按最小元素接口工作，可单测）。
 * 评分权重取自 arc-source-analysis.md §B4（SelectorPicker.js 原文未提取到，这里是简化实现：
 * 不做 :has() 后代组合与“样式一致 +20”，最多 3 层祖先）。 */

export interface ElLike {
    tagName: string;
    id?: string;
    classList?: Iterable<string>;
    attributes?: Iterable<{ name: string; value: string }>;
    parentElement?: ElLike | null;
    children?: ArrayLike<ElLike>;
}
/** 给出选择器在页面上的匹配数 */
export type Counter = (selector: string) => number;

export const W = {
    KNOWN: 1, UNKNOWN: -0.5, GIBBERISH: -1, SEMANTIC_TAG: 0.5, CUSTOM_ELEMENT: 1, NORMAL_TAG: -0.1, PSEUDO: -0.1,
    ARIA_LABEL: 0.8, HREF: 0.6, ROLE: 0.5, TESTID: 1, ATTRIBUTE_NAME: -0.1, DESCENDANT: -0.1,
} as const;

const SEMANTIC_TAGS = new Set(["header", "footer", "nav", "aside", "main", "article", "section", "dialog", "form", "figure", "video", "iframe"]);
const KNOWN_WORDS = ["ad", "ads", "advert", "banner", "card", "header", "footer", "nav", "menu", "sidebar", "post", "title", "comment", "promo", "popup", "modal", "cookie", "newsletter", "recommend", "related", "share", "social", "sponsor", "toolbar", "widget", "feed", "story", "trending", "overlay", "notice", "subscribe"];
const RARE_PAIRS = /jz|jx|qk|qx|qz|vq|wx|xj|zx|zq|fq|gx|kq|qj|vj|vx|wq|xk|xz/i;

/** “乱码”类名判定（§B4）：数字 > 2、末位大写的驼峰、辅音串 > 4、罕见双字母 */
export function isGibberish(s: string): boolean {
    if ((s.match(/\d/g)?.length ?? 0) > 2) return true;
    if (/[a-z][A-Z]$/.test(s)) return true;
    if (/[bcdfghjklmnpqrstvwxz]{5,}/i.test(s)) return true;
    return RARE_PAIRS.test(s);
}

export const cssEscape = (s: string) => s.replace(/^(\d)/, "\\3$1 ").replace(/[^\w-]/g, c => `\\${c}`);
const attrValue = (v: string) => `"${v.replace(/["\\]/g, "\\$&")}"`;
const isKnown = (s: string) => s.toLowerCase().split(/[-_]+/).some(w => KNOWN_WORDS.includes(w));
const tokenScore = (s: string) => isGibberish(s) ? W.GIBBERISH : isKnown(s) ? W.KNOWN : W.UNKNOWN;

export interface Part { sel: string; score: number }

/** 单个元素自身的候选片段，分数高者在前 */
export function partsFor(el: ElLike): Part[] {
    const tag = el.tagName.toLowerCase();
    const out: Part[] = [];
    const attrs = [...(el.attributes ?? [])];
    for (const a of attrs) {
        const n = a.name.toLowerCase();
        if (/^data-(test-?id|testid|qa|cy)$/.test(n) && a.value) out.push({ sel: `[${n}=${attrValue(a.value)}]`, score: W.TESTID + 1 });
        else if (n === "aria-label" && a.value) out.push({ sel: `${tag}[aria-label=${attrValue(a.value)}]`, score: W.ARIA_LABEL });
        else if (n === "role" && a.value) out.push({ sel: `${tag}[role=${attrValue(a.value)}]`, score: W.ROLE + W.NORMAL_TAG });
        else if (n === "href" && a.value && !/^javascript:/i.test(a.value) && a.value.length < 120) out.push({ sel: `a[href=${attrValue(a.value)}]`, score: W.HREF });
    }
    if (el.id && !isGibberish(el.id)) out.push({ sel: `#${cssEscape(el.id)}`, score: tokenScore(el.id) + 1.5 });
    for (const c of el.classList ?? []) if (c) out.push({ sel: `.${cssEscape(c)}`, score: tokenScore(c) });
    if (tag.includes("-")) out.push({ sel: tag, score: W.CUSTOM_ELEMENT });
    else if (SEMANTIC_TAGS.has(tag)) out.push({ sel: tag, score: W.SEMANTIC_TAG });
    return out.sort((a, b) => b.score - a.score);
}

function nthChild(el: ElLike): string {
    const tag = el.tagName.toLowerCase();
    const sibs = el.parentElement?.children;
    if (!sibs || sibs.length <= 1) return tag;
    const i = Array.prototype.indexOf.call(sibs, el) + 1;
    return i > 0 ? `${tag}:nth-child(${i})` : tag;
}

/** “这个元素”：自下而上找到唯一匹配的最短、最语义化选择器；找不到时退到 nth-child 路径 */
export function selectorForThis(el: ElLike, count: Counter, maxDepth = 8): string {
    const own = partsFor(el).filter(p => p.score > W.GIBBERISH);
    for (const p of own) if (count(p.sel) === 1) return p.sel;
    // 两段组合：祖先语义片段 > 自身片段
    for (let a = el.parentElement, d = 0; a && d < 3; a = a.parentElement, d++) {
        for (const ap of partsFor(a).filter(p => p.score > 0).slice(0, 3)) for (const p of [...own.slice(0, 3), { sel: nthChild(el), score: 0 }]) {
            const s = `${ap.sel} ${p.sel}`;
            if (count(s) === 1) return s;
        }
    }
    // 退路：nth-child 链，遇到唯一的 #id 停止
    const chain: string[] = [];
    for (let cur: ElLike | null | undefined = el, d = 0; cur && d < maxDepth; cur = cur.parentElement, d++) {
        const tag = cur.tagName.toLowerCase();
        if (tag === "html") break;
        if (cur.id && !isGibberish(cur.id) && count(`#${cssEscape(cur.id)}`) === 1) { chain.unshift(`#${cssEscape(cur.id)}`); break; }
        chain.unshift(tag === "body" ? "body" : nthChild(cur));
        if (tag === "body") break;
        if (count(chain.join(" > ")) === 1) break;
    }
    return chain.join(" > ");
}

/** “相关元素”：匹配 2..100 个、分数最高的选择器；单段没有合适的才用一层祖先组合；都没有返回 null */
export function selectorForRelated(el: ElLike, count: Counter, max = 100): string | null {
    const best = (cands: Part[]) => {
        let b: Part | null = null;
        for (const c of cands) {
            if (c.score <= W.GIBBERISH) continue;
            const n = count(c.sel);
            if (n >= 2 && n <= max && (!b || c.score > b.score)) b = c;
        }
        return b?.sel ?? null;
    };
    const own = partsFor(el);
    const single = best(own);
    if (single) return single;
    const p = el.parentElement, combos: Part[] = [];
    if (p) for (const ap of partsFor(p).filter(x => x.score > 0).slice(0, 2)) for (const o of own.slice(0, 3)) combos.push({ sel: `${ap.sel} > ${o.sel}`, score: ap.score + o.score + W.DESCENDANT });
    return best(combos);
}

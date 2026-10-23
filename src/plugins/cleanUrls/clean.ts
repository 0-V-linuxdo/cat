/* Clean URLs 纯函数：以 Arc 1.169.0（arc-analysis/clean-urls.md）为准，补充 rules.ts 的其他来源。无副作用，可单测。
 * 重定向解包（Brave debounce / ClearURLs redirections）暂不做。 */
import { ARC_SITE_RULES, ARC_TABLE_A, ARC_TABLE_B, EXT_KEEP_ON_PATH, GLOBAL_EXTRA_EXACT, GLOBAL_PARAMS, GLOBAL_PREFIXES, KEEP_ON_PATH, SITE_RULES, SKIP_URL } from "./rules";

export interface CleanOptions {
    extraParams?: string[]; skipHosts?: string[];
    /** 启用自加的例外表（SKIP_URL / KEEP_ON_PATH）；默认关闭，与 Arc 一致 */
    exceptions?: boolean;
    /** 扩展规则（超出 Arc 的全局参数、站点规则、各国 Amazon、保留 Amazon 搜索词）；默认关闭 = 与 Arc 完全一致 */
    extended?: boolean;
}
export interface CleanResult { url: string; changed: boolean }

const low = (a: string[]) => a.map(s => s.toLowerCase());
const ARC_PREFIX = low(ARC_TABLE_A.filter(p => p.endsWith("_")));
const ARC_EXACT = low([...ARC_TABLE_A.filter(p => !p.endsWith("_")), ...ARC_TABLE_B]);
const EXT_EXACT = new Set([...ARC_EXACT, ...low([...GLOBAL_PARAMS, ...GLOBAL_EXTRA_EXACT])]);
const EXT_PREFIX = [...new Set([...ARC_PREFIX, ...low(GLOBAL_PREFIXES)])];
const ARC_EXACT_SET = new Set(ARC_EXACT);

const hostMatch = (host: string, list: string[]) => list.some(h => {
    h = h.trim().toLowerCase().replace(/^\*\./, "").replace(/^www\./, "");
    return !!h && (host === h || host.endsWith(`.${h}`));
});

/** 清洗并报告是否改动（Arc 的 didClean） */
export function cleanUrlDetailed(raw: string, opts: CleanOptions = {}): CleanResult {
    const same = { url: raw, changed: false };
    let u: URL;
    try { u = new URL(raw); } catch { return same; }
    if (u.protocol !== "http:" && u.protocol !== "https:") return same;
    if (opts.exceptions && SKIP_URL.some(r => r.test(raw))) return same;
    // Arc：query 含 ; 时整条不处理
    if (u.search.includes(";")) return same;
    const ext = !!opts.extended;
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    if (opts.skipHosts?.length && hostMatch(host, opts.skipHosts)) return same;

    const drop = new Set(ext ? EXT_EXACT : ARC_EXACT_SET);
    const prefixes = [...(ext ? EXT_PREFIX : ARC_PREFIX)];
    for (const p of opts.extraParams ?? []) if (p.trim()) drop.add(p.trim().toLowerCase());
    let pathFn: ((p: string) => string) | undefined;
    for (const r of ext ? [...ARC_SITE_RULES, ...SITE_RULES] : ARC_SITE_RULES) {
        if (!hostMatch(host, r.hosts)) continue;
        r.params?.forEach(p => drop.add(p.toLowerCase()));
        r.prefixes?.forEach(p => prefixes.push(p.toLowerCase()));
        for (const pp of r.pathParams ?? []) if (pp.path.test(u.pathname)) pp.params.forEach(p => drop.add(p.toLowerCase()));
        pathFn = r.path ?? pathFn;
    }
    if (ext) for (const k of EXT_KEEP_ON_PATH) if (hostMatch(host, k.hosts) && k.path.test(u.pathname)) k.params.forEach(p => drop.delete(p));
    if (opts.exceptions) for (const k of KEEP_ON_PATH) if (k.path.test(u.pathname)) k.params.forEach(p => drop.delete(p));

    let changed = false;
    if (pathFn) { const np = pathFn(u.pathname); if (np !== u.pathname) { u.pathname = np; changed = true; } }
    for (const k of new Set(u.searchParams.keys())) {
        const lk = k.toLowerCase();
        if (drop.has(lk) || prefixes.some(p => lk.startsWith(p))) { u.searchParams.delete(k); changed = true; }
    }
    if (!changed) return same;
    let out = u.toString();
    if (!u.searchParams.size) out = out.replace(/\?(?=#|$)/, "");
    return { url: out, changed: out !== raw };
}

export const cleanTrackingUrl = (raw: string, opts?: CleanOptions) => cleanUrlDetailed(raw, opts).url;

/** 文本框列表 → 数组（逗号 / 换行 / 空格分隔） */
export const parseList = (s: unknown) => typeof s === "string" ? s.split(/[\s,]+/).map(x => x.trim()).filter(Boolean) : [];

/** 复制 toast 文案键（clean-urls.md §4：有改动时 “Copied a clean link without trackers”） */
export const TOAST_KEY = "cleanUrls.copiedClean";
/** 转成核心 UrlTransforms 的返回值：有改动时带 changed + toastKey，核心 copyUrlWithToast 据此选 toast */
export const toTransformResult = (r: CleanResult): { url: string; changed?: boolean; toastKey?: string } =>
    r.changed ? { url: r.url, changed: true, toastKey: TOAST_KEY } : { url: r.url };

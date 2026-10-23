/* 第一层：内置站点规则（Arc BundledTidyTitles.tidyTitles）。
 * 结构来自 Arc 1.169.0 的 Swift 反射（arc-analysis/tidy-tabs.md §B）：
 *   TidyTitleConfiguration(siteName, rules[TidyTabTitle(match, title)])
 *   URLMatchType = pathEquals / pathContainsRegex / fragmentEquals / fragmentContainsRegex
 *   TitleModifier = always / removingPattern / removingPatterns
 * 规则数据：源码未找到（在远程配置或资源里，没提取到），所以 BUNDLED_TIDY_TITLES 为空，不自行编造。
 * 匹配和修改的具体语义也是按名字推断的：源码未找到。 */

export type URLMatchType =
    | { type: "pathEquals"; value: string }
    | { type: "pathContainsRegex"; value: string }
    | { type: "fragmentEquals"; value: string }
    | { type: "fragmentContainsRegex"; value: string };
export type TitleModifier =
    | { type: "always"; title: string }
    | { type: "removingPattern"; pattern: string }
    | { type: "removingPatterns"; patterns: string[] };
export interface TidyTabTitle { match: URLMatchType; title: TitleModifier }
export interface TidyTitleConfiguration { siteName: string; /** 主域（推断：按 host 后缀匹配） */ host: string; rules: TidyTabTitle[] }

/** 源码未找到：Arc 的规则数据没有提取到，保持为空 */
export const BUNDLED_TIDY_TITLES: TidyTitleConfiguration[] = [];

function matches(u: URL, m: URLMatchType): boolean {
    const frag = u.hash.replace(/^#/, "");
    try {
        switch (m.type) {
            case "pathEquals": return u.pathname === m.value;
            case "pathContainsRegex": return new RegExp(m.value).test(u.pathname);
            case "fragmentEquals": return frag === m.value;
            case "fragmentContainsRegex": return new RegExp(m.value).test(frag);
        }
    } catch { return false; }
    return false;
}

function modify(title: string, t: TitleModifier): string {
    const strip = (s: string, p: string) => { try { return s.replace(new RegExp(p, "g"), ""); } catch { return s; } };
    switch (t.type) {
        case "always": return t.title;
        case "removingPattern": return strip(title, t.pattern).trim();
        case "removingPatterns": return t.patterns.reduce(strip, title).trim();
    }
}

/** 按站点规则得到短标题；没有命中返回 null（交给模型） */
export function applyTidyTitleRules(url: string, title: string, configs: TidyTitleConfiguration[] = BUNDLED_TIDY_TITLES): string | null {
    let u: URL;
    try { u = new URL(url); } catch { return null; }
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    for (const c of configs) {
        const h = c.host.toLowerCase();
        if (host !== h && !host.endsWith(`.${h}`)) continue;
        for (const r of c.rules) if (matches(u, r.match)) { const out = modify(title, r.title); return out || null; }
    }
    return null;
}

/** 站点搜索（同 Arc 的“关键词 / 域名 + 空格”）：yt 猫 → 在 YouTube 搜“猫” */
export const SITE_SEARCH: { keys: string[]; name: string; url: string }[] = [
    { keys: ["yt", "youtube", "youtube.com"], name: "YouTube", url: "https://www.youtube.com/results?search_query=%s" },
    { keys: ["gh", "github", "github.com"], name: "GitHub", url: "https://github.com/search?q=%s" },
    { keys: ["w", "wiki", "wikipedia", "wikipedia.org"], name: "Wikipedia", url: "https://en.wikipedia.org/wiki/Special:Search?search=%s" },
    { keys: ["g", "google", "google.com"], name: "Google", url: "https://www.google.com/search?q=%s" },
    { keys: ["maps"], name: "Google Maps", url: "https://www.google.com/maps/search/%s" },
    { keys: ["amz", "amazon", "amazon.com"], name: "Amazon", url: "https://www.amazon.com/s?k=%s" },
    { keys: ["r", "reddit", "reddit.com"], name: "Reddit", url: "https://www.reddit.com/search/?q=%s" },
    { keys: ["x", "twitter", "x.com"], name: "X", url: "https://x.com/search?q=%s" },
    { keys: ["bili", "bilibili", "bilibili.com"], name: "Bilibili", url: "https://search.bilibili.com/all?keyword=%s" },
    { keys: ["zhihu", "zhihu.com"], name: "知乎", url: "https://www.zhihu.com/search?q=%s" },
];
export function siteSearch(q: string) {
    const m = /^(\S+)\s+(.+)$/.exec(q.trim());
    if (!m) return null;
    const s = SITE_SEARCH.find(x => x.keys.includes(m[1].toLowerCase()));
    return s ? { name: s.name, text: m[2], url: s.url.replace("%s", encodeURIComponent(m[2])) } : null;
}


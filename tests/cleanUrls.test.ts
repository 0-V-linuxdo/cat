import { describe, expect, test } from "bun:test";
import { cleanTrackingUrl as c, cleanUrlDetailed, TOAST_KEY, toTransformResult, type CleanOptions } from "../src/plugins/cleanUrls/clean";
/** 打开「扩展规则」 */
const e = (u: string, o: CleanOptions = {}) => c(u, { extended: true, ...o });
import { ARC_TABLE_A, ARC_TABLE_B } from "../src/plugins/cleanUrls/rules";
import { LOCALES } from "../src/api/i18n";
import "../src/plugins/cleanUrls/i18n";
import "../src/plugins/tabSleep/i18n";

describe("Clean URLs：Arc 表 A / B", () => {
    test("表的项数与 Arc 一致", () => {
        expect(ARC_TABLE_A.length).toBe(42);
        expect(ARC_TABLE_B.length).toBe(23);
    });
    test("表 A 精确项与前缀项", () => {
        expect(c("https://e.com/?_bta_c=1&dm_i=2&ef_id=3&mkwid=4&otc=5&s_kwcid=6&soc_trk=7&id=1")).toBe("https://e.com/?id=1");
        expect(c("https://e.com/?utm_x=1&hsa_y=2&ns_z=3&sr_a=4&stm_b=5&trk_c=6&vero_d=7&mc_e=8&page=2")).toBe("https://e.com/?page=2");
    });
    test("表 B（含全站 ref / si / mt / trk）", () => {
        expect(c("https://e.com/a?ref=hn&si=1&mt=2&trk=3&pla=4&ocid=5&ncid=6&trackingId=7&linkCode=8&_ss=9&share_id=0&q=x")).toBe("https://e.com/a?q=x");
    });
    test("前缀只按 _ 结尾的项：ref_src 不被 ref 精确项误伤以外的参数", () => {
        expect(c("https://e.com/?reference=1&sid=2&mtime=3")).toBe("https://e.com/?reference=1&sid=2&mtime=3");
    });
});

describe("Clean URLs：Arc 站点特例", () => {
    test("x.com / twitter 去 t、s", () => {
        expect(c("https://x.com/user/status/1?s=20&t=abc")).toBe("https://x.com/user/status/1");
        expect(c("https://mobile.twitter.com/user/status/1?s=46&lang=en")).toBe("https://mobile.twitter.com/user/status/1?lang=en");
    });
    test("Amazon 19 项（含 th / psc / keywords / ie / s）与 ref= 路径段", () => {
        expect(c("https://www.amazon.com/dp/B0X/ref=sr_1_1?th=1&psc=1&keywords=lego&ie=UTF8&qid=1&s=books&hv=1&pd_rd_w=a&pf_rd_p=b&pf=c&tag=d&rnid=e")).toBe("https://www.amazon.com/dp/B0X");
        expect(e("https://www.amazon.co.uk/Item/dp/B0X/ref=sr_1_3/123?x=1")).toBe("https://www.amazon.co.uk/Item/dp/B0X/123?x=1");
    });
    test("Amazon 无 query 也清路径", () => {
        const r = cleanUrlDetailed("https://www.amazon.com/dp/B0X/ref=abc/");
        expect(r).toEqual({ url: "https://www.amazon.com/dp/B0X", changed: true });
    });
    test("Amazon 保留 colid / coliid / smid", () => {
        expect(c("https://www.amazon.com/hz/wishlist/ls?colid=ABC&coliid=I1")).toBe("https://www.amazon.com/hz/wishlist/ls?colid=ABC&coliid=I1");
        expect(c("https://www.amazon.com/dp/B0X?smid=A1&qid=1")).toBe("https://www.amazon.com/dp/B0X?smid=A1");
    });
    test("YouTube 保留 v / t / list，去 si / feature / app / source_ve_path", () => {
        expect(c("https://www.youtube.com/watch?v=abc&t=42&list=PL1&si=X&feature=share&app=desktop&source_ve_path=Y")).toBe("https://www.youtube.com/watch?v=abc&t=42&list=PL1");
    });
    test("eBay 7 项", () => {
        expect(c("https://www.ebay.com/itm/1?_trkparms=a&_trksid=b&_from=c&hash=d&_skw=e&itmmeta=f&itmprp=g&var=2")).toBe("https://www.ebay.com/itm/1?var=2");
    });
});

describe("Clean URLs：Arc 结构规则", () => {
    test("query 含 ; 整条不动", () => {
        const u = "https://e.com/p?a=1;utm_source=x";
        expect(cleanUrlDetailed(u)).toEqual({ url: u, changed: false });
    });
    test("hash 不动（hash 里的 utm 也不碰）", () => {
        expect(c("https://e.com/p?page=2&utm_campaign=z#sec?utm_source=1")).toBe("https://e.com/p?page=2#sec?utm_source=1");
        expect(c("https://e.com/p#utm_source=1")).toBe("https://e.com/p#utm_source=1");
    });
    test("changed 标志", () => {
        expect(cleanUrlDetailed("https://e.com/?utm_source=1").changed).toBe(true);
        expect(cleanUrlDetailed("https://e.com/?q=1").changed).toBe(false);
    });
    test("非 http 与非法输入原样", () => {
        for (const u of ["chrome://settings/?utm_source=x", "file:///a?utm_source=1", "mailto:a@b.c?utm_source=1", "not a url", ""]) expect(c(u)).toBe(u);
    });
});

describe("Clean URLs：验收修复", () => {
    test("Medium 保留 sk，Netflix 保留 jbv", () => {
        expect(e("https://medium.com/@a/post-1?source=x&sk=SECRET")).toBe("https://medium.com/@a/post-1?sk=SECRET");
        expect(e("https://www.netflix.com/browse?jbv=80100172&trackId=1")).toBe("https://www.netflix.com/browse?jbv=80100172");
    });
    test("Bilibili mid / ts 只在视频页去掉", () => {
        expect(e("https://www.bilibili.com/video/BV1?p=2&t=30&mid=1&ts=1&vd_source=b")).toBe("https://www.bilibili.com/video/BV1?p=2&t=30");
        expect(e("https://space.bilibili.com/list?mid=1&ts=2")).toBe("https://space.bilibili.com/list?mid=1&ts=2");
    });
    test("TikTok user_id / timestamp 只在视频页去掉", () => {
        expect(e("https://www.tiktok.com/@u/video/1?user_id=1&timestamp=2&is_from_webapp=1&lang=en")).toBe("https://www.tiktok.com/@u/video/1?lang=en");
        expect(e("https://www.tiktok.com/live?user_id=1&timestamp=2")).toBe("https://www.tiktok.com/live?user_id=1&timestamp=2");
    });
});

describe("Clean URLs：补充来源与功能参数", () => {
    test("Firefox / AdGuard 补充", () => {
        expect(e("https://e.com/?wbraid=1&gbraid=2&twclid=3&ysclid=4&__hstc=5&mkt_tok=a&ttclid=1&irclickid=2&itm_source=5&id=1")).toBe("https://e.com/?id=1");
    });
    test("宽泛规则不收：c / from / pid / a8", () => {
        expect(e("https://e.com/?c=1&from=2&pid=3&a8=4")).toBe("https://e.com/?c=1&from=2&pid=3&a8=4");
    });
    test("Google 保留 q / start / tbm / hl", () => {
        expect(e("https://www.google.com/search?q=a&start=10&tbm=isch&hl=en&ei=x&ved=y&oq=a&sca_esv=1")).toBe("https://www.google.com/search?q=a&start=10&tbm=isch&hl=en");
    });
    test("Facebook 保留 story_fbid / id", () => {
        expect(e("https://m.facebook.com/story.php?story_fbid=1&id=2&mibextid=x&__tn__=y&fbclid=z")).toBe("https://m.facebook.com/story.php?story_fbid=1&id=2");
    });
    test("Spotify / 淘宝 / Reddit", () => {
        expect(e("https://open.spotify.com/track/123?si=abc")).toBe("https://open.spotify.com/track/123");
        expect(e("https://item.taobao.com/item.htm?id=1&skuId=2&spm=a&ali_trackid=b")).toBe("https://item.taobao.com/item.htm?id=1&skuId=2");
        expect(e("https://www.reddit.com/r/a/comments/b/?share_id=x&%24deep_link=true&context=3")).toBe("https://www.reddit.com/r/a/comments/b/?context=3");
    });
    test("例外开关关闭（默认，与 Arc 一致）时不生效", () => {
        expect(e("https://www.googleadservices.com/pagead/aclk?gclid=1&x=2")).toBe("https://www.googleadservices.com/pagead/aclk?x=2");
        expect(e("https://accounts.google.com/x?utm_source=1")).toBe("https://accounts.google.com/x");
        expect(e("https://e.com/oauth/callback?utm_source=1&state=2")).toBe("https://e.com/oauth/callback?state=2");
        expect(e("https://matrix.org/_matrix/a?utm_source=1")).toBe("https://matrix.org/_matrix/a");
        expect(e("https://e.com/unsubscribe?mkt_tok=abc&utm_source=x")).toBe("https://e.com/unsubscribe");
    });
    test("例外开关打开后生效", () => {
        const on = { exceptions: true };
        for (const u of ["https://www.googleadservices.com/pagead/aclk?gclid=1", "https://accounts.google.com/x?utm_source=1", "https://e.com/oauth/callback?utm_source=1", "https://matrix.org/_matrix/a?utm_source=1", "https://www.cloudflare.com/x?utm_source=1"]) expect(c(u, on)).toBe(u);
        expect(c("https://e.com/unsubscribe?mkt_tok=abc&utm_source=x", on)).toBe("https://e.com/unsubscribe?mkt_tok=abc");
    });
    test("自定义参数与跳过站点；大小写", () => {
        expect(c("https://e.com/?foo=1&bar=2", { extraParams: ["FOO"] })).toBe("https://e.com/?bar=2");
        expect(c("https://sub.e.com/?utm_source=1", { skipHosts: ["e.com"] })).toBe("https://sub.e.com/?utm_source=1");
        expect(c("https://e.com/?UTM_Source=1&FBCLID&x=1")).toBe("https://e.com/?x=1");
    });
});

describe("Clean URLs：扩展规则开关（默认关 = 与 Arc 完全一致）", () => {
    test("关闭时只用 Arc 表：超出 Arc 的参数和站点规则不动", () => {
        expect(c("https://e.com/?wbraid=1&mkt_tok=2&itm_source=3")).toBe("https://e.com/?wbraid=1&mkt_tok=2&itm_source=3");
        expect(c("https://www.google.com/search?q=a&ei=x&ved=y")).toBe("https://www.google.com/search?q=a&ei=x&ved=y");
        expect(c("https://m.facebook.com/story.php?story_fbid=1&mibextid=x&fbclid=z")).toBe("https://m.facebook.com/story.php?story_fbid=1&mibextid=x");
        expect(c("https://www.youtube.com/watch?v=a&pp=1&si=2")).toBe("https://www.youtube.com/watch?v=a&pp=1");
        expect(c("https://x.com/a/status/1?s=20&cn=1")).toBe("https://x.com/a/status/1?cn=1");
    });
    test("关闭时 Amazon 只认 amazon.com，搜索页的 s / keywords 照 Arc 删除", () => {
        expect(c("https://www.amazon.co.uk/dp/B0X/ref=sr_1?tag=a")).toBe("https://www.amazon.co.uk/dp/B0X/ref=sr_1?tag=a");
        expect(c("https://www.amazon.com/s?k=lego&keywords=lego&s=books&qid=1")).toBe("https://www.amazon.com/s?k=lego");
    });
    test("打开后：各国 Amazon，Amazon 搜索页保留搜索词", () => {
        expect(e("https://www.amazon.de/dp/B0X?tag=a&th=1")).toBe("https://www.amazon.de/dp/B0X");
        expect(e("https://www.amazon.com/s?k=lego&keywords=lego&s=books&qid=1")).toBe("https://www.amazon.com/s?k=lego&keywords=lego&s=books");
        expect(e("https://www.amazon.com/dp/B0X?keywords=lego&s=books")).toBe("https://www.amazon.com/dp/B0X");
    });
});

describe("Clean URLs：toast 与变换返回值", () => {
    test("变换结果有改动时带 changed + toastKey，无改动时不带", () => {
        expect(toTransformResult(cleanUrlDetailed("https://e.com/?utm_source=1&q=2"))).toEqual({ url: "https://e.com/?q=2", changed: true, toastKey: TOAST_KEY });
        expect(toTransformResult(cleanUrlDetailed("https://e.com/?q=2"))).toEqual({ url: "https://e.com/?q=2" });
        expect(LOCALES.en[TOAST_KEY]).toBe("Copied a clean link without trackers");
    });
});

describe("插件文案 i18n", () => {
    test("cleanUrls / tabSleep 的键中英齐全", () => {
        for (const k of ["plugin.cleanUrls.label", "cleanUrls.extraParams", "cleanUrls.exceptions", "cleanUrls.copiedClean", "plugin.tabSleep.desc", "tabSleep.idle", "tabSleep.12h", "tabSleep.cmdRun"]) {
            expect(LOCALES.en[k]).toBeTruthy(); expect(LOCALES.zh[k]).toBeTruthy();
        }
        expect(LOCALES.en["cleanUrls.copiedClean"]).toBe("Copied a clean link without trackers");
        expect(LOCALES.en["cleanUrls.copiedCleanMulti"]).toBe("Copied clean links without trackers");
    });
});

describe("Clean URLs：快捷键 toast 确认成功后才弹", () => {
    test("只有变换有改动且命令返回复制成功时才提示", async () => {
        const { createCopyTracker, copySucceeded } = await import("../src/plugins/cleanUrls/confirm");
        expect(copySucceeded("https://e.com")).toBe(true);
        for (const v of [false, undefined, null, ""]) expect(copySucceeded(v)).toBe(false);
        const t = createCopyTracker();
        let n = 0;
        const ok = t.wrap(async () => { t.markChanged(); return "https://e.com/"; }, () => n++);
        const fail = t.wrap(async () => { t.markChanged(); return false; }, () => n++);
        const unchanged = t.wrap(async () => "https://e.com/", () => n++);
        await ok(); expect(n).toBe(1);
        await fail(); expect(n).toBe(1);
        await unchanged(); expect(n).toBe(1);
    });
    test("不再用固定延迟；侧栏关着时不加网页内提示（位置源码未找到）", async () => {
        const src = await Bun.file("src/plugins/cleanUrls/index.ts").text();
        expect(src).not.toContain("150");
        expect(src).not.toContain("setTimeout");
        expect(src).not.toContain("content: {");
        expect(src).toContain("源码未找到");
        expect(src).toContain('"tab.copyUrl", "tab.copyMarkdown"');
        expect(await Bun.file("src/plugins/cleanUrls/pageToast.ts").exists()).toBe(false);
    });
});

/* Clean URLs 规则表（本项目自行整理，非任何来源的拷贝）。
 * 参数名是事实性标识符，参考并交叉核对了以下来源（2026-10 读取），每项都人工筛过，去掉了可能误删功能参数的宽泛规则：
 *  - ClearURLs data.min.json（rules2.clearurls.xyz）——只参考，未打包
 *  - Firefox Query Stripping（remote settings: main/query-stripping）
 *  - AdGuard URL Tracking filter（TrackParamFilter/general_url.txt）
 *  - Brave query_filter（components/query_filter/browser/utils.cc）
 *  - Neat URL 默认规则
 * 刻意不收的规则示例：AdGuard 的 c / from / pid / a8 / gci（太短太通用）；ClearURLs Amazon 的 keywords、[a-z]*ie，
 * Google 的 site / source / sa / cd，Facebook 的 [a-z]*ref[a-z]* / app / pageid——都可能是功能参数。 */

/** Arc 1.169.0 表 A（42 项，arc-analysis/clean-urls.md §1.4）：以 _ 结尾按前缀匹配，其余精确匹配（Arc 源码未细分，按此约定） */
export const ARC_TABLE_A = ["_bta_c", "_bta_tid", "_ga", "_hsenc", "_hsmi", "_ke", "_openstat", "dm_i", "ef_id", "epik", "gclsrc", "gdffi", "gdfms", "gdftrk", "hsa_", "igsh", "matomo_", "mc_", "mkwid", "msclkid", "mtm_", "ns_", "oly_anon_id", "oly_enc_id", "otc", "pcrid", "piwik_", "pk_", "rb_clickid", "redirect_log_mongo_id", "redirect_mongo_id", "ref", "s_kwcid", "sb_referer_host", "soc_src", "soc_trk", "spm", "sr_", "stm_", "trk_", "utm_", "vero_"];
/** Arc 表 B（23 项）：精确匹配 */
export const ARC_TABLE_B = ["cm_mmc", "fbclid", "gad_source", "gclid", "ref", "pla", "spm", "si", "trackingId", "mt", "mcid", "linkCode", "srsltid", "ocid", "trk", "ncid", "mtc", "srcid", "nr_email_referer", "_pos", "_sid", "_ss", "share_id"];

/** 补充：全站去除（小写精确匹配；来自 Firefox / AdGuard / Brave / ClearURLs） */
export const GLOBAL_PARAMS: string[] = [
    // 广告点击 ID（Firefox / Brave / AdGuard 共有）
    "fbclid", "gclid", "gclsrc", "dclid", "gbraid", "wbraid", "gad_source", "gad_campaignid", "msclkid", "yclid", "ysclid",
    "twclid", "ttclid", "li_fat_id", "igshid", "igsh", "srsltid", "rb_clickid", "irclickid", "irgwc", "tduid", "cjevent", "cjdata",
    "sscid", "pjclid", "epik", "wickedid", "_openstat", "admitad_uid", "external_click_id", "unicorn_click_id", "iclid", "loclid",
    // 邮件营销
    "mc_eid", "mc_cid", "mc_tc", "mkt_tok", "_hsenc", "_hsmi", "__hssc", "__hstc", "__hsfp", "hsctatracking", "oly_anon_id", "oly_enc_id",
    "vero_id", "vero_conv", "ml_subscriber", "ml_subscriber_hash", "ck_subscriber_id", "elqtrackid", "elqtrack", "elqaid", "elqat", "elqcampaignid",
    "bsft_clkid", "bsft_uid", "bsft_mid", "bsft_eid", "bsft_aaid", "bsft_ek", "s_cid", "ref_src", "ref_url",
    // 分析 / 联盟
    "_ga", "_gl", "_branch_match_id", "_branch_referrer", "guccounter", "guce_referrer", "guce_referrer_sig", "usqp",
    "fb_action_ids", "fb_action_types", "fb_source", "fb_ref", "fb_comment_id", "action_object_map", "action_type_map", "action_ref_map",
    "__twitter_impression", "os_ehash", "cmpid", "spm", "tracking_source", "adobe_mc_ref", "adobe_mc_sdid",
];
/** 前缀匹配（小写） */
export const GLOBAL_PREFIXES: string[] = [
    "utm_", "pk_", "mtm_", "piwik_", "matomo_", "hsa_", "itm_", "adj_", "adjust_", "otm_", "hmb_", "_sgm_", "ebisother",
]; // int_ / at_ / ran / mt_ / af_ / ga_ 前缀太宽，只在下方精确列出
export const GLOBAL_EXTRA_EXACT = [
    "int_campaign", "int_content", "int_medium", "int_source", "int_term", "at_campaign", "at_medium", "at_link", "at_recipient_id",
    "ranmid", "raneaid", "ransiteid", "mt_campaign", "mt_click_id", "mt_creative", "mt_medium", "af_ad", "af_adset", "af_xp",
];

export interface SiteRule {
    /** 主域（含子域匹配） */
    hosts: string[];
    /** 精确匹配（小写） */
    params?: string[];
    /** 前缀匹配（小写） */
    prefixes?: string[];
    /** 只在路径匹配时去掉的参数 */
    pathParams?: { path: RegExp; params: string[] }[];
    /** 路径改写（Arc：去掉以 ref= 开头的路径段） */
    path?: (p: string) => string;
}
const AMAZON = ["com", "co.uk", "de", "co.jp", "fr", "it", "es", "ca", "cn", "in", "com.au", "com.mx", "com.br", "nl", "se", "pl", "sg", "ae", "sa", "com.tr", "com.be", "eg"].map(t => `amazon.${t}`);
const GOOGLE = ["com", "co.uk", "de", "fr", "co.jp", "ca", "com.au", "com.hk", "com.tw", "co.in", "es", "it", "nl", "com.br", "ru"].map(t => `google.${t}`);

/** Arc：去掉以 ref= 开头的路径段，并处理末尾的 / */
export const stripRefSegments = (p: string) => {
    const out = p.split("/").filter((seg, i) => i === 0 || !/^ref=/i.test(seg)).join("/");
    return out !== p ? out.replace(/(.)\/$/, "$1") || "/" : p;
};

/** Arc 1.169.0 站点特例（clean-urls.md §1.5），只含 Arc 原表：「扩展规则」关闭时只用这些 */
export const ARC_SITE_RULES: SiteRule[] = [
    { hosts: ["twitter.com", "x.com"], params: ["t", "s"] },
    {
        hosts: ["amazon.com"],
        params: ["_encoding", "ascsubtag", "pf", "psc", "tag", "ie", "hv", "content-id", "crid", "dib", "dib_tag", "keywords", "qid", "rnid", "s", "sprefix", "th"],
        prefixes: ["pd_rd_", "pf_rd_"],
        path: stripRefSegments,
    },
    { hosts: ["youtube.com"], params: ["feature", "app", "embeds_referring_euri", "source_ve_path"] },
    { hosts: ["ebay.com"], params: ["_trkparms", "_trksid", "_from", "hash", "_skw", "itmmeta", "itmprp"] },
];

/** 扩展规则（超出 Arc，设置项 extended，默认关闭）：Amazon 搜索页保留搜索词 */
export const EXT_KEEP_ON_PATH: { hosts: string[]; params: string[]; path: RegExp }[] = [
    { hosts: AMAZON, params: ["keywords", "k", "s"], path: /^\/s\/?$/ },
];

/** 扩展规则（超出 Arc，设置项 extended，默认关闭）：各国 Amazon、Google、Facebook 等站点规则，与 ARC_SITE_RULES 叠加使用 */
export const SITE_RULES: SiteRule[] = [
    // Arc：feature / app / embeds_referring_euri / source_ve_path；补充：si（Arc 表 B 全站已含）/ pp / kw / ab_channel
    { hosts: ["youtube.com", "youtu.be"], params: ["feature", "app", "embeds_referring_euri", "source_ve_path", "pp", "kw", "ab_channel", "embeds_referring_origin"] },
    { hosts: ["spotify.com", "spotify.link"], params: ["context", "nd", "dlsi"] },
    // Arc：t / s；补充 cn / src / ref_url
    { hosts: ["x.com", "twitter.com"], params: ["t", "s", "cn", "src", "ref_src", "ref_url"] },
    {
        // Arc（amazon.com）19 项：_encoding ascsubtag pd_rd_* pf pf_rd_* psc tag ie hv content-id crid dib dib_tag keywords qid rnid s sprefix th
        // 我们推广到各国 Amazon 域名；验收要求保留的 colid / coliid / smid 不在 Arc 表里，保留
        hosts: AMAZON,
        params: ["_encoding", "ascsubtag", "pf", "psc", "tag", "ie", "hv", "content-id", "crid", "dib", "dib_tag", "keywords", "qid", "rnid", "s", "sprefix", "th",
            "ref_", "sr", "srs", "linkid", "camp", "creative", "creativeasin", "refrid", "spia", "ms3_c", "aaxitk", "hsa_cr_id", "dchild", "social_share", "starsleft", "skiptwisterog", "qualifier"],
        prefixes: ["pd_rd_", "pf_rd_"],
        path: stripRefSegments,
    },
    { hosts: ["facebook.com", "fb.com", "messenger.com"], params: ["__tn__", "eid", "refid", "fref", "hc_ref", "hc_location", "mibextid", "rdid", "sfnsn", "comment_tracking", "dti", "ftentidentifier", "padding", "action_history", "referral_code", "referral_story_type", "eav", "wtsid", "rdc", "rdr", "paipv", "_rdr", "_nc_x", "notif_id", "notif_t"] },
    { hosts: ["instagram.com"], params: ["igshid", "img_index"] },
    { hosts: GOOGLE, params: ["ved", "ei", "gs_lcp", "gs_lp", "gs_l", "gs_ssp", "gs_mss", "sca_esv", "sca_upv", "sxsrf", "oq", "aqs", "sourceid", "uact", "iflsig", "sclient", "rlz", "bih", "biw", "dpr", "esrc", "gfe_rd", "gws_rd", "sei", "usg", "pcampaignid", "fbs", "ictx", "cshid", "atyp", "vet"] },
    { hosts: ["linkedin.com"], params: ["trackingid", "lipi", "refid", "midtoken", "midsig", "trkemail", "eid", "lici", "originalsubdomain"] },
    { hosts: ["reddit.com"], params: ["rdt", "$deep_link", "$3p", "$original_url", "_branch_match_id", "_branch_referrer", "correlation_id", "ref_campaign", "ref_source"] },
    {
        hosts: ["tiktok.com"], params: ["_r", "_t", "_d", "is_from_webapp", "sender_device", "is_copy_url", "share_app_id", "share_link_id", "share_item_id", "u_code", "tt_from", "checksum", "sec_uid", "social_sharing"],
        pathParams: [{ path: /\/video\//, params: ["user_id", "timestamp"] }],
    },
    {
        hosts: ["bilibili.com", "b23.tv"], params: ["spm_id_from", "vd_source", "share_source", "share_medium", "share_plat", "share_session_id", "share_tag", "share_from", "bbid", "from_spmid", "unique_k", "buvid", "up_id", "plat_id", "timestamp", "from_source", "msource", "seid"],
        pathParams: [{ path: /^\/video\//, params: ["mid", "ts"] }],
    },
    // Arc（ebay.com）：_trkparms _trksid _from hash _skw itmmeta itmprp
    { hosts: ["ebay.com", "ebay.co.uk", "ebay.de"], params: ["_trkparms", "_trksid", "_from", "hash", "_skw", "itmmeta", "itmprp", "amdata", "mkevt", "mkcid", "mkrid", "campid", "toolid", "customid"] },
    { hosts: ["aliexpress.com", "aliexpress.us"], params: ["ws_ab_test", "btsid", "algo_expid", "algo_pvid", "gps-id", "scm", "scm_id", "scm-url", "pvid", "cv", "af", "mall_affr", "sk", "dp", "terminal_id", "aff_request_id", "aff_fcid", "aff_fsk", "aff_platform", "aff_trace_key", "src", "pdp_npi", "pdp_ext_f"] },
    // jbv 是作品 ID，保留
    { hosts: ["netflix.com"], params: ["trackid", "tctx", "jbp"] },
    { hosts: ["taobao.com", "tmall.com"], params: ["scm", "pvid", "abbucket", "ali_refid", "ali_trackid", "utparam", "xxc"] },
    { hosts: ["zhihu.com"], params: ["share_code"] },
    // sk 是 friend link 密钥，保留
    { hosts: ["medium.com"], params: ["source"] },
    { hosts: ["etsy.com"], params: ["click_key", "click_sum", "pro", "frs", "ga_order", "ga_search_type", "ga_view_type", "ga_search_query", "organic_search_click", "sts", "plkey"] },
];

/** 自加例外（设置项 exceptions，默认关闭 = 与 Arc 一致）：命中则整条 URL 不处理（ClearURLs globalRules.exceptions + Firefox allowList + Brave 例外） */
export const SKIP_URL: RegExp[] = [
    /^https?:\/\/(?:[^/]+\.)?googleadservices\.com\//i, // Firefox allowList：广告跳转本身需要 gclid
    /^https?:\/\/(?:myaccount|accounts)\.google\.[a-z.]+\//i,
    /^https?:\/\/(?:[^/]+\.)?matrix\.org\/_matrix\//i,
    /^https?:\/\/(?:[^/]+\.)?(?:cloudflare\.com|prismic\.io|gitlab\.com|urldefense\.com)\//i,
    /^https?:\/\/[^/]+\/[^?]*\/(?:oauth2?|authorize|callback|sso|saml)\b/i, // 登录回调里的 state 等参数不碰
];
/** 条件例外：参数只在这些路径上保留（Brave：退订链接需要 mkt_tok / ck_subscriber_id） */
export const KEEP_ON_PATH: { params: string[]; path: RegExp }[] = [
    { params: ["mkt_tok", "ck_subscriber_id", "h_sid", "h_slt"], path: /unsubscribe|emailwebview|\/email\//i },
];

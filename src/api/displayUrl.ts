/*
 * 显示用网址（只用于给用户看；复制链接 / 匹配 / 存储一律用真实内部网址）。
 * 规则：
 *  1. 内部页 chrome:// 换成当前浏览器地址栏的协议名（Helium 地址栏显示 helium://extensions）。
 *     出处：Cat 实机观察 Helium 地址栏。Arc 的 chrome:// → arc:// 显示映射 ⛔（url-format.md:33「源码未找到」；arc:// 前缀有单独分支 FUN_101d5fd38，但未见映射）。
 *  2. 只有 host、路径为 “/” 的内部页去掉末尾 /（chrome://extensions/ → helium://extensions），与地址栏一致；有路径的不动。
 *     出处：同上实机观察；Arc 规范化 FUN_1008212dc 也会去掉末尾 /（url-format.md），但那是 Arc 自己的显示，不是内部页 ⛔。
 *  3. http(s) 等普通网址原样返回：顶部 URL pill / History 在 Arc 里怎么显示 ⛔（url-format.md「四处 UI」表）。
 *     需要 Arc 风格“只显示域名、去 https:// 与 www.”（标签悬停卡片 / 命令栏结果，url-format.md 表第 1、3 行）时用 arcHost()。
 */
type Brands = { brand: string }[];
const KNOWN: [RegExp, string][] = [
    [/helium/i, "helium"],
    [/microsoft edge/i, "edge"],
    [/brave/i, "brave"],
    [/opera/i, "opera"],
    [/vivaldi/i, "vivaldi"],
    // Arc / Tabbit：品牌名能否从 userAgentData 读到、地址栏用什么协议 ⛔，保持 chrome
];
const INTERNAL = new Set(["chrome", "helium", "edge", "brave", "opera", "vivaldi"]);

/** 当前浏览器地址栏显示内部页时用的协议名；认不出时 "chrome"。brands 可传入（测试 / 后台缓存）。 */
export function browserScheme(brands?: Brands, ua?: string): string {
    const nav = typeof navigator === "undefined" ? undefined : (navigator as Navigator & { userAgentData?: { brands?: Brands } });
    const list = brands ?? nav?.userAgentData?.brands ?? [];
    const text = list.map(b => b.brand).join(" ") + " " + (ua ?? nav?.userAgent ?? "");
    for (const [re, s] of KNOWN) if (re.test(text)) return s;
    return "chrome";
}

let cached: string | undefined;
const scheme = () => (cached ??= browserScheme());
/** 测试用：重置 / 指定协议名缓存 */
export function setBrowserSchemeForTest(s?: string) { cached = s; }

/* 52024 实机：Helium 155 的 navigator.userAgent / userAgentData.brands 与 Google Chrome 完全相同
 * （brands = Google Chrome 155 / Chromium 155 / Not(A:Brand 24，getHighEntropyValues fullVersionList 也一样），靠品牌认不出。
 * 可靠信号：Helium 把 uBlock Origin 作为组件扩展内置，id 固定为 blockjmkbacgjkknlgpkjjiijinjdanf
 * （helium components/helium_services/extension_ids.h kUBlockOriginComponentId；商店版 uBO 是 cjpalhdlnbpafiamejdnhcphjbkeiagm）。
 * 扩展有 management 权限，chrome.management.get(id) 能查到（siteControls/extPopup.ts 已把它当 Helium 内置 uBO 处理）。
 * ⛔ 未实机核对：该组件在 management 中可见（推断自 Helium 补丁使其可用）；用户在 Chrome 手动装 imputnet 的同 id crx 会误判为 Helium（极少见）；
 *    Helium 删掉 / 禁用内置 uBO 时：禁用仍能查到，删除后退回 chrome。 */
export const HELIUM_UBLOCK_ID = "blockjmkbacgjkknlgpkjjiijinjdanf";
const STORE_KEY = "arc-browser-scheme";
type Mgmt = { get(id: string): Promise<unknown> };
type Store = { get(k: string): Promise<Record<string, unknown>>; set(v: Record<string, unknown>): Promise<void> };
/** 异步识别：先看品牌（Edge/Brave 等会自报），认不出时用 Helium 内置 uBO 判断。结果缓存到内存 + storage.local（下次同步可用）。返回协议名。 */
export async function detectBrowserScheme(api: { management?: Mgmt; storage?: Store } = (globalThis as { chrome?: { management?: Mgmt; storage?: { local?: Store } } }).chrome
    ? { management: (globalThis as any).chrome.management, storage: (globalThis as any).chrome.storage?.local } : {}): Promise<string> {
    let s = browserScheme();
    if (s === "chrome" && api.management?.get) {
        try { if (await api.management.get(HELIUM_UBLOCK_ID)) s = "helium"; } catch { /* 没装 = 不是 Helium */ }
    }
    cached = s;
    try { await api.storage?.set({ [STORE_KEY]: s }); } catch { /* 忽略 */ }
    return s;
}
/** 启动时从 storage 读上次结果（同步渲染前尽早可用）；返回读到的值 */
export async function loadCachedBrowserScheme(store: Store | undefined = (globalThis as any).chrome?.storage?.local): Promise<string | undefined> {
    try { const v = (await store?.get(STORE_KEY))?.[STORE_KEY]; if (typeof v === "string" && v) { cached = v; return v; } } catch { /* 忽略 */ }
    return undefined;
}

export type DisplayMode = "domain" | "full";

/** 网址 → 显示文本。
 * mode "domain"（标签悬停提示 / 命令栏结果，url-format.md「四处 UI」表第 1、3 行，FUN_10082283c(1,…)）：
 *   去 https:// / http://、去 www.、从第一个 / 或 ? 起全部截掉（只剩域名）；host 转小写（options bit1）。
 *   内部页：协议名换成当前浏览器的（Cat 规则；Arc 的内部 scheme 显示 ⛔），同样只留 host（helium://extensions）。
 * mode "full"（地址栏胶囊 / History 等 ⛔ 位置的默认）：网页原样；内部页换协议名、只有 “/” 路径时去掉末尾 /。
 * 空值返回 ""。复制链接不要用它（复制原始网址，只去追踪参数：url-format.md「Copy Link」）。 */
/** 空白 / 新标签页：Arc 顶部 pill 无内容时显示占位符（url-format.md:27 “Full placeholder for empty Top Bar”），这里返回 ""，由渲染处补占位符；提示为空则不显示。具体哪些 URL 算“空”Rea 未覆盖 ⛔ */
export function isBlankPage(url?: string | null): boolean {
    if (!url) return true;
    const u = url.toLowerCase().replace(/[?#].*$/, "").replace(/\/$/, "");
    if (u === "about:blank" || u === "about:newtab") return true;
    const m = /^([a-z][a-z0-9+.-]*):\/\/([^/]*)$/.exec(u);
    return !!m && (INTERNAL.has(m[1]) || m[1] === "chrome-search") && ["newtab", "new-tab-page", "local-ntp"].includes(m[2]);
}

export function displayUrl(url?: string | null, mode: DisplayMode = "full", sch: string = scheme()): string {
    if (!url || isBlankPage(url)) return "";
    if (mode === "domain") return shortForm(url, sch);
    const m = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)(\/?)(.*)$/i.exec(url);
    if (!m) return url;
    const proto = m[1].toLowerCase(), [, , host, slash, rest] = m;
    if (INTERNAL.has(proto)) return `${sch}://${host}${rest ? slash + rest : ""}`;
    return url;
}

/** domain 模式的短形式。
 *  http(s)：url-format.md（去账号密码 / scheme / www.，截到第一个 / 或 ?，host 小写）。
 *  内部页：浏览器协议名 + host（Cat 规则）。
 *  以下 Rea 均未覆盖（url-format.md 只分析了 http/https 与 arc:// 分支）⛔，取实现值，目的是让悬停提示短到能显示：
 *   - 其他带 // 的协议（chrome-extension://、ftp://、ws:// …）：scheme://host（去账号密码，host 小写）⛔
 *   - file:：文件名（最后一段，解码）；没有文件名时 "file://" ⛔
 *   - about:：原样去掉 ? / #（about:blank）⛔
 *   - data: / blob: / javascript:：只留 "scheme:"（内容可能很长或含代码）⛔
 *   - 其他无 // 的协议（mailto: / tel: …）：去掉 ? / # 后原样 ⛔ */
function shortForm(url: string, sch: string): string {
    const pm = /^([a-z][a-z0-9+.-]*):/i.exec(url);
    if (!pm) return url;
    const proto = pm[1].toLowerCase();
    if (proto === "file") {
        const path = url.replace(/^file:(\/\/[^/]*)?/i, "").replace(/[?#].*$/, "");
        const name = path.split("/").filter(Boolean).pop();
        if (!name) return "file://";
        try { return decodeURIComponent(name); } catch { return name; }
    }
    if (proto === "data" || proto === "blob" || proto === "javascript") return `${proto}:`;
    const m = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)/i.exec(url);
    if (!m) return url.replace(/[?#].*$/, "");
    const host = m[1].replace(/^.*@/, "").toLowerCase();
    if (INTERNAL.has(proto)) return `${sch}://${host}`;
    if (proto === "http" || proto === "https") return host.replace(/^www\./, "");
    return `${proto}://${host}`;
}
/** 兼容名：Arc 风格只显示域名 */
export const arcHost = (url?: string | null, sch: string = scheme()) => displayUrl(url, "domain", sch);

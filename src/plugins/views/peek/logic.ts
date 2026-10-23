/* Peek 的点击判定（纯函数，便于自测）。依据 /workspace/arc-analysis/peek-click.md 中【提取】/【强推断】的结论：
 * - 跨“注册域”（eTLD+1）的普通点击：只在固定标签 / 收藏里用 Peek（scope=all 时所有标签）；Today 不 Peek
 * - Shift+点击：任何标签都用 Peek
 * - ⌘/中键 = 后台标签，⌘⇧ = 前台标签，⌥ = 下载，Ctrl = 系统右键菜单：都交给浏览器原生处理
 * - ⌥⌘+点击 = Little Arc
 * - Peek 内部不再嵌套 Peek：普通点击 / Shift+点击都在 Peek 内导航 */

/** 常见的多段公共后缀（简化版公共后缀表；完整表太大，不打包） */
const MULTI = new Set(["co.uk", "org.uk", "ac.uk", "gov.uk", "me.uk", "com.cn", "net.cn", "org.cn", "gov.cn", "edu.cn", "com.hk", "com.tw", "com.au", "net.au", "org.au", "edu.au", "co.jp", "ne.jp", "or.jp", "ac.jp", "co.kr", "or.kr", "com.br", "com.mx", "co.nz", "co.in", "co.za", "com.sg", "com.tr",
    "github.io", "gitlab.io", "vercel.app", "netlify.app", "pages.dev", "workers.dev", "herokuapp.com", "appspot.com", "blogspot.com", "web.app", "firebaseapp.com"]);

/** 注册域（eTLD+1）的近似：IP / localhost 原样返回 */
export function site(host: string): string {
    const h = host.toLowerCase().replace(/\.$/, "");
    if (!h.includes(".") || /^[\d.]+$/.test(h) || h.includes(":")) return h;
    const p = h.split(".");
    if (p.length <= 2) return h;
    return MULTI.has(p.slice(-2).join(".")) ? p.slice(-3).join(".") : p.slice(-2).join(".");
}
export function crossSite(from: string, to: string): boolean {
    try {
        const a = new URL(from), b = new URL(to);
        if (!/^https?:$/.test(b.protocol)) return false;
        return site(a.hostname) !== site(b.hostname);
    } catch { return false; }
}

export interface ClickMods { button: number; shiftKey: boolean; altKey: boolean; metaKey: boolean; ctrlKey: boolean }
export interface ClickCtx { eligible: boolean; inPeek: boolean; cross: boolean; /** Shift+点击 Peek 开关（默认开） */ shift?: boolean }
/** peek = 打开 Peek；little = Little Arc；here = 在当前（Peek）页内导航；native = 不拦截，交给浏览器 */
export type ClickAction = "peek" | "little" | "here" | "native";

export function decideClick(m: ClickMods, c: ClickCtx): ClickAction {
    if (m.button !== 0) return "native";                         // 中键：后台标签
    if (m.ctrlKey) return "native";                              // Ctrl+点击：系统右键菜单
    if (m.altKey && m.metaKey && !m.shiftKey) return "little";   // ⌥⌘：Little Arc
    if (m.altKey) return "native";                               // ⌥：下载；⇧⌥ 不处理
    if (m.metaKey) return "native";                              // ⌘ / ⌘⇧：后台 / 前台新标签
    if (c.inPeek) return m.shiftKey ? "here" : "native";        // Peek 内不嵌套：Shift 也在 Peek 内导航
    if (m.shiftKey) return c.shift === false ? "native" : "peek"; // Shift：任何标签都 Peek（可关）
    return c.eligible && c.cross ? "peek" : "native";
}

/** target=_blank / window.open 新建的标签：来源是可 Peek 的标签且跨站 → 改为 Peek */
export function newTargetToPeek(sourceEligible: boolean, sourceInPeek: boolean, sourceUrl: string, url: string): boolean {
    return sourceEligible && !sourceInPeek && crossSite(sourceUrl, url);
}

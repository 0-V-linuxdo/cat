/* 补丁 t903u-tab-switch v2：页内侧栏里点收藏 / 标签行时，窗口级预热（prewarm = window）只在「目的地是受限页」时才发。
 * 背景：iframe 里任意主键 pointerdown 都发 MSG.prewarm → SW 同栈 open 原生；点的是普通页收藏 / 标签时，原生先开再被到达判定关掉 = 闪现 ≈0.5 s
 *（v1 的 nativeChanged 补判兜住了「停在原生」，但闪现还在）。现在 pointerdown 时**同步**看目标：
 *   · 不是收藏磁贴 / 标签行（空白处、按钮、新建标签、键盘……）→ rel62 起**不发**（见 framePrewarmTargetOk）；
 *   · 已打开的标签（有 tabId）→ 按它当前的 tab.url（渲染时写进 DOM 的 data-pw-tab-url）判；url 为空（未提交 / 刚丢弃）= 判不出 → 当受限页，照发；
 *   · 未打开的收藏 / 固定项 → 按保存的 URL 判；没有 URL → 照发；
 *   · 偏离固定网址的固定行（点图标区会导航回保存的网址）：两个网址都得是普通页才不发。
 * 只有「判定为普通页（pageKind = ok）」才不发；受限页的手势内 open 原生链路完全不变（同一个 pointerdown、同一个同步 sendMessage）。
 * 纯逻辑：不 import chrome / 不碰 document（读属性走最小接口），单测见 tests/inpagePrewarmTarget.test.ts。 */
import { pageKind } from "@api/HostMode";

/** 渲染端写在收藏磁贴 / 标签行上的属性（TabRow / favorites） */
export const PW_ATTR = { target: "data-pw-target", url: "data-pw-url", tab: "data-pw-tab", tabUrl: "data-pw-tab-url", altUrl: "data-pw-alt-url" } as const;
/** 行里不是「切到这个标签」的控件：点它们不算导航（补丁 rel62-frame-prewarm-navonly 起不发预热；修前按老规则照发） */
export const PW_NON_NAV = ".arc-tab-close, .arc-audio, .arc-fav-btn, input, textarea";

export interface PrewarmTarget { tabId?: number; tabUrl?: string; url?: string; altUrl?: string }

const isOk = (u: string | undefined) => !!u && pageKind(u) === "ok";

/** 导航目标要不要原生（受限页 / 判不出 → true）。undefined → true 只是本函数的纯语义；frame 手势在 framePrewarmTargetOk 里先挡掉了「不是导航目标」（rel62 起不发） */
export function prewarmTargetNeedsNative(t: PrewarmTarget | undefined): boolean {
    if (!t) return true;
    const primary = t.tabId != null ? isOk(t.tabUrl) : isOk(t.url);
    if (!primary) return true; // 受限页 / 判不出来（空 url、未知 scheme）→ 当受限页
    if (t.altUrl != null && !isOk(t.altUrl)) return true;
    return false;
}

interface AttrEl { getAttribute(n: string): string | null; closest?(sel: string): AttrEl | null }
/** 从事件目标同步读出导航目标（pointerdown 当下，不 await）；点在行内控件上 / 不在任何目标里 = undefined */
export function readPrewarmTarget(target: unknown): PrewarmTarget | undefined {
    const el = target as AttrEl | null;
    if (!el || typeof el.closest !== "function") return undefined;
    if (el.closest(PW_NON_NAV)) return undefined;
    const row = el.closest(`[${PW_ATTR.target}]`); if (!row) return undefined;
    const tabS = row.getAttribute(PW_ATTR.tab), tab = tabS != null && tabS !== "" ? Number(tabS) : undefined;
    const out: PrewarmTarget = {};
    if (tab != null && Number.isInteger(tab)) { out.tabId = tab; out.tabUrl = row.getAttribute(PW_ATTR.tabUrl) ?? ""; }
    const url = row.getAttribute(PW_ATTR.url); if (url) out.url = url;
    const alt = row.getAttribute(PW_ATTR.altUrl); if (alt != null) out.altUrl = alt;
    return out;
}

/** 补丁 rel62-frame-prewarm-navonly（rel62 ①）：键盘手势里只有「激活」键算导航（焦点在行上按 Enter / 空格）；方向键 / 打字都不是 */
export const PW_ACTIVATE_KEYS: readonly string[] = ["Enter", " "];
/** panel.ts onGesture 用的一步。同步：只读事件目标的 DOM 属性。
 *  补丁 rel62-frame-prewarm-navonly：iframe 里**只有**「收藏 / 标签导航行 + 目的地是受限页或判不出」才发预热；其余一切 frame 手势（site-controls、复制链接、地址栏 / 命令栏、
 *  任何按钮、空白处、输入框、打字）都不发——原来它们照发，窗口级预热在同一手势里开原生、页内收起，点的菜单开在被收起的 iframe 里 = 「首击被吞 + 翻成原生」（-18 / -34）。
 *  不丢功能：页内 UI 去受限页的路线（ROUTES inpage-*）本来就由 ensure-native / navigateAfterNative 在同一手势里同步开原生（switchFirst === switchFirstWarm）。宿主页（content.ts）的手势预热不变。 */
export const framePrewarmTargetOk = (e: { type: string; target?: unknown; key?: string }): boolean => {
    if (e.type === "keydown" && !PW_ACTIVATE_KEYS.includes(e.key ?? "")) return false;
    if (e.type !== "pointerdown" && e.type !== "keydown") return false;
    const t = readPrewarmTarget(e.target); if (!t) return false; // 不是导航目标（或点在行内控件上）→ 不发
    return prewarmTargetNeedsNative(t);
};

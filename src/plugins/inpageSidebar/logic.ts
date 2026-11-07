/* 页内侧边栏：纯逻辑（无 chrome / DOM 依赖，单测见 tests/inpageSidebarLogic.test.ts）。 */
import { type PageKind, pageKind } from "@api/HostMode";

import { ARC, CHROME, DEFAULT_DISPLAY, type DisplayMode, FLAT_BASE, HANDLE, type Mode, MSG, PUSH, SPRING } from "./constants";

/** 宽度夹取 164–500（Arc `min(max(w,164),500)`）；非数字 → 默认宽 228。82（CollapseWidth）只是拖拽收起阈值，不是浮出容器参数 */
export function clampWidth(w: unknown): number {
    const n = typeof w === "number" ? w : typeof w === "string" && w.trim() !== "" ? Number(w) : NaN;
    if (!Number.isFinite(n)) return ARC.defaultWidth;
    return Math.min(ARC.maxWidth, Math.max(ARC.minWidth, Math.round(n)));
}

/* —— 页面是否能页内显示：判定在 @api/HostMode（patch 03，单一来源；iframe 里的 ensureNativeBeforeNavigate 用同一个函数） —— */
export { pageKind, type PageKind };

/* —— 状态与转换 —— */
export interface Facts {
    /** 原生侧栏在本窗口开着（核心 isPanelOpen：panel:<winId> 端口） */
    nativeOpen: boolean;
    /** 用户意图：想看到侧栏（页内形态）。原生打开时被置 false（原生优先） */
    intent: boolean;
    defaultMode: Mode;
    kind: PageKind;
    /** 内容脚本已握手（L1 端口 + L3 版本）且未被探测判死 */
    hostAlive: boolean;
    /** iframe 握手超时 / 被页面拦截（L4）：这个标签这次导航内不再尝试页内 */
    frameBlocked: boolean;
}

export const inpageEligible = (f: Pick<Facts, "kind" | "hostAlive" | "frameBlocked">) => f.kind === "ok" && f.hostAlive && !f.frameBlocked;
/** 当前标签上用户能看到侧栏吗（原生开着，或页内意图成立且可显示） */
export const isVisible = (f: Facts) => f.nativeOpen || (f.intent && inpageEligible(f));
/** 页内宿主应当显示（原生优先：原生开着就不显示，且我们从不为此 disable 原生，E3） */
export const shouldShowHost = (f: Facts) => f.intent && !f.nativeOpen && inpageEligible(f);
/** 降级角标：想看侧栏、原生没开、当前页又不能页内 → 提示「再按一次会走原生」 */
export const needsBadge = (f: Facts) => f.intent && !f.nativeOpen && !inpageEligible(f);

export interface Decision {
    intent: boolean;
    native: "open" | "close" | "keep";
    inpage: "show" | "hide";
    /** 只给日志 / 测试看 */
    why: "hide-visible" | "show-inpage" | "fallback-native" | "native-mode";
}
/** 手势里的切换（快捷键 / 右键菜单）：同步、纯函数 */
export function decideToggle(f: Facts): Decision {
    if (isVisible(f)) return { intent: false, native: f.nativeOpen ? "close" : "keep", inpage: "hide", why: "hide-visible" };
    if (f.defaultMode === "inpage" && inpageEligible(f)) return { intent: true, native: "keep", inpage: "show", why: "show-inpage" };
    return { intent: false, native: "open", inpage: "hide", why: f.defaultMode === "native" ? "native-mode" : "fallback-native" };
}

/** 补丁 inpage-restore-pinned：手势切换（⌃S / Alt+S / 图标）碰上「窗口级预热开的原生」时，关原生之后要把页内以常驻（pinned，推开页面）恢复，而不是只关。
 *  背景：预热（Window，首击任意手势）开原生时若页内本来就关着（hadIntent=false），不会打 restoreOnClose，意图保持 false；用户随后按 ⌃S 想要的是「Cat 回到页内」，
 *  但 decideToggle 对「原生已开」只给 hide-visible（关原生、意图 false）→ 页内 show=false，页面全宽；此时若开了「悬停浮出」且指针停在左缘，宿主会 peek 出浮动卡片（show=false 的 peek 从不推开页面）。
 *  只在：决策是 hide-visible + 关原生 · 该原生带预热标记（prewarmOpened：用户没主动选原生）· 默认方式 = 页内 · 当前页可页内（宿主握手、没被拦）· PREWARM.restoreInpageOnClose 开着 时成立。
 *  用户自己开的原生（无预热标记）、默认方式 = native、受限页（不可页内）都保持原来的「只关」。 */
export function shouldPinInpageAfterToggle(d: Pick<Decision, "why" | "native">, f: Pick<Facts, "defaultMode" | "kind" | "hostAlive" | "frameBlocked">, prewarmMarked: boolean, enabled: boolean): boolean {
    return enabled && prewarmMarked && d.why === "hide-visible" && d.native === "close" && f.defaultMode === "inpage" && inpageEligible(f);
}

/** 补丁 rel62-intent-persist（rel62 ④）：⌃S / Alt+S / 右键菜单 / 把手收起（toggleFor）之后的「全局最近意图」（data:inpageSidebar.lastOpen，新窗口 / 未知窗口继承）。
 *  只有「页内显示 / 页内收起」这两类用户决定才改它：show-inpage → true；hide-visible 且只收页内（native keep）→ false；关预热原生后以常驻恢复（pin，intent true）→ true；
 *  关掉原生（只关）/ 回落原生 / native 方式 → undefined = 不改（那是「原生」的事，不代表用户不要页内侧栏）。 */
export function nextLastOpen(d: Pick<Decision, "why" | "native" | "intent">): boolean | undefined {
    if (d.why === "show-inpage") return true;
    if (d.why === "hide-visible") return d.native === "keep" ? false : d.intent ? true : undefined;
    return undefined;
}
/** 补丁 rel62-intent-persist：没有记录的窗口（新窗口 / 浏览器重启后 id 变了 / 全新安装）的意图 = 继承全局最近意图；没有全局记录 → 默认方式 = 页内时为 true。默认方式 = native → false（native 方式下意图 true 会让页内显示） */
export function inheritIntent(lastOpen: boolean | undefined, defaultMode: Mode): boolean {
    if (defaultMode === "native") return false;
    return lastOpen ?? true;
}

/** 「切到 Chrome 侧边栏」按钮：不论默认方式，直接开原生并收起页内；已开着则什么都不做（不 disable、不 close） */
export function decideSwitchNative(f: Pick<Facts, "nativeOpen">): Decision & { openNative: boolean } {
    return { intent: false, native: f.nativeOpen ? "keep" : "open", inpage: "hide", why: "native-mode", openNative: !f.nativeOpen };
}

/** 原生侧栏出现 / 消失（端口注册）后的页内状态：原生优先——出现就清掉意图；消失不恢复（意图已清） */
export function onNativeChanged(f: Pick<Facts, "intent">, nativeOpen: boolean): { intent: boolean } {
    return { intent: nativeOpen ? false : f.intent };
}

/* —— 一个窗口只保留一个活动 iframe（裁定 F）—— */
export interface HostRef { tabId: number; windowId: number }
/** hosts：已握手的内容脚本；activeByWin：各窗口当前激活标签；last：上次下发的 active 表。
 * 返回要下发的变更：活动标签 active=true，同窗口其它标签 active=false（内容脚本据此销毁 / 重建 iframe）。 */
export function planActivation(hosts: readonly HostRef[], activeByWin: Readonly<Record<number, number | undefined>>, last: ReadonlyMap<number, boolean>): { tabId: number; active: boolean }[] {
    const out: { tabId: number; active: boolean }[] = [];
    for (const h of hosts) {
        const active = activeByWin[h.windowId] === h.tabId;
        if (last.get(h.tabId) !== active) out.push({ tabId: h.tabId, active });
    }
    return out;
}

/* —— 几何（Arc 值，DESIGN 5.2.1；网页换算见 5.2.2） —— */
export const hiddenOffset = (width: number) => -(width + ARC.hiddenExtra);
export const holdWidth = (width: number) => width + ARC.holdExtra;
/** 拖拽把手左缘：容器左缘（卡片 5 / 平贴 0）+ 宽 − 4 */
export const handleLeft = (width: number, flat = false) => boxChrome(flat).left + width - ARC.handleWidth / 2;
/** 触发区宽：未悬停 50；已在条带内 / 已浮出 250（⚠ 收窄） */
export const triggerWidth = (engaged: boolean) => engaged ? ARC.triggerWide : ARC.triggerNarrow;
/** 悬停浮出的命中：条带（x<触发宽）进入；浮出后保持区（x < 宽 + 80）内保持；离开即收回（⚠ 立即，Arc 源码未找到延迟计时器） */
export function hoverNext(shown: boolean, x: number, width: number): "stay" | "enter" | "leave" {
    if (shown) return x < holdWidth(width) ? "stay" : "leave";
    return x >= 0 && x < triggerWidth(false) ? "enter" : "stay";
}

/** L2 主动探测：send 超时 / 抛错 / 返回 falsy 都算失败；重试 retries 次。tabs.sendMessage(...,{frameId:0}) 由调用方包成 send（runtime.sendMessage 到不了内容脚本） */
export async function pingWithRetry<T>(send: () => Promise<T | undefined>, o: { ms: number; retries: number }): Promise<T | undefined> {
    for (let i = 0; i <= o.retries; i++) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const r = await Promise.race([send().catch(() => undefined), new Promise<undefined>(res => { timer = setTimeout(() => res(undefined), o.ms); })]);
        if (timer) clearTimeout(timer);
        if (r) return r;
    }
    return undefined;
}

/** ⚠ 冷启动纠偏（constants.COLD_START_CORRECTION，默认关）：冷启动时首次手势开了原生；现在该页可页内显示且默认方式是页内 → 应当换成页内 */
export function shouldCorrectCold(f: Facts, cold: { opened: boolean; tabId: number | undefined; windowId: number | undefined } | undefined, tabId: number, windowId: number): boolean {
    return !!cold && cold.opened && cold.tabId === tabId && cold.windowId === windowId && f.defaultMode === "inpage" && f.nativeOpen && inpageEligible(f);
}

/* ======================================================================================
 * 受限页前切换（DESIGN.md 3.5 / 3.6）：路线分类、进入前的决定、预热状态机。全部纯函数，单测见 tests/inpageSidebarLogic.test.ts。
 * ⚠ 没有任何一条路线被真机验证过；✓ / ⚠ / ⛔ 的含义见 DESIGN.md 3.7。
 * ====================================================================================== */

export type RouteId =
    | "inpage-newtab" | "inpage-tab-click" | "inpage-commandbar" | "inpage-bookmark-history" | "inpage-chrome-link" | "page-link-restricted"
    | "omnibox" | "cmd-t" | "bookmarks-bar" | "tabstrip-click" | "ctrl-tab" | "window-switch" | "session-restore" | "action-click" | "window-open" | "other-extension";
/** ensure = 手势里同步发 ensure-native；prewarm = 预热后只需 setOptions(enabled:true)；predict = 预测信号（onBeforeNavigate / onUpdated / onActivated），永远不是唯一依据；fallback = 按钮 / 角标 / 快捷键 */
export type Mechanism = "ensure" | "prewarm" | "predict" | "fallback" | "native-direct";
export interface Route {
    id: RouteId;
    /** 谁触发：inpage-ui = 页内侧栏自己的 UI（有手势、我们的代码在场）；page = 网页里的点击（内容脚本在场）；browser-ui = 浏览器自身 UI（没有可用手势）；other = 其它 */
    origin: "inpage-ui" | "page" | "browser-ui" | "other";
    /** ✓ = 设计上进入前一定能切（且依据是 P0 实测）；⚠ = 设计上能但依赖未实测项（E8 / E2 / E3 / 预测信号）；⛔ = 做不到（没有手势、P0 没有证据可用的替代） */
    switchFirst: "✓" | "⚠" | "⛔";
    /** 开启预热（prewarm=true）后的结果 */
    switchFirstWarm: "✓" | "⚠" | "⛔";
    mechanism: readonly Mechanism[];
}
export const ROUTES: readonly Route[] = [
    { id: "inpage-newtab", origin: "inpage-ui", switchFirst: "⚠", switchFirstWarm: "⚠", mechanism: ["ensure", "prewarm"] },
    { id: "inpage-tab-click", origin: "inpage-ui", switchFirst: "⚠", switchFirstWarm: "⚠", mechanism: ["ensure", "prewarm", "predict"] },
    { id: "inpage-commandbar", origin: "inpage-ui", switchFirst: "⚠", switchFirstWarm: "⚠", mechanism: ["ensure", "prewarm"] },
    { id: "inpage-bookmark-history", origin: "inpage-ui", switchFirst: "⚠", switchFirstWarm: "⚠", mechanism: ["ensure", "prewarm"] },
    { id: "inpage-chrome-link", origin: "inpage-ui", switchFirst: "⚠", switchFirstWarm: "⚠", mechanism: ["ensure", "prewarm"] },
    { id: "page-link-restricted", origin: "page", switchFirst: "⚠", switchFirstWarm: "⚠", mechanism: ["ensure", "prewarm"] },
    { id: "omnibox", origin: "browser-ui", switchFirst: "⛔", switchFirstWarm: "⚠", mechanism: ["prewarm", "predict", "fallback"] },
    { id: "cmd-t", origin: "browser-ui", switchFirst: "⛔", switchFirstWarm: "⚠", mechanism: ["prewarm", "fallback"] },
    { id: "bookmarks-bar", origin: "browser-ui", switchFirst: "⛔", switchFirstWarm: "⚠", mechanism: ["prewarm", "predict", "fallback"] },
    { id: "tabstrip-click", origin: "browser-ui", switchFirst: "⛔", switchFirstWarm: "⚠", mechanism: ["prewarm", "predict", "fallback"] },
    { id: "ctrl-tab", origin: "browser-ui", switchFirst: "⛔", switchFirstWarm: "⚠", mechanism: ["prewarm", "predict", "fallback"] },
    { id: "window-switch", origin: "browser-ui", switchFirst: "⛔", switchFirstWarm: "⛔", mechanism: ["fallback"] },
    { id: "session-restore", origin: "other", switchFirst: "⛔", switchFirstWarm: "⛔", mechanism: ["fallback"] },
    { id: "action-click", origin: "browser-ui", switchFirst: "✓", switchFirstWarm: "✓", mechanism: ["native-direct"] },
    { id: "window-open", origin: "page", switchFirst: "⛔", switchFirstWarm: "⚠", mechanism: ["prewarm", "predict", "fallback"] },
    { id: "other-extension", origin: "other", switchFirst: "⛔", switchFirstWarm: "⚠", mechanism: ["prewarm", "predict", "fallback"] },
];
/** prewarm：false / "off" = 只有 ensure-native；true / "window" = 开了窗口级预开（"tab" 选项已移除：Chrome ≥132 里标签级 enabled:false 藏不住原生面板，见 patches/inpage-prewarm-tab/downgrade/README.md） */
export const routeOutcome = (id: RouteId, prewarm: boolean | PrewarmMode): Route["switchFirst"] => { const r = ROUTES.find(x => x.id === id); const on = prewarm === true || prewarm === "window"; return !r ? "⛔" : on ? r.switchFirstWarm : r.switchFirst; };

export interface EnsureFacts {
    /** 原生面板此刻在眼前（核心 isPanelOpen） */
    showing: boolean;
}
/** SW 收到 ensure-native 后的决定（同步）：原生已在眼前 → 什么都不做；否则 openPanelInGesture（冷开，E8 ⚠）。
 *  （旧的「预热窗口里目标标签被禁 → 只 enable」分支随标签级预热一起移除。） */
export type EnsureAction = "already" | "open";
export function decideEnsure(f: EnsureFacts): EnsureAction {
    return f.showing ? "already" : "open";
}

/** 内容脚本里首次手势要不要发预热消息（只在可页内显示、预热设置开、窗口冷、没到冷却时间时发） */
export function shouldSendPrewarm(c: { prewarm: boolean; warm: boolean; active: boolean; nativeOpen: boolean; trusted: boolean; now: number; lastSent: number; resendMs: number }): boolean {
    return c.prewarm && !c.warm && c.active && !c.nativeOpen && c.trusted && c.now - c.lastSent >= c.resendMs;
}

/** 网页里的链接点击要不要先切原生：只有会进 PDF 查看器 / 商店的（chrome:// 等 Chrome 对网页自己就拦截，javascript: / mailto: / 同页锚点 / download 都不是导航到受限页） */
export function linkNeedsNative(href: string, pageUrl: string, download: boolean): boolean {
    if (download) return false;
    let u: URL, p: URL;
    try { u = new URL(href, pageUrl); p = new URL(pageUrl); } catch { return false; }
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    if (u.origin === p.origin && u.pathname === p.pathname && u.search === p.search) return false; // 同页锚点
    const k = pageKind(u.href);
    return k === "pdf" || k === "webstore";
}

/** 预热方式：off = 只 ensure-native；window = 首次手势窗口级 open 原生（互斥，页内收起）。
 *  已移除的 "tab"（标签级 enabled:false 预热）、旧的布尔和任何未知值一律按 off 处理（**不**并入 window：window 会让该窗口只剩原生，不能悄悄替用户改）；存储里的旧值由 settings.migratePrewarmTab 在后台启动时清掉。 */
export type PrewarmMode = "off" | "window";
export function parsePrewarmMode(v: unknown): PrewarmMode { return v === "window" ? "window" : "off"; }

/** 启动对账（防御性）：标签级 sidePanel 选项只在浏览器进程内存里（SW 重启保持；扩展重载清除；浏览器重启丢失——Chromium SidePanelService::panels_，见 arc-analysis/chromium-sidepanel-warm-tab.md Q3），
 *  所以「旧版本的标签级预热在 SW 重启后留下、而我们的记录已经没了」的 enabled:false 标签只能靠 getOptions 的实际值发现。返回 getOptions 报 enabled===false 的标签 id（undefined = getOptions 失败，不碰）。
 *  执行时只 setOptions({tabId, enabled:true})，**不带 path**（带 path 会创建出 close({windowId}) 关不掉的标签级实例，见同文档 Q4）。 */
export interface TabOpt { id: number; enabled: boolean | undefined }
export function planReconcile(tabs: readonly TabOpt[]): number[] { return tabs.filter(t => t.enabled === false).map(t => t.id); }

export type WindowOpenSkip = "off" | "native-mode" | "native-open" | "pending" | "not-injectable" | "no-tab";
/** 窗口级预开：只有「方式 = window + 默认页内 + 没有原生面板 + 没有进行中的 open + 当前标签可页内显示」才做；不 setOptions，不 disable 任何标签（所以不碰 E3） */
export function planWindowOpen(i: { mode: PrewarmMode; defaultMode: "inpage" | "native"; nativeOpen: boolean; pending: boolean; activeTabId: number | undefined; activeKind: PageKind }): { go: true } | { go: false; why: WindowOpenSkip } {
    if (i.mode !== "window") return { go: false, why: "off" };
    if (i.defaultMode !== "inpage") return { go: false, why: "native-mode" };
    if (i.nativeOpen) return { go: false, why: "native-open" };
    if (i.pending) return { go: false, why: "pending" };
    if (i.activeTabId == null) return { go: false, why: "no-tab" };
    if (i.activeKind !== "ok") return { go: false, why: "not-injectable" };
    return { go: true };
}
/** 预热方式从 window 改成 off（设置变化）时，要不要把「预热打开的」原生面板关掉：
 *  只关**首次手势预热**（window）开的那个（marked = 该窗口的原生是 prewarmNow 经 openNativeForWindow("prewarm") 开的、且之后没关过）；
 *  ensure-native（进受限页让位）、Alt+S / 右键菜单回落原生、工具栏图标、用户自己开的原生都**不带这个标记**，所以不会被关。
 *  原生正显示（端口在 / 核心 open 集合里）或 open 已发出还没连上（pending）才需要 close；已经没了 = 只清标记。 */
export function planOffClose(f: { mode: PrewarmMode; marked: boolean; nativeShowing: boolean; pending: boolean }): "close" | "clear" | "keep" {
    if (!f.marked) return "keep";
    if (f.mode !== "off") return "keep";
    return f.nativeShowing || f.pending ? "close" : "clear";
}
/** 原生面板关闭时是否恢复页内意图：只恢复「为进受限页 / 窗口级预开而收起的页内」（restore 集合里有该窗口），且这时原生确实没在显示 */
export function shouldRestoreInpage(f: { restoreMarked: boolean; nativeShowing: boolean; enabled: boolean }): boolean { return f.enabled && f.restoreMarked && !f.nativeShowing; }

/* ======================================================================================
 * 推开页面（DESIGN.md 3.8，补丁 09）：显示方式、推开量、哪些状态推、固定元素补偿、过渡 / 样式文本。全部纯函数，单测见 tests/inpagePush.test.ts。
 * ====================================================================================== */

/** 设置值 → 显示方式；非法 / 缺失 = 默认（推开） */
export const parseDisplayMode = (v: unknown): DisplayMode => v === "overlay" ? "overlay" : v === "push" ? "push" : DEFAULT_DISPLAY;

/** 页面让出的左侧宽度（px）= 侧栏宽 + 右留白 PUSH.gap（0）：平贴态（Arc locked）侧栏贴窗口左缘（x = 0，无 5 px 外边距），内容区 x = 侧栏 maxX = 宽（默认 228）。
 *  RTL 页面的竖直滚动条在左边（Chrome），html 的内容盒从滚动条右侧开始，所以要少推一个滚动条宽（⚠ 滚动条本身仍在侧栏下面，覆盖 / 推开两种方式都一样，⛔ 无解）。 */
export function pushOffset(width: number, rtlScrollbar = 0): number {
    return Math.max(0, Math.round(width) + PUSH.gap - Math.max(0, Math.round(rtlScrollbar)));
}

/** 容器外观：flat（= 常驻推开 = data-push="1"）还是 card（悬停浮出 / 浮在页面上方式的常驻）。DESIGN 3.8.8 */
export const boxChrome = (flat: boolean) => flat ? CHROME.flat : CHROME.card;
/** 容器是平贴（locked）还是卡片（floating）：和「页面让位」是同一个条件——推开了就是 locked，没推（浮层 / 悬停浮出）就是卡片。悬停不改变它 */
export const isFlat = (f: PushFacts) => shouldPush(f);

/** 侧栏页 color-scheme 计算值（"light" / "dark" / "light dark" / "only light" …）→ 它实际使用的方案；两者都支持时跟系统 */
export function usedScheme(colorScheme: unknown, osDark: boolean): "light" | "dark" {
    const t = typeof colorScheme === "string" ? colorScheme.toLowerCase().split(/\s+/).filter(Boolean) : [];
    const light = t.includes("light"), dark = t.includes("dark");
    if (dark && !light) return "dark"; if (light && !dark) return "light";
    return osDark ? "dark" : "light";
}
/** 浏览器计算后的颜色串（rgb() / rgba() / color(srgb …) / #hex）→ 不透明的 "rgb(r, g, b)"；认不出来 = undefined（调用方回退到 FLAT_BASE）。
 *  同时是消息校验：宿主只接受它能解析的值，不会把侧栏页发来的任意字符串写进 CSS */
export function opaqueColor(v: unknown): string | undefined {
    if (typeof v !== "string" || v.length > 80) return undefined;
    const t = v.trim().toLowerCase(); const num = (x: string) => Number.parseFloat(x);
    let m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/.exec(t);
    if (m) return `rgb(${Number.parseInt(m[1].slice(0, 2), 16)}, ${Number.parseInt(m[1].slice(2, 4), 16)}, ${Number.parseInt(m[1].slice(4, 6), 16)})`;
    m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[,/]\s*[\d.]+%?\s*)?\)$/.exec(t);
    if (m) { const c = [m[1], m[2], m[3]].map(num); return c.every(x => x >= 0 && x <= 255) ? `rgb(${c.map(Math.round).join(", ")})` : undefined; }
    m = /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*[\d.]+%?\s*)?\)$/.exec(t);
    if (m) { const c = [m[1], m[2], m[3]].map(num); return c.every(x => x >= 0 && x <= 1) ? `rgb(${c.map(x => Math.round(x * 255)).join(", ")})` : undefined; }
    return undefined;
}
/** 侧栏页根 color-scheme 计算值 → 它是不是「跟系统」（同时支持 light 与 dark，且不是 only …）。强制明暗（Themes.mode = light / dark、Space 主题按对比度定下的明暗）= 单值 = false。
 *  补丁 system-color-scheme/1：宿主据此决定 iframe 行内 color-scheme 写 "light dark"（跟系统）还是钉单值 */
export function followsSystem(colorScheme: unknown, dataTheme?: unknown): boolean {
    if (dataTheme === "light" || dataTheme === "dark") return false; // 强制明暗（Themes.mode / Space 主题 / 自适应）：sidepanel.css 只有 [data-theme=dark] 写了 color-scheme，强制 light 时根 color-scheme 仍是 light dark，不能据此判成跟系统
    const t = typeof colorScheme === "string" ? colorScheme.toLowerCase().split(/\s+/).filter(Boolean) : [];
    return t.includes("light") && t.includes("dark") && !t.includes("only");
}
/** 回报给宿主的 scheme：data-theme 强制 light 时就是 light（不随系统；否则深色系统下会回报 dark，而内容其实是浅色）；其余 = usedScheme */
export const reportedScheme = (colorScheme: unknown, dataTheme: unknown, osDark: boolean): "light" | "dark" => dataTheme === "light" ? "light" : usedScheme(colorScheme, osDark);
export interface FrameTheme { base: string; scheme: "light" | "dark"; /** 侧栏页按 Space 色算出的 maxContrastColor（可选；没有 = 用估算值） */ bar?: string; /** 侧栏页跟系统明暗（followsSystem）：宿主给 iframe 设 "light dark"，系统变了 iframe 自己重算并回报；缺省 = 强制明暗，钉单值 */ follow?: boolean }
/** iframe → 宿主的主题消息：只认 MSG.frameTheme + 可解析的 base + scheme ∈ light / dark（来源 / origin 由调用方校验）；bar 可选，同样只认可解析的颜色 */
export function parseFrameTheme(d: unknown): FrameTheme | undefined {
    const o = d as { type?: unknown; base?: unknown; scheme?: unknown; bar?: unknown; follow?: unknown } | null;
    if (!o || o.type !== MSG.frameTheme) return undefined;
    const base = opaqueColor(o.base); if (!base || (o.scheme !== "light" && o.scheme !== "dark")) return undefined;
    const bar = opaqueColor(o.bar);
    return { base, scheme: o.scheme, ...(bar ? { bar } : {}), ...(o.follow === true ? { follow: true } : {}) };
}
/** 宿主写在 iframe 元素上的 color-scheme：Chrome 把「内嵌元素的单值 color-scheme」当成 iframe 内文档的 prefers-color-scheme，所以跟系统时必须是 "light dark"（不钉），强制明暗才写单值（同时让 iframe 画布保持透明：内外 scheme 一致） */
export const frameColorScheme = (t: FrameTheme) => t.follow ? "light dark" : t.scheme;
/** 跟系统的主题与当前系统明暗不一致（系统刚切 / hint 是上次的）→ 马上换成当前系统的 FLAT_BASE 垫底（旧 bar 作废），等 iframe 重新回报；强制明暗 / 已一致 = 原对象 */
export function retargetFollow(t: FrameTheme, osDark: boolean): FrameTheme {
    const os = osDark ? "dark" : "light";
    return !t.follow || t.scheme === os ? t : { base: FLAT_BASE[os], scheme: os, follow: true };
}
/** Space 基色（CSS 颜色串，来自 --arc-space）+ 深浅 → maxContrastColor（Rea AH.1#1：PrimaryColorPalette 四档按 WCAG 相对亮度夹取；
 *  浅色外观取最暗档 T3（亮度 ≤ 0.1）、深色外观取最亮档 T0（亮度 0.85–0.95）；与资料库图标 libPalette 同一规则，HSL ±0.01 的逐步算法按「向白 / 黑混合 0.01」近似 ⚠）。认不出基色 = undefined（调用方用估算值） */
export function maxContrastOf(spaceCss: unknown, dark: boolean): string | undefined {
    const base = opaqueColor(spaceCss); if (!base) return undefined;
    const m = /rgb\((\d+), (\d+), (\d+)\)/.exec(base); if (!m) return undefined;
    const rgb: [number, number, number] = [+m[1]!, +m[2]!, +m[3]!];
    const lum = ([r, g, b]: number[]) => { const f = (c: number) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const mix = (c: number[], t: number, k: number) => c.map(v => v + (t - v) * k);
    const tone = (lo: number, hi: number): number[] => {
        for (let k = 0; k <= 1.0001; k += 0.01) { const c = mix(rgb, 255, k); if (lum(c) >= lo) { if (lum(c) <= hi) return c; break; } }
        for (let k = 0; k <= 1.0001; k += 0.01) { const c = mix(rgb, 0, k); if (lum(c) <= hi && lum(c) >= lo) return c; }
        return lum(rgb) < lo ? [255, 255, 255] : [0, 0, 0];
    };
    const c = dark ? tone(0.85, 0.95) : tone(0, 0.1);
    return `rgb(${c.map(v => Math.round(v)).join(", ")})`;
}
/** 平贴态垫的不透明底：侧栏页回报的主题底，没有 = 按宿主页面的深浅回退 */
export const flatBackground = (t: FrameTheme | undefined, osDark: boolean) => t?.base ?? (osDark ? FLAT_BASE.dark : FLAT_BASE.light);

export interface PushFacts {
    mode: DisplayMode;
    /** 常驻（展开 / 固定）：后台 show 且 iframe 没被拦。悬停浮出的临时露出（peek）不算 */
    pinned: boolean;
    /** 页面里有元素在全屏（视频等）：必须恢复页面，宿主同时被隐藏（onFs） */
    fullscreen: boolean;
}
/** 页面是否让位：只有 push 方式 + 常驻 + 非全屏。悬停浮出永远不让位（浮层不改布局）；受限页 / 原生面板没有内容脚本，也就没有这条路径 */
export const shouldPush = (f: PushFacts) => f.mode === "push" && f.pinned && !f.fullscreen;

/** 推开 / 收回过渡：默认 arc80 = Arc 常驻态切换的 0.08 s easeOutQuad；PUSH.curve = "spring" 时用与浮出同一条弹簧近似 */
export const pushTiming = (): { ms: number; easing: string } => PUSH.curve === "arc80" ? PUSH.arc80 : { ms: SPRING.durationMs, easing: SPRING.easing };

/** html 的样式文本（唯一一个拥有者写入 documentElement 的地方）：margin-left 用「原值 + 推开量」的绝对 px，retract 时回到原值再整体移除。
 *  选择器 html:root 比页面常见的 html / :root 特异性高；样式表在 adoptedStyleSheets 里排在页面样式之后，同特异性时也赢。@media screen 保证打印不受影响。 */
export function pushCss(marginLeftPx: number, animate: boolean, fit: Fit = NO_FIT): string {
    const t = pushTiming();
    const html = `margin-left: ${marginLeftPx}px !important; transition: ${animate ? `margin-left ${t.ms}ms ${t.easing}` : "none"} !important;${fit.html ? " width: auto !important;" : ""}`;
    const body = [fit.body ? "max-width: 100% !important;" : "", fit.bodyMin ? "min-width: 0 !important;" : ""].filter(Boolean).join(" ");
    return `@media screen { html:root { ${html} }${body ? ` html:root > body { ${body} }` : ""} }`;
}

/** 「占满视口」页面的横向溢出缓解（DESIGN 3.8.6）。html 的 margin-left 把 html 盒子整体右移：html{width:100%}（或 100vw）会溢出 = 推开量；body{width:100vw} / min-width:100vw 即使 html 改 auto 仍比 html 内容盒宽。
 *  只在「宽度确实贴着视口」时才动（一个宽 2600 的页面 / 固定宽 html 不在此列，它们本来就该横向滚动 / 居中）。全部在同一张样式表里，收回时随表整体消失 = 精确还原。 */
export interface FitFacts { htmlW: number; htmlMl: number; clientW: number; innerW: number; bodyW: number; bodyMinW: number }
export interface Fit { html: boolean; body: boolean; bodyMin: boolean }
export const NO_FIT: Fit = { html: false, body: false, bodyMin: false };
export function fitDecision(f: FitFacts | null | undefined): Fit {
    if (!f || !(f.clientW > 0)) return NO_FIT;
    const near = (w: number) => w >= f.clientW - PUSH.fitSlack && w <= f.innerW + 1;
    return { html: near(f.htmlW + f.htmlMl), body: near(f.bodyW), bodyMin: near(f.bodyMinW) };
}

export interface Rect { left: number; right: number; width: number; height: number }
export interface FixedShift { dx: number; maxWidth: number }
/** 固定定位元素补偿：position:fixed 相对视口，不会随 html 的 margin 移动。只处理「可见部分压进侧栏占用区（x < offset）」的元素：
 *  右移 dx = offset − left（用 margin-left，stretch 型 left:0;right:0 会同时变窄），并把 max-width 夹到 视口宽 − offset（width:100% / 100vw 不会溢出右边）。
 *  已完全在左边之外（off-canvas，right ≤ 0）/ 没有面积 / 本来就在占用区右边的不动。 */
export function fixedShift(r: Rect, offset: number, viewportWidth: number): FixedShift | null {
    if (!(r.width > 0 && r.height > 0)) return null;
    if (r.right <= 0) return null;
    if (r.left >= offset - 0.5) {
        // 没压进占用区。但 left:auto 的 fixed 元素（静态位置）会随 html margin 一起右移、宽度却仍是视口宽 → 右缘越界（真机 GitHub lp-IntroHero：left 233、w 1653、right 1886 > 1653，内容偏右 116px）：只夹 max-width，不动 margin
        if (r.left <= offset + 2 && r.right > viewportWidth + 1) return { dx: 0, maxWidth: Math.max(0, Math.floor(viewportWidth - offset)) };
        return null;
    }
    return { dx: Math.ceil(offset - r.left), maxWidth: Math.max(0, Math.floor(viewportWidth - offset)) };
}

/* —— 补丁 12：Arc 调宽把手（SidebarResizeRegionView）的宽度规则，纯逻辑（Rea arc-sidebar-resize-handle.md §3）—— */

/** 3 px 竖条要不要渲染：侧栏正显示 + 设置 showHandle 恰为 true。false / 没显示 = 竖条不在 DOM 里（含拖动中、脉冲）。8 px 热区不看设置，只要侧栏在显示就在 */
export function barVisible(i: { shown: boolean; setting: unknown }): boolean {
    return i.shown && i.setting === true;
}
export interface ArcResize {
    /** 目标宽：collapsed 时 0，否则 164–500（已吸附） */
    width: number;
    /** w < 82 → 0（Arc 拖动中的「收起」宽度） */
    collapsed: boolean;
    /** 本次落在吸附带内并吸到了 228 */
    snapped: boolean;
    /** 吸附是否已武装：拖动中至少离开过一次 14 带（从 228 起手拖，需先拖出 14 才会吸回） */
    armed: boolean;
    /** trunc(起始 + 位移)：松手时的收起判定（≤ 82）用它，不用夹取后的宽度 */
    raw: number;
}
/** ✅ w = trunc(起始 + 位移)；w < 82 → 0；否则 clamp 164–500（82–164 → 164）；|228 − w| < 14 且已武装 → 228。非有限数 → 起始宽原样夹取 */
export function arcResizeWidth(startWidth: number, dx: number, armed: boolean): ArcResize {
    const raw = Number.isFinite(startWidth + dx) ? Math.trunc(startWidth + dx) : clampWidth(startWidth);
    if (raw < HANDLE.collapseBelow) return { width: 0, collapsed: true, snapped: false, armed: true, raw }; // 0 离 228 远远超过 14 带 → 已武装
    let w = Math.min(ARC.maxWidth, raw); if (w < ARC.minWidth) w = ARC.minWidth;
    if (Math.abs(HANDLE.snapWidth - w) >= HANDLE.snapBand) return { width: w, collapsed: false, snapped: false, armed: true, raw };
    return armed ? { width: HANDLE.snapWidth, collapsed: false, snapped: true, armed, raw } : { width: w, collapsed: false, snapped: false, armed, raw };
}
export interface ResizeMove { width: number; collapsed: boolean; snapped: boolean; /** 刚吸上（上一次没吸、这次吸了）→ 竖条脉冲 */ pulse: boolean; raw: number }
export interface ResizeRelease {
    /** 松手要写 / 落盘的宽度：收起 = min(500, 起始宽)（恢复起始宽）；否则最后一次 move 的宽度（164–500，已吸附） */
    width: number;
    /** 收起页内侧栏（等同 Alt+S 页内关闭）：只在 locked 起手且 Int(起始 + 位移) ≤ 82 */
    collapse: boolean;
}
/** 一次拖动的状态机：begin 时的宽度 + 每次 move 的累计位移（clientX − 起点 X）。
 *  Arc 的收起判定只看 WindowState.sidebarMode（anchored / noChrome），不看 locked / floating（Rea AH.1#7）：anchored（默认，页内 locked 与 floating 都算）→ 拖动中 w < 82 实时宽 0，松手 Int ≤ 82 → release().collapse；
 *  noChrome（页内没有这个模式；保留给调用方）：不收起，w < 82 按 164（旧 floating 决定）。floating 收起后的结果（hideSidebarWithGesture 的 reducer）⛔ 未追到，页内先实现为「收起 / 收回浮出」。
 *  吸附反馈（脉冲）冷却：Arc 脉冲 + 触觉在带内 state[5]==1 时触发一次后置 0，离开带且距上次 > 0.5 s 才恢复 → now 可注入（单测） */
export function createResizeDrag(startWidth: number, o: { noChrome?: boolean; now?: () => number } = {}) {
    const start = Number.isFinite(startWidth) ? Math.trunc(startWidth) : ARC.defaultWidth;
    const now = o.now ?? (() => Date.now());
    let armed = Math.abs(HANDLE.snapWidth - start) >= HANDLE.snapBand, snapped = false, fbAllowed = true, lastFb = Number.NEGATIVE_INFINITY, // 起手就在 14 带外 = 已武装（Arc 是逐样本离开带才置位，连续输入下等价；一次大跳变时此写法更稳 ⚠）
        last: ResizeMove = { width: startWidth, collapsed: false, snapped: false, pulse: false, raw: start };
    return {
        move(dx: number): ResizeMove {
            const t = now(); const r = arcResizeWidth(startWidth, dx, armed); armed = r.armed;
            let pulse = false;
            if (r.snapped) { if (!snapped && fbAllowed) { pulse = true; fbAllowed = false; lastFb = t; } }
            else if (!fbAllowed && t - lastFb > HANDLE.pulseCooldownMs) fbAllowed = true; // 离开带且距上次反馈 > 0.5 s → 再允许
            snapped = r.snapped;
            last = { width: r.collapsed && o.noChrome ? ARC.minWidth : r.width, collapsed: r.collapsed, snapped: r.snapped, pulse, raw: r.raw };
            return last;
        },
        get last() { return last; },
        /** cancelled = pointercancel / 把手被摘掉（Arc cancelled / failed 分支）：夹 164–500、不收起 */
        release(cancelled = false): ResizeRelease {
            if (cancelled) return { width: clampWidth(last.width), collapse: false };
            if (!o.noChrome && last.raw <= HANDLE.collapseOnReleaseAtMost) return { width: Math.min(ARC.maxWidth, start), collapse: true };
            return { width: last.width, collapse: false };
        },
    };
}

/** floating 收起后的「防回弹」守卫：floating 拖到 ≤82 松手 → 收回浮出，但松手点通常还在左缘触发条（0–50 px）里，收回后触发条立刻出现在指针下，
 *  pointerenter → 160 ms 停留 → 又浮出来 = 看起来「没收起」（headed 实测：松手 x≈33，700 ms 后 shown=1）。守卫在松手点落在触发条内时武装，
 *  指针离开触发条（pointerleave）前不再起停留计时；松手点在触发条外则不武装（下次正常进入照常浮出）。 */
export function createRepeekGuard() {
    let armed = false;
    return {
        /** 松手点 clientX（负数 = 指针被夹在窗口外，同样算在左缘内） */
        arm(releaseX: number) { armed = Number.isFinite(releaseX) && releaseX < ARC.triggerNarrow; return armed; },
        get blocking() { return armed; },
        /** 触发条 pointerleave */
        leave() { armed = false; },
    };
}

/** 收起闸（补丁 12 修正）：locked / floating 拖到 ≤82 松手收起时，live 宽已是 0（Arc：w<82 实时宽 0）；后台随后下发「宽度 = 起始宽 + 收起」，
 *  若 render 在同一帧把 --w 恢复成起始宽、同时 data-shown=0，侧栏会以全宽闪一帧再滑出。闸把「恢复起始宽」推迟到下次展开：
 *  begin（松手发 collapse）后 width() 一直返回 0，直到「出现过 shown=false」且「之后又 shown=true」才放行；
 *  后台没收起（始终 shown）→ expire(shown) 超时放行。非收起路径（Alt+S 关闭、鼠标移出 floating 收回）不经过闸，宽度照旧保持。 */
export function createCollapseGate() {
    let hold = false, sawHidden = false;
    return {
        get holding(): boolean { return hold; },
        begin(): void { hold = true; sawHidden = false; },
        /** render 每次调用：返回这次该写的 --w（闸住 = 0；否则 clampWidth(存储宽)） */
        width(shown: boolean, stored: number): number {
            if (hold) { if (!shown) sawHidden = true; else if (sawHidden) hold = false; }
            return hold ? 0 : clampWidth(stored);
        },
        /** 兜底：超时后仍在显示（后台没收起 / 状态丢了）→ 放行；返回是否已放行 */
        expire(shown: boolean): boolean { if (shown) hold = false; return !hold; },
        release(): void { hold = false; sawHidden = false; },
    };
}
/** 双击把手 = 重置为默认宽 228（Arc kind=2 事件，payload 228；之后是否动画 ⛔） */
export const resetWidth = (): number => HANDLE.snapWidth;

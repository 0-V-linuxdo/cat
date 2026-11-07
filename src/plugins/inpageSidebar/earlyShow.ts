/* 页内侧边栏：「提前显示」的纯逻辑（补丁 inpage-early-show；无 chrome / DOM 依赖，单测见 tests/inpageEarlyShow.test.ts）。
 * 背景：内容脚本 document_start 就能建宿主壳，但「该不该显示、多宽、什么底色」原来要等 后台端口握手（hello → state）才知道；SW 冷启动时这一段可达数百 ms，页面已经先画了一帧全宽。
 * 做法：把「上一次已知的常驻状态」存成一个小「提示」（hint），新页面起来时先按它建壳 + 推开页面，等后台的真实状态到了再校正（幂等，状态一致就什么都不变）。
 *  · 第 1 层 sessionStorage（页面同源、同一标签，**同步**可读；同标签同源导航 / 刷新命中；含 win / tab，可以直接建 iframe）。
 *  · 第 2 层 chrome.storage.local（任意站点，**异步**一次 IPC；跨站导航 / 新标签命中；没有 win / tab，只先出壳 + 推开，iframe 等真实状态）。
 * 提示只影响「先画什么」，永远不是权威：后台状态一到就按它整体对齐；提示被页面伪造 / 过期最多是多画一小会儿壳，所有字段都过 parseHint 校验。
 * 约束：本文件不 import chrome.* / @api/ErrorLog，不出现控制台调用。 */
import type { StateMsg } from "./background";
import { clampWidth, type FrameTheme, opaqueColor, retargetFollow } from "./logic";
import { parseDisplayMode } from "./logic";

export const EARLY = {
    /** 第 1 层：sessionStorage 键（页面同源可见，⚠ 页面脚本可读 / 可清 / 可伪造——只含宽度、颜色、布尔和两个 id，校验后才用） */
    sessionKey: "__arcInpageHint",
    /** 第 2 层：chrome.storage.local 键（⚠ 数据插件的备份 dump() 会把它导出 / 恢复，无害：恢复回来的旧提示会被第一个真实状态覆盖） */
    localKey: "data:inpageSidebarHint",
    /** 第 2 层总开关（false = 只用 sessionStorage） */
    localHint: true,
    version: 1,
    /** 内容脚本启动后多久以内算「新页面」：这段时间里第一个 active 状态不播推开 / 滑入动画（SW 冷启动的第一条状态常常是 active:false） */
    freshMs: 2000,
    /** 乐观壳已显示时，收到「inactive」状态先等这么久（visibilityState 为 visible 的标签不可能真的 inactive：冷 SW 里 activeByWin 还没建好），等不到 active 才照做 */
    inactiveGraceMs: 600,
    /** 设置里本插件的名字（plugins.InpageSidebar.enabled）：早实例在设置框架就绪前就要判断，只读这一个布尔 */
    pluginName: "InpageSidebar",
} as const;

export interface Hint {
    v: number;
    show: boolean;
    width: number;
    /** 侧栏页回报的主题底色（opaqueColor 校验过）与 color-scheme */
    base?: string;
    scheme?: "light" | "dark";
    /** 补丁 system-color-scheme/1：侧栏页当时是「跟系统」（FrameTheme.follow）。有它 = hint 里的 base / scheme 只是上次系统明暗下的值，首帧要按当前系统校正（hintTheme） */
    fw?: boolean;
    /** 仅第 1 层：宿主窗口 / 标签 id（同标签导航不变；标签被拖进别的窗口会过期——真实状态到了会重建 iframe） */
    win?: number;
    tab?: number;
    /** 补丁 residual：显示方式 / 悬停浮出 / 把手——早实例在设置框架就绪前就要乐观建壳，不能读设置，只能用上次真实状态里的值（真实状态一到就以它为准） */
    dm?: "push" | "overlay";
    hv?: boolean;
    hd?: boolean;
}

const posInt = (v: unknown) => typeof v === "number" && Number.isInteger(v) && v > 0 ? v : undefined;

/** 校验 + 规整（页面可写 sessionStorage，所以一切字段都当不可信：版本、布尔、宽度夹取、颜色只认 opaqueColor、scheme 只认 light / dark、id 只认正整数） */
export function parseHint(raw: unknown): Hint | undefined {
    const o = raw as Partial<Record<keyof Hint, unknown>> | null;
    if (!o || typeof o !== "object" || o.v !== EARLY.version || typeof o.show !== "boolean") return undefined;
    const base = opaqueColor(o.base), scheme = o.scheme === "light" || o.scheme === "dark" ? o.scheme : undefined;
    const win = posInt(o.win), tab = posInt(o.tab);
    const dm = o.dm === "push" || o.dm === "overlay" ? o.dm : undefined;
    return {
        v: EARLY.version, show: o.show, width: clampWidth(o.width), ...(base && scheme ? { base, scheme, ...(o.fw === true ? { fw: true } : {}) } : {}), ...(win && tab ? { win, tab } : {}),
        ...(dm ? { dm } : {}), ...(typeof o.hv === "boolean" ? { hv: o.hv } : {}), ...(typeof o.hd === "boolean" ? { hd: o.hd } : {}),
    };
}

/** 当前真实状态 → 要记下的提示。只在「真实状态已到、本标签是活动标签、页面可见、iframe 没被拦」时记（别的情形记了会误导下一个页面） */
export function hintFromState(c: { st: Pick<StateMsg, "active" | "show" | "width" | "windowId" | "tabId"> & Partial<Pick<StateMsg, "displayMode" | "hover" | "handle">> | undefined; theme: FrameTheme | undefined; blocked: boolean; visible: boolean; real: boolean }): Hint | undefined {
    const s = c.st;
    if (!s || !c.real || !s.active || c.blocked || !c.visible) return undefined;
    return { v: EARLY.version, show: !!s.show, width: clampWidth(s.width), ...(c.theme ? { base: c.theme.base, scheme: c.theme.scheme, ...(c.theme.follow ? { fw: true } : {}) } : {}), ...(posInt(s.windowId) && posInt(s.tabId) ? { win: s.windowId, tab: s.tabId } : {}),
        ...(s.displayMode === "push" || s.displayMode === "overlay" ? { dm: s.displayMode } : {}), ...(typeof s.hover === "boolean" ? { hv: s.hover } : {}), ...(typeof s.handle === "boolean" ? { hd: s.handle } : {}) };
}
export const sameHint = (a: Hint | undefined, b: Hint | undefined) => !!a && !!b && a.show === b.show && a.width === b.width && a.base === b.base && a.scheme === b.scheme && a.fw === b.fw && a.win === b.win && a.tab === b.tab && a.dm === b.dm && a.hv === b.hv && a.hd === b.hd;
/** 第 2 层（跨标签 / 跨站）不带 win / tab：它们只对「同一标签」有意义 */
export const withoutIds = (h: Hint): Hint => ({ v: h.v, show: h.show, width: h.width, ...(h.base && h.scheme ? { base: h.base, scheme: h.scheme, ...(h.fw ? { fw: true } : {}) } : {}), ...(h.dm ? { dm: h.dm } : {}), ...(h.hv != null ? { hv: h.hv } : {}), ...(h.hd != null ? { hd: h.hd } : {}) });

/** 提示 → 首帧垫底用的主题。fw（上次是跟系统）且 hint 记的 scheme 与当前系统不一致 → 回退当前系统的 FLAT_BASE（不让旧明暗的底色先亮后暗）；没有 fw（强制明暗 / 旧提示）= 原值 */
export const hintTheme = (h: Hint, osDark: boolean): FrameTheme | undefined => h.base && h.scheme ? retargetFollow({ base: h.base, scheme: h.scheme, ...(h.fw ? { follow: true } : {}) }, osDark) : undefined;

/** 提示 → 乐观状态（不是后台发的，只喂 render）。显示方式 / 悬停 / 把手开关来自内容脚本里同步可读的设置；没有 win / tab（0）= 先出壳，不建 iframe */
export function hintToState(h: Hint, s: { displayMode: unknown; hover: boolean; handle: boolean }): StateMsg {
    return {
        type: "inpage:state", windowId: h.win ?? 0, tabId: h.tab ?? 0, active: true, show: h.show, nativeOpen: false, prewarm: false, warm: false,
        width: h.width, displayMode: parseDisplayMode(s.displayMode), hover: s.hover, handle: s.handle,
    };
}
/** 只有同时知道 win / tab 才能建 iframe（?win= / &tab= 在 URL 里；不带会让命令栏等取 NaN） */
export const canBuildFrame = (st: Pick<StateMsg, "windowId" | "tabId"> | undefined) => !!st && posInt(st.windowId) != null && posInt(st.tabId) != null;
/** 已建的 iframe 的 win / tab 与真实状态不一致（标签被拖到别的窗口 / 提示过期）→ 要重建 */
export const frameStale = (f: { win: number; tab: number } | undefined, st: Pick<StateMsg, "windowId" | "tabId"> | undefined) => !!f && !!st && (f.win !== st.windowId || f.tab !== st.tabId);

/** 乐观壳已显示、第一个真实状态却是 inactive：visible 的标签不可能真的 inactive（冷 SW 的 activeByWin 还没建好）→ 先等一小会儿，别把壳收起又弹出 */
export const shouldDeferInactive = (c: { hinted: boolean; realSeen: boolean; active: boolean; visible: boolean }) => c.hinted && !c.realSeen && !c.active && c.visible;
/** 这条状态是不是「新页面里第一次把侧栏摆上」：不播动画。has = 已有任何状态（含乐观）；activated = 已经摆过 active 状态；fresh = 内容脚本启动不久 */
export const isFirstPlacement = (c: { hasState: boolean; activated: boolean; fresh: boolean }) => !c.hasState || (!c.activated && c.fresh);
/** 乐观壳只给「用户正看着的、真页面」：后台标签 / 预渲染不建（否则每个后台加载的标签都建一个 iframe，违背「一窗口一个活动 iframe」） */
export const mayShowOptimistic = (c: { visible: boolean; prerendering: boolean; hint: Hint | undefined }) => c.visible && !c.prerendering && !!c.hint?.show;

/** 补丁 residual：早实例的设置环境 = 提示里记的值（没有记就用默认：push / 悬停关 / 把手默认值）。不读设置——此时设置框架还没就绪 */
export const hintEnv = (h: Hint, defaultHandle: boolean): { displayMode: unknown; hover: boolean; handle: boolean } => ({ displayMode: h.dm, hover: h.hv ?? false, handle: h.hd ?? defaultHandle });

/** 补丁 residual：从 chrome.storage.local 里的设置原始值（ArcSidebarSettings）判断本插件是否启用。只认 plugins.InpageSidebar.enabled === true（本插件 enabledByDefault:false，没存 = 关） */
export function earlyPluginEnabled(raw: unknown): boolean {
    const plugins = (raw as { plugins?: unknown } | null | undefined)?.plugins;
    if (!plugins || typeof plugins !== "object") return false;
    const me = (plugins as Record<string, unknown>)[EARLY.pluginName];
    return !!me && typeof me === "object" && (me as { enabled?: unknown }).enabled === true;
}

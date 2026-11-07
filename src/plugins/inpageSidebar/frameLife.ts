/* 页内侧栏：iframe 的生命周期决策（补丁 inpage-tab-shake；纯逻辑，无 chrome / DOM 依赖，单测见 tests/inpageFrameLife.test.ts）。
 * 背景：rel52 每次标签失活都 destroyFrame()，切回来重建 iframe：空白 3–7 帧（80–150 ms，最长 311 ms）才出标签行，随后 applyBg / postLook 再改 1–2 次底色（D 段实测，几何量不抖）。
 * 做法：失活的标签「停放」iframe（文档、滚动位置、列表都留着，切回 = 什么都不重建）。补丁 inpage-park-forever：停放**没有时限也没有数量上限**——只在标签真实关闭 / 页面导航 / 被 Chrome 丢弃（整页没了）/ blocked / stale / teardown 时销毁；原来的 FRAME.parkMs 到点销毁（60 s）与 parkExpired 一并删除。
 *       被销毁后重建的 iframe 带 ?look=flat|card（面板启动时同步套上外观）并且 ready 之前不可见（宿主 --bg 垫底），不再「白 → 出行 → 换色」。
 * 约束：本文件不 import chrome.* / 不出现控制台调用。 */

/** 宿主 → iframe（postMessage）：{ type, idle: boolean }：这份 iframe 现在是不是「停放」（所在标签不是前台）。面板据此：不执行 CMD（否则每个停放的 iframe 各执行一遍）、不写滚动位置、跟随别的标签写进去的滚动位置 */
export const FRAME_IDLE_MSG = "arc-inpage-idle";

export interface FrameLifeIn {
    /** 内容脚本自毁（设置里关掉插件 / 扩展重载 / 协议号不一致 stale） */
    teardown: boolean;
    /** 本标签是窗口的活动标签（后台 active，或可见且已收到真实状态） */
    active: boolean;
    /** 侧栏盒子要显示（常驻展开，或悬停浮出中） */
    shown: boolean;
    /** 这次导航内已确认 iframe 被拦（CSP / 握手超时） */
    blocked: boolean;
    hasFrame: boolean;
    /** 现有 iframe 的 win / tab 与真实状态不一致（frameStale） */
    stale: boolean;
    /** 状态里有 win / tab，建得了 iframe（乐观状态没有） */
    canBuild: boolean;
    /** 现有 iframe 当前是停放状态 */
    parked: boolean;
}
export interface FrameLifeOut { destroy: boolean; build: boolean; park: boolean; unpark: boolean }

/** 一次 render 对 iframe 做什么。顺序约定：destroy → park / unpark → build（destroy + build 同时为真 = 重建）。
 *  决策表（hasFrame 非 stale 时）：
 *   自毁            → 销毁
 *   失活            → 停放（blocked → 销毁）；已停放 → 什么都不做（没有计时器：停放不过期）
 *   激活            → 已停放 = 取消停放；没停放 = 什么都不做
 *  没有 iframe：
 *   失活 / 自毁     → 什么都不做
 *   激活 且 shown 且 非 blocked 且 canBuild → 建
 *  stale（不论活动与否）→ 销毁；激活时按「没有 iframe」继续（可重建）。
 *  受限页（chrome:// 等）没有内容脚本，不在此表内：那一页本来就没有 iframe；该窗口别的标签收到 active:false → 失活行（停放，不过期）。 */
export function frameDecision(c: FrameLifeIn): FrameLifeOut {
    const out: FrameLifeOut = { destroy: false, build: false, park: false, unpark: false };
    if (c.teardown) { out.destroy = c.hasFrame; return out; }
    const has = c.hasFrame && !c.stale;
    if (c.hasFrame && c.stale) out.destroy = true;
    if (!c.active) {
        if (!has) return out;
        if (c.blocked) { out.destroy = true; return out; }
        out.park = !c.parked;
        return out;
    }
    if (has) { out.unpark = c.parked; return out; }
    out.build = c.shown && !c.blocked && c.canBuild;
    return out;
}

/** iframe URL 的外观参数：flat（常驻推开的平贴态）/ card（浮出卡片）；其余（旧 URL / 被改）= 无 */
export const parseLookParam = (search: string): "flat" | "card" | undefined => {
    const v = new URLSearchParams(search).get("look");
    return v === "flat" || v === "card" ? v : undefined;
};

/** 停放中的 iframe 要不要跟随别的标签写进 chrome.storage.session 的滚动位置：只在停放时跟（前台的 iframe 自己说了算），差 ≤1 px 不动 */
export const shouldFollowScroll = (i: { idle: boolean; current: number; next: number }): boolean => i.idle && Number.isFinite(i.next) && Math.abs(i.current - i.next) > 1;

/* 媒体托盘的「停放时哪些标签事件值得重读」判据（补丁 inpage-parked-timers-stop-b，rel55 第 18b 层）。纯函数，无副作用、无 import。
 * 背景：媒体托盘（默认开）的行 = tabs.query({}) 里 audible 且未静音的标签 + 打开的 Google Meet 标签。停放的 iframe 若不随事件刷新，
 *   切回时「停放期间才出现的行」要等 tabs.query + executeScript 探测的异步往返（r56e 实测前 4 帧为空）。所以停放时监听仍挂着，但只对「会改变托盘内容」的事件做重读：
 *   · audible / mutedInfo 变化：永远相关（行的出现 / 消失）。
 *   · url 变化：只有两种情况会改变托盘 —— 新网址是 Meet 通话，或这个标签已在托盘里（行里的 favicon / 网址要跟着变）；其余标签换网址与托盘无关（原来的 reload 对它们是白做的）。
 *   · 标签关闭：只有已在托盘里的标签关闭才相关。
 *   未停放（parked=false）时与原行为逐字一致（任何 url / audible / mutedInfo 变化都重读；任何关闭都重读）。 */
export const MEET_RE = /^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}/;

export interface UpdatedInfo { url?: string; audible?: boolean; mutedInfo?: unknown }

/** tabs.onUpdated 是否需要排一次 reload（trackedIds = 当前托盘里的媒体行 + Meet 行的标签 id） */
export function updateMatters(id: number, c: UpdatedInfo, trackedIds: ReadonlySet<number>, parked: boolean): boolean {
    const hasUrl = "url" in c, hasSound = "audible" in c || "mutedInfo" in c;
    if (!hasUrl && !hasSound) return false;
    if (!parked || hasSound) return true;
    return trackedIds.has(id) || MEET_RE.test(c.url ?? "");
}

/** tabs.onRemoved 是否需要排一次 reload */
export function removalMatters(id: number, trackedIds: ReadonlySet<number>, parked: boolean): boolean {
    return !parked || trackedIds.has(id);
}

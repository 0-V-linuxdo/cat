/* 页内侧边栏宿主模式（patch 03）。
 * sidepanel.html 被「页内侧边栏」插件的内容脚本以 iframe 嵌入网页时，URL 带 ?host=inpage&win=<宿主窗口id>&tab=<宿主标签id>。
 * 这时本页是「扩展页 iframe」：chrome.windows.getCurrent() / tabs.getCurrent() 在 iframe 里返回的是**宿主网页**所在的窗口 / 标签（P0 E5 实测），
 * 但它不是原生侧栏，所以：不能连 `panel:<winId>` 端口（会让后台把原生面板当成“开着”），要取窗口 id 一律走 currentWindow()。
 * 非 inpage（原生侧栏 / ?popup= / ?win=）下 currentWindow() ≡ chrome.windows.getCurrent()，行为完全不变。
 * `?host=inpage` 与 `?win=` / `?popup=` 不冲突：tabState 早就优先读 ?win=；sidepanel.ts 的失焦即关只对 ?popup=。 */
const params = (search?: string) => new URLSearchParams(search ?? (typeof location !== "undefined" ? location.search : ""));
const posInt = (v: string | null) => { const n = Number(v); return v != null && Number.isInteger(n) && n > 0 ? n : undefined; };

export const isInpageHost = (search?: string): boolean => params(search).get("host") === "inpage";
/** 宿主窗口 id：仅 inpage 且 ?win= 合法时有值 */
export const hostWindowId = (search?: string): number | undefined => isInpageHost(search) ? posInt(params(search).get("win")) : undefined;
/** 补丁 tab-shake：本 iframe 现在是「停放」（所在标签不是前台，宿主留着它备切回）。宿主经 postMessage 通知，panel.ts 在 <html> 上打 data-inpage-parked；停放的 iframe 不执行 CMD（否则每个停放的 iframe 各跑一遍） */
export const isParkedHost = (search?: string): boolean => isInpageHost(search) && typeof document !== "undefined" && document.documentElement?.dataset.inpageParked === "1";
export const hostTabId = (search?: string): number | undefined => isInpageHost(search) ? posInt(params(search).get("tab")) : undefined;

/** 代替 chrome.windows.getCurrent()：inpage 且带 ?win= → windows.get(win)（不依赖 iframe 的 getCurrent 语义）；否则原样 getCurrent */
export function currentWindow(): Promise<chrome.windows.Window> {
    const id = hostWindowId();
    return id != null ? chrome.windows.get(id) : chrome.windows.getCurrent();
}
/** 只要窗口 id（inpage 下同步已知，不发 IPC） */
export async function currentWindowId(): Promise<number | undefined> {
    return hostWindowId() ?? (await chrome.windows.getCurrent()).id;
}

/* —— 页内侧栏里「先切到原生侧边栏、再进受限页」的共享 helper（硬要求，DESIGN.md 3.5） ——
 * 受限页（chrome:// / 扩展页 / 商店 / PDF / about: 等）内容脚本进不去，页内侧栏在那里显示不出来。切换必须在**进入之前**完成，不能到了再回落。
 * 页内侧栏（?host=inpage 的 iframe，或由它派生的命令栏弹窗 ?via=inpage）里，凡是会把当前窗口带进受限页的操作（新建标签 / 激活标签 / 导航 / 打开 chrome:// 链接），
 * 在**用户手势的同步栈里、第一件事**调用 ensureNativeBeforeNavigate(目标 url)，再做导航 / 激活。
 * 它只做一件事：同步 chrome.runtime.sendMessage 给 SW；SW 顶层同步 onMessage 里 openPanelInGesture（前面没有 await）。
 * ⚠ 待 E8：手势从 iframe（扩展页）/ 弹窗经 runtime.sendMessage 到 SW 是否仍有效，以及 await 之后调用（标 ⚠ 的调用点）还能撑多久。
 * 不在页内上下文（原生侧栏 / 后台 / 插件未启用时根本没有 iframe）：什么都不做，返回 false —— 插件关闭 = 行为完全不变。 */

/** 页面种类：http/https 之外、商店、PDF 查看器一律不能页内显示（插件 logic.pageKind 复用这里，单一来源）；file: 不在 web_accessible_resources 的 matches 里 */
export type PageKind = "ok" | "no-url" | "scheme" | "webstore" | "pdf";
export function pageKind(url: string | undefined): PageKind {
    if (!url) return "no-url";
    let u: URL;
    try { u = new URL(url); } catch { return "no-url"; }
    if (u.protocol !== "http:" && u.protocol !== "https:") return "scheme"; // chrome:// / chrome-extension:// / file: / about: / view-source: …
    if (u.hostname === "chromewebstore.google.com" || (u.hostname === "chrome.google.com" && u.pathname.startsWith("/webstore"))) return "webstore";
    if (u.pathname.toLowerCase().endsWith(".pdf")) return "pdf"; // ⚠ 只能按 URL 判断；无 .pdf 后缀的 PDF 由握手超时兜底
    return "ok";
}

export const ENSURE_NATIVE_MSG = "inpage:ensure-native";
/** SW 的同步应答（patch 07）：open 已发出 */
export const ENSURE_NATIVE_ACK = "inpage:ensure-native-ack";
export type NavKind = "create" | "activate" | "navigate";
export interface EnsureNativeMsg {
    type: typeof ENSURE_NATIVE_MSG;
    /** 目标 url；新建标签不带 url = chrome://newtab */
    url?: string;
    kind: NavKind;
    /** 目标标签（激活标签时 = 被激活的标签；navigate 缺省 = 发消息的标签 / 窗口的活动标签，SW 自己推）。预热时用来判断「目标是不是被我们 disable 的标签」 */
    tabId?: number;
    /** 宿主窗口（iframe / 弹窗的 ?win=）；SW 优先用 sender.tab.windowId（iframe 有，弹窗没有） */
    windowId?: number;
}

/** ?via=inpage：由页内侧栏派生的命令栏弹窗（不能用 host=inpage，它会让 currentWindow() 在弹窗里走 windows.get） */
export const viaInpage = (search?: string): boolean => params(search).get("via") === "inpage";
/** 页内侧栏上下文：iframe 或它派生的弹窗 */
export const inpageContext = (search?: string): boolean => isInpageHost(search) || viaInpage(search);
const ctxWindowId = (search?: string): number | undefined => isInpageHost(search) || viaInpage(search) ? posInt(params(search).get("win")) : undefined;

/** 目的地是不是受限页（纯函数，单测）：新建标签没有 url = chrome://newtab（受限）；激活 / 导航拿不到 url = 未知，不动（⚠ 宁可漏也不要无谓打开原生） */
export function destinationNeedsNative(url: string | null | undefined, kind: NavKind): boolean {
    if (url == null || url === "") return kind === "create";
    return pageKind(url) !== "ok";
}

/** 要不要发、发什么（纯函数，单测）：不在页内上下文 / 目的地不是受限页 → undefined */
export function ensureNativeMsg(url: string | null | undefined, kind: NavKind, tabId: number | undefined, search?: string): EnsureNativeMsg | undefined {
    if (!inpageContext(search) || !destinationNeedsNative(url, kind)) return undefined;
    return { type: ENSURE_NATIVE_MSG, kind, ...(url ? { url } : {}), ...(tabId != null ? { tabId } : {}), ...(ctxWindowId(search) != null ? { windowId: ctxWindowId(search) } : {}) };
}

/** 同步；调用方必须在用户手势的同步栈里、导航 / 激活之前第一件事调用。返回是否已发出消息（只给测试 / 日志）。
 * 这是「发了不等」的老接口；会接着导航的调用点请用下面的 navigateAfterNative（等 SW 的 ack 再导航，保证顺序，patch 07）。 */
export function ensureNativeBeforeNavigate(url: string | null | undefined, kind: NavKind = "navigate", tabId?: number, search?: string): boolean {
    const msg = ensureNativeMsg(url, kind, tabId, search);
    if (!msg) return false;
    if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) return false;
    try { void Promise.resolve(chrome.runtime.sendMessage(msg)).catch(() => undefined); } catch { /* 扩展上下文已失效：不阻塞后面的导航 */ }
    return true;
}

/* —— patch 07：消息与导航的顺序（ack）+ 手势有效期降级 ——
 * 问题：iframe 的 sendMessage 与随后的 tabs.update / tabs.create 是两条独立的跨进程请求，到达顺序没有保证。
 * 做法：SW 在顶层同步 onMessage 里先 sidePanel.open（手势在这一栈里用掉），**随后同步 sendResponse(ack)**；页面端等到 ack 再导航。
 *   - 等 ack 不影响导航：tabs.update / tabs.create 不需要手势，只有 sidePanel.open 需要，而它已在 SW 那一栈里发出了。
 *   - ack = SW 已发出 open 请求（不是面板已显示；open 的 Promise 不等）。⚠ 「面板显示早于导航生效」没有人眼验证（MANUAL I11 / I21）。
 *   - 超时兜底 ENSURE_NATIVE_ACK_MS：SW 死了 / 没装插件 / 没人应答 → 超时后照常导航，从不无限阻塞。 */
export const ENSURE_NATIVE_ACK_MS = 500;
/** 手势有效期预算：E8 实测 点击→消息 ≤3002 ms 成功、6002 ms 失败（瞬时激活约 5 s）；取 3000 ms，超过就不再发（发了也大概率被 Chrome 拒） */
export const NATIVE_GESTURE_BUDGET_MS = 3000;

export interface NativeOpts {
    /** 触发这次操作的用户手势的时间（Date.now()）。晚于 NATIVE_GESTURE_BUDGET_MS = 手势大概率已过期 → 降级：不发消息，直接导航（兜底 = 按钮 / 角标 / 快捷键） */
    gestureAt?: number;
    /** drop / 键盘转发这类「事件本身不是激活触发事件」的调用点：要求本文档当前确有瞬时激活（navigator.userActivation.isActive）；API 缺失 / 无激活 = 降级 */
    needActive?: boolean;
    /** 测试用 */
    search?: string; ackMs?: number; now?: number;
}
/** 这次手势还能不能用（纯函数，单测）。没给 gestureAt / needActive = 不判断（调用点本身就在手势栈里） */
export function nativeGestureUsable(o: Pick<NativeOpts, "gestureAt" | "needActive" | "now">, ua?: { isActive?: boolean } | null): boolean {
    if (o.gestureAt != null && (o.now ?? Date.now()) - o.gestureAt > NATIVE_GESTURE_BUDGET_MS) return false;
    if (o.needActive && ua?.isActive !== true) return false;
    return true;
}

/** 发消息并返回「ack / 出错 / 超时」三者先到者的 Promise（永不 reject）；没发（不在页内 / 目的地不受限 / 手势已过期 / 无 chrome.runtime）= 返回 undefined，调用方不需要 await */
export function ensureNativeAck(url: string | null | undefined, kind: NavKind = "navigate", tabId?: number, o: NativeOpts = {}): Promise<void> | undefined {
    const msg = ensureNativeMsg(url, kind, tabId, o.search);
    if (!msg) { notifySidebarSwitch(url, kind, tabId, o.search); return undefined; } // patch switch-auto：不是「进受限页」→ 原生侧栏里点到普通页的标签时，告诉后台切回页内（不需要手势、不等 ack、调用方仍同步往下走）
    if (!nativeGestureUsable(o, typeof navigator !== "undefined" ? navigator.userActivation : undefined)) return undefined; // 降级：⚠ 不发（Chrome 大概率拒绝），导航照常
    if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) return undefined;
    let sent: Promise<unknown>;
    try { sent = Promise.resolve(chrome.runtime.sendMessage(msg)); } catch { return Promise.resolve(); /* 扩展上下文已失效：不阻塞 */ }
    return new Promise<void>(resolve => {
        pendingEnsure++; // patch 08：等 ack 期间命令栏弹窗不能因失焦被自己关掉（nativeEnsurePending）
        let settled = false; let t: ReturnType<typeof setTimeout> | undefined;
        const done = () => { if (settled) return; settled = true; clearTimeout(t); pendingEnsure--; resolve(); };
        t = setTimeout(done, o.ackMs ?? ENSURE_NATIVE_ACK_MS);
        sent.then(done, done);
    });
}
/* —— patch switch-auto：原生侧栏（或非页内的命令栏弹窗）里点标签 → 目的地是普通网页 → 后台把原生关掉、恢复页内侧栏 ——
 * 反方向（页内 → 受限页）早就由上面的 ensure-native 做了；这条是「原生 → 页内」。**不需要手势**：关闭原生面板（sidePanel.close）本来就不要手势，
 * 所以这里发了就走（fire-and-forget），不等 ack、不影响调用方的同步性（ensureNativeAck 仍返回 undefined → go 同步执行）。
 * 只在原生侧栏 / 弹窗上下文发（插件的 panel 钩子 startPanel 装开关；插件没启用 = 开关永远是 false = 一条消息都不发）；页内 iframe / via=inpage 弹窗不发（它们的方向是 ensure-native）。
 * 后台（background.ts onSidebarSwitchMessage）再按自己的状态裁定：窗口里原生是否真在显示、默认方式、目的标签宿主是否活着……不满足就什么都不做。 */
export const SIDEBAR_SWITCH_MSG = "inpage:sidebar-switch";
export const SIDEBAR_SWITCH_ACK = "inpage:sidebar-switch-ack";
export interface SidebarSwitchMsg { type: typeof SIDEBAR_SWITCH_MSG; tabId: number; /** 层 6：true = 「由 SW 在关完原生之后激活目标标签」（原生侧栏的行点击）；缺省 = 老的发了不等 */ activate?: boolean; /** 点击那一刻侧栏列表里的 url（可能陈旧；后台优先信自己记的宿主 url） */ url?: string }
let sidebarSwitchOn = false;
export function setSidebarSwitchEnabled(on: boolean): void { sidebarSwitchOn = on; }
export const sidebarSwitchEnabled = (): boolean => sidebarSwitchOn;
/** 要不要发、发什么（纯函数，单测）：开关关 / 页内上下文 / 不是「激活已有标签」/ 目的地明确是受限页（留在原生）→ undefined。url 缺省 = 未知，交给后台判 */
export function sidebarSwitchMsg(url: string | null | undefined, kind: NavKind, tabId: number | undefined, search?: string, on: boolean = sidebarSwitchOn): SidebarSwitchMsg | undefined {
    if (!on || kind !== "activate" || tabId == null || inpageContext(search)) return undefined;
    if (url && pageKind(url) !== "ok") return undefined;
    return { type: SIDEBAR_SWITCH_MSG, tabId, ...(url ? { url } : {}) };
}
export function notifySidebarSwitch(url: string | null | undefined, kind: NavKind, tabId: number | undefined, search?: string): boolean {
    const msg = sidebarSwitchMsg(url, kind, tabId, search);
    if (!msg || typeof chrome === "undefined" || !chrome.runtime?.sendMessage) return false;
    try { void Promise.resolve(chrome.runtime.sendMessage(msg)).catch(() => undefined); } catch { /* 扩展上下文已失效：不阻塞导航 */ }
    return true;
}
/** 层 6（native-close-sync）：原生侧栏里点行 → 普通页。close 会销毁原生页文档，所以**激活必须由 SW 在 close 之后发起**，页面不能「等 ack 再 tabs.update」。
 * 返回 undefined = 不适用（走老路）；否则 Promise<boolean>：true = SW 已接管（会 close 原生并自己 tabs.update，页面**不要**再激活）；false = SW 没接管（冷 SW / 宿主没握手 / 不该切 / 超时）→ 页面照老路自己激活。 */
export function sidebarSwitchAck(url: string | null | undefined, kind: NavKind, tabId: number | undefined, search?: string, ackMs: number = ENSURE_NATIVE_ACK_MS): Promise<boolean> | undefined {
    const msg = sidebarSwitchMsg(url, kind, tabId, search);
    if (!msg || typeof chrome === "undefined" || !chrome.runtime?.sendMessage) return undefined;
    let sent: Promise<unknown>;
    try { sent = Promise.resolve(chrome.runtime.sendMessage({ ...msg, activate: true })); } catch { return Promise.resolve(false); }
    return new Promise<boolean>(resolve => {
        const t = setTimeout(() => resolve(false), ackMs);
        sent.then(r => { clearTimeout(t); resolve((r as { type?: string; handled?: boolean } | undefined)?.type === SIDEBAR_SWITCH_ACK && (r as { handled?: boolean }).handled === true); }, () => { clearTimeout(t); resolve(false); });
    });
}
/** SW 侧：消息的发送者是不是页内上下文（iframe / via=inpage 弹窗）——是 = 不处理（它们走 ensure-native）。纯函数，单测 */
export function senderIsInpageContext(senderUrl: string | undefined): boolean {
    if (!senderUrl) return false;
    try { return inpageContext(new URL(senderUrl).search); } catch { return false; }
}

/** 本页面里有没有「已发 ensure-native、还在等 ack / 超时」的调用（≤ ENSURE_NATIVE_ACK_MS）。patch 08：弹窗页的失焦即关据此等一等 */
let pendingEnsure = 0;
export const nativeEnsurePending = (): boolean => pendingEnsure > 0;

/** 先切原生（等 ack，最多 ENSURE_NATIVE_ACK_MS）再执行 go（导航 / 激活）。没发消息时 go 同步执行，返回值原样透传（不多一个微任务）。
 * 必须在手势栈里第一件事调用；不要在这之前 await（要 await 的调用点用 opts.gestureAt 降级） */
export function navigateAfterNative<T>(url: string | null | undefined, kind: NavKind, tabId: number | undefined, go: () => T, o: NativeOpts = {}): T | Promise<T> {
    const sw = sidebarSwitchAck(url, kind, tabId, o.search); // 层 6：原生侧栏行点击 → 普通页：SW 关原生后自己激活；没接管才 go()
    if (sw) return sw.then(handled => (handled ? (undefined as T) : go()));
    const p = ensureNativeAck(url, kind, tabId, o);
    return p ? p.then(go) : go();
}

/* —— patch 07：全局命令弹窗（Alt+T / open-command-bar）的覆盖 ——
 * 弹窗由 SW 在 commands.onCommand 里打开，没有页内侧栏的 iframe 参与，所以 URL 不会自带 via=inpage。
 * 插件在 SW 里注册一个探针：「这个窗口当前是不是页内侧栏在用（意图开 + 原生没在显示）」；commandBar 打开弹窗时问它，是才带 via=inpage。
 * 没装插件 / 插件关闭 = 探针不存在 = 永远 false（行为完全不变）。同一个 helper 模式：与 setGestureRouter 一样由插件 start() 装、cleanup 撤。 */
export type InpageProbe = (windowId: number | undefined) => boolean;
let probe: InpageProbe | undefined;
export function setInpageProbe(fn: InpageProbe | undefined) { probe = fn; }
export function inpageActiveFor(windowId: number | undefined): boolean {
    try { return !!probe?.(windowId); } catch { return false; }
}
/** 命令栏弹窗 URL 的查询串（纯函数，单测）：popup=commandBar&win=…[&edit=1][&via=inpage] */
export function commandBarPopupQuery(win: number | undefined, edit: boolean, via: boolean): string {
    return `popup=commandBar&win=${win}${edit ? "&edit=1" : ""}${via ? "&via=inpage" : ""}`;
}

/* —— patch 08：命令栏弹窗（Alt+T / via=inpage）在「切原生」期间不被失焦即关误杀 ——
 * sidePanel.open 会让焦点离开弹窗（原生面板 / 浏览器窗口拿焦点），弹窗有两处「失焦即关」：
 *   ① SW 的 windows.onFocusChanged（commandBar.openCentered）→ windows.remove；② 弹窗页自己的 window blur（entries/sidepanel.ts，200 ms 后 hasFocus 为假就 window.close）。
 * 它们都可能赶在 ack.then(导航; 关闭) 之前把弹窗（连同导航脚本）关掉 = 导航丢了。做法：
 *   ① SW 在 ensure-native 处理器里 noteEnsureNative() 记时间；onFocusChanged 在 ENSURE_BLUR_GRACE_MS 内不立刻关，改为「延后复查」（复查时弹窗仍没拿回焦点才关）；
 *   ② 页面端 nativeEnsurePending() 为真时 blur 处理器每 200 ms 再看一次，不关。
 * 这里全是纯函数（单测）；真机里焦点到底怎么变 ⚠ 没有证据（MANUAL I22）。 */
export const ENSURE_BLUR_GRACE_MS = 1500;
let ensureAt: number | undefined;
export function noteEnsureNative(now: number = Date.now()): void { ensureAt = now; }
export const lastEnsureNativeAt = (): number | undefined => ensureAt;

export type PopupBlurAction = "ignore" | "defer" | "close";
/** SW 侧：焦点变了，要不要关弹窗。focused === 弹窗自己 / 刚开 500 ms 内 = ignore；刚发过 ensure-native（grace 内）= defer（延后复查）；其余 = close（与 07 之前一致） */
export function popupBlurAction(o: { focused: number; popupId: number; born: number; now: number; ensureAt?: number; graceMs?: number }): PopupBlurAction {
    if (o.focused === o.popupId || o.now - o.born < 500) return "ignore";
    if (o.ensureAt != null && o.now - o.ensureAt >= 0 && o.now - o.ensureAt < (o.graceMs ?? ENSURE_BLUR_GRACE_MS)) return "defer";
    return "close";
}
export type PageBlurAction = "keep" | "wait" | "close";
/** 弹窗页侧：blur 后 200 ms 复查：有焦点 = keep；没焦点但还有 ensure-native 在等 = wait（再等 200 ms）；否则 close */
export function pageBlurAction(o: { hasFocus: boolean; pending: boolean }): PageBlurAction {
    return o.hasFocus ? "keep" : o.pending ? "wait" : "close";
}

/** ensure-native 的目标窗口（纯函数，单测）。命令栏弹窗是 `type:"popup"` 的独立窗口，**它的 sender.tab.windowId 是弹窗自己的窗口**，不是要开原生面板的浏览器窗口；
 * 所以发送者是 via=inpage 弹窗时优先用消息里的 ?win=（宿主窗口）。iframe / 内容脚本的 sender.tab.windowId 就是宿主窗口，仍然优先（?win= 可能因标签被拖到别的窗口而过期）。 */
export function senderIsInpagePopup(senderUrl: string | undefined): boolean {
    if (!senderUrl) return false;
    try { return viaInpage(new URL(senderUrl).search); } catch { return false; }
}
export function ensureTargetWindow(senderUrl: string | undefined, senderTabWindowId: number | undefined, msgWindowId: number | undefined): number | undefined {
    return senderIsInpagePopup(senderUrl) ? msgWindowId ?? senderTabWindowId : senderTabWindowId ?? msgWindowId;
}

/* 页内侧边栏：内容脚本（只在顶层 frame 运行；分屏页里的子 frame 不跑）。
 * 约束：不得 import @api/ErrorLog（内容脚本里它会拉进整条错误日志链）；告警只用 console.warn（裁定 H）。
 * 结构：shadow DOM 宿主（挂在 documentElement 上）= 保持层 + 触发条 + 容器（iframe）+ 调宽把手（补丁 12：Arc 的 8 px 热区始终在；其中悬停淡入的 3 px 竖条由设置 showHandle 控制，默认不渲染）+ 拖拽遮罩。
 * 一个窗口只保留一个活动 iframe（裁定 F）：后台只对该窗口的活动标签下发 active:true；收到 active:false 立刻销毁 iframe。
 * 存活检测（DESIGN 1.2）：L1 端口 inpage:host；L2 后台 tabs.sendMessage(MSG.status)（本文件回复）；L3 hello 里的协议号；L4 iframe 经 postMessage 的 ready 握手（超时 = frame-blocked）。 */
import { tr } from "@api/i18n";
import type { Cleanup } from "@utils/types";
import { FRAME_IDLE_MSG, frameDecision } from "./frameLife";

import type { HelloMsg, StateMsg } from "./background";
import { ENSURE_NATIVE_MSG, type EnsureNativeMsg } from "@api/HostMode";

import { ARC, HANDLE, HOST_ID, MSG, PORT_NAME, PREWARM, PROTOCOL, TIMING } from "./constants";
import { canBuildFrame, EARLY, frameStale, type Hint, hintEnv, hintFromState, hintTheme, hintToState, isFirstPlacement, mayShowOptimistic, parseHint, sameHint, shouldDeferInactive, withoutIds } from "./earlyShow";
import { clearEarly, type EarlyHandle, registerEarly } from "./earlyHandle";
import { hostCss } from "./host.css";
import { createGestureGate, detectMac, gestureListenEvents } from "./gestureGate";
import { clampWidth, createCollapseGate, createRepeekGuard, createResizeDrag, flatBackground, frameColorScheme, type FrameTheme, barVisible, linkNeedsNative, parseDisplayMode, parseFrameTheme, pushOffset, resetWidth, retargetFollow, shouldPush, shouldSendPrewarm } from "./logic";
import { browserDeps, createPagePush } from "./pagePush";
import { prepareRender } from "./instantRender";
import { createFrameChannel } from "./frameChannel";
import { settings } from "./settings";
import { onTraceEnabled, setTraceSink, setTraceSwitch, trace, TRACE_MSG, traceConfigure, traceOn } from "./trace";

/** 追踪开关在 sessionStorage 里记一位（同标签重载后的第一帧就能记；只在开着时写、关掉时清） */
const TRACE_SESSION_KEY = "__arcInpageTraceOn";

/** 补丁 residual：早实例（entries/content.ts 在 bootstrap 之前起，见 earlyEntry.ts）用 early:true：不读设置（设置框架还没就绪，用提示里的值），不自己读第 2 层提示（earlyEntry 已读），
 *  实例登记到 earlyHandle.ts，插件的 content.start 用 adoptEarly 接管（不重建宿主 / iframe） */
export interface StartOpts { early?: boolean; hint?: Hint }

export function startContent(opts: StartOpts = {}): Cleanup {
    if (typeof document === "undefined" || window.top !== window || !chrome.runtime?.id) return;
    traceConfigure({ src: "cs" }); // 补丁 inpage-debug-trace（默认关）：开关 = 页面级 globalThis.__arcInpageTrace / SW 状态里的 trace:true（上次开着的话 sessionStorage 里记了一位，让重载后的第一帧事件也能记）
    try { if (sessionStorage.getItem(TRACE_SESSION_KEY) === "1") setTraceSwitch(true); } catch { /* 沙箱 / 禁用存储 */ }
    if (traceOn()) trace("cs.start", { early: !!opts.early, hint: opts.hint ? { show: opts.hint.show } : null, vis: document.visibilityState, rs: document.readyState, url: location.origin + location.pathname });
    document.getElementById(HOST_ID)?.remove(); // 上一份内容脚本（扩展重载 / 重新注入）留下的宿主

    const frameOrigin = new URL(chrome.runtime.getURL("")).origin;
    let stopped = false;
    let st: StateMsg | undefined;
    let port: chrome.runtime.Port | undefined;
    let attempt = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let iframe: HTMLIFrameElement | undefined;
    let ready = false, blocked = false;
    let handshakeTimer: ReturnType<typeof setTimeout> | undefined;
    let peek = false, inTrigger = false, dragging = false;
    let dwellTimer: ReturnType<typeof setTimeout> | undefined;
    let hintTimer: ReturnType<typeof setTimeout> | undefined;
    let rebuilds = 0, rebuildTimer: ReturnType<typeof setTimeout> | undefined;
    let width: number = ARC.defaultWidth;
    /* 补丁 early-show：乐观壳（按上一次已知的提示先建）+ 真实状态校正。t0 = 内容脚本启动时刻（performance.now） */
    let t0 = performance.now(); // bfcache 恢复时重置（pageshow persisted）：恢复后的第一条状态也算「新页面第一次」，不播动画
    let hinted = false, realSeen = false, activated = false;
    let deferredInactive: StateMsg | undefined, deferTimer: ReturnType<typeof setTimeout> | undefined;
    let frameIds: { win: number; tab: number } | undefined;
    let lastShownT: boolean | undefined; // 追踪用：上一次记下的 box shown
    let lastSession: Hint | undefined, lastLocal: Hint | undefined;
    let trFn: ((key: string) => string) | undefined = opts.early ? undefined : tr; // 早实例的 i18n 表没注册（主脚本才有）：接管时换成主脚本的 tr；之前不显示一次性提示文案

    /* —— DOM —— */
    const mk = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string) => { const e = document.createElement(tag); e.className = cls; return e; };
    const host = document.createElement("div"); host.id = HOST_ID;
    const root = host.attachShadow({ mode: "open" });
    try { const sheet = new CSSStyleSheet(); sheet.replaceSync(hostCss()); root.adoptedStyleSheets = [sheet]; } // 构造样式表不受页面 CSP 的 style-src 限制
    catch { const s = document.createElement("style"); s.textContent = hostCss(); root.append(s); }
    const hold = mk("div", "hold"), trigger = mk("div", "trigger"), box = mk("div", "box");
    const hint = mk("div", "hint"), mask = mk("div", "mask");
    let handle: HTMLDivElement | undefined, bar: HTMLElement | undefined; // handle = 8 px 热区（侧栏显示时始终在）；bar = 3 px 竖条（设置 showHandle 才有）
    root.append(hold, trigger, box, hint, mask);
    const mount = () => { if (!host.isConnected) document.documentElement.append(host); };
    mount();

    const collapseGate = createCollapseGate();
    const setWidth = (w: number) => { width = w; host.style.setProperty("--w", `${w}px`); };

    /* —— 外观（DESIGN 3.8.8）：推开 = Arc locked = 平贴（x = y = 0、整高、无圆角 / 边框 / 阴影、不透明底）；其余（悬停浮出、浮在页面上方式）= 卡片。
     *  外观只由 data-push 决定（= shouldPush，与页面让位同一个条件），指针悬停不改它。侧栏页（iframe）经 postMessage 拿到 flat 标志、回报自己的主题底色 + color-scheme —— */
    let theme: FrameTheme | undefined, flatNow = false;
    const osDark = () => typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;
    const applyBg = () => { host.style.setProperty("--bg", flatBackground(theme, osDark())); host.style.setProperty("--bar", theme?.bar ?? HANDLE.barEstimate[theme?.scheme ?? (osDark() ? "dark" : "light")]); if (iframe && theme) iframe.style.colorScheme = frameColorScheme(theme); }; // --bar = 把手竖条色（主题 maxContrastColor：Space 色算出 / 估算 ⚠）
    /* 补丁 system-color-scheme/1：宿主自己听系统明暗。iframe 跟系统（theme.follow）时它自己的 matchMedia 也会变并重新回报；回报到之前先用当前系统的 FLAT_BASE 垫底，免得内容已变深而底还是浅（一帧闪）。
     * 只改 --bg / --bar 与 hint，不重建 / 不重载 iframe、不重渲染（不重放动画）；强制明暗（theme.follow 缺省）= 不动 */
    const mqOs = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : undefined;
    const onOsScheme = () => { if (!theme?.follow) return; const t = retargetFollow(theme, osDark()); if (t === theme) return; theme = t; applyBg(); persistHint(); };
    mqOs?.addEventListener("change", onOsScheme);
    /* 补丁 rel66-postmessage-origin：宿主 → iframe 只经 frameChannel 发（握手前 / 重挂后排队，ready 后补发；不再往还在 about:blank 的 iframe 发 → 不再有 target origin 不匹配的控制台错误） */
    const frameChan = createFrameChannel({ win: () => iframe?.contentWindow, origin: frameOrigin, sameOriginDoc: () => !!iframe?.contentDocument });
    const postLook = () => { frameChan.post("look", { type: MSG.frameLook, flat: flatNow }); };

    /* —— 推开页面（补丁 09，DESIGN.md 3.8）：常驻（展开 / 固定）+ 显示方式 push + 非元素全屏 → html 让出 侧栏宽（平贴态 x = 0，无外边距，右留白 0；228）；悬停浮出（peek）从不让位 —— */
    const pushDeps = { ...browserDeps(host), warn: (m: string) => console.warn(m) }, pager = createPagePush(pushDeps); // 补丁 10：等 html margin 到位超时的告警（pagePush.ts 里不放控制台调用）
    let pinnedNow = false, fsActive = false, wasPush = false;
    const syncPush = (animate: boolean) => {
        const on = shouldPush({ mode: parseDisplayMode(st?.displayMode), pinned: pinnedNow, fullscreen: fsActive });
        host.dataset.curve = on || wasPush ? "locked" : "float"; // 进入 / 保持 / 离开推开 = 常驻切换曲线；其余（悬停浮出）= 弹簧
        wasPush = on;
        host.dataset.push = on ? "1" : "0";
        if (on !== flatNow) { flatNow = on; postLook(); }
        pager.set(on ? pushOffset(width, pushDeps.rtlScrollbar()) : 0, { animate });
    };
    const send = (m: unknown) => { try { port?.postMessage(m); } catch { /* 端口已断：onDisconnect 会重连 */ } };
    const frameState = (): HelloMsg["frame"] => blocked ? "blocked" : ready ? "ready" : "none";

    /* —— iframe（L4 握手） —— */
    /* 补丁 tab-shake：失活 = 停放（iframe 留着，切回零重建）；补丁 inpage-park-forever：停放不过期、没有计时器（只有销毁路径才会结束停放）；见 frameLife.ts */
    let parked = false;
    const clearPark = () => { parked = false; };
    const postIdle = (idle: boolean) => { frameChan.post("idle", { type: FRAME_IDLE_MSG, idle }); };
    const destroyFrame = () => { if (traceOn()) trace("cs.iframe.destroy", { had: !!iframe, ready, parked }); if (handshakeTimer) clearTimeout(handshakeTimer); handshakeTimer = undefined; clearPark(); frameChan.reset(); iframe?.remove(); iframe = undefined; ready = false; frameIds = undefined; };
    const parkFrame = () => {
        if (!iframe || parked) return;
        if (traceOn()) trace("cs.iframe.park", {});
        parked = true; postIdle(true);
    };
    const unparkFrame = () => { if (!parked) return; if (traceOn()) trace("cs.iframe.unpark", {}); clearPark(); postIdle(false); };
    const ensureFrame = () => {
        if (iframe && frameStale(frameIds, st)) destroyFrame(); // 乐观建的 iframe 的 win / tab 与真实状态不一致（标签换了窗口 / 提示过期）：重建
        if (iframe || !st || blocked || !canBuildFrame(st)) return; // 乐观状态没有 win / tab（第 2 层提示）：先出壳，iframe 等真实状态
        const f = document.createElement("iframe"); frameIds = { win: st.windowId, tab: st.tabId };
        const look = shouldPush({ mode: parseDisplayMode(st.displayMode), pinned: !!st.show && !blocked, fullscreen: fsActive }) ? "flat" : "card"; // 补丁 tab-shake：外观随 URL 进去，面板启动时同步套上（不等 postLook）
        f.src = `${chrome.runtime.getURL("sidepanel.html")}?host=inpage&win=${st.windowId}&tab=${st.tabId}&look=${look}`; // ?win= 让 tabState 等直接读窗口 id；?host=inpage 见 patch 03
        f.style.opacity = "0"; // ready（面板已套好外观）之前不显示：宿主 --bg 垫底，不再先露一块 iframe 默认底色再换色
        f.addEventListener("load", () => { if (iframe !== f || f.contentDocument) return; /* 文档与页面同源 = 还不是扩展页：不发（rel66） */ try { f.contentWindow?.postMessage({ type: MSG.framePing }, frameOrigin); } catch { /* 跨源失败：等 ready */ } });
        if (theme) f.style.colorScheme = frameColorScheme(theme); // 跟系统 = "light dark"（不钉）；强制明暗 = 单值（补丁 system-color-scheme/1）
        box.append(f); iframe = f;
        if (traceOn()) trace("cs.iframe.create", { win: st.windowId, tab: st.tabId, look, hinted, realSeen, show: !!st.show, nativeOpen: !!st.nativeOpen });
        handshakeTimer = setTimeout(() => { // ⛔ 超时占位 TIMING.handshakeMs
            if (ready || iframe !== f) return;
            console.warn("[InpageSidebar] iframe handshake timeout: treating as frame-blocked");
            if (traceOn()) trace("cs.iframe.handshakeTimeout", {});
            blocked = true; destroyFrame(); send({ type: "frame", state: "blocked" }); render();
        }, TIMING.handshakeMs);
    };
    const onWindowMessage = (e: MessageEvent) => {
        if (!iframe || e.source !== iframe.contentWindow || e.origin !== frameOrigin) return; // 页面脚本伪造不了 source / origin
        const t = parseFrameTheme(e.data); if (t) { theme = t; applyBg(); persistHint(); return; } // 侧栏页的主题底色 + color-scheme
        if ((e.data as { type?: string } | null)?.type !== MSG.frameReady) return;
        if (!frameChan.isReady()) { postLook(); if (parked) postIdle(true); frameChan.ready(e.source); } // 首次握手 / 页面删掉宿主后重挂（新的浏览上下文）：认定这个窗口，补发当前外观 + 停放态（rel66）
        if (!ready) {
            if (traceOn()) trace("cs.iframe.ready", {});
            ready = true; iframe.style.opacity = ""; if (handshakeTimer) clearTimeout(handshakeTimer); handshakeTimer = undefined; send({ type: "frame", state: "ready" });
        }
    };

    /* —— 渲染：把后台状态 + 本地悬停状态一次性对齐（幂等） —— */
    const render = (instant = false) => {
        if (stopped) return;
        const vis = document.visibilityState === "visible";
        instant = prepareRender({ instant, visible: vis, host, box, raf: requestAnimationFrame }); // 补丁 prepare-render：先算有效 instant（含「隐藏标签」）再压过渡——原来顺序反了：隐藏标签里 show 0→1 时 .box 的 transform 过渡在隐藏文档里起跑，切回来补播 = 「重新展开」。新页面第一次状态 / 切回来（入参 instant）：外观立即到位、连滑入也不要（行内 transition:none，第一帧画出来之后才撤）；隐藏标签里收到的状态变化一律不播动画（补丁 tab-switch）
        const active = !!st?.active || (vis && realSeen && !!st); // 可见的页面就是本窗口的活动标签：不必等后台 active:true 往返就能建 iframe
        const pinned = !!st?.show && !blocked; // 补丁 tab-switch：常驻与 active 无关——非活动标签保持「已展开」（盒子 + 页面推开量都不动），只是不带 iframe；切回来零动画
        const hoverOn = active && !!st?.hover && !st.nativeOpen && !blocked;
        if (!hoverOn) { peek = false; inTrigger = false; if (dwellTimer) clearTimeout(dwellTimer); }
        const shown = pinned || (hoverOn && peek);
        const fd = frameDecision({ teardown: false, active, shown, blocked, hasFrame: !!iframe, stale: !!iframe && frameStale(frameIds, st), canBuild: !!st && canBuildFrame(st), parked }); // 补丁 tab-shake：失活不再立刻销毁（rel52：每次切回都重建，空白 3–7 帧）；blocked 不清（这次导航内不再尝试，新页面 = 新内容脚本）
        if (fd.destroy) destroyFrame();
        if (fd.park) parkFrame();
        if (fd.unpark) unparkFrame();
        if (fd.build) ensureFrame();
        if (st && !dragging) setWidth(collapseGate.width(shown, st.width)); // 收起后（闸住）--w 保持 0，下次展开才恢复起始宽：避免「--w 回到起始宽 + shown=0」同帧的全宽闪现
        pinnedNow = pinned; if (active) activated = true;
        syncPush(!instant && !dragging); // 新页面第一次收到状态（instant）不播放推开动画，避免每次导航都滑一下
        box.dataset.shown = shown ? "1" : "0";
        if (traceOn() && lastShownT !== shown) { lastShownT = shown; trace("cs.hostVisible", { shown, pinned, active, peek, hoverOn, hasFrame: !!iframe, show: st?.show, nativeOpen: st?.nativeOpen, hinted, realSeen }); }
        hold.dataset.on = hoverOn && peek && !pinned ? "1" : "0";
        trigger.style.display = hoverOn && !shown ? "block" : "none";
        trigger.dataset.engaged = inTrigger ? "1" : "0";
        syncHandle(shown); syncBar(barVisible({ shown, setting: st?.handle }));
    };
    const showHint = (text: string) => {
        hint.textContent = text; hint.dataset.on = "1";
        if (hintTimer) clearTimeout(hintTimer);
        hintTimer = setTimeout(() => { hint.dataset.on = "0"; }, TIMING.hintMs);
    };

    /* —— 悬停浮出（默认关）：条带内停留 160 ms → 浮出；保持区 宽+80 内保持；离开立即收回（⚠ Arc 源码未找到延迟计时器） —— */
    const repeek = createRepeekGuard(); // floating 拖到 ≤82 松手收起后，指针若还在触发条里：离开前不再浮出（见 logic.ts createRepeekGuard）
    trigger.addEventListener("pointerenter", () => {
        if (repeek.blocking) return;
        inTrigger = true; trigger.dataset.engaged = "1";
        if (dwellTimer) clearTimeout(dwellTimer);
        dwellTimer = setTimeout(() => { if (inTrigger) { peek = true; render(); } }, ARC.dwellMs);
    });
    trigger.addEventListener("pointerleave", () => { repeek.leave(); inTrigger = false; trigger.dataset.engaged = "0"; if (dwellTimer) clearTimeout(dwellTimer); });
    const leave = (e: PointerEvent) => {
        if (dragging) return;
        const to = e.relatedTarget as Node | null;
        if (to && (root.contains(to) && (to === hold || to === box || box.contains(to) || (handle && (to === handle || handle.contains(to)))))) return;
        if (peek) { peek = false; render(); }
    };
    hold.addEventListener("pointerleave", leave); box.addEventListener("pointerleave", leave);

    /* —— 调宽把手（补丁 12，Arc SidebarResizeRegionView）——
     *  8 px 热区侧栏显示时始终在（拖宽 / 双击重置 / ew-resize 都不依赖设置）；竖条（路径 3 px + 1 px 同色描边 = 可见 4 px）只在设置 showHandle 为 true 时渲染（false = 不在 DOM 里：拖动中、吸附脉冲也看不到）。
     *  拖动：w = trunc(起始宽 + 位移)，clamp 164–500，|w − 228| < 14 吸到 228（先离开过 14 带才武装），吸上时竖条脉冲 scale.x 1→1.7（0.08 s，autoreverse）；拖动中逐帧写 --w 并推开页面，无动画；
     *  拖动时用遮罩盖住 iframe；双击 = 重置 228。locked 与 floating 同一分支（Arc 只看 sidebarMode，不看 presentation）：拖动中 w < 82 实时宽 0，松手时 Int(起始 + 位移) ≤ 82 → 发 {type:"collapse", width: 起始宽}：locked = 后台收起页内侧栏（同 Alt+S）；
     *  floating = 页内侧栏本来就是悬停浮出的（后台 intent 关），后台只落盘起始宽，宿主本地 peek = false 收回浮出（⚠ Arc 的 hideSidebarWithGesture 在 reducer 里的结果 ⛔ 未追到）。悬停 0.25 s 定时器（Arc Combine delay）：进入热区起 250 ms 才 data-hot=1（竖条淡入），移出取消并立即淡出，move 不重置，拖动中忽略悬停变化；Arc 没有「点击切原生」——切原生走快捷键 / 右键菜单 / 工具栏图标 —— */
    let drag: ReturnType<typeof createResizeDrag> | undefined, dragX = 0, lastX = 0; // lastX = 最近一次拖动指针 clientX（松手点）
    let dragOff: (() => void) | undefined; // 拖动期间的兜底监听（window blur / visibilitychange 隐藏）的摘除函数：endDrag / teardown 摘；不拖动时窗口上一个监听都没有
    let collapseTimer: ReturnType<typeof setTimeout> | undefined, hotTimer: ReturnType<typeof setTimeout> | undefined;
    const setHot = (on: boolean) => { if (handle) handle.dataset.hot = on ? "1" : "0"; };
    const clearHot = () => { if (hotTimer) { clearTimeout(hotTimer); hotTimer = undefined; } };
    const pulse = () => { if (typeof bar?.animate === "function") bar.animate([{ transform: "scaleX(1)" }, { transform: `scaleX(${HANDLE.pulseScaleX})` }], { duration: HANDLE.pulseMs, iterations: 2, direction: "alternate", easing: HANDLE.pulseEasing }); };
    const endDrag = (cancelled = false) => {
        if (!drag) return; const r = drag.release(cancelled); drag = undefined; dragging = false; dragOff?.(); dragOff = undefined; if (handle) handle.dataset.drag = "0"; mask.dataset.on = "0";
        setHot(!!handle?.matches(":hover")); // Arc：拖完仍在把手上 = 保持显示；不在 = 0.2 s 淡出（isHovered 在拖动中被 filter 掉，结束后按当前位置重算）
        if (r.collapse) { collapseGate.begin(); if (collapseTimer) clearTimeout(collapseTimer); collapseTimer = setTimeout(() => { if (collapseGate.expire(box.dataset.shown === "1")) render(); }, TIMING.collapseGateMs); } // 后台没收起（始终显示）：超时放行，恢复起始宽
        send(r.collapse ? { type: "collapse", width: r.width } : { type: "width", width: r.width });
        if (r.collapse && !pinnedNow && peek) { repeek.arm(lastX); peek = false; render(); } // floating（悬停浮出）：收回浮出（--w 由收起闸保持 0，下次浮出才恢复起始宽） // 只有后台写 data:inpageSidebar；收起后 --w 由随后的状态下发恢复为起始宽（render 的 setWidth）
    };
    const makeHandle = () => {
        const h = mk("div", "handle");
        h.addEventListener("pointerdown", e => {
            if (e.button !== 0) return;
            if (collapseGate.holding) { collapseGate.release(); setWidth(clampWidth(st?.width ?? ARC.defaultWidth)); } // 闸住时 --w 为 0：新拖动从存储宽起手
            dragging = true; dragX = lastX = e.clientX; drag = createResizeDrag(width); clearHot(); h.dataset.drag = "1"; mask.dataset.on = "1";
            h.setPointerCapture(e.pointerId); e.preventDefault();
            /* 兜底：鼠标在窗口外松手 / 指针捕获被抢走 / 切走窗口或标签时，pointerup 可能到不了把手 → 遮罩（全屏透明）永远盖着页面。
             * lostpointercapture（pointerup 之后也会触发，但 endDrag 已无 drag 可收 = 空操作）、窗口 blur、页面转隐藏 都按 pointercancel 处理：endDrag(true) = 夹 164–500、不收起、落盘一次、撤遮罩。
             * blur / visibilitychange 只在拖动期间挂在 window / document 上，endDrag 里摘掉。 */
            dragOff?.(); const bail = () => endDrag(true), onHide = () => { if (document.visibilityState === "hidden") endDrag(true); };
            window.addEventListener("blur", bail); document.addEventListener("visibilitychange", onHide);
            dragOff = () => { window.removeEventListener("blur", bail); document.removeEventListener("visibilitychange", onHide); };
        });
        h.addEventListener("pointerenter", () => { // Arc：isHovered → delay(0.25 s) → 显示；移出取消（switchToLatest）；pointermove 不重置（removeDuplicates）；拖动中忽略（filter !isResizing）
            if (dragging) return; clearHot(); hotTimer = setTimeout(() => { hotTimer = undefined; if (!stopped && !dragging) setHot(true); }, HANDLE.hoverDelayMs);
        });
        h.addEventListener("pointerleave", () => { if (dragging) return; clearHot(); setHot(false); });
        h.addEventListener("pointermove", e => {
            if (!drag) return;
            lastX = e.clientX; const r = drag.move(e.clientX - dragX); setWidth(r.width); syncPush(false); if (r.pulse) pulse();
        });
        h.addEventListener("pointerup", () => endDrag()); h.addEventListener("pointercancel", () => endDrag(true)); h.addEventListener("lostpointercapture", () => endDrag(true)); // 取消不收起（Arc cancelled 分支：夹 164–500）
        h.addEventListener("dblclick", () => { setWidth(resetWidth()); syncPush(false); send({ type: "width", width }); }); // 双击 = 重置 228（动画 ⛔，这里不动画）
        root.append(h); handle = h;
    };
    function syncHandle(on: boolean) {
        if (on && !handle) makeHandle();
        else if (!on && handle) { endDrag(true); clearHot(); handle.remove(); handle = undefined; bar = undefined; } // 侧栏被收起：先收尾（落盘宽度、撤遮罩）再摘掉
    }
    function syncBar(on: boolean) {
        if (on && handle && !bar) { bar = document.createElement("i"); handle.append(bar); }
        else if (!on && bar) { bar.remove(); bar = undefined; }
    }

    /* —— L1 端口 + L3 版本握手 —— */
    const teardown = () => {
        if (stopped) return;
        if (traceOn()) trace("cs.teardown", {});
        stopped = true; setTraceSink(undefined);
        dragOff?.(); dragOff = undefined; // 拖动中被拆（扩展重载 / 协议不一致）：摘 blur / visibilitychange 兜底监听（host.remove() 会带走遮罩）
        for (const t of [reconnectTimer, dwellTimer, hintTimer, rebuildTimer, handshakeTimer, deferTimer]) if (t) clearTimeout(t);
        try { port?.disconnect(); } catch { /* 已断 */ }
        for (const off of offs) off();
        pager.destroy(); // 页面样式归零（样式表 + 固定元素 inline 值）
        host.remove();
    };
    const syncTraceFromState = (on: boolean) => { // SW 状态里的 trace:true = 开；没有 = 关（页面级全局标志不受影响）
        if (on === traceOn() && !on) return;
        setTraceSwitch(on);
        try { if (on) sessionStorage.setItem(TRACE_SESSION_KEY, "1"); else sessionStorage.removeItem(TRACE_SESSION_KEY); } catch { /* 沙箱 / 禁用存储 */ }
    };
    const applyState = (m: StateMsg) => {
        const first = !!m.instant || isFirstPlacement({ hasState: !!st, activated, fresh: performance.now() - t0 < EARLY.freshMs }); // 补丁 pinned-first-frame：原生→页内交接中的状态（instant）也不播推开动画 // 新页面第一次摆上侧栏：不播动画
        if (traceOn() || m.trace) { syncTraceFromState(!!m.trace); if (traceOn()) trace("cs.state", { active: m.active, show: m.show, nativeOpen: m.nativeOpen, prewarm: m.prewarm, win: m.windowId, tab: m.tabId, hinted, first }); }
        st = m; realSeen = true; render(first);
        if (IS_DEV) { host.dataset.tState ??= String(Math.round(performance.now() * 10) / 10); } // 测量用（只在 dev 构建；页面可见但无害）
        persistHint();
        if (m.hint === "switch-failed" && trFn) showHint(trFn("inpageSidebar.switchFailed")); // 一次性提示（E8 失败的降级说明）
        if (m.instant) send({ type: "applied" }); // 补丁 pinned-first-frame：SW 等这个回执再激活目的标签（只在原生→页内交接那一次才发）
    };
    /* —— 提示（补丁 early-show）：读 sessionStorage（同步）→ 没有再异步读 chrome.storage.local；写：真实状态变了才写（和上次读到 / 写入的比较） —— */
    const readSession = (): Hint | undefined => { try { const r = sessionStorage.getItem(EARLY.sessionKey); return r ? parseHint(JSON.parse(r)) : undefined; } catch { return undefined; } }; // 沙箱 iframe / 禁用存储 / 坏 JSON：都当没有
    const optimisticOk = (h: Hint | undefined) => mayShowOptimistic({ visible: document.visibilityState === "visible", prerendering: !!(document as { prerendering?: boolean }).prerendering, hint: h });
    const applyHint = (h: Hint) => {
        if (stopped || st) return; // 真实状态（或更早的提示）已经到了
        { const ht = hintTheme(h, osDark()); if (ht) { theme = ht; applyBg(); } } // fw 且与当前系统不一致 → 首帧 FLAT_BASE（补丁 system-color-scheme/1）
        st = hintToState(h, opts.early ? hintEnv(h, HANDLE.defaultOn) : { displayMode: settings.store.displayMode, hover: !!settings.store.hoverReveal, handle: !!settings.store.showHandle });
        hinted = true; width = h.width; if (traceOn()) trace("cs.hint.apply", { show: h.show, win: h.win ?? null, tab: h.tab ?? null, layer: h.win ? "session" : "local" });
        render(true);
        if (IS_DEV) { host.dataset.tHint = String(Math.round(performance.now() * 10) / 10); }
    };
    const loadHint = () => {
        const s1 = readSession(); lastSession = s1;
        if (s1) { if (optimisticOk(s1)) applyHint(s1); return; }
        if (opts.early) { if (opts.hint && optimisticOk(opts.hint)) { lastLocal = opts.hint; applyHint(opts.hint); } return; } // 早实例：第 2 层由早实例读（和设置校验同一次 IPC）并经 opts.hint 传入
        if (!EARLY.localHint) return;
        try {
            void Promise.resolve(chrome.storage.local.get(EARLY.localKey)).then(r => {
                const h = parseHint((r as Record<string, unknown> | undefined)?.[EARLY.localKey]); lastLocal = h;
                if (h && optimisticOk(h) && !st) applyHint(withoutIds(h));
            }).catch(() => undefined);
        } catch { /* 扩展上下文失效 */ }
    };
    const persistHint = () => {
        const h = hintFromState({ st, theme, blocked, visible: document.visibilityState === "visible", real: realSeen }); if (!h) return;
        if (traceOn() && !sameHint(h, lastSession)) trace("cs.hint.persist", { show: h.show, win: h.win ?? null });
        if (!sameHint(h, lastSession)) { lastSession = h; try { sessionStorage.setItem(EARLY.sessionKey, JSON.stringify(h)); } catch { /* 沙箱 / 配额 */ } }
        if (EARLY.localHint) { const l = withoutIds(h); if (!sameHint(l, lastLocal)) { lastLocal = l; try { void Promise.resolve(chrome.storage.local.set({ [EARLY.localKey]: l })).catch(() => undefined); } catch { /* 扩展上下文失效 */ } } }
    };
    const connect = () => {
        if (stopped) return;
        if (!chrome.runtime?.id) { teardown(); return; } // 扩展已重载：上下文失效
        try { port = chrome.runtime.connect({ name: PORT_NAME }); } catch { teardown(); return; }
        const p = port;
        if (traceOn()) trace("cs.port.connect", { attempt });
        setTraceSink(r => { try { p.postMessage({ type: TRACE_MSG, rec: r }); } catch { /* 端口已断：onDisconnect 会清 sink */ } }); // 追踪记录经端口发给 SW（页面卸载 / 重载前的也在 SW 缓冲里）；没开追踪时永远不会被调用
        p.onMessage.addListener((m: StateMsg | { type: "inpage:stale" }) => {
            if (m.type === "inpage:stale") { teardown(); return; } // L3：协议号不一致 / 插件被停用
            attempt = 0;
            if (deferTimer) { clearTimeout(deferTimer); deferTimer = undefined; } deferredInactive = undefined;
            if (shouldDeferInactive({ hinted, realSeen, active: m.active, visible: document.visibilityState === "visible" })) { // 冷 SW 的第一条状态常是 inactive（activeByWin 未建好）：别把乐观壳收起又弹出
                deferredInactive = m; deferTimer = setTimeout(() => { deferTimer = undefined; if (deferredInactive === m) { deferredInactive = undefined; applyState(m); } }, EARLY.inactiveGraceMs);
                return;
            }
            applyState(m);
        });
        p.onDisconnect.addListener(() => {
            void chrome.runtime.lastError; if (port === p) { port = undefined; setTraceSink(undefined); }
            if (traceOn()) trace("cs.port.disconnect", { stopped });
            if (stopped) return;
            if (!chrome.runtime?.id) { teardown(); return; }
            scheduleReconnect();
        });
        const hello: HelloMsg = { type: "hello", proto: PROTOCOL, frame: frameState() };
        p.postMessage(hello);
    };
    /* 只在页面可见时主动重连（SW 回收会断端口；隐藏标签等可见时再连，避免每个标签周期性唤醒 SW ⚠）；退避用完后等 visibility / focus */
    const scheduleReconnect = () => {
        if (reconnectTimer) clearTimeout(reconnectTimer);
        if (document.visibilityState !== "visible" || attempt >= TIMING.reconnectMs.length) return;
        reconnectTimer = setTimeout(connect, TIMING.reconnectMs[attempt++]);
    };
    const resume = () => { if (!port && !stopped && document.visibilityState === "visible") { attempt = 0; if (reconnectTimer) clearTimeout(reconnectTimer); connect(); } };
    const onPageShow = (e: PageTransitionEvent) => { // bfcache 恢复：端口已在进入 bfcache 时关闭；旧状态原样先画（无动画），重连后的真实状态当作「新页面第一次」也不播动画
        if (traceOn()) trace("cs.pageshow", { persisted: e.persisted });
        if (!e.persisted) return;
        t0 = performance.now(); activated = false; if (st) render(true);
        resume();
    };
    const onVisibility = () => { // 切回本标签：用手里的状态同步画一遍（无动画；iframe 不用等后台 active 往返）；还没有任何状态（后台加载 / 恢复的标签）就读一次提示
        if (document.visibilityState !== "visible" || stopped) return;
        if (st) render(true); else loadHint();
        resume();
    };

    /* —— 其它保护 —— */
    const onFs = () => { // P0：元素全屏会盖住宿主；documentElement 全屏时宿主可见。元素全屏 = 宿主隐藏 + 页面立即恢复（不播动画，宿主已不可见）
        const fe = document.fullscreenElement; fsActive = !!fe && fe !== document.documentElement; host.dataset.fs = fsActive ? "1" : "0"; syncPush(false);
    };
    const mo = new MutationObserver(() => { // 页面把宿主删掉了：最多重建 5 次，间隔 1 s
        if (host.isConnected || stopped || rebuildTimer) return;
        if (rebuilds >= TIMING.rebuildMax) { console.warn("[InpageSidebar] host removed by page too many times, giving up"); mo.disconnect(); return; }
        rebuildTimer = setTimeout(() => { rebuildTimer = undefined; rebuilds++; mount(); }, TIMING.rebuildMs);
    });
    mo.observe(document.documentElement, { childList: true });
    const onStatus = (m: unknown, _s: unknown, respond: (r: unknown) => void) => { // L2：后台 tabs.sendMessage 的探测
        if ((m as { type?: string } | undefined)?.type !== MSG.status) return;
        respond({ ok: true, proto: PROTOCOL, ver: chrome.runtime.getManifest().version, shown: box.dataset.shown === "1", ready });
    };
    chrome.runtime.onMessage.addListener(onStatus);

    /* —— 受限页前切换（DESIGN.md 3.5 / 3.6）：都在真实手势的同步栈里，第一件事就是 sendMessage（E7：内容脚本 → SW 顶层同步 onMessage → open 实测可用） —— */
    let lastPrewarmSent = 0;
    const sendBg = (m: object) => { try { void Promise.resolve(chrome.runtime.sendMessage(m)).catch(() => undefined); } catch { /* 扩展上下文失效 */ } };
    /** 预热（设置 prewarm 开着才会 armed：st.prewarm）：页面上第一次真实 pointerdown / keydown。后台幂等，这里只防刷 */
    const gestureGate = createGestureGate({ mac: detectMac() }); // 补丁 rightclick-native：只认主键 pointerdown / 真正的按键，右键 / 修饰键 / 菜单期间不当预热手势
    const onGesture = (e: Event) => {
        const now = Date.now();
        if (!gestureGate.accept(e, now)) return;
        const go = shouldSendPrewarm({ prewarm: !!st?.prewarm, warm: !!st?.warm, active: !!st?.active, nativeOpen: !!st?.nativeOpen, trusted: e.isTrusted, now, lastSent: lastPrewarmSent, resendMs: PREWARM.resendMs });
        if (traceOn()) { const k = e as Partial<KeyboardEvent>; trace("cs.gesture", { type: e.type, mod: k.metaKey ? "meta" : k.ctrlKey ? "ctrl" : k.altKey ? "alt" : "", key: e.type === "keydown" && (k.metaKey || k.ctrlKey || k.altKey) ? k.key : undefined, send: go, prewarm: st?.prewarm, active: st?.active, nativeOpen: st?.nativeOpen, shown: box.dataset.shown }); } // 只记带修饰键的键名（快捷键），普通按键不记内容
        if (!go) return;
        lastPrewarmSent = now; sendBg({ type: MSG.prewarm, source: "host" });
    };
    /** 网页里点链接去 PDF 查看器 / Chrome 应用商店（页内侧栏当前显示着才需要）：先切原生再让导航发生。chrome:// 等 Chrome 对网页本来就拦截，不处理（DESIGN 3.7） */
    const onLink = (e: MouseEvent) => {
        if (!e.isTrusted || !st?.active || !st.show || st.nativeOpen) return;
        const a = (e.target as Element | null)?.closest?.("a[href], area[href]") as HTMLAnchorElement | null;
        if (!a || (e.button !== 0 && e.button !== 1) || !linkNeedsNative(a.href, location.href, a.hasAttribute("download"))) return;
        const m: EnsureNativeMsg = { type: ENSURE_NATIVE_MSG, kind: a.target === "_blank" || e.button === 1 || e.metaKey || e.ctrlKey || e.shiftKey ? "create" : "navigate", url: a.href };
        sendBg(m);
    };
    for (const ev of gestureListenEvents(PREWARM.gestureEvents)) document.addEventListener(ev, onGesture, { capture: true, passive: true });
    document.addEventListener("click", onLink, { capture: true, passive: true });
    document.addEventListener("auxclick", onLink, { capture: true, passive: true });

    window.addEventListener("message", onWindowMessage);
    window.addEventListener("pageshow", onPageShow);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", resume);
    document.addEventListener("fullscreenchange", onFs);
    const offs: Array<() => void> = [
        () => window.removeEventListener("message", onWindowMessage), () => window.removeEventListener("pageshow", onPageShow),
        () => document.removeEventListener("visibilitychange", onVisibility), () => window.removeEventListener("focus", resume),
        () => document.removeEventListener("fullscreenchange", onFs), () => mqOs?.removeEventListener("change", onOsScheme), () => mo.disconnect(), () => chrome.runtime.onMessage.removeListener(onStatus),
        () => { for (const ev of gestureListenEvents(PREWARM.gestureEvents)) document.removeEventListener(ev, onGesture, { capture: true }); },
        () => { document.removeEventListener("click", onLink, { capture: true }); document.removeEventListener("auxclick", onLink, { capture: true }); },
    ];
    /* 补丁 early-show：document_start 推开时 body / 页面样式还没到 → 解析完 / 加载完各补量一次（pager.refit：摘表重量重装，同任务无绘制） */
    const refit = () => pager.refit();
    if (document.readyState === "loading") { document.addEventListener("DOMContentLoaded", refit, { once: true }); offs.push(() => document.removeEventListener("DOMContentLoaded", refit)); }
    if (document.readyState !== "complete") { window.addEventListener("load", refit, { once: true }); offs.push(() => window.removeEventListener("load", refit)); }
    if (IS_DEV) host.dataset.tStart = String(Math.round(t0 * 10) / 10);
    onTraceEnabled(() => { // 只有追踪开着才挂（关着 = 零监听）：卸载 / 隐藏的时刻是重载时序的关键
        const ph = (e: PageTransitionEvent) => { if (traceOn()) trace("cs.pagehide", { persisted: e.persisted, shown: box.dataset.shown, hasFrame: !!iframe }); };
        const bu = () => { if (traceOn()) trace("cs.beforeunload", { shown: box.dataset.shown }); };
        const vc = () => { if (traceOn()) trace("cs.visibility", { vs: document.visibilityState, hasState: !!st }); }; // 单独监听（不放进 onVisibility：现有源码断言要求它的开头格式不变）
        window.addEventListener("pagehide", ph); window.addEventListener("beforeunload", bu); document.addEventListener("visibilitychange", vc);
        offs.push(() => window.removeEventListener("pagehide", ph), () => window.removeEventListener("beforeunload", bu), () => document.removeEventListener("visibilitychange", vc));
    });
    applyBg(); setWidth(ARC.defaultWidth); render(); connect(); loadHint(); // connect 先发（唤醒 SW / hello 尽早出去），提示读取同一任务里紧跟
    if (!opts.early) return teardown;
    const stop = () => { clearEarly(me); teardown(); };
    const me: EarlyHandle = { alive: () => !stopped, stop, adopt: t => { trFn = t; } };
    registerEarly(me);
    return stop;
}


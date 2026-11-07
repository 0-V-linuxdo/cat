/* 页内侧边栏：iframe（sidepanel.html?host=inpage）里的 panel 钩子。原生侧栏里 isInpageHost() 为假，什么都不做（原生外观完全不变）。
 * 0) 外观（DESIGN 3.8.8）：收到宿主的 frameLook{flat} 后给 <html> 打 data-inpage-look="flat|card" 并注入一份样式——html / body 的自身背景改透明，把原来的 --arc-tint 画在 html::before 上：
 *    平贴 = 不透明度 1（压在宿主的不透明底上），卡片 = CARD_LOOK.tint（半透明盖在宿主的 backdrop-filter 模糊上）；同时把自己的主题底色（--arc-base 解析值）和 color-scheme 回报宿主（frameTheme）。
 *    没收到 frameLook（旧宿主 / 握手前）= 完全不动，保持原来的不透明背景。
 * 1) L4 握手：向宿主 window.postMessage ready（启动时发一次，收到宿主的 ping 再发一次）；
 * 2) 预热（prewarm 设置开着）：iframe 里第一次真实手势 → 同步 sendMessage 给后台（后台幂等）；
 * 3)（可选，E8 问 3 的对照）iframe 里的「切到 Chrome 侧边栏」按钮：constants.NATIVE_SWITCH.sources 含 "frame" 时才渲染，默认不渲染。⚠ 待 E8 实测 */
import { hostWindowId, inpageContext, isInpageHost, setSidebarSwitchEnabled } from "@api/HostMode";
import { tr } from "@api/i18n";
import { flushParked } from "@api/ParkGate";
import { parkLifeChanged } from "@api/ParkLife";
import type { Cleanup } from "@utils/types";

import { AUTO_SWITCH, CARD_LOOK, MSG, NATIVE_SWITCH, PREWARM } from "./constants";
import { FRAME_IDLE_MSG, parseLookParam, shouldFollowScroll } from "./frameLife";
import { createGestureGate, detectMac, gestureListenEvents } from "./gestureGate";
import { framePrewarmTargetOk } from "./prewarmTarget";
import { pushTiming } from "./logic";
import { followsSystem, maxContrastOf, opaqueColor, parsePrewarmMode, reportedScheme, shouldSendPrewarm } from "./logic";
import { settings } from "./settings";
import { Z } from "@utils/zLayers";
import { parseScroll, restoreStep, SCROLL, scrollKey } from "./tabSwitch";

/** 注入的外观样式（纯字符串，单测检查）：用 html::before（body::before 已被颗粒层占用）；opacity 过渡与宿主外观过渡同曲线 */
export const lookCss = () => { const t = pushTiming(); return `
html[data-inpage-look], html[data-inpage-look] body { background: transparent !important; }
html[data-inpage-look]::before { content: ""; position: fixed; inset: 0; z-index: -1; pointer-events: none; background: var(--arc-tint); opacity: 1; transition: opacity ${t.ms}ms ${t.easing}; }
html[data-inpage-look="card"]::before { opacity: ${CARD_LOOK.tint}; }
`; };

export function startPanel(): Cleanup {
    // 补丁 switch-auto：原生侧栏 / 非页内弹窗（不是 ?host=inpage / ?via=inpage）里，打开「点标签行 → 目的地是普通页 → 通知后台把原生换成页内」的开关；插件停用 = 这个钩子不跑 = 开关恒关 = 一条消息都不发
    if (!inpageContext()) { setSidebarSwitchEnabled(AUTO_SWITCH.viaSidebar); return () => setSidebarSwitchEnabled(false); }
    if (!isInpageHost() || window.parent === window) return;
    const tell = () => { try { window.parent.postMessage({ type: MSG.frameReady }, "*"); } catch { /* 宿主已销毁 */ } };
    const onMsg = (e: MessageEvent) => { if (e.source === window.parent && (e.data as { type?: string } | null)?.type === MSG.framePing) tell(); };
    window.addEventListener("message", onMsg);
    /* 外观 + 主题回报 */
    const root = document.documentElement; let styleEl: HTMLStyleElement | undefined;
    const probe = document.createElement("i"); probe.style.cssText = "display:none;color:var(--arc-base)"; document.head.append(probe);
    const mq = matchMedia("(prefers-color-scheme: dark)");
    let lastTheme = "";
    const reportTheme = () => { // 解析后的 --arc-base（自适应配色 / 主题变化时也会变）+ 实际使用的 color-scheme
        const base = opaqueColor(getComputedStyle(probe).color); const scheme = reportedScheme(getComputedStyle(root).colorScheme, root.dataset.theme, mq.matches);
        const follow = followsSystem(getComputedStyle(root).colorScheme, root.dataset.theme); // 补丁 system-color-scheme/1：跟系统 → 宿主给 iframe 设 "light dark"（不钉）
        // 把手竖条色 = 主题 maxContrastColor：有 Space 色（--arc-space）→ 按 Rea 规则（浅 T3 / 深 T0，⚠ 近似）算；没有 = 不带 bar，宿主用默认主题估算值（⚠）
        let space: string | undefined; if (getComputedStyle(root).getPropertyValue("--arc-space").trim()) { const sp = document.createElement("i"); sp.style.cssText = "display:none;color:var(--arc-space)"; root.append(sp); space = getComputedStyle(sp).color; sp.remove(); } // 临时探针挂 root（head 的子节点变动会触发上面的观察者）；--arc-space 没设置 = 默认主题
        const bar = space ? maxContrastOf(space, scheme === "dark") : undefined;
        const key = `${base}|${scheme}|${bar ?? ""}|${follow}`; if (!base || key === lastTheme) return; lastTheme = key;
        try { window.parent.postMessage({ type: MSG.frameTheme, base, scheme, ...(bar ? { bar } : {}), ...(follow ? { follow } : {}) }, "*"); } catch { /* 宿主已销毁 */ }
    };
    const mo = new MutationObserver(() => reportTheme()); mo.observe(root, { attributes: true, attributeFilter: ["style", "data-theme", "data-adaptive"] }); mo.observe(document.head, { childList: true });
    mq.addEventListener("change", reportTheme);
    const applyLook = (flat: boolean) => {
        if (!styleEl) { styleEl = document.createElement("style"); styleEl.textContent = lookCss(); document.head.append(styleEl); }
        root.dataset.inpageLook = flat ? "flat" : "card";
    };
    const onLook = (e: MessageEvent) => {
        if (e.source !== window.parent) return;
        const d = e.data as { type?: string; flat?: unknown } | null; if (d?.type !== MSG.frameLook || typeof d.flat !== "boolean") return;
        applyLook(d.flat); reportTheme();
    };
    window.addEventListener("message", onLook);
    /* 补丁 tab-shake：宿主建 iframe 时把外观写进 URL（?look=flat|card）：在发 ready / 第一次重绘之前同步套上，宿主 ready 后才显示 iframe，不再「默认底色 → 透明换色」；没有这个参数（旧宿主）= 照旧等 frameLook */
    const look0 = parseLookParam(location.search); if (look0) applyLook(look0 === "flat");
    /* 停放（所在标签不是前台）：宿主 postMessage {type: arc-inpage-idle, idle}；data-inpage-parked 给 Commands 的守卫读（停放的 iframe 不执行 CMD） */
    let idle = false;
    const onIdle = (e: MessageEvent) => {
        if (e.source !== window.parent) return;
        const d = e.data as { type?: string; idle?: unknown } | null; if (d?.type !== FRAME_IDLE_MSG || typeof d.idle !== "boolean") return;
        idle = d.idle; if (idle) root.dataset.inpageParked = "1"; else { delete root.dataset.inpageParked; flushParked(); } parkLifeChanged(); // 补丁 inpage-parked-idle：切回（idle:false）时补做停放期间记下的脏位（visibilitychange → visible 那一拍通常已补过，这里兜底：flush 无脏位时零开销）
    };
    window.addEventListener("message", onIdle);
    tell(); reportTheme();
    const offs: Array<() => void> = [() => window.removeEventListener("message", onMsg), () => window.removeEventListener("message", onLook), () => window.removeEventListener("message", onIdle), () => mo.disconnect(), () => mq.removeEventListener("change", reportTheme),
        () => { styleEl?.remove(); probe.remove(); delete root.dataset.inpageLook; delete root.dataset.inpageParked; }];
    /* 补丁 tab-switch：列表滚动位置按窗口存进 chrome.storage.session，iframe 重建后接回（只有扩展页读得到，页面看不到；存取失败 = 静默不接） */
    const sk = scrollKey(hostWindowId());
    if (sk) {
        const t0 = Date.now(); let want: number | undefined, done = false, saveT: ReturnType<typeof setTimeout> | undefined, tryT: ReturnType<typeof setTimeout> | undefined;
        const sc = () => document.querySelector<HTMLElement>(".arc-scroll");
        const stop = () => { done = true; if (tryT) clearTimeout(tryT); smo.disconnect(); };
        const attempt = () => {
            tryT = undefined; if (done || want === undefined) return; const e = sc();
            if (e) { const r = restoreStep({ saved: want, scrollHeight: e.scrollHeight, clientHeight: e.clientHeight, elapsedMs: Date.now() - t0 }); if (r !== "wait") { e.scrollTop = r; stop(); return; } }
            if (Date.now() - t0 >= SCROLL.restoreMs) { stop(); return; }
            tryT = setTimeout(attempt, 50);
        };
        const smo = new MutationObserver(() => { if (!done && want !== undefined && !tryT) attempt(); });
        smo.observe(document.body ?? document.documentElement, { childList: true, subtree: true });
        const userActed = () => { if (!done) stop(); };
        for (const ev of ["wheel", "pointerdown", "keydown", "touchstart"]) document.addEventListener(ev, userActed, { capture: true, passive: true });
        try { void Promise.resolve(chrome.storage.session.get(sk)).then(r => { want = parseScroll((r as Record<string, unknown> | undefined)?.[sk]); if (want === undefined || want === 0) { stop(); return; } attempt(); }).catch(() => stop()); } catch { stop(); }
        const onScroll = (e: Event) => {
            const t = e.target as HTMLElement | null; if (!t?.classList?.contains("arc-scroll")) return;
            if (idle) return; // 停放中：scrollTop 是被别的标签的写入带动的，不回写（否则互相覆盖）
            if (saveT) clearTimeout(saveT);
            saveT = setTimeout(() => { saveT = undefined; try { void Promise.resolve(chrome.storage.session.set({ [sk]: Math.round(t.scrollTop) })).catch(() => undefined); } catch { /* 上下文失效 */ } }, SCROLL.saveDebounceMs);
        };
        /* 补丁 tab-shake：停放的 iframe 跟随别的标签写进来的滚动位置（侧栏是窗口级的：切回来看到的是同一个位置，而不是它上次停放时的位置） */
        const onStore = (ch: Record<string, chrome.storage.StorageChange>, area: string) => {
            if (area !== "session") return; const v = parseScroll(ch[sk]?.newValue); const e = sc(); if (v === undefined || !e) return;
            if (shouldFollowScroll({ idle, current: e.scrollTop, next: v })) e.scrollTop = v;
        };
        try { chrome.storage.onChanged.addListener(onStore); offs.push(() => chrome.storage.onChanged.removeListener(onStore)); } catch { /* 上下文失效 */ }
        document.addEventListener("scroll", onScroll, { capture: true, passive: true }); // scroll 不冒泡：捕获阶段挂在 document 上，.arc-scroll 被整屏重绘换新也不用重挂
        offs.push(() => { stop(); if (saveT) clearTimeout(saveT); document.removeEventListener("scroll", onScroll, { capture: true }); for (const ev of ["wheel", "pointerdown", "keydown", "touchstart"]) document.removeEventListener(ev, userActed, { capture: true }); });
    }
    /* 预热（设置 prewarm 开着）：在侧栏 iframe 里的第一次真实手势也算「用户手势」——同步 sendMessage，后台幂等。⚠ 手势经扩展页 iframe 到 SW 是否有效 = E8 */
    const gestureGate = createGestureGate({ mac: detectMac() }); // 补丁 rightclick-native：只认主键 pointerdown / 真正的按键；右键 / 修饰键 / 右键菜单期间（含 iframe 里自己的菜单）不当预热手势
    let lastSent = 0;
    const onGesture = (e: Event) => {
        const now = Date.now();
        if (!gestureGate.accept(e, now, !!document.querySelector(".arc-menu:not([hidden])"))) return;
        if (!framePrewarmTargetOk(e)) return; // 补丁 t903u-tab-switch v2 + rel62-frame-prewarm-navonly：只有「收藏 / 标签导航行 → 受限页 / 判不出」才预热；普通页目标与一切非导航控件（site-controls、地址栏、按钮、打字）都不发（同步判定，受限页的手势链不变）
        if (!shouldSendPrewarm({ prewarm: parsePrewarmMode(settings.store.prewarm) !== "off", warm: false, active: true, nativeOpen: false, trusted: e.isTrusted, now, lastSent, resendMs: PREWARM.frameResendMs })) return;
        lastSent = now; try { void Promise.resolve(chrome.runtime.sendMessage({ type: MSG.prewarm, source: "frame" })).catch(() => undefined); } catch { /* 上下文失效 */ }
    };
    for (const ev of gestureListenEvents(PREWARM.gestureEvents)) { document.addEventListener(ev, onGesture, { capture: true, passive: true }); offs.push(() => document.removeEventListener(ev, onGesture, { capture: true })); }
    if (NATIVE_SWITCH.viaClick && NATIVE_SWITCH.sources.includes("frame")) { // 补丁 12：不再看设置（旧 showSwitchButton 已废）；E8 问 3 的对照实验，sources 默认不含 frame = 不渲染
        const b = document.createElement("button");
        b.type = "button"; b.textContent = "↗"; b.title = tr("inpageSidebar.switchNative");
        b.style.cssText = `position:fixed;right:6px;bottom:6px;z-index:${Z.overlay};width:24px;height:24px;padding:0;border-radius:6px;border:1px solid rgba(128,128,128,.35);background:Canvas;color:CanvasText;cursor:pointer;font:12px/1 system-ui,sans-serif`; /* 在侧栏 iframe（扩展页）里：低于菜单 / 提示，原先是 z-index 最大值，会盖住菜单 */
        // click 里第一件事：同步 sendMessage（点击发生在扩展页 iframe 里：E8 问 3）
        b.addEventListener("click", () => { chrome.runtime.sendMessage({ type: MSG.switchNative, source: "frame" }).catch(() => undefined); });
        document.body.append(b); offs.push(() => b.remove());
    }
    return offs;
}

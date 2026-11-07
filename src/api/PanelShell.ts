import "@components/ArcTooltip";
import { safe } from "@api/ErrorLog";
import { keyFor } from "@api/Commands";
import { prettyCombo } from "@api/Keys";
/*
 * 侧边栏外壳：核心唯一的 UI。只负责
 *   1) 按插槽顺序渲染插件注册的 section；2) 浮层宿主；3) 右键菜单宿主；4) toast。
 * 没有任何具体功能——Spaces、标签列表、命令栏……全部来自插件。
 */
import { tr } from "@api/i18n";
import { copyText } from "@api/Clipboard";
import { applyUrlTransformsDetailed, copyToastKey } from "@api/UrlTransforms";
import { type MenuItemDef, type MenuLocation, type MenuTarget, menuRegistry, MENU_LAYOUT } from "@api/ContextMenus";
import { type MenuEntry, closeMenus, openMenu, swallowOutside } from "@components/Menu";
import { h } from "@api/dom";
import { icon } from "@api/icons";
import { overlays, SLOT_ORDER, slot } from "@api/Slots";

import { subscribe } from "./Events";
import type { Cleanup } from "@utils/types";
import { debounce } from "@utils/misc";
import { commitKeepingHover, hoveredKeyed, recordListeners } from "@api/keepHover";
import { reuseFavicons } from "@api/iconReuse";
import { flog } from "@api/FocusLog";
import { currentWindow } from "@api/HostMode";
import { unlessParked } from "@api/ParkGate";
import { parkClosed } from "@api/ParkLife";

let root: HTMLElement;
let cleanups: Array<() => void> = [];
let overlayCleanup: Cleanup;

export function mountShell(el: HTMLElement) {
    root = el;
    const render = debounce(() => unlessParked("shell.render", renderAll), 16); // 补丁 inpage-parked-idle：停放的 iframe 不整屏重绘，只记脏位，切回补一次（renderAll 内部的 250 ms 重试照旧）
    subscribe("refresh", render);
    subscribe("pluginToggle", render);
    for (const n of SLOT_ORDER) slot(n).store.subscribe(render);
    subscribe("openOverlay", ({ id, arg }) => showOverlay(id, arg));
    document.addEventListener("click", () => closeMenus());
    let pressT: ReturnType<typeof setTimeout> | undefined;
    document.addEventListener("pointerdown", () => { pressing = true; clearTimeout(pressT); pressT = setTimeout(() => { pressing = false; }, 1500); }, true); // 1.5s 兜底：抬起丢失（拖出窗口）时不永久推迟重绘
    window.addEventListener("blur", () => { pressing = false; });
    for (const t of ["pointerup", "pointercancel"]) document.addEventListener(t, () => { setTimeout(() => { pressing = false; }, 0); }, true);
    document.addEventListener("keydown", e => { if (e.key === "Escape") { if (document.querySelector(".arc-menu:not([hidden])")) closeMenus(); else closeOverlay(); } });
    // 网页里的点击（内容脚本报告）= 点在外面：关闭菜单 / 面板 / 浮层；命令栏等弹窗模式直接关窗
    const where = getPopupMode() ? `popup:${getPopupMode()}` : "panel";
    /** 点在外面：关闭菜单 / 浮层 / ＋菜单（合成一次 document click）；弹窗模式直接关窗 */
    const dismiss = (why: string) => {
        const had = !!overlayEl || !!document.querySelector(".arc-menu:not([hidden])");
        flog(where, `dismiss:${why}${had ? "" : " (nothing open)"}`);
        closeMenus(); if (!overlayEl?.dataset.page) closeOverlay(); document.dispatchEvent(new Event("arc-dismiss"));
        if (getPopupMode()) window.close();
    };
    chrome.runtime.onMessage.addListener((msg: { type?: string }) => { if (msg?.type === "arc-outside-click") dismiss("page-click"); });
    // 52148：焦点在网页时按 Esc（内容脚本转发）：只关菜单 / ＋菜单整层（含子菜单），不动浮层、不关弹窗
    chrome.runtime.onMessage.addListener((msg: { type?: string }) => {
        if (msg?.type !== "arc-outside-esc") return;
        flog(where, "dismiss:page-esc"); closeMenus(); document.dispatchEvent(new Event("arc-dismiss"));
    });
    // 侧边栏内点外面（同 Arc）：捕获阶段处理，任何 stopPropagation / 遮罩都拦不住；
    // 第一次点外面只负责关闭，不触发下面的元素（吞掉这次 pointerdown 及随后的 click）
    const TRANSIENT = ".arc-overlay:not([data-page]), .arc-menu:not([hidden])";
    let swallowClick = 0;
    document.addEventListener("pointerdown", e => {
        if (getPopupMode() || e.button !== 0) return;
        const open = [...document.querySelectorAll<HTMLElement>(TRANSIENT)];
        if (!open.length) return;
        const tgt = e.target as Node | null;
        if (tgt && open.some(el => el.contains(tgt))) return;
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
        swallowClick = Date.now();
        dismiss("pointerdown-outside");
    }, true);
    for (const type of ["click", "mouseup", "dblclick", "contextmenu"]) document.addEventListener(type, e => {
        if (swallowClick && Date.now() - swallowClick < 600) { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); if (type !== "mouseup") swallowClick = type === "click" ? 0 : swallowClick; }
    }, true);
    // 唤醒后台（重启后后台是懒启动的）
    void safe(chrome.runtime.sendMessage({ type: "arc-ping", from: where }), "arc-ping");
    // 网页没有内容脚本时（helium:// / chrome:// / 新标签页 / 浏览器自身界面）也能关：切了标签或焦点去了别的窗口 / 应用
    if (!getPopupMode()) {
        const onAct = () => { if (overlayEl || document.querySelector(".arc-menu:not([hidden])")) dismiss("tab-activated"); };
        chrome.tabs.onActivated.addListener(onAct);
        void safe(currentWindow().then(me => chrome.windows.onFocusChanged.addListener(w => {
            if (parkClosed()) return; // 补丁 inpage-parked-timers-stop-b：停放（且隐藏）的 iframe 不处理窗口焦点变化：flog 每次 = setTimeout + storage.local.get + set（读改写，N 个 iframe 同写一个 key），而它没有可见的菜单 / 浮层可关（隐藏那一拍已 dismiss("hidden")）
            flog(where, `onFocusChanged ${w} (mine ${me.id})`);
            if (w !== me.id && (overlayEl || document.querySelector(".arc-menu:not([hidden])"))) dismiss("other-window");
        })), "windows.getCurrent");
    }
    // 侧边栏 / 弹窗自身失焦（点了网页、别的窗口、⌘`、别的应用）
    const born = Date.now();
    addEventListener("blur", () => { flog(where, "window.blur"); if (Date.now() - born > 400) dismiss("blur"); });
    addEventListener("focus", () => flog(where, "window.focus"));
    document.addEventListener("visibilitychange", () => { flog(where, `visibility:${document.visibilityState}`); if (document.hidden) dismiss("hidden"); });
    if (getPopupMode()) {
        // 弹窗：轮询“最后聚焦的窗口”——失焦事件丢了也能关
        void safe(currentWindow().then(me => {
            const iv = setInterval(async () => {
                if (Date.now() - born < 700) return;
                const lf = await safe(chrome.windows.getLastFocused(), "windows.getLastFocused", null);
                if (lf && lf.id !== me.id && lf.focused) { clearInterval(iv); flog(where, `poll: focus on ${lf.id}`); dismiss("poll"); }
            }, 400);
        }), "windows.getCurrent");
    }
    // 侧边栏空白处右键：插件注册到 "sidebar" 位置的菜单（新标签 / 新空间 / 外观 / 空间颜色……）
    document.addEventListener("contextmenu", e => {
        const tgt = e.target as Element | null;
        if (e.defaultPrevented || !tgt?.closest?.("#app") || tgt.closest(".arc-tab, button, input, a, .arc-folder-head, .arc-fav-grid, .arc-overlay, .arc-menu")) return;
        if (menuRegistry("sidebar").size) showContextMenu(e, "sidebar", {});
    });
    renderAll();
}

let deferred: ReturnType<typeof setTimeout> | undefined;
/* 指针按下到抬起之间不重绘：带弹出菜单的控件（＋）重绘时整块换新，按下后旧按钮被摘掉，click 不会派发——
 * 快速再次打开 ＋ 时“点了没反应”（plus-repeat KEY=1 #2 复现）。抬起 / 取消后推迟的重绘照常补上 */
let pressing = false;
function renderAll() {
    // 52016：侧栏内的菜单（＋ 菜单）开着时不重绘——整屏重绘会把它关掉；关上后再补一次
    if (pressing || root.querySelector(".arc-menu:not([hidden]):not(.closing), .arc-menu[data-opening]")) { clearTimeout(deferred); deferred = setTimeout(renderAll, 250); return; }
    for (const c of cleanups) { try { c(); } catch (e) { console.error(e); } }
    cleanups = [];
    const scrollTop = root.querySelector(".arc-scroll")?.scrollTop ?? 0;
    const frag: Node[] = [];
    let scroll: HTMLElement | null = null;
    const hovered = hoveredKeyed(root); // 52016：整屏重绘时保住指针下那一行（见 keepHover.ts）
    recordListeners(() => {
    for (const name of SLOT_ORDER) {
        const box = h("section", { class: `arc-slot arc-slot-${name}`, "data-slot": name });
        for (const [, def] of slot(name).sorted()) {
            const part = h("div", { class: "arc-part", "data-plugin": def.plugin });
            try {
                const c = def.render(part);
                if (c) cleanups.push(c);
            } catch (e) { part.textContent = tr("shell.componentError", String(e)); part.classList.add("arc-hint"); }
            box.appendChild(part);
        }
        if (name === "pinned" || name === "today" || name === "header") {
            scroll ??= h("div", { class: "arc-scroll" });
            scroll.appendChild(box);
            if (name === "today") frag.push(scroll);
        } else frag.push(box);
    }
    });
    if (!commitKeepingHover(root, frag, hovered)) root.replaceChildren(...frag);
    reuseFavicons(root); // favicon-jitter：把上一次渲染里已加载好的 favicon 节点按行 key 换回来，重绘不重新加载 / 不闪
    if (scroll) (scroll as HTMLElement).scrollTop = scrollTop;
}

let overlayEl: HTMLElement | null = null;
let overlayOutsideOff: (() => void) | undefined;
// 惰性读取 location（测试可在无 location 的环境 import 本模块）
let popupCache: string | null | undefined;
const getPopupMode = () => popupCache !== undefined ? popupCache : (popupCache = typeof location === "undefined" ? null : new URLSearchParams(location.search).get("popup"));
export const currentOverlay = () => overlayEl?.dataset.overlay ?? null;

export function closeOverlay() {
    const had = overlayEl != null;
    overlayOutsideOff?.(); overlayOutsideOff = undefined;
    if (typeof overlayCleanup === "function") overlayCleanup();
    else if (Array.isArray(overlayCleanup)) for (const c of overlayCleanup) c();
    overlayCleanup = undefined;
    overlayEl?.remove();
    overlayEl = null;
    // 弹窗模式：浮层关闭即关闭窗口（稍等让 run() 中的异步调用发出）
    if (getPopupMode() && had) setTimeout(() => window.close(), 150);
}

function showOverlay(id: string, arg: unknown) {
    const def = overlays.get(id);
    if (!def) return;
    closeOverlay();
    // 51998：flex 列里的子项默认 min-height:auto，内容高于浮层时撑破、无法滚动（管理空间等）→ 允许收缩并内部滚动
    const body = h("div", { class: "arc-overlay-body", style: "min-height:0;overscroll-behavior:contain" });
    overlayEl = h("div", { class: `arc-overlay${def.page ? " arc-overlay-page" : ""}`, "data-overlay": id, "data-page": def.page ? "1" : undefined },
        def.page ? null : h("div", { class: "arc-overlay-head" }, h("span", null, def.title), h("button", { class: "arc-icon-btn", "data-tip": tr("common.close"), onclick: closeOverlay }, icon("x"))),
        body);
    document.body.appendChild(overlayEl);
    // 浮层（命令栏 / 管理空间等）：点外面只关闭，不触发下面的元素；整页浮层（Library）不受影响
    if (!def.page && !getPopupMode()) { const el = overlayEl; overlayOutsideOff = swallowOutside(() => el.isConnected, t => el.contains(t) || !!(t as Element).closest?.(".arc-menu, .arc-dlg-mask") || !!t.parentElement?.closest(".arc-menu, .arc-dlg-mask"), closeOverlay); }
    overlayCleanup = def.render(body, arg, closeOverlay);
}

export function showContextMenu(e: MouseEvent, loc: MenuLocation, target: MenuTarget, cls = "") {
    e.preventDefault();
    e.stopPropagation();
    return showMenuAt({ x: e.clientX, y: e.clientY }, loc, target, cls);
}

/** 在指定位置弹出某个位置的菜单；相邻项 group 不同时插入分隔线 */
export function showMenuAt(at: { x: number; y: number }, loc: MenuLocation, target: MenuTarget, cls = "") {
    const lay = MENU_LAYOUT[loc];
    const items = menuRegistry(loc).sorted().filter(([, d]) => d.visible?.(target) ?? true)
        .map(([, d], i) => { const L = lay?.[d.id]; return { d: L ? { ...d, group: L[0] } : (lay ? { ...d, group: d.group ?? 9 } : d), o: L ? L[1] : (lay ? 900 + i : i) }; })
        .sort((a, b) => a.o - b.o).map(x => [x.d.id, x.d] as const);
    const out: MenuEntry[] = [];
    let g: number | undefined;
    for (const [, d] of items) {
        if (d.group != null && g != null && d.group !== g) out.push({ label: "", separator: true });
        if (d.group != null) g = d.group;
        out.push(menuEntry(d, target));
    }
    return openMenu(at, out, cls);
}

function menuEntry(d: MenuItemDef, target: MenuTarget): MenuEntry {
    if (d.separator) return { separator: true, label: "" };
    const label = tr(typeof d.label === "function" ? d.label(target) : d.label);
    const sub = d.submenu?.(target);
    const val = <T,>(v: T | ((t: MenuTarget) => T) | undefined) => typeof v === "function" ? (v as (t: MenuTarget) => T)(target) : v;
    const title = val(d.title);
    const sc = d.command ? keyFor(d.command) : d.shortcut ? prettyCombo(d.shortcut) : undefined;
    const base = { shortcut: sc || undefined, label, checked: d.checked?.(target), test: d.test ?? d.id, disabled: val(d.disabled), title: title ? tr(title) : undefined, danger: d.danger };
    return sub ? { ...base, submenu: sub.map(x => menuEntry(x, target)) } : { ...base, run: () => d.run(target) };
}

/** Toast（toast-spec.md）：默认停留 5s；点击或拖动关闭；进出 spring 动画。
 *  位置固定为 location 3 floatingTopRight（audit-52193-answers.md「Toast 位置定案」B.3），即侧栏面板右上角（CSS .arc-toast）。
 *  例外：新后台标签提示在 Arc 用 location 0 / 5s（B.3，BackgroundTabAffordanceController）；扩展没有这个提示（文案 ⛔），不加。 */
export const TOAST_MS = 5000;
export function toast(text: string, ms = TOAST_MS) {
    const t = h("div", { class: "arc-toast", role: "status", "data-test": "toast" }, text);
    let gone = false;
    const dismiss = () => { if (gone) return; gone = true; t.classList.add("out"); setTimeout(() => t.remove(), 600); };
    let x0: number | null = null, dx = 0;
    t.addEventListener("pointerdown", e => { x0 = e.clientX; dx = 0; t.setPointerCapture?.(e.pointerId); });
    t.addEventListener("pointermove", e => { if (x0 == null) return; dx = e.clientX - x0; t.style.transform = `translate(${dx}px, 0)`; t.style.animation = "none"; });
    t.addEventListener("pointerup", () => { if (x0 == null) return; x0 = null; t.style.setProperty("--toast-dx", `${dx}px`); t.style.transform = ""; t.style.animation = ""; dismiss(); });
    t.addEventListener("click", dismiss);
    document.body.appendChild(t);
    setTimeout(dismiss, ms);
    return t;
}

/** 复制网址（走 copy 管线）并提示：变换给了 toastKey 就用它，否则 “Copied Current URL” */
export async function copyUrlWithToast(url: string): Promise<boolean> {
    const r = applyUrlTransformsDetailed("copy", url);
    const ok = await copyText(r.url);
    if (ok) toast(tr(copyToastKey(r)));
    return ok;
}

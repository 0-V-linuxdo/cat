/* content 上下文：截取覆盖层（变灰变暗 + 相机光标 + 拖框 / 单击元素 / Esc）、整页 JS 缩放截取、截取后的操作菜单与提示。 */
import { arcTooltip } from "@components/ArcTooltip"; // closed shadow root：data-tip 自动挂载看不到，直接调用（样式注入该 root，同 peek）
import { call } from "@api/RPC";
import { safe } from "@api/ErrorLog"; // page.js（内容脚本上下文）可用：ErrorLog 只依赖 chrome.storage.local，内容脚本有权限
import { tr } from "@api/i18n";
import { appearanceMode, resolveDark, systemIsDark, watchAppearance } from "@api/Appearance";
import { CURSOR } from "./cursor";
import { PAGE_Z_MAX } from "@utils/zLayers";
import { atTop, captureFilename, FULL_PAGE_DELAY_MS, zoomPlan, CUSTOM_VISUALS as V, menuCss, OVERLAY_BUBBLE, captureScale, cropRect, isClick, menuItems, moveSelection, portraitLayout, PORTRAIT, rectFromDrag, type CaptureAction, type Pt, type Rect } from "./logic";

const Z = String(PAGE_Z_MAX);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
let active: (() => void) | null = null;

function shadowHost(id: string) {
    document.getElementById(id)?.remove();
    const host = document.createElement("div");
    host.id = id;
    host.style.cssText = `all:initial;position:fixed;inset:0;z-index:${Z};`;
    const root = host.attachShadow({ mode: "closed" });
    document.documentElement.append(host);
    return { host, root };
}

const loadImg = (src: string) => new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
const visible = () => call<string>("capture.visible");

/** 截当前视口并裁出 rect（视口 CSS 坐标）→ PNG data URL */
async function captureRect(r: Rect): Promise<string | null> {
    const img = await loadImg(await visible());
    const s = captureScale(img.naturalWidth, innerWidth);
    const c = cropRect(r, s, img.naturalWidth, img.naturalHeight);
    if (!c) return null;
    const cv = Object.assign(document.createElement("canvas"), { width: c.width, height: c.height });
    cv.getContext("2d")!.drawImage(img, c.x, c.y, c.width, c.height, 0, 0, c.width, c.height);
    return cv.toDataURL("image/png");
}

/** 整页【降级实现】，无法对齐：需要内核：Arc 用内核 ArcWebView captureFullPage: 截整页（capture.md Q4），扩展拿不到；CDP 需要 debugger 权限，Helium 不允许列为可选权限，Cat 决定不用。
 * JS 缩放 body（transform: scale + transform-origin: top left），滚回顶部后一次截取 */
async function captureFullPage(): Promise<string | null> {
    const se = document.scrollingElement ?? document.documentElement;
    const body = document.body;
    if (!body) return null;
    const startX = se.scrollLeft, startY = se.scrollTop;
    const prev = { transform: body.style.transform, origin: body.style.transformOrigin };
    const { scale, rect } = zoomPlan(se.scrollWidth, se.scrollHeight, innerWidth, innerHeight);
    try {
        se.scrollTo(0, 0);
        body.style.transformOrigin = "top left";
        body.style.transform = `scale(${scale})`;
        // 保留 Arc 的 0.5 s 延迟：JS 缩放后要等重排 / 重绘和懒加载图片完成，否则会截到缩放前或空白的画面
        await sleep(FULL_PAGE_DELAY_MS);
        if (!atTop(se.scrollTop)) { se.scrollTo(0, 0); await sleep(FULL_PAGE_DELAY_MS); }
        return await captureRect(rect);
    } finally {
        body.style.transform = prev.transform;
        body.style.transformOrigin = prev.origin;
        se.scrollTo(startX, startY);
    }
}

/** Portrait：视口截图放在网站主色背景上，留白加圆角。⛔ 壁纸背景、水印、留白比例：不做 / 源码未找到 */
async function capturePortrait(): Promise<string> {
    const img = await loadImg(await visible());
    const { canvasW, canvasH, pad } = portraitLayout(img.naturalWidth, img.naturalHeight);
    const cv = Object.assign(document.createElement("canvas"), { width: canvasW, height: canvasH });
    const ctx = cv.getContext("2d")!;
    ctx.fillStyle = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content || getComputedStyle(document.body).backgroundColor || "Canvas"; // 兜底色源码未找到：中性占位
    ctx.fillRect(0, 0, canvasW, canvasH);
    const r = PORTRAIT.radius * captureScale(img.naturalWidth, innerWidth);
    ctx.save(); ctx.beginPath(); ctx.roundRect(pad, pad, img.naturalWidth, img.naturalHeight, r); ctx.clip();
    ctx.drawImage(img, pad, pad); ctx.restore();
    return cv.toDataURL("image/png");
}

/* ---------- 覆盖层 ---------- */
export type Mode = "select" | "drag" | "full" | "portrait" | "image";

export async function startCapture(mode: Mode, opts: { start?: Pt; srcUrl?: string } = {}) {
    active?.();
    if (mode === "full") return finish(await safe(captureFullPage(), "capture.fullPage", null), mode);
    if (mode === "portrait") return finish(await safe(capturePortrait(), "capture.portrait", null), mode);
    if (mode === "image") {
        const img = Array.from(document.images).find(i => i.currentSrc === opts.srcUrl || i.src === opts.srcUrl);
        if (!img) return finish(null, mode);
        img.scrollIntoView({ block: "nearest" });
        await sleep(50);
        const b = img.getBoundingClientRect();
        return finish(await safe(captureRect({ x: b.left, y: b.top, width: b.width, height: b.height }), "capture.rect", null), mode);
    }
    overlay(mode, opts.start);
}

function overlay(mode: Mode, start?: Pt) {
    const { host, root } = shadowHost("cat-capture-overlay");
    host.style.cursor = CURSOR;
    const shade = document.createElement("div");
    // 选区外：变灰 + 变暗；选区内保持原样（clip-path 挖洞）
    shade.style.cssText = `position:fixed;inset:0;backdrop-filter:${V.shadeFilter};background:${V.shadeColor};`;
    const focus = document.createElement("div");
    focus.style.cssText = `position:fixed;border:${V.focusBorder};border-radius:${V.focusRadius}px;box-shadow:${V.focusOutline};pointer-events:none;display:none;transition:${["left", "top", "width", "height"].map(p => `${p} ${V.focusTransition}`).join(",")};`;
    const bubble = document.createElement("div");
    bubble.textContent = tr(mode === "drag" ? "capture.hintDrag" : "capture.hint");
    bubble.style.cssText = `position:fixed;top:16px;left:50%;transform:translateX(-50%);${OVERLAY_BUBBLE.css}padding:${V.bubblePadding};pointer-events:none;`;
    root.append(shade, focus, bubble);

    let down: Pt | null = start ?? null;
    let sel: Rect | null = null;
    let hoverRect: Rect | null = null;
    const hole = (r: Rect | null) => {
        if (!r) { shade.style.clipPath = ""; return; }
        const W = innerWidth, H = innerHeight;
        shade.style.clipPath = `path(evenodd, "M0 0H${W}V${H}H0Z M${r.x} ${r.y}h${r.width}v${r.height}h${-r.width}Z")`;
    };
    const showFocus = (r: Rect | null) => {
        if (!r) { focus.style.display = "none"; return; }
        Object.assign(focus.style, { display: "block", left: `${r.x}px`, top: `${r.y}px`, width: `${r.width}px`, height: `${r.height}px` });
    };
    const elementAt = (p: Pt): Rect | null => {
        host.style.pointerEvents = "none";
        const el = document.elementFromPoint(p.x, p.y);
        host.style.pointerEvents = "";
        if (!el || el === document.documentElement || el === document.body) return null;
        const b = el.getBoundingClientRect();
        return b.width > 2 && b.height > 2 ? { x: b.left, y: b.top, width: b.width, height: b.height } : null;
    };

    const end = () => { removeEventListener("keydown", onKey, true); host.remove(); active = null; };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); end(); } };
    addEventListener("keydown", onKey, true);
    active = end;

    host.addEventListener("mousedown", e => { if (e.button === 0) { down = { x: e.clientX, y: e.clientY }; e.preventDefault(); } });
    host.addEventListener("mousemove", e => {
        const p = { x: e.clientX, y: e.clientY };
        if (down && !isClick(down, p)) { sel = rectFromDrag(down, p); focus.style.transition = "none"; showFocus(sel); hole(sel); return; }
        if (!down && mode === "select") { hoverRect = elementAt(p); showFocus(hoverRect); hole(hoverRect); }
    });
    host.addEventListener("mouseup", async e => {
        if (!down) return;
        const p = { x: e.clientX, y: e.clientY };
        const r = isClick(down, p) ? (mode === "select" ? elementAt(p) : null) : rectFromDrag(down, p);
        down = null;
        if (!r) { if (mode === "drag") end(); return; }
        end();
        await sleep(60); // 等覆盖层消失再截
        finish(await safe(captureRect(r), "capture.rect", null), mode);
    });
    host.addEventListener("contextmenu", e => { e.preventDefault(); end(); });
}

/* ---------- 截取后：预览 + 操作菜单 ---------- */
function finish(dataUrl: string | null, mode: Mode) {
    if (!dataUrl) { showToast(tr("capture.failed")); return; }
    showMenu(dataUrl, mode);
}

function showMenu(dataUrl: string, mode: Mode) {
    const { host, root } = shadowHost("cat-capture-menu");
    const created = new Date();
    const filename = captureFilename(created);
    let libraryId: number | string | null = null;
    let kb = -1;

    const style = document.createElement("style");
    // 外观（Themes.mode）：auto 跟系统，light / dark 钉住；菜单开着时系统 / 设置变化只重写 <style> 文本（不重建 DOM、不重放动画）
    style.textContent = menuCss(resolveDark(appearanceMode(), systemIsDark()));
    const back = Object.assign(document.createElement("div"), { className: "back" });
    const wrap = Object.assign(document.createElement("div"), { className: "wrap" });
    const preview = Object.assign(document.createElement("img"), { src: dataUrl, alt: "" });
    const menu = Object.assign(document.createElement("div"), { className: "menu", role: "menu" });
    wrap.append(preview, menu);
    root.append(style, back, wrap);

    const stopWatch = watchAppearance(sc => { style.textContent = menuCss(sc.dark); });
    const close = () => { removeEventListener("keydown", onKey, true); stopWatch(); host.remove(); };
    const draw = () => {
        const items = menuItems({ savedToLibrary: libraryId != null });
        menu.replaceChildren();
        items.forEach((it, i) => {
            if (it.action === "retake" || it.action === "saveAsFile") menu.append(Object.assign(document.createElement("div"), { className: "div" }));
            const row = Object.assign(document.createElement("div"), { className: `row${it.toggled ? " toggle" : ""}${i === kb ? " sel" : ""}`, textContent: tr(it.label), role: "menuitem" });
            row.setAttribute("aria-disabled", String(!it.enabled));
            if (!it.enabled) arcTooltip(row, tr("capture.unavailable"));
            row.onmouseenter = () => { if (it.enabled) { kb = i; draw(); } };
            row.onclick = () => { if (it.enabled) void run(it.action); };
            menu.append(row);
        });
        return items;
    };
    const run = async (a: CaptureAction) => {
        if (a === "copyImage") { close(); await copyImage(dataUrl, filename); }
        else if (a === "saveAsFile") { close(); await call("capture.download", dataUrl, filename, true).catch(() => showToast(tr("capture.saveFailed"))); }
        else if (a === "toggleSaveToLibrary") {
            if (libraryId == null) { libraryId = await safe(call<number | string | null>("capture.saveToLibrary", dataUrl, filename), "capture.saveToLibrary", null); if (libraryId != null) showToast(tr("capture.savedToLibrary")); else showToast(tr("capture.saveFailed")); }
            else { await safe(call("capture.removeFromLibrary", libraryId), "capture.removeFromLibrary"); libraryId = null; }
            draw();
        } else if (a === "retake") { close(); void startCapture(mode === "drag" ? "select" : mode); }
    };
    const onKey = (e: KeyboardEvent) => {
        const items = menuItems({ savedToLibrary: libraryId != null });
        if (e.key === "Escape") close();
        else if (e.key === "ArrowDown" || e.key === "ArrowUp") { kb = moveSelection(items, kb, e.key === "ArrowDown" ? 1 : -1); draw(); }
        else if (e.key === "Enter" && kb >= 0 && items[kb]?.enabled) void run(items[kb].action);
        else return;
        e.preventDefault(); e.stopImmediatePropagation();
    };
    addEventListener("keydown", onKey, true);
    back.onclick = close;
    draw();
}

async function copyImage(dataUrl: string, filename: string) {
    try {
        const blob = await (await fetch(dataUrl)).blob();
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        showToast(tr("capture.copied"), 5000, { label: tr("capture.saveToFile"), run: () => void call("capture.download", dataUrl, filename, true) });
    } catch { showToast(tr("capture.copyFailed")); }
}

/** 页面内提示（Arc toast：内边距 12/10、最小高 42、圆角 12、默认 5 秒、可点击关闭）。ms = 0 表示手动关闭 */
export function showToast(text: string, ms = 5000, action?: { label: string; run: () => void }): () => void {
    const { host, root } = shadowHost(`cat-capture-toast-${Math.random().toString(36).slice(2, 6)}`);
    host.style.inset = "auto 16px auto auto"; host.style.top = "16px";
    const t = document.createElement("div");
    t.style.cssText = "display:flex;align-items:center;gap:10px;min-height:42px;box-sizing:border-box;padding:10px 12px;border-radius:12px;background:color-mix(in srgb, Canvas 80%, transparent);color:CanvasText;font:13px system-ui;border:1px solid rgba(0,0,0,.3);box-shadow:0 4px 16px rgba(0,0,0,.2);"; // toast-spec：背景 ×0.8、描边 black×0.3、阴影 black×0.2 有出处；调色板颜色源码未找到 → 系统色占位
    t.append(text);
    if (action) {
        const b = Object.assign(document.createElement("button"), { textContent: action.label });
        b.style.cssText = "border:0;background:rgba(255,255,255,.2);color:rgba(255,255,255,.6);border-radius:6px;padding:4px 8px;font:inherit;";
        b.onclick = e => { e.stopPropagation(); action.run(); host.remove(); };
        t.append(b);
    }
    t.onclick = () => host.remove();
    root.append(t);
    const done = () => host.remove();
    if (ms) setTimeout(done, ms);
    return done;
}

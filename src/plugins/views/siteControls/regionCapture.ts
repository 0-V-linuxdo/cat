/* 站点控制「截取页面的一部分」（Arc SCC ButtonType.capture → didClickCaptureButton(payload 0)，scc-action-buttons.md §3）。
 * 可选插件 Capture 开着时，交给它的 capture.start（完整的 Arc 覆盖层 + 截取后操作菜单）；没开时用这里的最小实现：
 * 注入一个拖框覆盖层（选区外变灰变暗、Arc 相机十字光标、提示气泡、Esc / 右键取消），返回选区 → captureVisibleTab 后裁剪。
 * 视觉值全部复用 Capture 插件（capture/logic.ts 的 OVERLAY_BUBBLE = capture.md 源码值；CUSTOM_VISUALS = 那边已标 ⛔ 的自定值），这里不新增数值。
 * 单独成文件：pickRegion 在页面里运行（chrome.scripting.executeScript），里面有 pointermove 监听，不能放进 siteControls/index.ts
 * （siteControlsClickOnly.test.ts 要求那个文件没有悬停类监听）。 */
import "@plugins/capture/i18n";
import { CURSOR } from "@plugins/capture/cursor";
import { CLICK_SLOP, CUSTOM_VISUALS as V, OVERLAY_BUBBLE, captureScale, cropRect, type Rect } from "@plugins/capture/logic";
import { tr } from "@api/i18n";
import { PAGE_Z_MAX } from "@utils/zLayers";

export interface Picked { x: number; y: number; width: number; height: number; vw: number }
/** z：页面最高层（PAGE_Z_MAX）。pickRegion 由 executeScript 序列化注入、不带模块作用域，值只能经参数传入（不能在函数体里引用 PAGE_Z_MAX） */
export interface PickStyle { cursor: string; shade: string; focus: string; bubble: string; hint: string; slop: number; z: number }

export const pickStyle = (): PickStyle => ({
    cursor: CURSOR,
    shade: `position:fixed;inset:0;backdrop-filter:${V.shadeFilter};background:${V.shadeColor};`,
    focus: `position:fixed;border:${V.focusBorder};border-radius:${V.focusRadius}px;box-shadow:${V.focusOutline};pointer-events:none;display:none;`,
    bubble: `position:fixed;top:16px;left:50%;transform:translateX(-50%);${OVERLAY_BUBBLE.css}padding:${V.bubblePadding};pointer-events:none;`,
    hint: tr("capture.hintDrag"), // Arc ContentCaptureOverlayBubble：“Drag to capture a portion of this page”（capture.md §1）
    slop: CLICK_SLOP,
    z: PAGE_Z_MAX,
});

/** 在页面里运行（自包含，不能引用模块里的其它东西）：拖框选区；Esc / 右键 / 单击（不拖）取消 → null */
export function pickRegion(st: PickStyle): Promise<Picked | null> {
    const ID = "cat-scc-capture-overlay";
    document.getElementById(ID)?.remove();
    const host = document.createElement("div");
    host.id = ID;
    host.style.cssText = `all:initial;position:fixed;inset:0;z-index:${st.z};cursor:${st.cursor};`;
    const root = host.attachShadow({ mode: "closed" });
    const shade = document.createElement("div"); shade.style.cssText = st.shade;
    const focus = document.createElement("div"); focus.style.cssText = st.focus;
    const bubble = document.createElement("div"); bubble.style.cssText = st.bubble; bubble.textContent = st.hint;
    root.append(shade, focus, bubble);
    document.documentElement.append(host);
    return new Promise(resolve => {
        let down: { x: number; y: number } | null = null;
        let sel: { x: number; y: number; width: number; height: number } | null = null;
        const rect = (a: { x: number; y: number }, b: { x: number; y: number }) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) });
        const done = (r: typeof sel) => {
            removeEventListener("keydown", onKey, true);
            host.remove();
            if (!r) { resolve(null); return; }
            // 等覆盖层从画面上消失再让侧栏截图（两帧）
            requestAnimationFrame(() => requestAnimationFrame(() => resolve({ ...r, vw: innerWidth })));
        };
        const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); done(null); } };
        addEventListener("keydown", onKey, true);
        host.addEventListener("pointerdown", e => { if (e.button !== 0) return; e.preventDefault(); down = { x: e.clientX, y: e.clientY }; try { host.setPointerCapture(e.pointerId); } catch { /* 合成事件没有活动指针（自测）：覆盖层铺满视口，不捕获也收得到 move/up */ } });
        host.addEventListener("pointermove", e => {
            if (!down) return;
            sel = rect(down, { x: e.clientX, y: e.clientY });
            Object.assign(focus.style, { display: "block", left: `${sel.x}px`, top: `${sel.y}px`, width: `${sel.width}px`, height: `${sel.height}px` });
            const W = innerWidth, H = innerHeight;
            shade.style.clipPath = `path(evenodd, "M0 0H${W}V${H}H0Z M${sel.x} ${sel.y}h${sel.width}v${sel.height}h${-sel.width}Z")`;
        });
        host.addEventListener("pointerup", e => {
            if (!down) return;
            const r = rect(down, { x: e.clientX, y: e.clientY });
            down = null;
            done(Math.hypot(r.width, r.height) < st.slop ? null : r);
        });
        host.addEventListener("contextmenu", e => { e.preventDefault(); done(null); });
    });
}

/** 截图（data URL）按视口 CSS 选区裁剪 → PNG data URL；无面积返回 null */
export async function cropShot(dataUrl: string, p: Picked): Promise<string | null> {
    const bmp = await createImageBitmap(await (await fetch(dataUrl)).blob());
    const c = cropRect(p as Rect, captureScale(bmp.width, p.vw), bmp.width, bmp.height);
    if (!c) return null;
    const cv = new OffscreenCanvas(c.width, c.height);
    cv.getContext("2d")!.drawImage(bmp, c.x, c.y, c.width, c.height, 0, 0, c.width, c.height);
    const blob = await cv.convertToBlob({ type: "image/png" });
    return await new Promise<string>((res, rej) => { const fr = new FileReader(); fr.addEventListener("load", () => res(String(fr.result))); fr.addEventListener("error", () => rej(fr.error)); fr.readAsDataURL(blob); });
}

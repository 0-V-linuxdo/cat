/* Capture 纯函数（无 chrome / DOM，供单测）。规格：/workspace/arc-analysis/capture.md */

export interface Rect { x: number; y: number; width: number; height: number }
export interface Pt { x: number; y: number }

/** 菜单尺寸与配色（capture.md §4） */
export const MENU = {
    width: 273, radius: 7, textPadding: 20,
    /** ⛔ 行高源码未找到 */
    rowHeight: 32,
    light: { bg: "#FFFFFF", text: "#000000", selected: "#292EC1", selectedText: "#FFFFFF", toggle: "#3139FB" },
    dark: { bg: "#120F2E", text: "#FFFFFF", selected: "#292EC1", selectedText: "#FFFFFF", toggle: "#D6D7FB" },
} as const;

/** 拖动小于此距离视为单击（截元素）。⛔ 源码未找到 */
export const CLICK_SLOP = 4;
/** 整页滚动比较 epsilon（JavascriptUtils.swift） */
export const SCROLL_EPSILON = 3;
/** captureVisibleTab 每秒最多 2 次（Chrome 限制） */
export const CAPTURE_INTERVAL_MS = 550;

/** 两点 → 规范化矩形 */
export function rectFromDrag(a: Pt, b: Pt): Rect {
    return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}
export const isClick = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y) < CLICK_SLOP;

/** CSS 像素矩形（视口坐标）→ 截图里的整数像素源矩形，裁到图片范围内；无面积时返回 null */
export function cropRect(r: Rect, scale: number, imgW: number, imgH: number): Rect | null {
    const x0 = Math.max(0, Math.floor(r.x * scale)), y0 = Math.max(0, Math.floor(r.y * scale));
    const x1 = Math.min(imgW, Math.ceil((r.x + r.width) * scale)), y1 = Math.min(imgH, Math.ceil((r.y + r.height) * scale));
    return x1 > x0 && y1 > y0 ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : null;
}

/** 截图实际倍率：图片宽 / 视口宽（比 devicePixelRatio 可靠，页面缩放也对） */
export const captureScale = (imgW: number, viewportW: number) => viewportW > 0 ? imgW / viewportW : 1;

/** 整页截图是否分块、有没有尺寸上限：源码未找到（Arc 在内核里实现），保持现状。
 * 整页的降级做法：JS 缩放。Arc 的整页截图走内核原生接口（ArcWebView captureFullPage:，capture.md Q4），JS 缩放只在 Easel 里用；
 * 这里整页只用它（无法对齐：需要内核）。倍率（缩到放得下一个视口）是我们自定的，Capture 本身没有 JS 缩放倍率。 */
export function zoomPlan(totalW: number, totalH: number, viewW: number, viewH: number): { scale: number; rect: Rect } {
    const scale = totalW > 0 && totalH > 0 && viewW > 0 && viewH > 0 ? Math.min(1, viewW / totalW, viewH / totalH) : 1;
    return { scale, rect: { x: 0, y: 0, width: Math.min(viewW, totalW * scale), height: Math.min(viewH, totalH * scale) } };
}
/** 滚回顶部是否到位（SCROLL_EPSILON = 3） */
export const atTop = (y: number) => Math.abs(y) <= SCROLL_EPSILON;
/** Arc FullPageCaptureDelay = 0.5 s；JS 缩放后等重排重绘，同样需要（capture.md「补充：整页截图」Q5，handleCaptureAction @0x100201f54） */
export const FULL_PAGE_DELAY_MS = 500;

const p2 = (n: number) => String(n).padStart(2, "0");
/** yyyy-MM-dd-HHmmss（本地时间） */
export function captureStamp(d: Date): string {
    return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
}
/** 默认文件名。⛔ Arc 的前缀未解出：用 "Capture " */
export function captureFilename(d: Date, ext = "png"): string {
    return `Capture ${captureStamp(d)}.${ext}`;
}

/* ---------- 操作菜单 ---------- */
/** CaptureActionType 的 8 个操作，Arc 枚举顺序 */
export const ACTIONS = ["newEasel", "copyImage", "sendAsMessage", "saveAsFile", "saveToEasel", "toggleSaveToLibrary", "retake", "edit"] as const;
export type CaptureAction = typeof ACTIONS[number];
/** Cat 没有 Easel / iMessage / 图片编辑器：这几项显示但不可用 */
export const UNSUPPORTED: ReadonlySet<CaptureAction> = new Set(["newEasel", "sendAsMessage", "saveToEasel", "edit"]);

export interface MenuItem { action: CaptureAction; label: string; enabled: boolean; toggled?: boolean }

export function menuItems(state: { savedToLibrary: boolean }): MenuItem[] {
    return ACTIONS.map(action => ({
        action,
        label: action === "toggleSaveToLibrary" ? (state.savedToLibrary ? "capture.savedToLibrary" : "capture.saveToLibrary") : `capture.${action}`,
        enabled: !UNSUPPORTED.has(action),
        ...(action === "toggleSaveToLibrary" ? { toggled: state.savedToLibrary } : {}),
    }));
}

/** ↑/↓ 移动键盘选中项：跳过不可用项、首尾循环；cur = -1 表示还没选中 */
export function moveSelection(items: MenuItem[], cur: number, dir: 1 | -1): number {
    const n = items.length;
    if (!items.some(i => i.enabled)) return -1;
    let i = cur < 0 ? (dir === 1 ? -1 : n) : cur;
    for (let k = 0; k < n; k++) {
        i = (i + dir + n) % n;
        if (items[i].enabled) return i;
    }
    return cur;
}

/** 按住 ⌘⇧（非 mac 为 Ctrl+Shift）拖动开始截取 */
export const isDragCombo = (e: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; button?: number }, mac: boolean) =>
    (e.button ?? 0) === 0 && e.shiftKey && !e.altKey && (mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey);

/** Portrait：截图四周留白（截图长边的比例）与圆角。源码未找到，自定值 */
export const PORTRAIT = { padRatio: 0.06, radius: 12 };

/** 提示气泡（ContentCaptureOverlayBubble）。出处 capture.md「补查（2026-10-16 晚）」§1：
 * - 白底填充 Color.white、RoundedRectangle(.continuous, 16)：第 154 行（FUN_101cc6be4）
 * - 描边 1px LinearGradient [OverlayBubblePink #FF9999（第 150 行）, OverlayBubbleBlue #0047FF（第 151 行）]，start (0.7,0.5) → end (1.1,0.5)：第 154 行
 * - 文字 OverlayBubbleText #340594（第 149 行）× opacity 0.8，system 14 semibold：第 153 行（FUN_101cc60b8）
 * - 深浅色同一套：第 156 行。颜色本身来自 ARC_Capture.bundle/Assets.car（第 149–151 行的 DAT_ 出处）
 * 第二层渐变（第 155 行，FUN_101cc69ec，用途源码未找到）先不加。 */
export const OVERLAY_BUBBLE = {
    background: "#FFFFFF",
    radius: 16,
    text: "rgba(52,5,148,.8)", // #340594 × 0.8
    font: "600 14px system-ui,-apple-system,sans-serif",
    pink: "#FF9999",
    blue: "#0047FF",
    /** CSS 写法：padding-box 白底 + border-box 渐变实现 1px 渐变描边；SwiftUI 的 0.7→1.1 映射为水平 70%→110% */
    get css() { return `background:linear-gradient(${this.background},${this.background}) padding-box,linear-gradient(90deg,${this.pink} 70%,${this.blue} 110%) border-box;border:1px solid transparent;border-radius:${this.radius}px;color:${this.text};font:${this.font};`; },
} as const;

/** 以下视觉值规格里没有（其中的黑色半透明遮罩 / 阴影为中性占位，颜色源码未找到，等待 Arc 源码分析）（capture.md 只给出 greyscale / darkened 图层名、FocusRectAnimator、“带阴影的截图预览”，无数值）。
 * 源码未找到，自定值 */
export const CUSTOM_VISUALS = {
    /** 选区外暗化：灰度 + 亮度 + 叠色。源码未找到，自定值 */
    shadeFilter: "grayscale(1) brightness(0.6)",
    shadeColor: "rgba(0,0,0,.15)",
    /** 聚焦框样式。源码未找到，自定值 */
    focusBorder: "2px solid currentColor", // 颜色源码未找到：中性占位，等待 Arc 源码分析
    focusRadius: 4,
    focusOutline: "0 0 0 1px rgba(0,0,0,.3)",
    /** 聚焦框动画（FocusRectAnimator 的时长 / 曲线）。源码未找到，自定值 */
    focusTransition: ".25s cubic-bezier(.3,1.3,.5,1)",
    /** 提示气泡内边距。源码未找到，自定值（圆角、字体、颜色见 OVERLAY_BUBBLE） */
    bubblePadding: "8px 14px",
    /** 截图预览阴影、菜单阴影（capture.md §4 写明“阴影：源码未找到”）、背景遮罩。源码未找到，自定值 */
    previewShadow: "0 10px 40px rgba(0,0,0,.35)",
    menuShadow: "0 10px 40px rgba(0,0,0,.3)",
    backdrop: "rgba(0,0,0,.35)",
} as const;
/** 操作菜单的整段样式（纯函数，供单测）。dark = 解析后的明暗（Appearance：auto 跟系统 / light·dark 钉住）。
 * 不含 @media (prefers-color-scheme)：钉住时不能被系统改回去；系统切换由调用方重写 <style> 文本（不重建 DOM）。
 * 色值全部沿用原有：MENU 两套、预览底 #151C30 / #FFF、disabled 行 #ABABAB / #797881（Rea menus-spec.md:50 MenuDisabledText）。 */
export function menuCss(dark: boolean): string {
    const C = dark ? MENU.dark : MENU.light;
    const V = CUSTOM_VISUALS;
    return `
        .back{position:fixed;inset:0;background:${V.backdrop};}
        .wrap{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;gap:24px;pointer-events:none;font:13px system-ui,-apple-system;}
        .wrap>*{pointer-events:auto;}
        img{max-width:min(60vw,900px);max-height:80vh;border-radius:${MENU.radius}px;box-shadow:${V.previewShadow};background:${dark ? "#151C30" : "#FFF"};}
        .menu{width:${MENU.width}px;border-radius:${MENU.radius}px;background:${C.bg};color:${C.text};padding:6px 0;box-shadow:${V.menuShadow};}
        .row{display:flex;align-items:center;height:${MENU.rowHeight}px;padding:0 ${MENU.textPadding}px;cursor:default;margin:0 6px;border-radius:${MENU.radius - 2}px;}
        .row.toggle{color:${C.toggle};}
        .row[aria-disabled=true]{color:${dark ? "#797881" : "#ABABAB"};}
        .row.sel{background:${C.selected};color:${C.selectedText};}
        .div{height:1px;margin:4px 0;background:currentColor;opacity:.1;}`;
}

export function portraitLayout(w: number, h: number): { canvasW: number; canvasH: number; pad: number } {
    const pad = Math.round(Math.max(w, h) * PORTRAIT.padRatio);
    return { canvasW: w + pad * 2, canvasH: h + pad * 2, pad };
}

/* 提示条、右键菜单的颜色：源码未找到，等待 Arc 源码分析 → 中性系统色 Canvas / CanvasText 占位。
 * Zap 交互（content 上下文）：页面加 3px 边框进入 Zap 模式；悬停元素用 #D9D9D9 预览；
 * 单击 = Zap 这个元素；右键 = Arc 的三个菜单项；Esc 退出。 */
import { call } from "@api/RPC";
import { tr } from "@api/i18n";
import { ZAP_BORDER, ZAP_PREVIEW_BG } from "./model";
import { PAGE_Z_MAX } from "@utils/zLayers";
import { selectorForRelated, selectorForThis, type ElLike } from "./selector";

export const ZAP_MSG = "cat-boost:zap";
const ROOT = "cat-boost-zap-root";
/** Zap 框颜色：源码未找到（boosts.md §5.1）。用系统强调色 AccentColor 占位；宽度 3 有出处（ZAP_BORDER，boostsEditorZapModalityBorderWidth） */
export const ZAP_BORDER_COLOR_PENDING = "AccentColor";
const BORDER_COLOR = ZAP_BORDER_COLOR_PENDING;

const count = (s: string) => { try { return document.querySelectorAll(s).length; } catch { return 0; } };

let stop: (() => void) | null = null;

export function startZap(boostId: string) {
    stop?.();
    const host = document.createElement("div");
    host.id = ROOT;
    const shadow = host.attachShadow({ mode: "closed" });
    const fixed = `position:fixed;pointer-events:none;z-index:${PAGE_Z_MAX};`;
    const frame = Object.assign(document.createElement("div"), { style: `${fixed}inset:0;border:${ZAP_BORDER}px solid ${BORDER_COLOR};` });
    const preview = Object.assign(document.createElement("div"), { style: `${fixed}background:${ZAP_PREVIEW_BG};display:none;` });
    const hint = Object.assign(document.createElement("div"), { style: `${fixed}top:12px;left:50%;transform:translateX(-50%);background:Canvas;color:CanvasText;font:13px system-ui;padding:6px 10px;border-radius:8px;`, textContent: tr("boosts.zapHint") });
    shadow.append(frame, preview, hint);
    document.documentElement.append(host);
    let target: Element | null = null;
    let menu: HTMLElement | null = null;

    const inUi = (e: Event) => e.composedPath().includes(host);
    const show = (rects: DOMRect[]) => {
        const r = rects[0];
        if (!r) { preview.style.display = "none"; return; }
        Object.assign(preview.style, { display: "block", left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    };
    const zap = (sel: string | null) => { if (sel) void call("boosts.addZap", boostId, sel); };
    const copy = (sel: string | null) => { if (sel) void navigator.clipboard.writeText(sel).catch(e => console.warn("[Boosts] zap clipboard.writeText failed", e)); }; // 内容脚本引不到 @api/ErrorLog，按 Cat 决定例外用 console.warn
    const closeMenu = () => { menu?.remove(); menu = null; };

    const onMove = (e: MouseEvent) => {
        if (menu || inUi(e)) return;
        const el = document.elementFromPoint(e.clientX, e.clientY);
        if (!el || el === document.documentElement || el === document.body) { target = null; show([]); return; }
        target = el; show([el.getBoundingClientRect()]);
    };
    const onClick = (e: MouseEvent) => {
        if (inUi(e)) return;
        e.preventDefault(); e.stopPropagation();
        if (menu) { closeMenu(); return; }
        if (target) zap(selectorForThis(target as unknown as ElLike, count));
    };
    const onContext = (e: MouseEvent) => {
        if (inUi(e) || !target) return;
        e.preventDefault(); e.stopPropagation(); closeMenu();
        const el = target as unknown as ElLike;
        const related = selectorForRelated(el, count);
        menu = Object.assign(document.createElement("div"), { style: `position:fixed;left:${e.clientX}px;top:${e.clientY}px;z-index:${PAGE_Z_MAX};background:Canvas;color:CanvasText;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.2);font:13px system-ui;padding:4px;` });
        const item = (label: string, run: () => void, disabled = false) => {
            const b = Object.assign(document.createElement("button"), { textContent: tr(label), disabled, style: "display:block;width:100%;text-align:left;border:0;background:none;padding:6px 10px;border-radius:5px;font:inherit;cursor:default;" });
            b.onclick = ev => { ev.stopPropagation(); run(); closeMenu(); };
            menu!.append(b);
        };
        item("boosts.zapRelated", () => zap(related), !related);
        item("boosts.copyRelated", () => copy(related), !related);
        item("boosts.copyThis", () => copy(selectorForThis(el, count)));
        shadow.append(menu);
        if (related) show([...document.querySelectorAll(related)].slice(0, 100).map(x => x.getBoundingClientRect()));
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); stop?.(); } };

    const opts = { capture: true } as const;
    addEventListener("mousemove", onMove, opts);
    addEventListener("click", onClick, opts);
    addEventListener("contextmenu", onContext, opts);
    addEventListener("keydown", onKey, opts);
    stop = () => {
        removeEventListener("mousemove", onMove, opts);
        removeEventListener("click", onClick, opts);
        removeEventListener("contextmenu", onContext, opts);
        removeEventListener("keydown", onKey, opts);
        host.remove(); stop = null;
    };
}

export const stopZap = () => stop?.();

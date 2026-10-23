/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
/* Theme picker popover — markup and interaction ported from Zen Browser's
 * PanelUI-zen-gradient-generator (ZenGradientGenerator.mjs + zen-gradient-generator.css):
 * dotted colour plane with draggable dots (primary + harmony dots, max 3), scheme toggles,
 * paged preset swatches, wave slider and dotted-ring dial. Laid out like Arc's "Edit Theme Color…". */
import { h } from "@api/dom";
import "@components/ArcTooltip";
import { tr } from "@api/i18n";
import { icon } from "@api/icons";
import { openPanel } from "@components/Menu";
import { colorFromPosition, compliments, DEFAULT_THEME, dotForColor, type Dot, type GradientTheme, hexToRgb, MAX_DOTS, rgbCss, textureFromAngle } from "./gradient";

/** Arc's swatch row: cream, pink, purple, red, orange, yellow, green, blue, slate */
export const SWATCHES = [
    ["cream", "#f1ebe6"], ["pink", "#f19dbf"], ["purple", "#a375a5"], ["red", "#ef5468"], ["orange", "#ff8549"],
    ["yellow", "#f7d14e"], ["green", "#2fe08e"], ["blue", "#66b8db"], ["slate", "#66658a"],
] as const;
/** pages: 1 colour, 2 colours (singleAnalogous), 3 colours (analogous) — Zen's colour pages */
const PAGES = [{ n: 1, algo: "" }, { n: 2, algo: "singleAnalogous" }, { n: 3, algo: "analogous" }];
const DIAL_STEPS = 16; // Zen: 16 grain steps
const SINE = (() => { let d = "M 4 18"; for (let i = 0; i < 12; i++) { const x = 4 + i * 16; d += ` C ${x + 5.3} ${i % 2 ? 34 : 2}, ${x + 10.7} ${i % 2 ? 34 : 2}, ${x + 16} 18`; } return d; })();

const presetDots = (hex: string, page: number): { dots: Dot[]; algo: string } => {
    const p = PAGES[page];
    const first = dotForColor(hexToRgb(hex));
    if (p.n === 1) return { dots: [first], algo: "" };
    return compliments(Array.from({ length: p.n }, () => first), "update", p.algo);
};

// a drag that ends outside the panel must not close it (a document click closes menus)
let swallow = false, wired = false;
function armSwallow() {
    swallow = true; setTimeout(() => { swallow = false; }, 0);
    if (wired) return;
    wired = true;
    document.addEventListener("click", e => { if (swallow) { e.stopPropagation(); swallow = false; } }, true);
}

export interface PickerIO { get(): GradientTheme; set(t: GradientTheme, final?: boolean): void }

export function openThemePicker(at: { x: number; y: number }, io: PickerIO) {
    let t: GradientTheme = { ...DEFAULT_THEME, ...io.get() };
    let page = Math.max(0, Math.min(PAGES.length - 1, (t.dots.length || 1) - 1));
    const commit = (patch: Partial<GradientTheme>, final = true) => { t = { ...t, ...patch }; io.set(t, final); render(); };

    // —— colour plane ——
    const hint = h("p", { class: "arc-tp-hint" }, tr("themes.picker.hint"));
    const dotsLayer = h("div", { class: "arc-tp-dots" });
    const schemeBtns = (["auto", "light", "dark"] as const).map(s => h("button", {
        type: "button", class: "arc-tp-iconbtn", "data-test": `tp-scheme:${s}`, "data-tip": tr(s === "auto" ? "themes.system" : `themes.${s}`),
        onclick: (e: MouseEvent) => { e.stopPropagation(); commit({ scheme: s }); },
    }, icon(s === "auto" ? "sparkles" : s === "light" ? "sun" : "moon")));
    const addBtn = h("button", { type: "button", class: "arc-tp-iconbtn", "data-test": "tp-add", "data-tip": tr("themes.picker.add"), onclick: (e: MouseEvent) => {
        e.stopPropagation();
        if (!t.dots.length) return commit({ dots: [{ x: 0.3, y: 0.3 }] });
        if (t.dots.length >= MAX_DOTS) return;
        const r = compliments(t.dots, "add", t.algo); commit({ dots: r.dots, algo: r.algo });
    } }, icon("plus"));
    const removeBtn = h("button", { type: "button", class: "arc-tp-iconbtn", "data-test": "tp-remove", "data-tip": tr("themes.picker.remove"), onclick: (e: MouseEvent) => {
        e.stopPropagation();
        if (!t.dots.length) return;
        const rest = t.dots.slice(0, -1);
        const r = rest.length > 1 ? compliments(rest, "update") : { dots: rest, algo: "" };
        commit({ dots: r.dots, algo: r.algo });
    } }, icon("minus"));
    const plane = h("div", { class: "arc-tp-plane", "data-test": "tp-plane" },
        h("div", { class: "arc-tp-scheme" }, ...schemeBtns), hint, dotsLayer, h("div", { class: "arc-tp-actions" }, removeBtn, addBtn));
    const posOf = (e: PointerEvent): Dot => {
        const r = plane.getBoundingClientRect();
        let x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
        const dx = x - 0.5, dy = y - 0.5, d = Math.hypot(dx, dy);
        if (d > 0.5) { x = 0.5 + dx / d * 0.5; y = 0.5 + dy / d * 0.5; } // Zen: clamp to the inscribed circle
        return { x, y };
    };
    const movePrimary = (p: Dot, final: boolean) => {
        const prim = { ...t.dots[0], x: p.x, y: p.y };
        const r = t.dots.length > 1 ? compliments([prim, ...t.dots.slice(1)], "update", t.algo) : { dots: [prim], algo: t.algo ?? "" };
        commit({ dots: r.dots, algo: r.algo }, final);
    };
    plane.addEventListener("pointerdown", e => {
        if ((e.target as Element).closest("button") || e.button !== 0) return;
        e.preventDefault();
        const p = posOf(e);
        if (!t.dots.length) commit({ dots: [p] }, false); else movePrimary(p, false);
        try { plane.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
        plane.classList.add("dragging");
        const mv = (ev: PointerEvent) => movePrimary(posOf(ev), false);
        const up = () => {
            plane.removeEventListener("pointermove", mv); plane.removeEventListener("pointerup", up); plane.removeEventListener("pointercancel", up);
            plane.classList.remove("dragging"); armSwallow();
            io.set(t, true);
        };
        plane.addEventListener("pointermove", mv); plane.addEventListener("pointerup", up); plane.addEventListener("pointercancel", up);
    });

    // —— swatches ——
    const sw = h("div", { class: "arc-tp-swatches" });
    const prev = h("button", { type: "button", class: "arc-tp-iconbtn arc-tp-page", "data-test": "tp-prev", "data-tip": tr("themes.picker.prev"), onclick: () => { page = (page + PAGES.length - 1) % PAGES.length; render(); } }, icon("chevronLeft"));
    const next = h("button", { type: "button", class: "arc-tp-iconbtn arc-tp-page", "data-test": "tp-next", "data-tip": tr("themes.picker.next"), onclick: () => { page = (page + 1) % PAGES.length; render(); } }, icon("chevronRightRegular")); // 与 chevronLeft 同为 chevron.* Regular（PreviewToolbar @0x1025eab24/6c，ionicons-to-arc.md L40）；chevronRight 是折叠用 14pt Bold

    // —— intensity: wave slider (Zen opacity wave, as in Arc / Zen) ——
    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("viewBox", "0 0 200 36"); svg.setAttribute("preserveAspectRatio", "none");
    const clip = document.createElementNS(svgNS, "clipPath"); clip.id = `arc-tp-clip-${Math.random().toString(36).slice(2)}`;
    const clipRect = document.createElementNS(svgNS, "rect"); clipRect.setAttribute("y", "-4"); clipRect.setAttribute("height", "44"); clip.append(clipRect);
    const wave = document.createElementNS(svgNS, "path"); wave.setAttribute("d", SINE); wave.setAttribute("class", "arc-tp-wave-on"); wave.setAttribute("clip-path", `url(#${clip.id})`);
    const flat = document.createElementNS(svgNS, "path"); flat.setAttribute("d", SINE); flat.setAttribute("class", "arc-tp-wave-off");
    svg.append(clip, flat, wave);
    const range = h("input", { type: "range", min: "0", max: "1", step: "0.02", class: "arc-tp-range", "data-test": "tp-intensity", "aria-label": tr("themes.picker.intensity") }) as HTMLInputElement;
    range.addEventListener("input", () => commit({ opacity: +range.value }, false));
    range.addEventListener("change", () => io.set(t, true));
    const waveBox = h("div", { class: "arc-tp-wave", "data-tip": tr("themes.picker.intensity") }, svg as unknown as HTMLElement, range);

    // —— grain: dotted-ring dial (Zen texture dial, as in Arc / Zen) ——
    const ring = Array.from({ length: DIAL_STEPS }, (_, i) => {
        const a = (i / DIAL_STEPS) * 2 * Math.PI - Math.PI / 2;
        return h("span", { class: "arc-tp-ring-dot", style: `left:${50 + 44 * Math.cos(a)}%;top:${50 + 44 * Math.sin(a)}%` });
    });
    const handle = h("span", { class: "arc-tp-handle" });
    const dial = h("div", { class: "arc-tp-dial", "data-test": "tp-grain", tabindex: "0", role: "slider", "aria-label": tr("themes.noise"), "data-tip": tr("themes.noise") }, ...ring, handle);
    const dialAt = (e: PointerEvent, final: boolean) => {
        const r = dial.getBoundingClientRect();
        const v = textureFromAngle(e.clientX - r.left - r.width / 2, e.clientY - r.top - r.height / 2, DIAL_STEPS);
        if (v !== t.texture || final) commit({ texture: v }, final);
    };
    dial.addEventListener("pointerdown", e => {
        e.preventDefault(); try { dial.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ } dialAt(e, false);
        const mv = (ev: PointerEvent) => dialAt(ev, false);
        const up = (ev: PointerEvent) => { dial.removeEventListener("pointermove", mv); dial.removeEventListener("pointerup", up); dialAt(ev, true); armSwallow(); };
        dial.addEventListener("pointermove", mv); dial.addEventListener("pointerup", up);
    });
    dial.addEventListener("keydown", e => {
        const d = e.key === "ArrowRight" || e.key === "ArrowUp" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -1 : 0;
        if (!d) return;
        e.preventDefault(); e.stopPropagation();
        commit({ texture: Math.max(0, Math.min((DIAL_STEPS - 1) / DIAL_STEPS, Math.round(t.texture * DIAL_STEPS + d) / DIAL_STEPS)) });
    });

    function render() {
        hint.hidden = t.dots.length > 0;
        schemeBtns.forEach((b, i) => b.classList.toggle("on", t.scheme === (["auto", "light", "dark"] as const)[i]));
        addBtn.disabled = t.dots.length >= MAX_DOTS;
        removeBtn.disabled = !t.dots.length;
        dotsLayer.replaceChildren(...t.dots.map((d, i) => h("span", {
            class: `arc-tp-dot${i === 0 ? " primary" : ""}`, "data-test": `tp-dot:${i}`,
            style: `left:${d.x * 100}%;top:${d.y * 100}%;--dot:${rgbCss(colorFromPosition(d))}`,
        })));
        sw.replaceChildren(prev, ...SWATCHES.map(([name, hex]) => {
            const cols = presetDots(hex, page).dots.map(d => rgbCss(colorFromPosition(d)));
            return h("button", {
                type: "button", class: "arc-tp-swatch", "data-test": `tp-sw:${name}`, "data-tip": tr(`themes.sw.${name}`),
                style: `--sw:${page === 0 ? hex : `linear-gradient(135deg, ${cols.join(", ")})`}`,
                onclick: () => { const r = presetDots(hex, page); commit({ dots: r.dots, algo: r.algo }); },
            });
        }), next);
        clipRect.setAttribute("width", String(4 + t.opacity * 192));
        range.value = String(t.opacity);
        const step = Math.round(t.texture * DIAL_STEPS);
        ring.forEach((d, i) => d.classList.toggle("on", step > 0 && i <= step));
        const a = t.texture * 2 * Math.PI - Math.PI / 2;
        handle.style.cssText = `left:${50 + 44 * Math.cos(a)}%;top:${50 + 44 * Math.sin(a)}%;transform:translate(-50%,-50%) rotate(${t.texture * 360}deg)`;
        dial.setAttribute("aria-valuenow", String(Math.round(t.texture * 100)));
    }
    render();
    const panel = openPanel(at, [plane, sw, h("div", { class: "arc-tp-bottom" }, waveBox, dial)], "arc-theme-picker");
    if (panel) { // Arc: the picker is centred in the sidebar
        const w = panel.getBoundingClientRect().width;
        panel.style.left = `${Math.max(8, Math.round((innerWidth - w) / 2))}px`;
    }
    return panel;
}

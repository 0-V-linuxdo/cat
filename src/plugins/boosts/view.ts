/* panel：Boosts 列表（Library 风格）与编辑器。核心还没有资料库分类注册，先作为独立整页浮层 "boosts"。 */
import { safe } from "@api/ErrorLog";
import "@components/ArcTooltip";
import { copyText } from "@api/Clipboard";
import { h } from "@api/dom";
import { tr } from "@api/i18n";
import { toast } from "@api/PanelShell";
import type { Cleanup } from "@utils/types";
import { ANALOGOUS_OFFSET, EDITOR_PAGE, EDITOR_PARAM, editorUrl, nextTextTransform, SHELF_HEIGHT, cannotShareReason, COMPLEMENTARY_OFFSET, decodeShare, defaultWheel, encodeShare, hostOf, isComplementary, newBoost, shuffleWheel, type Boost, type ColorWheelScheme } from "./model";
import { boostStore, updateBoost } from "./store";
import { ZAP_MSG } from "./zap";
import { boostFavBox, domFavDeps } from "./favicon";

export interface ViewOpts {
    jsEnabled: () => boolean; jsAvailable: () => Promise<boolean>;
    /** 在独立编辑器窗口里打开（boosts.md §2 BoostsEditorWindowController）；没有时在当前浮层内编辑 */
    openEditor?: (id: string) => void;
    /** 独立窗口模式：目标网页标签（编辑器窗口本身不是网页，Zap 要发给这个标签） */
    targetTabId?: number;
}

/** 打开独立编辑器窗口 static/boost-editor.html（chrome.windows.create，popup 类型）。窗口宽高源码未找到，自定 420×720 */
export async function openEditorWindow(id: string, tabId?: number): Promise<boolean> {
    if (tabId == null) tabId = (await activeTab())?.id;
    await chrome.windows.create({ url: chrome.runtime.getURL(editorUrl(id, tabId)), type: "popup", width: 420, height: 720 });
    return true;
}

/* 无 favicon 时与 Archive 同样的占位（archive-page.md §9），见 ./favicon.ts */
const favicon = (host: string) => boostFavBox(host, domFavDeps(h as never)).box;

async function activeTab() {
    const [t] = await safe(chrome.tabs.query({ active: true, lastFocusedWindow: true }), "boosts: tabs.query active", [] as chrome.tabs.Tab[]);
    return t;
}

/** 为当前标签所在站点新建 Boost，返回 id */
export async function createForActiveTab(url?: string): Promise<string | null> {
    const host = hostOf(url ?? (await activeTab())?.url);
    if (!host) { toast(tr("boosts.noSite")); return null; }
    const b = newBoost(host);
    await boostStore.update(d => { d.boosts.push(b); });
    return b.id;
}

export function renderBoosts(root: HTMLElement, arg: unknown, opts: ViewOpts): Cleanup {
    let editing: string | null = (arg as { edit?: string } | undefined)?.edit ?? null;
    const draw = () => {
        root.replaceChildren();
        const b = editing ? boostStore.get().boosts.find(x => x.id === editing) : undefined;
        if (b) renderEditor(root, b, opts, () => { editing = null; draw(); });
        else renderList(root, id => { if (opts.openEditor) opts.openEditor(id); else { editing = id; draw(); } });
    };
    draw();
    // 编辑器内部保存不重绘（避免输入框失焦）；只在列表模式随数据重绘
    return boostStore.subscribe(() => { if (!editing) draw(); });
}

function renderList(root: HTMLElement, edit: (id: string) => void) {
    const boosts = boostStore.get().boosts;
    const list = h("div", { class: "arc-lib-list", "data-test": "boosts-list" });
    if (!boosts.length) list.append(h("div", { class: "arc-hint", "data-test": "boosts-empty" }, h("div", null, tr("boosts.empty")), h("div", null, tr("boosts.emptySub"))));
    for (const b of [...boosts].sort((x, y) => y.updated - x.updated)) {
        list.append(h("div", { class: "arc-list-row", "data-test": "boost-row", onclick: () => edit(b.id) },
            favicon(b.host),
            h("span", { class: "arc-lib-text" }, h("span", { class: "arc-lib-title" }, b.title), h("span", { class: "arc-lib-url" }, `${b.host} · ${tr(b.isActive ? "boosts.active" : "boosts.inactive")}`)),
            h("button", { class: "arc-btn", onclick: (e: Event) => { e.stopPropagation(); void updateBoost(b.id, x => { x.isActive = !x.isActive; }); } }, tr(b.isActive ? "boosts.disable" : "boosts.enable"))));
    }
    root.append(
        h("div", { class: "arc-lib-top" }, h("span", { class: "arc-lib-heading" }, tr("boosts.title")),
            h("button", { class: "arc-btn", onclick: () => renderInstall(root, () => { root.replaceChildren(); renderList(root, edit); }) }, tr("boosts.install")),
            h("button", { class: "arc-btn", "data-test": "boosts-new", onclick: async () => { const id = await createForActiveTab(); if (id) edit(id); } }, tr("boosts.new"))),
        list);
}

/** 安装：粘贴分享码 → Arc 的安装确认文案 */
function renderInstall(root: HTMLElement, back: () => void) {
    const input = h("textarea", { class: "arc-input", rows: "3", placeholder: tr("boosts.installPaste") }) as HTMLTextAreaElement;
    const box = h("div", { class: "arc-hint" });
    input.oninput = () => {
        box.replaceChildren();
        const b = decodeShare(input.value);
        if (!input.value.trim()) return;
        if (!b) { box.append(tr("boosts.installBad")); return; }
        box.append(h("div", { class: "arc-lib-heading" }, tr("boosts.installTitle")), h("div", null, tr("boosts.installHeadsUp", b.host)), h("div", null, tr("boosts.installSafety")),
            h("button", { class: "arc-btn", onclick: async () => { await boostStore.update(d => { d.boosts.push(b); }); back(); } }, tr("boosts.add")));
    };
    root.replaceChildren(h("div", { class: "arc-lib-top" }, h("span", { class: "arc-lib-heading" }, tr("boosts.installTitle"))), input, box,
        h("button", { class: "arc-btn", onclick: back }, tr("boosts.cancel")));
}

function section(title: string, ...body: (Node | string)[]) {
    return h("div", { class: "arc-lib-group" }, h("div", { class: "arc-menu-label" }, title), ...body);
}
function check(label: string, value: boolean, set: (v: boolean) => void) {
    const cb = h("input", { type: "checkbox" }) as HTMLInputElement;
    cb.checked = value; cb.onchange = () => set(cb.checked);
    return h("label", { class: "arc-row" }, cb, label);
}
function range(label: string, min: number, max: number, value: number, set: (v: number) => void) {
    const r = h("input", { type: "range", min: String(min), max: String(max), value: String(value) }) as HTMLInputElement;
    r.oninput = () => set(Number(r.value));
    return h("label", { class: "arc-row" }, label, r);
}

function renderEditor(root: HTMLElement, b: Boost, opts: ViewOpts, back: () => void) {
    const save = (fn: (x: Boost) => void) => { fn(b); void updateBoost(b.id, fn); };
    const redraw = () => { root.replaceChildren(); renderEditor(root, b, opts, back); };

    const title = h("input", { class: "arc-input", value: b.title, "aria-label": tr("boosts.rename") }) as HTMLInputElement;
    title.onchange = () => save(x => { x.title = title.value.trim() || x.host; });

    // 配色
    const wheel: ColorWheelScheme | null = b.colorScheme.type === "colorWheelDriven" ? b.colorScheme : null;
    const setWheel = (w: Partial<ColorWheelScheme>) => save(x => { x.colorScheme = { ...defaultWheel(), ...(x.colorScheme.type === "colorWheelDriven" ? x.colorScheme : {}), ...w, type: "colorWheelDriven" }; });
    const colors = section(tr("boosts.colors"),
        check(tr("boosts.useColors"), !!wheel, on => { save(x => { x.colorScheme = on ? { type: "colorWheelDriven", ...defaultWheel() } : { type: "themeDriven" }; }); redraw(); }));
    if (wheel) colors.append(
        range(tr("boosts.hue"), 0, 359, wheel.primaryHueDegrees, v => setWheel({ primaryHueDegrees: v })),
        range(tr("boosts.saturation"), 0, 100, Math.round(wheel.primarySaturation * 100), v => setWheel({ primarySaturation: v / 100 })),
        h("div", { class: "arc-row" },
            h("button", { class: `arc-btn${isComplementary(wheel) ? " selected" : ""}`, onclick: () => { setWheel({ secondaryHueOffset: COMPLEMENTARY_OFFSET }); redraw(); } }, tr("boosts.complementary")),
            h("button", { class: `arc-btn${!isComplementary(wheel) ? " selected" : ""}`, onclick: () => { setWheel({ secondaryHueOffset: ANALOGOUS_OFFSET }); redraw(); } }, tr("boosts.analogous"))),
        check(tr("boosts.invert"), wheel.invertLightness, v => setWheel({ invertLightness: v })),
        check(tr("boosts.preserveSat"), !!wheel.advancedSettings?.preservedSaturation, v => setWheel({ advancedSettings: { ...wheel.advancedSettings, preservedSaturation: v } })),
        h("div", { class: "arc-row" },
            h("button", { class: "arc-btn", onclick: () => { setWheel(shuffleWheel(wheel)); redraw(); } }, tr("boosts.shuffle")),
            h("button", { class: "arc-btn", onclick: () => { save(x => { x.colorScheme = { type: "themeDriven" }; }); redraw(); } }, tr("boosts.resetColors"))));

    // 字体：⛔ fontOptions 源码未找到 → 默认 + 自定义字体名
    const family = h("input", { class: "arc-input", placeholder: tr("boosts.fontFamily"), value: b.font.type === "custom" ? b.font.family : "" }) as HTMLInputElement;
    family.onchange = () => save(x => { x.font = family.value.trim() ? { type: "custom", family: family.value.trim() } : { type: "system" }; });
    const font = section(tr("boosts.font"), family);

    // Zap
    const zapList = h("div", { class: "arc-list" });
    const drawZaps = () => {
        zapList.replaceChildren(...(b.zaps.length ? b.zaps.map((z, i) => h("div", { class: "arc-list-row" }, h("code", { class: "arc-lib-url" }, z),
            h("button", { class: "arc-icon-btn", "aria-label": tr("common.delete"), onclick: () => { save(x => { x.zaps.splice(i, 1); }); drawZaps(); } }, "×"))) : [h("div", { class: "arc-hint" }, tr("boosts.zapNone"))]));
    };
    drawZaps();
    const unsub = boostStore.subscribe(v => { const nb = v.boosts.find(x => x.id === b.id); if (nb && nb.zaps.join("\n") !== b.zaps.join("\n")) { b.zaps = [...nb.zaps]; drawZaps(); } });
    const zap = section(tr("boosts.zap"), h("button", { class: "arc-btn", "data-test": "boost-zap", onclick: async () => {
        const t = opts.targetTabId != null ? await safe(chrome.tabs.get(opts.targetTabId), "boosts: tabs.get target") : await activeTab();
        if (t?.id == null || !hostOf(t.url)) { toast(tr("boosts.zapFailed")); return; }
        try { await chrome.tabs.sendMessage(t.id, { type: ZAP_MSG, boostId: b.id }); } catch { toast(tr("boosts.zapFailed")); }
    } }, tr("boosts.zapStart")), zapList);

    // 大小写（boosts.md §2 BoostsEditorTextTransformButton “Change text case”）
    const caseLabel = () => `${tr("boosts.textCase")}: ${tr(b.textTransform ? `boosts.${b.textTransform}` : "boosts.textCaseNone")}`;
    const caseBtn = h("button", { class: "arc-btn", "data-test": "boost-text-case", "data-tip": tr("boosts.textCase") }, caseLabel()) as HTMLButtonElement;
    caseBtn.onclick = () => { save(x => { x.textTransform = nextTextTransform(x.textTransform); }); caseBtn.textContent = caseLabel(); };

    // CSS
    const css = h("textarea", { class: "arc-input", rows: "6", spellcheck: "false" }) as HTMLTextAreaElement;
    css.value = b.css; css.onchange = () => save(x => { x.css = css.value; });

    // JS（单独子开关；没有 userScripts 时只读提示）
    const jsBox = h("div");
    if (opts.jsEnabled() || b.js) {
        const js = h("textarea", { class: "arc-input", rows: "6", spellcheck: "false", placeholder: tr("boosts.jsPlaceholder") }) as HTMLTextAreaElement;
        js.value = b.js; js.onchange = () => save(x => { x.js = js.value; });
        jsBox.append(section(tr("boosts.js"), h("div", { class: "arc-hint" }, tr("boosts.jsWarning")), js));
        void opts.jsAvailable().then(ok => { if (!ok || !opts.jsEnabled()) jsBox.append(h("div", { class: "arc-hint" }, tr("boosts.jsUnavailable"))); });
    }

    // 分享
    const shareBtn = h("button", { class: "arc-btn", "data-test": "boost-share", onclick: () => {
        const why = cannotShareReason(b);
        if (why) { toast(tr(why === "hasJS" ? "boosts.shareHasJS" : "boosts.shareEmpty")); return; }
        void copyText(encodeShare(b)).then(ok => ok && toast(tr("boosts.shareCopied")));
    } }, tr("boosts.share"));

    const windowed = opts.targetTabId !== undefined;
    const del = h("button", { class: "arc-btn", "data-test": "boost-delete", onclick: async () => {
        if (!confirm(tr("boosts.deleteConfirm"))) return;
        unsub(); await boostStore.update(d => { d.boosts = d.boosts.filter(x => x.id !== b.id); }); back();
    } }, tr("boosts.delete"));
    const body = h("div", { style: windowed ? `overflow:auto;flex:1;padding:8px;` : "" },
        h("div", { class: "arc-row" }, favicon(b.host), title),
        check(tr("boosts.active"), b.isActive, v => save(x => { x.isActive = v; })),
        colors, font, section(tr("boosts.textCase"), caseBtn), zap, section(tr("boosts.css"), css), jsBox,
        section(tr("boosts.share"), h("div", { class: "arc-hint" }, tr("boosts.shareNotice")), shareBtn));
    if (windowed) {
        // 独立窗口：内容区 + 底部 Shelf（高 58）放常用工具
        const shelf = h("div", { class: "arc-row", "data-test": "boost-shelf", style: `height:${SHELF_HEIGHT}px;flex:none;box-sizing:border-box;padding:0 10px;gap:6px;border-top:1px solid var(--arc-border, currentColor);align-items:center;` },
            h("button", { class: "arc-btn", onclick: () => (zap.querySelector("[data-test=boost-zap]") as HTMLButtonElement | null)?.click() }, tr("boosts.zapStart")),
            h("button", { class: "arc-btn", onclick: () => caseBtn.click() }, tr("boosts.textCase")),
            h("button", { class: "arc-btn", onclick: () => shareBtn.click() }, tr("boosts.share")), del);
        root.append(h("div", { style: "display:flex;flex-direction:column;height:100%;" }, body, shelf));
    } else {
        root.append(h("div", { class: "arc-lib-top" }, h("button", { class: "arc-btn", onclick: () => { unsub(); back(); } }, `‹ ${tr("boosts.back")}`)), body, del);
    }
}

/** 独立编辑器页面（page 上下文，boost-editor.html?boostEditor=<id>&tab=<id>）：整页只有编辑器 */
export function mountEditorPage(pathname: string, search: string, opts: ViewOpts): Cleanup | undefined {
    if (!pathname.endsWith(`/${EDITOR_PAGE}`)) return undefined;
    const q = new URLSearchParams(search);
    const id = q.get(EDITOR_PARAM);
    if (!id) return undefined;
    const tab = Number(q.get("tab"));
    const host = h("div", { "data-test": "boost-editor-window", style: "position:fixed;inset:0;background:var(--arc-bg, Canvas);display:flex;flex-direction:column;" });
    document.title = tr("boosts.editorTitle");
    document.body.append(host);
    const b = boostStore.get().boosts.find(x => x.id === id);
    if (b) renderEditor(host, b, { ...opts, openEditor: undefined, targetTabId: Number.isFinite(tab) && tab > 0 ? tab : NaN }, () => window.close());
    else host.append(h("div", { class: "arc-hint" }, tr("boosts.empty")));
    return () => host.remove();
}

/*
 * 侧边栏内对话框（替代浏览器原生 confirm / prompt）：样式同 macOS / Arc 提示框——
 * 居中卡片宽 260、圆角 12、内边距 16；标题 13px 粗体居中；两个按钮并排（高 28、圆角 6），默认按钮 = 强调色。
 * 键盘：Enter 确认、Esc 取消、Tab 在控件间循环；点外面 = 取消，且这次点击不会落到下面的元素（遮罩接住）。
 */
import { tr } from "@api/i18n";
import { restoreFocus } from "@api/FocusPolicy";
import { h } from "@api/dom";

type Auto = { confirm?: (msg: string) => boolean; prompt?: (msg: string, def: string) => string | null };
const auto = () => (globalThis as { __arcDialogAuto?: Auto }).__arcDialogAuto;

/* 源码未找到（unconfirmed-values-verified.md §7）：对话框各值为 macOS 提示框惯例的现值。 */
const CSS = `
.arc-dlg-mask { position: fixed; inset: 0; z-index: 60; background: rgb(0 0 0 / .18); display: grid; place-items: center; animation: arc-dlg-fade .12s ease-out; }
.arc-dlg { width: min(260px, calc(100vw - 24px)); box-sizing: border-box; padding: 16px; border-radius: 12px; background: var(--arc-menu, var(--opt-bg, #fff)); color: var(--arc-fg, var(--opt-fg, #111));
  box-shadow: 0 0 0 .5px rgb(0 0 0 / .18), 0 12px 32px rgb(0 0 0 / .28); display: grid; gap: 12px; text-align: center; font-size: 13px; animation: arc-dlg-in .14s cubic-bezier(.2,.9,.3,1);
  -webkit-backdrop-filter: blur(24px) saturate(1.6); backdrop-filter: blur(24px) saturate(1.6); }
.arc-dlg-msg { font-weight: 600; line-height: 1.35; white-space: pre-wrap; overflow-wrap: anywhere; }
.arc-dlg-detail { font-weight: 400; line-height: 1.35; white-space: pre-wrap; overflow-wrap: anywhere; }
.arc-dlg-input { all: unset; box-sizing: border-box; width: 100%; height: 28px; padding: 0 8px; border-radius: 6px; text-align: left; font-size: 13px;
  background: color-mix(in srgb, currentColor 8%, transparent); box-shadow: inset 0 0 0 1px color-mix(in srgb, currentColor 15%, transparent); }
.arc-dlg-input:focus { box-shadow: inset 0 0 0 2px var(--arc-accent, #3b6cf6); }
.arc-dlg-btns { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.arc-dlg-btn { all: unset; height: 28px; border-radius: 6px; font-size: 13px; font-weight: 500; text-align: center; cursor: default; background: color-mix(in srgb, currentColor 10%, transparent); }
.arc-dlg-btn:hover { background: color-mix(in srgb, currentColor 15%, transparent); }
.arc-dlg-btn:disabled { opacity: .4; }
.arc-dlg-btn.ok { background: var(--arc-accent, #3b6cf6); color: #fff; }
.arc-dlg-btn.ok.danger { background: #e5484d; }
.arc-dlg-btn:focus-visible { outline: 2px solid color-mix(in srgb, var(--arc-accent, #3b6cf6) 60%, transparent); outline-offset: 1px; }
@keyframes arc-dlg-in { from { opacity: 0; transform: scale(.96); } }
@keyframes arc-dlg-fade { from { opacity: 0; } }
`;
let styled = false;

/** 输入框选项：placeholder = 输入框占位文字；ok = 确认按钮文字；requireText = 输入为空（去掉首尾空白后）时确认按钮置灰、Enter 不提交 */
export interface PromptOpts { placeholder?: string; ok?: string; requireText?: boolean }

/** requireText 时输入为空（去掉首尾空白后）不能提交 */
export const promptBlocked = (po: PromptOpts, value: string) => !!po.requireText && value.trim() === "";

function open(msg: string, input: string | null, okLabel?: string, danger = false, detail?: string, po: PromptOpts = {}): Promise<string | null> {
    if (!styled) { styled = true; document.head.append(h("style", null, CSS)); }
    const prev = document.activeElement as HTMLElement | null;
    return new Promise(resolve => {
        const field = input != null ? h("input", { class: "arc-dlg-input", value: input, "data-test": "dlg-input", ...(po.placeholder ? { placeholder: po.placeholder, "aria-label": po.placeholder } : {}) }) as HTMLInputElement : null;
        const ok = h("button", { class: `arc-dlg-btn ok${danger ? " danger" : ""}`, "data-test": "dlg-ok" }, okLabel ?? tr("common.ok"));
        const cancel = h("button", { class: "arc-dlg-btn", "data-test": "dlg-cancel" }, tr("common.cancel"));
        const card = h("div", { class: "arc-dlg", role: "alertdialog", "aria-modal": "true", "aria-label": msg }, h("div", { class: "arc-dlg-msg" }, msg), detail ? h("div", { class: "arc-dlg-detail", "data-test": "dlg-detail" }, detail) : null, field, h("div", { class: "arc-dlg-btns" }, cancel, ok));
        const mask = h("div", { class: "arc-dlg-mask", "data-test": "dlg" }, card);
        const done = (v: string | null) => { mask.remove(); document.removeEventListener("keydown", key, true); restoreFocus(prev); resolve(v); }; // 只在键盘导航时归还焦点
        const blocked = () => !!field && promptBlocked(po, field.value);
        const sync = () => { ok.disabled = blocked(); };
        const yes = () => { if (!blocked()) done(field ? field.value : "1"); };
        if (po.requireText) { field?.addEventListener("input", sync); sync(); }
        const key = (e: KeyboardEvent) => {
            if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); done(null); }
            else if (e.key === "Enter" && !e.isComposing && document.activeElement !== cancel) { e.preventDefault(); e.stopPropagation(); yes(); }
            else if (e.key === "Tab") { const f = [field, cancel, ok].filter(x => x && !(x as HTMLButtonElement).disabled) as HTMLElement[]; const i = f.indexOf(document.activeElement as HTMLElement); e.preventDefault(); f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus(); }
            e.stopPropagation();
        };
        ok.addEventListener("click", e => { e.stopPropagation(); yes(); });
        cancel.addEventListener("click", e => { e.stopPropagation(); done(null); });
        // 遮罩接住点击：点卡片外 = 取消，事件不再往下传
        for (const t of ["pointerdown", "mousedown", "click", "contextmenu"]) mask.addEventListener(t, e => { e.stopPropagation(); if (e.target === mask) { e.preventDefault(); if (t === "pointerdown") done(null); } });
        document.addEventListener("keydown", key, true);
        document.body.append(mask);
        (field ?? ok).focus({ preventScroll: true }); field?.select();
    });
}

/** 确认框；返回是否确认 */
/** detail：标题下的说明文字（NSAlert informativeText，如删除文件夹，sidebar-features.md §24）；字号 / 间距 ⛔ 同对话框其余值为现值 */
export async function arcConfirm(msg: string, opts: { ok?: string; danger?: boolean; detail?: string } = {}): Promise<boolean> {
    const a = auto(); if (a?.confirm) return a.confirm(msg);
    return (await open(msg, null, opts.ok, opts.danger, opts.detail)) != null;
}
/** 输入框；取消返回 null */
export async function arcPrompt(msg: string, def = "", opts: PromptOpts = {}): Promise<string | null> {
    const a = auto(); if (a?.prompt) return a.prompt(msg, def);
    return open(msg, def, opts.ok, false, undefined, opts);
}

/** “Rename Tab…” 对话框（Arc Dialogs.TextInputDialog，urlbar-menus-followup.md L573–633；标签 / 固定 / 收藏共用同一组文案）：
 *  标题 rename.title、placeholder rename.placeholder、按钮 rename.ok / common.cancel、单行、输入为空时 Rename 置灰。
 *  ⛔ 对话框尺寸 / 呈现形式、初始文本取 customTitle 还是显示标题、空文本置灰（由 isValidWhenEmpty = false 推断）均未在 Arc 中确认。取消返回 null。 */
export const arcRename = (current: string) => arcPrompt(tr("rename.title"), current, { placeholder: tr("rename.placeholder"), ok: tr("rename.ok"), requireText: true });

/* 站点控制中心分区（轻量，静态引入）：只画按钮；点击后才动态 import 重模块（ui → transfer → collect/apply/container）。 */
import { h } from "@api/dom";
import { tr } from "@api/i18n";
import { Z } from "@utils/zLayers";

import { activeChannels } from "./channels";

type Act = "copy" | "paste" | "exportFile" | "importFile" | "clear";
const run = (act: Act, tab: chrome.tabs.Tab) => void import("./ui").then(m => m.runAction(act, tab));

/** 在点击的同一调用栈里弹出文件选择（文件选择器需要用户激活），选完把 File 交给 ui */
export function pickFile(accept = ".session,.arcsession,application/octet-stream,text/plain"): Promise<File | null> {
    return new Promise(resolve => {
        const input = h("input", { type: "file", accept, hidden: true }) as HTMLInputElement;
        input.addEventListener("change", () => resolve(input.files?.[0] ?? null));
        input.addEventListener("cancel", () => resolve(null));
        input.click();
    });
}

export function renderSection(box: HTMLElement, tab: chrome.tabs.Tab, close: () => void) {
    const web = /^https?:\/\//i.test(tab.url ?? "");
    const btn = (act: Act, key: string, test: string) => {
        const b = h("button", { class: "arc-sc-action st-btn", "data-test": test, disabled: !web, "data-act": act }, tr(key)) as HTMLButtonElement;
        b.addEventListener("click", () => {
            if (act === "importFile") { const p = pickFile(); close(); void p.then(f => { if (f) void import("./ui").then(m => m.importFileAction(f)); }); return; }
            close(); run(act, tab);
        });
        return b;
    };
    box.append(
        h("div", { class: "arc-sc-label" }, tr("st.title")),
        h("div", { class: "st-row" }, btn("copy", "st.copy", "st-copy"), btn("paste", "st.paste", "st-paste")),
        h("div", { class: "st-row" }, btn("exportFile", "st.exportFile", "st-export"), btn("importFile", "st.importFile", "st-import")),
        h("div", { class: "st-row" }, btn("clear", "st.clear", "st-clear")),
        // 扩展点：已注册且子开关打开的通道（当前为空，见 channels.ts）
        ...activeChannels().map(c => h("div", { class: "st-row" }, h("button", { class: "arc-sc-action st-btn", "data-test": c.test, disabled: !web, onclick: () => { close(); void c.run(tab); } }, tr(c.label)))),
        h("div", { class: "st-risk", "data-test": "st-risk" }, tr("st.risk")),
    );
}

export const STYLE = `
.st-row { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 6px; margin: 4px 0; }
.st-btn { padding: 0 8px; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.st-risk { font-size: 11px; line-height: 1.35; opacity: .65; margin: 4px 2px 2px; overflow-wrap: anywhere; }
.st-mask { position: fixed; inset: 0; z-index: ${Z.confirm}; background: rgb(0 0 0 / .18); display: grid; place-items: center; }
.st-card { width: min(280px, calc(100vw - 24px)); box-sizing: border-box; padding: 16px; border-radius: 12px; background: var(--arc-pop-solid, #fcfcfe); color: var(--arc-fg, #111); box-shadow: 0 0 0 .5px rgb(0 0 0 / .18), 0 12px 32px rgb(0 0 0 / .28); display: grid; gap: 10px; font-size: 13px; }
.st-title { font-weight: 600; text-align: center; }
.st-hint { font-size: 12px; opacity: .7; text-align: center; overflow-wrap: anywhere; }
.st-card textarea, .st-card input[type=password] { all: unset; box-sizing: border-box; width: 100%; min-height: 28px; padding: 6px 8px; border-radius: 6px; font-size: 12px; background: color-mix(in srgb, currentColor 8%, transparent); box-shadow: inset 0 0 0 1px color-mix(in srgb, currentColor 15%, transparent); }
.st-card textarea { height: 64px; word-break: break-all; white-space: pre-wrap; }
.st-card label { display: flex; gap: 8px; align-items: center; }
.st-btns { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 8px; }
.st-btns button { all: unset; height: 28px; border-radius: 6px; text-align: center; background: color-mix(in srgb, currentColor 10%, transparent); }
.st-btns button.ok { background: var(--arc-accent, #3b6cf6); color: #fff; }
.st-btns button.danger { background: #e5484d; color: #fff; }
.st-undo { all: unset; margin-left: 8px; font-weight: 600; text-decoration: underline; cursor: pointer; }
`;

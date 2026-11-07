/* 界面与动作（动态引入：只有点了按钮 / 命令才会执行到这里）。
 * 不用 safe()（会把错误文本写进 arc-errlog）、不写 console、不把令牌 / cookie 放进 storage；所有失败只显示枚举码对应的文案。 */
import { h } from "@api/dom";
import { tr } from "@api/i18n";
import { toast } from "@api/PanelShell";
import { arcConfirm } from "@components/Dialog";
import { activeTab } from "@plugins/_core/tabState";

import type { Snapshot } from "./apply";
import { getSnapshot, setSnapshot } from "./state";
import { decode, errCode, MAX_PLAIN_BYTES, needsPassphrase, SessionError, type Parsed } from "./container";
import { pickFile } from "./section";
import { settings } from "./settings";
import { clearSite, copySession, exportFileSession, importSession, undoImport } from "./transfer";
import { downloadOwn, registerOwnIntent, releaseWhenSettled } from "@utils/ownDownload";

const failToast = (e: unknown) => { toast(tr(`st.err.${errCode(e)}`)); };

/* ---------- 极简模态框（对话框外观沿用 Arc 卡片；Esc / 点遮罩 = 取消） ---------- */
interface Built<T> { nodes: Array<Node | null>; focus?: HTMLElement; ready?(done: (v: T | null) => void): void }
export function ask<T>(title: string, build: (done: (v: T | null) => void) => Built<T>): Promise<T | null> {
    return new Promise(resolve => {
        const prev = document.activeElement as HTMLElement | null;
        const mask = h("div", { class: "st-mask", "data-test": "st-modal" });
        const finish = (v: T | null) => { mask.remove(); document.removeEventListener("keydown", key, true); prev?.focus?.(); resolve(v); };
        const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(null); } };
        const b = build(finish);
        mask.append(h("div", { class: "st-card", role: "dialog", "aria-modal": "true", "aria-label": title }, h("div", { class: "st-title" }, title), ...b.nodes));
        mask.addEventListener("pointerdown", e => { e.stopPropagation(); if (e.target === mask) finish(null); });
        document.addEventListener("keydown", key, true);
        document.body.append(mask);
        b.focus?.focus({ preventScroll: true });
    });
}
export const buttons = (...bs: Array<{ label: string; cls?: string; test: string; on(): void }>) =>
    h("div", { class: "st-btns" }, ...bs.map(b => h("button", { type: "button", class: b.cls ?? "", "data-test": b.test, onclick: (e: Event) => { e.stopPropagation(); b.on(); } }, b.label)));

/** 口令框（密码输入框；空口令不提交） */
export function askPassphrase(mode: "export" | "import"): Promise<string | null> {
    return ask<string>(tr("st.passTitle"), done => {
        const input = h("input", { type: "password", placeholder: tr("st.passPlaceholder"), "aria-label": tr("st.passPlaceholder"), "data-test": "st-pass-input", autocomplete: "off" }) as HTMLInputElement;
        const ok = () => { if (input.value) done(input.value); };
        input.addEventListener("keydown", e => { if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); ok(); } });
        return { nodes: [h("div", { class: "st-hint" }, tr(mode === "export" ? "st.passPromptExport" : "st.passPromptImport")), input,
            buttons({ label: tr("st.cancel"), test: "st-pass-cancel", on: () => done(null) }, { label: tr("st.import"), cls: "ok", test: "st-pass-ok", on: ok })], focus: input };
    });
}

export type PasteResult = { text: string } | { file: File };
/** 粘贴框（v3：不读剪贴板 API、不申请 clipboardRead）：用户 ⌘/Ctrl+V，paste 事件一到就解码；也可手输后点「导入」或选文件 */
export function openPasteBox(): Promise<PasteResult | null> {
    return ask<PasteResult>(tr("st.pasteTitle"), done => {
        const ta = h("textarea", { placeholder: tr("st.pastePlaceholder"), "aria-label": tr("st.pasteTitle"), "data-test": "st-paste-input", spellcheck: false }) as HTMLTextAreaElement;
        ta.addEventListener("paste", e => {
            const text = (e as ClipboardEvent).clipboardData?.getData("text") ?? "";
            if (!text.trim()) return;
            e.preventDefault(); ta.value = ""; // 事件文本被消费，输入框不留令牌
            done({ text });
        });
        const submit = () => { const t = ta.value; ta.value = ""; if (t.trim()) done({ text: t }); };
        return { nodes: [h("div", { class: "st-hint" }, tr("st.pasteHint")), ta,
            buttons(
                { label: tr("st.pickFile"), test: "st-paste-file", on: () => void pickFile().then(f => { if (f) done({ file: f }); }) },
                { label: tr("st.cancel"), test: "st-paste-cancel", on: () => done(null) },
                { label: tr("st.import"), cls: "ok", test: "st-paste-ok", on: submit })], focus: ta };
    });
}

/* ---------- 剪贴板 / 下载 ---------- */
/** 手势内写剪贴板（不需要 clipboardWrite）；失败退回 execCommand("copy") */
export async function writeClipboard(text: string): Promise<boolean> {
    try { await navigator.clipboard.writeText(text); return true; } catch { /* 退回 */ }
    try {
        const ta = h("textarea", { style: "position:fixed;opacity:0;left:-9999px" }) as HTMLTextAreaElement;
        ta.value = text; document.body.append(ta); ta.select();
        const ok = document.execCommand("copy"); ta.remove(); return ok;
    } catch { return false; }
}

/** 下载加密字节（A9：可询问保存位置 / 完成后从列表隐藏）。只接收 container 打包后的输出；监听 / 定时器只在这次下载存活期间存在。
 * 默认路径：在扩展页造 <a download=文件名 href=blob:…> 并点击。原因（H10c，Chrome 156 实测）：DownloadRename 开启时，扩展用
 * chrome.downloads.download({ filename }) 发起的下载会丢掉 filename（blob: / data: 都一样，保存名变 uuid / "download"），而页面里
 * <a download> 触发的下载文件名正常；此时 onDeterminingFilename 看到的 item.filename 就是 download 属性的值。
 * rel61：两条路径都先登记意图（@utils/ownDownload），DownloadRename 取出后 suggest({ filename: name })——「询问保存位置」打开时
 * 走 downloadOwn（downloads.download + saveAs），对话框里的默认名就是 name；<a download> 路径登记是双保险（没登记时 skip.ts 也不改名）。
 * 取舍：<a download> 无法指定 saveAs（只服从浏览器自己的「下载前询问」设置）。所以「询问保存位置」打开时仍走 downloads.download。 */
export async function saveBytes(bytes: Uint8Array, name: string, waitMs = 30_000): Promise<void> {
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/octet-stream" }));
    if (settings.store.saveAs) {
        let id: number;
        try { id = await downloadOwn({ url, filename: name, saveAs: true, conflictAction: "uniquify" }); }
        catch (e) { URL.revokeObjectURL(url); throw e; }
        watchDownload(url, () => id, undefined);
        return;
    }
    // 监听必须在点击之前挂好（点击会同步触发 downloads.onCreated）；完成 / 中断 / 超时后全部摘掉并撤销 URL
    let id: number | undefined;
    const intent = await registerOwnIntent(url, name, "uniquify");
    const stop0 = watchDownload(url, () => id, c => { id = c; if (intent.key) releaseWhenSettled(c, intent.release); }, waitMs); // 不能在 onCreated 时删：定名（onDeterminingFilename）在它之后
    const stop = () => { stop0(); void intent.release(); };
    const a = document.createElement("a");
    a.href = url; a.download = name; a.style.display = "none";
    try { document.body.append(a); a.click(); }
    catch (e) { stop(); throw e; }
    finally { a.remove(); }
}
/** 监听这次下载的结束：complete / interrupted → 摘监听、撤销 URL、（设置打开时）从列表里 erase。
 *  onCreated 的 setId 用于 <a download> 路径（拿 id；url 对不上的下载忽略）；waitMs 内一直没出现 → 当作点击被拦截，清理。返回 stop。 */
function watchDownload(url: string, getId: () => number | undefined, setId: ((id: number) => void) | undefined, waitMs = 0): () => void {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = () => {
        if (timer !== undefined) { clearTimeout(timer); timer = undefined; }
        chrome.downloads.onChanged.removeListener(onChanged); chrome.downloads.onCreated.removeListener(onCreated);
        URL.revokeObjectURL(url);
    };
    const onCreated = (d: chrome.downloads.DownloadItem) => {
        if (!setId || getId() !== undefined || (d.url !== url && d.finalUrl !== url)) return;
        setId(d.id);
        if (timer !== undefined) { clearTimeout(timer); timer = undefined; }
    };
    const onChanged = (d: chrome.downloads.DownloadDelta) => {
        const id = getId();
        if (id === undefined || d.id !== id || !d.state || (d.state.current !== "complete" && d.state.current !== "interrupted")) return;
        stop();
        if (d.state.current === "complete" && settings.store.hideFromDownloads) void chrome.downloads.erase({ id }).catch(() => undefined);
    };
    chrome.downloads.onChanged.addListener(onChanged);
    if (setId) { chrome.downloads.onCreated.addListener(onCreated); timer = setTimeout(stop, waitMs); }
    return stop;
}
const kb = (n: number) => String(Math.max(1, Math.round(n / 1024)));

/* ---------- 动作 ---------- */
const tabOrThrow = (tab?: chrome.tabs.Tab) => { const t = tab ?? activeTab(); if (!t) throw new SessionError("no-tab"); return t; };
const withRisk = (t: HTMLElement) => { t.append(h("div", { class: "st-risk", "data-test": "st-toast-risk" }, tr("st.risk"))); return t; };

export async function actCopy(tab?: chrome.tabs.Tab): Promise<void> {
    try {
        const t = tabOrThrow(tab);
        let pass: string | undefined;
        if (settings.store.usePassphrase) { const p = await askPassphrase("export"); if (p == null) return; pass = p; }
        const a = await copySession(t, pass);
        if (a.kind === "token") {
            if (!await writeClipboard(a.text)) { toast(tr("st.copyFailed")); return; }
            withRisk(toast(tr(a.passphrase ? "st.copiedPass" : "st.copied"), 10000));
        } else {
            await saveBytes(a.bytes, a.name!);
            withRisk(toast(tr("st.savedAsFile", kb(a.bytes.length)), 10000));
        }
    } catch (e) { failToast(e); }
}

export async function actExportFile(tab?: chrome.tabs.Tab): Promise<void> {
    try {
        const t = tabOrThrow(tab);
        let pass: string | undefined;
        if (settings.store.usePassphrase) { const p = await askPassphrase("export"); if (p == null) return; pass = p; }
        const a = await exportFileSession(t, pass);
        await saveBytes(a.bytes, a.name);
        withRisk(toast(tr("st.exported", kb(a.bytes.length)), 10000));
    } catch (e) { failToast(e); }
}

async function undo(snap: Snapshot) {
    try {
        const fail = await undoImport(snap);
        if (getSnapshot() === snap) setSnapshot(null);
        toast(tr(fail ? "st.undoFailed" : "st.undone"));
    } catch (e) { failToast(e); }
}

/** 确认（A1）→ 导入 → 结果 toast（带撤销，A2）。返回是否真的导入成功（失败 / 回滚 / 取消 = false）；extra = 通道补充的确认说明（如 WebDAV 的备注与有效期）；forceConfirm = 不论设置都确认（远端来源） */
export async function importParsed(parsed: Parsed, extra?: string, forceConfirm = false): Promise<boolean> {
    const reload = settings.store.reloadAfterImport !== false;
    if (forceConfirm || settings.store.confirmBeforeImport !== false) {
        const ok = await arcConfirm(tr("st.confirmTitle"), {
            ok: tr("st.import"), danger: true,
            detail: tr(reload ? "st.confirmDetail" : "st.confirmDetailNoReload", parsed.origin, parsed.cookies.length, parsed.local.length + parsed.session.length) + (extra ? `\n${extra}` : ""),
        });
        if (!ok) return false;
    }
    let r;
    try { r = await importSession(parsed, { reload }); }
    catch (e) { toast(tr(`st.err.${errCode(e)}`) + (errCode(e) === "perm-denied" ? "" : " — " + tr("st.rolledBack"))); return false; }
    setSnapshot(r.snapshot);
    const msg = tr(r.reloaded ? "st.imported" : "st.importedNoReload") + (r.skipped ? " " + tr("st.importedCounts", r.applied, r.skipped) : "");
    const t = toast(msg, 15000);
    const u = h("button", { type: "button", class: "st-undo", "data-test": "st-undo" }, tr("st.undo")) as HTMLButtonElement;
    u.addEventListener("click", e => { e.stopPropagation(); u.disabled = true; void undo(r.snapshot).then(() => t.click()); });
    t.append(u);
    return true;
}

/** 解码（口令封装则弹口令框，最多 3 次）→ 确认（A1）→ 导入 → 结果 toast（带撤销，A2） */
export async function importInput(input: string | Uint8Array): Promise<void> {
    try {
        let parsed: Parsed | undefined, pass: string | undefined;
        for (let attempt = 0; !parsed; attempt++) {
            if (needsPassphrase(input) && pass == null) { const p = await askPassphrase("import"); if (p == null) return; pass = p; }
            try { parsed = await decode(input, pass); }
            catch (e) {
                if (errCode(e) === "bad-passphrase" && attempt < 2) { toast(tr("st.err.bad-passphrase")); pass = undefined; continue; }
                throw e;
            }
        }
        await importParsed(parsed);
    } catch (e) { failToast(e); }
}

/** 文件 → 字节（也接受把令牌存成文本文件的情况） */
export async function importFileAction(file: File): Promise<void> {
    try {
        if (file.size > MAX_PLAIN_BYTES) throw new SessionError("too-large");
        const bytes = new Uint8Array(await file.arrayBuffer());
        let input: string | Uint8Array = bytes;
        try { const s = new TextDecoder("utf-8", { fatal: true }).decode(bytes).trim(); if (/^(sc:v2:|arc:v1:)/.test(s)) input = s; } catch { /* 二进制文件 */ }
        await importInput(input);
    } catch (e) { failToast(e); }
}

export async function actPaste(): Promise<void> {
    const r = await openPasteBox();
    if (!r) return;
    if ("file" in r) await importFileAction(r.file); else await importInput(r.text);
}

export async function actClear(tab?: chrome.tabs.Tab): Promise<void> {
    try {
        const t = tabOrThrow(tab);
        const what = await ask<{ cookies: boolean; local: boolean; session: boolean }>(tr("st.clearTitle"), done => {
            const box = (key: string, test: string) => { const i = h("input", { type: "checkbox", checked: true, "data-test": test }) as HTMLInputElement; return { i, row: h("label", null, i, tr(key)) }; };
            const c = box("st.clearCookies", "st-clear-cookies"), l = box("st.clearLocal", "st-clear-local"), s = box("st.clearSession", "st-clear-session");
            let host = ""; try { host = new URL(t.url ?? "").origin; } catch { /* 空 */ }
            return { nodes: [h("div", { class: "st-hint" }, tr("st.clearDetail", host)), c.row, l.row, s.row,
                buttons({ label: tr("st.cancel"), test: "st-clear-cancel", on: () => done(null) },
                    { label: tr("st.clearOk"), cls: "danger", test: "st-clear-ok", on: () => done({ cookies: c.i.checked, local: l.i.checked, session: s.i.checked }) })] };
        });
        if (!what) return;
        if (!what.cookies && !what.local && !what.session) { toast(tr("st.nothingSelected")); return; }
        await clearSite(t, what);
        toast(tr("st.cleared"));
    } catch (e) { failToast(e); }
}

export function runAction(act: "copy" | "paste" | "exportFile" | "importFile" | "clear", tab: chrome.tabs.Tab) {
    switch (act) {
        case "copy": return actCopy(tab);
        case "paste": case "importFile": return actPaste();
        case "exportFile": return actExportFile(tab);
        case "clear": return actClear(tab);
    }
}

/* WebDAV 通道的界面与动作（动态引入：只有点了按钮 / 命令才会执行到这里）。
 * 不用 safe()、不写 console；失败只显示枚举码对应的文案；口令只在对话框的局部变量里存在，用完即丢，不进 storage / IDB / 请求（除加密本身）。 */
import { h } from "@api/dom";
import { tr } from "@api/i18n";
import { toast } from "@api/PanelShell";
import { activeTab } from "@plugins/_core/tabState";

import { errCode, SessionError } from "../container";
import { settings } from "../settings";
import { ask, askPassphrase, buttons, importParsed, writeClipboard } from "../ui";
import { normalizeDir } from "./url";
import { davListItems, cleanupExpired, davDecrypt, davDownload, davExport, deleteRemote, type DavItem } from "./ops";
import { clearConfig, loadConfig, saveConfig, toConn, type DavConfig } from "./config";
import type { DavConn } from "./client";
import { DavError } from "./errors";
import { checkPassphrase, DEFAULT_TTL, generatePassphrase } from "./format";

const enabled = () => !!settings.store.webdavEnabled;
/** 未启用：只弹一条提示，不碰网络、不碰 IndexedDB */
function guard(): boolean { if (!enabled()) { toast(tr("st.dav.disabled")); return false; } return true; }
const davFail = (e: unknown) => { toast(e instanceof DavError ? tr(`st.dav.err.${e.code}`) : tr(`st.err.${errCode(e)}`)); };
const when = (ms: number) => new Date(ms).toLocaleString();
const kb = (n: number) => String(Math.max(1, Math.round(n / 1024)));
const field = (label: string, input: HTMLElement) => h("label", { class: "st-field" }, h("span", null, label), input);
const text = (test: string, value = "", type = "text") => h("input", { type, value, "data-test": test, autocomplete: "off", spellcheck: false }) as HTMLInputElement;

/** DAV 密码 / 令牌输入框（未选择「记住」时每次都问） */
function askDavSecret(): Promise<string | null> {
    return ask<string>(tr("st.dav.pwTitle"), done => {
        const i = text("st-dav-pw-input", "", "password");
        const ok = () => { if (i.value) done(i.value); };
        i.addEventListener("keydown", e => { if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); ok(); } });
        return { nodes: [h("div", { class: "st-hint" }, tr("st.dav.pwPrompt")), i,
            buttons({ label: tr("st.cancel"), test: "st-dav-pw-cancel", on: () => done(null) }, { label: tr("st.dav.pwOk"), cls: "ok", test: "st-dav-pw-ok", on: ok })], focus: i };
    });
}

/** 取连接：配置 + 密码（记住的 / 本次输入的）。没有配置 → 提示并返回 null */
async function getConn(): Promise<{ conn: DavConn; cfg: DavConfig } | null> {
    const cfg = await loadConfig();
    if (!cfg) { toast(tr("st.dav.notConfigured")); return null; }
    let secret = cfg.secret;
    if (!secret) { const s = await askDavSecret(); if (s == null) return null; secret = s; }
    return { conn: toConn(cfg, secret), cfg };
}

/* ---------- 设置 ---------- */
export async function actDavConfig(): Promise<void> {
    if (!guard()) return;
    try {
        const cur = await loadConfig();
        await ask<true>(tr("st.dav.cfgTitle"), done => {
            const url = text("st-dav-url", cur?.url ?? "");
            const kind = h("select", { "data-test": "st-dav-kind" }, h("option", { value: "basic" }, tr("st.dav.basic")), h("option", { value: "bearer" }, tr("st.dav.bearer"))) as HTMLSelectElement;
            kind.value = cur?.kind ?? "basic";
            const user = text("st-dav-user", cur?.user ?? "");
            const secret = text("st-dav-secret", "", "password"); if (cur?.secret) secret.placeholder = tr("st.dav.secretKept");
            const remember = h("input", { type: "checkbox", checked: !!cur?.secret, "data-test": "st-dav-remember" }) as HTMLInputElement;
            const status = h("div", { class: "st-status", "data-test": "st-dav-status" });
            const read = (): DavConfig => ({ url: url.value, kind: kind.value as DavConfig["kind"], user: user.value, secret: secret.value || cur?.secret });
            const run = async (f: () => Promise<void>) => { try { await f(); } catch (e) { status.textContent = e instanceof DavError ? tr(`st.dav.err.${e.code}`) : tr(`st.err.${errCode(e)}`); } };
            return {
                nodes: [field(tr("st.dav.url"), url), field(tr("st.dav.kind"), kind), field(tr("st.dav.user"), user), field(tr("st.dav.secret"), secret),
                    h("label", null, remember, tr("st.dav.remember")), h("div", { class: "st-warn" }, tr("st.dav.rememberWarn")), status,
                    buttons(
                        { label: tr("st.dav.test"), test: "st-dav-test", on: () => void run(async () => { const c = read(); status.textContent = ""; await davListItems(toConn({ ...c, url: normalizeDir(c.url) }, c.secret)); status.textContent = tr("st.dav.testOk"); }) },
                        { label: tr("st.dav.clear"), cls: "danger", test: "st-dav-clear", on: () => void run(async () => { await clearConfig(); toast(tr("st.dav.cleared")); done(true); }) }),
                    buttons(
                        { label: tr("st.cancel"), test: "st-dav-cancel", on: () => done(null) },
                        { label: tr("st.dav.save"), cls: "ok", test: "st-dav-save", on: () => void run(async () => { await saveConfig(read(), remember.checked); toast(tr("st.dav.saved")); done(true); }) })],
                focus: url,
            };
        });
    } catch (e) { davFail(e); }
}

/* ---------- 导出 ---------- */
const TTLS: Array<[string, number]> = [["st.dav.ttl15m", 15 * 60_000], ["st.dav.ttl1h", 3_600_000], ["st.dav.ttl24h", 24 * 3_600_000], ["st.dav.ttl7d", 7 * 24 * 3_600_000]];
interface ExportAsk { pass: string; ttlMs: number; label: string }

export async function actDavExport(tab?: chrome.tabs.Tab): Promise<void> {
    if (!guard()) return;
    try {
        const t = tab ?? activeTab();
        if (!t) throw new SessionError("no-tab");
        const c = await getConn();
        if (!c) return;
        let host = ""; try { host = new URL(t.url ?? "").hostname; } catch { /* 空 */ }
        const a = await ask<ExportAsk>(tr("st.dav.expTitle"), done => {
            const p1 = text("st-dav-pass1", "", "password"), p2 = text("st-dav-pass2", "", "password");
            const ttl = h("select", { "data-test": "st-dav-ttl" }, ...TTLS.map(([k, v]) => h("option", { value: String(v) }, tr(k)))) as HTMLSelectElement;
            ttl.value = String(DEFAULT_TTL);
            const label = text("st-dav-label", host);
            const status = h("div", { class: "st-status", "data-test": "st-dav-status" });
            let generated = "";
            const gen = () => { generated = generatePassphrase(); p1.value = p2.value = generated; p1.type = p2.type = "text"; status.textContent = tr("st.dav.generated"); };
            const ok = () => {
                if (p1.value !== p2.value) { status.textContent = tr("st.dav.mismatch"); return; }
                try { checkPassphrase(p1.value, c.conn.auth.secret, c.conn.auth.user); } catch (e) { status.textContent = tr(`st.dav.err.${(e as DavError).code}`); return; }
                done({ pass: p1.value, ttlMs: Number(ttl.value), label: label.value.slice(0, 200) });
            };
            return {
                nodes: [field(tr("st.dav.passphrase"), p1), field(tr("st.dav.passphrase2"), p2),
                    buttons({ label: tr("st.dav.generate"), test: "st-dav-gen", on: gen }, { label: tr("st.dav.copyPass"), test: "st-dav-copy", on: () => { if (generated) void writeClipboard(generated); } }),
                    field(tr("st.dav.ttl"), ttl), field(tr("st.dav.label"), label), h("div", { class: "st-risk", "data-test": "st-dav-risk" }, tr("st.dav.risk")), status,
                    buttons({ label: tr("st.cancel"), test: "st-dav-cancel", on: () => done(null) }, { label: tr("st.dav.upload"), cls: "ok", test: "st-dav-ok", on: ok })],
                focus: p1,
            };
        });
        if (!a) return;
        const r = await davExport(t, c.conn, a.pass, { label: a.label, ttlMs: a.ttlMs });
        toast(tr("st.dav.exported", kb(r.size), when(r.expiresAt)), 10000);
    } catch (e) { davFail(e); }
}

/* ---------- 导入 ---------- */
async function pickItem(conn: DavConn, items: DavItem[]): Promise<DavItem | null> {
    return ask<DavItem>(tr("st.dav.listTitle"), done => {
        const list = h("div", { class: "st-dav-list", "data-test": "st-dav-list" });
        const draw = () => {
            list.textContent = "";
            list.append(...(items.length ? items.map(it => {
                const when2 = it.expired ? tr("st.dav.expired") : tr("st.dav.validUntil", when(it.expiresHint));
                const row = h("div", { class: `st-dav-row${it.expired ? " expired" : ""}`, "data-test": "st-dav-row" },
                    h("button", { type: "button", "data-test": "st-dav-pick", disabled: it.expired, onclick: (e: Event) => { e.stopPropagation(); if (!it.expired) done(it); } },
                        tr("st.dav.row", it.name.slice(0, 8), it.size === undefined ? "?" : kb(it.size), (it.mtime ? when(it.mtime) + " · " : "") + when2)),
                    h("button", { type: "button", class: "del", "aria-label": tr("st.dav.delete"), "data-test": "st-dav-del", onclick: (e: Event) => {
                        e.stopPropagation();
                        void deleteRemote(conn, it.name).then(ok => { if (ok) { items = items.filter(x => x !== it); draw(); } else toast(tr("st.dav.err.dav-server")); });
                    } }, "✕"));
                return row;
            }) : [h("div", { class: "st-hint" }, tr("st.dav.empty"))]));
        };
        draw();
        return { nodes: [list, buttons({ label: tr("st.cancel"), test: "st-dav-cancel", on: () => done(null) })] };
    });
}

export async function actDavImport(): Promise<void> {
    if (!guard()) return;
    try {
        const c = await getConn();
        if (!c) return;
        let items = await davListItems(c.conn);
        if (settings.store.cleanupExpired !== false) {
            const gone = await cleanupExpired(c.conn, items);
            if (gone.length) { items = items.filter(i => !gone.includes(i.name)); toast(tr("st.dav.cleaned", gone.length)); }
        }
        const pick = await pickItem(c.conn, items);
        if (!pick) return;
        const bytes = await davDownload(c.conn, pick.name);
        let opened: Awaited<ReturnType<typeof davDecrypt>> | undefined;
        for (let attempt = 0; !opened; attempt++) {
            const pass = await askPassphrase("import");
            if (pass == null) return;
            try { opened = await davDecrypt(bytes, pass); }
            catch (e) { if (errCode(e) === "bad-passphrase" && attempt < 2) { toast(tr("st.err.bad-passphrase")); continue; } throw e; }
        }
        const { parsed, meta } = opened;
        const ok = await importParsed(parsed, tr("st.dav.confirmExtra", meta.label || tr("st.dav.noLabel"), when(meta.created), when(meta.exp)), true);
        if (ok && settings.store.deleteAfterImport !== false) toast(tr((await deleteRemote(c.conn, pick.name)) ? "st.dav.deleted" : "st.dav.deleteFailed"), 6000);
    } catch (e) { davFail(e); }
}

export const cmdDavExport = () => actDavExport();
export const cmdDavImport = () => actDavImport();

/*
 * Backup（§1 Restore Data 的跨平台版）：每天自动快照侧边栏数据（保留 10 份），可导出 / 导入 JSON。
 */
import { safe } from "@api/ErrorLog";
import { arcConfirm } from "@components/Dialog";
import { tr } from "@api/i18n";
import { h } from "@api/dom";
import { addOverlay, openOverlay } from "@api/Slots";
import { listen } from "@api/ChromeEvents";
import { toast } from "@api/PanelShell";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";

import { tier } from "./tier";
import { syncDown, syncUp } from "./sync";
import { definePluginSettings, SETTINGS_KEY } from "@api/Settings";
import { sensitiveSettingKeys } from "@api/PluginManager";
import { OptionType } from "@utils/types";
import { debounce } from "@utils/misc";

const settings = definePluginSettings({
    autoSync: { type: OptionType.BOOLEAN, default: false, description: "backup.autoSync" },
});

const ALARM = "arc-backup";
const KEY = "backups";
type Snap = { at: number; data: Record<string, unknown> };

/** 去掉 sensitive 设置项（不进导出 / 备份） */
export function stripSensitive(all: Record<string, unknown>, keys = sensitiveSettingKeys()) {
    const s = all[SETTINGS_KEY] as { plugins?: Record<string, Record<string, unknown>> } | undefined;
    if (!s?.plugins || !keys.length) return all;
    const plugins = { ...s.plugins };
    for (const [p, k] of keys) if (plugins[p] && k in plugins[p]) { plugins[p] = { ...plugins[p] }; delete plugins[p][k]; }
    return { ...all, [SETTINGS_KEY]: { ...s, plugins } };
}
/** 导入时 sensitive 设置项沿用当前值（导入文件里有也忽略） */
export function keepSensitive(data: Record<string, unknown>, current: Record<string, unknown>, keys = sensitiveSettingKeys()) {
    const cur = (current[SETTINGS_KEY] as { plugins?: Record<string, Record<string, unknown>> } | undefined)?.plugins ?? {};
    const out = stripSensitive(data, keys);
    const s = out[SETTINGS_KEY] as { plugins?: Record<string, Record<string, unknown>> } | undefined;
    if (!keys.length) return out;
    const plugins = { ...s?.plugins };
    for (const [p, k] of keys) if (cur[p] && k in cur[p]) plugins[p] = { ...plugins[p], [k]: cur[p][k] };
    return { ...out, [SETTINGS_KEY]: { ...s, plugins } };
}
/** secret:* 键（API 密钥等）永不进导出 / 快照 / 导入（core-api-proposal「sensitive data」） */
export const isSecretKey = (k: string) => k.startsWith("secret:");
export function stripSecrets(all: Record<string, unknown>) { return Object.fromEntries(Object.entries(all).filter(([k]) => !isSecretKey(k))); }
export async function dump() {
    const all = await chrome.storage.local.get(null);
    delete all[KEY];
    return stripSensitive(stripSecrets(all));
}
async function snapshot() {
    const data = await dump(); // 已去掉 secret:* 与 sensitive 字段
    const { [KEY]: list = [] } = await chrome.storage.local.get(KEY) as { backups?: Snap[] };
    list.unshift({ at: Date.now(), data });
    await chrome.storage.local.set({ [KEY]: tier(list.map(s => ({ ...s, data: stripSecrets(s.data) }))) }); // 旧快照里的 secret:* 一并清掉
}
export async function restore(data: Record<string, unknown>) {
    const keep = await chrome.storage.local.get(KEY);
    const cur = await chrome.storage.local.get(null);
    const secrets = Object.fromEntries(Object.entries(cur).filter(([k]) => isSecretKey(k)));
    data = keepSensitive(stripSecrets(data), cur);
    await chrome.storage.local.clear();
    await chrome.storage.local.set({ ...data, ...secrets, ...keep });
    chrome.runtime.reload();
}

function render(box: HTMLElement) {
    const list = h("div", { class: "arc-list arc-backup-list" });
    const draw = async () => {
        const { [KEY]: snaps = [] } = await chrome.storage.local.get(KEY) as { backups?: Snap[] };
        list.replaceChildren(...snaps.map(s => h("div", { class: "arc-list-row" },
            h("span", { class: "arc-tab-title" }, new Date(s.at).toLocaleString()),
            h("button", { class: "arc-btn", onclick: async () => { if (await arcConfirm(tr("backup.restoreConfirm"))) void restore(s.data); } }, tr("common.restore")))));
        if (!snaps.length) list.append(h("div", { class: "arc-hint" }, tr("backup.none")));
    };
    const file = h("input", { type: "file", accept: "application/json", style: "display:none" });
    file.addEventListener("change", async () => {
        const f = file.files?.[0];
        if (!f) return;
        try { await restore(JSON.parse(await f.text())); } catch (e) { toast(tr("data.importFailed", String(e))); }
    });
    box.append(h("div", { class: "arc-row" },
        h("button", { class: "arc-btn", onclick: async () => {
            const blob = new Blob([JSON.stringify(await dump(), null, 2)], { type: "application/json" });
            const a = h("a", { href: URL.createObjectURL(blob), download: `cat-backup-${Date.now()}.json` });
            a.click();
        } }, tr("backup.export")),
        h("button", { class: "arc-btn", onclick: () => file.click() }, tr("backup.import")),
        h("button", { class: "arc-btn", onclick: () => void snapshot().then(draw) }, tr("backup.now"))), file, list);
    void draw();
}

export default definePlugin({
    name: "Backup",
    authors: [Devs.ArcSidebar],
    label: "data.backup",
    description: "plugin.backup.desc",
    tags: ["data"],
    required: true,
    settings,
    commands: [
        { id: "backup.syncUp", label: "backup.syncUp", keywords: ["sync"], context: "background", run: () => syncUp() },
        { id: "backup.syncDown", label: "backup.syncDown", keywords: ["sync"], context: "panel", run: async () => { if (await arcConfirm(tr("backup.syncDownConfirm"))) void syncDown().then(ok => toast(ok ? tr("backup.synced") : tr("backup.syncEmpty"))); } },
        { id: "backup.open", label: "backup.cmdOpen", keywords: ["restore data", "backup"], context: "panel", run: () => openOverlay("backup") },
    ],
    background: {
        async start() {
            await chrome.alarms.create(ALARM, { periodInMinutes: 24 * 60, delayInMinutes: 1 });
            // 自动同步：结构变化 30 秒后上传
            const up = debounce(() => { if (settings.store.autoSync) void syncUp().catch(e => console.warn("sync", e)); }, 30000);
            const onCh = (c: Record<string, chrome.storage.StorageChange>, area: string) => { if (area === "local" && ["data:spaces", "data:pinned", "data:favorites"].some(k => k in c)) up(); };
            chrome.storage.onChanged.addListener(onCh);
            return [() => void safe(chrome.alarms.clear(ALARM), "alarms.clear"), () => chrome.storage.onChanged.removeListener(onCh), listen("alarms.onAlarm", a => { if (a.name === ALARM) void snapshot(); })];
        },
    },
    panel: { start: () => addOverlay("backup", "Backup", { title: tr("backup.cmdOpen"), render }) },
});

/* 可选插件「Download Rename」（Arc：Tidy Downloads，arc-analysis/download-rename.md）。默认关闭。
 * 下载开始时在 chrome.downloads.onDeterminingFilename 里给出新文件名：规则模式（默认）或模型模式（单独开关）。
 * 扩展名强制保留。
 * 撤销：Arc 是直接改回原名；MV3 下载完成后不能改名，无法对齐。这里的 "Revert to original name" 改为：
 *   把原文件名复制到剪贴板 + chrome.downloads.show 在文件夹里显示文件，提示「原文件名已复制」。不重新下载、不删除任何文件。 */
import { safe } from "@api/ErrorLog";
import "@components/ArcTooltip";
import { copyText } from "@api/Clipboard";
import { runCommand } from "@api/Commands";
import { getLang, tr } from "@api/i18n";
import { toast } from "@api/PanelShell";
import { addSection, refresh } from "@api/Slots";
import { definePluginSettings, getPluginSettings, removePluginSetting } from "@api/Settings";
import { createPluginStore } from "@api/Storage";
import { h } from "@api/dom";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";

import { apiKeySetting, getApiKey, migrateLegacyApiKey } from "../_shared/llm";
import { originTabTitle } from "./origin";
import { shouldToastReverted, showDownloadVerified } from "./show";
import "./i18n";
import style from "./style";
import { decideName } from "./model";
import { ruleRename } from "./rules";

const settings = definePluginSettings({
    useModel: { type: OptionType.BOOLEAN, description: "downloadRename.useModel", default: false },
    endpoint: { type: OptionType.STRING, description: "downloadRename.endpoint", default: "" },
    model: { type: OptionType.STRING, description: "downloadRename.model", default: "" },
    apiKey: apiKeySetting("downloadRename.apiKey"),
    timeout: { type: OptionType.NUMBER, description: "downloadRename.timeout", default: 8, min: 2, max: 30 },
    fallback: { type: OptionType.BOOLEAN, description: "downloadRename.fallback", default: true },
});

interface Renamed { id: number; oldName: string; newName: string; url: string; at: number; dismissed?: boolean }
/** Arc DownloadRenameMetadata.downloadIDToFilenameMap 的对应 */
const store = createPluginStore<{ items: Renamed[] }>("downloadRename", () => ({ items: [] }));
const MAX_ITEMS = 100;

const domainOf = (u?: string) => { try { return u ? new URL(u).hostname : ""; } catch { return ""; } };

/** 只用发起这次下载的标签的标题（按 referrer 精确匹配）；对应不上就不发标题，规则模式也不用标题补名字 */
async function titleFor(item: chrome.downloads.DownloadItem): Promise<string | undefined> {
    return originTabTitle(item.referrer, await safe(chrome.tabs.query({}), "tabs.query", [] as chrome.tabs.Tab[]));
}

const MIGRATE = () => migrateLegacyApiKey(p => (getPluginSettings(p) as Record<string, unknown>).apiKey, p => removePluginSetting(p, "apiKey"));

function onDetermining(item: chrome.downloads.DownloadItem, suggest: (s?: chrome.downloads.FilenameSuggestion) => void): boolean {
    const base = item.filename.split(/[\\/]/).pop() ?? item.filename;
    const useModel = !!settings.store.useModel;
    const timeoutMs = Math.max(2, Number(settings.store.timeout) || 8) * 1000;
    let done = false;
    const finish = (name: string | null) => {
        if (done) return; done = true;
        if (!name) { suggest(); return; }
        suggest({ filename: name, conflictAction: "uniquify" });
        void store.update(x => { x.items = [{ id: item.id, oldName: base, newName: name, url: item.finalUrl || item.url, at: Date.now() }, ...x.items.filter(i => i.id !== item.id)].slice(0, MAX_ITEMS); });
    };
    // 总时限：模型时限 + 1 秒，到点保留原名，保证 suggest 一定被调用
    setTimeout(() => finish(null), timeoutMs + 1000);
    void (async () => {
        const input = { filename: base, title: await titleFor(item), domain: domainOf(item.referrer || item.finalUrl || item.url) };
        const name = await decideName(input, {
            useModel, fallbackToRules: !!settings.store.fallback, rule: ruleRename,
            cfg: { endpoint: String(settings.store.endpoint ?? ""), model: String(settings.store.model ?? ""), apiKey: await getApiKey(), timeoutMs, language: getLang() === "zh" ? "Chinese" : "English" },
        }).catch(() => null); /* 预期：模型 / 规则失败即保留原名（decideName 自身已按设置回退），忽略 */
        finish(name);
    })();
    return true; // 异步 suggest
}

/** “撤销”的替代：在文件夹里显示该下载（原文件名由侧边栏复制到剪贴板）。Arc 是直接改回原名；MV3 下载完成后不能改名，无法对齐 */
async function showInFolder(id?: number): Promise<boolean> {
    await store.ready;
    const it = id == null ? store.get().items[0] : store.get().items.find(i => i.id === id);
    if (!it) return false;
    return showDownloadVerified(it.id);
}

let seen = new Set<number>();

export default definePlugin({
    name: "DownloadRename",
    label: "plugin.downloadRename.label",
    icon: "downloadBox",
    description: "plugin.downloadRename.desc",
    authors: [Devs.ArcSidebar],
    tags: ["library"],
    settings,
    commands: [{ id: "downloadRename.show", label: "downloadRename.cmdShow", context: "background", run: (a?: unknown) => showInFolder((a as { id?: number } | undefined)?.id) }],
    background: {
        start() {
            void MIGRATE();
            chrome.downloads.onDeterminingFilename.addListener(onDetermining);
            return [() => chrome.downloads.onDeterminingFilename.removeListener(onDetermining)];
        },
    },
    panel: {
        managedStyle: style,
        async start() {
            await store.ready;
            seen = new Set(store.get().items.map(i => i.id));
            const latest = () => store.get().items.find(i => !i.dismissed && Date.now() - i.at < 10 * 60_000);
            const unsub = store.subscribe(v => {
                for (const i of v.items) if (!seen.has(i.id)) { seen.add(i.id); toast(tr("downloadRename.renamed")); }
                refresh();
            });
            // 侧边栏横幅：Arc SidebarBanner “Download renamed to:” + “Revert to original name”
            const offSection = addSection("bottom", "DownloadRename", {
                order: 5,
                render(box) {
                    const it = latest();
                    if (!it) return;
                    const dismiss = () => void store.update(x => { const r = x.items.find(i => i.id === it.id); if (r) r.dismissed = true; });
                    box.append(h("div", { class: "arc-banner arc-dlrename-banner", "data-test": "dlrename-banner" },
                        h("div", { class: "arc-banner-title" }, tr("downloadRename.bannerTitle")),
                        h("div", { class: "arc-banner-text", "data-tip": it.oldName }, it.newName),
                        h("div", { class: "arc-banner-actions" },
                            h("button", { type: "button", class: "arc-btn", "data-test": "dlrename-revert", onclick: async () => {
                                // Arc 是直接改回原名；MV3 下载完成后不能改名，无法对齐 → 复制原名 + 在文件夹中显示
                                const copied = await copyText(it.oldName);
                                const shown = await runCommand("downloadRename.show", { id: it.id });
                                toast(tr(copied ? "downloadRename.oldNameCopied" : "downloadRename.copyFailed"));
                                // Cat 决定：Arc 原文 "Download name reverted!" 在复制和显示都成功后弹出（文件名实际并未改回）
                                if (shouldToastReverted(copied, shown)) setTimeout(() => toast(tr("downloadRename.reverted")), 600);
                            } }, tr("downloadRename.revert")),
                            h("button", { type: "button", class: "arc-btn arc-btn-quiet", "aria-label": tr("common.close"), onclick: dismiss }, "×"))));
                },
            });
            return [unsub, offSection];
        },
    },
});

/*
 * Live Folders（GitHub）：把 GitHub 搜索（PR / Issue）显示成侧边栏里的一个自动更新的文件夹。
 * 查询语法同 github.com 搜索；需要 @me 等私有查询时在设置里填个人访问令牌（只存在本机）。
 */
import { withEmptyFallback } from "@components/EmptyFavicon";
import { arcTooltip } from "@components/ArcTooltip";
import { tr } from "@api/i18n";
import { parkedInterval } from "@api/ParkLife";
import { h } from "@api/dom";
import { folderOpening } from "@components/folderAnim";
import { folderGlyph } from "@api/icons";
import { addSection, refresh } from "@api/Slots";
import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { focusOrOpen } from "@components/TabRow";
import { faviconUrl } from "@utils/misc";

const settings = definePluginSettings({
    query: { type: OptionType.STRING, default: "", description: "live.query" },
    /* sensitive（补丁 livefolders-token-sensitive）：不进导出 / 自动快照，导入时沿用当前值；值仍存在 Settings.plugins.Tabs.token，升级不搬家 */
    token: { type: OptionType.STRING, default: "", description: "live.token", sensitive: true },
});

/** 供空间菜单“实时文件夹 ›”使用：读取 / 设置 GitHub 查询（空 = 关闭） */
export const liveQuery = () => String(settings.store.query || "").trim();
export function setLiveQuery(q: string) { settings.store.query = q; }

interface Item { id: number; title: string; url: string; repo: string }
let items: Item[] = [];
let collapsed = false;
let error = "";

async function load() {
    const q = String(settings.store.query || "").trim();
    if (!q) { items = []; refresh(); return; }
    try {
        const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
        if (settings.store.token) headers.Authorization = `Bearer ${settings.store.token}`;
        const r = await fetch(`https://api.github.com/search/issues?per_page=20&q=${encodeURIComponent(q)}`, { headers });
        if (!r.ok) throw new Error(String(r.status));
        const j = await r.json() as { items: { id: number; title: string; html_url: string; repository_url: string }[] };
        items = j.items.map(i => ({ id: i.id, title: i.title, url: i.html_url, repo: i.repository_url.split("/").slice(-2).join("/") }));
        error = "";
    } catch (e) { error = String((e as Error).message); }
    refresh();
}

export default definePlugin({
    name: "LiveFolders",
    authors: [Devs.ArcSidebar],
    label: "plugin.liveFolders.label",
    description: "plugin.liveFolders.desc",
    tags: ["tabs"],
    enabledByDefault: false,
    settings,
    onSettingsChange: () => void load(),
    panel: {
        start() {
            void load();
            const t = parkedInterval(() => void load(), 10 * 60000); // 补丁 inpage-parked-timers-stop：停放时不再调度，切回若已到点补一次
            return [t, addSection("pinned", "LiveFolders", {
                order: 90,
                render(el) {
                    if (!String(settings.store.query || "").trim()) return;
                    const head = h("div", { class: "arc-folder-head", "data-test": "live-folder", onclick: () => { collapsed = !collapsed; refresh(); } },
                        h("span", { class: "arc-folder-icon" }, folderGlyph(!collapsed)),
                        h("span", { class: "arc-tab-title" }, tr("live.github", items.length)),
                        error ? h("small", { "data-tip": error }, "!") : null);
                    const opening = folderOpening("live-folder", collapsed); // 折叠态也要记（展开那次才播动画）
                    el.append(h("div", { class: "arc-folder", "data-collapsed": String(collapsed) }, head, collapsed ? null : h("div", { class: opening ? "arc-folder-body arc-folder-opening" : "arc-folder-body" },
                        items.map(i => arcTooltip(h("div", { class: "arc-tab arc-row", style: "padding-left:26px", onclick: () => void focusOrOpen(undefined, i.url) },
                            withEmptyFallback(h("img", { class: "arc-fav", src: faviconUrl(i.url), alt: "" }) as HTMLImageElement), h("span", { class: "arc-tab-title" }, i.title)) as HTMLElement, i.title, { delay: 1.5, anchor: "cursor" }) /* tooltip-row.md：仅标题、delay 1.5、anchor cursor；maxWidth ⛔ 文档仅标签行/Easel 行 500 */))));
                },
            })];
        },
    },
});

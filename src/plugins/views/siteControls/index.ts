/*
 * Site Controls（同 Arc 点地址栏左侧图标弹出的站点控制面板）：属于「视图」插件的可选功能。
 * 顶部：分享（复制链接）/ 截图（captureVisibleTab → 下载 + 剪贴板）/ 提取正文（复制阅读模式文本）。
 *   Arc 的 Boost 按钮：本扩展没有 Boost 插件 → 不显示。
 * 扩展：chrome.management 列出已安装扩展（≥ 6 个时显示搜索）；点按 = 在贴着侧边栏的小窗口里打开它的弹窗页（见 extPopup.ts），
 *   没有弹窗页则打开选项页；停用的点按 = 启用；右键 = 弹窗 / 选项 / 启用·停用 / 重新查找弹窗页 / 详情。+ = Chrome 网上应用店。
 * 设置：chrome.contentSettings 按站点（origin/*）设置 通知 / 位置 / 摄像头 / 麦克风 / 弹出窗口 / JavaScript。
 * 底部：「安全」https 胶囊 + … 菜单（清除缓存 / 清除 Cookie 只作用于当前站点 origin；管理扩展；添加扩展；所有站点设置）。
 */
import { displayUrl } from "@api/displayUrl";
import "@components/ArcTooltip";
import { safe } from "@api/ErrorLog";
import { h } from "@api/dom";
import { siteControlSections } from "@api/Slots";
import { tr } from "@api/i18n";
import { icon, type IconName } from "@api/icons";
import { copyText } from "@api/Clipboard";
import { toast, copyUrlWithToast } from "@api/PanelShell";
import { openPanel, openSubMenu, closeMenus } from "@components/Menu";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
import { activeTab, getWindowId } from "@plugins/_core/tabState";
import { sidebarOnly } from "@api/Commands";
import { displayHost, siteControlsHook } from "@plugins/command/navigation";
import { cachedPopup, forgetPopup, KNOWN_POPUPS, openExtensionPopup, type PopupResult } from "./extPopup";

const WEB_STORE = "https://chromewebstore.google.com/";
type CS = "notifications" | "location" | "camera" | "microphone" | "popups" | "javascript";
const ROWS: { type: CS; icon: IconName; values: string[] }[] = [
    { type: "notifications", icon: "bell", values: ["allow", "block", "ask"] },
    { type: "location", icon: "location", values: ["allow", "block", "ask"] },
    { type: "camera", icon: "camera", values: ["allow", "block", "ask"] },
    { type: "microphone", icon: "mic", values: ["allow", "block", "ask"] },
    { type: "popups", icon: "popup", values: ["allow", "block"] },
    { type: "javascript", icon: "code", values: ["allow", "block"] },
];
const cs = (type: CS) => (chrome.contentSettings as unknown as Record<CS, chrome.contentSettings.ContentSetting<string>>)[type];
const originOf = (url?: string) => { try { const u = new URL(url ?? ""); return /^https?:$/.test(u.protocol) ? u.origin : ""; } catch { return ""; } };

async function screenshot(t: chrome.tabs.Tab) {
    try {
        const dataUrl = await chrome.tabs.captureVisibleTab(t.windowId, { format: "png" });
        const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
        const host = (displayHost(t.url, t.title) || "page").replace(/[^\w.-]+/g, "_");
        await chrome.downloads.download({ url: dataUrl, filename: `Screenshot ${host} ${stamp}.png`, saveAs: false });
        let copied = false;
        try {
            const blob = await (await fetch(dataUrl)).blob();
            await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
            copied = true;
        } catch { /* 剪贴板需要焦点；下载已完成 */ }
        toast(tr(copied ? "site.shotCopied" : "site.shotSaved"));
    } catch (e) {
        toast(tr("site.shotFailed"));
        console.warn("[SiteControls] screenshot", (e as Error).message);
    }
}

async function captureText(t: chrome.tabs.Tab) {
    try {
        const [r] = await chrome.scripting.executeScript({
            target: { tabId: t.id! },
            func: () => {
                const sel = String(getSelection() ?? "").trim();
                if (sel) return sel;
                const root = document.querySelector("article, main, [role=main]") as HTMLElement | null ?? document.body;
                return `${document.title}\n\n${(root?.innerText ?? "").replace(/\n{3,}/g, "\n\n").trim()}`;
            },
        });
        const text = String(r?.result ?? "");
        if (text && await copyText(text)) toast(tr("site.textCopied")); else toast(tr("site.textFailed"));
    } catch { toast(tr("site.textFailed")); }
}

/** 点扩展：弹窗页（已知 / 探测）→ 选项页 → 提示；停用的扩展点按 = 启用 */
async function clickExt(x: chrome.management.ExtensionInfo, tile: HTMLElement, refresh: () => void) {
    if (!x.enabled) { await chrome.management.setEnabled(x.id, true).catch(() => toast(tr("site.extFailed"))); refresh(); return; }
    const r = tile.getBoundingClientRect();
    const at = { left: window.screenX + r.right + 12, top: window.screenY + Math.max(0, r.top - 40) };
    tile.classList.add("busy");
    const res = await openExtensionPopup(x, at, activeTab()?.id).catch(() => ({ ok: false }) as PopupResult);
    tile.classList.remove("busy");
    if (res.ok) { closeMenus(); return; }
    if (x.optionsUrl) { closeMenus(); void safe(chrome.tabs.create({ url: x.optionsUrl }), "tabs.create"); return; }
    toast(tr("site.extNoPopup"));
}

function extTile(x: chrome.management.ExtensionInfo, refresh: () => void) {
    const iconUrl = (x.icons ?? []).toSorted((a, b) => b.size - a.size)[0]?.url;
    const letter = h("span", { class: "arc-sc-ext-letter", style: `--h:${[...x.id].reduce((a, c) => a + c.charCodeAt(0), 0) % 360}` }, x.name.slice(0, 1).toUpperCase());
    const img = iconUrl ? h("img", { src: iconUrl, alt: "", draggable: "false" }) as HTMLImageElement : null;
    if (img) { letter.hidden = true; img.addEventListener("error", () => { img.remove(); letter.hidden = false; }); }
    const toggle = () => void chrome.management.setEnabled(x.id, !x.enabled).then(refresh).catch(() => toast(tr("site.extFailed")));
    const known = cachedPopup(x);
    const tile: HTMLElement = h("button", {
        type: "button", class: `arc-sc-ext${x.enabled ? "" : " off"}`, "data-test": `sc-ext:${x.id}`, "data-name": x.name.toLowerCase(),
        "data-tip": `${x.name}${x.enabled ? "" : ` · ${tr("site.extOff")}`}\n${tr(x.enabled ? "site.extHint" : "site.extHintOff")}`,
        onclick: () => void clickExt(x, tile, refresh),
        oncontextmenu: (e: MouseEvent) => {
            e.preventDefault(); e.stopPropagation();
            openSubMenu({ x: e.clientX, y: e.clientY }, [
                { label: tr("site.extPopup"), test: "sc-ext-popup", disabled: !x.enabled || known === "none", run: () => void clickExt(x, tile, refresh) },
                { label: tr("site.extOptions"), test: "sc-ext-options", disabled: !x.optionsUrl || !x.enabled, run: () => void safe(chrome.tabs.create({ url: x.optionsUrl }), "tabs.create") },
                { label: tr(x.enabled ? "site.extDisable" : "site.extEnable"), test: "sc-ext-toggle", disabled: !x.mayDisable, run: toggle },
                { label: "", separator: true },
                { label: tr("site.extRefind"), test: "sc-ext-refind", disabled: !!KNOWN_POPUPS[x.id], run: () => forgetPopup(x) },
                { label: tr("site.extDetails"), test: "sc-ext-manage", run: () => void safe(chrome.tabs.create({ url: `chrome://extensions/?id=${x.id}` }), "tabs.create") },
            ], "arc-space-menu");
        },
    }, ...(img ? [img] : []), letter);
    return tile;
}

async function settingRow(type: CS, ic: IconName, values: string[], url: string, origin: string) {
    let cur = "";
    try { cur = (await cs(type).get({ primaryUrl: url })).setting as string; } catch { /* 不支持的类型 */ }
    const sub = h("small", {}, tr(`site.v.${cur || "ask"}`));
    const row = h("button", {
        type: "button", class: "arc-sc-row", "data-test": `sc-set:${type}`, "data-value": cur,
        onclick: (e: MouseEvent) => {
            e.stopPropagation();
            const r = row.getBoundingClientRect();
            openSubMenu({ x: r.left + 40, y: r.bottom }, values.map(v => ({
                label: tr(`site.v.${v}`), checked: v === cur, test: `sc-val:${v}`,
                run: () => void cs(type).set({ primaryPattern: `${origin}/*`, setting: v as never }).then(() => {
                    cur = v; sub.textContent = tr(`site.v.${v}`); row.dataset.value = v;
                }).catch(err => toast(String((err as Error).message))),
            })));
        },
    }, h("span", { class: "arc-sc-row-icon" }, icon(ic, 15)), h("span", { class: "arc-sc-row-text" }, h("span", {}, tr(`site.cs.${type}`)), sub));
    return row;
}

async function clearSite(origin: string, what: "cache" | "cookies") {
    try {
        await chrome.browsingData.remove({ origins: [origin] }, what === "cache" ? { cache: true, cacheStorage: true } : { cookies: true });
        toast(tr(what === "cache" ? "site.cacheCleared" : "site.cookiesCleared"));
    } catch (e) { toast(String((e as Error).message)); }
}

export async function openSiteControls(anchor: { x: number; y: number }, t = activeTab()) {
    if (!t) return null;
    const url = t.url || t.pendingUrl || "";
    const origin = originOf(url);
    const web = !!origin && t.id != null;
    const top = h("div", { class: "arc-sc-top" },
        h("button", { type: "button", class: "arc-sc-action", "data-test": "sc-share", "data-tip": tr("site.share"), onclick: () => void copyUrlWithToast(url).then(() => closeMenus()) }, icon("share", 17)),
        h("button", { type: "button", class: "arc-sc-action", "data-test": "sc-shot", "data-tip": tr("site.screenshot"), disabled: !web, onclick: () => { closeMenus(); void screenshot(t); } }, icon("photo", 17)),
        h("button", { type: "button", class: "arc-sc-action", "data-test": "sc-text", "data-tip": tr("site.captureText"), disabled: !web, onclick: () => { closeMenus(); void captureText(t); } }, icon("scanText", 17)));

    const grid = h("div", { class: "arc-sc-grid", "data-test": "sc-exts" });
    const search = h("input", { type: "search", class: "arc-field arc-sc-search", "data-test": "sc-search", placeholder: tr("site.extSearch"), "aria-label": tr("site.extSearch") }) as HTMLInputElement;
    const filter = () => { const q = search.value.trim().toLowerCase(); grid.querySelectorAll<HTMLElement>("[data-name]").forEach(t => { t.hidden = !!q && !t.dataset.name!.includes(q); }); };
    search.addEventListener("input", filter);
    search.addEventListener("keydown", e => { if (e.key === "Enter") (grid.querySelector<HTMLElement>("[data-name]:not([hidden])"))?.click(); });
    const fillGrid = async () => {
        let exts: chrome.management.ExtensionInfo[] = [];
        try { exts = (await chrome.management.getAll()).filter(x => x.type === "extension" && x.id !== chrome.runtime.id); } catch { /* 无权限 */ }
        exts.sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name));
        grid.replaceChildren(...exts.map(x => extTile(x, () => void fillGrid())),
            h("button", { type: "button", class: "arc-sc-ext arc-sc-add", "data-test": "sc-add", "data-tip": tr("site.addExtension"), onclick: () => void safe(chrome.tabs.create({ url: WEB_STORE }), "tabs.create") }, icon("plus", 13))); // SF plus 13pt Semibold（SiteControlCenterExtensionsView @0x101378d78，ionicons-to-arc.md L18）
        search.hidden = exts.length < 6;
        filter();
    };
    await fillGrid();

    const rows = web ? await Promise.all(ROWS.map(r => settingRow(r.type, r.icon, r.values, url, origin))) : [];
    const secure = url.startsWith("https://");
    const more = h("button", {
        type: "button", class: "arc-sc-more", "data-test": "sc-more", "data-tip": tr("spaces.more"),
        onclick: (e: MouseEvent) => {
            e.stopPropagation();
            const r = more.getBoundingClientRect();
            openSubMenu({ x: r.left, y: r.bottom + 4 }, [
                { label: tr("site.clearCache"), test: "sc-clearCache", disabled: !web, run: () => void clearSite(origin, "cache") },
                { label: tr("site.clearCookies"), test: "sc-clearCookies", disabled: !web, run: () => void clearSite(origin, "cookies") },
                { label: "", separator: true },
                { label: tr("site.manageExtensions"), test: "sc-manageExt", run: () => void safe(chrome.tabs.create({ url: "chrome://extensions" }), "tabs.create") },
                { label: tr("site.addExtension"), test: "sc-addExt", run: () => void safe(chrome.tabs.create({ url: WEB_STORE }), "tabs.create") },
                { label: "", separator: true },
                { label: tr("site.allSettings"), test: "sc-allSettings", run: () => void safe(chrome.tabs.create({ url: web ? `chrome://settings/content/siteDetails?site=${encodeURIComponent(origin)}` : "chrome://settings/content" }), "tabs.create") },
            ], "arc-space-menu", false);
        },
    }, icon("more", 16));
    const bottom = h("div", { class: "arc-sc-bottom" },
        web ? h("button", {
            type: "button", class: `arc-sc-secure${secure ? "" : " insecure"}`, "data-test": "sc-secure",
            "data-tip": displayUrl(origin), onclick: () => void safe(chrome.tabs.create({ url: `chrome://settings/content/siteDetails?site=${encodeURIComponent(origin)}` }), "tabs.create"),
        }, icon(secure ? "lock" : "alert", 13), tr(secure ? "site.secure" : "site.notSecure")) : h("span"),
        more);

    // 插件分区（@api/Slots addSiteControlSection）：顶部操作区与扩展区之间，按 order；面板关闭时调用清理
    const secCleanups: (() => void)[] = [];
    const sections = siteControlSections.sorted().map(([id, d]) => {
        const box = h("div", { class: "arc-sc-section", "data-section": id, "data-test": `sc-section-${id}` });
        try { const c = d.render(box, t, () => closeMenus()); if (typeof c === "function") secCleanups.push(c); } catch (e) { console.warn("site control section failed", id, e); }
        return box;
    });
    const panel = openPanel(anchor, [
        top, ...sections,
        h("div", { class: "arc-sc-label" }, tr("site.extensions")), search, grid,
        ...(rows.length ? [h("div", { class: "arc-sc-label" }, tr("site.settings")), h("div", { class: "arc-sc-rows" }, ...rows)] : []),
        h("div", { class: "arc-sc-sep" }),
        bottom,
    ], "arc-site-controls");
    if (panel && secCleanups.length) { const mo = new MutationObserver(() => { if (!panel.isConnected) { mo.disconnect(); secCleanups.forEach(c => { try { c(); } catch { /* */ } }); } }); mo.observe(document.body, { childList: true, subtree: true }); }
    return panel;
}

export default definePlugin({
    name: "SiteControls",
    authors: [Devs.ArcSidebar],
    label: "plugin.siteControls.label",
    description: "plugin.siteControls.desc",
    tags: ["views"],
    enabledByDefault: true,
    commands: [{ id: "site.controls", label: "site.open", keywords: ["site", "extensions", "permissions", "cookies"], context: "panel", run: sidebarOnly("site.controls", () => { const r = document.querySelector("[data-test=urlbar]")?.getBoundingClientRect(); void openSiteControls({ x: r?.left ?? 8, y: (r?.bottom ?? 36) + 6 }); }, getWindowId) }],
    panel: {
        start() {
            siteControlsHook.open = openSiteControls;
            return () => { delete siteControlsHook.open; };
        },
    },
});

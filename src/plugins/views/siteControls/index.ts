/*
 * Site Controls（同 Arc 点地址栏左侧图标弹出的站点控制面板）：属于「视图」插件的可选功能。
 * 顶部按钮行（scc-action-buttons.md，Arc FUN_101388a14）：分享｜复制链接｜截取部分页面｜整页截图，HStack spacing 8，按钮 48×32。
 *   Arc 的集合 = [share, boostsEnabled ? newBoost : copyURL] + captureEnabled ? [capture, ⌥ ? capturePortraitMode : captureFullPage]。
 *   Cat 裁定：boostsEnabled = false（走 copyURL），captureEnabled = true。⌥ → Portrait 未做（已知偏差）。Arc 没有「提取文字」按钮 → 已删。
 * 扩展：chrome.management 列出已安装扩展（≥ 6 个时显示搜索）；点按 = 在贴着侧边栏的小窗口里打开它的弹窗页（见 extPopup.ts），
 *   没有弹窗页则打开选项页；停用的点按 = 启用；右键 = 弹窗 / 选项 / 启用·停用 / 重新查找弹窗页 / 详情。+ = Chrome 网上应用店。
 * 设置：chrome.contentSettings 按站点（origin/*）设置 通知 / 位置 / 摄像头 / 麦克风 / 弹出窗口 / JavaScript。
 * 底部：「安全」https 胶囊 + … 菜单（清除缓存 / 清除 Cookie 只作用于当前站点 origin；管理扩展；添加扩展；所有站点设置）。
 */
import { displayUrl } from "@api/displayUrl";
import "@components/ArcTooltip";
import { safe } from "@api/ErrorLog";
import { navigateAfterNative, type NativeOpts } from "@api/HostMode";
import { h } from "@api/dom";
import { siteControlSections } from "@api/Slots";
import { tr } from "@api/i18n";
import { icon, type IconName } from "@api/icons";
import { copyText } from "@api/Clipboard";
import { toast } from "@api/PanelShell";
import { applyUrlTransformsDetailed, copyToastKey } from "@api/UrlTransforms";
import { commands, runCommand } from "@api/Commands";
import { openPanel, openSubMenu, closeMenus } from "@components/Menu";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
import { activeTab, getWindowId } from "@plugins/_core/tabState";
import { sidebarOnly } from "@api/Commands";
import { displayHost, siteControlsHook } from "@plugins/command/navigation";
import { cleanUrlDetailed, TOAST_KEY as CLEAN_TOAST_KEY } from "@plugins/cleanUrls/clean";
import "@plugins/cleanUrls/i18n";
import { cropShot, pickRegion, pickStyle } from "./regionCapture";
import { cachedPopup, forgetPopup, KNOWN_POPUPS, openExtensionPopup, type PopupResult } from "./extPopup";
import { downloadOwn } from "@utils/ownDownload";

/** 新建标签打开受限页（chrome:// / 扩展页 / 商店）：页内侧栏里先切到原生侧边栏再开（navigateAfterNative：同步发消息、等 ack 再建；只在页内上下文起作用）。await 之后的调用点用 gestureAt 按 E8 的 3 s 手势预算降级 */
const createTab = (url: string | undefined, o?: NativeOpts) => safe(Promise.resolve(navigateAfterNative(url, "create", undefined, () => chrome.tabs.create({ url }), o)), "tabs.create"); // patch 07：先切原生，等 ack（最多 500 ms）再建；o.gestureAt = await 之后的调用点按手势预算降级

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

/** 保存截图：下载 + 尽量写剪贴板（原「截图」按钮的逻辑，不变） */
async function saveShot(t: chrome.tabs.Tab, dataUrl: string) {
    const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
    const host = (displayHost(t.url, t.title) || "page").replace(/[^\w.-]+/g, "_");
    await downloadOwn({ url: dataUrl, filename: `Screenshot ${host} ${stamp}.png`, saveAs: false }); // DownloadRename 开启时保住文件名（@utils/ownDownload）
    let copied = false;
    try {
        const blob = await (await fetch(dataUrl)).blob();
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        copied = true;
    } catch { /* 剪贴板需要焦点；下载已完成 */ }
    toast(tr(copied ? "site.shotCopied" : "site.shotSaved"));
}

/** 「Capture the full page」：保持原有逻辑 = captureVisibleTab，只截当前可视区域（不是整页；Arc 用内核 captureFullPage，扩展拿不到，见 capture.md Q4） */
async function screenshot(t: chrome.tabs.Tab) {
    try {
        await saveShot(t, await chrome.tabs.captureVisibleTab(t.windowId, { format: "png" }));
    } catch (e) {
        toast(tr("site.shotFailed"));
        console.warn("[SiteControls] screenshot", (e as Error).message);
    }
}

/** 「Capture a portion of this page」：Capture 插件开着 → 它的 capture.start；否则注入拖框覆盖层 → captureVisibleTab → 裁剪 → 同 saveShot */
async function capturePortion(t: chrome.tabs.Tab) {
    if (commands.get("capture.start")) { if (await runCommand("capture.start") === false) toast(tr("site.shotFailed")); return; }
    try {
        const [r] = await chrome.scripting.executeScript({ target: { tabId: t.id! }, func: pickRegion, args: [pickStyle()] });
        const picked = r?.result;
        if (!picked) return; // Esc / 右键 / 未拖动 = 取消
        const png = await cropShot(await chrome.tabs.captureVisibleTab(t.windowId, { format: "png" }), picked);
        if (!png) return;
        await saveShot(t, png);
    } catch (e) {
        toast(tr("site.shotFailed"));
        console.warn("[SiteControls] capturePortion", (e as Error).message);
    }
}

/** 「Copy URL」：Arc didClickCopyURLButton → FUN_1029a4384：先清理跟踪参数（FUN_100824bd4 = cleanUrlDetailed 的 Arc 默认规则，clean-urls.md），
 *  再走核心复制管线（用户开了 Clean URLs 插件时叠加它的设置），复制 + toast。
 *  toast：有参数被清掉 → “Copied a clean link without trackers”，否则 “Copied Current URL”（选择分支 ⛔ 源码未找到，按 clean-urls.md §4 的 didClean 推断） */
export async function copyCleanUrl(url: string, tabId?: number): Promise<{ ok: boolean; text: string; cleaned: boolean }> {
    const arc = cleanUrlDetailed(url);
    const r = applyUrlTransformsDetailed("copy", arc.url);
    const cleaned = arc.changed || r.changed;
    const ok = await copyText(r.url, tabId);
    // 其它 copy 变换给了自己的 toastKey → 用它；否则 Arc 默认清理改动了网址 → clean 提示；都没有 → “Copied Current URL”
    if (ok) toast(tr(r.changed && r.toastKey ? r.toastKey : arc.changed ? CLEAN_TOAST_KEY : copyToastKey(r)));
    return { ok, text: r.url, cleaned };
}

/** 「Share」：Arc 在鼠标位置弹 NSMenu（FUN_101388638，popUpMenuPositioningItem:atLocation:inView:）。
 *  菜单项：Arc 的「Copy as %@」各项 ⛔（%@ 取值源码未找到，不做）；系统分享 = “Share” → navigator.share（浏览器不支持时灰显）。 */
function shareMenu(at: { x: number; y: number }, url: string, pageTitle: string) {
    const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void>; canShare?: (d: ShareData) => boolean };
    const data: ShareData = { url, ["title"]: pageTitle }; // ShareData.title（分享内容的标题，不是原生 tooltip；写成计算键以免误触 tooltipShadowPlugins 的 title 检查）
    const can = typeof nav.share === "function" && (nav.canShare?.(data) ?? true);
    return openSubMenu(at, [
        { label: tr("site.share"), test: "sc-share-system", disabled: !can, run: () => void nav.share?.(data).catch(() => undefined) /* 预期：用户取消分享面板 */ },
    ], "arc-space-menu");
}

/** 点扩展：弹窗页（已知 / 探测）→ 选项页 → 提示；停用的扩展点按 = 启用 */
async function clickExt(x: chrome.management.ExtensionInfo, tile: HTMLElement, refresh: () => void) {
    const clickedAt = Date.now(); // 手势时间：下面 await openExtensionPopup（可能探测多个候选页，数秒）之后回落到选项页时，超过手势预算就降级不发（patch 07）
    if (!x.enabled) { await chrome.management.setEnabled(x.id, true).catch(() => toast(tr("site.extFailed"))); refresh(); return; }
    const r = tile.getBoundingClientRect();
    const at = { left: window.screenX + r.right + 12, top: window.screenY + Math.max(0, r.top - 40) };
    tile.classList.add("busy");
    const res = await openExtensionPopup(x, at, activeTab()?.id).catch(() => ({ ok: false }) as PopupResult);
    tile.classList.remove("busy");
    if (res.ok) { closeMenus(); return; }
    if (x.optionsUrl) { closeMenus(); void createTab(x.optionsUrl, { gestureAt: clickedAt }); return; } // ⚠ 弹窗探测 > 3 s 时降级：不发，直接开选项页（页内侧栏随之消失，兜底 = 按钮 / 角标）
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
                { label: tr("site.extOptions"), test: "sc-ext-options", disabled: !x.optionsUrl || !x.enabled, run: () => void createTab(x.optionsUrl) },
                { label: tr(x.enabled ? "site.extDisable" : "site.extEnable"), test: "sc-ext-toggle", disabled: !x.mayDisable, run: toggle },
                { label: "", separator: true },
                { label: tr("site.extRefind"), test: "sc-ext-refind", disabled: !!KNOWN_POPUPS[x.id], run: () => forgetPopup(x) },
                { label: tr("site.extDetails"), test: "sc-ext-manage", run: () => void createTab(`chrome://extensions/?id=${x.id}`) },
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
    // Arc ViewState.canShareURL / canCopyURL：计算方式 ⛔ 源码未找到 → 有网址即可
    const canShareURL = !!url, canCopyURL = !!url;
    const atMouse = (e: MouseEvent, b: HTMLElement) => { const r = b.getBoundingClientRect(); return e.detail === 0 ? { x: r.left, y: r.bottom } : { x: e.clientX, y: e.clientY }; };
    /* rel49：顶部 4 个按钮的 tooltip 延迟 0.45s ✅（Arc 自家 hover tooltip 修饰器 FUN_100ddb078，延迟常量 0x3fdccccccccccccd = 0.45，FUN_1013728fc L128–135，spec-answers-0.md Q2）；ArcTooltip 默认值本就是 0.45，这里显式声明只作用于这 4 个按钮（不改全局）。FUN_100ddb078 第二参数 ⛔ 未解码，不加副标题 / 快捷键 */
    const share: HTMLElement = h("button", { type: "button", class: "arc-sc-action", "data-test": "sc-share", "data-tip": tr("site.share"), "data-tip-delay": "0.45", disabled: !canShareURL, onclick: (e: MouseEvent) => { e.stopPropagation(); shareMenu(atMouse(e, share), url, t.title ?? ""); } }, icon("shareUp", 16));
    const top = h("div", { class: "arc-sc-top", "data-test": "sc-top" },
        share,
        h("button", { type: "button", class: "arc-sc-action", "data-test": "sc-copy", "data-tip": tr("site.copyUrl"), "data-tip-delay": "0.45", disabled: !canCopyURL, onclick: () => { closeMenus(); void copyCleanUrl(url, t.id); } }, icon("link", 17)),
        h("button", { type: "button", class: "arc-sc-action", "data-test": "sc-capture", "data-tip": tr("site.capturePortion"), "data-tip-delay": "0.45", onclick: () => { closeMenus(); void capturePortion(t); } }, icon("cameraRegular", 16)),
        h("button", { type: "button", class: "arc-sc-action", "data-test": "sc-shot", "data-tip": tr("site.captureFullPage"), "data-tip-delay": "0.45", onclick: () => { closeMenus(); void screenshot(t); } }, icon("photo", 19)));

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
            h("button", { type: "button", class: "arc-sc-ext arc-sc-add", "data-test": "sc-add", "data-tip": tr("site.addExtension"), onclick: () => void createTab(WEB_STORE) }, icon("plus", 13))); // SF plus 13pt Semibold（SiteControlCenterExtensionsView @0x101378d78，ionicons-to-arc.md L18）
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
                { label: tr("site.manageExtensions"), test: "sc-manageExt", run: () => void createTab("chrome://extensions") },
                { label: tr("site.addExtension"), test: "sc-addExt", run: () => void createTab(WEB_STORE) },
                { label: "", separator: true },
                { label: tr("site.allSettings"), test: "sc-allSettings", run: () => void createTab(web ? `chrome://settings/content/siteDetails?site=${encodeURIComponent(origin)}` : "chrome://settings/content") },
            ], "arc-space-menu", false);
        },
    }, icon("more", 16));
    const bottom = h("div", { class: "arc-sc-bottom" },
        web ? h("button", {
            type: "button", class: `arc-sc-secure${secure ? "" : " insecure"}`, "data-test": "sc-secure",
            "data-tip": displayUrl(origin), onclick: () => void createTab(`chrome://settings/content/siteDetails?site=${encodeURIComponent(origin)}`),
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

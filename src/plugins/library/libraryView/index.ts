/*
 * Library（§13）：归档 / 下载 / Spaces 一览。Arc 中 Library 是 macOS 独有，
 * 但实现简单且 Windows 也有下载 / 归档入口，所以作为跨平台插件提供。
 */
import { displayUrl } from "@api/displayUrl";
import { libLottieIcon, type LibIcon } from "./libIcons";
import { searchPlaceholder } from "./searchPlaceholder";
import "@components/ArcTooltip";
import { librarySections } from "@api/Slots";
import { iconText, spaceIconNode } from "@api/spaceIcons";
import { closeOverlay, toast, copyUrlWithToast } from "@api/PanelShell";
import { openMenu } from "@components/Menu";
import { recordStoreUndo } from "@api/Undo";
import { tr } from "@api/i18n";
import { folderGlyph, icon } from "@api/icons";
import { h } from "@api/dom";
import { safe } from "@api/ErrorLog";
import { addOverlay, addSection, openOverlay, refresh } from "@api/Slots";
import { faviconUrl } from "@utils/misc";
import { isPluginEnabled } from "@api/PluginManager";
import { call } from "@api/RPC";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { definePluginSettings } from "@api/Settings";
import { archiveStore } from "@plugins/tabs/archive";
import { spacesStore } from "@plugins/spaces/spaceManager/store";

type Section = "media" | "downloads" | "spaces" | "archive";
const DAY = 86400000;
const startOfDay = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
function dayLabel(t: number) {
    const today = startOfDay(Date.now()), d = startOfDay(t);
    if (d === today) return tr("library.today");
    if (d === today - DAY) return tr("library.yesterday");
    return new Date(t).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric", year: new Date(t).getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
}
const shortUrl = (u: string) => u.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");

/** 归档标签（Arc：搜索框 + Filter「Where was the tab? / How was the tab closed?」；启用过滤显示 “Remove … Filter” 胶囊；
 * 分组 Today / Yesterday / Earlier This Week / 日期；hover 出现 Restore + Delete，右键菜单同样两项） */
let archFilter: { space?: string; reason?: "auto" | "closed" } = {};
let archSel: string | undefined;
export function groupLabel(t: number, now = Date.now()) {
    const today = startOfDay(now), d = startOfDay(t);
    if (d === today) return tr("library.today");
    if (d === today - DAY) return tr("library.yesterday");
    const wk = new Date(today); wk.setDate(wk.getDate() - ((wk.getDay() + 6) % 7));
    if (d >= wk.getTime()) return tr("library.earlierWeek");
    return dayLabel(t);
}
function renderArchive(box: HTMLElement) {
    const q = h("input", { class: "arc-input arc-lib-search", type: "search", placeholder: searchPlaceholder(tr("library.pageArchive")), "data-test": "lib-search", oninput: () => draw() }) as HTMLInputElement;
    const fbtn = h("button", { class: "arc-lib-filter", "data-test": "lib-filter", "data-tip": tr("library.filterTitle"), onclick: (e: MouseEvent) => {
        e.stopPropagation();
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        openMenu({ x: r.right - 220, y: r.bottom + 4 }, [
            { label: tr("library.filterTitle"), disabled: true }, // 菜单标题 "Filter Archived Tabs"
            { label: "", separator: true },
            { label: tr("library.whereTab"), disabled: true },
            { label: tr("library.allSpaces"), checked: !archFilter.space, test: "space:all", run: () => { archFilter.space = undefined; draw(); } },
            ...spacesStore.get().spaces.map(s => ({ label: `${iconText(s.icon)} ${s.name}`, checked: archFilter.space === s.id, test: `space:${s.id}`, run: () => { archFilter.space = s.id; draw(); } })),
            // ⛔ Little Arc：本扩展没有 Little Arc，归档记录也没有来源窗口类型，不提供该项
            { label: "", separator: true },
            { label: tr("library.howClosed"), disabled: true },
            { label: tr("library.autoClosed"), checked: archFilter.reason === "auto", test: "reason:auto", run: () => { archFilter.reason = archFilter.reason === "auto" ? undefined : "auto"; draw(); } },
            { label: tr("library.manualClosed"), checked: archFilter.reason === "closed", test: "reason:closed", run: () => { archFilter.reason = archFilter.reason === "closed" ? undefined : "closed"; draw(); } },
            // Arc 的 Filter 菜单没有 "Clear archive"（Cat 定：删除）
        ]);
    } }, icon("filter", 15) /* SF line.3.horizontal.decrease.circle，frame 15×15 */, h("span", null, tr("library.filter")));
    const pills = h("div", { class: "arc-lib-pills" });
    const list = h("div", { class: "arc-lib-list" });
    // 滚动中 .scrolling（TabCell isScrolling），停止 150ms 后移除（延迟 ⛔）
    let scrollT: ReturnType<typeof setTimeout> | undefined;
    list.addEventListener("scroll", () => { list.classList.add("scrolling"); clearTimeout(scrollT); scrollT = setTimeout(() => list.classList.remove("scrolling"), 150); }, { passive: true });
    const select = (row: HTMLElement, id: string) => { archSel = id; for (const r of Array.from(list.querySelectorAll(".arc-lib-row.current"))) if (r !== row) r.classList.remove("current"); row.classList.add("current"); };
    const del = (id: string) => { recordStoreUndo(tr("common.delete"), archiveStore); void archiveStore.update(x => { x.items = x.items.filter(i => i.id !== id); }); };
    const draw = () => {
        const s = q.value.toLowerCase();
        fbtn.classList.toggle("on", !!archFilter.reason || !!archFilter.space);
        const sp = archFilter.space ? spacesStore.get().spaces.find(x => x.id === archFilter.space) : undefined;
        const pill = (name: string, clear: () => void) => h("button", { class: "arc-lib-pill", "data-test": "lib-pill", onclick: () => { clear(); draw(); } }, icon("xmarkCircleFill", 14), h("span", null, tr("library.removeFilter", name)));
        pills.replaceChildren(...[
            sp ? pill(sp.name, () => { archFilter.space = undefined; }) : null,
            archFilter.reason ? pill(tr(archFilter.reason === "auto" ? "library.autoClosed" : "library.manualClosed"), () => { archFilter.reason = undefined; }) : null,
        ].filter(x => x !== null) as Node[]);
        const items = archiveStore.get().items
            .filter(i => (i.title + i.url).toLowerCase().includes(s) && (!archFilter.space || i.spaceId === archFilter.space) && (!archFilter.reason || i.reason === archFilter.reason))
            .toSorted((a, b) => b.closedAt - a.closedAt).slice(0, 400);
        const out: Node[] = [];
        let cur = "";
        for (const i of items) {
            const g = groupLabel(i.closedAt);
            if (g !== cur) { cur = g; out.push(h("div", { class: "arc-lib-group" }, g)); }
            const restore = () => void call<string | null>("archive:restore", i.id).then(name => { if (name) toast(tr("archive.restoredTo", name)); });
            out.push(h("div", {
                class: `arc-lib-row${i.id === archSel ? " current" : ""}`, "data-tip": i.title || null, role: "button", tabindex: "0", "data-test": "lib-row", "data-id": i.id,
                // 单击 = 只选中（.current，显示 Restore / Delete；TabCell isSelected，Cat 决定）；恢复只走 Restore 按钮 / 右键菜单；双击恢复 ⛔ 不做
                onclick: (e: MouseEvent) => select(e.currentTarget as HTMLElement, i.id),
                onfocus: (e: FocusEvent) => select(e.currentTarget as HTMLElement, i.id),
                oncontextmenu: (e: MouseEvent) => { e.preventDefault(); openMenu({ x: e.clientX, y: e.clientY }, [{ label: tr("common.restore"), test: "ctx-restore", run: restore }, { label: tr("common.delete"), danger: true, test: "ctx-delete", run: () => del(i.id) }]); },
            },
                // 归档的文件夹（「菜单定案」§3）：文件夹图标，Restore = Put back 整个文件夹（含子项）
                i.folder ? h("span", { class: "arc-lib-favbox", "data-test": "lib-folderbox" }, i.folder.customIcon ? spaceIconNode(i.folder.customIcon, 16) : folderGlyph(false, 16)) : favBox(i.url), // 16 = Archive ContentCell imageSize 16×16（archive-page.md:46）；folderGlyph 默认 17 是侧栏文件夹行（ListHeader.folderIconSize）
                h("span", { class: "arc-lib-text" }, h("span", { class: "arc-lib-title" }, i.title || shortUrl(i.url)), h("span", { class: "arc-lib-url" }, i.folder ? "" : displayUrl(i.url, "domain"))),
                // 右侧 accessory（FUN_10270a498）：HStack spacing 2，显示时宽 66 / 高 32，悬停出现（样式见 library/style.ts .arc-lib-acts）
                h("span", { class: "arc-lib-acts" },
                    h("button", { class: "arc-icon-btn arc-lib-act", "data-tip": tr("common.delete"), "aria-label": tr("common.delete"), "data-test": "lib-delete", onclick: (e: MouseEvent) => { e.stopPropagation(); del(i.id); } }, icon("trash", 14)), // SF trash 14pt medium（more-button-icon.md §5）
                    h("button", { class: "arc-icon-btn arc-lib-act", "data-tip": tr("common.restore"), "aria-label": tr("common.restore"), "data-test": "lib-restore", onclick: (e: MouseEvent) => { e.stopPropagation(); restore(); } }, icon("undo", 14)) /* SF arrow.uturn.left 14pt medium（§5） */)));
        }
        list.replaceChildren(...out);
        if (!items.length) list.append(s ? h("div", { class: "arc-hint" }, tr("library.noResults", q.value))
            : h("div", { class: "arc-lib-empty", "data-test": "lib-empty" }, h("b", null, tr("library.nothingYet")), h("span", null, tr("library.nothingYetSub"))));
    };
    box.append(h("div", { class: "arc-lib-top" }, h("span", { class: "arc-lib-searchwrap" }, icon("search", 14), q), fbtn), pills, list);
    draw();
    return archiveStore.subscribe(draw);
}

/* Arc 归档 / 下载行的图标：24×24 圆角 6 的方块里放真实 favicon；没有 favicon（浏览器回落成默认地球）时只留空方块 */
let defaultFav: Promise<string> | undefined;
const favSig = (src: string) => new Promise<string>(res => { const im = new Image(); im.onload = () => { try { const c = document.createElement("canvas"); c.width = c.height = 16; const x = c.getContext("2d")!; x.drawImage(im, 0, 0, 16, 16); res(c.toDataURL()); } catch { res(""); } }; im.onerror = () => res(""); im.src = src; });
export function favBox(url: string) {
    const box = h("span", { class: "arc-lib-favbox", "data-test": "lib-favbox" });
    // .no-fav：确认没有 favicon（无地址 / 加载失败 / 只是浏览器默认地球）才加，加载中不加，占位不会闪一下（样式在 library/style.ts）
    const src = faviconUrl(url); if (!src) { box.classList.add("no-fav"); return box; }
    defaultFav ??= favSig(faviconUrl("https://arc-no-favicon.invalid/"));
    void Promise.all([defaultFav, favSig(src)]).then(([def, sig]) => { if (sig && sig !== def) box.append(h("img", { class: "arc-fav", src, alt: "", onerror: () => box.classList.add("no-fav") })); else box.classList.add("no-fav"); });
    return box;
}

function dlRow(d: chrome.downloads.DownloadItem) {
    const name = d.filename.split(/[\\/]/).pop() || d.url;
    const img = h("span", { class: "arc-lib-favbox" }) as HTMLElement;
    void chrome.downloads.getFileIcon(d.id, { size: 32 }).then(u => { if (u) img.append(h("img", { class: "arc-fav", src: u, alt: "" })); else img.replaceWith(favBox(d.finalUrl || d.url)); }).catch(() => img.replaceWith(favBox(d.finalUrl || d.url)));
    const gone = d.state === "complete" && d.exists === false;
    const sub = gone ? tr("library.fileGone") : d.state === "in_progress" ? `${Math.round(100 * d.bytesReceived / Math.max(1, d.totalBytes))}%` : d.state === "complete" ? `${new Date(d.startTime).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })} · ${shortUrl(d.finalUrl || d.url).split("/")[0]}` : tr(`library.dl.${d.state}` as never) || d.state;
    const menu = (e: MouseEvent) => { e.preventDefault(); openMenu({ x: e.clientX, y: e.clientY }, [
        ...(d.state === "complete" && !gone ? [{ label: tr("library.showInFolder"), test: "dl-show", run: () => chrome.downloads.show(d.id) }] : []),
        { label: tr("library.copyUrl"), test: "dl-copy", run: () => void copyUrlWithToast(d.finalUrl || d.url) },
        ...(d.state === "in_progress" ? [{ label: tr("common.cancel"), run: () => void safe(chrome.downloads.cancel(d.id), "library.download.cancel (context menu)") }] : []),
        { label: tr("common.delete"), danger: true, test: "dl-delete", run: () => void (gone || d.state !== "complete" ? chrome.downloads.erase({ id: d.id }) : chrome.downloads.removeFile(d.id).then(() => chrome.downloads.erase({ id: d.id }))).catch(() => toast(tr("library.trashFailed"))) },
    ]); };
    return h("div", { class: `arc-lib-row${gone ? " gone" : ""}`, "data-tip": d.filename, role: "button", tabindex: "0", "data-test": "dl-row", oncontextmenu: menu, onclick: () => { if (d.state === "complete" && !gone) void safe(chrome.downloads.open(d.id), "library.download.open (row click)"); } },
        img, h("span", { class: "arc-lib-text" }, h("span", { class: "arc-lib-title" }, name), h("span", { class: "arc-lib-url" }, sub)),
        h("span", { class: "arc-lib-acts" },
            d.state === "complete" ? h("button", { class: "arc-icon-btn arc-lib-act", "data-tip": tr("library.showInFolder"), onclick: (e: MouseEvent) => { e.stopPropagation(); chrome.downloads.show(d.id); } }, icon("folder", 14)) : null,
            d.state === "in_progress" ? h("button", { class: "arc-icon-btn arc-lib-act", "data-tip": tr("common.cancel"), onclick: (e: MouseEvent) => { e.stopPropagation(); void safe(chrome.downloads.cancel(d.id), "library.download.cancel (row button)"); } }, icon("x", 14)) : null));
}

/** 下载 / 媒体（媒体 = 图片、视频、音频类下载，同 Arc Library 的 Media） */
function renderDownloads(box: HTMLElement, media = false) {
    const list = h("div", { class: "arc-lib-list" });
    const draw = async () => {
        let items = await chrome.downloads.search({ limit: media ? 300 : 100, orderBy: ["-startTime"] });
        if (media) items = items.filter(d => /^(image|video|audio)\//.test(d.mime) || /\.(png|jpe?g|gif|webp|heic|svg|mp4|mov|webm|mp3|m4a|wav)$/i.test(d.filename)).slice(0, 100);
        const out: Node[] = [];
        let cur = "";
        for (const d of items) { const g = dayLabel(new Date(d.startTime).getTime()); if (g !== cur) { cur = g; out.push(h("div", { class: "arc-lib-group" }, g)); } out.push(dlRow(d)); }
        list.replaceChildren(...out);
        if (!items.length) list.append(h("div", { class: "arc-hint" }, media ? tr("library.noMedia") : tr("library.noDownloadsArc")));
    };
    void draw();
    const t = setInterval(draw, 2000);
    box.append(h("div", { class: "arc-lib-top" }, h("span", { class: "arc-lib-heading" }, media ? tr("library.media") : tr("library.downloads"))), list);
    return () => clearInterval(t);
}

function renderSpaces(box: HTMLElement) {
    const draw = () => {
        const d = spacesStore.get();
        list.replaceChildren(...d.spaces.map(s => h("div", { class: `arc-lib-row${s.id === d.activeId ? " current" : ""}`, role: "button", tabindex: "0", "data-test": "lib-space", onclick: () => void call("spaces:switch", s.id).then(() => closeOverlay()) },
            h("span", { class: "arc-lib-space-ic", style: s.color ? `--sc:${s.color}` : undefined }, spaceIconNode(s.icon, 14)),
            h("span", { class: "arc-lib-text" }, h("span", { class: "arc-lib-title" }, s.name), h("span", { class: "arc-lib-url" }, s.id === d.activeId ? tr("library.current") : tr("library.tabsIn", Object.values(d.tabSpace).filter(x => x === s.id).length))))));
    };
    const list = h("div", { class: "arc-lib-list" });
    box.append(h("div", { class: "arc-lib-top" }, h("span", { class: "arc-lib-heading" }, tr("plugin.spaces.label"))), list);
    draw();
    return spacesStore.subscribe(draw);
}

let lastSection: Section = "archive";
function render(box: HTMLElement, arg: unknown) {
    let cleanup: (() => void) | void;
    const pane = h("div", { class: "arc-lib-pane" });
    const secs: [Section, string, Parameters<typeof icon>[0], (b: HTMLElement) => (() => void) | void][] = [
        ["media", tr("library.media"), "image", b => renderDownloads(b, true)],
        ["downloads", tr("library.downloads"), "downloadBox", b => renderDownloads(b)],
        ["spaces", tr("plugin.spaces.label"), "spaces", renderSpaces],
        ...(isPluginEnabled("Archive") ? [["archive", tr("library.archivedTabs"), "archive", renderArchive] as [Section, string, Parameters<typeof icon>[0], typeof renderArchive]] : []),
    ];
    // 插件注册的分类（@api/Slots addLibrarySection）按 order 并入（内置 media 10 / downloads 20 / spaces 30 / archive 40）
    const BUILTIN_ORDER: Record<string, number> = { media: 10, downloads: 20, spaces: 30, archive: 40 };
    const extra = librarySections.sorted().map(([id, d]) => [id as Section, d.label, d.icon, (b: HTMLElement) => d.render(b), d.order ?? 15] as const);
    secs.splice(0, secs.length, ...[...secs.map(x => [...x, BUILTIN_ORDER[x[0]] ?? 50] as const), ...extra].toSorted((a, b) => a[4] - b[4]).map(x => [x[0], x[1], x[2], x[3]] as (typeof secs)[number]));
    const lotties = new Map<string, LibIcon>();
    const rail = h("nav", { class: "arc-lib-rail", "aria-label": tr("plugin.library.label") });
    const show = (id: Section) => {
        cleanup?.();
        pane.replaceChildren();
        const s = secs.find(x => x[0] === id) ?? secs.at(-1)!;
        lastSection = s[0]; if (s[0] !== "archive" && s[0] !== "spaces") newDl = false;
        for (const b of Array.from(rail.querySelectorAll<HTMLElement>(".arc-lib-item"))) { const on = b.dataset.id === s[0]; b.classList.toggle("active", on); b.setAttribute("aria-current", on ? "page" : "false"); }
        cleanup = s[3](pane);
    };
    rail.append(
        h("div", { class: "arc-lib-items" }, secs.map(([id, label, ic]) => {
            // Arc 原生 Lottie（libIcons.ts）；没有对应文件的插件分类用静态图标
            const lt = libLottieIcon(id); if (lt) lotties.set(id, lt);
            return h("button", { class: "arc-lib-item", "data-id": id, "data-test": `lib-${id}`, onclick: () => { show(id); lotties.get(id)?.play(); } }, h("span", { class: "arc-lib-ic" }, lt ? lt.el : icon(ic, 28)), h("span", { class: "arc-lib-lbl" }, label));
        })),
        h("button", { class: "arc-icon-btn arc-lib-back", "data-tip": tr("library.back"), "aria-label": tr("library.back"), "data-test": "lib-back", onclick: () => closeOverlay() }, icon("arrowLeft")));
    box.classList.add("arc-lib");
    box.append(rail, pane);
    show((arg as Section) ?? lastSection);
    return () => { cleanup?.(); for (const l of lotties.values()) l.destroy(); };
}

/** 底栏 Library 按钮角标：有新完成的下载、且之后还没打开过 Library 时显示（Arc HomeBadging） */
let newDl = false;
const onDlDone = (c: chrome.downloads.DownloadDelta) => { if (c.state?.current === "complete" && !newDl) { newDl = true; refresh(); } };

/** 悬停资料库按钮：最近下载的文件（点击打开，⌥ 点击在文件夹中显示） */
let rfTimer: ReturnType<typeof setTimeout> | undefined;
function recentFiles(el: HTMLElement) {
    if (rfTimer) clearTimeout(rfTimer);
    rfTimer = setTimeout(async () => {
        if (!el.matches(":hover")) return;
        const items = (await chrome.downloads.search({ limit: 8, orderBy: ["-startTime"], state: "complete" })).filter(d => d.exists !== false);
        if (!items.length) return;
        const r = el.getBoundingClientRect();
        openMenu({ x: r.left, y: r.top - 8 - items.length * 30 }, items.map(d => ({ label: d.filename.split(/[\\/]/).pop() || d.url, test: "recent-file", run: () => chrome.downloads.show(d.id) })));
    }, 600);
}

/** 侧边栏底部的下载进度条（同 Arc 的下载提示）：仅在有进行中的下载时出现，点击打开下载列表 */
function downloadsTray() {
    let active: chrome.downloads.DownloadItem[] = [];
    let timer: ReturnType<typeof setInterval> | undefined;
    const poll = async () => {
        const next = await chrome.downloads.search({ state: "in_progress" });
        const changed = next.length !== active.length || next.some((d, i) => d.bytesReceived !== active[i]?.bytesReceived);
        active = next;
        if (!active.length && timer) { clearInterval(timer); timer = undefined; }
        else if (active.length && !timer) timer = setInterval(() => void poll(), 1000);
        if (changed) refresh();
    };
    const onEv = () => void poll();
    chrome.downloads.onCreated.addListener(onEv);
    chrome.downloads.onChanged.addListener(onEv);
    void poll();
    const pct = (d: chrome.downloads.DownloadItem) => d.totalBytes > 0 ? Math.round(d.bytesReceived / d.totalBytes * 100) : 0;
    return [
        () => { chrome.downloads.onCreated.removeListener(onEv); chrome.downloads.onChanged.removeListener(onEv); if (timer) clearInterval(timer); },
        addSection("footer", "LibraryView", {
            order: 5,
            render(el) {
                if (!active.length) return;
                const d = active[0];
                const name = (d.filename.split(/[\\/]/).pop() || d.url).slice(0, 80);
                el.append(h("div", { class: "arc-dl", "data-test": "downloads-tray", "data-tip": tr("library.cmdDownloads"), onclick: () => openOverlay("library", "downloads") },
                    h("div", { class: "arc-list-row" }, icon("arrowDown"),
                        h("span", { class: "arc-tab-title" }, active.length > 1 ? tr("library.downloadingN", active.length) : name),
                        h("small", null, d.totalBytes > 0 ? `${pct(d)}%` : "…")),
                    h("div", { class: "arc-dl-bar" }, h("i", { style: `width:${pct(d)}%` }))));
            },
        }),
    ];
}


/* ARCUI BoxOfThingsIcon（library-boxofthings.md）：ZStack 居中叠放 glow / star（矩形遮罩）/ triangle / circle / box。
 * 每层 = 外层 <i>（变换 + 阴影）包内层 <b>（模板 PNG 遮罩，按钮前景色）。数值见 sidepanel.css。 */
function boxOfThings() {
    const L = (c: string) => h("i", { class: c }, h("b"));
    return h("span", { class: "arc-boxthings", "aria-hidden": "true", "data-test": "boxthings" },
        L("g"), h("i", { class: "sm" }, L("s")), L("t"), L("c"), L("b"));
}
/* hover 序列（FUN_100ae94a4）：写 hover + 切换 tw1；0.15s 后再切 tw1 并切 tw2；0.3s 后切 tw2。
 * 进入序列的条件分支（param_2 bit0）⛔ 源码未找到 → 只在进入 hover 时跑 */
function boxHover(btn: HTMLElement, on: boolean) {
    const box = btn.querySelector<HTMLElement>(".arc-boxthings"); if (!box) return;
    box.classList.toggle("hover", on);
    if (!on) return;
    const tg = (c: string) => box.classList.toggle(c);
    tg("tw1");
    setTimeout(() => { tg("tw1"); tg("tw2"); }, 150);
    setTimeout(() => tg("tw2"), 300);
}
/* 审计 52193 多出项 #4：Library 按钮新下载角标圆点（强调色）Arc 没有 → 默认关闭。开关只管圆点；有徽标时按钮放大 1.2× 是 Arc 原生（sidebar-features.md:359），常开、不受此开关控制。
 * 开关写到 <html data-lib-badge>，样式在 static/sidepanel.css（:root[data-lib-badge] .arc-lib-btn.badged::after）。 */
const settings = definePluginSettings({
    libBadge: { type: OptionType.BOOLEAN, default: false, description: "library.badgeSetting" },
});
const syncBadgeAttr = () => { if (typeof document !== "undefined") document.documentElement.toggleAttribute("data-lib-badge", !!settings.store.libBadge); };

export default definePlugin({
    name: "LibraryView",
    authors: [Devs.ArcSidebar],
    label: "plugin.libraryView.label",
    description: "plugin.libraryView.desc",
    tags: ["library"],
    enabledByDefault: true,
    settings,
    onSettingsChange: syncBadgeAttr,
    commands: [
        { id: "library.open", label: "library.cmdOpen", keywords: ["library"], context: "panel", defaultKey: "Mod+Shift+L", run: () => openOverlay("library") },
        { id: "library.archive", label: "library.cmdArchive", keywords: ["view archive"], context: "panel", run: () => openOverlay("library", "archive") },
        { id: "library.downloads", label: "library.cmdDownloads", keywords: ["downloads"], context: "panel", defaultKey: "Mod+Shift+J", run: () => openOverlay("library", "downloads") },
    ],
    panel: {
        start: () => [
            (syncBadgeAttr(), () => document.documentElement.removeAttribute("data-lib-badge")),
            addOverlay("library", "Library", { title: tr("plugin.library.label"), render, page: true }),
            addSection("bottom", "Library", { order: 0, render: el => { el.append(h("button", { class: `arc-icon-btn arc-lib-btn${newDl ? " badged" : ""}`, "data-tip": tr("plugin.library.label"), onclick: () => { newDl = false; openOverlay("library"); refresh(); }, onmouseenter: (e: MouseEvent) => { boxHover(e.currentTarget as HTMLElement, true); recentFiles(e.currentTarget as HTMLElement); }, onmouseleave: (e: MouseEvent) => boxHover(e.currentTarget as HTMLElement, false), "data-test": "library-btn" }, boxOfThings())); } }), // ARCUI BoxOfThingsIcon（bottom-bar.md §7.1）
            ...downloadsTray(),
            (chrome.downloads.onChanged.addListener(onDlDone), () => chrome.downloads.onChanged.removeListener(onDlDone)),
        ],
    },
});

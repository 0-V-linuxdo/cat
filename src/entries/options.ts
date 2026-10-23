/*
 * 完整设置页（MV3 options_ui，open_in_tab）——结构照 Void++（0-V-linuxdo/VoidPP dev 分支）PluginsTab / PluginCard / PluginDialog：
 * 每个分组恰好是一个插件：插件页 = 搜索 / 启用筛选条 + 两列插件卡片（名称、必需标记、两行描述、配置按钮、开关；底部作者），
 * 必需插件（标签 / 空间 / 命令）变淡、无开关，排在分隔线之后。「配置」打开模态对话框：作者 + 按功能分节的设置
 * （可选功能 = 节内开关，子设置缩进、关闭时隐藏）+ 恢复默认（需确认）。数据插件的对话框另有「导出 / 导入」操作行。
 * 通用页 = 界面语言 + 版本。改动即时保存（同 Void++），需要重载的改动显示提示条。
 */
import { arcConfirm } from "@components/Dialog";
import { tr } from "@api/i18n";
import { h } from "@api/dom";
import "@components/ArcTooltip";
import { subscribe } from "@api/Events";
import { icon } from "@api/icons";
import { isPluginEnabled, plugins } from "@api/PluginManager";
import { resetPluginSettings } from "@api/Settings";
import { Dropdown } from "@components/Menu";
import { toggleWithFeedback } from "@components/settings/PluginCard";
import { hasVisibleSettings, SettingFields } from "@components/settings/SettingField";
import { label, listedPlugins, PLUGIN_CATEGORY_TABS, type ListFilter } from "@components/settings/utils";
import { dump, restore } from "@plugins/data/backup";
import { bootstrap } from "@src/ArcSidebar";
import type { Plugin } from "@utils/types";

const app = document.getElementById("app")!;
type PageId = "plugins" | "general";
let selected: PageId = new URLSearchParams(location.hash.slice(1)).get("page") === "general" ? "general" : "plugins";
let query = "";
let filter: ListFilter = "all";
let needsReload = false;

function toast(msg: string) {
    const t = h("div", { class: "arc-toast", role: "status" }, msg);
    t.addEventListener("click", () => t.remove());
    document.body.append(t);
    setTimeout(() => t.remove(), 5000); // toast-spec.md：停留 5s
}

const ORDER = PLUGIN_CATEGORY_TABS.map(t => t.id as string);
const tagOf = (p: Plugin) => (p.tags ?? []).find(t => ORDER.includes(t)) ?? "";
/** 插件列表 = 6 个分组插件（按 标签 / 空间 / 命令 / 视图 / 资料库 / 数据 排序） */
const groupPlugins = () => listedPlugins().toSorted((a, b) => ORDER.indexOf(tagOf(a)) - ORDER.indexOf(tagOf(b)));
function authorsOf(x: { authors?: readonly unknown[] }) { return (x.authors ?? []).map(a => typeof a === "string" ? a : (a as { name?: string }).name ?? "").join(", "); }
const featureNames = (p: Plugin) => (p.features ?? []).map(f => label(f as Plugin));
const iconOf = (p: Plugin) => PLUGIN_CATEGORY_TABS.find(t => t.id === tagOf(p))?.icon ?? "plugin";

function card(p: Plugin) {
    const on = isPluginEnabled(p.name);
    const feats = featureNames(p);
    return h("article", { class: `arc-vcard${p.required ? " required" : ""}${on ? "" : " off"}`, "data-plugin": p.name, "data-card": p.name },
        h("div", { class: "arc-vcard-body" },
            h("div", { class: "arc-vcard-head" },
                h("span", { class: "arc-vcard-icon" }, icon(iconOf(p), 14)),
                h("span", { class: "arc-vcard-name" },
                    h("span", { class: "arc-vcard-title" }, label(p)),
                    // 必需插件标记：原来用 icon("alert")，换成 Arc 资源后变成 ⚠ 警告三角，被误读为错误 → 改为文字徽标
                    p.required ? h("span", { class: "arc-vcard-req", "data-test": "req-badge", "data-tip": tr("settings.requiredReason") }, tr("settings.required")) : null),
                h("span", { class: "arc-vcard-controls" },
                    hasVisibleSettings(p) || tagOf(p) === "data" ? h("button", { class: "arc-icon-btn arc-vcard-cfg", "data-tip": tr("settings.configure"), "aria-label": `${tr("settings.configure")} ${label(p)}`, "data-config": p.name, onclick: () => openDialog(p) }, icon("sliders", 14)) : null,
                    p.required ? null : h("label", { class: "arc-toggle", "data-tip": label(p) }, h("input", { type: "checkbox", checked: on, "data-test": `plugin:${p.name}`, onchange: () => void toggleWithFeedback(p, { onChange: draw, onMessage: toast }) }), h("span", { class: "arc-toggle-track" })))),
            h("div", { class: "arc-vcard-desc" }, tr(p.description ?? ""))),
        h("div", { class: "arc-vcard-foot", "data-tip": feats.join(" · ") }, feats.length ? feats.join(" · ") : authorsOf(p) || "\u00A0"));
}

function actionRow(title: string, detail: string, btn: string, onclick: () => void, test: string) {
    return h("div", { class: "arc-opt-action" },
        h("div", { class: "arc-setting-text" }, h("span", { class: "arc-setting-title" }, title), h("span", { class: "arc-setting-desc" }, detail)),
        h("button", { class: "arc-btn", onclick, "data-test": test }, btn));
}
const fileIn = h("input", { type: "file", accept: "application/json", style: "display:none" }) as HTMLInputElement;
fileIn.addEventListener("change", async () => {
    const f = fileIn.files?.[0];
    if (!f) return;
    try { if (await arcConfirm(tr("data.importConfirm"))) await restore(JSON.parse(await f.text())); } catch (e) { toast(tr("data.importFailed", String(e))); }
    fileIn.value = "";
});
const exportJson = async () => {
    const blob = new Blob([JSON.stringify(await dump(), null, 2)], { type: "application/json" });
    h("a", { href: URL.createObjectURL(blob), download: `cat-backup-${Date.now()}.json` }).click();
};

/** Void++ PluginDialog：标题 + 副标题、作者、按功能分节的设置、底部「恢复默认」（确认） */
function openDialog(p: Plugin) {
    document.querySelector(".arc-vdialog-scrim")?.remove();
    const list = SettingFields(p, toast);
    const reset = async () => {
        if (!(await arcConfirm(tr("settings.resetConfirm", label(p)), { danger: true }))) return;
        resetPluginSettings(p.name);
        toast(tr("settings.resetDone")); openDialog(p);
    };
    const scrim = h("div", { class: "arc-vdialog-scrim", "data-test": "plugin-dialog", onpointerdown: (e: PointerEvent) => { if (e.target === scrim) closeDialog(); } },
        h("div", { class: "arc-vdialog", role: "dialog", "aria-modal": "true", "aria-label": label(p) },
            h("header", { class: "arc-vdialog-head" },
                h("div", null, h("div", { class: "arc-vdialog-title" }, label(p)), h("div", { class: "arc-vdialog-sub" }, tr(p.description ?? ""))),
                h("button", { class: "arc-icon-btn", "data-tip": tr("common.close"), "aria-label": tr("common.close"), onclick: closeDialog }, icon("x", 14))),
            authorsOf(p) ? h("section", { class: "arc-vdialog-field" }, h("div", { class: "arc-vdialog-label" }, tr("settings.authors")), h("div", null, authorsOf(p))) : null,
            tagOf(p) === "data" ? h("section", { class: "arc-vdialog-field" }, h("div", { class: "arc-vdialog-label" }, tr("data.backup")),
                h("div", { class: "arc-opt-card arc-opt-actions" },
                    actionRow(tr("data.exportEllipsis").replace(/…$/, ""), tr("data.exportDesc"), tr("data.export"), () => void exportJson(), "export"),
                    actionRow(tr("data.importEllipsis").replace(/…$/, ""), tr("data.importDesc"), tr("data.import"), () => fileIn.click(), "import"), fileIn)) : null,
            h("section", { class: "arc-vdialog-field arc-vdialog-settings" }, h("div", { class: "arc-vdialog-label" }, tr("settings.settings")), list ?? h("div", { class: "arc-hint" }, tr("settings.noSettings"))),
            list ? h("footer", { class: "arc-vdialog-foot" }, h("button", { class: "arc-btn arc-btn-quiet", onclick: reset, "data-test": `reset:${p.name}` }, tr("settings.reset"))) : null));
    document.body.append(scrim);
    (scrim.querySelector<HTMLElement>(".arc-vdialog-settings input, .arc-vdialog-settings button") ?? scrim.querySelector<HTMLElement>("button"))?.focus();
}
function closeDialog() { document.querySelector(".arc-vdialog-scrim")?.remove(); draw(); }
addEventListener("keydown", (e: Event) => { if ((e as KeyboardEvent).key === "Escape" && document.querySelector(".arc-vdialog-scrim") && !document.querySelector(".arc-menu:not([hidden])")) closeDialog(); });

const listBox = h("div", { class: "arc-opt-list" });
function drawList() {
    const match = (p: Plugin) => (!query || `${label(p)} ${tr(p.description ?? "")} ${featureNames(p).join(" ")} ${Object.values(p.settings?.def ?? {}).map(d => tr(d.description)).join(" ")}`.toLowerCase().includes(query))
        && (filter === "all" || isPluginEnabled(p.name) === (filter === "enabled"));
    const all = groupPlugins().filter(match);
    const user = all.filter(p => !p.required), req = all.filter(p => p.required);
    listBox.replaceChildren(...[
        user.length ? h("div", { class: "arc-opt-grid" }, user.map(card)) : null,
        user.length && req.length ? h("hr", { class: "arc-opt-sep" }) : null,
        req.length ? h("div", { class: "arc-opt-grid" }, req.map(card)) : null,
        all.length ? null : h("div", { class: "arc-hint" }, tr("settings.noMatch"))].filter(Boolean) as Node[]);
}

function filterBar(total: number) {
    const search = h("input", { class: "arc-input arc-opt-search", type: "search", value: query, placeholder: tr("settings.searchPlugins", total), "data-test": "opt-search",
        oninput: () => { query = search.value.trim().toLowerCase(); drawList(); } }) as HTMLInputElement;
    search.addEventListener("keydown", e => { if ((e.altKey || e.metaKey || e.ctrlKey) && e.key.length === 1) e.preventDefault(); });
    const dd = Dropdown({ options: [{ label: tr("common.all"), value: "all" }, { label: tr("settings.filterEnabled"), value: "enabled" }, { label: tr("settings.filterDisabled"), value: "disabled" }], value: filter, onChange: v => { filter = v as ListFilter; drawList(); } });
    dd.dataset.test = "opt-filter";
    return h("div", { class: "arc-opt-filterbar" }, search, dd);
}

function reloadBanner() {
    return needsReload ? h("div", { class: "arc-opt-reload" }, h("span", null, tr("settings.reloadToApply")),
        h("button", { class: "arc-btn", onclick: () => chrome.runtime.reload() }, tr("settings.reloadNow"))) : null;
}

function page() {
    if (selected === "general") {
        return h("section", { class: "arc-opt-page", "data-category-page": "general" },
            reloadBanner(),
            h("h1", null, tr("settings.general")),
            h("p", { class: "arc-opt-lead" }, tr("settings.generalLead")),
            h("div", { class: "arc-opt-card" }, SettingFields(plugins.PluginSettings, toast) ?? ""),
            h("div", { class: "arc-opt-foot" }, tr("settings.footer", VERSION, groupPlugins().length)));
    }
    drawList();
    return h("section", { class: "arc-opt-page", "data-category-page": "plugins" },
        reloadBanner(),
        h("h1", null, tr("settings.plugins")),
        h("p", { class: "arc-opt-lead" }, tr("settings.pluginsLead")),
        filterBar(groupPlugins().length), listBox);
}

function navItem(id: PageId, lbl: string, ic: Parameters<typeof icon>[0]) {
    return h("button", {
        class: `arc-opt-nav-item${id === selected ? " active" : ""}`, "data-nav": id,
        onclick: () => { selected = id; query = ""; filter = "all"; history.replaceState(null, "", `#page=${id}`); draw(); },
    }, icon(ic), h("span", { class: "arc-opt-nav-label" }, lbl));
}

const nav = h("nav", { class: "arc-opt-nav" });
const main = h("main", { class: "arc-opt-main" });
function draw() {
    if (document.querySelector(".arc-vdialog-scrim")) return; // 对话框打开时不重绘底层（避免丢焦点）
    nav.replaceChildren(navItem("plugins", tr("settings.plugins"), "plugin"), navItem("general", tr("settings.general"), "sliders"));
    const scroll = main.scrollTop;
    main.replaceChildren(page());
    main.scrollTop = scroll;
}

void bootstrap("options").then(() => {
    document.title = tr("settings.pageTitle");
    app.append(h("aside", { class: "arc-opt-side" }, nav), main);
    draw();
    subscribe("settingsChange", draw);
    subscribe("pluginToggle", draw);
    subscribe("refresh", draw);
    subscribe("reloadNeeded", () => { needsReload = true; draw(); });
    document.body.dataset.ready = "1";
});

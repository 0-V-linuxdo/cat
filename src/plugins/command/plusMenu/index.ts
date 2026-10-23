/* “+” 菜单（Arc SidebarPlusButton）：在“+”上方弹出、带指向按钮的小箭头；（“+”→“×”源码没有，已去掉）。
 * 项目 id / 文案 ✅ menus-spec.md §1（FUN_1027c8d18 case 0–9）；快捷键 ✅ 来自主菜单同名动作（FUN_1027cc1dc，arcdl/menu_keys.tsv）。
 * 顺序 / 分组：Rea sidebar-features.md §8.5 L370–377：New Space / New Folder / ── / New Easel / New Note / ── / New Split / New Tab；
 *   Boost 默认不出现（boostsV2Enabled false）；Easel 始终可用，Split 取 splitActionEnabled（同处）。New Note 在 Cat 中无对应功能（不加）。
 * 快捷键（同处）：Easel ⌃⇧E、Note ⌃⇧N、Folder ⇧⌘N、Tab ⌘T、Split ⌃⇧=。（审计 52193 B-06：原注释“顺序取自用户截图”已过时）
 * Easel / Boost 在 Cat 里不存在 → 灰显、点击无效；Split 只有当前是网页时可用；默认高亮 New Tab；↑↓ 移动、Enter 执行、Esc / 点外面关闭（点外面不触发下面的元素）。 */
import { safe } from "@api/ErrorLog";
import { tr } from "@api/i18n";
import { restoreFocus } from "@api/FocusPolicy";
import { plusMenuItems } from "@api/Slots";
import { icon, type IconName } from "@api/icons";
import { commands, keyFor, runCommand } from "@api/Commands";
import { h } from "@api/dom";
import { menuCombo, prettyCombo } from "@api/Keys";
import { addSection } from "@api/Slots";
import "@components/ArcTooltip";
import { swallowOutside } from "@components/Menu";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
import { removePluginSetting } from "@api/Settings";

interface Item { id: string; label: string; icon: IconName; key?: () => string | undefined; cmd?: string; run?: () => unknown; enabled: () => boolean | Promise<boolean>; sepBefore?: boolean; order: number }
const BUILTIN: Item[] = [
    { id: "space", label: "plus.newSpace", icon: "addSpace", cmd: "space.new", enabled: () => !!commands.get("space.new"), order: 10 },
    { id: "folder", label: "plus.newFolder", icon: "folder", cmd: "folder.new", enabled: () => !!commands.get("folder.new"), order: 20 },
    // Boost 不再是内置占位：Boosts 插件通过 @api/Slots addPlusMenuItem 插入
    // 菜单（bottom-bar.md + 协调者决定）：New Space, New Folder | [插件项] | New Split, New Tab；New Easel 隐藏、New Note 不加；New Folder 不显示 / 不绑定 ⇧⌘N（与硬规则冲突，保留差异）
    { id: "split", label: "plus.newSplit", icon: "splitAdd", cmd: "split.new", key: () => keyFor("split.new"), order: 50,
        enabled: async () => { const [t] = await safe(chrome.tabs.query({ active: true, lastFocusedWindow: true }), "plusMenu tabs.query", [] as chrome.tabs.Tab[]); return /^https?:/.test(t?.url ?? ""); } },
    { id: "tab", label: "plus.newTab", icon: "addTab", cmd: "tab.new", key: () => keyFor("tab.new") ?? prettyCombo("Mod+T"), enabled: () => !!commands.get("tab.new"), order: 60 },
];
/** 内置项 + 插件项（同 id 替换，位置 / 分组不变；其余按 order 插入，默认 35） */
function allItems(): Item[] {
    const reg = plusMenuItems.sorted();
    const out: Item[] = BUILTIN.map(b => { const r = plusMenuItems.get(b.id); return r ? { ...b, label: r.label, icon: r.icon, cmd: undefined, key: undefined, run: r.run, enabled: r.enabled ?? (() => true) } : b; });
    for (const [id, r] of reg) if (!BUILTIN.some(b => b.id === id)) out.push({ id, label: r.label, icon: r.icon, run: r.run, enabled: r.enabled ?? (() => true), order: r.order ?? 35 });
    return out.toSorted((a, b) => a.order - b.order);
}

export default definePlugin({
    name: "PlusMenu",
    authors: [Devs.ArcSidebar],
    label: "plugin.plusMenu.label",
    description: "plugin.plusMenu.desc",
    tags: ["command"],
    enabledByDefault: true,
    panel: {
        start: () => (removePluginSetting("PlusMenu", "noteUrl"), addSection("bottom", "PlusMenu", {
            order: 90,
            render(el) {
                const menu = h("div", { class: "arc-menu arc-plus-menu", role: "menu", tabindex: "-1", hidden: true, "data-test": "plus-menu" });
                const btn = h("button", { class: "arc-icon-btn arc-plus-btn", "data-tip": tr("plus.new"), "aria-haspopup": "menu", "aria-expanded": "false", "data-test": "plus-btn" }, icon("plus")) as HTMLButtonElement;
                let rows: HTMLButtonElement[] = [];
                let sel = -1;
                const enabledIdx = () => rows.map((r, i) => r.classList.contains("disabled") ? -1 : i).filter(i => i >= 0);
                // 52005：行底色只在 :hover / :focus-visible（底栏 command/style.ts）。键盘导航把真焦点移到行上，:focus-visible 才画；鼠标悬停只记 sel 不抢焦点
                const highlight = (i: number, focus = true) => { sel = i; rows.forEach((r, k) => r.classList.toggle("sel", k === i)); if (focus) { if (rows[i]) rows[i].focus({ preventScroll: true }); else menu.focus({ preventScroll: true }); } };
                const isOpen = () => !menu.hidden && !menu.classList.contains("closing");
                // 消失 0.07s（bottom-bar.md §7）：先淡出再 hidden；状态（open / aria）立即更新
                const close = () => { if (menu.hidden || menu.classList.contains("closing")) return; btn.classList.remove("open"); btn.setAttribute("aria-expanded", "false"); menu.classList.add("closing"); clearTimeout(closeT); closeT = setTimeout(() => { if (!menu.classList.contains("closing")) return; /* 期间又打开了：不要隐藏 */ menu.hidden = true; menu.classList.remove("closing"); }, 70); };
                let closeT: ReturnType<typeof setTimeout> | undefined;
                let ITEMS: Item[] = [];
                const activate = (i: number) => { const it = ITEMS[i], r = rows[i]; if (!it || !r || r.classList.contains("disabled")) return; close(); if (it.cmd) void runCommand(it.cmd); else void it.run?.(); };
                const open = async (byKeyboard = false) => {
                    clearTimeout(closeT); menu.classList.remove("closing");
                    // 异步取可用状态期间菜单还是 hidden：标 data-opening 让 PanelShell.renderAll 推迟，否则整屏重绘会把这块换新，
                    // 本闭包随后打开的是游离的旧菜单（看不见，↑↓/Enter 也到不了）——自测 st19 的“第二次打开后 Enter 无反应”
                    menu.dataset.opening = "1";
                    try { await fill(byKeyboard); } finally { delete menu.dataset.opening; }
                };
                const fill = async (byKeyboard: boolean) => {
                    // 不支持的项（命令未注册）完全不显示；分组之间一条分隔线，空组不产生分隔线
                    ITEMS = allItems().filter(it => !it.cmd || !!commands.get(it.cmd));
                    const states = await Promise.all(ITEMS.map(async it => { try { return await it.enabled(); } catch { return false; } }));
                    if (!menu.isConnected) return; // 已被换掉：新树里的 ＋ 会接管下一次点击
                    menu.replaceChildren();
                    const groupOf = (o: number) => o < 30 ? 0 : o < 50 ? 1 : 2;
                    rows = ITEMS.map((it, i) => {
                        if (i > 0 && groupOf(ITEMS[i - 1]!.order) !== groupOf(it.order)) menu.append(h("div", { class: "arc-menu-sep", role: "separator" }));
                        const k = it.key?.();
                        const r = h("button", { class: `arc-menu-item arc-plus-item${states[i] ? "" : " disabled"}`, role: "menuitem", "aria-disabled": states[i] ? null : "true", "data-test": `plus-${it.id}`, "data-tip": states[i] ? null : tr("plus.unavailable"), "aria-label": states[i] ? null : tr(it.label) },
                            icon(it.icon, 20), h("span", { class: "arc-menu-label" }, tr(it.label)), k ? h("kbd", { class: "arc-menu-kbd" }, menuCombo(k)) : null) as HTMLButtonElement;
                        r.addEventListener("mouseenter", () => { if (!r.classList.contains("disabled")) highlight(i, false); });
                        r.addEventListener("click", e => { e.stopPropagation(); activate(i); });
                        menu.append(r);
                        return r;
                    });
                    clearTimeout(closeT); menu.classList.remove("closing"); menu.hidden = false; btn.classList.add("open"); btn.setAttribute("aria-expanded", "true"); // “+”→“×”源码没有：不再变换
                    // 鼠标打开：不预选（静止无高亮行），焦点放菜单本身以便接 ↑↓；键盘打开（Enter/Space，click.detail=0）：预选 New Tab 并聚焦
                    const en = enabledIdx(); if (byKeyboard) highlight(en.includes(ITEMS.length - 1) ? ITEMS.length - 1 : en.at(-1) ?? -1); else highlight(-1);
                };
                btn.addEventListener("click", e => { e.stopPropagation(); if (isOpen()) close(); else void open(e.detail === 0); });
                menu.addEventListener("keydown", e => {
                    const en = enabledIdx(); if (!en.length) return;
                    const pos = en.indexOf(sel);
                    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); const d = e.key === "ArrowDown" ? 1 : -1; highlight(pos < 0 ? (d > 0 ? en[0] : en.at(-1)!) : en[(pos + d + en.length) % en.length]); }
                    else if (e.key === "Home") { e.preventDefault(); highlight(en[0]); }
                    else if (e.key === "End") { e.preventDefault(); highlight(en.at(-1)!); }
                    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); activate(sel); }
                    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); restoreFocus(btn); }
                });
                // 鼠标离开菜单：清掉 sel（焦点回菜单本身，不残留高亮）
                menu.addEventListener("mouseleave", () => { if (isOpen() && !rows[sel]?.matches(":focus-visible")) highlight(-1); });
                el.append(h("div", { class: "arc-plus" }, btn, menu));
                const offOutside = swallowOutside(isOpen, t => menu.contains(t) || btn.contains(t), close);
                const outside = (m: { type?: string }) => { if (m?.type === "arc-outside-click") close(); };
                const docClick = (e: MouseEvent) => { const t = e.target as Node; if (!menu.contains(t) && !btn.contains(t)) close(); };
                document.addEventListener("click", docClick);
                document.addEventListener("arc-dismiss", close);
                window.addEventListener("blur", close);
                chrome.runtime.onMessage.addListener(outside);
                return () => { offOutside(); document.removeEventListener("click", docClick); document.removeEventListener("arc-dismiss", close); window.removeEventListener("blur", close); chrome.runtime.onMessage.removeListener(outside); };
            },
        })),
    },
});

/*
 * Spaces（§5）：多个工作区，每个有名称、图标、颜色；标签归属某个 Space。
 * 实现选择（待确认项）：Chrome 没有“隐藏标签”的 API，所以可选用标签组表示 Space，
 * 切换时折叠其他 Space 的组、展开当前组；侧边栏只显示当前 Space 的内容。
 */
import { safe } from "@api/ErrorLog";
import { onTabIdRemap, remapRecord } from "@api/TabIdRemap";
import { notifyTabReplaced } from "@api/Tabs";
import { getLittleArcHandler, type LinkContext, resolveLinkRoute, warnUnsupported } from "@api/LinkRouting";
import { arcConfirm } from "@components/Dialog";
import { iconText, spaceIconNode } from "@api/spaceIcons";
import { tr } from "@api/i18n";
import { flog } from "@api/FocusLog";
import { icon as svgIcon } from "@api/icons";
import { h } from "@api/dom";
import "@components/ArcTooltip";
import { addSearchProvider, fuzzyScore } from "@api/Search";
import { addOverlay, addSection, openOverlay, refresh } from "@api/Slots";
import { listen } from "@api/ChromeEvents";
import { serial, uid } from "@utils/misc";
const spaceQueue = serial();
/** Arc SidebarDockCollectionViewLayout：每项宽 = clamp((可用宽 − 左右 inset 2×2) / 项数, 8, 34)，< 22 进入紧凑模式；不换行、不折叠，超出横向滚动；滚到选中项 0.16s */
export function dockWidth(avail: number, n: number) { const w = Math.min(34, Math.max(8, (avail - 4) / Math.max(1, n))); return { w, compact: w < 22 }; }
/* 52187：首帧侧栏宽度可能还是 0 → 只算一次会得到 8px 紧凑宽度（图标挤在 ▲ 右侧）。
 * 现改为：挂载后 rAF 计算一次 + ResizeObserver 监听宿主宽度；RO 回调只排一个 rAF（合并），不在回调里同步写布局；
 * 宽度为 0 时不写（等下一次 RO）；值未变不写；只在选中项变化/首次时滚动。 */
const dockState = new WeakMap<HTMLElement, { raf: number; ro?: ResizeObserver; key?: string; act?: string }>();
/* rel42 hover-rerender：指针停在 Space 圆点上时整屏重绘，keepHover 保留旧圆点栏并按新栏同步属性——新栏没进文档、measureDock 量不到 →
 * 旧栏的 --dock-w / compact 被摘（实测圆点 34px → 32px 默认宽，直到下次侧栏宽度变化）。记住上次可用宽度，新栏创建时先按它写上。 */
let lastAvail = -1;
function applyDock(bar: HTMLElement, avail: number, n: number) {
    const { w, compact } = dockWidth(avail, n);
    bar.style.setProperty("--dock-w", `${w}px`);
    bar.classList.toggle("compact", compact);
    return `${w}|${compact}`;
}
function measureDock(bar: HTMLElement) {
    const st = dockState.get(bar); if (st) st.raf = 0;
    if (!bar.isConnected) { st?.ro?.disconnect(); dockState.delete(bar); return; }
    const dots = Array.from(bar.querySelectorAll<HTMLElement>(".arc-space-dot"));
    const host = bar.parentElement ?? bar;
    if (host.clientWidth <= 0) return;
    const others = Array.from(host.children).filter(c => c !== bar).reduce((a, c) => a + (c as HTMLElement).offsetWidth, 0);
    lastAvail = Math.max(0, host.clientWidth - others - 24);
    const { w, compact } = dockWidth(lastAvail, dots.length);
    const key = `${w}|${compact}`;
    if (st?.key !== key) {
        if (st) st.key = key;
        applyDock(bar, lastAvail, dots.length);
    }
    const act = bar.querySelector<HTMLElement>(".arc-space-dot.active");
    const actId = act?.dataset.space ?? ""; // 选中项的身份 = Space id（data-space，唯一）；data-tip 在进文档时已被 ArcTooltip.applyTip 消费，读回来恒为 null，不能当回退
    if (act && st?.act !== actId) {
        if (st) st.act = actId;
        const l = act.offsetLeft - (bar.clientWidth - act.offsetWidth) / 2; bar.scrollTo({ left: Math.max(0, l), behavior: "smooth" });
    }
}
export function scheduleDock(bar: HTMLElement) {
    let st = dockState.get(bar);
    if (!st) { st = { raf: 0 }; dockState.set(bar, st); }
    if (st.raf) return; // 合并：同一帧只算一次
    st.raf = requestAnimationFrame(() => measureDock(bar));
}
function layoutDock(bar: HTMLElement | null) {
    if (!bar) return;
    if (lastAvail >= 0 && !bar.isConnected) applyDock(bar, lastAvail, bar.querySelectorAll(".arc-space-dot").length);
    scheduleDock(bar);
    const st = dockState.get(bar)!;
    if (!st.ro && typeof ResizeObserver !== "undefined") {
        st.ro = new ResizeObserver(() => scheduleDock(bar));
        st.ro.observe(bar.parentElement ?? bar);
    }
}
import { showContextMenu, showMenuAt, toast } from "@api/PanelShell";
import { commands, keyFor, runCommand } from "@api/Commands";
import { call, handle } from "@api/RPC";
import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";

import { expandDragData } from "@api/DragData";
import { moveKeysToSpace, pinnedStore, walk } from "@plugins/tabs/pinnedTabs";
import { archiveStore } from "@plugins/tabs/archive";
import { isPluginEnabled } from "@api/PluginManager";
import { activeTab, getWindowId } from "@plugins/_core/tabState";
import { inlineRename } from "@components/TabRow";
import { addUndoKind, recordUndo } from "@api/Undo";
import { expectedArchiveCount, pickCreatedArchiveIds, withoutArchiveIds } from "./archiveUndo";
import type { MenuItemDef } from "@api/ContextMenus";
import { renderManage, spaceMenuItems } from "./menu";
import { snapStore, enableSnapshots, freezeSnapshots, maybeUnfreeze, restoreFromSnapshot, scheduleSnapshot, discardKeep } from "./restore";
import { activeIdOf, activeSpace, setSpaceWindow, SPACE_COLORS, type SpaceColor, spacesStore } from "./store";

const settings = definePluginSettings({
    useTabGroups: { type: OptionType.BOOLEAN, default: false, /* B7：默认关闭 */ description: "spaces.useTabGroups" },
    swipeToSwitch: { type: OptionType.BOOLEAN, default: true, description: "spaces.swipe" },
    spaceExtraMenu: { type: OptionType.BOOLEAN, default: false, description: "spaces.extraMenu" }, // Arc 菜单里没有的项：默认关闭
});

/* ---------------- background ---------------- */

async function syncGroups(windowId?: number) {
    if (!settings.store.useTabGroups || !chrome.tabGroups) return;
    const d = spacesStore.get();
    const wins = windowId != null ? [{ id: windowId }] : await chrome.windows.getAll({ windowTypes: ["normal"] });
    for (const w of wins) {
        const tabs = await chrome.tabs.query({ windowId: w.id, pinned: false });
        for (const sp of d.spaces) {
            const ids = tabs.filter(t => (d.tabSpace[t.id!] ?? d.spaces[0].id) === sp.id).map(t => t.id!);
            if (!ids.length) continue;
            const existing = tabs.find(t => ids.includes(t.id!) && t.groupId > -1)?.groupId;
            try {
                const tabIds = ids as [number, ...number[]];
                const groupId = existing != null && existing > -1
                    ? await chrome.tabs.group({ tabIds, groupId: existing })
                    : await chrome.tabs.group({ tabIds, createProperties: { windowId: w.id } });
                await chrome.tabGroups.update(groupId, { title: `${iconText(sp.icon)} ${sp.name}`.trim(), color: sp.color, collapsed: sp.id !== activeIdOf(w.id, d) });
            } catch { /* 标签可能已关闭 */ }
        }
    }
}

async function switchSpace(id: string, windowId?: number) {
    const d = spacesStore.get();
    if (!d.spaces.some(s => s.id === id)) return;
    const win = windowId ?? (await chrome.windows.getLastFocused({ windowTypes: ["normal"] })).id;
    await spacesStore.update(x => { x.activeId = id; if (win != null) (x.activeByWin ??= {})[win] = id; });
    const last = d.lastTab[id];
    const target = last != null ? await chrome.tabs.get(last).catch(() => null) : null; // 预期：记录的上一个标签可能已关闭 → null，不记日志
    if (target?.id != null && target.windowId === win) await chrome.tabs.update(target.id, { active: true });
    else {
        const tabs = await chrome.tabs.query({ windowId: win });
        const inSpace = tabs.find(t => d.tabSpace[t.id!] === id);
        if (inSpace?.id != null) await chrome.tabs.update(inSpace.id, { active: true });
        else await chrome.tabs.create({ windowId: win });
    }
    await syncGroups(win);
}

async function cycle(delta: number) {
    const d = spacesStore.get();
    const win = (await chrome.windows.getLastFocused({ windowTypes: ["normal"] }).catch(() => null))?.id; // 预期：没有普通窗口时 Chrome 报错 → undefined，不记日志
    const i = d.spaces.findIndex(s => s.id === activeIdOf(win, d));
    await switchSpace(d.spaces[(i + delta + d.spaces.length) % d.spaces.length].id);
}

const born = new Map<number, number>();
export function routeFor(url: string): string | undefined {
    let host = ""; try { host = new URL(url).hostname.replace(/^www\./, ""); } catch { return; }
    const d = spacesStore.get();
    const r = d.routes?.find(x => host === x.host || host.endsWith(`.${x.host}`));
    return r && d.spaces.some(s => s.id === r.spaceId) ? r.spaceId : undefined;
}
const hostOf = (url?: string) => { try { return url ? new URL(url).hostname.replace(/^www\./, "") : ""; } catch { return ""; } };

interface SpaceDeleteUndo { items: { key: string; value: unknown }[]; archiveIds: string[] }
/** 撤销删除 Space：写回空间 / 固定项快照（同 “stores”），再只删除这次删除新增的归档项 */
export async function revertSpaceDelete(data: unknown) {
    const { items, archiveIds } = data as SpaceDeleteUndo;
    await chrome.storage.local.set(Object.fromEntries(items.map(i => [i.key, i.value])));
    if (archiveIds?.length) await archiveStore.update(x => { x.items = withoutArchiveIds(x.items, archiveIds); });
}

function backgroundStart() {
    // 重启恢复：浏览器启动时等标签恢复完再按快照挂回 Space；平时任何变化都刷新快照
    let started = false;
    return [
        addUndoKind("spaceDelete", revertSpaceDelete),
        listen("runtime.onStartup", () => { started = true; flog("bg", "runtime.onStartup"); void safe(restoreFromSnapshot(undefined, 2500).then(async () => { for (const w of await chrome.windows.getAll()) await syncGroups(w.id); }), "spaces.startupRestore").finally(() => enableSnapshots()); }),
        // onStartup 在部分 Chromium（Helium）里收不到：改为判断“快照里的标签 id 一个都不在了” = 浏览器刚重启
        (setTimeout(async () => {
            if (started) return;
            const snap = snapStore.get().tabs;
            const alive = new Set((await chrome.tabs.query({})).map(t => t.id));
            const restarted = snap.length > 0 && !snap.some(x => alive.has(x.id));
            flog("bg", `start check: snapshot ${snap.length}, restarted=${restarted}`);
            if (restarted) { started = true; await restoreFromSnapshot(undefined, 0); for (const w of await chrome.windows.getAll()) await syncGroups(w.id); }
            else enableSnapshots();
        }, 2500), () => { }),
        listen("tabs.onRemoved", (_id, info) => { if (info.isWindowClosing) freezeSnapshots(); else scheduleSnapshot(); }),
        listen("windows.onCreated", () => { void maybeUnfreeze(); scheduleSnapshot(); }),
        listen("windows.onRemoved", () => void setTimeout(() => void maybeUnfreeze(), 1500)),
        listen("tabs.onUpdated", (_id, c) => { if (c.url || c.title || c.status === "complete") scheduleSnapshot(); }),
        listen("tabs.onMoved", () => scheduleSnapshot()),
        listen("tabs.onReplaced", (added, removed) => { flog("bg", `tab replaced ${removed} -> ${added}`); void notifyTabReplaced(removed, added); }),
        listen("tabs.onAttached", () => scheduleSnapshot()),
        spacesStore.subscribe(() => scheduleSnapshot()),
        // 标签换 id（丢弃 / 替换 / 重启映射）：Space 归属与 lastTab 搬到新 id
        onTabIdRemap((map, alive) => spacesStore.update(x => { x.tabSpace = remapRecord(x.tabSpace, map, alive); for (const [sp, old] of Object.entries(x.lastTab ?? {})) { const to = map.get(old); if (to != null) x.lastTab[sp] = to; } })),
        listen("tabs.onCreated", () => void safe(maybeUnfreeze(), "spaces.maybeUnfreeze")),
        listen("tabs.onCreated", tab => {
            if (tab.id == null) return;
            born.set(tab.id, Date.now());
            const d = spacesStore.get();
            const sp = (tab.openerTabId != null && d.tabSpace[tab.openerTabId]) || activeIdOf(tab.windowId, d);
            void spacesStore.update(x => { x.tabSpace[tab.id!] = sp; }).then(() => syncGroups(tab.windowId));
        }),
        listen("tabs.onRemoved", id => { born.delete(id); void spacesStore.update(x => { delete x.tabSpace[id]; }); }),
        // Air Traffic Control：新标签（创建后 20 秒内首次导航）命中规则 → 归到对应 Space
        listen("tabs.onUpdated", (id, c, tab) => {
            if (!c.url || !born.has(id) || Date.now() - born.get(id)! > 20000) return;
            if (!/^https?:/.test(c.url)) return;
            // 扩展路由器（@api/LinkRouting）先于内置规则
            const ctx: LinkContext = { url: c.url, source: tab.openerTabId != null ? "page" : "newTab", openerTabId: tab.openerTabId };
            const target = resolveLinkRoute(ctx);
            let sp: string | undefined;
            if (target?.kind === "space" && spacesStore.get().spaces.some(s => s.id === target.spaceId)) sp = target.spaceId;
            else if (target?.kind === "mostRecent") sp = spacesStore.get().activeId;
            else if (target?.kind === "littleArc" && getLittleArcHandler()) { born.delete(id); void getLittleArcHandler()!(c.url, id); return; }
            else if (target) warnUnsupported(target);
            sp ??= routeFor(c.url);
            if (!sp) return;
            born.delete(id);
            if (spacesStore.get().tabSpace[id] === sp) return;
            void spacesStore.update(x => { x.tabSpace[id] = sp; }).then(() => syncGroups(tab.windowId));
        }),
        listen("tabs.onActivated", ({ tabId, windowId }) => {
            const d = spacesStore.get();
            const sp = d.tabSpace[tabId];
            const before = activeIdOf(windowId, d);
            void spacesStore.update(x => {
                // 激活别的 Space 的标签 = 该窗口切到那个 Space
                if (sp) { x.activeId = sp; (x.activeByWin ??= {})[windowId] = sp; }
                x.lastTab[sp ?? before] = tabId;
            }).then(() => { if (sp && sp !== before) void syncGroups(windowId); });
        }),
        // 聚焦另一个窗口：全局 activeId 跟随该窗口的 Space
        listen("windows.onFocusChanged", w => {
            const d = spacesStore.get();
            const id = d.activeByWin?.[w];
            if (w !== chrome.windows.WINDOW_ID_NONE && id && id !== d.activeId) void spacesStore.update(x => { x.activeId = id; });
        }),
        listen("windows.onRemoved", w => void spacesStore.update(x => { if (x.activeByWin) delete x.activeByWin[w]; })),
        listen("runtime.onInstalled", async () => {
            // 首次安装：把已有标签归到默认 Space
            const tabs = await chrome.tabs.query({});
            await spacesStore.update(x => { for (const t of tabs) if (t.id != null) x.tabSpace[t.id] ??= x.activeId; });
        }),
        handle("spaces:switch", ([id, win]) => switchSpace(id as string, win as number | undefined)),
        handle("spaces:create", async ([name, icon]) => {
            const id = uid();
            await spacesStore.update(x => { x.spaces.push({ id, name: String(name || tr("spaces.newName")), icon: String(icon || ""), color: SPACE_COLORS[x.spaces.length % SPACE_COLORS.length] }); });
            await switchSpace(id);
            return id;
        }),
        handle("spaces:update", async ([id, patch]) => {
            await spacesStore.update(x => { const s = x.spaces.find(sp => sp.id === id); if (s) { Object.assign(s, patch); for (const [k, v] of Object.entries(patch as object)) if (v === null) delete (s as unknown as Record<string, unknown>)[k]; } });
            await syncGroups();
        }),
        handle("spaces:delete", async ([id]) => {
            const d = spacesStore.get();
            if (d.spaces.length < 2) throw new Error(tr("spaces.keepOne"));
            const ids = Object.entries(d.tabSpace).filter(([, s]) => s === id).map(([t]) => Number(t));
            // B-09：Arc “This will archive all the tabs and folders inside it.”（audit-52193-answers.md §13）——删除 = 归档，不是直接关闭。
            // 打开的标签：关闭时由 Archive 插件的 tabs.onRemoved 记入归档；先去掉 tabSpace 归属，免得归档项指向已删除的空间（恢复时会变成孤儿）。
            // 没打开的固定项 / 文件夹里的网址：直接写入归档（文件夹本身没有归档形态 ⛔，只归档其中的网址）。
            const open = new Set(ids);
            const unopened = [...walk(pinnedStore.get().bySpace[id as string])].filter(n => n.kind === "tab" && n.url && (n.tabId == null || !open.has(n.tabId)));
            // B-09 撤销：记下本次删除新增的归档项 id，撤销时只删这些（archiveUndo.ts）
            const archiving = isPluginEnabled("Archive"), start = Date.now();
            const before = new Set(archiveStore.get().items.map(i => i.id));
            const direct = archiving ? unopened.map(() => uid()) : [];
            const closedUrls = archiving && ids.length ? (await chrome.tabs.query({})).filter(t => t.id != null && open.has(t.id) && !!t.url).map(t => t.url!) : [];
            if (archiving && unopened.length) await archiveStore.update(x => {
                const now = Date.now();
                x.items.unshift(...unopened.map((n, i) => ({ id: direct[i], url: n.url!, title: n.customTitle ?? n.title ?? n.url!, closedAt: now, reason: "closed" as const })));
            });
            await spacesStore.update(x => { x.spaces = x.spaces.filter(s => s.id !== id); if (x.activeId === id) x.activeId = x.spaces[0].id; for (const [w, s] of Object.entries(x.activeByWin ?? {})) if (s === id) delete x.activeByWin![w]; for (const t of ids) delete x.tabSpace[t]; });
            if (ids.length) await chrome.tabs.remove(ids).catch(() => { }); // 预期：部分标签可能已被关闭，忽略
            // 打开的标签由 Archive 的 tabs.onRemoved 异步写入归档：最多等 1.5s 收齐
            const pick = () => archiving ? pickCreatedArchiveIds(archiveStore.get().items, before, direct, closedUrls, start) : [];
            let created = pick();
            for (const end = Date.now() + 1500, want = expectedArchiveCount(direct, closedUrls); created.length < want && Date.now() < end; created = pick()) await new Promise(r => setTimeout(r, 50));
            await switchSpace(spacesStore.get().activeId);
            return created;
        }),
        // 把空间并入另一个空间（“导出到文件夹”）：标签归到目标空间，删除原空间但不关闭标签
        handle("spaces:merge", async ([src, dst, win]) => {
            const d = spacesStore.get();
            if (!d.spaces.some(s => s.id === dst) || src === dst) return;
            await spacesStore.update(x => {
                for (const [t, sp] of Object.entries(x.tabSpace)) if (sp === src) x.tabSpace[t] = dst as string;
                x.spaces = x.spaces.filter(s => s.id !== src);
                if (x.activeId === src) x.activeId = dst as string;
                for (const [w, sp] of Object.entries(x.activeByWin ?? {})) if (sp === src) x.activeByWin![w] = dst as string;
                x.routes = x.routes?.map(r => r.spaceId === src ? { ...r, spaceId: dst as string } : r);
                delete x.lastTab[src as string];
            });
            await switchSpace(dst as string, win as number | undefined);
        }),
        handle("spaces:moveTab", async ([tabId, spaceId]) => {
            await spacesStore.update(x => { x.tabSpace[tabId as number] = spaceId as string; });
            if (settings.store.useTabGroups) await chrome.tabs.ungroup(tabId as number).catch(() => { }); // 预期：标签可能已关闭 / 不在组内，忽略
            await syncGroups();
        }),
    ];
}

/* ---------------- panel ---------------- */

/** 行内重命名空间（标题处就地编辑，Enter / 点外部保存，Esc 取消）；非当前空间先切过去 */
async function renameSpace(id: string) {
    if (activeSpace().id !== id) { await call("spaces:switch", id, getWindowId()); await new Promise(r => setTimeout(r, 250)); }
    const sp = spacesStore.get().spaces.find(s => s.id === id);
    const span = await waitFor(() => document.querySelector<HTMLElement>(".arc-space-title .arc-space-name"));
    if (span && sp) inlineRename(span, sp.name, name => { if (name) void call("spaces:update", id, { name }); });
}

const waitFor = async <T>(fn: () => T | null | undefined, ms = 1500): Promise<T | null> => {
    const end = Date.now() + ms;
    for (;;) { const v = fn(); if (v) return v; if (Date.now() > end) return null; await new Promise(r => setTimeout(r, 50)); }
};

async function deleteSpace(id: string) {
    // B-09：标题 “Delete your <名称> Space?” + 说明行（audit-52193-answers.md §13）；按钮文案 ⛔，沿用 common.delete
    const name = spacesStore.get().spaces.find(s => s.id === id)?.name ?? "";
    if (!(await arcConfirm(tr("spaces.deleteConfirm", name), { ok: tr("common.delete"), danger: true, detail: tr("spaces.deleteConfirmDetail") }))) return;
    // 可撤销：空间列表与该空间的固定项一起恢复（关闭的标签由 Undo 的“关闭标签”另行恢复）
    // B-09：撤销时还要删掉这次删除新增的归档项（不碰删除前已有的），所以不用 snapshotStores 而用自己的撤销类型 spaceDelete
    const items = [spacesStore, pinnedStore].map(s => ({ key: s.key, value: structuredClone(s.get()) }));
    try {
        const archiveIds = (await call<string[] | undefined>("spaces:delete", id)) ?? [];
        await pinnedStore.update(x => { delete x.bySpace[id]; delete x.collapsed[id]; });
        await new Promise(r => setTimeout(r, 300)); // 等关闭标签的撤销记录先入栈
        recordUndo("spaceDelete", tr("spaces.delete"), { items, archiveIds } satisfies SpaceDeleteUndo);
    } catch (e) { toast(String((e as Error).message)); }
}

const colorMenu = (spaceId: string): MenuItemDef[] => SPACE_COLORS.map(c => ({
    id: `color:${c}`, label: `spaces.color.${c}`, checked: () => spacesStore.get().spaces.find(s => s.id === spaceId)?.color === c,
    run: () => call("spaces:update", spaceId, { color: c as SpaceColor }),
}));

/** 横滑切 Space 不响应的区域 */
export const SWIPE_IGNORE = ".arc-menu, .arc-panel, .arc-overlay, .arc-icon-picker, .arc-theme-picker, [data-no-swipe]";
/** 这些东西开着时整体不横滑 */
export const SWIPE_BLOCKERS = ".arc-menu:not([hidden]), .arc-panel, .arc-overlay:not([data-page])";

function panelStart() {
    setSpaceWindow(getWindowId);
    /* 跟手滑动：横向滚动时内容实时跟随手指位移，超过阈值松手即切换，不足则弹回 */
    let wheelAcc = 0;
    let wheelLock = false;
    let lockUntil = 0;
    let idle: ReturnType<typeof setTimeout> | undefined;
    let lockTimer: ReturnType<typeof setTimeout> | undefined;
    /* 横滑进行中锁住纵向滚动（overflow-y:hidden 不改 scrollTop；触控板手指的 y 抖动否则会把列表原生纵向滚动 ±几 px，与横向跟手叠加成“抖动”） */
    /* 手势结束判定：最后一个横向事件后 250ms 无事件（触控板事件间隙可达 200ms；被忽略的 |dx|<1.5|dy| 事件也算“手指还在”） */
    const GESTURE_IDLE = 250;
    const scroller = () => document.querySelector<HTMLElement>("#app .arc-scroll");
    const follow = (x: number, animate = false) => { const el = scroller(); if (!el) return; el.style.overflowY = x ? "hidden" : ""; el.style.transition = x ? "none" : animate ? "transform .18s var(--arc-ease), opacity .18s" : ""; el.style.transform = x ? `translateX(${x}px)` : ""; el.style.opacity = x ? String(1 - Math.min(Math.abs(x) / 220, 0.5)) : ""; };
    const armIdle = () => { clearTimeout(idle); idle = setTimeout(() => { wheelAcc = 0; follow(0, true); dockProgress(0); }, GESTURE_IDLE); };
    /* Arc SidebarDock：横滑时图标不透明度随进度插值 α = a + (1 − a)·progress（目标 Space 从 .5 渐显到 1，当前 Space 反向），灰度同步褪去 */
    const dockProgress = (raw: number) => {
        const dots = Array.from(document.querySelectorAll<HTMLElement>(".arc-space-bar .arc-space-dot"));
        for (const d of dots) { d.style.opacity = ""; d.style.filter = ""; }
        const p = Math.min(1, Math.abs(raw)); if (!p || dots.length < 2) return;
        const i = dots.findIndex(d => d.classList.contains("active")); if (i < 0) return;
        const tgt = dots[(i + Math.sign(raw) + dots.length) % dots.length];
        tgt.style.opacity = String(0.5 + 0.5 * p); tgt.style.filter = `grayscale(${1 - p})`;
        dots[i].style.opacity = String(1 - 0.5 * p);
    };
    const onWheel = (e: WheelEvent) => {
        // 51998：菜单 / 弹层 / 浮层 / 选择器里的滚轮不算横滑切 Space（51996 在图标选择器里滚动时会误切）
        // 任何菜单 / 弹层 / 浮层打开期间整体不响应（Cat 51998）
        if ((e.target as Element | null)?.closest?.(SWIPE_IGNORE) || document.querySelector(SWIPE_BLOCKERS)) return;
        if (!settings.store.swipeToSwitch) return;
        // 切换后的锁：450ms 到点后还要等事件流静下来（惯性尾巴 ≥150ms 无事件）才解锁，否则尾巴会把新 Space 的内容又拖出去
        if (wheelLock) { if (e.deltaX) { clearTimeout(lockTimer); lockTimer = setTimeout(() => { wheelLock = false; }, Math.max(150, lockUntil - Date.now())); } return; }
        if (Math.abs(e.deltaX) < Math.abs(e.deltaY) * 1.5) { if (wheelAcc) armIdle(); return; } // 手势进行中：被忽略的事件只刷新空闲计时，不累加
        wheelAcc += e.deltaX;
        follow(-Math.max(-160, Math.min(160, wheelAcc)) * 0.6);
        dockProgress(wheelAcc / 120);
        armIdle();
        if (Math.abs(wheelAcc) < 120) return;
        wheelLock = true; lockUntil = Date.now() + 450;
        clearTimeout(idle);
        const d = spacesStore.get();
        const i = d.spaces.findIndex(s => s.id === activeSpace().id);
        const next = d.spaces[(i + Math.sign(wheelAcc) + d.spaces.length) % d.spaces.length];
        wheelAcc = 0;
        follow(0); dockProgress(0);
        void call("spaces:switch", next.id, getWindowId());
        clearTimeout(lockTimer); lockTimer = setTimeout(() => { wheelLock = false; }, 450);
    };
    document.addEventListener("wheel", onWheel, { passive: true });

    // Arc 式 Space 切换动画：按方向给 #app 打上 swipe 类，CSS（插件组 Spaces 的样式）负责滑入
    let lastIdx = spacesStore.get().spaces.findIndex(x => x.id === activeSpace().id);
    let swipeTimer: ReturnType<typeof setTimeout> | undefined;
    const onSwitch = () => {
        const d = spacesStore.get();
        const idx = d.spaces.findIndex(x => x.id === activeSpace().id);
        if (idx === lastIdx || lastIdx < 0) { lastIdx = idx; return; }
        const app = document.getElementById("app");
        if (app) {
            app.classList.remove("arc-swipe-next", "arc-swipe-prev");
            void app.offsetWidth;
            app.classList.add(idx > lastIdx ? "arc-swipe-next" : "arc-swipe-prev");
            clearTimeout(swipeTimer);
            swipeTimer = setTimeout(() => app.classList.remove("arc-swipe-next", "arc-swipe-prev"), 360);
        }
        lastIdx = idx;
    };

    return [
        () => { document.removeEventListener("wheel", onWheel); clearTimeout(idle); clearTimeout(lockTimer); follow(0); },
        spacesStore.subscribe(onSwitch),
        () => clearTimeout(swipeTimer),
        spacesStore.subscribe(refresh),
        addSection("header", "Spaces", {
            render(el) {
                // Arc 的空间标题行：圆角浅色胶囊 = 折叠箭头 + 名称（灰色中等字重）+ 右侧“…”（悬停 / 打开时显示）
                const sp = activeSpace();
                const canCollapse = !!commands.get("pin.collapse");
                const collapsed = !!pinnedStore.get().collapsed[sp.id];
                const more = h("button", {
                    class: "arc-icon-btn arc-space-more", "data-tip": tr("spaces.more"), "data-tip-edge": "7", "data-test": "space-more", "aria-haspopup": "menu",
                    onclick: (e: MouseEvent) => {
                        e.stopPropagation();
                        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                        const m = showMenuAt({ x: r.left, y: r.bottom + 4 }, "space", { spaceId: sp.id }, "arc-space-menu");
                        if (m) { more.classList.add("open"); new MutationObserver((_, o) => { if (!m.isConnected) { more.classList.remove("open"); o.disconnect(); } }).observe(document.body, { childList: true }); }
                    },
                }, svgIcon("more", 13)); // SF ellipsis 13pt semibold（more-button-icon.md §1a）；semibold 对临时 ionicons 字形不适用
                el.append(h("div", {
                    class: "arc-space-title", "data-tip": tr("spaces.titleHint"), "data-color": sp.color, "data-collapsed": String(collapsed),
                    onclick: (e: MouseEvent) => { if (e.detail > 1) return; if (canCollapse) void runCommand("pin.collapse"); else void renameSpace(sp.id); },
                    ondblclick: (e: MouseEvent) => { e.preventDefault(); void renameSpace(sp.id); },
                    oncontextmenu: (e: MouseEvent) => showContextMenu(e, "space", { spaceId: sp.id }, "arc-space-menu"),
                },
                // 没有拖动把手：Rea（space-header-idle.md §3.2）Space 标题行没有拖拽手柄，“Drag to Reorder Space” 只在 Manage Spaces（menu.ts 的 arc-manage-grip）。原 B-07 的标题把手已移除。
                // 行内顺序 [箭头, 图标, 标题, “…”]（§5 stack：spacing 4，centerY）；箭头 idle opacity 0 仍占位、“…” idle 宽 0 + alpha 0，样式见 spaces/style.ts。
                canCollapse ? h("span", { class: "arc-space-chevron" }, svgIcon(collapsed ? "chevronRight" : "chevronDown", 14)) : null,
                sp.icon ? h("span", { class: "arc-space-icon" }, spaceIconNode(sp.icon, 16)) : null,
                h("span", { class: "arc-space-name" }, sp.name), more));
            },
        }),
        addSection("bottom", "Spaces", {
            order: 50,
            render(el) {
                const d = spacesStore.get();
                // 无痕窗口标识（需在扩展详情里允许无痕模式）
                if (chrome.extension.inIncognitoContext) el.append(h("span", { class: "arc-incognito", "data-test": "incognito", "data-tip": tr("spaces.incognito") }, tr("spaces.incognito")));
                el.append(h("div", { class: "arc-space-bar" },
                    d.spaces.map((s, i) => h("button", {
                        // 快捷键键帽：space.go1–9（含用户改键），keyFor = prettyCombo 输出（ArcTooltip 期望格式，同菜单 PanelShell.ts:193 来源）；Arc 圆点提示带快捷键与否、符号样式 ⛔
                        class: `arc-space-dot${s.id === activeSpace().id ? " active" : ""}`, "data-tip": s.name, "data-tip-edge": "0", "data-tip-shortcut": (i < 9 && keyFor(`space.go${i + 1}`)) || undefined, "data-color": s.color,
                        onclick: () => void call("spaces:switch", s.id, getWindowId()),
                        oncontextmenu: (e: MouseEvent) => showContextMenu(e, "space", { spaceId: s.id }, "arc-space-menu"),
                        "data-space": s.id, draggable: "true",
                        // 拖动圆点 = 调整空间顺序（同 Arc 底栏）
                        ondragstart: (e: DragEvent) => e.dataTransfer!.setData("text/arc-space", s.id),
                        // 把标签 / 固定项拖到空间圆点上 = 移到该空间
                        ondragover: (e: DragEvent) => { if (e.dataTransfer?.types.includes("text/arc-space")) { e.preventDefault(); return; } if (s.id !== activeSpace().id) { e.preventDefault(); (e.currentTarget as HTMLElement).classList.add("drop"); } },
                        ondragleave: (e: DragEvent) => (e.currentTarget as HTMLElement).classList.remove("drop"),
                        ondrop: (e: DragEvent) => {
                            (e.currentTarget as HTMLElement).classList.remove("drop");
                            const moving = e.dataTransfer?.getData("text/arc-space");
                            if (moving) { e.preventDefault(); void reorderSpace(moving, s.id); return; }
                            const data = e.dataTransfer?.getData("text/arc-item");
                            if (data) { e.preventDefault(); void moveKeysToSpace(expandDragData(data), s.id); }
                        },
                    }, spaceIconNode(s.icon, 14))), // B-10：切换器图标 14（紧凑 12 见 spaces/style.ts），space-switcher.md:17
                    // 底栏只保留一个 ＋：PlusMenu 启用时由它统一提供（菜单里含“新建 Space”），这里的按钮仅作 PlusMenu 关闭时的后备
                    h("button", { class: "arc-icon-btn arc-space-new", "data-tip": tr("spaces.new"), onclick: () => newSpace() }, svgIcon("plus"))));
                layoutDock(el.querySelector(".arc-space-bar"));
            },
        }),
        addOverlay("manageSpaces", "SpaceManager", { title: tr("spaces.manage.title"), render: box => renderManage(box, reorderSpace, deleteSpace, newSpace) }),
        addSearchProvider("spaces", "Spaces", {
            label: tr("plugin.spaces.label"),
            search: q => spacesStore.get().spaces.map(s => ({
                id: `space:${s.id}`, title: tr("spaces.switchTo", iconText(s.icon), s.name), score: fuzzyScore(q, s.name) * 0.9,
                run: () => call("spaces:switch", s.id, getWindowId()),
            })).filter(r => r.score! > 0),
        }),
        // “移到 [空间]”：把当前标签移到另一个空间（命令栏 / “/” 动作模式）
        addSearchProvider("moveToSpace", "Spaces", {
            label: tr("spaces.moveTo"),
            order: 5,
            search: q => spacesStore.get().spaces.filter(s => s.id !== activeSpace().id).map(s => {
                const title = tr("spaces.moveTabTo", iconText(s.icon), s.name);
                return {
                    id: `move:${s.id}`, title, score: q ? Math.max(fuzzyScore(q, title), fuzzyScore(q, s.name) * 0.5) * 0.8 : 0,
                    run: () => { const id = activeTab()?.id; if (id != null) void moveKeysToSpace([`tab:${id}`], s.id); },
                };
            }).filter(r => r.score > 0),
        }),
    ];
}

export async function reorderSpace(id: string, beforeId: string) {
    if (id === beforeId) return;
    await spacesStore.update(x => {
        const from = x.spaces.findIndex(s => s.id === id); if (from < 0) return;
        const to = x.spaces.findIndex(s => s.id === beforeId);
        const [sp] = x.spaces.splice(from, 1);
        x.spaces.splice(to < 0 ? x.spaces.length : (from < to ? to : to), 0, sp);
    });
}

/** 新建空间：先用默认名建好并切过去，然后在标题处行内命名（同 Arc） */
async function newSpace() {
    const id = await call<string>("spaces:create", tr("spaces.newName"));
    if (id) void renameSpace(id);
}

export default definePlugin({
    name: "SpaceManager",
    authors: [Devs.ArcSidebar],
    label: "plugin.spaceManager.label",
    description: "plugin.spaceManager.desc",
    tags: ["spaces"],
    required: true,
    settings,
    commands: [
        { id: "spaces.discardKeep", label: "spaces.cmdDiscardKeep", hidden: true, context: "background", run: async (a?: unknown) => { const id = (a as { id: number }).id; await discardKeep(id); return (await chrome.tabs.query({})).find(t => t.id === id || (t.discarded && t.url === (a as { url?: string }).url))?.id; } },
        { id: "spaces.restoreTabs", label: "spaces.cmdRestoreTabs", hidden: true, context: "background", run: (a?: unknown) => restoreFromSnapshot((a as { ids?: number[] } | undefined)?.ids) },
        { id: "spaces.snapshotNow", label: "spaces.cmdRestoreTabs", hidden: true, context: "background", run: async () => ({ ok: true, changed: true, n: await (scheduleSnapshot(true) ?? 0) }) },
        { id: "space.new", label: "spaces.new", keywords: ["new space"], context: "panel", run: newSpace },
        { id: "space.next", label: "spaces.next", context: "background", defaultKey: "Mod+Alt+ArrowRight", run: () => spaceQueue(() => cycle(1)) },
        { id: "space.prev", label: "spaces.prev", context: "background", defaultKey: "Mod+Alt+ArrowLeft", run: () => spaceQueue(() => cycle(-1)) },
        { id: "space.delete", label: "spaces.deleteCurrent", context: "panel", run: () => deleteSpace(activeSpace().id) },
        { id: "space.rename", label: "spaces.renameCurrent", context: "panel", run: () => renameSpace(activeSpace().id) },
        // 键盘打开空间菜单（同标题行“…”）
        // ⌥⇧M 默认键 Arc 没有（审计 52193 多出项 #7）：默认不绑键，命令保留
        { id: "space.menu", label: "spaces.more", keywords: ["space menu", "space options"], context: "panel", run: () => (document.querySelector<HTMLElement>('[data-test="space-more"]'))?.click() },
        { id: "space.manage", label: "spaces.manage.title", keywords: ["manage spaces", "spaces"], context: "panel", run: () => openOverlay("manageSpaces") },
        ...Array.from({ length: 9 }, (_, i) => ({
            id: `space.go${i + 1}`, label: tr("spaces.switchN", i + 1), hidden: true, context: "background" as const,
            // 审计 52193 K-02：Alt+1–9 为扩展自有，默认不绑键，命令保留
            run: () => spaceQueue(() => { const s = spacesStore.get().spaces[i]; return s && switchSpace(s.id); }),
        })),
    ],
    contextMenuItems: {
        // Arc 的空间菜单（顺序 / 分组见 ./menu.ts）；“清除站点规则”跟在“管理空间…”一组
        space: [
            ...spaceMenuItems(renameSpace, deleteSpace),
            { id: "routes", group: 4, label: "spaces.clearRoutes", order: 41, visible: t => !!spacesStore.get().routes?.some(r => r.spaceId === t.spaceId), run: t => spacesStore.update(x => { x.routes = x.routes?.filter(r => r.spaceId !== t.spaceId); }) },
        ],
        tab: [{
            id: "route", order: 70, label: t => tr("spaces.routeHere", hostOf(t.url)), visible: t => !!settings.store.spaceExtraMenu && /^https?:/.test(t.url ?? ""),
            run: t => { const host = hostOf(t.url); const sp = spacesStore.get().tabSpace[t.tabId!] ?? activeSpace().id; return spacesStore.update(x => { x.routes = [...(x.routes ?? []).filter(r => r.host !== host), { host, spaceId: sp }]; }).then(() => toast(tr("spaces.routed", host))); },
        }],
        sidebar: [
            { id: "newSpace", label: "spaces.new", order: 20, run: () => newSpace() },
            { id: "renameSpace", label: "spaces.renameCurrent", order: 21, run: () => renameSpace(activeSpace().id) },
            { id: "spaceColor", label: "spaces.changeColor", order: 60, visible: () => !!settings.store.spaceExtraMenu, run: () => { }, submenu: () => colorMenu(activeSpace().id) },
        ],
    },
    background: { start: backgroundStart },
    panel: { start: panelStart },
    onSettingsChange() { void syncGroups(); },
});

/*
 * Peek（§10.6，按 /workspace/arc-analysis/peek-click.md 的结论）：固定标签 / 收藏里点跨站（eTLD+1）链接、或任何标签 Shift+点击，
 * 用居中的小窗预览；target=_blank / window.open 从固定 / 收藏跨站打开时也进 Peek。修饰键见 logic.ts。
 * Peek 内：Esc / 关闭按钮 / 点外面（失焦）/ ⌘W 关闭，可撤销重开；展开为标签；分屏有空位时可加入分屏；内部链接不再嵌套 Peek。
 * 会议链接（Meet / Zoom / Teams）始终在新标签打开。
 */
import { safe } from "@api/ErrorLog";
import { peekHeight, peekWidth } from "./geometry";
import { tr } from "@api/i18n";
import { setLittleArcHandler } from "@api/LinkRouting";
import { addUndoKind, recordUndo } from "@api/Undo";
import { crossSite, decideClick, newTargetToPeek } from "./logic";
import { flog } from "@api/FocusLog";
import { activeIdOf, spacesStore } from "@plugins/spaces/spaceManager/store";
import { icon } from "@api/icons";
import { arcTooltip } from "@components/ArcTooltip";
import { isPluginEnabled } from "@api/PluginManager";
import { addPane } from "@plugins/views/splitView";
import { listen } from "@api/ChromeEvents";
import { claimedTabIds } from "@api/Claims";
import { call, handle } from "@api/RPC";
import { definePluginSettings } from "@api/Settings";
import { createPluginStore } from "@api/Storage";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";

const settings = definePluginSettings({
    closeOnBlur: { type: OptionType.BOOLEAN, default: false, /* B4：同 Arc 只在点背景时关闭；选项保留 */ description: "peek.closeOnBlur" },
    // Arc 没有：自定义 Peek 高度 —— 额外选项，默认关闭；关闭时 size 不生效（高度用默认公式 ⛔，见 geometry.ts）。宽度始终 = 父窗口 × 0.8
    customSize: { type: OptionType.BOOLEAN, default: false, description: "peek.customSize" },
    size: { type: OptionType.NUMBER, default: 80, min: 40, max: 95, description: "peek.size", parent: "customSize" },
    // peek-click §1：Shift+点击任意链接 → Peek；§4：固定 / 收藏里的跨站点击 → Peek（两个独立开关）
    peekShiftClick: { type: OptionType.BOOLEAN, default: true, description: "peek.shiftClick" },
    peekPinnedClick: { type: OptionType.BOOLEAN, default: true, description: "peek.pinnedClick" },
    // Arc 没有：会议链接（Meet / Zoom / Teams）不进 Peek，改开新标签 —— 额外选项，默认关闭
    peekMeetingTab: { type: OptionType.BOOLEAN, default: false, description: "peek.meetingTab" },
    scope: {
        type: OptionType.SELECT, description: "peek.scope",
        options: [{ label: "peek.scopePinned", value: "pinned", default: true }, { label: "peek.scopeAll", value: "all" }],
    },
});
const MEETING = /(^|\.)(meet\.google\.com|zoom\.us|teams\.microsoft\.com|teams\.live\.com)$/;
/** Peek 窗口 → 打开它的主窗口（移成标签 / 分屏时回到这个窗口，而不是第一个窗口） */
const parentOf = new Map<number, number>();
/** Peek 窗口 → 当前网址（关闭后撤销用）；移成标签 / 分屏前先删掉，避免记成“关闭” */
const peekUrl = new Map<number, string>();
const isMeeting = (url: string) => !!settings.store.peekMeetingTab && MEETING.test(new URL(url).hostname);
const eligibleTab = (id?: number) => !!settings.store.peekPinnedClick && (settings.store.scope === "all" || (id != null && claimedTabIds().has(id)));
/** 在页面 MAIN world 运行：包装 getUserMedia，按活动轨道设置 <html data-cat-media="1"> */
export function trackMedia() {
    const w = window as any; if (w.__catMedia || !navigator.mediaDevices?.getUserMedia) return; w.__catMedia = true;
    const live = new Set<MediaStreamTrack>();
    const mark = () => { for (const t of live) if (t.readyState === "ended") live.delete(t); document.documentElement.dataset.catMedia = live.size ? "1" : ""; };
    const orig = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (c?: MediaStreamConstraints) => {
        const s = await orig(c);
        for (const t of s.getTracks()) { live.add(t); t.addEventListener("ended", mark); const stop = t.stop.bind(t); t.stop = () => { stop(); mark(); }; }
        mark(); return s;
    };
}
const peeks = createPluginStore<{ windows: number[]; little?: number[] }>("peek", () => ({ windows: [] }));

async function openPeek(url: string, parentWindowId?: number) {
    try { await openPeekInner(url, parentWindowId); } catch (e) { flog("bg", `peek: open FAILED ${url} ${String((e as Error)?.message ?? e)}`); }
}
async function normalParent(id?: number) {
    if (id != null) { const w = await chrome.windows.get(id).catch(() => null); /* 预期：窗口可能已关闭（No window with id），忽略 */ if (w?.type === "normal") return w; }
    return chrome.windows.getLastFocused({ windowTypes: ["normal"] }).catch(async () => (await chrome.windows.getAll({ windowTypes: ["normal"] }))[0]);
}
async function openPeekInner(url: string, parentWindowId?: number) {
    if (isMeeting(url)) return chrome.tabs.create({ url });
    const parent = await normalParent(parentWindowId);
    if (!parent) throw new Error("no normal window");
    // 尽量贴近 Arc 的 Peek：比父窗口窄一圈、几乎同高、水平居中、略低于工具栏（扩展无法画页面上的浮层，只能用无工具栏的 popup 窗口）
    const pw = parent.width ?? 1200, ph = parent.height ?? 800;
    const width = peekWidth(pw); // 卡片宽 = 父窗口 × 0.8（sidebar-features.md:472）；与 customSize 无关
    const height = peekHeight(ph, !!settings.store.customSize, Number(settings.store.size)); // 默认公式 ⛔；customSize 打开时才用 size
    const w = await chrome.windows.create({
        url, type: "popup", focused: true, width, height,
        left: Math.round((parent.left ?? 0) + (pw - width) / 2),
        top: Math.round((parent.top ?? 0) + Math.max(24, (ph - height) / 2 + 12)),
    });
    flog("bg", `peek: open win ${w?.id} ${width}x${height} ${new URL(url).hostname}`);
    if (w?.id != null && parent.id != null) parentOf.set(w.id, parent.id);
    if (w?.id != null) peekUrl.set(w.id, url);
    if (w?.id != null) await peeks.update(x => { x.windows.push(w.id!); });
}

/** Little Arc：右上角的小窗口快速浏览（同 Arc），可「在标签中打开」移到主窗口 */
export async function littleArc(url?: string) {
    const parent = await safe(normalParent(), "peek normalParent", null);
    const width = 460, height = 640;
    const left = Math.round((parent?.left ?? 0) + (parent?.width ?? 1200) - width - 24);
    const top = Math.round((parent?.top ?? 0) + 60);
    const w = await chrome.windows.create({ url: url || "chrome://newtab", type: "popup", focused: true, width, height, left, top });
    if (w?.id != null && parent?.id != null) parentOf.set(w.id, parent.id);
    if (w?.id != null) await peeks.update(x => { x.windows.push(w.id!); (x.little ??= []).push(w.id!); });
}

async function promote(windowId?: number) {
    const win = windowId != null ? await chrome.windows.get(windowId, { populate: true }) : await chrome.windows.getLastFocused({ populate: true });
    if (!peeks.get().windows.includes(win.id!)) return;
    const tab = win.tabs?.[0];
    const all = await chrome.windows.getAll({ windowTypes: ["normal"] });
    const normal = all.find(w => w.id === parentOf.get(win.id!)) ?? all.find(w => w.focused) ?? all[0];
    if (!tab?.id) return;
    flog("bg", `peek: promote win ${win.id} tab ${tab.id}`);
    peekUrl.delete(win.id!);
    await peeks.update(x => { x.windows = x.windows.filter(id => id !== win.id); });
    if (normal?.id != null) {
        await chrome.tabs.move(tab.id, { windowId: normal.id, index: -1 });
        // 移进来的标签归到该窗口当前的空间（否则沿用全局空间，多窗口时会出现在别的空间里）
        const sp = activeIdOf(normal.id);
        await spacesStore.update(x => { x.tabSpace[tab.id!] = sp; });
        await chrome.tabs.update(tab.id, { active: true });
        await chrome.windows.update(normal.id, { focused: true });
    } else await chrome.windows.create({ tabId: tab.id, type: "normal" });
}

/** 分屏还有空位（同 Arc：numberOfPanels < maximumNumberOfPanels，且父标签可分屏） */
async function canSplit(windowId?: number) {
    if (!isPluginEnabled("SplitView")) return false;
    const pid = windowId != null ? parentOf.get(windowId) : undefined;
    const all = await chrome.windows.getAll({ windowTypes: ["normal"], populate: true });
    const host = (all.find(w => w.id === pid) ?? all.find(w => w.focused) ?? all[0])?.tabs?.find(t => t.active);
    const u = host?.url ?? "";
    if (u.startsWith(chrome.runtime.getURL("split.html"))) return new URL(u).searchParams.getAll("u").length < 4;
    return /^https?:/.test(u);
}

/** Peek → 分屏：把预览页作为新面板加到主窗口当前标签旁（需启用分屏） */
async function toSplit(windowId?: number) {
    const win = windowId != null ? await chrome.windows.get(windowId, { populate: true }) : await chrome.windows.getLastFocused({ populate: true });
    if (!peeks.get().windows.includes(win.id!)) return;
    const url = win.tabs?.[0]?.url;
    const allW = await chrome.windows.getAll({ windowTypes: ["normal"], populate: true });
    const normal = allW.find(w => w.id === parentOf.get(win.id!)) ?? allW.find(w => w.focused) ?? allW[0];
    const host = normal?.tabs?.find(t => t.active);
    if (!url || !host || !isPluginEnabled("SplitView")) return promote(win.id);
    peekUrl.delete(win.id!);
    await chrome.windows.remove(win.id!);
    await addPane(url, host);
    await chrome.windows.update(normal.id!, { focused: true });
}

function closedPeek(id: number) {
    const url = peekUrl.get(id);
    peekUrl.delete(id);
    if (!url || peeks.get().little?.includes(id)) return;
    flog("bg", `peek: closed win ${id}, undo can reopen`);
    recordUndo("peekClosed", tr("peek.undoClose"), { url, parent: parentOf.get(id) });
}

export default definePlugin({
    name: "Peek",
    authors: [Devs.ArcSidebar],
    label: "plugin.peek.label",
    description: "plugin.peek.desc",
    tags: ["views"],
    enabledByDefault: true,
    settings,
    commands: [{ id: "peek.promote", label: "peek.cmdMove", context: "background", defaultKey: "Mod+O", run: () => promote() }, { id: "peek.littleArc", label: "peek.littleArc", keywords: ["little arc", "mini window"], context: "background", defaultKey: "Mod+Alt+N", run: () => littleArc().catch(e => flog("bg", `peek: little FAILED ${String(e?.message ?? e)}`)) }, { id: "peek.toSplit", label: "peek.toSplit", context: "background", run: () => toSplit() }],
    background: {
        start: () => [
            // 窗口 id 不跨重启：启动时丢掉已不存在的 Peek 窗口记录
            (void safe(chrome.windows.getAll().then(ws => { const alive = new Set(ws.map(w => w.id)); return peeks.update(x => { x.windows = x.windows.filter(w => alive.has(w)); x.little = x.little?.filter(w => alive.has(w)); }); }), "peek prune windows"), () => { }),
            handle("peek:open", ([url], sender) => openPeek(url as string, sender.tab?.windowId)),
            // 同 Arc：默认只有固定标签 / 收藏里的跨站链接用 Peek 打开
            handle("peek:eligible", (_a, sender) => { const ok = eligibleTab(sender.tab?.id); flog("bg", `peek: eligible tab ${sender.tab?.id} ${ok}`); return { ok, shift: !!settings.store.peekShiftClick }; }),
            handle("peek:isPeek", (_a, sender) => sender.tab?.windowId != null && peeks.get().windows.includes(sender.tab.windowId)),
            handle("peek:toSplit", (_a, sender) => toSplit(sender.tab?.windowId)),
            handle("peek:promote", (_a, sender) => promote(sender.tab?.windowId)),
            handle("peek:promoteWin", ([id]) => promote(id as number)),
            handle("peek:little", ([url]) => littleArc(url as string)),
            // LinkRouting 的 littleArc 目标：关掉原标签，改在 Little Arc 打开
            setLittleArcHandler(async (url, tabId) => { await chrome.tabs.remove(tabId).catch(() => { }); /* 预期：标签可能已关闭（No tab with id），忽略 */ await littleArc(url); }),
            handle("peek:canSplit", (_a, sender) => canSplit(sender.tab?.windowId)),
            // 撤销重开刚关闭的 Peek（Esc / 关闭按钮 / 点外面 / ⌘W 都走 windows.onRemoved）
            addUndoKind("peekClosed", d => { const { url, parent } = d as { url: string; parent?: number }; return openPeek(url, parent).then(() => { }); }),
            listen("tabs.onUpdated", (id, c, t) => {
                if (c.url && peekUrl.has(t.windowId)) peekUrl.set(t.windowId, c.url);
                // 调试入口（无需界面）：打开 …#cat-peek-demo 的地址 → 关掉该标签并以 Peek 打开
                if (c.url?.endsWith("#cat-peek-demo")) { flog("bg", "peek: demo via url"); void chrome.tabs.remove(id).catch(() => { }); /* 预期：标签可能已关闭（No tab with id），忽略 */ void openPeek(c.url.replace(/#cat-peek-demo$/, ""), t.windowId); }
            }),
            // target=_blank / window.open：来源是固定 / 收藏（或 scope=all）的跨站新标签 → 关掉它，改用 Peek
            (() => {
                const onTarget = (d: chrome.webNavigation.WebNavigationSourceCallbackDetails) => void (async () => {
                    const src = await chrome.tabs.get(d.sourceTabId).catch(() => undefined); /* 预期：标签可能已关闭（No tab with id），忽略 */
                    if (!src?.url || !eligibleTab(src.id)) return;
                    const inPeek = peeks.get().windows.includes(src.windowId);
                    if (!newTargetToPeek(true, inPeek, src.url, d.url)) return;
                    if (isMeeting(d.url)) return;
                    flog("bg", `peek: new target from tab ${src.id} -> ${new URL(d.url).hostname}`);
                    await chrome.tabs.remove(d.tabId).catch(() => { }); /* 预期：标签可能已关闭（No tab with id），忽略 */
                    await openPeek(d.url, src.windowId);
                })();
                chrome.webNavigation.onCreatedNavigationTarget.addListener(onTarget);
                return () => chrome.webNavigation.onCreatedNavigationTarget.removeListener(onTarget);
            })(),
            // B5：在 Peek 窗口的页面里（MAIN world，尽早注入）包装 getUserMedia，记录是否有活动的音视频轨道
            (() => {
                const onCommit = (d: chrome.webNavigation.WebNavigationTransitionCallbackDetails) => {
                    if (d.frameId !== 0 || !/^https?:/.test(d.url)) return;
                    void chrome.tabs.get(d.tabId).then(t => {
                        if (!peeks.get().windows.includes(t.windowId)) return;
                        return chrome.scripting.executeScript({ target: { tabId: d.tabId }, world: "MAIN", injectImmediately: true, func: trackMedia });
                    }).catch(() => { }); /* 预期：标签已关 / 受限页面（chrome://、商店）不能注入，忽略 */
                };
                chrome.webNavigation.onCommitted.addListener(onCommit);
                return () => chrome.webNavigation.onCommitted.removeListener(onCommit);
            })(),
            handle("peek:close", (_a, sender) => { const id = sender.tab?.windowId; flog("bg", `peek: close win ${id}`); if (id != null && peeks.get().windows.includes(id)) return chrome.windows.remove(id); }),
            listen("windows.onRemoved", id => void (closedPeek(id), parentOf.delete(id), peeks.update(x => { x.windows = x.windows.filter(w => w !== id); x.little = x.little?.filter(w => w !== id); }))),
            listen("windows.onFocusChanged", focused => {
                if (!settings.store.closeOnBlur || focused === chrome.windows.WINDOW_ID_NONE) return;
                for (const id of peeks.get().windows) if (id !== focused && !peeks.get().little?.includes(id)) { flog("bg", `peek: close on blur win ${id}`); void chrome.windows.remove(id).catch(() => { }); } /* 预期：窗口可能已关闭（No window with id），忽略 */
            }),
        ],
    },
    content: {
        start() {
            let eligible = false, shift = true;
            const check = () => void call<{ ok: boolean; shift: boolean }>("peek:eligible").then(v => { eligible = !!v?.ok; shift = v?.shift !== false; }).catch((e: unknown) => console.warn("[Cat] peek peek:eligible", e)); /* 内容脚本里 @api/ErrorLog 不可达：只 console.warn */
            check();
            const onVis = () => { if (document.visibilityState === "visible") check(); };
            document.addEventListener("visibilitychange", onVis);
            window.addEventListener("focus", check);
            let inPeek = false;
            const onClick = (e: MouseEvent) => {
                if (e.defaultPrevented || window.top !== window) return;
                const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
                if (!a || !/^https?:/.test(a.href) || a.hasAttribute("download")) return;
                const act = decideClick(e, { eligible, inPeek, shift, cross: crossSite(location.href, a.href) });
                if (act === "native") return;
                e.preventDefault(); e.stopImmediatePropagation();
                if (act === "peek") void call("peek:open", a.href);
                else if (act === "little") void call("peek:little", a.href);
                else location.href = a.href;
            };
            // Peek 内 target=_blank 的普通点击：在 Peek 内导航（不嵌套、不开新标签）
            const onBlank = (e: MouseEvent) => {
                if (!inPeek || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
                const a = (e.target as Element | null)?.closest?.("a[href][target]") as HTMLAnchorElement | null;
                if (!a || a.target === "_self" || !/^https?:/.test(a.href)) return;
                e.preventDefault(); location.href = a.href;
            };
            window.addEventListener("click", onBlank, true);
            window.addEventListener("click", onClick, true);
            // 在 Peek 弹窗内：右上角“在标签中打开”按钮 + Esc 关闭（同 Arc）
            let chrome_: HTMLElement | undefined;
            const onKey = (e: KeyboardEvent) => {
                if (e.key !== "Escape" || e.defaultPrevented || (document.activeElement as HTMLElement | null)?.isContentEditable || document.fullscreenElement) return;
                // B5：页面正在用摄像头 / 麦克风（MAIN world 钩子标记 data-cat-media）→ 先确认（同 Arc）
                if (document.documentElement.dataset.catMedia === "1" && !confirm(tr("peek.mediaConfirm"))) return;
                void call("peek:close");
            };
            if (window.top === window) void call<boolean>("peek:isPeek").then(isPeek => {
                if (!isPeek) return;
                inPeek = true;
                document.addEventListener("keydown", onKey);
                chrome_ = document.createElement("arc-peek-bar");
                const root = chrome_.attachShadow({ mode: "closed" });
                const btn = document.createElement("button");
                btn.append(icon("external", 13)); btn.setAttribute("aria-label", tr("peek.openAsTab")); btn.dataset.peek = "expand";
                arcTooltip(btn, tr("peek.cmdMove")); // shadow root 内：样式与提示挂进该 root
                btn.addEventListener("click", () => void call("peek:promote"));
                const st = document.createElement("style");
                st.textContent = `:host{all:initial;position:fixed;top:8px;right:8px;z-index:2147483647;display:flex;gap:6px}button{display:inline-flex;align-items:center;gap:5px;font:12px system-ui,sans-serif;padding:4px 10px;border-radius:7px;border:0;background:rgb(30 30 34/.82);color:#fff;cursor:pointer;opacity:.75;backdrop-filter:blur(8px)}button:hover{opacity:1}button[hidden]{display:none}button{padding:5px 7px}`;
                const sp = document.createElement("button");
                sp.append(icon("splitCols", 13)); sp.setAttribute("aria-label", tr("peek.toSplit")); arcTooltip(sp, tr("peek.toSplit")); sp.dataset.peek = "split"; sp.hidden = true;
                void call<boolean>("peek:canSplit").then(ok => { sp.hidden = !ok; }).catch((e: unknown) => console.warn("[Cat] peek peek:canSplit", e)); /* 内容脚本里 @api/ErrorLog 不可达：只 console.warn */
                sp.addEventListener("click", () => void call("peek:toSplit"));
                const x = document.createElement("button");
                x.append(icon("x", 13)); x.dataset.peek = "close"; x.setAttribute("aria-label", tr("peek.close")); arcTooltip(x, tr("peek.close"));
                x.addEventListener("click", () => void call("peek:close"));
                root.append(st, sp, btn, x);
                document.documentElement.append(chrome_);
            }).catch((e: unknown) => console.warn("[Cat] peek peek:isPeek", e)); /* 内容脚本里 @api/ErrorLog 不可达：只 console.warn */
            return () => { chrome_?.remove(); document.removeEventListener("keydown", onKey); window.removeEventListener("click", onClick, true); window.removeEventListener("click", onBlank, true); document.removeEventListener("visibilitychange", onVis); window.removeEventListener("focus", check); };
        },
    },
});

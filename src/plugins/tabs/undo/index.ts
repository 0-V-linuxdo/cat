/*
 * Undo（§13 / §17：⌘Z / Ctrl+Z 撤销侧边栏操作；清空 Today 后可撤销）
 * - 自动记录关闭的标签（连续关闭合并为一条），撤销时按原位置、原 Space 重新打开，并重新关联固定项；
 * - 其它插件在删除 / 清空 / 取消固定 / 移入文件夹等操作前通过 @api/Undo 记录存储快照；
 * - 侧边栏中按 ⌘Z / Ctrl+Z 撤销（输入框内不拦截），网页中不劫持 ⌘Z。
 */
import { safe } from "@api/ErrorLog";
import { tr } from "@api/i18n";
import { addUndoKind, getUndoKind, setUndoSink, type UndoEntry, type UndoInput } from "@api/Undo";
import { normalizeCombo, eventToCombo } from "@api/Keys";
import { listen } from "@api/ChromeEvents";
import { uid } from "@utils/misc";
import { toast } from "@api/PanelShell";
import { call, handle } from "@api/RPC";
import { definePluginSettings } from "@api/Settings";
import { createPluginStore } from "@api/Storage";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { archiveStore } from "@plugins/tabs/archive";
import { pinnedStore, walk } from "@plugins/tabs/pinnedTabs/model";
import { spacesStore } from "@plugins/spaces/spaceManager/store";
import { type ClosedTab, popEntry, pushEntry, restoreOrder, tabsLabel } from "./logic";

const settings = definePluginSettings({
    maxEntries: { type: OptionType.NUMBER, default: 50, min: 5, max: 500, description: "undo.maxEntries" },
    recordClosedTabs: { type: OptionType.BOOLEAN, default: true, description: "undo.recordClosed" },
});

export const undoStore = createPluginStore<{ stack: UndoEntry[] }>("undo", () => ({ stack: [] }));

const skip = (url?: string) => !url || /^(chrome|edge|about|chrome-extension|devtools):/.test(url) && !url.includes("split.html");

async function push(e: UndoInput) {
    const entry: UndoEntry = { ...e, id: uid(), at: Date.now() };
    await undoStore.update(x => { x.stack = pushEntry(x.stack, entry, settings.store.maxEntries); });
}

async function undo(kind?: string): Promise<string | null> {
    let entry: UndoEntry | undefined;
    await undoStore.update(x => { const r = popEntry(x.stack, kind); entry = r.entry; x.stack = r.rest; });
    if (!entry) return null;
    const fn = getUndoKind(entry.kind);
    if (!fn) return null;
    await fn(entry.data, entry);
    return entry.label;
}

async function reopenTabs(data: unknown, entry: UndoEntry) {
    const tabs = restoreOrder(data as ClosedTab[]);
    const map = new Map<number, number>();
    const wins = new Set((await chrome.windows.getAll({ windowTypes: ["normal"] })).map(w => w.id));
    for (const [i, t] of tabs.entries()) {
        const sameWin = t.windowId != null && wins.has(t.windowId);
        const nt = await chrome.tabs.create({ url: t.url, index: sameWin && t.index >= 0 ? t.index : undefined, windowId: sameWin ? t.windowId : undefined, active: i === tabs.length - 1 }).catch(() => null); /* 预期：原窗口已关（No window with id）时建标签失败，跳过该项 */
        if (nt?.id != null) map.set(t.oldId, nt.id);
    }
    await spacesStore.update(x => { for (const t of tabs) { const n = map.get(t.oldId); if (n != null && t.spaceId && x.spaces.some(s => s.id === t.spaceId)) x.tabSpace[n] = t.spaceId; } });
    // 固定项保留着旧 tabId，重新关联到新标签
    await pinnedStore.update(x => { for (const list of Object.values(x.bySpace)) for (const n of walk(list)) { const m = n.tabId != null ? map.get(n.tabId) : undefined; if (m != null) n.tabId = m; } });
    // 这些标签同时进了归档：撤销即从归档中移除
    const urls = new Set(tabs.map(t => t.url));
    await archiveStore.update(x => { x.items = x.items.filter(i => !(urls.has(i.url) && i.closedAt >= entry.at - 5000)); });
}

function backgroundStart() {
    const cache = new Map<number, ClosedTab>();
    const remember = (t: chrome.tabs.Tab) => {
        if (t.id == null || !t.url) return;
        cache.set(t.id, { oldId: t.id, url: t.url, title: t.title ?? "", index: t.index, windowId: t.windowId, spaceId: spacesStore.get().tabSpace[t.id] });
    };
    void safe(chrome.tabs.query({}).then(ts => ts.forEach(remember)), "tabs.query");
    setUndoSink(e => void push(e));
    return [
        () => setUndoSink(null),
        addUndoKind("tabsClosed", reopenTabs),
        addUndoKind("stores", async data => { const { items } = data as { items: { key: string; value: unknown }[] }; await chrome.storage.local.set(Object.fromEntries(items.map(i => [i.key, i.value]))); }),
        addUndoKind("store", async data => { const { key, value } = data as { key: string; value: unknown }; await chrome.storage.local.set({ [key]: value }); }),
        listen("tabs.onCreated", remember),
        listen("tabs.onUpdated", (_id, _c, t) => remember(t)),
        listen("tabs.onMoved", id => void chrome.tabs.get(id).then(remember).catch(() => { })), /* 预期：标签可能已关闭（No tab with id），忽略 */
        listen("tabs.onActivated", ({ tabId }) => void chrome.tabs.get(tabId).then(remember).catch(() => { })), /* 预期：标签可能已关闭（No tab with id），忽略 */
        listen("tabs.onRemoved", (id, info) => {
            const c = cache.get(id);
            cache.delete(id);
            if (!c || info.isWindowClosing || skip(c.url) || !settings.store.recordClosedTabs) return;
            void push({ kind: "tabsClosed", label: tabsLabel(1), data: [{ ...c, spaceId: c.spaceId ?? spacesStore.get().tabSpace[id] }] });
        }),
        handle("undo:push", ([e]) => push(e as UndoInput)),
        handle("undo:run", ([kind]) => undo(kind as string | undefined)),
        handle("undo:list", () => undoStore.get().stack.map(e => ({ label: e.label, at: e.at })).toReversed()),
    ];
}

const UNDO_KEY = normalizeCombo("Mod+Z");

async function undoFromPanel(kind?: string) {
    const label = await safe(call<string | null>("undo:run", kind), "undo:run", null);
    toast(label ? tr("undo.done", label) : tr("undo.nothing"));
}

export default definePlugin({
    name: "Undo",
    authors: [Devs.ArcSidebar],
    label: "plugin.undo.label",
    description: "plugin.undo.desc",
    tags: ["tabs"],
    enabledByDefault: true,
    settings,
    commands: [
        { id: "undo.last", label: "undo.cmdUndo", keywords: ["undo", "plugin.undo.label"], context: "panel", run: () => undoFromPanel() },
        { id: "undo.reopenTab", label: "undo.cmdReopen", keywords: ["reopen closed tab", "undo close"], context: "panel", defaultKey: "Mod+Shift+T", run: () => undoFromPanel("tabsClosed") },
    ],
    background: { start: backgroundStart },
    panel: {
        start() {
            const onKey = (e: KeyboardEvent) => {
                const t = e.target as HTMLElement | null;
                if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
                if (eventToCombo(e) !== UNDO_KEY) return;
                e.preventDefault();
                void undoFromPanel();
            };
            document.addEventListener("keydown", onKey);
            return () => document.removeEventListener("keydown", onKey);
        },
    },
});

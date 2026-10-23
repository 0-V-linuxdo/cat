/*
 * Archive（§6.4）：关闭的标签进入归档；可搜索、恢复、清空，并支持右键“归档以下标签”。
 * 待确认项选择：Archive Below = 关闭列表中该项以下的所有 Today 标签。
 */
import { tr } from "@api/i18n";
import { iconText } from "@api/spaceIcons";
import { recordStoreUndo } from "@api/Undo";
import { listen } from "@api/ChromeEvents";
import { dispatch } from "@api/Events";
import { uid } from "@utils/misc";
import { handle } from "@api/RPC";
import { definePluginSettings } from "@api/Settings";
import { createPluginStore } from "@api/Storage";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { spacesStore } from "@plugins/spaces/spaceManager/store";
import { type PinNode, pinnedStore, walk } from "@plugins/tabs/pinnedTabs/model";

export interface ArchivedTab { id: string; url: string; title: string; closedAt: number; spaceId?: string; reason: "closed" | "auto"; /** 归档的文件夹（含子项，url 为空） */ folder?: PinNode }
export const archiveStore = createPluginStore<{ items: ArchivedTab[] }>("archive", () => ({ items: [] }));

const settings = definePluginSettings({
    maxItems: { type: OptionType.NUMBER, default: 1000, min: 50, max: 10000, description: "archive.maxItems" },
});

/** 自动归档插件在关闭前标记，以区分原因 */
export const autoClosing = new Set<number>();
/** 随文件夹一起归档的标签：关闭时不再逐个记成归档标签（文件夹条目已包含它们） */
const folderClosing = new Set<number>();

/** Put back 文件夹（urlbar-menus-followup.md「菜单定案」§3：unarchiveAndPutBackItem + collectChildren，子项整体取回）：
 *  放回原空间固定区末尾（原位置 ⛔），id 与现有项冲突时换新 id；子项不自动打开标签（是否打开 ⛔）。 */
export function putBackFolder(bySpace: Record<string, PinNode[]>, spaceId: string, folder: PinNode) {
    const node = structuredClone(folder);
    const used = new Set(Object.values(bySpace).flatMap(l => [...walk(l)].map(n => n.id)));
    for (const n of walk([node])) if (used.has(n.id)) n.id = uid();
    (bySpace[spaceId] ??= []).push(node);
    return node;
}
const cache = new Map<number, { url: string; title: string }>();

const skip = (url?: string) => !url || /^(chrome|edge|about|chrome-extension):/.test(url) && !url.includes("split.html");

export default definePlugin({
    name: "Archive",
    authors: [Devs.ArcSidebar],
    label: "plugin.archive.label",
    description: "plugin.archive.desc",
    tags: ["tabs"],
    enabledByDefault: true,
    settings,
    commands: [
        { id: "archive.clear", label: "archive.clear", keywords: ["clear archive"], context: "background", run: () => { recordStoreUndo(tr("archive.clear"), archiveStore); return archiveStore.update(x => { x.items = []; }); } },
        // ⌥⇧T 默认键 Arc 没有（审计 52193 多出项 #7）：默认不绑键，命令保留
        { id: "archive.reopen", label: "archive.reopen", keywords: ["reopen"], context: "background", run: () => chrome.sessions.restore() },
    ],
    contextMenuItems: {
        tab: [
            { id: "below", label: "archive.below", order: 80, visible: t => !!t.below?.length, run: t => chrome.tabs.remove(t.below!) },
            { id: "above", label: "archive.above", order: 81, visible: t => !!t.above?.length, run: t => chrome.tabs.remove(t.above!) },
            { id: "others", label: "archive.others", order: 82, visible: t => !!(t.above?.length || t.below?.length), run: t => chrome.tabs.remove([...(t.above ?? []), ...(t.below ?? [])]) },
        ],
    },
    background: {
        async start() {
            for (const t of await chrome.tabs.query({})) if (t.id != null && t.url) cache.set(t.id, { url: t.url, title: t.title ?? "" });
            return [
                listen("tabs.onUpdated", (id, _c, t) => { if (t.url) cache.set(id, { url: t.url, title: t.title ?? "" }); }),
                listen("tabs.onCreated", t => { if (t.id != null && t.url) cache.set(t.id, { url: t.url, title: t.title ?? "" }); }),
                listen("tabs.onRemoved", (id, info) => {
                    const c = cache.get(id);
                    cache.delete(id);
                    if (folderClosing.delete(id)) return;
                    const reason = autoClosing.delete(id) ? "auto" : "closed";
                    if (info.isWindowClosing || !c || skip(c.url)) return;
                    const spaceId = spacesStore.get().tabSpace[id];
                    void archiveStore.update(x => {
                        x.items.unshift({ id: uid(), url: c.url, title: c.title || c.url, closedAt: Date.now(), spaceId, reason });
                        x.items.length = Math.min(x.items.length, settings.store.maxItems);
                    });
                    dispatch("tabArchived", { url: c.url, title: c.title, reason }, { broadcast: true });
                }),
                // 文件夹 Delete / Archive Folder（「菜单定案」§3，同一 archive 动作）：文件夹连同子项成为一条归档记录
                handle("archive:addFolder", async ([node, spaceId, tabIds]) => {
                    const f = node as PinNode;
                    for (const t of (tabIds as number[] | undefined) ?? []) folderClosing.add(t);
                    await archiveStore.update(x => {
                        x.items.unshift({ id: uid(), url: "", title: f.title || tr("folders.newName"), closedAt: Date.now(), spaceId: spaceId as string | undefined, reason: "closed", folder: f });
                        x.items.length = Math.min(x.items.length, settings.store.maxItems);
                    });
                }),
                handle("archive:restore", async ([id]) => {
                    const it = archiveStore.get().items.find(i => i.id === id);
                    if (!it) return;
                    if (it.folder) {
                        const sp = it.spaceId && spacesStore.get().spaces.some(s => s.id === it.spaceId) ? it.spaceId : spacesStore.get().activeId;
                        await pinnedStore.update(x => { putBackFolder(x.bySpace, sp, it.folder!); });
                    } else {
                        const tab = await chrome.tabs.create({ url: it.url });
                        if (tab.id != null && it.spaceId) await spacesStore.update(x => { x.tabSpace[tab.id!] = it.spaceId!; });
                    }
                    await archiveStore.update(x => { x.items = x.items.filter(i => i.id !== id); });
                    // 恢复到其它空间时返回该空间名，界面给出提示（同 Arc）
                    const sp = it.spaceId && it.spaceId !== spacesStore.get().activeId ? spacesStore.get().spaces.find(s => s.id === it.spaceId) : undefined;
                    return sp ? `${iconText(sp.icon)} ${sp.name}`.trim() : null;
                }),
            ];
        },
    },
});

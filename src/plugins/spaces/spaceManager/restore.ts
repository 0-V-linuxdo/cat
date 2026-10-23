/*
 * 浏览器重启后 Today 标签找回自己的 Space：标签 id 全变了，tabSpace（tabId → space）失效。
 * 平时持续记录快照 [{id, url, title, index, space}]；启动时按 网址（同网址再按标题、位置最近）把恢复出来的标签挂回原 Space，
 * 匹配不上的留在当前 Space。
 */
import { safe } from "@api/ErrorLog";
import { createPluginStore } from "@api/Storage";
import { discardKeep as discardKeepApi } from "@api/Tabs";
import { flog } from "@api/FocusLog";
import { spacesStore } from "./store";
import { pinnedStore, walk } from "@plugins/tabs/pinnedTabs/model";
import { favStore } from "@plugins/spaces/favorites/store";
import { emitTabIdRemap } from "@api/TabIdRemap";

interface Snap { id: number; url: string; title?: string; index: number; win?: number; space?: string }
export const snapStore = createPluginStore<{ tabs: Snap[]; at?: number }>("tabSnapshot", () => ({ tabs: [] }));

let restoring = false;
/** 启动后先不写快照（等恢复完成或确认不是浏览器启动）；退出时窗口关闭也不写（否则快照会被逐个关闭的标签清空） */
let enabled = false;
let frozen = false;
export function enableSnapshots() { enabled = true; scheduleSnapshot(); }
export function freezeSnapshots() { frozen = true; clearTimeout(timer); }
/** 只是关了一个窗口（还有别的窗口）：恢复记录 */
export async function maybeUnfreeze() { if (frozen && (await chrome.windows.getAll({ windowTypes: ["normal"] })).length) { frozen = false; scheduleSnapshot(); } }
let timer: ReturnType<typeof setTimeout> | undefined;
const norm = (u?: string) => (u ?? "").replace(/#.*$/, "").replace(/\/$/, "");

/** 记录快照（去抖 800ms；启动恢复期间不写，免得覆盖旧快照）。
 * force（spaces.snapshotNow）：无视冻结 / 未启用立即写，返回写入条数（52005：harness 关过窗口后 frozen，快照永远不写） */
export function scheduleSnapshot(force = false): Promise<number> | undefined {
    if (force) { clearTimeout(timer); if (restoring) return Promise.resolve(0); frozen = false; enabled = true; return writeSnapshot(); }
    if (restoring || !enabled || frozen) return;
    clearTimeout(timer);
    timer = setTimeout(() => { if (!restoring && enabled && !frozen) void writeSnapshot(); }, 800);
}
async function writeSnapshot(): Promise<number> {
    {
        const d = spacesStore.get();
        const tabs = await chrome.tabs.query({ windowType: "normal" });
        const out: Snap[] = [];
        for (const t of tabs) {
            const space = t.id != null ? d.tabSpace[t.id] : undefined;
            const url = t.url || t.pendingUrl;
            if (t.id == null || !url) continue; // 所有标签都记（不止 Today）：其它按 tabId 的状态也要靠它重映射
            out.push({ id: t.id, url, title: t.title, index: t.index, win: t.windowId, space });
        }
        await snapStore.update(x => { x.tabs = out; x.at = Date.now(); });
        return out.length;
    }
}

/** 丢弃（卸载）标签；Chromium 丢弃时可能换新 id（onReplaced），把 Space 归属搬到新 id，否则标签会从 Today 消失 */
export async function discardKeep(id: number) {
    const nid = await discardKeepApi(id);
    flog("bg", `restore: discard ${id} -> ${nid ?? "fail"}`);
    return nid;
}
export async function moveTabSpace(from: number, to: number) {
    await spacesStore.update(x => { const sp = x.tabSpace[from]; if (sp) { x.tabSpace[to] = sp; delete x.tabSpace[from]; } });
}

/** 按快照把标签挂回 Space。onlyIds：只处理这些标签（自测）；默认处理所有不在快照里的（= 重启后的新 id）标签 */
export async function restoreFromSnapshot(onlyIds?: number[], settleMs = 0) {
    restoring = true;
    try {
        if (settleMs) await new Promise(r => setTimeout(r, settleMs));
        const snap = snapStore.get().tabs;
        flog("bg", `restore: snapshot ${snap.length} tabs, only=${onlyIds?.length ?? "all"}`);
        if (!snap.length) return 0;
        const known = new Set(snap.map(s => s.id));
        const valid = new Set(spacesStore.get().spaces.map(s => s.id));
        const tabs = (await chrome.tabs.query({ windowType: "normal" })).filter(t => t.id != null && (onlyIds ? onlyIds.includes(t.id) : !known.has(t.id)));
        const pool = snap;
        const idMap = new Map<number, number>();
        const used = new Set<Snap>();
        const assign: Record<number, string> = {};
        for (const t of tabs) {
            const url = norm(t.url || t.pendingUrl);
            const cands = pool.filter(s => !used.has(s) && norm(s.url) === url);
            if (!cands.length) continue;
            const best = cands.toSorted((a, b) => (Number(b.title === t.title) - Number(a.title === t.title)) || Math.abs(a.index - t.index) - Math.abs(b.index - t.index))[0];
            used.add(best);
            idMap.set(best.id, t.id!);
            if (best.space && valid.has(best.space)) assign[t.id!] = best.space;
        }
        // 浏览器没有恢复标签（Chrome 默认“打开新标签页”）：Today 标签按快照重新打开（不激活、随后丢弃以免全部加载），
        // 固定 / 收藏 自己保留条目，不在这里重开
        if (!onlyIds && !Object.keys(assign).length) {
            const claimed = new Set<string>();
            for (const l of Object.values(pinnedStore.get().bySpace)) for (const n of walk(l)) if (n.url) claimed.add(norm(n.url));
            for (const f of favStore.get().items) claimed.add(norm(f.url));
            const win = (await chrome.windows.getAll({ windowTypes: ["normal"] }))[0];
            const todo = pool.filter(s => !!s.space && valid.has(s.space) && /^https?:/.test(s.url) && !claimed.has(norm(s.url))).toSorted((a, b) => a.index - b.index).slice(0, 60);
            if (win?.id != null) for (const s of todo) {
                const t = await safe(chrome.tabs.create({ windowId: win.id, url: s.url, active: false }), "tabs.create (restore)", undefined);
                if (t?.id == null) continue;
                assign[t.id] = s.space!; idMap.set(s.id, t.id);
                setTimeout(() => void discardKeep(t.id!), 1500);
            }
        }
        flog("bg", `restore: matched/reopened ${Object.keys(assign).length}, remapped ${idMap.size}`);
        const alive = new Set((await chrome.tabs.query({})).map(t => t.id));
        await spacesStore.update(x => {
            for (const [id, sp] of Object.entries(assign)) x.tabSpace[id] = sp;
            if (!onlyIds) for (const k of Object.keys(x.tabSpace)) if (!alive.has(Number(k))) delete x.tabSpace[k];
            for (const [sp, old] of Object.entries(x.lastTab ?? {})) { const to = idMap.get(old); if (to != null) x.lastTab[sp] = to; else if (!onlyIds && !alive.has(old)) delete x.lastTab[sp]; }
        });
        await emitTabIdRemap(idMap, onlyIds ? new Set([...alive].filter((i): i is number => i != null)) : new Set([...alive].filter((i): i is number => i != null)));
        return Object.keys(assign).length;
    } finally {
        restoring = false;
        enabled = true;
        scheduleSnapshot();
    }
}

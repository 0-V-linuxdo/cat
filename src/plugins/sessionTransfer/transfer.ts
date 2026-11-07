/* 流程编排（DESIGN §5）：复制 / 导出 / 导入（含快照、回滚、撤销、读回校验）/ 清除站点数据。
 * 每个入口先过 perm.ensureCookies()（G2）。无常驻：唯一的监听是等页面加载用的 tabs.onUpdated，操作结束（含失败）即移除，另设 30 s 操作级超时并清除。 */
import { applyCookies, applyStorage, clearStorage, newSnapshot, removeSiteCookies, restoreCookies, restoreStorage, verifyStorage, type Snapshot } from "./apply";
import { collect } from "./collect";
import { SessionError, fileName, originOf, pack, type Artifact, type FileArtifact, type Parsed } from "./container";
import { ensureCookies } from "./perm";

export const OP_TIMEOUT_MS = 30_000;

export type Exported = (Artifact | FileArtifact) & { name?: string };

/** 复制会话：令牌（≤450 000 字符）否则文件。不写剪贴板——交给 ui（要在手势内）。 */
export async function copySession(tab: chrome.tabs.Tab, passphrase?: string): Promise<Exported> {
    await ensureCookies();
    const p = await collect(tab);
    const a = await pack(p, passphrase);
    return a.kind === "file" ? { ...a, name: fileName(p.o, a.passphrase) } : a;
}
/** 导出文件：总是文件 */
export async function exportFileSession(tab: chrome.tabs.Tab, passphrase?: string): Promise<FileArtifact & { name: string }> {
    await ensureCookies();
    const p = await collect(tab);
    const a = await pack(p, passphrase, true) as FileArtifact;
    return { ...a, name: fileName(p.o, a.passphrase) };
}

/** 等标签页 complete。监听 + 超时在结束时一定移除；arm 先于触发动作调用，避免错过事件。 */
export function armLoadWait(tabId: number, ms = OP_TIMEOUT_MS): { done: Promise<void>; cancel(): void } {
    let off = () => {};
    const done = new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => { off(); reject(new SessionError("tab-timeout")); }, ms);
        const l = (id: number, info: { status?: string }) => { if (id === tabId && info.status === "complete") { off(); resolve(); } };
        off = () => { clearTimeout(t); chrome.tabs.onUpdated.removeListener(l); };
        chrome.tabs.onUpdated.addListener(l);
    });
    done.catch(() => undefined); // 取消时不留未处理拒绝
    return { done, cancel: () => off() };
}

export interface ImportOpts { reload: boolean }
export interface ImportResult { applied: number; skipped: number; storageItems: number; storageFailed: number; drift: number; tabId: number; origin: string; reloaded: boolean; snapshot: Snapshot }

/** 导入：先写 cookie（首个请求就带登录态）→ 开新标签 → complete 后再补写 cookie + 写 storage → reload → 读回校验。任一关键步失败 → 回滚并关掉新标签。 */
export async function importSession(p: Parsed, opts: ImportOpts): Promise<ImportResult> {
    await ensureCookies();
    const origin = originOf(p.origin);
    const snap = newSnapshot(origin);
    const storageItems = p.local.length + p.session.length;
    let tabId: number | undefined;
    try {
        const first = await applyCookies(p.cookies, origin, snap);
        if (p.cookies.length > 0 && first.applied === 0) throw new SessionError("all-skipped");
        const tab = await chrome.tabs.create({ url: origin, active: true });
        if (tab.id == null) throw new SessionError("no-tab");
        tabId = tab.id; snap.tabId = tabId; snap.createdTab = true;
        const w1 = armLoadWait(tabId);
        try { if ((await chrome.tabs.get(tabId)).status === "complete") w1.cancel(); else await w1.done; } finally { w1.cancel(); }
        // 第二次写 cookie（SC 同样写两次）+ 写存储
        const second = await applyCookies(p.cookies, origin, snap);
        let storageFailed = await applyStorage(tabId, p.local, p.session, snap);
        let reloaded = false, drift = 0;
        if (opts.reload) {
            const w2 = armLoadWait(tabId);
            try { await chrome.tabs.reload(tabId); await w2.done; } finally { w2.cancel(); }
            reloaded = true;
            // A5：读回校验；SPA 在 unload / 启动时回写了旧值 → 补写并再 reload 一次
            drift = await verifyStorage(tabId, p.local, p.session);
            if (drift > 0) {
                storageFailed = await applyStorage(tabId, p.local, p.session, snap);
                const w3 = armLoadWait(tabId);
                try { await chrome.tabs.reload(tabId); await w3.done; } finally { w3.cancel(); }
                drift = await verifyStorage(tabId, p.local, p.session);
            }
        }
        const applied = Math.max(first.applied, second.applied);
        return { applied, skipped: p.cookies.length - applied, storageItems, storageFailed, drift, tabId, origin, reloaded, snapshot: snap };
    } catch (e) {
        await rollback(snap);
        if (tabId != null) { try { await chrome.tabs.remove(tabId); } catch { /* 已关闭 */ } }
        throw e instanceof SessionError ? e : new SessionError("storage-failed");
    }
}

export async function rollback(snap: Snapshot): Promise<number> {
    return await restoreCookies(snap) + await restoreStorage(snap);
}

/** 撤销一次导入：写回旧 cookie / 存储并刷新标签（标签还在时）。返回失败数。 */
export async function undoImport(snap: Snapshot): Promise<number> {
    await ensureCookies();
    let fail = await restoreCookies(snap);
    let alive = false;
    if (snap.tabId != null) { try { alive = !!(await chrome.tabs.get(snap.tabId)); } catch { alive = false; } }
    if (alive) {
        fail += await restoreStorage(snap);
        const w = armLoadWait(snap.tabId!);
        try { await chrome.tabs.reload(snap.tabId!); await w.done; } catch { fail++; } finally { w.cancel(); }
    }
    return fail;
}

export interface ClearWhat { cookies: boolean; local: boolean; session: boolean }
/** 清除站点数据（只当前 origin）→ reload */
export async function clearSite(tab: chrome.tabs.Tab, what: ClearWhat): Promise<{ cookies: number }> {
    if (tab.id == null) throw new SessionError("no-tab");
    if (!/^https?:\/\//i.test(tab.url ?? "")) throw new SessionError("bad-scheme");
    if (!what.cookies && !what.local && !what.session) throw new SessionError("aborted");
    let cookies = 0;
    if (what.cookies) { await ensureCookies(); cookies = await removeSiteCookies(tab.url!, tab.id); }
    await clearStorage(tab.id, what.local, what.session);
    const w = armLoadWait(tab.id);
    try { await chrome.tabs.reload(tab.id); await w.done; } catch { /* 刷新失败不算清除失败 */ } finally { w.cancel(); }
    return { cookies };
}

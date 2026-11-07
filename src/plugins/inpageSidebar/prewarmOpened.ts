/* 补丁 inpage-prewarmopened-persist：prewarmOpened（「这个窗口的原生是首次手势预热开的」）= 带持久化的 Set<windowId>。
 * 读写接口和原来的 Set 完全一样（add / delete / has / clear / 迭代），同步读的永远是内存；写同时镜像到 chrome.storage.session（记录 { tabId, windowId, t }）。
 * SW 重启后 load()：读出记录 → 过期（ttlMs）的丢、tabId / windowId 已无效的丢（chrome.tabs.get 失败 / tab 不在该 window / chrome.windows.get 失败）→ 合并进内存。
 *  · 异步加载竞态：load 期间内存里已经被改过的窗口（add / delete）以内存为准，不被存储覆盖；ready 在加载完成（或 loadTimeoutMs 超时 / 出错 / 没有 storage.session）后 resolve，loaded 同步可读。
 *  · storage.session 不可用（没有该区 / get 抛错 / set 拒绝）：回退纯内存，不抛错、不重试风暴。
 *  · 约束：SW 代码，不用 window / document；不 import chrome（所有依赖由调用方注入，单测用假的）。 */
import { PREWARM_OPENED } from "./constants";

export interface PrewarmRec { tabId: number; windowId: number; t: number }
export interface StorageAreaLike { get(key: string): Promise<Record<string, unknown>>; set(items: Record<string, unknown>): Promise<void> }
export interface PrewarmOpenedDeps {
    now: () => number;
    /** chrome.storage.session；不可用 = undefined（回退内存） */
    area: StorageAreaLike | undefined;
    /** 预热那一刻该窗口的激活标签（记录里的 tabId；取不到 = 只记内存，不持久化） */
    tabOf: (windowId: number) => number | undefined;
    /** chrome.tabs.get：标签不存在 = reject 或 undefined */
    getTab: (tabId: number) => Promise<{ windowId?: number } | undefined>;
    /** chrome.windows.get 能取到 = true */
    hasWindow: (windowId: number) => Promise<boolean>;
    ttlMs?: number; key?: string; loadTimeoutMs?: number;
    /** 可选：每次 add / delete / clear 的钩子（调试追踪用，语义同 trace.ts 的 TracedSet：delete 只在真删了时回调，clear 只在非空时回调） */
    onOp?: (op: "add" | "delete" | "clear", info: { w?: number; had?: boolean; n?: number }) => void;
}

const isRec = (r: unknown): r is PrewarmRec => !!r && typeof r === "object" && Number.isInteger((r as PrewarmRec).tabId) && Number.isInteger((r as PrewarmRec).windowId) && Number.isFinite((r as PrewarmRec).t);

export class PrewarmOpened extends Set<number> {
    /** 加载完成（含失败 / 超时 / 没有 storage.session）后 resolve；从不 reject */
    readonly ready: Promise<void>;
    private _loaded = false;
    private readonly recs = new Map<number, PrewarmRec>();
    /** 加载开始后被 add / delete 过的窗口：以内存为准 */
    private readonly touched = new Set<number>();
    /** 这个 SW 生命里只由存储恢复、还没被本生命的 add 确认过的窗口（sweep 用） */
    readonly restored = new Set<number>();
    private chain: Promise<void> = Promise.resolve();
    private broken = false;
    constructor(private readonly d: PrewarmOpenedDeps) {
        super();
        if (!d.area) { this._loaded = true; this.ready = Promise.resolve(); return; }
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<void>(res => { timer = setTimeout(res, d.loadTimeoutMs ?? PREWARM_OPENED.loadTimeoutMs); });
        this.ready = Promise.race([this.load().catch(() => { this.broken = true; }), timeout]).then(() => { this._loaded = true; clearTimeout(timer); });
    }
    get loaded() { return this._loaded; }
    get key() { return this.d.key ?? PREWARM_OPENED.key; }
    tabIdOf(w: number) { return this.recs.get(w)?.tabId; }

    override add(w: number): this {
        const had = this.has(w); super.add(w); this.touched.add(w); this.restored.delete(w); this.d.onOp?.("add", { w, had });
        const tabId = this.d.tabOf(w);
        if (tabId != null) { this.recs.set(w, { tabId, windowId: w, t: this.d.now() }); this.persist(); } else if (this.recs.delete(w)) this.persist();
        return this;
    }
    override delete(w: number): boolean {
        const had = super.delete(w); this.touched.add(w); this.restored.delete(w);
        if (this.recs.delete(w)) this.persist();
        if (had) this.d.onOp?.("delete", { w });
        return had;
    }
    override clear(): void {
        const n = this.size; for (const w of this) this.touched.add(w);
        super.clear(); this.restored.clear(); if (n) this.d.onOp?.("clear", { n });
        if (this.recs.size) { this.recs.clear(); this.persist(); }
    }
    /** 补丁 inpage-restoreonclose-persist：记录里的 tabId 跟随窗口当前激活标签（onActivated）。restoreOnClose 不随标签关闭清除（热路径行为不变：标签关了、原生还开着，关原生时页内照样恢复），
     *  所以记录的 tabId 必须一直指向仍然存在的标签，否则 SW 回收后加载校验（标签在不在该窗口）会把仍然有效的标记误丢。只改 tabId、不动 t（寿命从打标算起）；没有记录 = 不动。 */
    retab(w: number, tabId: number) {
        const r = this.recs.get(w); if (!r || r.tabId === tabId) return;
        this.recs.set(w, { ...r, tabId }); this.persist();
    }
    /** 标签关闭：记录里的 tabId 就是它 → 清（预热标记只对「当时那个标签所在窗口的原生」有效，标签没了就不再可信） */
    removeTab(tabId: number) { for (const [w, r] of Array.from(this.recs)) if (r.tabId === tabId) this.delete(w); }

    private persist() {
        const area = this.d.area; if (!area || this.broken) return;
        this.chain = this.chain.then(() => area.set({ [this.key]: Object.fromEntries(this.recs) })).catch(() => { this.broken = true; }); // 写失败 = 之后不再写（回退内存）
    }
    private async load() {
        const area = this.d.area!; const got = await area.get(this.key); const raw = got?.[this.key];
        if (!raw || typeof raw !== "object") return;
        const ttl = this.d.ttlMs ?? PREWARM_OPENED.ttlMs; const now = this.d.now(); let pruned = false;
        for (const [k, r] of Object.entries(raw as Record<string, unknown>)) {
            if (!isRec(r) || String(r.windowId) !== k) { pruned = true; continue; }
            if (now - r.t > ttl || r.t > now + 60_000) { pruned = true; continue; } // 过期 / 时间在未来（时钟被调）
            let ok = false;
            try { const t = await this.d.getTab(r.tabId); ok = !!t && t.windowId === r.windowId && await this.d.hasWindow(r.windowId); } catch { ok = false; }
            if (!ok) { pruned = true; continue; }
            if (this.touched.has(r.windowId)) continue; // 加载期间内存已经改过：以内存为准
            super.add(r.windowId); this.recs.set(r.windowId, r); this.restored.add(r.windowId);
        }
        if (pruned) this.persist();
    }
}

/** 补丁 inpage-restoreonclose-persist：restoreOnClose（「为进受限页 / 窗口级预开而收起了页内的窗口：原生关了要恢复」）= 同一个存取层（同一份读写 / 过期 / 校验 / 加载竞态 / 回退逻辑），另起存储键（RESTORE_ON_CLOSE.key）。
 *  与 PrewarmOpened 的区别只在用法：不随标签关闭清除（用 retab 跟随激活标签）；恢复来的标记（restored）只用于「原生关了 → 恢复页内」，不参与「到达标签 / 握手」的自动切换（见 background.ts）。 */
export class RestoreOnClose extends PrewarmOpened {}

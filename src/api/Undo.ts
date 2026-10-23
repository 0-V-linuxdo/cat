/*
 * 撤销 API：任何上下文的插件在执行可撤销操作前调用 recordUndo / recordStoreUndo，
 * 记录会发往 background 的 Undo 功能；Undo 关闭时调用是空操作（插件之间互不依赖）。
 * 撤销的执行逻辑按 kind 注册（addUndoKind），在 background 中运行。
 */
import { safe } from "@api/ErrorLog";
import { getContext } from "@api/context";
import { call } from "@api/RPC";

export interface UndoEntry { id: string; kind: string; label: string; at: number; data: unknown }
export type UndoInput = Pick<UndoEntry, "kind" | "label" | "data">;

let sink: ((e: UndoInput) => void) | null = null;
export const setUndoSink = (s: typeof sink) => { sink = s; };

const kinds = new Map<string, (data: unknown, entry: UndoEntry) => Promise<void> | void>();
export function addUndoKind(kind: string, revert: (data: unknown, entry: UndoEntry) => Promise<void> | void) {
    kinds.set(kind, revert);
    return () => { if (kinds.get(kind) === revert) kinds.delete(kind); };
}
export const getUndoKind = (kind: string) => kinds.get(kind);

export function recordUndo(kind: string, label: string, data: unknown) {
    const e: UndoInput = { kind, label, data };
    if (getContext() === "background") sink?.(e);
    else void safe(call("undo:push", e), "undo:push");
}

/** 多个存储的快照合成一条撤销记录（先 snapshot，操作完成后再 push，避免被期间关闭标签等记录抢先） */
export function snapshotStores(stores: { key: string; get(): unknown }[]) {
    const items = stores.map(s => ({ key: s.key, value: structuredClone(s.get()) }));
    return (label: string) => recordUndo("stores", label, { items });
}

/** 记录插件存储（PluginStore）的整体快照；撤销时原样写回 */
export function recordStoreUndo(label: string, store: { key: string; get(): unknown }) {
    recordUndo("store", label, { key: store.key, value: structuredClone(store.get()) });
}

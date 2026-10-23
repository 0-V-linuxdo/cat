/*
 * 跨设备同步（Arc Sync 的可移植版）：把空间 / 固定项 / 收藏的结构（不含标签 id）压成 JSON，
 * 分块写进 chrome.storage.sync（随 Chrome 账号同步，单项 8KB、总计 100KB 上限）。
 */
const CHUNK = 7000;
const META = "arcSync:meta";

type Rec = Record<string, unknown>;
const strip = (v: unknown): unknown => Array.isArray(v) ? v.map(strip) : v && typeof v === "object"
    ? Object.fromEntries(Object.entries(v as Rec).filter(([k]) => k !== "tabId").map(([k, x]) => [k, strip(x)])) : v;

/** 从本地数据提取可同步的部分 */
export function pickSyncable(local: Rec): Rec {
    const sp = local["data:spaces"] as Rec | undefined;
    return {
        spaces: sp ? { spaces: sp.spaces, routes: sp.routes } : undefined,
        pinned: strip(local["data:pinned"]),
        favorites: strip(local["data:favorites"]),
    };
}

export function chunk(json: string): string[] {
    const out: string[] = [];
    for (let i = 0; i < json.length; i += CHUNK) out.push(json.slice(i, i + CHUNK));
    return out;
}

export async function syncUp(): Promise<number> {
    const local = await chrome.storage.local.get(["data:spaces", "data:pinned", "data:favorites"]);
    const parts = chunk(JSON.stringify(pickSyncable(local)));
    const old = (await chrome.storage.sync.get(META))[META] as { n: number } | undefined;
    await chrome.storage.sync.set({ ...Object.fromEntries(parts.map((p, i) => [`arcSync:${i}`, p])), [META]: { n: parts.length, at: Date.now() } });
    if (old && old.n > parts.length) await chrome.storage.sync.remove(Array.from({ length: old.n - parts.length }, (_, i) => `arcSync:${parts.length + i}`));
    return parts.length;
}

/** 合并云端结构到本地：空间列表 / 固定项 / 收藏用云端版本，保留本地的标签归属 */
export async function syncDown(): Promise<boolean> {
    const meta = (await chrome.storage.sync.get(META))[META] as { n: number } | undefined;
    if (!meta?.n) return false;
    const keys = Array.from({ length: meta.n }, (_, i) => `arcSync:${i}`);
    const got = await chrome.storage.sync.get(keys);
    const data = JSON.parse(keys.map(k => got[k] as string).join("")) as Rec;
    const local = await chrome.storage.local.get(["data:spaces"]);
    const sp: Rec = { ...(local["data:spaces"] as Rec | undefined), ...(data.spaces as Rec | undefined) };
    const ids = new Set(((sp.spaces as { id: string }[]) ?? []).map(s => s.id));
    if (!ids.has(sp.activeId as string)) sp.activeId = [...ids][0];
    await chrome.storage.local.set({ "data:spaces": sp, ...(data.pinned ? { "data:pinned": data.pinned } : {}), ...(data.favorites ? { "data:favorites": data.favorites } : {}) });
    return true;
}

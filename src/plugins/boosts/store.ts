import { createPluginStore } from "@api/Storage";
import type { Boost } from "./model";

/** 只存本地（chrome.storage.local data:boosts）；对应 Arc StorableBoostsData.json，不做 Firestore 同步 */
export const boostStore = createPluginStore<{ boosts: Boost[] }>("boosts", () => ({ boosts: [] }));

export async function updateBoost(id: string, fn: (b: Boost) => void) {
    await boostStore.update(d => { const b = d.boosts.find(x => x.id === id); if (b) { fn(b); b.updated = Date.now(); } });
}

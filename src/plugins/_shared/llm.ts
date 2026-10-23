/* 可选插件共用：OpenAI 兼容 /chat/completions 调用（带超时）+ 共用 API key 的读写。
 * 目录以 _ 开头，构建扫描插件时会跳过，不会被当成插件。使用者：downloadRename、tidyTabTitles、tidyTabs。 */
import { OptionType } from "@utils/types";

export interface LlmConfig { endpoint: string; model: string; apiKey: string; timeoutMs: number }
export type Fetcher = (url: string, init: RequestInit) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

/** 规范化接口地址：补上 /chat/completions */
export const chatUrl = (endpoint: string) => {
    const base = endpoint.replace(/\/+$/, "");
    return base + (base.endsWith("/chat/completions") ? "" : "/chat/completions");
};

/** 发一条 user 消息，要求 JSON 输出；返回 message.content。未配置 / 超时 / HTTP 错误 / 异常 → null */
export async function chatJson(prompt: string, cfg: LlmConfig, fetcher: Fetcher = fetch): Promise<string | null> {
    if (!cfg.endpoint || !cfg.model) return null;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), cfg.timeoutMs);
    try {
        const res = await Promise.race([
            fetcher(chatUrl(cfg.endpoint), {
                method: "POST", signal: ctl.signal,
                headers: { "content-type": "application/json", ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}) },
                body: JSON.stringify({ model: cfg.model, messages: [{ role: "user", content: prompt }], response_format: { type: "json_object" }, temperature: 0 }),
            }),
            new Promise<never>((_, rej) => ctl.signal.addEventListener("abort", () => rej(new Error("timeout")))),
        ]);
        if (!res.ok) return null;
        const j = await res.json() as { choices?: { message?: { content?: string } }[] };
        return j.choices?.[0]?.message?.content ?? "";
    } catch { return null; } finally { clearTimeout(timer); }
}

/** 解析模型返回的 JSON（容忍 ```json 代码块包裹）；失败 → null */
export function parseJsonContent(raw: unknown): Record<string, unknown> | null {
    let obj: unknown = raw;
    if (typeof raw === "string") { try { obj = JSON.parse(raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, "")); } catch { return null; } }
    return obj && typeof obj === "object" ? obj as Record<string, unknown> : null;
}

/* ---------- 共用 API key ----------
 * 三个 AI 插件（Download Rename / Tidy Tab Titles / Tidy Tabs）共用一个 key。
 * 存在扩展自己的 IndexedDB（库 cat-secrets / 表 kv / 键 API_KEY_STORAGE），不放普通设置，也不放 chrome.storage.local：
 * 数据插件的备份 dump() 是 storage.local.get(null)，restore() 会先 clear()，放在 local 里会被导出、被旧备份覆盖（验收 51947 F1）。
 * IndexedDB 不在备份范围内，所以 key 不会进入导出和自动快照，恢复备份也不会动它。仍是明文存储。
 * 旧位置（设置项 apiKey、storage.local 的 API_KEY_STORAGE）启动时迁移过来并删除。 */
export const API_KEY_STORAGE = "secret:llmApiKey";
/** 旧版本把 key 存在这些插件的设置项 apiKey 里 */
export const LEGACY_KEY_PLUGINS = ["DownloadRename", "TidyTabTitles"] as const;

export interface Area {
    get(key: string): Promise<Record<string, unknown>>;
    set(items: Record<string, unknown>): Promise<void>;
    remove(key: string): Promise<void>;
}

const DB = "cat-secrets", STORE = "kv";
function openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const r = indexedDB.open(DB, 1);
        r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE); };
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
    });
}
async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest | void): Promise<T | undefined> {
    const db = await openDb();
    try {
        return await new Promise<T | undefined>((resolve, reject) => {
            const t = db.transaction(STORE, mode);
            const req = fn(t.objectStore(STORE));
            t.oncomplete = () => resolve(req ? req.result as T : undefined);
            t.onerror = () => reject(t.error);
        });
    } finally { db.close(); }
}
/** IndexedDB 实现的键值区 */
export const idbArea: Area = {
    async get(key) { const v = await tx<unknown>("readonly", s => s.get(key)); return v === undefined ? {} : { [key]: v }; },
    async set(items) { await tx("readwrite", s => { for (const [k, v] of Object.entries(items)) s.put(v, k); }); },
    async remove(key) { await tx("readwrite", s => s.delete(key)); },
};
const area = (): Area | null => typeof indexedDB !== "undefined" ? idbArea : null;
const legacyLocal = (): Area | null => (typeof chrome !== "undefined" && chrome.storage?.local) ? chrome.storage.local as unknown as Area : null;

export async function getApiKey(store: Area | null = area()): Promise<string> {
    if (!store) return "";
    const v = (await store.get(API_KEY_STORAGE))[API_KEY_STORAGE];
    return typeof v === "string" ? v : "";
}
export async function setApiKey(value: string, store: Area | null = area()): Promise<void> {
    if (!store) return;
    const v = value.trim();
    if (v) await store.set({ [API_KEY_STORAGE]: v }); else await store.remove(API_KEY_STORAGE);
}

/** 迁移：storage.local 的旧键 / 旧设置里的 apiKey → IndexedDB 新键（新键为空时才写入，取第一个非空值），然后从旧设置里删掉 */
export async function migrateLegacyApiKey(
    readLegacy: (plugin: string) => unknown, clearLegacy: (plugin: string) => void, store: Area | null = area(), local: Area | null = legacyLocal(),
): Promise<boolean> {
    // 51947 版存在 storage.local 的同名键：先取出并删除
    let fromLocal = "";
    if (local) {
        const v = (await local.get(API_KEY_STORAGE))[API_KEY_STORAGE];
        if (typeof v === "string") fromLocal = v.trim();
    }
    const found = [fromLocal, ...LEGACY_KEY_PLUGINS.map(p => readLegacy(p))].find((v): v is string => typeof v === "string" && !!v.trim());
    let moved = false;
    if (!store) return false; // 新位置不可用：旧值原样保留，不删
    if (found && !(await getApiKey(store))) { await setApiKey(found, store); moved = true; }
    if (local && (await local.get(API_KEY_STORAGE))[API_KEY_STORAGE] !== undefined) await local.remove(API_KEY_STORAGE);
    for (const p of LEGACY_KEY_PLUGINS) if (readLegacy(p) !== undefined) clearLegacy(p);
    return moved;
}

/** API key 设置项：COMPONENT 控件直接读写 API_KEY_STORAGE（不进普通设置）。
 *  带 sensitive: true（核心 0.1.0.51950：备份时跳过，导入时保留现有值）。实际值存 IndexedDB，不在设置里。 */
export function apiKeySetting(description: string) {
    return {
        type: OptionType.COMPONENT as const, description, sensitive: true,
        component: () => {
            const input = document.createElement("input");
            input.type = "password"; input.className = "arc-field"; input.autocomplete = "off"; input.spellcheck = false;
            void getApiKey().then(v => { input.value = v; });
            input.addEventListener("change", () => void setApiKey(input.value));
            return input;
        },
    };
}

/* background：把匹配站点的 Boost CSS 用 chrome.scripting.insertCSS 注入；JS 用 userScripts（需权限，带防护）。 */
import { safe } from "@api/ErrorLog";
import { Logger } from "@utils/Logger";
import { activeBoostsFor, assembleAll, normHost, type Boost } from "./model";
import { boostStore } from "./store";

const logger = new Logger("Boosts");
const SESSION_KEY = "boosts:inserted";
/** tabId → 已注入的 CSS（存 storage.session，service worker 重启后仍能 removeCSS） */
let inserted: Record<string, string> = {};
let loaded: Promise<void> | null = null;
const load = () => loaded ??= (chrome.storage.session ? safe(chrome.storage.session.get(SESSION_KEY).then(r => { inserted = (r?.[SESSION_KEY] as Record<string, string>) ?? {}; }), "boosts: storage.session.get") : undefined) ?? Promise.resolve();
const save = () => chrome.storage.session ? safe(chrome.storage.session.set({ [SESSION_KEY]: inserted }), "boosts: storage.session.set") : undefined;

async function remove(tabId: number) {
    const prev = inserted[tabId];
    if (prev) await safe(chrome.scripting.removeCSS({ target: { tabId, allFrames: false }, css: prev, origin: "USER" }), "boosts: scripting.removeCSS");
    delete inserted[tabId];
}

/** 对一个标签重新注入；fresh = 新文档（导航后旧样式已不在） */
export async function applyToTab(tabId: number, url: string | undefined, fresh = false) {
    await load();
    if (fresh) delete inserted[tabId];
    const css = assembleAll(activeBoostsFor(boostStore.get().boosts, url));
    if (inserted[tabId] === css) return;
    await remove(tabId);
    if (css) {
        try { await chrome.scripting.insertCSS({ target: { tabId }, css, origin: "USER" }); inserted[tabId] = css; } catch (e) { logger.debug("insertCSS failed", tabId, e); }
    }
    await save();
}

export async function applyAll() {
    const tabs = await safe(chrome.tabs.query({}), "boosts: tabs.query", [] as chrome.tabs.Tab[]);
    await Promise.all(tabs.map(t => t.id != null && applyToTab(t.id, t.url)));
}

export async function removeAll() {
    await load();
    await Promise.all(Object.keys(inserted).map(id => remove(Number(id))));
    await save();
}

export const forgetTab = (tabId: number) => { delete inserted[tabId]; void save(); };

/* ---------- 自定义 JS（userScripts） ---------- */
const JS_PREFIX = "cat-boost-js-";
type US = typeof chrome.userScripts;
/** userScripts 可用：API 存在、已获授权（optional_permissions 在启用时申请，需核心支持）。任何一项不满足返回 null */
export async function userScriptsApi(): Promise<US | null> {
    try {
        const us = (chrome as { userScripts?: US }).userScripts;
        if (!us?.register || !chrome.permissions?.contains) return null;
        if (!await chrome.permissions.contains({ permissions: ["userScripts"] as chrome.runtime.ManifestPermissions[] })) return null;
        await us.getScripts(); // Chrome 未打开“允许用户脚本”时会抛错
        return us;
    } catch { return null; }
}

export const matchesFor = (host: string) => { const h = normHost(host); return [`*://${h}/*`, `*://*.${h}/*`]; };

/** 同步已注册的用户脚本：只注册 isActive 且有 JS 的 Boost；jsEnabled 关闭时全部注销 */
export async function syncUserScripts(boosts: Boost[], jsEnabled: boolean): Promise<"ok" | "unavailable"> {
    const us = await userScriptsApi();
    if (!us) return "unavailable";
    try {
        const old = (await us.getScripts()).filter(s => s.id.startsWith(JS_PREFIX)).map(s => s.id);
        if (old.length) await us.unregister({ ids: old });
        const want = jsEnabled ? boosts.filter(b => b.isActive && b.js.trim() && normHost(b.host)) : [];
        if (want.length) await us.register(want.map(b => ({ id: JS_PREFIX + b.id, matches: matchesFor(b.host), js: [{ code: b.js }], runAt: "document_idle" as const, world: "USER_SCRIPT" as const })));
        return "ok";
    } catch (e) { logger.warn("userScripts sync failed", e); return "unavailable"; }
}

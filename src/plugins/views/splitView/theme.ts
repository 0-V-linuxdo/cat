/* 分屏页跟随 Space 主题：侧栏（panel 上下文）把根上的 data-theme / data-bb-dark 发布到 chrome.storage.session["splitTheme"]，
 * 分屏页读取并写到自己的 <html>，onChanged 实时更新。判定顺序由 style.ts 的 CSS 决定：data-bb-dark > data-theme > 系统。
 * 不改 themes 插件：只读侧栏根属性（themes 写 data-theme，ToneProbe 写 data-bb-dark）。多窗口侧栏同时开着时以最后写入为准。 */
import { safe } from "@api/ErrorLog";
export const SPLIT_THEME_KEY = "splitTheme";
export interface SplitTheme { theme: string | null; bbDark: string | null }

export function readTheme(root: { dataset: DOMStringMap }): SplitTheme {
    return { theme: root.dataset.theme ?? null, bbDark: root.dataset.bbDark ?? null };
}
export function applyTheme(root: { dataset: DOMStringMap }, t: Partial<SplitTheme> | null | undefined) {
    const set = (k: "theme" | "bbDark", v: unknown) => { if (typeof v === "string" && v) { if (root.dataset[k] !== v) root.dataset[k] = v; } else delete root.dataset[k]; };
    set("theme", t?.theme); set("bbDark", t?.bbDark);
}
const same = (a: SplitTheme | null, b: SplitTheme) => !!a && a.theme === b.theme && a.bbDark === b.bbDark;

/** 侧栏：发布主题（变化时才写） */
export function publishTheme(): () => void {
    const root = document.documentElement;
    let last: SplitTheme | null = null;
    const push = () => { const t = readTheme(root); if (same(last, t)) return; last = t; void safe(chrome.storage.session.set({ [SPLIT_THEME_KEY]: t }), "storage.session.set(splitTheme)"); };
    push();
    const mo = new MutationObserver(push);
    mo.observe(root, { attributes: true, attributeFilter: ["data-theme", "data-bb-dark"] });
    return () => mo.disconnect();
}
/** 分屏页：订阅主题 */
export function subscribeTheme(): () => void {
    const root = document.documentElement;
    void safe(chrome.storage.session.get(SPLIT_THEME_KEY).then(r => applyTheme(root, r[SPLIT_THEME_KEY] as SplitTheme)), "storage.session.get(splitTheme)");
    const on = (ch: Record<string, chrome.storage.StorageChange>, area: string) => { if (area === "session" && ch[SPLIT_THEME_KEY]) applyTheme(root, ch[SPLIT_THEME_KEY].newValue as SplitTheme); };
    chrome.storage.onChanged.addListener(on);
    return () => chrome.storage.onChanged.removeListener(on);
}

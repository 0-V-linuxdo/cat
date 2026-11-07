/* 分屏页跟随 Space 主题：侧栏（panel 上下文）把根上的 data-theme / data-bb-dark 发布到 chrome.storage.session["splitTheme"]，
 * 分屏页读取并写到自己的 <html>，onChanged 实时更新。判定顺序由 style.ts 的 CSS 决定：data-bb-dark > data-theme > 系统。
 * 不改 themes 插件：只读侧栏根属性（themes 写 data-theme，ToneProbe 写 data-bb-dark）。多窗口侧栏同时开着时以最后写入为准。
 *
 * 旧值问题（补丁 6）：session 存储在浏览器会话内一直保留，侧栏关闭后值不会清掉；之后系统明暗或「外观」mode 变了再开分屏页，
 * 旧值会把页面钉在过时的明暗上。现在：
 *   · 发布值盖戳 { sys: 发布时系统是否深色, mode: 发布时 plugins.Spaces.mode }；
 *   · 分屏页以「当前系统明暗 / 当前 mode」为准（baseTheme：mode=auto 不钉、交给 @media；light/dark 钉 data-theme）；
 *   · 存储值只在戳与当前一致时才作首帧提示套用（保留自定义 Space 主题与系统不同的明暗）；不一致 / 无戳（旧格式）一律丢弃；
 *   · 运行中系统或 mode 变化：重新判定，不重载；侧栏（若还开着）随后发布新戳值再套用。
 * 依赖补丁 3 的 api/Appearance.ts（modeFrom / appearanceMode / systemIsDark / APPEARANCE_OWNER，已在主树）。
 * 引用方：splitView/index.ts（panel: publishTheme()、page: subscribeTheme()）、tests/splitViewThemeSync.test.ts、tests/splitThemeStale.test.ts；
 * 读它的还有 api/ToneProbe.ts 的注释（无代码依赖）。 */
import { safe } from "@api/ErrorLog";
import { SettingsStore, pluginPath } from "@api/Settings";
import { APPEARANCE_OWNER, appearanceMode, modeFrom, systemIsDark, type AppearanceMode } from "@api/Appearance";
export const SPLIT_THEME_KEY = "splitTheme";
export type SplitMode = AppearanceMode;
export interface SplitTheme { theme: string | null; bbDark: string | null; sys?: boolean; mode?: SplitMode }
export interface SplitCtx { sysDark: boolean; mode: SplitMode }

export const splitModeFrom = modeFrom; // 同一份读取（Themes 功能关掉 = auto；见 api/Appearance.ts）

export function readTheme(root: { dataset: DOMStringMap }): SplitTheme {
    return { theme: root.dataset.theme ?? null, bbDark: root.dataset.bbDark ?? null };
}
export function applyTheme(root: { dataset: DOMStringMap }, t: Partial<SplitTheme> | null | undefined) {
    const set = (k: "theme" | "bbDark", v: unknown) => { if (typeof v === "string" && v) { if (root.dataset[k] !== v) root.dataset[k] = v; } else if (root.dataset[k] !== undefined) delete root.dataset[k]; };
    set("theme", t?.theme); set("bbDark", t?.bbDark);
}
const same = (a: SplitTheme | null, b: SplitTheme) => !!a && a.theme === b.theme && a.bbDark === b.bbDark && a.sys === b.sys && a.mode === b.mode;

/** 当前系统 / mode 下的底：auto 不钉（交给 style.ts 的 @media 跟系统），light / dark 钉成 data-theme */
export const baseTheme = (mode: SplitMode): SplitTheme => ({ theme: mode === "auto" ? null : mode, bbDark: null });
/** 存储值是否新鲜：带戳且发布时的系统明暗、mode 都与当前一致（旧格式无戳 = 不新鲜） */
export const isFresh = (t: SplitTheme | null | undefined, ctx: SplitCtx): t is SplitTheme => !!t && t.sys === ctx.sysDark && t.mode === ctx.mode;
/** 实际套用的值：新鲜才用存储值，否则回到底（丢弃） */
export const effectiveTheme = (t: SplitTheme | null | undefined, ctx: SplitCtx): SplitTheme => isFresh(t, ctx) ? t : baseTheme(ctx.mode);
export const stampTheme = (t: SplitTheme, ctx: SplitCtx): SplitTheme => ({ theme: t.theme, bbDark: t.bbDark, sys: ctx.sysDark, mode: ctx.mode });

export interface SplitDeps {
    root: { dataset: DOMStringMap };
    ctx(): SplitCtx;
    onSystem(l: () => void): () => void;
    onMode(l: () => void): () => void;
    session: { get(): Promise<SplitTheme | undefined>; set(v: SplitTheme): void; onChange(l: (v: SplitTheme | undefined) => void): () => void };
    /** 仅侧栏：根上 data-theme / data-bb-dark 变化 */
    observe(l: () => void): () => void;
    /** 仅侧栏：延后一拍（等同一事件里 Themes 先改完 data-theme） */
    defer(f: () => void): void;
}
const realDeps = (): SplitDeps => {
    const root = document.documentElement;
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const path = pluginPath(APPEARANCE_OWNER);
    return {
        root,
        ctx: () => ({ sysDark: systemIsDark(), mode: appearanceMode() }),
        onSystem: l => { mq.addEventListener("change", l); return () => mq.removeEventListener("change", l); },
        onMode: l => { SettingsStore.addPrefixChangeListener(path, l); return () => SettingsStore.removePrefixChangeListener(path, l); },
        session: {
            get: async () => (await chrome.storage.session.get(SPLIT_THEME_KEY))[SPLIT_THEME_KEY] as SplitTheme | undefined,
            set: v => { void safe(chrome.storage.session.set({ [SPLIT_THEME_KEY]: v }), "storage.session.set(splitTheme)"); },
            onChange: l => {
                const on = (ch: Record<string, chrome.storage.StorageChange>, area: string) => { if (area === "session" && ch[SPLIT_THEME_KEY]) l(ch[SPLIT_THEME_KEY].newValue as SplitTheme | undefined); };
                chrome.storage.onChanged.addListener(on);
                return () => chrome.storage.onChanged.removeListener(on);
            },
        },
        observe: l => { const mo = new MutationObserver(l); mo.observe(root, { attributes: true, attributeFilter: ["data-theme", "data-bb-dark"] }); return () => mo.disconnect(); },
        defer: f => { setTimeout(f, 0); },
    };
};

/** 侧栏：发布主题（变化时才写）。系统明暗 / mode 变化也重发，让戳保持当前 */
export function publishTheme(deps: SplitDeps = realDeps()): () => void {
    let last: SplitTheme | null = null;
    const push = () => { const t = stampTheme(readTheme(deps.root), deps.ctx()); if (same(last, t)) return; last = t; deps.session.set(t); };
    const later = () => deps.defer(push);
    push();
    const offs = [deps.observe(push), deps.onSystem(later), deps.onMode(later)];
    return () => { for (const f of offs) f(); };
}
/** 分屏页：订阅主题。以当前系统 / mode 为准，存储值只在新鲜时套用（见文件头） */
export function subscribeTheme(deps: SplitDeps = realDeps()): () => void {
    let rec: SplitTheme | undefined;
    const render = () => applyTheme(deps.root, effectiveTheme(rec, deps.ctx()));
    void safe(deps.session.get().then(r => { rec = r; render(); }, () => render()), "storage.session.get(splitTheme)");
    const offs = [
        deps.session.onChange(v => { rec = v; render(); }),
        deps.onSystem(render),
        deps.onMode(render),
    ];
    return () => { for (const f of offs) f(); };
}

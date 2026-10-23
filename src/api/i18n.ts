/*
 * 界面语言（核心）：默认“自动”——浏览器界面语言以 zh 开头用中文，否则英文；可在设置里改为 中文 / English。
 * 所有界面文本都通过 tr(key) 取；definePlugin 里的 label / description / 设置描述 / 选项 / 命令名 / 菜单名
 * 只写键（在模块加载时还不知道语言），由显示处调用 tr() 解析。tr() 遇到不是键的文本（如用户起的名字）原样返回。
 */
import en from "../i18n/en";
import zh from "../i18n/zh";

export type Lang = "zh" | "en";
export type LangSetting = "auto" | Lang;
export const LOCALES: Record<Lang, Record<string, string>> = { zh, en };

export function detectLang(): Lang {
    let ui = "";
    try { ui = chrome.i18n?.getUILanguage?.() ?? ""; } catch { /* 非扩展环境 */ }
    if (!ui && typeof navigator !== "undefined") ui = navigator.language ?? "";
    return ui.toLowerCase().startsWith("zh") ? "zh" : "en";
}

let current: Lang = detectLang();
export const getLang = () => current;

export function setLang(setting: LangSetting | undefined) {
    current = setting === "zh" || setting === "en" ? setting : detectLang();
    if (typeof document !== "undefined") document.documentElement.lang = current === "zh" ? "zh-CN" : "en";
}

export function hasKey(key: string) { return key in LOCALES.en; }

/** 取当前语言的文本；{0}、{1}… 依次替换为参数 */
export function tr(key: string | undefined, ...args: unknown[]): string {
    if (key == null) return "";
    const s = LOCALES[current][key] ?? LOCALES.en[key] ?? key;
    return args.length ? s.replace(/\{(\d+)\}/g, (_, i) => String(args[+i] ?? "")) : s;
}

/** 翻译；键缺失时用 fallback（绝不显示原始键） */

/** 列表连接符 */
export const listSep = () => (current === "zh" ? "、" : ", ");

/** 插件注册自己的文案（不覆盖核心键；同一插件重复注册会先撤销上一次）。返回撤销函数：删掉本次加入的键 */
const pluginLocales = new Map<string, () => void>();
export function registerLocale(pluginName: string, strings: { en: Record<string, string>; zh: Record<string, string> }): () => void {
    pluginLocales.get(pluginName)?.();
    const added: [Lang, string, string][] = [];
    for (const lang of ["en", "zh"] as const) for (const [k, v] of Object.entries(strings[lang] ?? {})) {
        if (k in LOCALES[lang]) continue;
        LOCALES[lang][k] = v; added.push([lang, k, v]);
    }
    const cleanup = () => {
        for (const [lang, k, v] of added) if (LOCALES[lang][k] === v) delete LOCALES[lang][k];
        if (pluginLocales.get(pluginName) === cleanup) pluginLocales.delete(pluginName);
    };
    pluginLocales.set(pluginName, cleanup);
    return cleanup;
}

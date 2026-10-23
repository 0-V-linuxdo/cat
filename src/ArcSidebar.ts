/* 每个入口共用的启动流程（对应 Void++ src/VoidPP.ts 的 init + src/index.ts 的全局导出） */
import { registerUrlTransform } from "@api/UrlTransforms";
import { installFocusPolicy } from "@api/FocusPolicy";
import { installErrorLog } from "@api/ErrorLog";
import { installToneProbe } from "@api/ToneProbe";
import { arcConfirm, arcPrompt } from "@components/Dialog";
import { commands, runCommand } from "@api/Commands";
import { setContext } from "@api/context";
import { bridgeRuntimeEvents, dispatch } from "@api/Events";
import { initPluginManager, plugins, registerPlugin, setPluginOrFeature, startAllPlugins } from "@api/PluginManager";
import { handle, serveRpc } from "@api/RPC";
import { setLang } from "@api/i18n";
import { initSettings, Settings, SettingsStore } from "@api/Settings";
import { Logger } from "@utils/Logger";
import { type ExtContext, StartAt } from "@utils/types";
import Plugins from "~plugins";

export async function bootstrap(ctx: ExtContext) {
    setContext(ctx);
    if (ctx !== "content") installErrorLog(ctx); // 内容脚本跑在网页里：网页自己的错误不记
    if (ctx !== "background" && ctx !== "content") { installFocusPolicy(); installToneProbe(); }
    bridgeRuntimeEvents();
    if (ctx === "background") {
        serveRpc();
        handle("core:state", () => Object.values(plugins).filter(p => p.started).map(p => p.name));
    }
    for (const p of Object.values(Plugins)) {
        if (p.dev && !IS_DEV) continue;
        registerPlugin(p);
    }
    await initSettings();
    /* 界面语言：设置读到后才确定（自动 / 中文 / English）；改了以后扩展页面重新加载，后台与内容脚本即时切换 */
    const langOf = () => (Settings.plugins.PluginSettings as { language?: "auto" | "zh" | "en" } | undefined)?.language;
    let lang = langOf();
    setLang(lang);
    SettingsStore.addPrefixChangeListener("plugins.PluginSettings", () => {
        if (langOf() === lang) return;
        lang = langOf();
        setLang(lang);
        dispatch("languageChange");
        // 先把设置写进存储再重新加载，否则防抖中的写入随页面一起丢失，重载后读回旧值（“自动”）
        if (ctx !== "background" && ctx !== "content" && typeof location !== "undefined") void SettingsStore.flush().then(() => location.reload());
    });
    // 页面关闭 / 隐藏时立即写入防抖中的设置（避免刚改的值因关闭页面而丢失）
    if (typeof addEventListener === "function" && typeof document !== "undefined") {
        addEventListener("pagehide", () => void SettingsStore.flush());
        // 拖拽预览：抓图那一刻是“凸起卡片”（arc-lift），随后源行变半透明（dragging）
        // 键盘无障碍：role=button 的非 <button> 元素按 Enter / 空格时等同点击
        document.addEventListener("keydown", e => {
            const el = e.target as HTMLElement | null;
            if ((e.key === "Enter" || e.key === " ") && el?.getAttribute?.("role") === "button" && el.tagName !== "BUTTON" && !e.repeat) {
                e.preventDefault(); e.stopPropagation(); el.click();
            }
        });
        const DRAG_SEL = ".arc-row, .arc-tab, .arc-folder-head, .arc-fav-tile";
        document.addEventListener("dragstart", e => {
            const el = (e.target as Element | null)?.closest?.(DRAG_SEL); if (!el) return;
            el.classList.add("arc-lift");
            setTimeout(() => { el.classList.remove("arc-lift"); el.classList.add("dragging"); });
        }, true);
        /* Arc 拖拽（sidebar-full-spec 变更 #3/#4）：源行隐藏、拖影用原生 drag image；悬停行 = 主题色 50% 填充；
         * 落下后的项按 spring（damping .99 / response .14）从 scale 0 / 透明 渐入到 1 */
        let dragKey = "";
        const clearOver = () => document.querySelectorAll(".arc-drop-over").forEach(x => x.classList.remove("arc-drop-over"));
        document.addEventListener("dragstart", e => { const el = (e.target as Element | null)?.closest?.<HTMLElement>(DRAG_SEL); dragKey = el?.dataset.sel ?? el?.getAttribute("title") ?? ""; }, true);
        document.addEventListener("dragover", e => {
            const row = (e.target as Element | null)?.closest?.(DRAG_SEL);
            if (row?.classList.contains("arc-drop-over")) return;
            clearOver(); if (row && !row.classList.contains("dragging")) row.classList.add("arc-drop-over");
        }, true);
        document.addEventListener("dragleave", e => { if (!e.relatedTarget) clearOver(); }, true);
        document.addEventListener("drop", clearOver, true);
        document.addEventListener("dragend", () => {
            document.querySelectorAll(".dragging, .arc-lift").forEach(x => x.classList.remove("dragging", "arc-lift")); clearOver();
            const key = dragKey; dragKey = ""; if (!key) return;
            const find = () => Array.from(document.querySelectorAll<HTMLElement>(DRAG_SEL)).find(x => (x.dataset.sel ?? x.getAttribute("title")) === key);
            const settle = () => { const el = find(); if (!el) return; el.classList.remove("arc-drop-in"); void el.offsetWidth; el.classList.add("arc-drop-in"); setTimeout(() => el.classList.remove("arc-drop-in"), 400); };
            setTimeout(settle, 30);
        }, true);
        document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") void SettingsStore.flush(); });
    }
    initPluginManager();
    await startAllPlugins(StartAt.Init);
    if (typeof document !== "undefined" && document.readyState === "loading") await new Promise(r => document.addEventListener("DOMContentLoaded", r, { once: true }));
    await startAllPlugins(StartAt.DOMContentLoaded);
    (globalThis as Record<string, unknown>).ArcSidebar = { plugins, Settings, version: VERSION, context: ctx, runCommand, commands, setPluginOrFeature, registerUrlTransform };
    (globalThis as Record<string, unknown>).ArcSidebarDialog = { arcConfirm, arcPrompt };
    new Logger("Core").info(`${ctx} ready, ${Object.keys(plugins).length} plugins`);
}

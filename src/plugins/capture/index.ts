/* 可选插件「Capture」：截取页面区域（拖框）、元素（单击）、整页、Portrait、右键图片；截取后弹出 Arc 的操作菜单。默认关闭。
 * 规格：/workspace/arc-analysis/capture.md。截图用 chrome.tabs.captureVisibleTab 后在页面里裁剪；整页只用 JS 缩放（无法对齐：需要内核：Arc 用内核 ArcWebView captureFullPage: 截整页；Helium 不允许把 debugger 列为可选权限，Cat 决定不用 CDP）；保存用 chrome.downloads。
 * 存入资料库【降级实现】：Arc 存进自己的 Capture 库（CaptureClient.storeCapture）；核心没有 Media 写入接口 → 暂时下载到 Captures/ 子目录（资料库 Media 列出图片类下载，所以会出现在 Media 里）。 */
import { isMac } from "@api/Keys";
import { safe } from "@api/ErrorLog";
import { safeExpected } from "@plugins/library/media/expectedErrors";
import { listen } from "@api/ChromeEvents";
import { handle } from "@api/RPC";
import { tr } from "@api/i18n";
import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";

import "./i18n";
import { deleteLibraryCapture, storeLibraryCapture } from "./coreHooks";
import { CAPTURE_INTERVAL_MS, isDragCombo } from "./logic";
import { startCapture, type Mode } from "./page";

const MSG = "cat-capture:start";
const LIB_DIR = "Captures";
const MENUS: { id: string; title: string; mode: Mode; contexts: [`${chrome.contextMenus.ContextType}`] }[] = [
    { id: "cat-capture", title: "capture.start", mode: "select", contexts: ["page"] },
    { id: "cat-capture-full", title: "capture.fullPage", mode: "full", contexts: ["page"] },
    { id: "cat-capture-portrait", title: "capture.portrait", mode: "portrait", contexts: ["page"] },
    { id: "cat-capture-image", title: "capture.image", mode: "image", contexts: ["image"] },
];

const settings = definePluginSettings({
    dragToCapture: { type: OptionType.BOOLEAN, description: "capture.dragToCapture", default: true },
});

async function sendStart(tab: chrome.tabs.Tab | undefined, mode: Mode, srcUrl?: string) {
    const t = tab ?? (await safe(chrome.tabs.query({ active: true, lastFocusedWindow: true }), "tabs.query", [] as chrome.tabs.Tab[]))[0];
    if (t?.id == null || !/^https?:/.test(t.url ?? "")) return false;
    try { await chrome.tabs.sendMessage(t.id, { type: MSG, mode, srcUrl }, { frameId: 0 }); return true; } catch { return false; }
}

/** captureVisibleTab 有每秒 2 次的限制：串行并保持间隔 */
let lastShot = 0, shotQueue: Promise<unknown> = Promise.resolve();
function captureVisible(windowId: number): Promise<string> {
    const p = shotQueue.then(async () => {
        const wait = lastShot + CAPTURE_INTERVAL_MS - Date.now();
        if (wait > 0) await new Promise(r => setTimeout(r, wait));
        try { return await chrome.tabs.captureVisibleTab(windowId, { format: "png" }); } finally { lastShot = Date.now(); }
    });
    shotQueue = p.catch(() => undefined); // 队列尾：只为串行化，不记录——同一错误由调用方（返回的 p）处理并记录，避免重复
    return p;
}

export default definePlugin({
    name: "Capture",
    label: "plugin.capture.label",
    icon: "photo",
    description: "plugin.capture.desc",
    authors: [Devs.ArcSidebar],
    tags: ["views"],
    settings,
    commands: [
        { id: "capture.start", label: "capture.start", keywords: ["capture", "screenshot"], context: "background", defaultKey: "Mod+Shift+2", run: () => sendStart(undefined, "select") },
        { id: "capture.fullPage", label: "capture.fullPage", keywords: ["capture", "screenshot", "full page"], context: "background", run: () => sendStart(undefined, "full") },
        { id: "capture.portrait", label: "capture.portrait", keywords: ["capture", "screenshot", "portrait"], context: "background", run: () => sendStart(undefined, "portrait") },
    ],
    background: {
        start() {
            for (const m of MENUS) chrome.contextMenus.create({ id: m.id, title: tr(m.title), contexts: m.contexts, documentUrlPatterns: ["http://*/*", "https://*/*"] }, () => void chrome.runtime.lastError);
            return [
                listen("contextMenus.onClicked", (info, tab) => {
                    const m = MENUS.find(x => x.id === info.menuItemId);
                    if (m) void sendStart(tab, m.mode, info.srcUrl);
                }),
                handle("capture.visible", (_a, sender) => sender.tab?.windowId != null ? captureVisible(sender.tab.windowId) : Promise.reject(new Error("no tab"))),
                handle("capture.download", ([url, filename, saveAs]) => typeof url === "string" && url.startsWith("data:image/") && typeof filename === "string"
                    ? chrome.downloads.download({ url, filename, saveAs: !!saveAs, conflictAction: "uniquify" }) : undefined),
                // 返回字符串 id（核心 Media 接口）或数字 id（降级：downloads）
                handle("capture.saveToLibrary", async ([url, filename], sender) => {
                    if (typeof url !== "string" || !url.startsWith("data:image/") || typeof filename !== "string") return null;
                    const viaCore = storeLibraryCapture({ id: crypto.randomUUID(), dataUrl: url, sourceURL: sender.tab?.url ?? "", title: sender.tab?.title ?? "", faviconURL: sender.tab?.favIconUrl, dateCreated: Date.now(), captureType: "partialPage" });
                    if (viaCore) return viaCore;
                    return chrome.downloads.download({ url, filename: `${LIB_DIR}/${filename}`, saveAs: false, conflictAction: "uniquify" });
                }),
                handle("capture.removeFromLibrary", async ([id]) => {
                    if (typeof id === "string") { await deleteLibraryCapture(id); return; }
                    if (typeof id !== "number") return;
                    await safeExpected(chrome.downloads.removeFile(id), "downloads.removeFile", "download"); // 文件已被删除/移走属正常，静默
                    await chrome.downloads.erase({ id });
                }),
                () => { for (const m of MENUS) chrome.contextMenus.remove(m.id, () => void chrome.runtime.lastError); },
            ];
        },
    },
    content: {
        start() {
            if (window.top !== window || !/^https?:/.test(location.protocol)) return;
            const onMsg = (m: { type?: string; mode?: Mode; srcUrl?: string }, _s: unknown, respond: (r: unknown) => void) => {
                if (m?.type !== MSG || !m.mode) return;
                void startCapture(m.mode, { srcUrl: m.srcUrl }); respond(true);
            };
            // 按住 ⌘⇧（非 mac：Ctrl+Shift）拖动开始截取；可在设置里关闭
            const onDown = (e: MouseEvent) => {
                if (!settings.store.dragToCapture || !isDragCombo(e, isMac)) return;
                e.preventDefault(); e.stopImmediatePropagation();
                void startCapture("drag", { start: { x: e.clientX, y: e.clientY } });
            };
            chrome.runtime.onMessage.addListener(onMsg);
            addEventListener("mousedown", onDown, true);
            return [() => chrome.runtime.onMessage.removeListener(onMsg), () => removeEventListener("mousedown", onDown, true)];
        },
    },
});

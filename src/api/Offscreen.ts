/* 唯一的离屏文档（MV3 每个扩展只能有一个）：剪贴板 + 监听系统深浅色（service worker 没有 matchMedia） */
export async function ensureOffscreen() {
    if (typeof document !== "undefined" || !chrome.offscreen) return;
    const url = chrome.runtime.getURL("offscreen.html");
    const has = (await chrome.runtime.getContexts?.({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT], documentUrls: [url] }))?.length;
    if (!has) await chrome.offscreen.createDocument({ url, reasons: [chrome.offscreen.Reason.CLIPBOARD, chrome.offscreen.Reason.MATCH_MEDIA], justification: "Copy text; follow the system light/dark theme for the toolbar icon" }).catch(() => { }); /* 预期：并发创建时报 Only a single offscreen document，忽略 */
}
/** 工具栏图标：浅色用黑猫，深色用白猫 */
export const catIconPaths = (dark: boolean) => Object.fromEntries([16, 32, 48, 128].map(n => [n, `icons/icon${n}${dark ? "-dark" : ""}.png`]));

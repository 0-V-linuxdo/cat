import { safe } from "@api/ErrorLog";
import { flog } from "@api/FocusLog";
import { bootstrap } from "@src/ArcSidebar";
import { flushChromeEvents, registerChromeEvents } from "@api/ChromeEvents";
import { installSidePanelGesture, violations } from "@api/SidePanelGesture";

registerChromeEvents();
installSidePanelGesture(); // 侧栏开关：顶层同步注册，手势里同步决定（不经 ChromeEvents 缓冲）
void bootstrap("background").then(flushChromeEvents);

/* 扩展重载 / 更新后，已经打开的网页里没有新的内容脚本（Chrome 不会自动补注入）：
 * 这会让“点网页 = 点外面”、Alt+Q 等全部失灵，直到刷新网页。安装 / 更新 / 启动时补注入。 */
async function reinjectContent() {
    const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*", "file:///*"] });
    await Promise.all(tabs.map(t => t.id != null && chrome.scripting.executeScript({ target: { tabId: t.id }, files: ["content.js"] }).catch(() => undefined))); /* 预期：受限页面（chrome://、商店、PDF）不能注入，忽略 */
}
chrome.runtime.onInstalled.addListener(() => void reinjectContent());
chrome.windows.onFocusChanged.addListener(id => flog("bg", `onFocusChanged ${id}`));

/* 工具栏图标跟随系统深浅色：离屏文档里 matchMedia 监听 → 这里 setIcon（扩展管理页的图标不能运行时更改） */
import { catIconPaths, ensureOffscreen } from "@api/Offscreen";
let catDark: boolean | null = null;
chrome.runtime.onMessage.addListener((msg: { type?: string; dark?: boolean }) => {
    if (msg?.type !== "arc-theme" || typeof msg.dark !== "boolean") return;
    catDark = msg.dark;
    void safe(chrome.action.setIcon({ path: catIconPaths(msg.dark) }), "action.setIcon");
    void safe(chrome.storage.session.set({ catIconDark: msg.dark }), "storage.session.set");
});
void ensureOffscreen();
// 服务进程被唤醒时按上次记录的主题恢复工具栏图标（清单里的静态图标是带白描边的黑猫，深浅底都可读）
void chrome.storage.session.get("catIconDark").then(r => { if (typeof r.catIconDark === "boolean" && catDark === null) void safe(chrome.action.setIcon({ path: catIconPaths(r.catIconDark) }), "action.setIcon"); }).catch(() => { });
chrome.runtime.onStartup.addListener(() => void ensureOffscreen());
(globalThis as any).__catDark = () => catDark;
// 自测钩子：不在手势栈里的 sidePanel.open 调用记录（见 @api/SidePanelGesture）
chrome.runtime.onMessage.addListener((msg: { type?: string }, _s, reply) => { if (msg?.type === "arc-sidepanel-violations") { reply(violations.map(v => v.stack.split("\n").slice(0, 4).join(" < "))); return true; } return undefined; });

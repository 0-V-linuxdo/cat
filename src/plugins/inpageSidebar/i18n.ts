/* 本插件文案：合并进核心 LOCALES（插件默认关闭时 start() 不执行，所以在模块加载时注册——tests/pluginLabels 要求 index.ts 顶层 import "./i18n"）。
 * 英文名「In-page Sidebar」/ 中文名「页内侧边栏」按任务书；Arc 没有这个功能，没有 Arc 原文可对齐 ⛔。 */
import { isMac } from "@api/Keys";
import { registerLocale } from "@api/i18n";

/** 文案里的快捷键按平台写（补丁 inpage-mac-shortcut-copy）：toggle-sidebar 在 manifest 里 default = Alt+S、mac = MacCtrl+S（物理 Control+S，⌃S；Chrome 里 manifest 的 Ctrl 在 Mac 上会变成 ⌘，所以必须写 MacCtrl），
 *  所以 Mac 上 Alt+S（⌥S）没有绑定，Win / Linux 上 Ctrl+S 是浏览器「保存」。Mac 写 ⌃S / ⌘R，其它平台写 Alt+S / Ctrl+R。设置框架只认静态键（tr() 不带参数），所以在构建文案表时就替换，不在 tr() 里替换。 */
export const buildStrings = (mac: boolean) => {
    const SW = mac ? "⌃S" : "Alt+S", RL = mac ? "⌘R" : "Ctrl+R";
    return {
        en: {
            "plugin.inpageSidebar.label": "In-page Sidebar",
            "plugin.inpageSidebar.desc": "Show the sidebar inside the web page, like Arc. Falls back to the Chrome side panel on pages it can't be embedded in",
            "inpageSidebar.tag.panel": "In-page Panel",
            "inpageSidebar.tag.hover": "Hover to Reveal",
            "inpageSidebar.tag.native": "Switch to Chrome Panel",
            "inpageSidebar.defaultMode": "Default way to open",
            "inpageSidebar.mode.inpage": "In the page",
            "inpageSidebar.mode.native": "Chrome side panel",
            "inpageSidebar.displayMode": "Display mode: Push the page aside or float over it when the sidebar is open",
            "inpageSidebar.displayMode.detail": "Push docks the sidebar flat on the window edge; float draws a rounded translucent card. Hover-reveal always floats.\nPush limits: vw units and media queries don't see it; on RTL pages the scrollbar stays under the sidebar.",
            "inpageSidebar.displayMode.push": "Push the page",
            "inpageSidebar.displayMode.overlay": "Float over the page",
            "inpageSidebar.showHandle": "Show sidebar handle (a bar appears when you hover the right edge; resizing works either way)",
            "inpageSidebar.hoverReveal": "Reveal when the pointer reaches the left edge",
            "inpageSidebar.prewarm": "Restricted-page warm-up: Get the Chrome side panel ready before you open chrome:// pages (Window: Chrome panel only)",
            "inpageSidebar.prewarm.detail": `Window: first click or any key (incl. ${RL}) opens the Chrome panel for the whole window; in-page sidebar steps aside. ${SW} switches back.\nExperimental: may flash; can't cover window switches, session restore or other extensions' pages. Off by default.`,
            "inpageSidebar.prewarm.off": "Off",
            "inpageSidebar.prewarm.window": `Window: Chrome panel after your first click or any key, incl. ${RL} (${SW} switches back to in-page)`,
            "inpageSidebar.prewarm.window.short": "Window: Chrome", // 下拉按钮上的短标签（整句在菜单项与悬停提示里）；补丁 inpage-settings-copy-fix-2：窄屏（≤760px）按钮可用宽仅 120px，原 "Window: Chrome panel" 实测 143px 被截
            "inpageSidebar.menu.toggle": "Toggle sidebar",
            "inpageSidebar.switchNative": "Switch to Chrome side panel",
            "inpageSidebar.switchFailed": "Couldn't open the Chrome side panel from here. Use the keyboard shortcut or the right-click menu",
            "inpageSidebar.resize": "Drag to resize",
        },
        zh: {
            "plugin.inpageSidebar.label": "页内侧边栏",
            "plugin.inpageSidebar.desc": "像 Arc 一样把侧边栏显示在网页里；不能嵌入的页面自动回落到 Chrome 侧边栏",
            "inpageSidebar.tag.panel": "页内面板",
            "inpageSidebar.tag.hover": "悬停浮出",
            "inpageSidebar.tag.native": "切到 Chrome 侧边栏",
            "inpageSidebar.defaultMode": "默认打开方式",
            "inpageSidebar.mode.inpage": "页内",
            "inpageSidebar.mode.native": "Chrome 侧边栏",
            "inpageSidebar.displayMode": "显示方式：侧栏展开时把页面推开，还是浮在页面上",
            "inpageSidebar.displayMode.detail": "推开：侧栏平贴窗口左缘（整高、不透明）；浮层：圆角半透明卡片。悬停浮出始终是浮层。\n推开的限制：vw 单位和媒体查询看不到推开；RTL 页面的滚动条仍被侧栏盖住。",
            "inpageSidebar.displayMode.push": "推开页面",
            "inpageSidebar.displayMode.overlay": "浮在页面上",
            "inpageSidebar.showHandle": "显示侧栏把手（悬停右缘时显示竖条；不开也能拖宽、双击恢复默认宽度）",
            "inpageSidebar.hoverReveal": "鼠标移到左边缘时浮出",
            "inpageSidebar.prewarm": "受限页前预热：进入 chrome:// 等页面前，让 Chrome 侧边栏提前就绪（窗口级：页内侧栏让位）",
            "inpageSidebar.prewarm.detail": `窗口级：首次点击或任意键（含 ${RL}）即为整窗开 Chrome 侧边栏，页内侧栏让位；${SW} 可切回页内。\n实验性：可能短暂闪现；无法覆盖切换窗口、会话恢复、其它扩展打开的页面。默认关闭。`,
            "inpageSidebar.prewarm.off": "关闭",
            "inpageSidebar.prewarm.window": `窗口级：首次点击或任意键（含 ${RL}）后改用 Chrome 侧边栏（${SW} 可切回页内）`,
            "inpageSidebar.prewarm.window.short": "窗口级：Chrome", // 下拉按钮上的短标签（整句在菜单项与悬停提示里）；补丁 inpage-settings-copy-fix-2：原 "窗口级：Chrome 侧边栏" 窄屏实测 143px > 120px 被截
            "inpageSidebar.menu.toggle": "切换侧边栏",
            "inpageSidebar.switchNative": "切到 Chrome 侧边栏",
            "inpageSidebar.switchFailed": "这里没能直接打开 Chrome 侧边栏。请用快捷键或右键菜单",
            "inpageSidebar.resize": "拖动调整宽度",
        },
    };
};
export const STRINGS = buildStrings(isMac);
registerLocale("InpageSidebar", STRINGS);

/* 可选插件「页内侧边栏」（In-page Sidebar）：像 Arc 一样把侧边栏显示在网页里（content script 注入 shadow DOM + iframe 嵌入 sidepanel.html）。默认关闭。
 * 设计：/workspace/patches/inpage-sidebar/DESIGN.md。内部名 InpageSidebar（PascalCase，设置路径 plugins.InpageSidebar.*；目录 inpageSidebar，存储 data:inpageSidebar）。
 * 方案 Z：键盘命令（复用 toggle-sidebar，经 patch 02 的 setGestureRouter）+ 右键菜单（本文件顶层同步监听）+ 角标降级；本插件目录**不改**图标行为设置。
 * 工具栏图标（补丁 action-click）：由 _core/sidebar 把「点图标自动开原生」关掉，SidePanelGesture 的 action.onClicked 与命令共用同一个同步手势入口（路由到本插件的 toggleFor；没有路由 = 原生开 / 关）。
 * 受限页前切换（DESIGN.md 3.5–3.7）：默认 = ensure-native（页内侧栏里会进受限页的操作先同步切原生，窗口级 open，原生与页内互斥、原生关了恢复页内）；
 * 设置 prewarm = off（默认）/ window（首次手势窗口级预开）；「标签级」已移除（Chrome ≥132 里 tab 级 setOptions 不再藏住全局原生面板；整个目录没有 enabled:false，旧存储值由 settings.migratePrewarmTab 清成 off）。
 * 依赖补丁：01（web_accessible_resources: sidepanel.html）、02（SidePanelGesture 路由 + closePanel 导出 + openPanelInGesture 回调）、03（?host=inpage 守卫 + HostMode）、04（PLUGIN_CARD_ICON.InpageSidebar = "navSidebar"）。
 * 注意：不声明 icon: 字段（tests/pluginIconField.test.ts）——卡片图标只来自 PLUGIN_CARD_ICON。 */
import { tr } from "@api/i18n";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";

import "./i18n";
import { refreshBackground, startBackground } from "./background";
import { startContent } from "./content";
import { adoptEarly } from "./earlyHandle";
import { startPanel } from "./panel";
import { settings } from "./settings";

export default definePlugin({
    name: "InpageSidebar",
    label: "plugin.inpageSidebar.label",
    description: "plugin.inpageSidebar.desc",
    authors: [Devs.ArcSidebar],
    tags: ["views"],
    featureTags: ["inpageSidebar.tag.panel", "inpageSidebar.tag.hover", "inpageSidebar.tag.native"],
    dependencies: ["Sidebar"],
    enabledByDefault: false,
    settings,
    onSettingsChange: () => refreshBackground(),
    background: { start: () => startBackground() },
    content: { start: () => adoptEarly(tr) ?? startContent() }, // 补丁 residual：entries/content.ts 已起了早实例就接管
    panel: { start: () => startPanel() },
});

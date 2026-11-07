/* 设置项（plugins.InpageSidebar.*）。设置页里的卡片预留了「默认打开方式 / 显示侧栏把手 / 悬停浮出」三项（DESIGN.md 4.3）：
 * 现在是普通插件设置；具体样式等 Rea 对 Actionbook 设置页的分析后再定（⚠ 不要在这里写自定义 UI）。 */
import { definePluginSettings, getPluginSettings, removePluginSetting } from "@api/Settings";
import { OptionType } from "@utils/types";

import { DEFAULT_DISPLAY, DEFAULT_MODE, HANDLE, PREWARM } from "./constants";

export const settings = definePluginSettings({
    /** 「默认打开方式」：页内 / 原生。toggle-sidebar 快捷键与右键菜单按它决定先开哪个；受限页总是回落原生 */
    defaultMode: {
        type: OptionType.SELECT, description: "inpageSidebar.defaultMode",
        options: [
            { label: "inpageSidebar.mode.inpage", value: "inpage", default: DEFAULT_MODE === "inpage" },
            { label: "inpageSidebar.mode.native", value: "native", default: DEFAULT_MODE === "native" },
        ],
    },
    /** 「显示方式」：推开页面（默认）/ 浮在页面上。只管常驻（展开 / 固定）的侧栏；悬停浮出始终是浮层（DESIGN.md 3.8） */
    displayMode: {
        type: OptionType.SELECT, description: "inpageSidebar.displayMode", detail: "inpageSidebar.displayMode.detail",
        options: [
            { label: "inpageSidebar.displayMode.push", value: "push", default: DEFAULT_DISPLAY === "push" },
            { label: "inpageSidebar.displayMode.overlay", value: "overlay", default: DEFAULT_DISPLAY === "overlay" },
        ],
    },
    /** 「显示侧栏把手」（补丁 12，取代旧键 showSwitchButton 的 ↗ 按钮）：只控制 Arc 调宽把手的 **3 px 竖条**是否渲染 / 可见（悬停淡入；拖动中、吸附脉冲也一样，false = 始终不渲染）。默认 false。
     *  8 px 热区始终存在：拖宽、双击重置、col-resize 光标都不依赖这个开关。旧键 showSwitchButton 不再读取也不迁移，没有读时回退（旧值留在存储里不动） */
    showHandle: { type: OptionType.BOOLEAN, description: "inpageSidebar.showHandle", default: HANDLE.defaultOn },
    /** 悬停浮出：默认关（边缘触发条会盖住页面最左 50 px 的点击，所以默认不放） */
    hoverReveal: { type: OptionType.BOOLEAN, description: "inpageSidebar.hoverReveal", default: false },
    /** 「受限页前预热」三选一：关（默认，⚠ constants.PREWARM.defaultMode，理由见 DESIGN.md 3.6.6）/ 窗口级（「标签级」已移除：Chrome ≥132 里藏不住原生面板；旧值由 migratePrewarmTab 迁成 off）。一句话说明在 i18n inpageSidebar.prewarm，详细限制在 inpageSidebar.prewarm.detail（悬停设置行文字时用 ArcTooltip 显示，不放进设置行） */
    prewarm: {
        type: OptionType.SELECT, description: "inpageSidebar.prewarm", detail: "inpageSidebar.prewarm.detail",
        options: [
            { label: "inpageSidebar.prewarm.off", value: "off", default: PREWARM.defaultMode === "off" },
            { label: "inpageSidebar.prewarm.window", short: "inpageSidebar.prewarm.window.short", value: "window", default: PREWARM.defaultMode === "window" },
        ],
    },
});

/** 已存的 prewarm 值迁移：只认 "off" / "window"；"tab"（已移除的标签级）、旧的布尔和任何未知值都删掉键 = 回到默认 off（**不**并入 window：window 会让该窗口只剩原生，不能悄悄替用户改）。
 *  删键而不是写 "off"：与 resetPluginSettings 同一语义，设置页的下拉（Menu.ts 的 label 查找）不会因为未知值显示空白。后台启动时调一次；返回是否迁移过。
 *  ⚠ 只在插件启用（background.start）时跑：插件处于停用状态时存储里的旧值保留到下次启用（parsePrewarmMode 对任何旧值都按 off 处理，行为不受影响）。 */
export function migratePrewarmTab(): boolean {
    const cur = (getPluginSettings("InpageSidebar") as Record<string, unknown>).prewarm;
    if (cur === undefined || cur === "off" || cur === "window") return false;
    removePluginSetting("InpageSidebar", "prewarm");
    return true;
}

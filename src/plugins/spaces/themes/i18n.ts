/* Themes 插件自带文案（同 boosts/i18n.ts：合并进核心 LOCALES；核心已有的键不覆盖）。
 * themes.blurDim / themes.darkGrain 是 Arc 没有出处的多出项开关（audit-arc-diff-52193 H-01 / H-02），文案自拟。 */
import { registerLocale } from "@api/i18n";

export const STRINGS = {
    en: {
        "themes.blurDim": "Dim the sidebar when the window loses focus",
        "themes.darkGrain": "Grain texture in dark mode",
    },
    zh: {
        "themes.blurDim": "窗口失去焦点时调暗侧边栏",
        "themes.darkGrain": "深色模式下显示颗粒质感",
    },
};
// 模块加载时注册（插件关闭时设置页仍要显示开关说明）
registerLocale("Themes", STRINGS);

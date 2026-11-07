import { registerLocale } from "@api/i18n";
/* 插件卡片底部的功能标签（options.ts 卡片底部）。插件名称 / 说明在核心 src/i18n；这里只补标签，模块加载时注册（插件默认关闭时 start() 不执行，卡片也要能显示）。 */
export const STRINGS = {
    en: {
        "adaptive.tag.theme": "Theme Color",
        "adaptive.tag.background": "Background",
        "adaptive.tag.text": "Auto Text",
    },
    zh: {
        "adaptive.tag.theme": "主题色",
        "adaptive.tag.background": "页面背景色",
        "adaptive.tag.text": "自动文字色",
    },
};
registerLocale("Adaptive", STRINGS);

import { registerLocale } from "@api/i18n";
/* 文案（registerLocale）。英文为 Arc 原文（arc-analysis/tidy-tabs.md §C），中文为翻译。
 * 标「自补」的是 Arc 里没找到对应原文的提示。 */
import { ARC_TOOLTIP, BUTTON_TEXT, MISC_GROUP_NAME, UNDO_LABEL } from "./constants";

export const STRINGS = {
    en: {
        "plugin.tidyTabs.label": "Tidy Tabs", // Arc 设置页功能名
        "plugin.tidyTabs.desc": "Group Today tabs with AI", // 自补（Arc 描述前半句未解出）
        "tidyTabs.tag.group": "Group Today Tabs",
        "tidyTabs.tag.undo": "Undo",
        "tidyTabs.button": BUTTON_TEXT,
        "tidyTabs.tooltip": ARC_TOOLTIP,
        "tidyTabs.other": MISC_GROUP_NAME,
        "tidyTabs.undoLabel": UNDO_LABEL,
        "tidyTabs.cmd": "Organize Today Tabs", // 同 tooltip
        "tidyTabs.undo": "Undo", // 撤销按钮文字：源码未找到（自补）
        "tidyTabs.failed": "Couldn't tidy tabs", // 自补
        "tidyTabs.notConfigured": "Set up the model in Tidy Tab Titles first", // 自补
        "tidyTabs.unavailable": "Not available yet", // 自补
    },
    zh: {
        "plugin.tidyTabs.label": "整理标签",
        "plugin.tidyTabs.desc": "用 AI 给今日标签分组",
        "tidyTabs.tag.group": "分组今日标签",
        "tidyTabs.tag.undo": "撤销",
        "tidyTabs.button": "整理",
        "tidyTabs.tooltip": "整理今日标签",
        "tidyTabs.other": "其他",
        "tidyTabs.undoLabel": "整理标签",
        "tidyTabs.cmd": "整理今日标签",
        "tidyTabs.undo": "撤销",
        "tidyTabs.failed": "无法整理标签",
        "tidyTabs.notConfigured": "请先在「整理标签标题」里设置模型",
        "tidyTabs.unavailable": "暂不可用",
    },
};

// 模块加载时注册（同 cleanUrls）：插件默认关闭时 start() 不会执行，设置页的名称 / 描述也要能解析；不随 stop() 注销
registerLocale("TidyTabs", STRINGS);

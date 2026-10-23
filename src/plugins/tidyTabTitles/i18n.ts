import { registerLocale } from "@api/i18n";
/* 本插件文案，经核心 registerLocale 注册 */
export const STRINGS = {
    en: {
        "plugin.tidyTabTitles.label": "Tidy Tab Titles",
        "plugin.tidyTabTitles.desc": "Shorter titles for tabs you pin",
        "tidyTabTitles.endpoint": "API endpoint (OpenAI-compatible)",
        "tidyTabTitles.model": "Model",
        "tidyTabTitles.apiKey": "API key (stored locally in plain text)",
        "tidyTabTitles.timeout": "Model timeout (seconds)",
        "tidyTabTitles.reset": "Reset Name and Icon",
    },
    zh: {
        "plugin.tidyTabTitles.label": "整理标签标题",
        "plugin.tidyTabTitles.desc": "固定标签时自动改成短标题",
        "tidyTabTitles.endpoint": "接口地址（OpenAI 兼容）",
        "tidyTabTitles.model": "模型",
        "tidyTabTitles.apiKey": "API key（明文存在本地）",
        "tidyTabTitles.timeout": "模型超时（秒）",
        "tidyTabTitles.reset": "重置名称和图标",
    },
};

// 模块加载时注册（同 cleanUrls）：插件默认关闭时 start() 不会执行，设置页的名称 / 描述也要能解析；不随 stop() 注销
registerLocale("TidyTabTitles", STRINGS);

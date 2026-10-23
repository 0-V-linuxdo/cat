import { registerLocale } from "@api/i18n";
/* 本插件文案，经核心 registerLocale 注册（插件启动时，见 index.ts）。 */
export const STRINGS = {
    en: {
        "plugin.downloadRename.label": "Tidy Downloads",
        "plugin.downloadRename.desc": "Rename downloads to be concise and readable",
        "downloadRename.useModel": "Use an AI model",
        "downloadRename.endpoint": "API endpoint (OpenAI-compatible)",
        "downloadRename.model": "Model",
        "downloadRename.apiKey": "API key (stored locally in plain text)",
        "downloadRename.timeout": "Model timeout (seconds)",
        "downloadRename.fallback": "Use rules if the model fails",
        "downloadRename.renamed": "Download renamed!",
        "downloadRename.oldNameCopied": "Original name copied",
        "downloadRename.reverted": "Download name reverted!",
        "downloadRename.copyFailed": "Couldn't copy the original name",
        "downloadRename.bannerTitle": "Download renamed to:",
        "downloadRename.revert": "Revert to original name",
        "downloadRename.cmdShow": "Show last renamed download in folder",
    },
    zh: {
        "plugin.downloadRename.label": "整理下载",
        "plugin.downloadRename.desc": "把下载文件重命名得简洁易读",
        "downloadRename.useModel": "使用 AI 模型",
        "downloadRename.endpoint": "接口地址（OpenAI 兼容）",
        "downloadRename.model": "模型",
        "downloadRename.apiKey": "API key（明文存在本地）",
        "downloadRename.timeout": "模型超时（秒）",
        "downloadRename.fallback": "模型失败时改用规则",
        "downloadRename.renamed": "下载已重命名！",
        "downloadRename.oldNameCopied": "原文件名已复制",
        "downloadRename.reverted": "下载文件名已恢复！",
        "downloadRename.copyFailed": "无法复制原文件名",
        "downloadRename.bannerTitle": "下载已重命名为：",
        "downloadRename.revert": "恢复原文件名",
        "downloadRename.cmdShow": "在文件夹中显示最近重命名的下载",
    },
};

// 模块加载时注册（同 cleanUrls）：插件默认关闭时 start() 不会执行，设置页的名称 / 描述也要能解析；不随 stop() 注销
registerLocale("DownloadRename", STRINGS);

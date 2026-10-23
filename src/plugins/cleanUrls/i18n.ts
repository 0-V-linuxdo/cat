/* 本插件文案。项目惯例是写进 src/i18n/{en,zh}.ts，但那是核心文件、本任务不能改，
 * 所以在模块加载时合并进核心的 LOCALES（键名不与核心冲突）。核心同意后可整体搬进 src/i18n。 */
import { registerLocale } from "@api/i18n";

export const STRINGS = {
    en: {
        "plugin.cleanUrls.label": "Clean URLs",
        "plugin.cleanUrls.desc": "Remove trackers from copied links",
        "cleanUrls.extended": "Extended rules: Beyond Arc: more trackers, site rules (Google, Facebook…), all Amazon domains, keep Amazon search terms",
        "cleanUrls.extraParams": "Extra parameters to remove (comma-separated)",
        "cleanUrls.skipHosts": "Sites to leave alone (comma-separated)",
        "cleanUrls.exceptions": "Keep links for logins, unsubscribes and ad redirects intact",
        "cleanUrls.copiedClean": "Copied a clean link without trackers",
        "cleanUrls.copiedCleanMulti": "Copied clean links without trackers",
    },
    zh: {
        "plugin.cleanUrls.label": "Clean URLs",
        "plugin.cleanUrls.desc": "复制链接时去掉追踪参数",
        "cleanUrls.extended": "扩展规则：超出 Arc 的部分：更多追踪参数、Google/Facebook 等站点规则、各国 Amazon、保留 Amazon 搜索词",
        "cleanUrls.extraParams": "额外去除的参数（逗号分隔）",
        "cleanUrls.skipHosts": "不处理的站点（逗号分隔）",
        "cleanUrls.exceptions": "不处理登录、退订和广告跳转链接",
        "cleanUrls.copiedClean": "已复制去除追踪参数的链接",
        "cleanUrls.copiedCleanMulti": "已复制去除追踪参数的链接",
    },
};
// 模块加载时注册（插件关闭时设置页仍要显示它的名称 / 说明，所以不随 stop 撤销）
registerLocale("CleanUrls", STRINGS);

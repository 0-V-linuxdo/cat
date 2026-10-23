/* 本插件文案；原因同 cleanUrls/i18n.ts：合并进核心 LOCALES，核心同意后可搬进 src/i18n。 */
import { registerLocale } from "@api/i18n";

export const STRINGS = {
    en: {
        "plugin.tabSleep.label": "Tab Sleep",
        "plugin.tabSleep.desc": "Put idle tabs to sleep to free memory",
        "tabSleep.idle": "Sleep after idle for",
        "tabSleep.15m": "15 minutes", "tabSleep.1h": "1 hour", "tabSleep.4h": "4 hours", "tabSleep.12h": "12 hours",
        "tabSleep.skipHosts": "Sites to keep awake (comma-separated)",
        "tabSleep.keepPinned": "Keep pinned and favorite tabs awake: Not in Arc. Off by default, like Arc",
        "tabSleep.closeTier": "Archive tabs idle for 36 hours: Arc's close tier; how Arc handles it: not found in source. Restore from the Archive; separate from Today auto-archive",
        "tabSleep.sleepAudible": "Sleep tabs playing audio",
        "tabSleep.cmdRun": "Sleep idle tabs now",
    },
    zh: {
        "plugin.tabSleep.label": "标签休眠",
        "plugin.tabSleep.desc": "闲置标签自动休眠，释放内存",
        "tabSleep.idle": "闲置多久后休眠",
        "tabSleep.15m": "15 分钟", "tabSleep.1h": "1 小时", "tabSleep.4h": "4 小时", "tabSleep.12h": "12 小时",
        "tabSleep.skipHosts": "不休眠的站点（逗号分隔）",
        "tabSleep.keepPinned": "固定和收藏的标签不休眠：Arc 没有此项。默认关闭，与 Arc 一致",
        "tabSleep.closeTier": "闲置 36 小时后归档：对应 Arc 的 close tier，Arc 的处理方式源码未找到。可在归档中恢复；与 Today 自动归档相互独立",
        "tabSleep.sleepAudible": "休眠正在播放音频的标签",
        "tabSleep.cmdRun": "立即休眠闲置标签",
    },
};
// 模块加载时注册（插件关闭时设置页仍要显示它的名称 / 说明，所以不随 stop 撤销）
registerLocale("TabSleep", STRINGS);

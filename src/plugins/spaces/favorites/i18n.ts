/* Favorites 插件自带文案（同 boosts/i18n.ts：合并进核心 LOCALES）。
 * 收藏菜单（urlbar-menus-followup.md L326–415）：fav.copyLinks = “Copy Links”（out7/0x102ebec78.c L155）；fav.changeIcon = “Change Icon…”（0x103a2c330）；fav.rename = “Rename…”（第 7 项，注释 “Rename a tab”）。中文均为英文原文的译文。
 * Edit Pinned Page 的 “Edit…” 用共用键 pinned.editPinnedUrl。
 * fav.dropHintSub = Arc 空状态副标题原文（sidebar-features.md:161 @0x101ce3ee0）；中文为译文。fav.openedStyle 是多出项开关（F-03，Arc 无此态），文案自拟。 */
import { registerLocale } from "@api/i18n";

export const STRINGS = {
    en: { "fav.dropHintSub": "Favorites keep your most used sites and apps close", "fav.openedStyle": "Highlight Favorites that have an open tab", "fav.copyLinks": "Copy Links", "fav.changeIcon": "Change Icon…", "fav.rename": "Rename…" },
    zh: { "fav.dropHintSub": "收藏让最常用的网站和应用触手可及", "fav.openedStyle": "突出显示已打开标签的收藏", "fav.copyLinks": "复制链接", "fav.changeIcon": "更换图标…", "fav.rename": "重命名…" },
};
registerLocale("Favorites", STRINGS);

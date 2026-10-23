/* Media 插件自带文案（同 favorites/i18n.ts：合并进核心 LOCALES）。
 * media.unmute = “Unmute”（验证器 rM/102eb7de8.c 在所有选中项已静音时改写的标题，注释 “Context menu action to unmute a tab”，urlbar-menus-followup.md L467–572）；中文为译文。 */
import { registerLocale } from "@api/i18n";

export const STRINGS = {
    en: { "media.unmute": "Unmute" },
    zh: { "media.unmute": "取消静音" },
};
registerLocale("Media", STRINGS);

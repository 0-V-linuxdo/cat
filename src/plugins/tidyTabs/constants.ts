/* Tidy Tabs 的 Arc 依据（arc-analysis/tidy-tabs.md §A、§C）。标「源码未找到」的都是占位，找到后替换这里即可。 */

/** 按钮可见文字（§C.3，0x100187624 NSLocalizedString "Tidy"） */
export const BUTTON_TEXT = "Tidy";
/** tooltip（§C.3，0x100187548 "Organize Today Tabs"） */
export const ARC_TOOLTIP = "Organize Today Tabs";
/** Tidy 头部按钮图标：Arc asset "broom-stick"（12pt Semibold 模板图），核心键 "broom"（index.ts 内直接使用）。
 *  插件卡片用 "clean"（同一文件）。 */
export const BUTTON_ICON = "clean" as const;
/** 至少几个 Today 标签才显示按钮：7。来自设置页描述 "…whenever you have more than six Today Tabs."（§C.4）；
 *  isEnabled 的具体计算、是否仅悬停显示：源码未找到 */
export const MIN_TABS = 7;
/** 杂项组显示名（§C.2，NSLocalizedString "Other"，comment "Tab group of miscellaneous tabs"），由程序补充 */
export const MISC_GROUP_NAME = "Other";
/** 撤销提示文字（§C.6，0x102a07ac4 "Tidy Tabs"）。显示时长、按钮文字：源码未找到 */
export const UNDO_LABEL = "Tidy Tabs";
/* 使用的模型 / endpoint：源码未找到（Arc 云端 LLMProvider，子功能 tidy_tabs）；这里用用户在 Tidy Tab Titles 里填的模型。
 * tidyTabsEnabled 默认值：源码未找到。组间顺序、组内顺序、组在 Today 区的位置：源码未找到。 */

/** 提示词正文：解码自 0x104611f70，1089 字节，逐字（§C.1） */
export const PROMPT_BODY = "You are a meticulous expert organizer who follows instructions concisely.\nI have some tabs! Please help me sort them into groups.\n\nI'll provide you with a list of tabs, with their IDs (e.g. google.com/3), their titles, and the tab they were opened from if applicable (e.g. ↳ google.com/0).\nThink about the groupings of my browsing, and then choose a descriptive group name for each.\nGroup based on keywords in common, domain, website purpose, and referring tab. If a tab has a unique keyword in common with tabs in a group, include it in that group. Use the unique keyword in the group name.\nSome tabs may be in a group of their own, but you should try to find include each tab in a group if possible.\n\nFor example, if these were my tabs:\n```\ngoogle.com/0: nitehawk cinema - Google Search\namazon.com/0: Amazon: Amazing Deals on Home Goods, Gifts and More\ngoogle.com/1 toaster reviews wirecutter\ntoasttech.com/0 What you should look for in buying a toaster ↳ google.com/1\ncalendar.google.com/0 June 25 | Weekly View\npavilion.com/0: Barbie Movie | Pavilion Theater\n```\n\nYou would output:";
/** 示例输出（§C.1：6 个静态数组经 JSONEncoder 编码，放在 ``` 代码块中） */
export const PROMPT_EXAMPLE_OUTPUT: [string, string][] = [["google.com/0", "Movies"], ["amazon.com/0", "Toaster Shopping"], ["google.com/1", "Toaster Shopping"], ["toasttech.com/0", "Toaster Shopping"], ["calendar.google.com/0", "Calendar"], ["pavilion.com/0", "Movies"]];
export const ARC_PROMPT_TABS_HEADER = "Here are my tabs, in the format 'id: title':";
/** 结尾句（§C.1 第 3 步，含开头换行） */
export const ARC_PROMPT_OUTPUT_HEADER = "\nYour array of group assignments, as valid JSON within a ```code block```:";

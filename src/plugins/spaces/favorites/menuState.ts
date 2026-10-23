/*
 * 收藏右键菜单的数量条件（urlbar-menus-followup.md「收藏菜单完整结构」L326–415，out5/0x102ec5d7c.c）。纯函数，便于测试。
 * n = 选中的收藏数。Edit Pinned Page ▸ 的条件见 pinnedTabs/editPinnedMenu.ts editPinnedVisible（与固定标签共用）。
 */
export function favMenuState(n: number) {
    return {
        /** 第 1 项：N < 2 “Copy Link”，N ≥ 2 “Copy Links”（out7/0x102ebec78.c L155） */
        copyLabel: n >= 2 ? "fav.copyLinks" : "tab.copyLink",
        /** 第 6 项 Change Icon…：多选时显示但置灰（rFV2/102ed6ffc.c 在 N ≠ 1 时清 enabled） */
        changeIconDisabled: n !== 1,
        /** 第 7 项 Rename…：只在单选时出现（L685） */
        renameVisible: n === 1,
    };
}

/** ⛔ 收藏磁贴目前不能多选（MultiSelect 只认 .arc-tab[data-sel]），选中数恒为 1；Copy Links / Change Icon 置灰要等收藏多选实现后才会出现 */
export const favSelectionCount = () => 1;

/** 该收藏能解析出的网址（FUN_102a18f08 case 0，urlbar-menus-followup.md L467–512）：打开的标签的当前页网址优先，没有再取保存的网址；都没有 = undefined，Edit Pinned Page ▸ 整个不出现 */
export const resolveFavUrl = (currentPageUrl: string | undefined, savedUrl: string | undefined) => currentPageUrl || savedUrl || undefined;

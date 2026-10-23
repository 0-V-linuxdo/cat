/*
 * “Edit Pinned Page ▸” 子菜单（urlbar-menus-followup.md「收藏菜单完整结构」L326–415 第 10 项，out5/0x102ec5d7c.c L968–1047 → out7/0x102eb73c0.c）。
 * 固定标签与收藏共用同一构造（L989：(FUN_100d2a328 & 0xfe) != 2，即 Favorites(0) / Pinned(1)）。纯构造，不依赖插件状态，便于两处复用与测试。
 *
 * 出现条件（L797 / L806 / L989）：单选（N == 1）、!anyLive、非无痕窗口（FUN_102951fd0）、FUN_102a18f08 取到的 URL 非 nil。
 *   固定区 / 收藏区没有 Live Folder 标签，anyLive 恒为假。
 * 子项按数组顺序（eb73c0，两项都无附加条件，enabled = 1）：
 *   ① "Replace Pinned URL with Current"（注释 “Replace the Pinned Tab with the current page”）→ Tab.replacePinnedTabWithCurrentPage(9)
 *   ② "Edit…"（注释 “Edit the pinned URL”，不是显示文字）→ Tab.editPinnedURL(11)
 * eb73c0 不比较“当前 URL 是否等于固定 URL”，所以 ① 不因相同而隐藏 / 置灰。
 * 位置：菜单「第三组」（Change Icon… / Rename… / Mute / Customize Page / Edit Pinned Page，L677–1047 之间无分隔线），排在 Mute 之后；见 ContextMenus.ts MENU_LAYOUT。
 */
import type { MenuItemDef, MenuTarget } from "@api/ContextMenus";

/** 第 10 项的出现条件。n = 选中数；incognito = 无痕窗口；url = 该项能解析出的网址（FUN_102a18f08 case 0：从 SidebarTab 取 URL） */
export function editPinnedVisible(n: number, incognito: boolean, url: string | undefined) {
    return n === 1 && !incognito && !!url;
}

/** 第 10 项要用的 URL（urlbar-menus-followup.md L467–572，FUN_102a18f08 case 0）：先取当前页 URL（打开的标签），取不到才回退到保存的 URL（savedURL）。两者都没有 → 整个子菜单不出现 */
export const editPinnedUrlOf = (current: string | undefined, saved: string | undefined) => current || saved || undefined;

export interface EditPinnedOptions {
    /** 出现条件；通常为 t => editPinnedVisible(选中数, 无痕, 网址) */
    visible(t: MenuTarget): boolean;
    /** ① Replace Pinned URL with Current：用该项打开的标签的当前网址替换固定网址 */
    replace(t: MenuTarget): unknown;
    /** ② Edit…：编辑固定网址 */
    edit(t: MenuTarget): unknown;
    /** ② 的文字键；默认 pinned.editPinnedUrl（"Edit…"） */
    editLabel?: string;
}

/** 生成 “Edit Pinned Page ▸” 菜单项（id editPinned；子项 id replace、editUrl，作为 data-test） */
export function editPinnedMenu(o: EditPinnedOptions): MenuItemDef {
    return {
        id: "editPinned", label: "pinned.editPinned", visible: o.visible, run: () => { },
        submenu: () => [
            { id: "replace", label: "pinned.replace", run: o.replace },
            { id: "editUrl", label: o.editLabel ?? "pinned.editPinnedUrl", run: o.edit },
        ],
    };
}

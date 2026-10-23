/* 侧边栏右键菜单注册表（对应 Void++ src/api/ContextMenus.tsx） */
import { createRegistry, type Registry } from "@api/registry";

export type MenuLocation = "tab" | "pinned" | "favorite" | "folder" | "space" | "sidebar";

export interface MenuTarget {
    tabId?: number;
    url?: string;
    title?: string;
    itemId?: string;
    spaceId?: string;
    /** 右键所在列表中、该项之下的所有 tabId（用于 Archive Below） */
    below?: number[];
    /** 该项之上的所有 tabId（Archive Tabs Above） */
    above?: number[];
}

/**
 * 菜单版式：id → [分组, 顺序]。项目名称来自 sidebar-full-spec §6/§7/§10；顺序与分组：源码未找到（menus-spec.md §3），为现值。
 * 各插件只负责注册项；顺序和分隔线在这里统一，未列出的项排在所属位置的末尾分组。
 */
export const MENU_LAYOUT: Partial<Record<MenuLocation, Record<string, [number, number]>>> = {
    /* tab：顺序 ✅ menus-spec.md §3.2（审计 52193 X-01）：Copy Link | Change Icon / Rename Tab / Mute（组 3，与组 4 Customize Page / Edit Pinned Page 之间无分隔线）
     * | Open in Split View / Duplicate / Move to（组 5，tab-tooltip-internal-moveto.md §2）| Close Tab(s)（组 6，FUN_102ecb26c）+ Archive Other/Below/Above（组 7；L1191 之后到 L1647 无分隔线，同组）。
     * route/separate 为扩展自有 ⛔。Share 扩展做不到不加；Customize Page 无对应 ⛔。Move to 非无痕窗口才有（「菜单定案」§2）。Pin / Add to Favorites 不在右键菜单（「菜单定案」§1 字符串 0 命中）。Archive Tab(s)/Remove Pin(s)（FUN_102ecb2ec）扩展无对应项 ⛔。 */
    tab: { copy: [1, 10], md: [1, 11], changeIcon: [2, 19], rename: [2, 20], mute: [2, 21], split: [3, 30], dup: [3, 31], moveTo: [3, 32], route: [4, 41], separate: [4, 42], close: [6, 60], others: [7, 70], below: [7, 71], above: [7, 72] },
    /* pinned：同 tab 菜单的前几组（审计 52193 P-04）：Copy Link | Change Icon / Rename Tab / Mute / Edit Pinned Page ▸（① Replace Pinned URL with Current ② Edit…；urlbar-menus-followup.md L326–415 第 8、10 项，同一组、无分隔线，Edit Pinned Page 在 Mute 之后）。
     * mute 槽位与 tab 菜单同值（media 插件 muteMenuItem 注册到 pinned / favorite）。
     * 组 4（Arc 第 11–13 项，L1074 分隔线之后）：Open in Split View（无条件）/ Duplicate（只要求 !anyLive，无数量限制）/ Move to，值同 tab 菜单（splitView splitMenuItem、tabActions dupMenuItem 注册到 pinned）。
     * 组 6：Remove Pin（「菜单定案」§4，out5/0x102ec5d7c.c L1196–1301）。右键菜单里没有 Reset / Unpin / Delete（§4.2，只在主菜单栏）。 */
    /* favorite：组 6 Close Tab(s) + Remove Favorite（urlbar-menus-followup.md「菜单定案」§4：Close Tab 只在全是 Favorites 时出现；“Close Favorite” 在 1.169.0 无调用点 ⛔ 不用）；Reset 只在主菜单栏 */
    /* favorite 前几组同 pinned（「收藏菜单完整结构」第 1、6–10 项）：Copy Link(s) | Change Icon… / Mute / Edit Pinned Page ▸。原先未列出 → 落到 900+ 排在 Remove Favorite 之后，此处补齐 */
    /* favorite 其余项（「收藏菜单完整结构」第 7、11、12 项，与 tab 同值）：Rename…（单选，renameFavorite(12)，favorites 插件注册）| Open in Split View / Duplicate（splitView / tabActions 注册到 favorite 位置）。
     * 不做：Live Calendar ▸、Top App 开关组、Customize Page、Share ▸ / Share N Items…、Move to ▸（全为收藏时是 Profile 列表，扩展无 Profile）⛔ */
    favorite: { copy: [1, 10], changeIcon: [2, 19], rename: [2, 20], mute: [2, 21], editPinned: [2, 22], split: [3, 30], dup: [3, 31], closeTab: [6, 60], remove: [6, 61] },
    /* pinned 组 6 只有 Remove Pin(s)（「菜单定案」§4，无 Close Tab）；Move to 与 tab 菜单同位（组 5，§2） */
    pinned: { copy: [1, 10], changeIcon: [2, 19], rename: [2, 20], mute: [2, 21], editPinned: [2, 22], split: [3, 30], dup: [3, 31], moveTo: [3, 32], removePin: [6, 61] },
    /* folder：顺序 ✅ urlbar-menus-followup.md §5.1（listContextMenu，rMenu2/0x102ea8d6c.c）：[Share Folder… ⛔ 扩展没有，不加] | New Nested Folder… / Turn “名称” into Space / Copy All Links（+ as Markdown）
     * | Change Icon / Rename… | Duplicate / 第 8 项（FUN_102ebf3b4 = Move to 构造器，tab-tooltip-internal-moveto.md L46）| Delete。paste 为扩展自有（默认关），放组 1 末尾 ⛔。 */
    folder: { sub: [1, 10], toSpace: [1, 11], copyLinks: [1, 12], copyMd: [1, 13], paste: [1, 14], changeIcon: [2, 20], rename: [2, 21], dup: [3, 30], move: [3, 31], delete: [4, 40] },
    sidebar: { newTab: [1, 10], newFolder: [1, 11], newSpace: [1, 12], renameSpace: [2, 20], spaceColor: [2, 21], spaceTheme: [2, 22], resetSpaceTheme: [2, 23], appearance: [3, 30], gradient: [3, 31] },
};

export interface MenuItemDef {
    id: string;
    label: string | ((t: MenuTarget) => string);
    /** 对应的命令：菜单右侧显示它的快捷键（同 Arc 菜单） */
    command?: string;
    /** 浏览器保留、扩展不能接管但 Arc 菜单里显示的快捷键（如 ⌘W / ⌘T），仅显示 */
    shortcut?: string;
    order?: number;
    visible?(t: MenuTarget): boolean;
    run(t: MenuTarget): unknown;
    /** 子菜单（如“移到空间 ›”）；有子菜单时 run 不会被调用 */
    submenu?(t: MenuTarget): MenuItemDef[];
    /** 子菜单里的分隔线（Move to：Space 列表 → 分隔线 → New Space…） */
    separator?: boolean;
    checked?(t: MenuTarget): boolean;
    /** data-test（自检用） */
    test?: string;
    /** 分组：相邻两项的 group 不同时中间画分隔线（同 Arc 菜单） */
    group?: number;
    disabled?: boolean | ((t: MenuTarget) => boolean);
    /** 悬停说明（例如不可用的原因） */
    title?: string | ((t: MenuTarget) => string);
    danger?: boolean;
}

const registries = new Map<MenuLocation, Registry<MenuItemDef & { plugin: string }>>();
export function menuRegistry(loc: MenuLocation) {
    let r = registries.get(loc);
    if (!r) { r = createRegistry(); registries.set(loc, r); }
    return r;
}

export function addContextMenuItem(loc: MenuLocation, plugin: string, def: MenuItemDef) {
    menuRegistry(loc).set(`${plugin}:${def.id}`, { ...def, plugin });
}

export function removeContextMenuItems(loc: MenuLocation, plugin: string) {
    const r = menuRegistry(loc);
    for (const [id, v] of r.sorted()) if (v.plugin === plugin) r.delete(id);
}

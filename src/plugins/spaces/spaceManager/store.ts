import { tr } from "@api/i18n";
import { createPluginStore } from "@api/Storage";

export const SPACE_COLORS = ["blue", "purple", "pink", "red", "orange", "yellow", "green", "cyan", "grey"] as const;
export type SpaceColor = typeof SPACE_COLORS[number];
export const COLOR_HEX: Record<SpaceColor, string> = {
    blue: "#4c8bf5", purple: "#9b6cf0", pink: "#ec6fb4", red: "#e5534b", orange: "#f08c3a",
    yellow: "#e5b93a", green: "#4cb27a", cyan: "#3ab8c9", grey: "#8e8e99",
};

/** 每个空间自己的主题（同 Arc 的主题选择器）；未设置的项沿用全局 Themes 设置 */
export interface SpaceTheme { gradient?: "off" | "soft" | "duo"; color2?: SpaceColor; noise?: boolean }
export interface Space { id: string; name: string; icon: string; color: SpaceColor; theme?: SpaceTheme }
export interface SpacesData {
    spaces: Space[];
    activeId: string;
    /** tabId → spaceId */
    tabSpace: Record<string, string>;
    /** spaceId → 该 Space 最后激活的 tabId */
    lastTab: Record<string, number>;
    /** 多窗口：windowId → 该窗口当前的 Space（每个窗口独立切换，同 Arc）；activeId = 最近聚焦窗口的 Space */
    activeByWin?: Record<string, string>;
    /** Air Traffic Control：新打开的这些站点自动归到指定 Space */
    routes?: { host: string; spaceId: string }[];
}

export const spacesStore = createPluginStore<SpacesData>("spaces", () => ({
    spaces: [{ id: "default", name: tr("spaces.defaultName"), icon: "", color: "blue" }],
    activeId: "default",
    tabSpace: {},
    lastTab: {},
}));

let currentWin: () => number | undefined = () => undefined;
/** 侧边栏上下文注册“本窗口 id”，使 activeSpace() 返回本窗口的 Space */
export const setSpaceWindow = (fn: () => number | undefined) => { currentWin = fn; };
/** 某窗口当前的 Space id（未记录则用全局 activeId） */
export const activeIdOf = (windowId?: number, d = spacesStore.get()): string => {
    const id = windowId != null ? d.activeByWin?.[windowId] : undefined;
    return id && d.spaces.some(s => s.id === id) ? id : d.activeId;
};
export const activeSpace = (): Space => {
    const d = spacesStore.get();
    const id = activeIdOf(currentWin(), d);
    return d.spaces.find(s => s.id === id) ?? d.spaces[0];
};
export const spaceOfTab = (tabId: number | undefined): string =>
    (tabId != null && spacesStore.get().tabSpace[tabId]) || spacesStore.get().spaces[0].id;

/** “编辑主题颜色…”：Themes 插件启用时注册自定义主题选择器（移植自 Zen 的渐变生成器）；未启用时退回颜色色板 */
export const themePickerHook: { open?: (spaceId: string, at: { x: number; y: number }) => void } = {};

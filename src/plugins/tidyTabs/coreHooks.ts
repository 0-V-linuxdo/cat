/* 可降级的核心接入：core-api-proposal.md 第 8 节中仍在核心队列里的部分（Today 标签读取、建 / 移除组、带按钮的提示）。
 * Today 头部按钮已改用正式接口 @api/Slots addTodayHeaderButton（见 index.ts）。查不到返回 null，插件降级。 */
import * as Tabs from "@api/Tabs";

const pick = <F>(mod: unknown, name: string): F | null => { const f = (mod as Record<string, unknown>)[name]; return typeof f === "function" ? f as F : null; };

export interface TodayGroup { id: string; name: string; tabIds: number[]; misc?: boolean }

/** 当前窗口、当前空间 Today 区（未固定、未被认领）的标签，按显示顺序 */
export const getTodayTabs = () => pick<() => chrome.tabs.Tab[]>(Tabs, "getTodayTabs")?.() ?? null;
export const createTodayGroups = (plugin: string, groups: Omit<TodayGroup, "id">[]) =>
    pick<(p: string, g: Omit<TodayGroup, "id">[]) => Promise<TodayGroup[]>>(Tabs, "createTodayGroups")?.(plugin, groups) ?? null;
export const removeTodayGroups = (ids: string[]) => pick<(ids: string[]) => Promise<void>>(Tabs, "removeTodayGroups")?.(ids) ?? null;
/** 带按钮的提示；PanelShell 只在 panel 里按需加载（它在模块加载时会访问 location） */
export async function toastWithAction(text: string, action: { label: string; run(): unknown }, ms?: number): Promise<boolean> {
    const f = pick<(t: string, a: { label: string; run(): unknown }, ms?: number) => void>(await import("@api/PanelShell"), "toastWithAction");
    if (!f) return false;
    f(text, action, ms); return true;
}

export const coreReady = () => !!(pick(Tabs, "getTodayTabs") && pick(Tabs, "createTodayGroups") && pick(Tabs, "removeTodayGroups"));

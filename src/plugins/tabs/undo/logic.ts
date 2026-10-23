/* Undo 的纯逻辑（无 chrome 依赖，便于单元测试） */
import { tr } from "@api/i18n";
import type { UndoEntry } from "@api/Undo";

export interface ClosedTab { oldId: number; url: string; title: string; index: number; windowId?: number; spaceId?: string }

/** 同一次批量关闭（清空 Today / 关闭所选）几乎同时触发：MERGE_MS 内的合并成一条撤销记录。
 * 不能太长：用户连按 ⌘W 关闭的每个标签应各自一条，连按“重新打开”才会一个个往回恢复（同浏览器）。 */
export const MERGE_MS = 80;
export const tabsLabel = (n: number) => (n === 1 ? tr("undo.closeTab") : tr("undo.closeN", n));

export function pushEntry(stack: UndoEntry[], e: UndoEntry, max: number): UndoEntry[] {
    const last = stack.at(-1);
    if (e.kind === "tabsClosed" && last?.kind === "tabsClosed" && e.at - last.at <= MERGE_MS) {
        const tabs = [...(last.data as ClosedTab[]), ...(e.data as ClosedTab[])];
        return [...stack.slice(0, -1), { ...last, at: e.at, data: tabs, label: tabsLabel(tabs.length) }];
    }
    const next = [...stack, e];
    return next.length > max ? next.slice(next.length - max) : next;
}

/** 取出最近一条（可限定 kind），返回剩余栈 */
export function popEntry(stack: UndoEntry[], kind?: string): { entry?: UndoEntry; rest: UndoEntry[] } {
    for (let i = stack.length - 1; i >= 0; i--) {
        if (!kind || stack[i].kind === kind) return { entry: stack[i], rest: [...stack.slice(0, i), ...stack.slice(i + 1)] };
    }
    return { rest: stack };
}

/** 恢复顺序：按原 index 升序，保证位置正确 */
export const restoreOrder = (tabs: ClosedTab[]) => tabs.toSorted((a, b) => a.index - b.index);

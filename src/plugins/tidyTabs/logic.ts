/* 纯函数：标签 id、拼提示词、解析 [[tabID, groupName], …]、补 Other 组（arc-analysis/tidy-tabs.md §C）。 */
import { ARC_PROMPT_OUTPUT_HEADER, ARC_PROMPT_TABS_HEADER, PROMPT_EXAMPLE_OUTPUT } from "./constants";

export interface TidyTab { id: number; title: string; url?: string; openerTabId?: number }
export interface TabGroupPlan { name: string; tabIds: number[]; misc?: boolean }

const domainOf = (url?: string) => { try { return url ? new URL(url).hostname.replace(/^www\./, "") || "tab" : "tab"; } catch { return "tab"; } };

/** 给每个标签分配 Arc 式 id「域名/序号」（同域名按出现顺序从 0 计）。返回 tabId → 文本 id */
export function assignIds(tabs: TidyTab[]): Map<number, string> {
    const count = new Map<string, number>();
    const out = new Map<number, string>();
    for (const t of tabs) {
        const d = domainOf(t.url);
        const n = count.get(d) ?? 0;
        count.set(d, n + 1);
        out.set(t.id, `${d}/${n}`);
    }
    return out;
}

/** 每行 `id: title`，有打开来源（且来源也在列表里）时附 ` ↳ 来源id` */
export function tabLines(tabs: TidyTab[], ids = assignIds(tabs)): string {
    return tabs.map(t => {
        const from = t.openerTabId != null ? ids.get(t.openerTabId) : undefined;
        return `${ids.get(t.id)}: ${t.title.replace(/\s+/g, " ").trim()}${from ? ` ↳ ${from}` : ""}`;
    }).join("\n");
}

/** 拼接顺序（§C.1）：正文 → ``` 示例输出 ``` → "Here are my tabs…" → 标签列表 → 结尾句。
 *  各段之间用换行连接是推断（消息由 0x101ddcff8 组装为多条 chat message，角色细节未确认）。 */
export function buildPrompt(body: string, tabs: TidyTab[], ids = assignIds(tabs)): string {
    return `${body}\n\`\`\`\n${JSON.stringify(PROMPT_EXAMPLE_OUTPUT)}\n\`\`\`\n${ARC_PROMPT_TABS_HEADER}\n${tabLines(tabs, ids)}${ARC_PROMPT_OUTPUT_HEADER}`;
}

/** 取 ``` 代码块里的内容；没有代码块则用全文 */
export function extractCodeBlock(raw: string): string {
    const m = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    return (m ? m[1] : raw).trim();
}

/** 解析二维数组 [[tabID, groupName], …]（§C.2）；格式不对 → null */
export function parseAssignments(raw: string): [string, string][] | null {
    let v: unknown;
    try { v = JSON.parse(extractCodeBlock(raw)); } catch { return null; }
    if (!Array.isArray(v)) return null;
    const out: [string, string][] = [];
    for (const row of v) {
        if (!Array.isArray(row) || row.length < 2 || typeof row[0] !== "string" || typeof row[1] !== "string") continue;
        const name = row[1].trim();
        if (row[0].trim() && name) out.push([row[0].trim(), name]);
    }
    return out.length ? out : null;
}

/** 生成分组：文本 id 映射回标签；每个标签只进第一个组；组按首次出现顺序（Arc 的排序：源码未找到）。
 *  Other 组由程序补充（§C.2）。哪些标签进 Other：源码未找到——这里是我们的推断：没被分配的标签。 */
export function planGroups(tabs: TidyTab[], assignments: [string, string][], miscName: string, ids = assignIds(tabs)): TabGroupPlan[] {
    const byText = new Map([...ids].map(([tabId, text]) => [text, tabId]));
    const used = new Set<number>();
    const groups = new Map<string, number[]>();
    for (const [text, name] of assignments) {
        const tabId = byText.get(text);
        if (tabId == null || used.has(tabId)) continue;
        used.add(tabId);
        groups.set(name, [...groups.get(name) ?? [], tabId]);
    }
    const plans: TabGroupPlan[] = [...groups].map(([name, tabIds]) => ({ name, tabIds }));
    const rest = tabs.map(t => t.id).filter(i => !used.has(i));
    if (rest.length) {
        const other = plans.find(p => p.name === miscName);
        if (other) { other.tabIds.push(...rest); other.misc = true; } else plans.push({ name: miscName, tabIds: rest, misc: true });
    }
    return plans;
}

export const shouldShowButton = (todayCount: number, min: number) => todayCount >= Math.max(1, min);

/** Today 头部按钮 visible(ctx)：核心传入 todayCount */
export const buttonVisible = (ctx: { todayCount: number }, min: number) => shouldShowButton(ctx.todayCount, min);
/** Today 头部按钮 enabled(ctx)：分组进行中置灰 */
export const buttonEnabled = (groupingInProgress: boolean) => !groupingInProgress;

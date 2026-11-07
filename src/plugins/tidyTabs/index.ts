/* 可选插件「Tidy Tabs」（Arc Max：tidyTabs，arc-analysis/tidy-tabs.md §A）。默认关闭。
 * 用模型把当前空间 Today 区的未固定标签分成若干标签组，剩下的进“杂项”组；不建文件夹、不改标签名。
 * 入口：Today 区头部按钮（Arc SidebarTidyButton）。撤销：分组后的撤销提示；组头可单独移除（由核心渲染）。
 * 模型设置读 Tidy Tab Titles 插件的设置（接口地址 / 模型 / key / 超时），不另设。
 * 依赖核心接口（coreHooks.ts）；没有时只注册命令，运行时提示“暂不可用”。 */
import { recordUndo, addUndoKind } from "@api/Undo";
import { getLang, tr } from "@api/i18n";
import { toast } from "@api/PanelShell";
import { getPluginSettings } from "@api/Settings";
import { addTodayHeaderButton, type TodayHeaderCtx } from "@api/Slots";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";

import { chatJson, getApiKey } from "../_shared/llm";
import { MIN_TABS, PROMPT_BODY } from "./constants";
import { coreReady, createTodayGroups, getTodayTabs, removeTodayGroups, toastWithAction } from "./coreHooks";
import "./i18n";
import { buildPrompt, parseAssignments, planGroups, buttonEnabled, buttonVisible } from "./logic";

const UNDO_KIND = "tidyTabs.groups";

/** 读 Tidy Tab Titles 的模型设置（共用一套）；API key 读共用键（_shared/llm.ts） */
export async function sharedModelConfig() {
    const s = getPluginSettings("TidyTabTitles") as Record<string, unknown>;
    return {
        endpoint: String(s.endpoint ?? ""), model: String(s.model ?? ""), apiKey: await getApiKey(),
        timeoutMs: Math.max(2, Number(s.timeout) || 8) * 1000, language: getLang() === "zh" ? "Chinese" : "English",
    };
}

/** 分组进行中：tidy() 开始置 true，finally 清除；用于按钮 enabled 置灰和防重入 */
let busy = false;
export const isGroupingInProgress = () => busy;

async function tidy(): Promise<void> {
    if (!coreReady()) { toast(tr("tidyTabs.unavailable")); return; }
    const cfg = await sharedModelConfig();
    if (!cfg.endpoint || !cfg.model) { toast(tr("tidyTabs.notConfigured")); return; }
    const tabs = (getTodayTabs() ?? []).filter(t => t.id != null).map(t => ({ id: t.id!, title: t.title || t.url || "", url: t.url, openerTabId: t.openerTabId }));
    const prompt = buildPrompt(PROMPT_BODY, tabs);
    if (!tabs.length || busy) return;
    busy = true;
    try {
        const content = await chatJson(prompt, cfg);
        const assignments = content == null ? null : parseAssignments(content);
        if (!assignments) { toast(tr("tidyTabs.failed")); return; }
        const created = await createTodayGroups("TidyTabs", planGroups(tabs, assignments, tr("tidyTabs.other")));
        if (!created?.length) { toast(tr("tidyTabs.failed")); return; }
        const ids = created.map(g => g.id);
        recordUndo(UNDO_KIND, tr("tidyTabs.undoLabel"), ids);
        const undo = () => void removeTodayGroups(ids);
        if (!await toastWithAction(tr("tidyTabs.undoLabel"), { label: tr("tidyTabs.undo"), run: undo })) toast(tr("tidyTabs.undoLabel")); // 降级：无按钮提示，⌘Z 撤销
    } finally { busy = false; }
}

export default definePlugin({
    name: "TidyTabs",
    label: "plugin.tidyTabs.label",
    description: "plugin.tidyTabs.desc",
    authors: [Devs.ArcSidebar],
    tags: ["tabs"],
    featureTags: ["tidyTabs.tag.group", "tidyTabs.tag.undo"],
    commands: [{ id: "tidyTabs.run", label: "tidyTabs.cmd", context: "panel", run: tidy }],
    panel: {
        start() {
            return [
                addUndoKind(UNDO_KIND, data => removeTodayGroups(data as string[]) ?? undefined),
                // 核心 Today 头部按钮（Arc SidebarTidyButton）：文字 "Tidy"，图标 "broom"（Arc asset broom-stick，12pt 模板图），提示 "Organize Today Tabs"，≥ MIN_TABS 个 Today 标签才显示；
                // 计数用核心传入的 ctx.todayCount（Today 标签变化时核心重算），分组进行中置灰。
                addTodayHeaderButton("TidyTabs", {
                    id: "tidyTabs", icon: "broom", label: tr("tidyTabs.button"), title: tr("tidyTabs.tooltip"), order: 10,
                    visible: (ctx: TodayHeaderCtx) => buttonVisible(ctx, MIN_TABS),
                    enabled: () => buttonEnabled(busy),
                    run: () => void tidy(),
                }),
            ];
        },
    },
});

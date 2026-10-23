/* 可选插件「Tidy Tab Titles」（Arc Max：renamePinnedTabs，arc-analysis/tidy-tabs.md §B）。默认关闭。
 * 固定标签时：站点规则（数据源码未找到，暂空）→ 模型改写成 1-3 个词。用户手动改过名的不动；右键「Reset Name and Icon」撤销。
 * 依赖核心接口（coreHooks.ts）；接口不存在时插件不做任何事。 */
import { addContextMenuItem, removeContextMenuItems } from "@api/ContextMenus";
import { getLang } from "@api/i18n";
import { definePluginSettings, getPluginSettings, removePluginSetting } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";

import { coreReady, getPinnedTitleState, onTabPinned, resetPinnedTitle, setPinnedTitle } from "./coreHooks";
import { apiKeySetting, getApiKey, migrateLegacyApiKey } from "../_shared/llm";
import "./i18n";
import { tidyTitle } from "./logic";

const settings = definePluginSettings({
    endpoint: { type: OptionType.STRING, description: "tidyTabTitles.endpoint", default: "" },
    model: { type: OptionType.STRING, description: "tidyTabTitles.model", default: "" },
    apiKey: apiKeySetting("tidyTabTitles.apiKey"),
    timeout: { type: OptionType.NUMBER, description: "tidyTabTitles.timeout", default: 8, min: 2, max: 30 },
});

const cfg = async () => ({
    endpoint: String(settings.store.endpoint ?? ""), model: String(settings.store.model ?? ""), apiKey: await getApiKey(),
    timeoutMs: Math.max(2, Number(settings.store.timeout) || 8) * 1000, language: getLang() === "zh" ? "Chinese" : "English",
});

const MIGRATE = () => migrateLegacyApiKey(p => (getPluginSettings(p) as Record<string, unknown>).apiKey, p => removePluginSetting(p, "apiKey"));

export default definePlugin({
    name: "TidyTabTitles",
    label: "plugin.tidyTabTitles.label",
    icon: "sparkles",
    description: "plugin.tidyTabTitles.desc",
    authors: [Devs.ArcSidebar],
    tags: ["tabs"],
    settings,
    panel: {
        start() {
            void MIGRATE();
            if (!coreReady()) return; // 降级：核心还没有固定标签标题接口
            const offPin = onTabPinned("TidyTabTitles", async info => {
                const st = getPinnedTitleState(info.nodeId);
                const r = await tidyTitle({ url: info.url, title: info.title, userRenamed: st?.titleSource === "user" }, { cfg: await cfg() });
                if (r.ok) await setPinnedTitle(info.nodeId, r.title, "auto");
            });
            // 只对插件改过名的固定标签显示；核心将来自带「Reset Name and Icon」时可删掉这一项
            addContextMenuItem("pinned", "TidyTabTitles", {
                id: "tidyTabTitles.reset", label: "tidyTabTitles.reset", order: 45,
                visible: t => !!t.itemId && getPinnedTitleState(t.itemId)?.titleSource === "auto",
                run: t => resetPinnedTitle(t.itemId!),
            });
            return [...(offPin ? [offPin] : []), () => removeContextMenuItems("pinned", "TidyTabTitles")];
        },
    },
});

/*
 * Auto Archive（§6.3）：Today 标签在一段时间未访问后自动关闭进入归档。
 * 跳过：收藏 / 固定 / 文件夹中的标签、当前激活标签、正在播放声音的标签。
 * 时长档位（审计 52193 S-01，sidebar-features.md §11 / tab-sleep.md:57 / library-full-spec.md:51）：Never / 30 days / 7 days / 24 hours / 12 hours / 6 hours / 1 hour，
 * 顺序同 Arc 下拉；不做 6h → 12h 迁移（S-01）。内部调试档 “[internal only] 20 seconds” 不加。
 * 默认值 12h：已定案，见 audit-52193-answers.md「自动归档默认值与 Toast 位置定案」。
 */
import { safe } from "@api/ErrorLog";
import { claimedTabIds } from "@api/Claims";
import { onTabIdRemap, remapRecord } from "@api/TabIdRemap";
import { listen } from "@api/ChromeEvents";
import { subscribe } from "@api/Events";
import { toast } from "@api/PanelShell";
import { tr } from "@api/i18n";
import { definePluginSettings } from "@api/Settings";
import { createPluginStore } from "@api/Storage";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { autoClosing } from "@plugins/tabs/archive";

const HOUR = 3600_000;
const settings = definePluginSettings({
    after: {
        type: OptionType.SELECT, description: "autoArchive.after",
        options: [{ label: "autoArchive.never", value: 0 }, { label: "autoArchive.30d", value: 720 }, { label: "autoArchive.7d", value: 168 }, { label: "autoArchive.24h", value: 24 }, { label: "autoArchive.12h", value: 12, default: true /* 12h 定案，见文件头 */ }, { label: "autoArchive.6h", value: 6 }, { label: "autoArchive.1h", value: 1 }],
    },
});
const store = createPluginStore<{ lastActive: Record<string, number>; noticed?: boolean }>("autoArchive", () => ({ lastActive: {} }));
const ALARM = "arc-auto-archive";

/** opts（自测用）：now 伪造时钟；onlyTabs 只检查这些标签 */
async function sweep(opts?: { now?: number; onlyTabs?: number[] }) {
    const hours = Number(settings.store.after);
    if (!hours) return [];
    const now = opts?.now ?? Date.now();
    const claimed = claimedTabIds();
    const last = store.get().lastActive;
    const victims = (await chrome.tabs.query({ windowType: "normal" })).filter(t =>
        t.id != null && !t.active && !t.audible && !t.pinned && !claimed.has(t.id) && (!opts?.onlyTabs || opts.onlyTabs.includes(t.id)) && now - (last[t.id] ?? t.lastAccessed ?? now) > hours * HOUR);
    for (const t of victims) autoClosing.add(t.id!);
    if (victims.length) await chrome.tabs.remove(victims.map(t => t.id!));
    return victims.map(t => t.id!);
}

export default definePlugin({
    name: "AutoArchive",
    authors: [Devs.ArcSidebar],
    label: "plugin.autoArchive.label",
    description: "plugin.autoArchive.desc",
    tags: ["tabs"],
    dependencies: ["Archive"],
    enabledByDefault: true,
    settings,
    commands: [{ id: "autoArchive.now", label: "autoArchive.cmdRun", context: "background", run: (a?: unknown) => sweep(a as { now?: number; onlyTabs?: number[] } | undefined) }],
    // 第一次自动归档时给出一次性提示（同 Arc 的首次横幅）
    panel: {
        start: () => subscribe("tabArchived", e => {
            if (e.reason !== "auto" || store.get().noticed) return;
            void store.update(x => { x.noticed = true; });
            // S-03：Arc EDU 横幅原文（library-full-spec.md:53），时长取当前设置的档位文案
            const hrs = Number(settings.store.after), key = hrs >= 168 ? `autoArchive.${hrs / 24}d` : `autoArchive.${hrs}h`;
            toast(tr("autoArchive.firstNotice", tr(key)), 9000);
        }),
    },
    background: {
        async start() {

            await chrome.alarms.create(ALARM, { periodInMinutes: 10 });
            return [
                () => void safe(chrome.alarms.clear(ALARM), "alarms.clear"),
                listen("alarms.onAlarm", a => { if (a.name === ALARM) void sweep(); }),
                listen("tabs.onActivated", ({ tabId }) => void store.update(x => { x.lastActive[tabId] = Date.now(); })),
                listen("tabs.onRemoved", id => void store.update(x => { delete x.lastActive[id]; })),
                // 重启后标签 id 全变：按快照映射搬运最后活跃时间（不存活且没映射的丢掉）
                onTabIdRemap((map, alive) => store.update(x => { x.lastActive = remapRecord(x.lastActive, map, alive); })),
            ];
        },
    },
});

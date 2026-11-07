/*
 * Live Calendar（§14）：Arc 用 Google 日历 OAuth；扩展里改为读取用户提供的 iCal 私密地址（日历设置 › “iCal 格式的私密地址”），
 * 在侧边栏底部显示今天的下一个会议、倒计时和“加入”按钮。重复事件（RRULE）不展开。
 */
import "@components/ArcTooltip";
import { safe } from "@api/ErrorLog";
import { tr } from "@api/i18n";
import { parkedInterval } from "@api/ParkLife";
import { h } from "@api/dom";
import { addSection, refresh } from "@api/Slots";
import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { type CalEvent, nextEvent, parseIcs } from "./ics";

const settings = definePluginSettings({
    icsUrl: { type: OptionType.STRING, default: "", description: "cal.icsUrl" },
});

let events: CalEvent[] = [];
async function load() {
    const url = String(settings.store.icsUrl || "").trim();
    if (!/^https?:\/\//.test(url.replace(/^webcal:/, "https:"))) { events = []; refresh(); return; }
    try { events = parseIcs(await (await fetch(url.replace(/^webcal:/, "https:"))).text()); } catch { events = []; }
    refresh();
}

const fmt = (ms: number) => { const m = Math.max(0, Math.round(ms / 60000)); return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`; };

export default definePlugin({
    name: "LiveCalendar",
    authors: [Devs.ArcSidebar],
    label: "plugin.liveCalendar.label",
    description: "plugin.liveCalendar.desc",
    tags: ["library"],
    enabledByDefault: false,
    settings,
    onSettingsChange: () => void load(),
    // Arc ⌃⌘J Join Meeting：点侧边栏里下一个会议的「加入」
    commands: [{ id: "cal.join", label: "cal.join", keywords: ["join meeting"], context: "panel", defaultKey: "Ctrl+Mod+J", run: () => document.querySelector<HTMLElement>(".arc-cal-join")?.click() }],
    panel: {
        start() {
            void load();
            const reload = parkedInterval(() => void load(), 15 * 60000); // 补丁 inpage-parked-timers-stop：停放时真停表（不再调度），切回若已到点补一次再重启（第 17 层只是到点时记脏位）
            const tick = parkedInterval(refresh, 30000);
            return [() => { reload(); tick(); }, addSection("footer", "LiveCalendar", {
                order: 1,
                render(el) {
                    const e = nextEvent(events);
                    if (!e) return;
                    const now = Date.now();
                    const when = e.start > now ? tr("cal.inTime", fmt(e.start - now)) : tr("cal.now");
                    el.append(h("div", { class: "arc-list-row arc-cal", "data-test": "live-calendar" },
                        h("span", { class: "arc-cal-dot" }),
                        h("span", { class: "arc-tab-title", "data-tip": e.title }, e.title),
                        h("small", null, when),
                        e.join ? h("button", { class: "arc-btn arc-cal-join", onclick: () => void safe(chrome.tabs.create({ url: e.join }), "tabs.create") }, tr("cal.join")) : null));
                },
            })];
        },
    },
});

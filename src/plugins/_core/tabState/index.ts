/*
 * TabState（必需，隐藏）：在 panel 中缓存当前窗口的标签，并在标签变化时触发重绘。
 * 其它插件通过 import 它导出的函数读取标签，而不是各自监听 chrome.tabs。
 */
import { isInpageHost, isParkedHost } from "@api/HostMode";
import { whileActive } from "@api/ParkLife";
import { refresh } from "@api/Slots";
import { debounce } from "@utils/misc";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
import { tabsSig } from "./sig";

let tabs: chrome.tabs.Tab[] = [];
let windowId: number | undefined;
let lastSig = "";
const byId = new Map<number, chrome.tabs.Tab>();
let offLife: (() => void) | undefined;

export const getTabs = () => tabs;
export const getTab = (id: number | undefined) => (id == null ? undefined : byId.get(id));
export const getWindowId = () => windowId;
export const activeTab = () => tabs.find(t => t.active);

async function reload() {
    // 弹窗模式（命令栏独立窗口）下，目标是打开它的那个普通窗口
    const target = Number(new URLSearchParams(location.search).get("win"));
    windowId = target || (await chrome.windows.getCurrent()).id;
    const next = await chrome.tabs.query({ windowId });
    // favicon-jitter：onUpdated 常带着没变的值反复触发（同 favIconUrl、status 抖动、width/height…）；标签状态一致就不整屏重绘
    const sig = tabsSig(next, windowId);
    if (sig === lastSig) return;
    lastSig = sig;
    tabs = next;
    byId.clear();
    for (const t of tabs) if (t.id != null) byId.set(t.id, t);
    refresh();
}
const schedule = debounce(() => { if (isParkedHost()) return; void reload(); }, 40); // 补丁 inpage-park-forever：停放的页内侧栏 iframe（后台标签长期留着）不随每个标签事件重查 / 重绘（N 个停放 iframe = 每个事件 N 次 tabs.query）；切回可见时 onVisible 立即补一次
const evs = () => [chrome.tabs.onCreated, chrome.tabs.onRemoved, chrome.tabs.onUpdated, chrome.tabs.onActivated,
    chrome.tabs.onMoved, chrome.tabs.onAttached, chrome.tabs.onDetached, chrome.tabs.onReplaced] as chrome.events.Event<() => void>[];

/* 补丁 tab-shake：页内侧栏的 iframe 停放在后台标签里时，页面被浏览器节流（setTimeout ≥1 s），上面的 40 ms 去抖 + onActivated 的刷新要等 ≥1 s 才跑 → 切回来先看到旧高亮 / 旧列表。
 * 切回可见的那一刻立刻对一次（sig 没变 = 不重绘）。只在 ?host=inpage 的 iframe 里挂（原生侧栏 / 弹窗行为不变） */
const onVisible = () => { if (document.visibilityState === "visible") void reload(); };

export default definePlugin({
    name: "TabState",
    authors: [Devs.ArcSidebar],
    label: "plugin.tabState.label",
    description: "plugin.tabState.desc",
    required: true,
    hidden: true,
    panel: {
        async start() {
            // 补丁 inpage-parked-timers-stop：停放且隐藏时连 8 个 tabs 事件监听一起摘（第 16 层只是回调里 return，事件仍逐个派发到每个停放 iframe）；切回时重挂，onVisible 的 reload 补读（同一次 visibilitychange）
            offLife = whileActive(() => { for (const e of evs()) e.addListener(schedule); }, () => { for (const e of evs()) e.removeListener(schedule); });
            if (isInpageHost()) document.addEventListener("visibilitychange", onVisible);
            await reload();
        },
        stop() { offLife?.(); offLife = undefined; document.removeEventListener("visibilitychange", onVisible); },
    },
});

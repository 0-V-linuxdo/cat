/*
 * TabState（必需，隐藏）：在 panel 中缓存当前窗口的标签，并在标签变化时触发重绘。
 * 其它插件通过 import 它导出的函数读取标签，而不是各自监听 chrome.tabs。
 */
import { refresh } from "@api/Slots";
import { debounce } from "@utils/misc";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";

let tabs: chrome.tabs.Tab[] = [];
let windowId: number | undefined;
const byId = new Map<number, chrome.tabs.Tab>();

export const getTabs = () => tabs;
export const getTab = (id: number | undefined) => (id == null ? undefined : byId.get(id));
export const getWindowId = () => windowId;
export const activeTab = () => tabs.find(t => t.active);

async function reload() {
    // 弹窗模式（命令栏独立窗口）下，目标是打开它的那个普通窗口
    const target = Number(new URLSearchParams(location.search).get("win"));
    windowId = target || (await chrome.windows.getCurrent()).id;
    tabs = await chrome.tabs.query({ windowId });
    byId.clear();
    for (const t of tabs) if (t.id != null) byId.set(t.id, t);
    refresh();
}
const schedule = debounce(() => void reload(), 40);
const evs = () => [chrome.tabs.onCreated, chrome.tabs.onRemoved, chrome.tabs.onUpdated, chrome.tabs.onActivated,
    chrome.tabs.onMoved, chrome.tabs.onAttached, chrome.tabs.onDetached, chrome.tabs.onReplaced] as chrome.events.Event<() => void>[];

export default definePlugin({
    name: "TabState",
    authors: [Devs.ArcSidebar],
    label: "plugin.tabState.label",
    description: "plugin.tabState.desc",
    required: true,
    hidden: true,
    panel: {
        async start() {
            for (const e of evs()) e.addListener(schedule);
            await reload();
        },
        stop() { for (const e of evs()) e.removeListener(schedule); },
    },
});

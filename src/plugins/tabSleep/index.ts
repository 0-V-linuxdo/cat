/* 插件「标签休眠」：闲置标签自动休眠释放内存。对齐 Arc，默认开启（Cat 决定）。
 * 跳过：激活 / 已休眠 / 没有激活记录 / 最近 10 个 / 播放音频（可开关）/ 固定和收藏（开关，超出 Arc，默认关）/ 白名单站点 / 未保存表单（含 iframe、onbeforeunload）/ 非 http 页面。
 * 对齐 Arc（arc-analysis/tab-sleep.md）：默认 4 小时（timeToDiscardTab），最近使用的 10 个标签不休眠（protectedLRUTabCount），每 5 分钟检查（samplingPeriod 300 s）。
 * 冻结（timeToFreezeTab 30 分钟）：扩展无法实现。
 * 36 小时 close tier（timeToCloseTab 129600 s）：开关，默认关（Cat 决定）。打开时归档而不是直接关闭：走核心 Archive 插件
 *   （tabs.onRemoved 记入归档，autoClosing 标为 auto），可在资料库归档里恢复；Archive 未启用时不执行。
 *   源码未找到：① close tier 开关由调用方传入，默认值源码未找到；② 到时间后是关闭还是归档源码未找到（生命周期代码只发出 freeze / discard / unload）。
 *   与 Today 自动归档（tabs/autoArchive）是两套独立机制，各自计时、互不影响。
 * 休眠本身不关闭标签，与 tabs/autoArchive 互不影响（各自记录激活时间）。 */
import { claimedTabIds } from "@api/Claims";
import { subscribe } from "@api/Events";
import { discardKeep } from "@api/Tabs";
import { isPluginEnabled } from "@api/PluginManager";
import { autoClosing } from "@plugins/tabs/archive";
import { listen } from "@api/ChromeEvents";
import { safe } from "@api/ErrorLog";
import { definePluginSettings } from "@api/Settings";
import { createPluginStore } from "@api/Storage";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";

import "./i18n";
import { anyUnsaved, CLOSE_AFTER_MIN, pickCloseTargets, pageHasBeforeUnload, pageHasUnsavedInput, pickSleepTargets, remapAfterRestart, type TabMeta, windowOrdinals } from "./logic";

const MIN = 60_000;
const ALARM = "cat-tab-sleep";

const settings = definePluginSettings({
    idle: {
        type: OptionType.SELECT, description: "tabSleep.idle",
        options: [
            { label: "tabSleep.15m", value: 15 }, { label: "tabSleep.1h", value: 60 },
            { label: "tabSleep.4h", value: 240, default: true }, { label: "tabSleep.12h", value: 720 },
        ],
    },
    skipHosts: { type: OptionType.STRING, description: "tabSleep.skipHosts", default: "" },
    keepPinned: { type: OptionType.BOOLEAN, description: "tabSleep.keepPinned", default: false },
    closeTier: { type: OptionType.BOOLEAN, description: "tabSleep.closeTier", detail: "tabSleep.closeTier.detail", default: false },
    sleepAudible: { type: OptionType.BOOLEAN, description: "tabSleep.sleepAudible", default: false },
});

const store = createPluginStore<{ lastActive: Record<string, number>; meta: Record<string, TabMeta> }>("tabSleep", () => ({ lastActive: {}, meta: {} }));
const list = (s: unknown) => typeof s === "string" ? s.split(/[\s,]+/).filter(Boolean) : [];
/** chrome.storage.session 在浏览器重启时清空：没有这个标记 = 新的浏览器会话，旧 tabId 失效 */
const SESSION_KEY = "tabSleep:session";

async function hasUnsaved(tabId: number): Promise<boolean> {
    try {
        const forms = await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func: pageHasUnsavedInput });
        if (anyUnsaved(forms)) return true;
        const bu = await chrome.scripting.executeScript({ target: { tabId }, func: pageHasBeforeUnload, world: "MAIN" });
        return bu.some(r => r.result === true);
    } catch { return true; } // 注入失败（受限页面等）时保守不休眠
}

/** 用核心 @api/Tabs 的 discardKeep 休眠：id 变化时它迁移 Space 归属、固定、收藏、文件夹等所有按 tabId 记的状态，并广播 tabReplaced */
const discard = (id: number, _url?: string): Promise<number | undefined> => discardKeep(id);

async function sweep(now = Date.now()): Promise<number[]> {
    await store.ready;
    let tabs = await chrome.tabs.query({ windowType: "normal" });
    const base = {
        now, idleMs: Number(settings.store.idle) * MIN, lastActive: store.get().lastActive, claimed: claimedTabIds(),
        skipHosts: list(settings.store.skipHosts), keepPinned: !!settings.store.keepPinned, sleepAudible: !!settings.store.sleepAudible,
    };
    // 只有核心 Archive 插件启用时才归档；未启用时关闭会直接丢失标签，所以不执行
    if (settings.store.closeTier && isPluginEnabled("Archive")) {
        for (const id of pickCloseTargets(tabs, { ...base, closeMs: CLOSE_AFTER_MIN * MIN })) {
            const t = tabs.find(x => x.id === id);
            if (!t?.discarded && await hasUnsaved(id)) continue;
            autoClosing.add(id); // 核心 Archive 的标记：记为自动归档（reason "auto"），可在资料库归档里恢复
            await chrome.tabs.remove(id).catch(() => { autoClosing.delete(id); });
        }
        tabs = await chrome.tabs.query({ windowType: "normal" });
    }
    const ids = pickSleepTargets(tabs, base);
    const done: number[] = [];
    for (const id of ids) {
        if (await hasUnsaved(id)) continue;
        const nid = await discard(id, tabs.find(t => t.id === id)?.url);
        if (nid != null) done.push(nid);
    }
    return done;
}

async function touch(id: number) {
    const t = await chrome.tabs.get(id).catch(() => undefined); /* 预期：标签可能已关闭（No tab with id），忽略 */
    const all = await chrome.tabs.query({ windowType: "normal" });
    const win = t?.windowId != null ? windowOrdinals(all).get(t.windowId) : undefined;
    await store.update(x => { x.lastActive[id] = Date.now(); x.meta[id] = { url: t?.url, win }; });
}

/** 启动时校验：新浏览器会话则按 URL + 窗口序号重映射，对不上的丢弃 */
async function reconcile() {
    await store.ready;
    const marked = (await chrome.storage.session.get(SESSION_KEY))[SESSION_KEY];
    const tabs = await chrome.tabs.query({ windowType: "normal" });
    if (!marked) {
        const r = remapAfterRestart(store.get().lastActive, store.get().meta ?? {}, tabs);
        await store.update(x => { x.lastActive = r.lastActive; x.meta = r.meta; });
        await chrome.storage.session.set({ [SESSION_KEY]: Date.now() });
    } else {
        const live = new Set(tabs.map(t => String(t.id)));
        await store.update(x => { for (const k of Object.keys(x.lastActive)) if (!live.has(k)) { delete x.lastActive[k]; delete x.meta[k]; } });
    }
}

export default definePlugin({
    name: "TabSleep",
    label: "plugin.tabSleep.label",
    description: "plugin.tabSleep.desc",
    authors: [Devs.ArcSidebar],
    tags: ["tabs"],
    featureTags: ["tabSleep.tag.auto", "tabSleep.tag.now", "tabSleep.tag.keepAwake"],
    enabledByDefault: false, // 多出项（Arc 无面向用户的设置，sidebar-features.md:551–553）：默认关（audit-arc-diff-52193 多出项 #1）
    settings,
    commands: [{ id: "tabSleep.now", label: "tabSleep.cmdRun", context: "background", run: (a?: unknown) => sweep((a as { now?: number } | undefined)?.now) }],
    background: {
        async start() {
            await safe(reconcile(), "tabSleep reconcile");
            await chrome.alarms.create(ALARM, { periodInMinutes: 5 });
            return [
                () => void safe(chrome.alarms.clear(ALARM), "alarms.clear"),
                listen("alarms.onAlarm", a => { if (a.name === ALARM) void sweep(); }),
                listen("tabs.onActivated", ({ tabId }) => void touch(tabId)),
                listen("tabs.onRemoved", id => void store.update(x => { delete x.lastActive[id]; delete x.meta[id]; })),
                // 核心 tabReplaced 事件：discardKeep 与浏览器自身的 tabs.onReplaced（spaceManager 转发）都会发出
                subscribe("tabReplaced", ({ from: removed, to: added }) => void store.update(x => { if (x.lastActive[removed] != null) x.lastActive[added] = x.lastActive[removed]; if (x.meta[removed]) x.meta[added] = x.meta[removed]; delete x.lastActive[removed]; delete x.meta[removed]; })),
            ];
        },
    },
});

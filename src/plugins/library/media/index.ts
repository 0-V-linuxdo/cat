/*
 * Media（§15）：侧边栏底部的媒体托盘，列出所有正在发声 / 已静音的标签；
 * 播放 / 暂停、静音、跳回标签、画中画。（自动画中画由 Chrome 自带的“自动画中画”提供。）
 */
import { safe } from "@api/ErrorLog";
import { safeExpected } from "./expectedErrors"; // 受限页面（chrome:// 等）executeScript 失败属正常，静默；其它错误照常记录
import { tr } from "@api/i18n";
import { h } from "@api/dom";
import { icon } from "@api/icons";
import "@components/ArcTooltip"; // data-tip 自动挂 ArcTooltip
import { addSection, refresh } from "@api/Slots";
import { parkClosed } from "@api/ParkLife";
import { debounce } from "@utils/misc";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { definePluginSettings } from "@api/Settings";
import type { MenuItemDef } from "@api/ContextMenus";
import { getTab } from "@plugins/_core/tabState";
import "./i18n";
import { muteItemOf, muteMenuState, muteTabs } from "./muteMenu";
import { MEET_RE, removalMatters, updateMatters } from "./parkFilter";

export { muteTabs } from "./muteMenu";
import { camIcon, MEDIA_MARQUEE_DEFAULT, mediaFavSrc, mediaMarqueeAttr, micIcon, playIcon, volumeIcon } from "./state";
import { favBox } from "../libraryView";

/** 媒体行图标框：同 Archive（archive-page.md §9）——有 favicon：.arc-lib-favbox 内放 img（无底色）；
 * 没有 / 加载失败：.arc-lib-favbox.no-fav（圆角 8、primary 5%、无字形；样式在 library/style.ts） */
export function mediaFav(t: { favIconUrl?: string; url?: string }): HTMLElement {
    const src = mediaFavSrc(t.favIconUrl);
    if (!src) return favBox(t.url ?? "");
    const box = h("span", { class: "arc-lib-favbox", "data-test": "lib-favbox" });
    box.append(h("img", { class: "arc-fav", src, alt: "", onerror: (e: Event) => { (e.currentTarget as HTMLElement).remove(); box.classList.add("no-fav"); } }));
    return box;
}

/** M-01：标题滚动开关（Arc mini-player-marquee-title-enabled，默认关）；挂在 Library 插件的 Media 功能下（featureSettings 约定，同 liveCalendar） */
const settings = definePluginSettings({
    mediaMarqueeTitle: { type: OptionType.BOOLEAN, default: MEDIA_MARQUEE_DEFAULT, description: "media.marqueeTitle" },
});
/** 标题节点：外层 .arc-media-title，内层 span；开 / 关样式由 data-marquee 在 library/style.ts 决定 */
function mediaTitle(text: string | undefined, attrs: Record<string, unknown>): HTMLElement {
    return h("span", { class: "arc-media-title", "data-marquee": mediaMarqueeAttr(!!settings.store.mediaMarqueeTitle), ...attrs }, h("span", null, text));
}

/** 右键菜单 “Mute”（urlbar-menus-followup.md L326–415 第 8 项；规则见 L467–572 与 ./muteMenu.ts）：标签 / 固定 / 收藏菜单同一项，多选菜单（multiSelect）用同一套规则。
 *  标题 “Mute”；选中项全部已静音时由验证器改成 “Unmute”（可点）；否则只有至少一个在发声才可点，未打开 / 没在发声则置灰。点击：任一已打开且未静音 → 全部静音，否则全部取消静音（muteTabs）。 */
export const muteMenuItem: MenuItemDef = {
    id: "mute", order: 40,
    label: t => (muteMenuState([muteItemOf(getTab(t.tabId))]).unmute ? "media.unmute" : "media.mute"),
    disabled: t => muteMenuState([muteItemOf(getTab(t.tabId))]).disabled,
    run: t => muteTabs([t.tabId]),
};

let media: chrome.tabs.Tab[] = [];
/** 打开的 Google Meet 通话（托盘里显示麦克风 / 摄像头 / 离开） */
let meets: chrome.tabs.Tab[] = [];
/** 托盘上点 X 隐藏的标签：直到它再次开始发声 */
const dismissed = new Set<number>();
/** 页面真实状态（每次 reload 读取）：媒体是否全部暂停；Meet 麦克风 / 摄像头是否关闭（按 data-is-muted） */
const paused = new Map<number, boolean>();
type Toggle = { can: boolean; on: boolean }; // can = 页面找到对应按钮（≈ canToggle），on = 未静音 / 摄像头开
const meetState = new Map<number, { mic: Toggle; cam: Toggle }>();
const probePaused = (tabId: number) => safeExpected(chrome.scripting.executeScript({ target: { tabId, allFrames: true },
    func: () => { const ms = Array.from(document.querySelectorAll<HTMLMediaElement>("video,audio")); return ms.length ? ms.every(m => m.paused) : null; } })
    .then(r => { const v = r.map(x => x.result).filter((x): x is boolean => typeof x === "boolean"); if (v.length) paused.set(tabId, v.every(Boolean)); }), "scripting.executeScript(probePaused)", "script");
const probeMeet = (tabId: number) => safeExpected(chrome.scripting.executeScript({ target: { tabId },
    func: () => {
        const btns = Array.from(document.querySelectorAll<HTMLElement>("button[data-is-muted], [role=button][data-is-muted]"));
        const st = (re: RegExp) => { const b = btns.find(x => re.test(x.getAttribute("aria-label") ?? "")); return { can: !!b, on: b?.getAttribute("data-is-muted") === "false" }; };
        return { mic: st(/microphone|mic|麦克风/i), cam: st(/camera|摄像头/i) };
    } }).then(r => { const v = r[0]?.result; if (v) meetState.set(tabId, v); }), "scripting.executeScript(probeMeet)", "script");
/** 补丁 inpage-parked-timers-stop：上一次实际下发给 refresh() 的内容签名（保守：整个 tab 对象 + 探测结果 + dismissed 都进签名，只会多刷、不会漏刷）。
 *  18b：停放期间的重读（onlyIfChanged = parkClosed()）签名没变就不 refresh（不白白记「整屏要重绘」脏位，切回少一次整屏渲染）；未停放仍每次 refresh */
let shownSig = "";
const sigOf = () => JSON.stringify([media, meets, [...paused], [...meetState], [...dismissed]]);
async function reload(onlyIfChanged = false) {
    const tabs = await chrome.tabs.query({});
    meets = tabs.filter(t => MEET_RE.test(t.url ?? ""));
    media = tabs.filter(t => t.audible && !t.mutedInfo?.muted && !dismissed.has(t.id!)); // 同 Arc：静音后从托盘消失（侧边栏行内的音频图标可取消静音）
    await Promise.all([...media.map(t => probePaused(t.id!)), ...meets.map(t => probeMeet(t.id!))]);
    const sig = sigOf(), same = sig === shownSig; shownSig = sig;
    if (!(onlyIfChanged && same)) refresh();
}
/** 补丁 inpage-parked-timers-stop-b：托盘里（媒体行 + Meet 行）的标签 id；停放时的事件过滤用 */
const trackedIds = (): ReadonlySet<number> => new Set([...media, ...meets].map(t => t.id!));
const schedule = debounce(() => void reload(parkClosed()), 100);
const later = () => { setTimeout(schedule, 300); }; // 页面切换状态需要时间（300ms 为实现取值，非 Arc 值）
const onUpdated = (id: number, c: chrome.tabs.OnUpdatedInfo) => {
    if (c.audible === false) dismissed.delete(id);
    if (updateMatters(id, c, trackedIds(), parkClosed())) schedule(); // 补丁 inpage-parked-timers-stop-b：停放时只对会改变托盘内容的事件重读（见 parkFilter.ts）
};
const onRemoved = (id: number) => { if (removalMatters(id, trackedIds(), parkClosed())) schedule(); };

const exec = (tabId: number, func: () => void) => safeExpected(chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func }), "scripting.executeScript", "script");
const playPause = (tabId: number) => exec(tabId, () => {
    for (const m of Array.from(document.querySelectorAll<HTMLMediaElement>("video,audio"))) {
        if (!m.paused) m.pause(); else if (m.currentTime > 0) void m.play();
    }
});
/** 下一首：优先点页面的“下一首”按钮（YouTube / Spotify 等常见选择器），否则跳到当前媒体末尾 */
const next = (tabId: number) => exec(tabId, () => {
    const btn = document.querySelector<HTMLElement>(".ytp-next-button, [data-testid=control-button-skip-forward], [aria-label*='Next' i][role=button], button[aria-label*='next' i]");
    if (btn) { btn.click(); return; }
    for (const m of Array.from(document.querySelectorAll<HTMLMediaElement>("video,audio"))) if (!m.paused && Number.isFinite(m.duration)) m.currentTime = m.duration - 0.05;
});
/** Meet 控制：点页面里的麦克风 / 摄像头 / 离开按钮（按 data-is-muted 与多语言 aria-label 查找） */
const meet = (tabId: number, what: "mic" | "cam") => safeExpected(chrome.scripting.executeScript({
    target: { tabId }, args: [what],
    func: (w: string) => {
        const btns = Array.from(document.querySelectorAll<HTMLElement>("button, [role=button]"));
        const re = w === "mic" ? /microphone|mic|麦克风/i : /camera|摄像头/i;
        const b = btns.find(x => re.test(x.getAttribute("aria-label") ?? "") && x.hasAttribute("data-is-muted"));
        b?.click();
    },
}), "scripting.executeScript(meet)", "script");
const pip = (tabId: number) => exec(tabId, () => {
    const v = Array.from(document.querySelectorAll("video")).toSorted((a, b) => b.clientWidth - a.clientWidth)[0];
    // 注入到页面里执行（executeScript 序列化 func，不能引用 safe）：保留空 catch——页面拒绝画中画属正常情况
    if (v) void v.requestPictureInPicture().catch(() => { });
});

export default definePlugin({
    name: "Media",
    authors: [Devs.ArcSidebar],
    label: "plugin.media.label",
    description: "plugin.media.desc",
    tags: ["library"],
    enabledByDefault: true,
    settings,
    onSettingsChange: () => refresh(),
    contextMenuItems: {
        // 同一项注册到标签 / 固定 / 收藏菜单（P-04，Rea：收藏与固定同一构造）；版式槽位 mute [2, 21] 见 ContextMenus.ts MENU_LAYOUT
        tab: [muteMenuItem],
        pinned: [muteMenuItem],
        favorite: [muteMenuItem],
    },
    panel: {
        async start() {
            // 补丁 inpage-parked-timers-stop-b：监听停放时也保持挂着（18 摘掉它们 → 停放期间才出现的行要等切回后的异步重读，r56e 实测前 4 帧为空）；停放时的成本由 parkFilter 过滤 + 签名未变不 refresh 控制
            chrome.tabs.onUpdated.addListener(onUpdated);
            chrome.tabs.onRemoved.addListener(onRemoved);
            await reload();
            return [
                () => { chrome.tabs.onUpdated.removeListener(onUpdated); chrome.tabs.onRemoved.removeListener(onRemoved); },
                addSection("footer", "Media", {
                    render(el) {
                        if (meets.length) el.append(h("div", { class: "arc-media" }, meets.map(t => h("div", { class: "arc-media-row", "data-test": "meet-row" },
                            mediaFav(t),
                            mediaTitle(t.title, { onclick: () => void safe(chrome.tabs.update(t.id!, { active: true }).then(() => chrome.windows.update(t.windowId, { focused: true })), "tabs.update") }),
                            h("button", { class: "arc-icon-btn", "data-tip": tr("media.meetMic"), onclick: () => void meet(t.id!, "mic").then(later) }, icon(micIcon(!!meetState.get(t.id!)?.mic.can, !!meetState.get(t.id!)?.mic.on), 14)), // SF mic(.slash).fill 14pt Medium（FUN_102492888 L345–352）
                            h("button", { class: "arc-icon-btn", "data-tip": tr("media.meetCam"), onclick: () => void meet(t.id!, "cam").then(later) }, icon(camIcon(!!meetState.get(t.id!)?.cam.can, !!meetState.get(t.id!)?.cam.on), 14)))))); // Arc 无「离开会议」按钮（Cat 决定移除）。SF video(.slash).fill 14pt Medium（L426–431）
                        if (!media.length) return;
                        el.append(h("div", { class: "arc-media" }, media.map(t => h("div", { class: "arc-media-row" },
                            mediaFav(t),
                            mediaTitle(t.title, { "data-tip": t.title, onclick: () => void safe(chrome.tabs.update(t.id!, { active: true }).then(() => chrome.windows.update(t.windowId, { focused: true })), "tabs.update") }),
                            h("button", { class: "arc-icon-btn", "data-tip": tr("media.play"), onclick: () => void playPause(t.id!).then(later) }, icon(playIcon(!!paused.get(t.id!)), 14)), // SF play.fill（state==2，候选 MediaSessionStatus.suspended ⛔）/ pause.fill 14pt Medium（L549–556）
                            h("button", { class: "arc-icon-btn", "data-tip": tr("media.next"), onclick: () => void next(t.id!) }, icon("skip", 14)), // SF forward.end.fill 14pt Medium
                            h("button", { class: "arc-icon-btn", "data-tip": tr("media.pip"), onclick: () => void pip(t.id!) }, icon("pip", 12)), // SF pip 12pt（arc-icons/sf/MAPPING.md）
                            h("button", { class: "arc-icon-btn", "data-tip": tr("media.muted"), onclick: () => void safe(chrome.tabs.update(t.id!, { muted: !t.mutedInfo?.muted }), "tabs.update") }, icon(volumeIcon(!!t.mutedInfo?.muted), 12)), // 档位拿不到，只分静音/wave.3（标签页无音量值，见 state.ts volumeIcon）；12pt Medium，外框 24×24（style.ts）
                            h("button", { class: "arc-icon-btn", "data-tip": tr("common.close"), onclick: () => { dismissed.add(t.id!); void reload(); } }, icon("xmark", 14) /* SF xmark 14pt Medium “Close Mini Player” */)))));
                    },
                }),
            ];
        },
    },
});

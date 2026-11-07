/* 页内 / 原生侧栏形态跟着标签自动切——「原生 → 页内」的纯逻辑（补丁 switch-auto；无 chrome / DOM 依赖，单测见 tests/inpageSwitchAuto.test.ts）。
 * 反方向（页内 → 受限页）= 既有 ensure-native（手势里同步 open，logic.decideEnsure），不在这里。
 * 本文件只回答一个问题：「用户刚点了 / 刚到了标签 T，原生侧栏要不要关掉、把页内侧栏恢复出来？」——关原生不需要手势，所以可以在 SW 里异步判、异步做。
 * 约束：不 import chrome.* / 不出现控制台调用。 */
import type { PageKind } from "@api/HostMode";

import type { Mode } from "./constants";

export interface SwitchFacts {
    /** 总开关（constants.AUTO_SWITCH.viaSidebar / onArrive 里对应的那个） */
    enabled: boolean;
    /** true = 到达路径（浏览器 UI / 导航）：只有「原生是我们为进受限页而开的」（restoreOnClose 标记）才切，用户自己开的原生不动；false = 侧栏行点击：用户明确在侧栏里选了标签，不看标记 */
    requireMarked: boolean;
    restoreMarked: boolean;
    /** 此刻窗口里原生是否真在显示（showingNative） */
    nativeOpen: boolean;
    defaultMode: Mode;
    targetKind: PageKind;
    targetHostAlive: boolean;
    targetBlocked: boolean;
}
export type SwitchWhy = "disabled" | "default-native" | "not-native" | "not-marked" | "restricted" | "blocked";
export type SwitchDecision = { act: "to-inpage" } | { act: "wait-host" } | { act: "keep"; why: SwitchWhy };

/** 顺序有意义：先排除「不该动」的，再看目的标签能不能页内显示；能力不明（宿主没握手）= 等一等，而不是切（切了页内又出不来 = 一个侧栏都没有） */
export function decideSidebarSwitch(f: SwitchFacts): SwitchDecision {
    if (!f.enabled) return { act: "keep", why: "disabled" };
    if (f.defaultMode === "native") return { act: "keep", why: "default-native" };
    if (!f.nativeOpen) return { act: "keep", why: "not-native" };
    if (f.requireMarked && !f.restoreMarked) return { act: "keep", why: "not-marked" };
    if (f.targetKind !== "ok") return { act: "keep", why: "restricted" };
    if (f.targetBlocked) return { act: "keep", why: "blocked" };
    if (!f.targetHostAlive) return { act: "wait-host" };
    return { act: "to-inpage" };
}

/** 等宿主握手的登记：tabId → 截止时间 / 路径。到期 / 已握手 = 摘掉 */
export interface HostWait { windowId: number; until: number; requireMarked: boolean }
export const hostWaitValid = (w: HostWait | undefined, now: number): w is HostWait => !!w && now <= w.until;

/** 补丁 t903u-tab-switch：窗口级预热的 open 落定时，要不要补一次「到达」判定。
 *  同一个真实手势（页内侧栏里点收藏 / 标签行）既发了预热 open 又切走了标签：onActivated 先于面板端口到达，那时原生还没「在显示」→ 到达判定 keep/not-native，
 *  之后就再没人判，目的标签停在原生。只在：有发起标签记录 · open 已落定（不再 pending）· 原生真在显示 · 窗口带到达标记（restoreOnClose，本生命打的）· 活动标签换了 时补判。
 *  没换标签（在页面里点一下 = 设计内的「首次手势开原生」）不补判，原生照常留着。 */
export interface ArrivalRecheck { origin: number | undefined; active: number | undefined; open: boolean; pending: boolean; marked: boolean }
export const arrivedDuringOpen = (i: ArrivalRecheck): boolean => i.origin != null && !i.pending && i.open && i.marked && i.active != null && i.active !== i.origin;

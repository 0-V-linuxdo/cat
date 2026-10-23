/*
 * 侧边栏布局插槽：核心只提供一个空的纵向容器，所有可见内容都由插件注册到插槽中。
 * （对应 Void++ 在宿主页面上的各种挂载点；这里宿主就是我们自己的 side panel。）
 */
import { dispatch } from "@api/Events";
import type { Cleanup } from "@utils/types";
import { createRegistry, type Registry } from "@api/registry";

export type SlotName = "top" | "favorites" | "header" | "pinned" | "today" | "footer" | "bottom";
export const SLOT_ORDER: SlotName[] = ["top", "favorites", "header", "pinned", "today", "footer", "bottom"];

export interface SectionDef {
    order?: number;
    /** 渲染到容器；返回的函数在下次重绘/停用前调用 */
    render(container: HTMLElement): void | (() => void);
}

const slots = new Map<SlotName, Registry<SectionDef & { plugin: string }>>();
export function slot(name: SlotName) {
    let r = slots.get(name);
    if (!r) { r = createRegistry(); slots.set(name, r); }
    return r;
}

export function addSection(name: SlotName, plugin: string, def: SectionDef): () => void {
    const id = `${plugin}:${name}:${slot(name).size}`;
    slot(name).set(id, { ...def, plugin });
    return () => { slot(name).delete(id); };
}

/* 浮层（命令栏、Library、设置）也是插件注册的 */
export interface OverlayDef {
    title: string;
    render(container: HTMLElement, arg: unknown, close: () => void): Cleanup;
    order?: number;
    /** 整页视图（如 Library）：替换侧边栏内容，点外面 / 失焦不关闭，只由返回按钮或 Esc 关闭 */
    page?: boolean;
}
export const overlays = createRegistry<OverlayDef & { plugin: string }>();
export function addOverlay(id: string, plugin: string, def: OverlayDef) {
    overlays.set(id, { ...def, plugin });
    return () => { overlays.delete(id); };
}
export const openOverlay = (id: string, arg?: unknown) => dispatch("openOverlay", { id, arg });
export const refresh = () => dispatch("refresh");

/* —— 插件扩展点（/workspace/cat-plugins/core-api-proposal.md）—— */
import type { IconName } from "@api/icons";

export interface LibrarySectionDef { id: string; label: string; icon: IconName; order?: number; render(box: HTMLElement): void | (() => void) }
export const librarySections = createRegistry<LibrarySectionDef & { plugin: string }>();
/** 资料库侧栏分类：按 order 并入内置分类（media 10 / downloads 20 / spaces 30 / archive 40）；清理时删除并重绘 */
export function addLibrarySection(plugin: string, def: LibrarySectionDef): () => void {
    librarySections.set(def.id, { ...def, plugin }); refresh();
    return () => { librarySections.delete(def.id); refresh(); };
}

export interface PlusMenuItemDef { id: string; label: string; icon: IconName; order?: number; enabled?(): boolean | Promise<boolean>; run(): unknown }
export const plusMenuItems = createRegistry<PlusMenuItemDef & { plugin: string }>();
/** “+”菜单项：id 与内置项相同则替换（位置不变）；否则按 order 插入（内置 space 10 / folder 20 / easel 30 / split 50 / tab 60，默认 35） */
export function addPlusMenuItem(plugin: string, def: PlusMenuItemDef): () => void {
    plusMenuItems.set(def.id, { ...def, plugin });
    return () => { plusMenuItems.delete(def.id); };
}

export interface SiteControlSectionDef { id: string; order?: number; render(box: HTMLElement, tab: chrome.tabs.Tab, close: () => void): void | (() => void) }
export const siteControlSections = createRegistry<SiteControlSectionDef & { plugin: string }>();
/** 站点控制中心分区：在顶部操作区与扩展区之间按 order 渲染；面板关闭时调用 render 返回的函数 */
export function addSiteControlSection(plugin: string, def: SiteControlSectionDef): () => void {
    siteControlSections.set(def.id, { ...def, plugin });
    return () => { siteControlSections.delete(def.id); };
}

export interface UrlbarIndicatorDef { id: string; state(tab: chrome.tabs.Tab): { icon: IconName; color?: string; title?: string } | null; onClick?(tab: chrome.tabs.Tab): unknown }
export const urlbarIndicators = createRegistry<UrlbarIndicatorDef & { plugin: string; order?: number }>();
/** 地址栏指示：渲染地址栏时对当前标签调用 state，非 null 就在 urlbar-actions 里画图标 */
export function addUrlbarIndicator(plugin: string, def: UrlbarIndicatorDef): () => void {
    urlbarIndicators.set(def.id, { ...def, plugin }); refresh();
    return () => { urlbarIndicators.delete(def.id); refresh(); };
}

/* ---------- Today 区标题行按钮（core-api-proposal §8；样式：arc-analysis/clear-button.md「Tidy」） ----------
 * 行布局：分隔线 → 插件按钮（按 order）→ Clear。按钮渲染为 12pt 图标 + 0.5pt 竖线 + 文字，按下转到 −25° 后 0.4s 弹回。 */
/** 传给 visible / enabled 的上下文；Today 标签变化时侧边栏重绘并重新求值 */
export interface TodayHeaderCtx { todayCount: number }
export interface TodayHeaderButtonDef { id: string; label: string; icon?: IconName; title?: string; order?: number; visible?(ctx: TodayHeaderCtx): boolean; enabled?(ctx: TodayHeaderCtx): boolean; run(): unknown }
export const todayHeaderButtons = createRegistry<TodayHeaderButtonDef & { plugin: string }>();
export function addTodayHeaderButton(plugin: string, def: TodayHeaderButtonDef): () => void {
    todayHeaderButtons.set(def.id, { ...def, plugin }); refresh();
    return () => { todayHeaderButtons.delete(def.id); refresh(); };
}
/** 按上下文求出要画的按钮（按 order）；visible 返回 false 的不画，enabled 返回 false 的画成禁用；回调抛错 = 不显示 */
export function todayHeaderState(ctx: TodayHeaderCtx): { id: string; def: TodayHeaderButtonDef; enabled: boolean }[] {
    const out: { id: string; def: TodayHeaderButtonDef; enabled: boolean }[] = [];
    for (const [id, d] of todayHeaderButtons.sorted()) {
        let vis = true, en = true;
        try { vis = d.visible?.(ctx) ?? true; en = d.enabled?.(ctx) ?? true; } catch (e) { console.warn("today header button failed", id, e); vis = false; }
        if (vis) out.push({ id, def: d, enabled: en });
    }
    return out;
}

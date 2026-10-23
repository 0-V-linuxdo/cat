/*
 * ArcTooltip：共享悬停提示（仿 Arc 模块 ArcTooltip，替代原生 title）。
 * 出处：/workspace/arc-analysis/arc-tooltip.md（Rea 第 2 轮，默认配色 FUN_100de71d8；ghidra/rTT/）。
 * 已确认：
 *   - 样式开关 param_4（FUN_100ddb078）：0 = 两层黑阴影（r2.5 off0 op.18；r10 off(0,2.5) op.15）；1 = 圆角 8 + 棕阴影 r31 off(0,16) op.15。
 *   - 配色（FUN_100de71d8）：深 不透明底 #2B2B2B、标题白、描边 white α.1 1px；键帽 前景 gray .28 / 底 gray .45 / 字白。
 *                            浅 底白、标题黑、variant 0 无描边；键帽 前景 gray .9 / 底 gray .66 / 字黑。
 *   - 字体：标题 12pt；副标题 11pt 400；快捷键 10pt bold；标题与快捷键间距 6；键帽圆角 4、EdgeInsets all 2。
 *   - 圆角：靠锚点的角 3，其余 14（DAT_1036d3790 = 3,14,14,3）；默认锚点 bottomLeading → 提示在宿主下方左对齐，左上角 3。
 *   - 延迟：显示延迟由调用方给（迷你播放器 0.45s）；距上次关闭 <0.6s 则 0.01s 后显示。淡入 opacity easeOut 0.05s；淡出 easeOut 0.3s（默认路径）。
 *   - 0.12s 是键帽按下动画，不属于气泡（已从气泡移除）。
 * ⛔：
 *   - 标题字重 ≈600（NSFontManager weight 7，精确值 ⛔）；副标题颜色 ⛔（暂用标题色 α.66）；
 *   - EdgeInsets (10,0,10,0) 轴向 ⛔ → 取水平 10；垂直无内边距，内容 >28 高时额外 -7 垂直（按 Rea 原文，含义 ⛔ → 仅作为常量导出，CSS 用 min-height 28）；
 *   - 渐变 top→bottom clear→black α.1（FUN_100de6898）不属气泡（§A：纯色填充），已移除；
 *   - 其他淡出路径 0.3+0.25 / 0.1 ⛔（未用）；锚点偏移量 ⛔ → 4px；variant 1 的浅色描边 black α.1（推测 ⛔）。
 */
import { h } from "@api/dom";

export type TooltipVariant = 0 | 1;
/** 默认显示延迟（s）：迷你播放器传 0.45（FUN_100ddb078 参数）；其他调用方可经 opts.delay 自定 */
export const TOOLTIP_DELAY_S = 0.45;
/** 距上次提示关闭不足 TOOLTIP_WARM_S 时，新提示 TOOLTIP_WARM_DELAY_S 后即显示（TooltipConstants 0.6 / 0.01） */
export const TOOLTIP_WARM_S = 0.6;
export const TOOLTIP_WARM_DELAY_S = 0.01;
export const TOOLTIP_FADE_IN_S = 0.05; // FUN_100dedd5c
export const TOOLTIP_FADE_OUT_S = 0.3; // 默认淡出路径；其他路径 0.3+0.25 / 0.1 ⛔
export const TOOLTIP_TITLE_PX = 12; // FUN_100ddc03c
export const TOOLTIP_TITLE_WEIGHT = 700; // weight 7（tooltip-row.md：标题 12pt weight 7 → 700；SidebarCellTooltipView body 未找到 ⛔，按 ArcTooltip 标准内容视图）
export const TOOLTIP_SUBTITLE_PX = 11;
export const TOOLTIP_KEY_PX = 10; // bold，FUN_100de69d4
export const TOOLTIP_KEY_PAD = 2; // 快捷键标签 EdgeInsets all 2（FUN_100de69d4 L84）——键帽自身 padding 见 TOOLTIP_KEYCAP_PAD
/* 快捷键键帽（tooltip-shortcut.md，TooltipKeyboardShortcutView）：
 *   每键一个键帽（ForEach），HStack 间距 3，无 "+" / 空格；顺序 ⌃ ⌥ ⇧ ⌘，主键最后、localizedUppercase；
 *   键帽 = 底座 RoundedRectangle(4) 填 keyBackground + clear→black .1 竖向渐变，内层面 RoundedRectangle(3) 填 keyForeground，
 *   面相对底座 inset 上 1 / 左 1 / 下 2.5 / 右 1；文字 10pt bold、keyTitle 色、左右 padding 2；frame(minWidth 19, minHeight 19)。
 *   按下态（下 inset 1，easeOut 0.12s）：提示框不接收按键 / 鼠标，无触发源，不实现 ⛔。 */
/** 面相对底座的 inset [上, 左, 下, 右]（FUN_100de64c4） */
export const TOOLTIP_KEYCAP_PAD = [1, 1, 2.5, 1] as const;
export const TOOLTIP_KEYCAP_GAP = 3; // FUN_100de6e44 HStack spacing 3
export const TOOLTIP_KEYCAP_MIN = 19; // FUN_100de5e0c frame(minWidth/minHeight 19)
export const TOOLTIP_KEYCAP_FACE_RADIUS = 3;
export const TOOLTIP_KEYCAP_TEXT_PAD_X = 2;
const MOD_ORDER = ["⌃", "⌥", "⇧", "⌘"] as const;
const MOD_WORDS: Record<string, (typeof MOD_ORDER)[number]> = {
    ctrl: "⌃", control: "⌃", "⌃": "⌃", alt: "⌥", option: "⌥", opt: "⌥", "⌥": "⌥",
    shift: "⇧", "⇧": "⇧", cmd: "⌘", command: "⌘", meta: "⌘", mod: "⌘", super: "⌘", "⌘": "⌘", // Mod → ⌘（上游 prettyCombo 已按平台解析；残留 Mod 按 Mac ⛔）
};
/** 主键映射（FUN_100986968）：空格 → ⎵，Tab / ⇥ → "tab"；其余特殊键 ⛔ 原样；字母大写 */
export function mapMainKey(k: string): string {
    if (k === " " || /^space$/i.test(k) || k === "⎵") return "⎵";
    if (k === "\t" || k === "⇥" || /^tab$/i.test(k)) return "tab";
    return k.toLocaleUpperCase();
}
/** 解析任意快捷键串（"⌥ 1"、"Alt+1"、"⌥⇧1"、"Ctrl+Shift+K"、"Ctrl++"）→ [修饰键（⌃⌥⇧⌘ 顺序、去重）..., 主键] */
export function splitShortcut(sc: string): string[] {
    let str = (sc ?? "").replace(/\s+$/, "");
    if (!str.trim()) return str === " " ? ["⎵"] : [];
    const mods = new Set<string>(); let main = "";
    // 结尾的 "+" 作为主键（"Ctrl++" / "⌘+"）
    if (/(^|[+\s⌃⌥⇧⌘])\+$/.test(str)) { main = "+"; str = str.slice(0, -1); }
    const toks: string[] = [];
    for (const part of str.split(/[+\s]+/).filter(Boolean)) {
        let p = part;
        while (p && "⌃⌥⇧⌘".includes(p[0]!)) { toks.push(p[0]!); p = p.slice(1); } // 符号连写：⌥⇧1
        if (p) toks.push(p);
    }
    for (const t of toks) { const m = MOD_WORDS[t.toLowerCase()]; if (m) mods.add(m); else main = t; }
    const out: string[] = MOD_ORDER.filter(m => mods.has(m));
    if (main) out.push(mapMainKey(main));
    return out;
}
export const TOOLTIP_KEY_RADIUS = 4;
export const TOOLTIP_GAP = 6; // 标题 ↔ 快捷键
export const TOOLTIP_PAD_X = 10; // EdgeInsets (10,0,10,0) 轴向 ⛔ → 水平
export const TOOLTIP_TALL = 28; // 内容 >28 高时额外 -7 垂直（⛔ 含义）
export const TOOLTIP_TALL_ADJ = -7;
/** 下一次显示延迟：距上次关闭 <0.6s → 0.01s，否则调用方延迟 */
export function nextDelay(base: number, sinceCloseS: number): number {
    return sinceCloseS < TOOLTIP_WARM_S ? TOOLTIP_WARM_DELAY_S : base;
}
/** Edge 枚举（arc-tooltip.md §E / 第三轮）：0 top 1 bottom 2 leading 3 trailing 4 topLeading 5 topTrailing 6 bottomLeading 7 bottomTrailing */
export type TipEdge = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
export const DEFAULT_EDGE: TipEdge = 6; // FUN_100de71d8 L113–115
/** 四角半径 [左上, 右上, 右下, 左下]（FUN_100ddafa0 §F）：角方向时靠锚点的角 3，其余 14；边方向（0–3）源码按掩码取 14/0 ⛔ → 统一 14；variant 1 统一 8。
 * 按**首选**方向在构造时算出，回退换方向后不重算（跟随源码；⛔ 未证实）。输出顺序（顺时针）⛔ 推测。 */
export function tooltipCorners(v: TooltipVariant, edge: TipEdge = DEFAULT_EDGE): [number, number, number, number] {
    if (v === 1) return [8, 8, 8, 8];
    const r: [number, number, number, number] = [14, 14, 14, 14];
    const near: Partial<Record<TipEdge, number>> = { 4: 2, 5: 3, 6: 1, 7: 0 };
    const i = near[edge]; if (i != null) r[i] = 3;
    return r;
}
/** 各样式的圆角（远角）与阴影（FUN_100ddb078 / FUN_100ddafa0） */
export function tooltipVariant(v: TooltipVariant): { radius: number; shadow: string } {
    return v === 1
        ? { radius: 8, shadow: "0 16px 31px rgb(113 84 42/.15)" } // sRGB(.443,.329,.165)×255 ≈ (113,84,42)
        : { radius: 14, shadow: "0 0 2.5px rgb(0 0 0/.18), 0 2.5px 10px rgb(0 0 0/.15)" };
}
/** 描边：深色始终 white α.1；浅色 variant 0 无，variant 1 black α.1（⛔ 推测） */
export const tooltipStroke = (v: TooltipVariant, dark: boolean): string | null => (dark ? "rgb(255 255 255/.1)" : v === 1 ? "rgb(0 0 0/.1)" : null);
/** 默认配色（FUN_100de71d8）。gray x = rgb(x·255)。 */
export const TOOLTIP_PALETTE = {
    light: { bg: "#fff", title: "#000", keyFg: "rgb(230 230 230)", keyBg: "rgb(168 168 168)", keyText: "#000" }, // 键帽面 gray .9 ≈ #E6E6E6 / 底座 .66 ≈ #A8A8A8（tooltip-shortcut.md §4）
    dark: { bg: "#2B2B2B", title: "#fff", keyFg: "rgb(71 71 71)", keyBg: "rgb(115 115 115)", keyText: "#fff" }, // 键帽面 gray .28 ≈ #474747 / 底座 .45 ≈ #737373
} as const;
/** 定位（FUN_100deef1c，arc-tooltip.md 第三轮）：
 *   可用区 = 视口四边内缩 8（源码为 屏幕 ∩ 父窗口 再内缩 8；屏幕取 frame 还是 visibleFrame ⛔）；
 *   top/bottom 间距 4、水平居中并夹紧到可用区；leading/trailing 间距 4、垂直居中、不夹紧；四角方向与锚点重叠 6、不夹紧；
 *   候选 = [首选] + [0..7] 去重；首选放得下立即用，否则取第一个放得下的；都放不下 → 不显示（null）。
 *   源码另有按溢出量打分择优（max|溢出| + 3×某项 ⛔），只在无完全放得下时起作用，此处按「不显示」处理。
 *   跟随光标见 placeAtCursor（opts.anchor = "cursor"）。坐标系是否 flipped ⛔ → 上 / 下按枚举名。 */
/* ── 跟随光标（anchor 8 = cursor，tooltip-row.md「位置」，FUN_100deef1c L339–445）：
 *   x = 鼠标 x，y = 鼠标 y − 12（pinned-hover.md：源码 y − 12；Cat 定案 = 提示放在光标**上方**，底边在光标上 12）。坐标系 flipped ⛔ 未确认，故「上方」是 Cat 的取向，不是源码证据。
 *   可用区 = 视口四边内缩 8（源码：屏幕 ∩ 窗口 再内缩 8）。窄面板翻转 ⛔（Rea 未给）→ 安全做法：永不越出视口；上方放不下 → 翻到光标下方（光标下 12）；右侧不够 → 向左（右边贴光标）。
 *   源码回退依次试 0–7 号方向，cursor 锚点下这 8 个方向的具体帧 ⛔ 未给出 → 以水平 / 垂直翻转近似，最后夹紧到可用区。
 *   圆角：靠光标的角 3，其余 14（FUN_100ddafa0：anchor 7/8 → [3,14,14,14]）；翻转后靠光标的角随之改变（源码是否随回退重算 ⛔）。 */
export const TOOLTIP_CURSOR_OFFSET = 12;
/** 标签 / Easel 行 maxWidth 500（tooltip-row.md）；文件夹不限 */
export const TOOLTIP_ROW_MAX_WIDTH = 500;
/** 侧栏行统一显示延迟 1.5s（0x3ff8000000000000） */
export const TOOLTIP_ROW_DELAY_S = 1.5;
/** flipX = 向左翻（右边贴光标）；flipY = 提示在光标**上方**（默认，Cat 定案；false = 上方放不下才回落到光标下方） */
export interface CursorPlace { left: number; top: number; flipX: boolean; flipY: boolean }
export function placeAtCursor(mx: number, my: number, w: number, h: number, viewport: { width: number; height: number }): CursorPlace {
    const i = TOOLTIP_AREA_INSET, o = TOOLTIP_CURSOR_OFFSET;
    const area = { left: i, top: i, right: viewport.width - i, bottom: viewport.height - i };
    w = Math.min(w, Math.max(0, area.right - area.left));
    let left = mx, top = my - o - h, flipX = false, flipY = true;
    if (top < area.top && my + o + h <= area.bottom) { top = my + o; flipY = false; } // 上方没有位置 → 翻到下方（只在下方放得下时；两边都放不下仍留上方并夹紧）
    if (left + w > area.right && mx - w >= area.left) { left = mx - w; flipX = true; }
    left = Math.min(Math.max(area.left, left), area.right - w);
    top = Math.min(Math.max(area.top, top), Math.max(area.top, area.bottom - h));
    return { left, top, flipX, flipY };
}
/** cursor 锚点圆角 [左上, 右上, 右下, 左下]：靠光标的角 3，其余 14 */
export function cursorCorners(flipX: boolean, flipY: boolean): [number, number, number, number] {
    const r: [number, number, number, number] = [14, 14, 14, 14];
    r[flipY ? (flipX ? 2 : 3) : (flipX ? 1 : 0)] = 3;
    return r;
}
export interface TipRect { left: number; top: number; right: number; bottom: number }
export interface TipPlace { left: number; top: number; edge: TipEdge }
export const TOOLTIP_AREA_INSET = 8, TOOLTIP_EDGE_GAP = 4, TOOLTIP_CORNER_OVERLAP = 6;
export function edgeFrame(edge: TipEdge, a: TipRect, w: number, h: number, area: TipRect): { left: number; top: number } {
    const g = TOOLTIP_EDGE_GAP, o = TOOLTIP_CORNER_OVERLAP, midX = (a.left + a.right) / 2, midY = (a.top + a.bottom) / 2;
    const clampX = (x: number) => Math.min(Math.max(area.left, x), area.right - w);
    switch (edge) {
        case 0: return { left: clampX(midX - w / 2), top: a.top - h - g };
        case 1: return { left: clampX(midX - w / 2), top: a.bottom + g };
        case 2: return { left: a.left - w - g, top: midY - h / 2 };
        case 3: return { left: a.right + g, top: midY - h / 2 };
        case 4: return { left: a.left - w + o, top: a.top - h + o };
        case 5: return { left: a.right - o, top: a.top - h + o };
        case 6: return { left: a.left - w + o, top: a.bottom - o };
        default: return { left: a.right - o, top: a.bottom - o };
    }
}
export function placeTooltip(anchor: TipRect, w: number, h: number, viewport: { width: number; height: number }, preferred: TipEdge = DEFAULT_EDGE): TipPlace | null {
    const i = TOOLTIP_AREA_INSET, area = { left: i, top: i, right: viewport.width - i, bottom: viewport.height - i };
    // 宽度溢出不再丢弃：Arc 有 ArcTooltipConfiguration.maxWidth 字段，但默认值 / 截断规则未找到 ⛔ →
    // 回退：最大宽度 = 可用区宽（视口左右各内缩 8），超出部分标题省略号（CSS max-width + text-overflow），这里按截断后的宽度定位
    w = Math.min(w, Math.max(0, area.right - area.left));
    const fits = (p: { left: number; top: number }) => p.left >= area.left && p.top >= area.top && p.left + w <= area.right && p.top + h <= area.bottom;
    for (const e of [preferred, 0, 1, 2, 3, 4, 5, 6, 7].filter((x, k, arr) => arr.indexOf(x) === k) as TipEdge[]) {
        const p = edgeFrame(e, anchor, w, h, area);
        if (fits(p)) return { ...p, edge: e };
    }
    return null;
}

/* 深浅判定：Space 实际色调 data-bb-dark（ToneProbe）> data-theme > 系统 prefers-color-scheme（后写优先）。
 * shadow root / 网页里 :root 选不到 → 仅系统深浅，值相同。 */
const P = TOOLTIP_PALETTE, DARK_STROKE = tooltipStroke(0, true)!;
const LIGHT_VARS = `--tt-bg: ${P.light.bg}; --tt-fg: ${P.light.title}; --tt-kfg: ${P.light.keyFg}; --tt-kbg: ${P.light.keyBg}; --tt-ktext: ${P.light.keyText}; --tt-stroke0: transparent; --tt-stroke1: ${tooltipStroke(1, false)};`;
const DARK_VARS = `--tt-bg: ${P.dark.bg}; --tt-fg: ${P.dark.title}; --tt-kfg: ${P.dark.keyFg}; --tt-kbg: ${P.dark.keyBg}; --tt-ktext: ${P.dark.keyText}; --tt-stroke0: ${DARK_STROKE}; --tt-stroke1: ${DARK_STROKE};`;
const [c0, c1, c2, c3] = tooltipCorners(0, DEFAULT_EDGE);
export const TOOLTIP_CSS = /* css */ `
.arc-tooltip { ${LIGHT_VARS}
  max-width: calc(100vw - ${2 * TOOLTIP_AREA_INSET}px); /* maxWidth 源码默认值 ⛔ → 可用区宽 */
  position: fixed; z-index: 2147483647; pointer-events: none; isolation: isolate; mix-blend-mode: normal; filter: none; backdrop-filter: none; opacity: 1; /* 不受祖先主题 / 滤镜影响；挂在 body（或 shadow root）下 */ white-space: nowrap; display: flex; align-items: center; gap: ${TOOLTIP_GAP}px;
  box-sizing: border-box; min-height: ${TOOLTIP_TALL}px; padding: 0 ${TOOLTIP_PAD_X}px; /* EdgeInsets 轴向 ⛔ */
  background: var(--tt-bg); /* 纯色填充（arc-tooltip.md §A：非 material）；FUN_100de6898 渐变不属气泡，已移除 */
  color: var(--tt-fg); font-size: ${TOOLTIP_TITLE_PX}px; font-weight: ${TOOLTIP_TITLE_WEIGHT}; /* 字重 ⛔ */
  animation: arc-tt-in ${TOOLTIP_FADE_IN_S}s ease-out both; }
.arc-tooltip.out { animation: arc-tt-out ${TOOLTIP_FADE_OUT_S}s ease-out both; }
@media (prefers-color-scheme: dark) { .arc-tooltip { ${DARK_VARS} } }
:root[data-theme="light"] .arc-tooltip { ${LIGHT_VARS} }
:root[data-theme="dark"] .arc-tooltip { ${DARK_VARS} }
:root[data-bb-dark="0"] .arc-tooltip { ${LIGHT_VARS} }
:root[data-bb-dark="1"] .arc-tooltip { ${DARK_VARS} }
.arc-tooltip[data-v="0"] { border-radius: ${c0}px ${c1}px ${c2}px ${c3}px; box-shadow: ${tooltipVariant(0).shadow}; border: 1px solid var(--tt-stroke0); }
.arc-tooltip[data-v="1"] { border-radius: ${tooltipVariant(1).radius}px; box-shadow: ${tooltipVariant(1).shadow}; border: 1px solid var(--tt-stroke1); }
.arc-tooltip > span:first-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; } /* 截断规则 ⛔ → 单行省略号；键帽 / 徽章不收缩 */
.arc-tt-keys, .arc-tt-badge { flex: none; }
.arc-tooltip small { display: block; overflow: hidden; text-overflow: ellipsis; /* 副标题独占一行（tooltip-row.md）；行距 / 对齐 / 上下内边距 ⛔（SidebarCellTooltipView body 未找到） */
  font-size: ${TOOLTIP_SUBTITLE_PX}px; font-weight: 400; color: color-mix(in srgb, var(--tt-fg) 66%, transparent); /* 副标题 11pt Regular，标题色 α.66（Rea 补充；α 部分 ⛔） */ }
.arc-tt-keys { display: inline-flex; align-items: center; gap: ${TOOLTIP_KEYCAP_GAP}px; }
/* 键帽底座：圆角 4、keyBackground + clear→black .1 竖向渐变；min 19×19；面 inset 1/1/2.5/1 */
.arc-tooltip kbd { display: inline-flex; box-sizing: border-box; min-width: ${TOOLTIP_KEYCAP_MIN}px; min-height: ${TOOLTIP_KEYCAP_MIN}px; border-radius: ${TOOLTIP_KEY_RADIUS}px;
  padding: ${TOOLTIP_KEYCAP_PAD[0]}px ${TOOLTIP_KEYCAP_PAD[3]}px ${TOOLTIP_KEYCAP_PAD[2]}px ${TOOLTIP_KEYCAP_PAD[1]}px;
  background: linear-gradient(rgb(0 0 0/0), rgb(0 0 0/.1)), var(--tt-kbg); font: inherit; }
/* 键帽面：圆角 3、keyForeground；文字 10pt bold、keyTitle、左右 padding 2 */
.arc-tooltip kbd > span { flex: 1; display: flex; align-items: center; justify-content: center; border-radius: ${TOOLTIP_KEYCAP_FACE_RADIUS}px; background: var(--tt-kfg);
  padding: 0 ${TOOLTIP_KEYCAP_TEXT_PAD_X}px; font-size: ${TOOLTIP_KEY_PX}px; font-weight: 700; line-height: 1; color: var(--tt-ktext); }
/* profileName 徽章（SidebarDockItemTooltipView）：key 颜色 + ForegroundPrimary α.8（FUN_100bd520c）；尺寸 / 圆角 / 内边距 ⛔ → 同键帽 */
.arc-tt-badge { font-size: ${TOOLTIP_KEY_PX}px; font-weight: 600; padding: 1px 4px; border-radius: ${TOOLTIP_KEY_RADIUS}px; background: var(--tt-kfg); color: color-mix(in srgb, var(--tt-fg) 80%, transparent); }
@keyframes arc-tt-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes arc-tt-out { from { opacity: 1; } to { opacity: 0; } }
`;
/** 已注入样式的根（document 或各 ShadowRoot：peek 的 closed shadow 也能从内部元素 getRootNode() 拿到） */
const styledRoots = new WeakSet<Document | ShadowRoot>();
let current: HTMLElement | null = null;
/** 当前提示的宿主：重渲染把宿主移出文档时（mouseleave 不会触发）据此收掉残留提示 */
let currentHost: HTMLElement | null = null;
/** 显示期间监听宿主 data-tip 的 observer 的断开函数（hide 时调用） */
let liveOff: (() => void) | null = null;
let lastClose = -Infinity;
/** 关闭：easeOut 淡出 0.3s 后移除（无动画环境直接移除） */
const hide = () => {
    liveOff?.(); liveOff = null;
    const el = current; if (!el) return; current = null; currentHost = null; lastClose = Date.now();
    el.classList.add("out");
    setTimeout(() => el.remove(), TOOLTIP_FADE_OUT_S * 1000);
};
/** 提示挂载点：宿主在 ShadowRoot 里 → 样式（<style>）与提示都放进该 root；否则 document.head / body */
function mountRoot(host: HTMLElement): { root: Document | ShadowRoot; parent: Node } {
    const r = host.getRootNode?.();
    if (typeof ShadowRoot !== "undefined" && r instanceof ShadowRoot) return { root: r, parent: r };
    return { root: document, parent: document.body };
}
function ensureStyle(root: Document | ShadowRoot) {
    if (styledRoots.has(root)) return;
    styledRoots.add(root);
    const st = h("style", null, TOOLTIP_CSS);
    if (root instanceof Document) root.head.append(st); else root.append(st);
}

/** 只给可交互 / 可聚焦元素补 aria-label（纯 span / div 徽标、卡片页脚不补） */
export function isInteractive(el: Element): boolean {
    const tag = (el.tagName ?? "").toUpperCase();
    return ["BUTTON", "A", "INPUT", "SELECT", "TEXTAREA", "SUMMARY"].includes(tag) || el.hasAttribute("role") || el.hasAttribute("tabindex");
}
/** 本模块写过的 aria-label（区分元素自带的与我们补的） */
const ours = new WeakMap<Element, string>();
/** aria-label 规则：自带的永不覆盖；没有且可交互时用提示文本补；文本为空时撤掉我们补的。 */
export function syncAriaLabel(el: HTMLElement, text: string) {
    const cur = el.getAttribute("aria-label");
    const mine = ours.has(el) && cur === ours.get(el);
    if (cur != null && !mine) return;
    if (!text || !isInteractive(el)) { if (mine) el.removeAttribute("aria-label"); ours.delete(el); return; }
    el.setAttribute("aria-label", text); ours.set(el, text);
}

/** 去原生 title（避免与 ArcTooltip 重叠）：宿主及其内部 img / favicon / svg 的 title 属性都移除；
 * 宿主自身的 title 文本在 aria-label 缺失且可交互时兜底挪到 aria-label（不覆盖已有）。返回被移除的个数。 */
export function stripTitles(host: Element): number {
    let n = 0;
    const own = host.getAttribute("title");
    if (own != null) {
        if (own.trim() && !host.hasAttribute("aria-label") && isInteractive(host)) { host.setAttribute("aria-label", own.trim()); }
        host.removeAttribute("title"); n++;
    }
    if (typeof host.querySelectorAll !== "function") return n;
    for (const d of Array.from(host.querySelectorAll("[title]"))) { d.removeAttribute("title"); n++; }
    for (const t of Array.from(host.querySelectorAll("svg > title"))) { t.remove(); n++; }
    return n;
}

/** 显示期间实时跟随宿主 data-tip：属性变化 → 先交给 applyTip（更新文本表、只改我们补的 aria-label、移除属性），
 * 再读最新文本回调 onText。只监听宿主自身属性（不 subtree），不替换宿主节点。返回断开函数。
 * （项目中没有副标题 / 快捷键的 data 属性，故只监听 data-tip。） */
export function bindLiveText(host: HTMLElement, get: () => string, onText: (t: string) => void,
    MO: typeof MutationObserver | undefined = typeof MutationObserver === "undefined" ? undefined : MutationObserver): () => void {
    if (!MO) return () => { };
    let last = get();
    const mo = new MO(() => {
        applyTip(host);
        const t = get();
        if (t !== last) { last = t; onText(t); }
    });
    mo.observe(host, { attributes: true, attributeFilter: ["data-tip"] });
    return () => mo.disconnect();
}

/** 快捷键 → 键帽组（每键一个 kbd，间距分隔；无快捷键返回 null） */
export function keycaps(sc: string | undefined): HTMLElement | null {
    const keys = sc ? splitShortcut(sc) : [];
    return keys.length ? h("span", { class: "arc-tt-keys" }, ...keys.map(k => h("kbd", null, h("span", null, k)))) : null;
}

export interface ArcTooltipOptions { variant?: TooltipVariant; /** 快捷键（prettyCombo 输出），每键一个键帽；可为函数（显示时取值） */ shortcut?: string | (() => string); /** 副标题（11pt，标题色 α.66）；可为函数 */ subtitle?: string | (() => string); /** profileName 徽章 */ profile?: string; /** 显示延迟（s），默认 0.45；data-tip-delay */ delay?: number; /** "cursor"：跟随鼠标（anchor 8）；data-tip-anchor */ anchor?: "cursor"; /** 最大宽度 px；data-tip-max-width */ maxWidth?: number; /** 首选方向，默认 6 bottomLeading */ edge?: TipEdge }
/** 给宿主挂 ArcTooltip：去掉原生 title，按 syncAriaLabel 规则处理 aria-label。text 可为函数（每次显示时取值；空文本不显示）。 */
export function arcTooltip<T extends HTMLElement>(host: T, text: string | (() => string), opts: ArcTooltipOptions = {}): T {
    const get = () => (typeof text === "function" ? text() : text).trim();
    if (host.hasAttribute(HOST_ATTR)) return host; // 已挂过（直接调用 + data-tip 重复）→ 不重复挂监听（防双提示）
    host.setAttribute(HOST_ATTR, "");
    watchRoot(host);
    syncAriaLabel(host, get()); // 先用提示文本补 aria-label，title 只在仍缺 aria-label 时兜底
    stripTitles(host);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cancel = () => { clearTimeout(timer); timer = undefined; follow = null; hide(); };
    let mx = 0, my = 0, follow: ((e: MouseEvent) => void) | null = null;
    /* 嵌套抑制（Cat 定案，Rea ⛔「按钮上行 tooltip 是否抑制」未追到）：指针在宿主内带 data-tip-block 的后代（右按钮 / 静音钮）上，
     * 或宿主自己带 data-tip-blocked（TabRow 在左图标区置位）时，宿主的提示计时取消、已显示的收起；离开后重新计时。保证行提示与按钮提示不会同时出现。 */
    let wasBlocked = false;
    const blockedBy = (e: MouseEvent): boolean => {
        if (host.hasAttribute("data-tip-blocked")) return true;
        const b = (e.target as Element | null)?.closest?.("[data-tip-block]");
        return !!b && b !== host && host.contains(b);
    };
    host.addEventListener("mousemove", (e: MouseEvent) => {
        mx = e.clientX; my = e.clientY;
        if (blockedBy(e)) {
            wasBlocked = true;
            const showing = currentHost === host;
            if (timer !== undefined || showing) { clearTimeout(timer); timer = undefined; follow = null; if (showing) hide(); }
            return;
        }
        if (wasBlocked) { wasBlocked = false; arm(); return; }
        follow?.(e);
    });
    host.addEventListener("mouseenter", (e: MouseEvent) => {
        mx = e.clientX; my = e.clientY;
        wasBlocked = blockedBy(e);
        if (wasBlocked) { clearTimeout(timer); timer = undefined; return; }
        arm();
    });
    function arm() {
        clearTimeout(timer);
        if (!get()) return;
        timer = setTimeout(() => {
            const t = get();
            if (!host.isConnected || !t) return;
            stripTitles(host); // 挂载后又被写回的 title（favicon 加载等）
            const { root, parent } = mountRoot(host);
            ensureStyle(root);
            hide();
            const tip = h("div", { class: "arc-tooltip", role: "tooltip", "data-v": String(opts.variant ?? 0) },
                (() => { const sub = (typeof opts.subtitle === "function" ? opts.subtitle() : opts.subtitle)?.trim(); return h("span", null, t, sub ? h("small", null, sub) : null); })(),
                opts.profile ? h("span", { class: "arc-tt-badge" }, opts.profile) : null,
                keycaps(typeof opts.shortcut === "function" ? opts.shortcut() : opts.shortcut));
            if (opts.maxWidth && opts.maxWidth > 0) tip.style.maxWidth = `min(${opts.maxWidth}px, calc(100vw - ${2 * TOOLTIP_AREA_INSET}px))`;
            parent.appendChild(tip);
            // shadow root（peek）里同样以 fixed 定位于视口
            const pref = opts.edge ?? DEFAULT_EDGE;
            const vp = () => ({ width: document.documentElement.clientWidth || innerWidth, height: innerHeight || document.documentElement.clientHeight });
            const place = (): boolean => {
                if (opts.anchor === "cursor") {
                    const c = placeAtCursor(mx, my, tip.offsetWidth, tip.offsetHeight, vp());
                    tip.style.left = `${c.left}px`; tip.style.top = `${c.top}px`; tip.dataset.edge = "cursor";
                    if ((opts.variant ?? 0) === 0) tip.style.borderRadius = cursorCorners(c.flipX, c.flipY).map(x => `${x}px`).join(" ");
                    return true;
                }
                const p = placeTooltip(host.getBoundingClientRect(), tip.offsetWidth, tip.offsetHeight, { width: document.documentElement.clientWidth || innerWidth, height: innerHeight || document.documentElement.clientHeight }, pref);
                if (!p) return false;
                tip.style.left = `${p.left}px`; tip.style.top = `${p.top}px`; tip.dataset.edge = String(p.edge);
                return true;
            };
            if (!place()) { tip.remove(); return; } // 哪个方向都放不下：不显示（FUN_100dec80c L130）
            if (opts.anchor === "cursor") follow = () => { if (current === tip) place(); }; // 跟随鼠标
            else if ((opts.variant ?? 0) === 0) tip.style.borderRadius = tooltipCorners(0, pref).map(x => `${x}px`).join(" "); // 按首选方向，不随回退（⛔）
            current = tip; currentHost = host;
            const label = tip.firstChild as HTMLElement;
            liveOff = bindLiveText(host, get, nt => {
                if (!nt) { hide(); return; }
                label.firstChild!.textContent = nt; // 只改文字节点：宿主与气泡节点都不重建
                if (!place()) hide();
            });
        }, nextDelay(opts.delay ?? TOOLTIP_DELAY_S, (Date.now() - lastClose) / 1000) * 1000);
    }
    host.addEventListener("mouseleave", cancel);
    host.addEventListener("mousedown", cancel);
    return host;
}

/* ── 声明式：元素写 "data-tip": 文本（代替原生 title），MutationObserver 在元素进入文档时自动挂 arcTooltip（原 tip.ts 合并至此）。
 * 改 data-tip 即更新文本（显示时读最新）。注意：observer 看不到 shadow root 内部，shadow 里请直接调 arcTooltip。 */
const texts = new WeakMap<HTMLElement, string>();
const attached = new WeakSet<HTMLElement>();
/** 声明式快捷键：data-tip-shortcut="⌥2"（与 data-tip 同时写；可选 data-tip-edge="0..7" 首选方向） */
const shortcuts = new WeakMap<HTMLElement, string>();
/** 声明式副标题：data-tip-subtitle="…"（优先级由调用方决定，例如 URL 相关在先、否则「双击重命名」） */
const subtitles = new WeakMap<HTMLElement, string>();
/** 处理一个元素：读并移除 data-tip；首次挂 ArcTooltip；aria-label 走 syncAriaLabel */
/** 每个宿主声明过的 data-tip* 原值（applyTip 会把属性消费掉；img → svg 替换（EmptyFavicon.swap）要靠它把提示带到新节点） */
const declared = new WeakMap<Element, Record<string, string>>();
/** 把 from 的 tooltip 声明复制到 to（from 的属性已被消费也行）；返回是否复制。SVG / HTML 宿主通用。 */
const TIP_ATTRS = ["data-tip", "data-tip-subtitle", "data-tip-shortcut", "data-tip-anchor", "data-tip-delay", "data-tip-max-width", "data-tip-edge"] as const;
function readTipAttrs(el: Element): Record<string, string> {
    const d: Record<string, string> = {};
    for (const k of TIP_ATTRS) { const v = el.getAttribute(k); if (v != null) d[k] = v; }
    return d;
}
export function copyTip(from: Element, to: Element): boolean {
    const live = readTipAttrs(from);
    const d: Record<string, string> = Object.assign({}, declared.get(from), live);
    const t = texts.get(from as HTMLElement); if (t != null && d["data-tip"] !== undefined) d["data-tip"] = t;
    const keys = Object.keys(d); if (!keys.length) return false;
    for (const k of keys) to.setAttribute(k, d[k]);
    return true;
}
export function applyTip(el: HTMLElement) {
    const raw = el.getAttribute("data-tip");
    if (raw == null) return;
    declared.set(el, readTipAttrs(el));
    el.removeAttribute("data-tip");
    const t = raw.trim();
    texts.set(el, t);
    const sub = el.getAttribute("data-tip-subtitle"); if (sub != null) { subtitles.set(el, sub); el.removeAttribute("data-tip-subtitle"); }
    const sc = el.getAttribute("data-tip-shortcut"); if (sc != null) { shortcuts.set(el, sc); el.removeAttribute("data-tip-shortcut"); }
    // data-tip-anchor="cursor"、data-tip-delay（秒）、data-tip-max-width（px）：首次读取后保留在 opts（与 edge 相同，挂载时生效）
    const anc = el.getAttribute("data-tip-anchor"); el.removeAttribute("data-tip-anchor");
    const dl = Number(el.getAttribute("data-tip-delay") ?? NaN); el.removeAttribute("data-tip-delay");
    const mw = Number(el.getAttribute("data-tip-max-width") ?? NaN); el.removeAttribute("data-tip-max-width");
    const egRaw = el.getAttribute("data-tip-edge"), eg = egRaw == null ? NaN : Number(egRaw); el.removeAttribute("data-tip-edge");
    if (t && !attached.has(el)) { attached.add(el); arcTooltip(el, () => texts.get(el) ?? "", { shortcut: () => shortcuts.get(el) ?? "", subtitle: () => subtitles.get(el) ?? "", ...(eg >= 0 && eg <= 7 && Number.isInteger(eg) ? { edge: eg as TipEdge } : {}), ...tipAttrOpts(anc, dl, mw) }); }
    else syncAriaLabel(el, t);
    if (t) stripTitles(el);
}
/** data-tip-anchor / -delay / -max-width → 选项（无效值忽略） */
export function tipAttrOpts(anchor: string | null, delay: number, maxWidth: number): Pick<ArcTooltipOptions, "anchor" | "delay" | "maxWidth"> {
    const o: Pick<ArcTooltipOptions, "anchor" | "delay" | "maxWidth"> = {};
    if (anchor === "cursor") o.anchor = "cursor";
    if (Number.isFinite(delay) && delay >= 0) o.delay = delay;
    if (Number.isFinite(maxWidth) && maxWidth > 0) o.maxWidth = maxWidth;
    return o;
}
export function scanTips(root: ParentNode) {
    // SVGElement 也是宿主（空 favicon / 斜杠等 svg 图标）：只认 HTMLElement 会让 svg 自身的 data-tip 永远不生效
    if (typeof Element !== "undefined" && root instanceof Element) applyTip(root as HTMLElement);
    for (const el of Array.from(root.querySelectorAll<HTMLElement>("[data-tip]"))) applyTip(el);
}
/* ── 安全网（v52011 实机：悬停标签行几秒后原生 title 又盖上来——tabs.onUpdated / favicon 加载完会重写 title）。
 * 范围（决定）：
 *   ① ArcTooltip 宿主（标记 data-arc-tt）自身；② 宿主的任意后代（img / favicon / svg）；
 *   ③ 包住宿主的最近「行容器」（ROW_SEL，如 TabRow 的 .arc-tab title=url）——只在该行里确有宿主时才去，
 *      不碰与 tooltip 无关的祖先（页面其他 title 保留）。
 * 文本去向：宿主自身 → 提示文本为空时改作提示文本（等同补 data-tip），否则仅 aria-label 兜底；
 *   其余（后代 / 行）→ aria-label（仅缺失且可交互），否则丢弃。
 * 性能：只看 mutation 记录的 target / addedNodes（及其 closest / 自身子树里的 title 元素），不全树扫描。
 * 防自触发：我们 removeAttribute("title") 产生的记录 target 已无 title → 直接跳过；不写 title，所以不会循环。 */
export const HOST_ATTR = "data-arc-tt";
export const ROW_SEL = ".arc-row, .arc-tab, .arc-lib-row, [role=row], [role=listitem]";
/** 处理一个（可能）被写回 title 的元素；返回是否移除了 title */
export function fixTitle(el: Element): boolean {
    const title = el.getAttribute?.("title");
    if (title == null) return false; // 我们自己移除产生的记录 / 无 title：跳过（防循环）
    const isHost = el.hasAttribute(HOST_ATTR);
    const inHost = !isHost && !!el.parentElement?.closest?.(`[${HOST_ATTR}]`);
    const isRow = !isHost && !inHost && !!el.matches?.(ROW_SEL) && !!el.querySelector?.(`[${HOST_ATTR}]`);
    if (!isHost && !inHost && !isRow) return false;
    const t = title.trim();
    if (isHost && t && !(texts.get(el as HTMLElement) ?? "")) texts.set(el as HTMLElement, t);
    if (t && !el.hasAttribute("aria-label") && isInteractive(el)) el.setAttribute("aria-label", t);
    el.removeAttribute("title");
    return true;
}
/** 新插入的节点：自身 + 子树里带 title 的元素 + 包住它的行容器 */
export function fixInserted(n: Element) {
    fixTitle(n);
    if (typeof n.querySelectorAll === "function") for (const d of Array.from(n.querySelectorAll("[title]"))) fixTitle(d);
    const row = n.parentElement?.closest?.(ROW_SEL); if (row) fixTitle(row);
}
/** 处理一批记录（导出供测试） */
export function handleMutations(ms: readonly { type: string; target: Node; attributeName?: string | null; addedNodes?: ArrayLike<Node> }[]) {
    for (const m of ms) {
        if (m.type === "attributes") {
            const el = m.target as HTMLElement;
            if (m.attributeName === "title") fixTitle(el);
            else if (m.attributeName === "data-tip") applyTip(el);
            continue;
        }
        if (currentHost && !currentHost.isConnected) hide(); // 宿主被重渲染移除 → 不留残影
        for (const n of Array.from(m.addedNodes ?? [])) if ((n as Element).nodeType === 1) { scanTips(n as unknown as ParentNode); fixInserted(n as Element); }
    }
}
const OBS_OPTS: MutationObserverInit = { subtree: true, childList: true, attributes: true, attributeFilter: ["data-tip", "title"] };
const watched = new WeakSet<Node>();
/** shadow root 里挂宿主时也盯上该 root（peek） */
function watchRoot(host: HTMLElement) {
    const r = host.getRootNode?.();
    if (typeof ShadowRoot === "undefined" || typeof MutationObserver === "undefined" || !(r instanceof ShadowRoot) || watched.has(r)) return;
    watched.add(r); new MutationObserver(handleMutations).observe(r, OBS_OPTS);
}
let installed = false;
export function installTips() {
    if (installed || typeof document === "undefined" || typeof MutationObserver === "undefined") return;
    installed = true;
    const start = () => {
        scanTips(document);
        new MutationObserver(handleMutations).observe(document.documentElement, OBS_OPTS);
    };
    if (document.documentElement) start(); else document.addEventListener("DOMContentLoaded", start, { once: true });
}
installTips();

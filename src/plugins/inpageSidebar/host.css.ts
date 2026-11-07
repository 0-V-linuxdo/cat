/* 宿主（shadow root）样式。数值来自 constants.ARC / SPRING；⚠ = 网页近似，不是 Arc 原值（DESIGN 5.2.2）。
 * 层级：只保证整体在页面之上（宿主根 z-index 最大值）；shadow 内部相对次序 保持层 < 容器 < 把手 / 按钮 < 拖拽遮罩（对应 Arc 的 浮出容器 6 < resize 区 7）。 */
import { ARC, CARD_LOOK, CHROME, FLAT_BASE, HANDLE, SPRING } from "./constants";
import { pushTiming } from "./logic";
import { INPAGE_LAYERS as L, PAGE_Z_MAX } from "@utils/zLayers";

/** 容器外观（card ↔ flat）要过渡的属性：边距 / 高 / 圆角 / 边框 / 阴影 / 底色 / 模糊。曲线固定用推开曲线（arc80：Arc floating→locked 的 0.08 s easeOutQuad；PUSH.curve="spring" 时跟着换），
 *  只在 data-push 翻转时才会触发；hidden↔floating 的 transform 仍是弹簧。第 1、2 项必须是 transform / visibility（data-noanim 用 transition-property 只留这两项） */
const chromeTransition = () => { const t = pushTiming(); return ["left", "top", "height", "border-radius", "border-width", "border-color", "box-shadow", "background-color", "backdrop-filter"].map(p => `${p} ${t.ms}ms ${t.easing}`).join(", "); };
const cardFilter = `blur(${CARD_LOOK.blur}px) saturate(${CARD_LOOK.saturate})`;

export const hostCss = () => `
:host { all: initial; position: fixed; left: 0; top: 0; width: 0; height: 0; z-index: ${PAGE_Z_MAX}; --w: ${ARC.defaultWidth}px; --i: ${CHROME.card.left}px; --b: rgba(128,128,128,.35); --bg: ${FLAT_BASE.light}; }
/* --i = 容器左缘（卡片 5 / 平贴 0），把手 / 提示的位置跟着它走；--bg = 平贴态的不透明底（content.ts 按侧栏页回报的主题底写入，默认按页面深浅回退） */
:host([data-push="1"]) { --i: ${CHROME.flat.left}px; }
@media print { :host { display: none !important; } }
:host([data-fs="1"]) { display: none !important; }
* { box-sizing: border-box; }
/* 保持区：宽 + 80（Arc ArcSidebar 保持区）；只在悬停浮出时开启 */
.hold { position: fixed; left: 0; top: 0; width: calc(var(--w) + ${ARC.holdExtra}px); height: 100vh; pointer-events: none; z-index: ${L.hold}; }
.hold[data-on="1"] { pointer-events: auto; }
/* 触发条：⚠ Arc 在窗口外侧，这里只能在视口内；默认关（设置「悬停浮出」），未悬停 50 / 已进入 250 */
.trigger { position: fixed; left: 0; top: 0; width: ${ARC.triggerNarrow}px; height: 100vh; z-index: ${L.trigger}; background: transparent; }
.trigger[data-engaged="1"] { width: ${ARC.triggerWide}px; }
/* 容器两套外观（DESIGN 3.8.8）。默认 = 卡片（Arc floating：悬停浮出 / 浮在页面上）：x / y +5、高 −10、圆角 12、1 px 边框 #FFF α.3、阴影，底透明 + backdrop-filter 模糊（侧栏页在卡片态把自己的背景压成半透明盖在模糊上）。
   data-push="1" = 平贴（Arc locked，常驻推开）：x = y = 0、整高、无圆角 / 边框 / 阴影，不透明底（--bg）。悬停（:hover）不改外观——外观只由 data-push 决定 */
.box { position: fixed; left: ${CHROME.card.left}px; top: ${CHROME.card.top}px; width: var(--w); height: calc(100vh - ${CHROME.card.vInset}px); z-index: ${L.box};
  border-radius: ${CHROME.card.radius}px; border: ${CHROME.card.border}px solid ${CARD_LOOK.border}; overflow: hidden; background-color: transparent;
  -webkit-backdrop-filter: ${cardFilter}; backdrop-filter: ${cardFilter};
  box-shadow: ${CARD_LOOK.shadow}; /* ⚠ 近似 Arc 的 CellDropShadow 图（黑、无 y 偏移、外扩 10、峰值≈0.075）；9-slice ⛔ */
  transform: translateX(calc(-1 * (var(--w) + ${ARC.hiddenExtra}px))); visibility: hidden; pointer-events: none;
  transition: transform ${SPRING.durationMs}ms ${SPRING.easing}, visibility 0s linear ${SPRING.durationMs}ms, ${chromeTransition()}; /* ⚠ 弹簧 response .18 / ζ .8 的 linear() 近似，显示与收回同一条曲线；外观过渡见 chromeTransition */
  will-change: transform; }
.box[data-shown="1"] { transform: none; visibility: visible; pointer-events: auto; transition: transform ${SPRING.durationMs}ms ${SPRING.easing}, visibility 0s, ${chromeTransition()}; }
:host([data-push="1"]) .box { left: ${CHROME.flat.left}px; top: ${CHROME.flat.top}px; height: calc(100vh - ${CHROME.flat.vInset}px); border-radius: ${CHROME.flat.radius}px; border-width: ${CHROME.flat.border}px; border-color: transparent; box-shadow: none; background-color: var(--bg);
  -webkit-backdrop-filter: blur(0px) saturate(1); backdrop-filter: blur(0px) saturate(1); }
/* 新页面第一次收到状态：外观立即到位，不从卡片变形到平贴（只留 transform / visibility 的过渡） */
:host([data-noanim="1"]) .box { transition-property: transform, visibility; }
/* 常驻（推开页面）切换：侧栏滑入 / 滑出和页面让位 / 回位同一条曲线（Arc locked 切换 0.08 s；PUSH.curve 可切回弹簧）。data-curve="locked" 由 content.ts 在「进入 / 离开推开」那一次渲染里设置；悬停浮出（hidden↔floating）不带它 = 继续弹簧 */
:host([data-curve="locked"]) .box { transition: transform ${pushTiming().ms}ms ${pushTiming().easing}, visibility 0s linear ${pushTiming().ms}ms, ${chromeTransition()}; }
:host([data-curve="locked"]) .box[data-shown="1"] { transition: transform ${pushTiming().ms}ms ${pushTiming().easing}, visibility 0s, ${chromeTransition()}; }
:host([data-noanim="1"][data-curve="locked"]) .box, :host([data-noanim="1"][data-curve="locked"]) .box[data-shown="1"] { transition-property: transform, visibility; }
/* color-scheme 由 content.ts 按侧栏页回报的方案写进 iframe 行内样式：与文档一致时 iframe 画布才透明（卡片的模糊才透得出来）；没回报 = normal */
iframe { display: block; width: 100%; height: 100%; border: 0; background: transparent; color-scheme: normal; }
/* 调宽把手（补丁 12 + Arc 样式对齐 AH，Arc SidebarResizeRegionView；热区侧栏显示时始终创建，竖条 i 只在设置 showHandle 开着时才创建，content.ts syncHandle / syncBar）：8 px 宽透明热区 left = --i + --w − 4（--i = 容器左缘：平贴 0 / 卡片 5，所以悬停浮出时随容器右移）、top 11、高 100vh − 22；
   内画竖条：路径 3 px + ⚠ 1 px 同色描边 = 可见 4 px 宽（left = 0 − 4/2 = −2：中心线压在热区左缘，locked 占 [W−6, W−2]、floating 占 [W−1, W+3]），高 = 热区高 − 8（H − 30，上下各 15 px）、圆角 4（> 宽/2 → 胶囊）。
   颜色 = 主题 maxContrastColor（--bar，content.ts 写；⚠ 估算 / 随 Space 色算），整层 opacity 0.5（显示态）；静止 0。显示由 JS 控制（data-hot，悬停 0.25 s 定时器，content.ts）：淡入淡出都是 0.2 s linear（⚠ Arc 未设缓动 = 系统线性）；
   拖动（data-drag）常显 0.5、不变色不改 alpha、无过渡；松手后不在把手上则 0.2 s 淡出。光标 ew-resize（Arc resizeLeftRight）。z 序高于容器（Arc 7.0 > 6.0），低于拖拽遮罩 */
.handle { position: fixed; left: calc(var(--i) + var(--w) - ${ARC.handleWidth / 2}px); top: ${ARC.handleTop}px; width: ${ARC.handleWidth}px; height: calc(100vh - ${ARC.handleVInset}px); z-index: ${L.handle}; cursor: ${HANDLE.cursor}; touch-action: none; }
.handle i { position: absolute; left: ${HANDLE.barCenterX - HANDLE.barVisible / 2}px; top: ${HANDLE.barVInset / 2}px; width: ${HANDLE.barVisible}px; height: calc(100% - ${HANDLE.barVInset}px); border-radius: ${HANDLE.barRadius}px; background: var(--bar); pointer-events: none;
  opacity: 0; transition: opacity ${HANDLE.fadeMs}ms linear 0s; }
.handle[data-hot="1"] i { opacity: ${HANDLE.barOpacity}; }
.handle[data-drag="1"] i { opacity: ${HANDLE.barOpacity}; transition: none; }
.hint { position: fixed; left: calc(var(--i) + var(--w) + ${ARC.handleWidth + 36}px); top: ${ARC.handleTop + 1}px; z-index: ${L.hint}; display: none; max-width: 260px; padding: 6px 10px; border-radius: 8px; font: 12px/1.35 system-ui, sans-serif; color: CanvasText; background: Canvas; border: ${ARC.border}px solid var(--b); }
.hint[data-on="1"] { display: block; }
/* 拖拽遮罩：盖住网页和 iframe，避免拖动时事件被 iframe 吃掉 */
.mask { position: fixed; inset: 0; z-index: ${L.mask}; cursor: ${HANDLE.cursor}; display: none; background: transparent; }
.mask[data-on="1"] { display: block; }
`;

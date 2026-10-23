/* 插件组 Spaces 的样式：Space 标题、底部 Space 切换点、收藏网格、切换滑动动画（只用核心 --arc-* 令牌） */
export default /* css */ `
/* Space 标题行 = Arc SidebarSectionHeaderView（context 0 分支）；数值全部来自 /workspace/arc-analysis/space-header-idle.md（Rea），没有来源的标 ⛔。
 * idle（未 hover）：无底色、无卡片、无描边（§1：backgroundLayer.opacity = 0；highlightStyle 的 p2 语义 ⛔ 未解，按代码分支推断为 0）。
 * hover：圆角 8 的卡片淡入——浅 #0E0F10 α.05 / 深 #FAFBFF α.10（§4 SidebarItemBackground），卡片 = 行元素整宽（Arc 页内 8 = 标签行 hover 盒，见下），0.1s ease-out（opacity 0→1），hover 进入延迟 0.1s、离开立即。
 * 标题文字 SidebarForegroundDarker：浅 #000 α.45 / 深 #FFF α.45，13pt semibold，单行 tail 截断（§2）。图标槽 24×24，默认色 ForegroundTertiary 浅 #000 α.3 / 深 #FFF α.3（运行时 tint ⛔）。
 * 行内：stack spacing 4、centerY、顺序 [箭头, 图标, 标题, “…”]；contentInset top 6 / left 14 / bottom 2 / right 12（§5，顺序 top, left, bottom, right；Arc 坐标系，Cat 的折算值见下面 space-header-layout 注释：6 / 0）。
 * 行高：Rea space-header-layout.md §0/§3：header.height ≥ 36（viewDidLoad 硬下限）；内容 = 24 图标 + top 6 + bottom 2 = 32 < 36 → idle 恰为 36（⛔ 推算：前提标题单行文本高度 ≤ 28）→ height 36（原 34 沿用值作废）。header → 第一行 gap 0、header 顶边距 8 / 0（requiresTopPadding，⚠ 字段名推断）：Cat 的 .arc-slot-header 在共享 static/sidepanel.css（padding 4 0 4）→ 不在这里改，见 patches README；⛔ 卡片 y 方向 → 按 flipped 实现 top 2 / bottom -2；⛔ continuous 圆角 CSS 没有 → 普通圆角 8；
 * 水平（space-header-layout.md §1 / §4）：Arc 里 Space 行的图标槽 24×24 左缘 = 文件夹行 / tab 行图标容器左缘（都是 14，差 0）；Arc 没有 “5”（常量表里没有 5.0）。Cat 坐标系与 Arc 不同（--arc-pad-x 10 ≠ 14），只用相对关系：Cat 标签 favicon 16 居中于 24 槽（左 4）→ 槽左缘 = favicon 左缘 − 4 = pad-x − 4 → 左内边距 = --arc-pad-x − 4 = 6。标题起点：Arc Space 比文件夹 / tab 标题左 2（42 对 44，槽左 14 起算 = +28 对 +30：Space = 24 + stack spacing 4；tab = 24 + customSpacing 4 + titleStack 左 inset 2）。Rea 裁定 tab 标题非 drift 44 / drift 46 后，Cat 标签行 favicon→标题 = 10（与 Arc 同，命令栏「标题列」补丁），Space 不再需要把标题名往左收：标题起点 = 左内边距 + 24 + 4 = 槽左 + 28 = 标签标题 − 2（原 margin-left: -4px 是配合旧的 favicon→标题 6 加的，space-header-layout 补丁 1 引入，现删除）。
 * 卡片 / 右侧：Arc 页内 x：卡片 8…W−8 = tab / 文件夹行 hover 盒（§1.2 “同为 8”）；Cat 的行元素本身就是盒子（#app 内左右各缩 8）→ 卡片 left / right 0。“…” 右缘比标签 / 文件夹行右按钮靠右 6（Rea §2：12 对 18）：Cat 标签关闭按钮距行右 6 → 相对量 padding-right 0；
 * 但那样 “…” 的 hover 底（24×26、圆角 7）贴着卡片右缘（Arc 里 “…” 距卡片右缘 4 = 12 − 8），所以填 4：比标签按钮右缘靠右 2（Rea 6，偏差 4；原因：Cat 标签按钮距行右 6、Arc 距盒 10）。
 * ⛔ 页面相对侧栏最左缘偏移；⛔ AppKit level-0 基准 x（净偏移 0 为推断）；⛔ Space 图标字形实际宽度（16pt 居中于槽 → 字形左 = 槽左 + 4 ⚠）；⛔ 右侧 “…” 右缘比文件夹 / tab 右按钮靠右 6（12 对 18）：Cat 标签行右内边距由 sidepanel.css 决定，只测不改，见 README。
 * ⛔ 折叠开关开且 expansionState == 2 时标题 bold（§2）不实现；⛔ 编辑中（isEditing）的 30 宽 / 常亮卡片不实现；有图标的行 animated = false（§3.3，代码路径推出，未运行时验证）→ 箭头与“…”在 0.1s hover 延迟后瞬间出现，没有淡入。 */
.arc-space-title {
  --sh-card: rgb(14 15 16 / .05); --sh-text: rgb(0 0 0 / .45); --sh-icon: rgb(0 0 0 / .3); --sh-more: rgb(0 0 0 / .565); --sh-more-hover: rgb(0 0 0 / .071);
  position: relative; isolation: isolate;
  display: flex; gap: 4px; align-items: center; height: 36px; padding: 6px 4px 2px 6px;
  font-weight: 600; font-size: 13px; color: var(--sh-text); cursor: pointer; flex: 1; min-width: 0;
  background: transparent;
}
/* 深色三路：data-theme / 系统深色 / 实际色调 data-bb-dark（排最后，同 today-hbtn、tooltip 的顺序） */
:root[data-theme="dark"] .arc-space-title { --sh-card: rgb(250 251 255 / .10); --sh-text: rgb(255 255 255 / .45); --sh-icon: rgb(255 255 255 / .3); --sh-more: rgb(255 255 255 / .592); --sh-more-hover: rgb(255 255 255 / .077); }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .arc-space-title { --sh-card: rgb(250 251 255 / .10); --sh-text: rgb(255 255 255 / .45); --sh-icon: rgb(255 255 255 / .3); --sh-more: rgb(255 255 255 / .592); --sh-more-hover: rgb(255 255 255 / .077); } }
:root[data-bb-dark="1"] .arc-space-title { --sh-card: rgb(250 251 255 / .10); --sh-text: rgb(255 255 255 / .45); --sh-icon: rgb(255 255 255 / .3); --sh-more: rgb(255 255 255 / .592); --sh-more-hover: rgb(255 255 255 / .077); }
:root[data-bb-dark="0"] .arc-space-title { --sh-card: rgb(14 15 16 / .05); --sh-text: rgb(0 0 0 / .45); --sh-icon: rgb(0 0 0 / .3); --sh-more: rgb(0 0 0 / .565); --sh-more-hover: rgb(0 0 0 / .071); }
/* idle 无描边、无按下底色：盖过 static/sidepanel.css 的发丝描边 / :active 底色（共享文件不改；.arc-space-title.arc-space-title 提高特异性）。Arc 没有找到 Space 行的按下态 ⛔ */
:root .arc-space-title.arc-space-title { box-shadow: none; background: transparent; }
:root .arc-space-title.arc-space-title:active { background: transparent; }
/* hover 卡片（Arc backgroundLayer）：伪元素，不占布局；左右各缩 8；idle 透明度 0，离开时 0.1s 淡出（无延迟），进入时延迟 0.1s 后 0.1s 淡入 */
.arc-space-title::before { content: ""; position: absolute; left: 0; right: 0; top: 2px; bottom: -2px; z-index: -1; pointer-events: none; border-radius: 8px; background: var(--sh-card); opacity: 0; transition: opacity .1s ease-out; }
.arc-space-title:hover::before { opacity: 1; transition: opacity .1s ease-out .1s; }
.arc-space-title > .arc-space-name { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
/* 折叠箭头与图标共用同一个 24×24 槽（space-header-layout 修正）。Rea space-header-idle.md §3.1 / §5：箭头显示时图标 isHidden（NSStackView 对 isHidden 视图分离，不占位）、箭头隐藏时 isHidden + customSpacing 0 → 左边永远只有一个槽，
 * 标题起点 = 左内边距 + 24 + 4 = 槽左 + 28（= 标签标题 − 2，见上面注释；不再收 4）。原做法（箭头 opacity 0 占 24 + gap 4，图标紧随其后）使有 pin.collapse 命令时图标 / 标题比无箭头时右移 28px，也与下面文件夹 / 标签行的列对不上。
 * 现在：DOM 顺序仍是 [箭头, 图标, 标题, “…”]，图标用 margin-left: -(24 + 4) 叠在箭头槽上；idle 箭头 opacity 0、图标可见；hover 0.1s 延迟后瞬间互换（图标 opacity 0、箭头 opacity 1，§3.3 非动画分支）。
 * 箭头颜色 Rea 没给 ⛔ 沿用 --arc-muted；⛔ 箭头 idle 是否显示取决于运行时 collapse / expansionState（Rea ⛔ #3）、hover 时 Arc 到底显示箭头还是图标：显示条件 collapsePinnedSectionEnabled == 1、非编辑图标、且 hovered 或 expansionState != 0（Rea），Cat 无 expansionState → 只按 hover 换。 */
.arc-space-chevron { display: grid; place-items: center; width: 24px; height: 24px; flex: none; color: var(--arc-muted); opacity: 0; }
.arc-space-chevron + .arc-space-icon { margin-left: -28px; }
.arc-space-title:hover .arc-space-chevron { opacity: 1; transition: opacity 0s linear .1s; }
.arc-space-title:hover .arc-space-chevron + .arc-space-icon { opacity: 0; transition: opacity 0s linear .1s; }
.arc-space-title .arc-space-icon { flex: none; width: 24px; height: 24px; color: var(--sh-icon); }
/* “…”（editButton）：idle alpha 0 且宽 0——不是 hidden，仍占 4 的 spacing（§3.2）；hover（0.1s 延迟后瞬间）宽 24、alpha 1；菜单打开（.open）/ 键盘焦点也显示。
 * 颜色 GrayA11 浅 #000 α.565 / 深 #FFF α.592、悬停底 GrayA4 浅 #000 α.071 / 深 #FFF α.077（§2、§3.3）；⛔ 高度（沿用 26）/ 圆角（沿用 7）/ 悬停时图标色是否变（Rea 没给，不变）；ellipsis 13pt semibold 见 spaceManager 的 svgIcon("more", 13) */
.arc-space-title .arc-space-more { width: 0; min-width: 0; height: 26px; padding: 0; border-radius: 7px; opacity: 0; overflow: hidden; color: var(--sh-more); flex: none; }
.arc-space-more .arc-svg-more { stroke-width: 2.6; }
.arc-space-title:hover .arc-space-more, .arc-space-title .arc-space-more.open, .arc-space-title .arc-space-more:focus-visible { width: 24px; min-width: 24px; opacity: 1; }
.arc-space-title:hover .arc-space-more { transition: opacity 0s linear .1s, width 0s linear .1s, min-width 0s linear .1s; }
.arc-space-title .arc-space-more:hover, .arc-space-title .arc-space-more.open { background: var(--sh-more-hover); }
/* header → 第一行（Rea space-header-layout.md §0/§3）：tablist.top = header.bottom（gap 0）；卡片 y 2…−2 下探 header 2，第一行 hover 盒（行高 40 内居中 36）上缘也在 +2 → 卡片与第一行盒“恰好相接”。
 * Cat：行元素就是盒子（margin 2 在元素外）。原来 header 所在 .arc-slot-header（static/sidepanel.css:84，padding 4 0 4，共享文件不改）的下内边距 4 让 Space 行底到第一行元素顶 = 4 + 2 = 6；
 * 去掉含 Space 标题的那一块 slot-header 的下内边距（其它 section 不受影响）→ Space 行底到第一行元素顶 = 2 = 卡片下缘（bottom −2）→ 与第一行盒相接。⛔ 第一行是否 pinnedTabsHeader（2pt 行）、收藏网格竖向位置 Rea 未定。 */
.arc-slot-header:has(.arc-space-title) { padding-bottom: 0; }
/* 空间标题已带折叠箭头：隐藏固定区单独的折叠按钮 */
.arc-slot-header:has(.arc-space-title) > .arc-part[data-plugin="PinnedTabs"] { display: none; }

/* Arc 风格菜单 / 面板（空间菜单、图标 / 颜色选择器、分享）：半透明深色、约 12px 圆角、细浅色描边、较高的行 */
.arc-menu.arc-space-menu, .arc-menu.arc-panel { border-radius: 12px; padding: 6px; min-width: 230px; border: 1px solid rgb(0 0 0 / .08);
  /* 高度上限：侧栏矮时不被裁掉，内部滚动（颜色 / 分享 / 主题选择器 / Space 菜单；图标选择器另由 .arc-ip-body 滚动） */
  max-height: calc(100vh - 8px); overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; scrollbar-color: color-mix(in srgb, var(--arc-fg) 25%, transparent) transparent; }
/* 强制主题与系统相反时，原生控件（滚动条 / 输入框 / 下拉）跟随所选主题 */
:root[data-theme="dark"] :is(.arc-space-menu, .arc-panel) { color-scheme: dark; }
:root[data-theme="light"] :is(.arc-space-menu, .arc-panel) { color-scheme: light; }
:root[data-theme="dark"] :is(.arc-space-menu, .arc-panel), :root[data-theme="dark"] .arc-submenu { border-color: rgb(255 255 255 / .14); background: rgb(36 36 52 / .86); }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) :is(.arc-space-menu, .arc-panel, .arc-submenu) { border-color: rgb(255 255 255 / .14); background: rgb(36 36 52 / .86); } }
.arc-space-menu .arc-menu-item, .arc-panel .arc-menu-item { min-height: 26px; padding: 3px 10px; font-size: 13.5px; border-radius: 6px; color: var(--arc-fg); justify-content: space-between; }
.arc-space-menu .arc-menu-sep { margin: 5px 10px; background: rgb(127 127 140 / .28); }
/* 禁用 = 只换文字 / 图标颜色，不降整行透明度。值 = Arc MenuDisabledText 浅 #ABABAB / 深 #797881（ARC_ArcMenu.bundle，/workspace/arc-analysis/arc-colors-all.tsv:30 / :37；menus-spec.md:50 menuItemDisabledTextColor） */
.arc-space-menu, .arc-panel, .arc-submenu { --arc-disabled-text: #ababab; }
:root[data-theme="dark"] :is(.arc-space-menu, .arc-panel, .arc-submenu) { --arc-disabled-text: #797881; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) :is(.arc-space-menu, .arc-panel, .arc-submenu) { --arc-disabled-text: #797881; } }
:is(.arc-space-menu, .arc-panel, .arc-submenu) .arc-menu-item.disabled { opacity: 1; cursor: default; color: var(--arc-disabled-text); }
:is(.arc-space-menu, .arc-panel, .arc-submenu) .arc-menu-item.disabled :is(.arc-menu-label, .arc-menu-kbd, .arc-svg, .arc-sym) { color: inherit; opacity: 1; }
/* 子菜单箭头 chevronRight(Regular) 现为 SF 填充字形（ionGlyphs.ts，无 stroke）→ 用 fill */
:is(.arc-space-menu, .arc-panel, .arc-submenu) .arc-menu-item.disabled .arc-svg { fill: currentColor; }
:is(.arc-space-menu, .arc-panel, .arc-submenu) .arc-menu-item.disabled:hover { background: transparent; color: var(--arc-disabled-text); }

/* 图标 / 颜色选择器 */
.arc-panel.arc-picker { width: 252px; gap: 6px; padding: 10px; }
.arc-picker-label { font-size: 12px; font-weight: 600; color: var(--arc-muted); padding: 2px 2px 0; }
.arc-picker-hint { margin: 0 2px 4px; font-size: 12px; color: var(--arc-muted); line-height: 1.4; }
.arc-picker-row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.arc-picker-row .arc-field { flex: 1; min-width: 0; height: 32px; }
/* 图标选择器 —— 数值出处 /workspace/arc-analysis/space-icon-picker.md §4（FUN_102243c30 / FUN_10224420c / IconPickerGrid）：
 * ✅ 内容宽 272（0x1045e68c8）；高 = 行数×32 + 48（空间 7 行 → 272）；外边距 水平 4 / 垂直 6；头部四周 8；
 * ✅ 8 列，格子 30×30，图标 14，行距 2；格子底透明，悬停 = 图标色 ×0.1，选中 = ×0.25，圆角 4，无描边；
 * ✅ 图标色 浅 #7E7E7E / 深 #FFFFFF；背景 CustomizationBackground 浅 #86888D α0.25 / 深 #FFF α0.25；
 * ✅ 分段 = 系统分段控件（跟随强调色），easeOut 0.2s；删除按钮宽 22、图标 15×15；肤色弹层 198×38。
 * 源码未找到：列间距（剩余 32 平均分配：space-evenly）、弹层底色 / 模糊、箭头尺寸、分段控件高 20 与圆角、emoji 字号、搜索框 / 分类条样式。 */
.arc-menu.arc-panel.arc-icon-picker {
  --ip-cb: rgb(134 136 141 / .25); --ip-ic: #7e7e7e;
  box-sizing: content-box; width: 272px; max-width: calc(100vw - 16px); min-width: 0; padding: 6px 4px; gap: 0; overflow: visible;
  /* 滚动修复：弹层不得超出视口（原来无 max-height，侧栏矮时下半截被裁掉且无法滚动）；超出部分由 .arc-ip-body 内部滚动 */
  max-height: calc(100vh - 20px); display: flex; flex-direction: column;
  background: linear-gradient(var(--ip-cb), var(--ip-cb)), var(--arc-pop-solid) /* ⛔ Rea 无 IconPicker 底色；沿用 core 弹层 token */;
}
:root[data-theme="dark"] .arc-menu.arc-panel.arc-icon-picker { --ip-cb: rgb(255 255 255 / .25); --ip-ic: #fff; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .arc-menu.arc-panel.arc-icon-picker { --ip-cb: rgb(255 255 255 / .25); --ip-ic: #fff; } }
.arc-ip-head { display: flex; align-items: center; justify-content: center; gap: 8px; padding: 8px; }
.arc-ip-segs { display: inline-flex; height: 20px; padding: 1px; box-sizing: border-box; border-radius: 6px; background: color-mix(in srgb, var(--arc-fg) 10%, transparent); }
.arc-ip-seg { border: 0; background: transparent; color: var(--arc-fg); font: inherit; font-size: 12px; padding: 0 12px; border-radius: 5px; cursor: pointer; transition: background .2s ease-out, color .2s ease-out; }
.arc-ip-seg.on { background: var(--arc-accent); color: #fff; }
.arc-ip-del { width: 22px; height: 20px; padding: 0; display: grid; place-items: center; color: var(--ip-ic); }
.arc-ip-del > .arc-svg { width: 15px; height: 15px; }
.arc-ip-body { display: flex; flex-direction: column; gap: 0; min-height: 0; flex: 1 1 auto; overflow-y: auto; overscroll-behavior: contain; }
/* 滚动条：Arc emoji 网格是 AppKit NSScrollView（space-icon-picker.md §1 scrollView）= 系统细滚动条、仅滚动时出现；具体宽度 / 颜色 ⛔ 源码未找到 → 用细滚动条 + 半透明前景色 */
.arc-ip-body, .arc-ip-emoji { scrollbar-width: thin; scrollbar-color: color-mix(in srgb, var(--arc-fg) 25%, transparent) transparent; }
.arc-ip-grid { display: grid; grid-template-columns: repeat(8, 30px); grid-auto-rows: 30px; row-gap: 2px; justify-content: space-evenly; }
.arc-ip-icons { height: calc(7 * 32px); flex: none; align-content: start; } /* Icon 页 56 = 8×7，Arc 固定高度不滚动（272×272）；视口不够时由外层 body 滚动 */
.arc-ip-emoji { height: 190px; flex: 1 1 190px; min-height: 64px; overflow-y: auto; overscroll-behavior: contain; align-content: start; }
.arc-ip-cell { width: 30px; height: 30px; border: 0; border-radius: 4px; background: transparent; color: var(--ip-ic); font-size: 20px; line-height: 1; display: grid; place-items: center; cursor: pointer; padding: 0; box-shadow: none; outline: none; }
.arc-ip-cell > .arc-sym { width: 14px; height: 14px; }
.arc-ip-cell:hover { background: color-mix(in srgb, var(--ip-ic) 10%, transparent); }
.arc-ip-cell.on { background: color-mix(in srgb, var(--ip-ic) 25%, transparent); }
.arc-ip-cat { grid-column: 1 / -1; font-size: 11px; font-weight: 600; color: var(--arc-muted); padding: 6px 4px 2px; height: auto; }
.arc-ip-searchrow { display: flex; gap: 6px; align-items: center; position: relative; padding: 0 4px; }
.arc-ip-search { flex: 1; min-width: 0; height: 24px; border-radius: 6px; border: 0; padding: 0 8px; font: inherit; font-size: 12px; color: var(--arc-fg); background: color-mix(in srgb, var(--arc-fg) 8%, transparent); outline: none; }
.arc-ip-search:placeholder-shown::-webkit-search-cancel-button { display: none; } /* 同 52141：空时不给清除按钮留位，占位文字不被截断 */
.arc-ip-tone { width: 24px; height: 24px; border: 0; border-radius: 4px; background: transparent; font-size: 15px; cursor: pointer; padding: 0; }
.arc-ip-tones { position: absolute; right: 0; top: 28px; z-index: 2; width: 198px; height: 38px; box-sizing: border-box; display: flex; justify-content: space-evenly; align-items: center; border-radius: 8px; background: var(--arc-pop-solid) /* ⛔ Rea 无值 */; box-shadow: var(--arc-pop-shadow); }
.arc-ip-tones .arc-ip-cell { font-size: 16px; }
.arc-ip-cats { display: flex; justify-content: space-between; padding: 6px 4px 0; }
.arc-ip-searchrow { margin-bottom: 6px; }
.arc-ip-catbtn { flex: 1; height: 22px; border: 0; border-radius: 4px; background: transparent; font-size: 13px; cursor: pointer; padding: 0; filter: grayscale(1); opacity: .7; }
.arc-ip-catbtn:hover { opacity: 1; background: color-mix(in srgb, var(--ip-ic) 10%, transparent); }
.arc-icon-picker::after { content: ""; position: absolute; left: calc(var(--ip-ax, 20px) - 7px); border: 7px solid transparent; }
.arc-icon-picker[data-arrow="top"]::after { top: -14px; border-bottom-color: var(--arc-pop-solid) /* ⛔ */; }
.arc-icon-picker[data-arrow="bottom"]::after { bottom: -14px; border-top-color: var(--arc-pop-solid) /* ⛔ */; }
.arc-space-dot > .arc-sym, .arc-space-icon > .arc-sym, .arc-manage-icon > .arc-sym, .arc-lib-space-ic > .arc-sym { display: block; }
.arc-emoji-grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 2px; }
.arc-emoji { height: 34px; border: 0; border-radius: 8px; background: transparent; font-size: 18px; cursor: pointer; }
.arc-emoji:hover { background: var(--arc-hover); }
.arc-emoji.on { background: var(--arc-selected); box-shadow: inset 0 0 0 1.5px var(--arc-accent); }
.arc-swatches { display: grid; grid-template-columns: repeat(9, 1fr); gap: 4px; padding: 2px 0 4px; }
.arc-swatch { width: 22px; height: 22px; border-radius: 50%; border: 0; padding: 0; background: var(--sw); cursor: pointer; justify-self: center; box-shadow: inset 0 0 0 1px rgb(0 0 0 / .12); transition: transform var(--arc-t-fast) var(--arc-ease); }
.arc-swatch:hover { transform: scale(1.1); }
.arc-swatch.on { box-shadow: 0 0 0 2px var(--arc-menu), 0 0 0 3.5px var(--sw); }
.arc-chip { border: 0; border-radius: 7px; padding: 4px 9px; font-size: 12px; background: var(--arc-hover); color: var(--arc-fg); cursor: pointer; }
.arc-chip.on { background: color-mix(in srgb, var(--arc-accent) 28%, transparent); }

/* 管理空间浮层 */
.arc-manage { display: flex; flex-direction: column; gap: 2px; padding: 4px; }
.arc-manage-row { display: flex; align-items: center; gap: 8px; height: 38px; padding: 4px 8px; border-radius: 9px; } /* padding (4,8,4,8)：堆栈 edgeInsets (4,8,4,8)（audit-52193-answers.md #31）；controlsView 在卡片里的位置 ⛔ 源码未找到 */
.arc-manage-row:hover { background: var(--arc-hover); }
.arc-manage-row.drop { box-shadow: inset 0 2px 0 var(--arc-accent); }
/* 行内三项统一为 28px 高的 flex 盒并居中：原来 grip / 名称是行内文本（高 15 / 18，按基线排），与 28 的图标按钮上下沿不齐 */
.arc-manage-row > * { flex: none; box-sizing: border-box; height: 28px; margin: 0; display: inline-flex; align-items: center; }
/* Manage Spaces 拖动把手（Arc SpaceManagementDrggerView，HoverableView 子类；audit-52193-answers.md #31）：28×28 视图，16×16 template 图居中；
 * 悬停：cornerRadius 6，背景 GrayA4（浅 #000 α.071 / 深 #FFF α.077，arc-colors-all.tsv L705 / L788）；不悬停 clear；图标悬停不变色；光标 openHand = grab。
 * 图标着色 ⛔ 源码未找到（template 图用 AppKit 默认着色，Arc 未设 contentTintColor / alpha）→ 当前文字色；hover 动画 ⛔（grabberHoverAnimationDuration 所属类型未找到） */
.arc-manage-grip { --arc-grip-hover: rgb(0 0 0 / .071); width: 28px; border-radius: 6px; justify-content: center; color: inherit; cursor: grab; background: transparent; }
:root[data-theme="dark"] .arc-manage-grip { --arc-grip-hover: rgb(255 255 255 / .077); }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .arc-manage-grip { --arc-grip-hover: rgb(255 255 255 / .077); } }
.arc-manage-grip:hover { background: var(--arc-grip-hover); }
.arc-manage-grip > .arc-svg { width: 16px; height: 16px; flex: none; }
/* B-07 的侧栏 Space 标题拖动把手已移除：Rea（space-header-idle.md §3.2）Space 标题行没有拖拽手柄；“Drag to Reorder Space” 只在 Manage Spaces（上面的 .arc-manage-grip）。 */
.arc-manage-icon { width: 28px; height: 28px; padding: 0; border: 0; border-radius: 8px; background: transparent; display: grid; place-items: center; font-size: 16px; cursor: pointer; }
.arc-manage-icon:hover { background: var(--arc-hover); }
.arc-manage-icon:empty::before { content: ""; width: 9px; height: 9px; border-radius: 50%; background: var(--arc-space-c, var(--arc-accent)); }
.arc-manage-row > .arc-manage-name { flex: 1; min-width: 0; display: block; line-height: 28px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13.5px; }
.arc-manage-new { margin-top: 6px; align-self: flex-start; display: inline-flex; gap: 6px; align-items: center; }

/* 底部空间切换：非当前空间是灰色小图标，当前空间全彩放大，下方有主题色小点 */
.arc-space-bar { display: flex; gap: 2px; align-items: center; justify-content: center; overflow-x: auto; scrollbar-width: none; max-width: 100%; }
.arc-space-bar::-webkit-scrollbar { display: none; }
.arc-space-dot {
  position: relative; flex: none; width: 28px; height: 28px; border: 0; padding: 0; border-radius: 50%; background: transparent;
  display: grid; place-items: center; font-size: 14px; line-height: 1; cursor: pointer;
  filter: grayscale(1); opacity: .45; transform: scale(.82);
  transition: opacity var(--arc-t) var(--arc-ease), transform var(--arc-t) var(--arc-spring), filter var(--arc-t) var(--arc-ease), background var(--arc-t-fast);
}
.arc-space-dot:hover { opacity: .85; filter: none; background: var(--arc-hover); }
.arc-space-dot.active { opacity: 1; filter: none; transform: none; }
/* 未设置图标的空间：显示该空间颜色的小圆点（不用 emoji 兜底） */
.arc-space-dot[data-color="blue"], .arc-space-title[data-color="blue"], .arc-manage-icon[data-color="blue"] { --arc-space-c: #4c8bf5; }
.arc-space-dot[data-color="purple"], .arc-space-title[data-color="purple"], .arc-manage-icon[data-color="purple"] { --arc-space-c: #9b6cf0; }
.arc-space-dot[data-color="pink"], .arc-space-title[data-color="pink"], .arc-manage-icon[data-color="pink"] { --arc-space-c: #ec6fb4; }
.arc-space-dot[data-color="red"], .arc-space-title[data-color="red"], .arc-manage-icon[data-color="red"] { --arc-space-c: #e5534b; }
.arc-space-dot[data-color="orange"], .arc-space-title[data-color="orange"], .arc-manage-icon[data-color="orange"] { --arc-space-c: #f08c3a; }
.arc-space-dot[data-color="yellow"], .arc-space-title[data-color="yellow"], .arc-manage-icon[data-color="yellow"] { --arc-space-c: #e5b93a; }
.arc-space-dot[data-color="green"], .arc-space-title[data-color="green"], .arc-manage-icon[data-color="green"] { --arc-space-c: #4cb27a; }
.arc-space-dot[data-color="cyan"], .arc-space-title[data-color="cyan"], .arc-manage-icon[data-color="cyan"] { --arc-space-c: #3ab8c9; }
.arc-space-dot[data-color="grey"], .arc-space-title[data-color="grey"], .arc-manage-icon[data-color="grey"] { --arc-space-c: #8e8e99; }
.arc-space-icon:empty::before, .arc-space-dot:empty::before { content: ""; width: 8px; height: 8px; border-radius: 50%; background: var(--arc-space-c, var(--arc-accent)); }
.arc-space-icon:empty { display: grid; place-items: center; }
.arc-slot-bottom:has(.arc-plus) .arc-space-new { display: none; }
.arc-space-bar .arc-icon-btn { width: 28px; min-width: 28px; height: 28px; padding: 0; border-radius: 50%; }

/* 收藏：Arc 顶部的大方块网格，每行最多 4 个 */
/* Favorites 网格 —— /workspace/arc-analysis/favorites-grid.md（AppTrayCollectionViewLayout，FUN_101cf72fc）：
 * ✅ 列数 = max(1, min(项目数, 4, floor((avail + 8) / 55)))，格子等宽铺满整行（无最大宽度，最小 47），高 47，间距 8 / 8，圆角 12，上内边距 8；最后一行同宽靠左。
 * ⛔ 再平衡（rows = trunc(n/cols); cols = trunc(n/rows)）可能超过 4 列，可疑 → 不做，硬上限 4；拖入时 n+1 未实现。
 * ⛔ 左右边缘：Rea 推测 8（URL pill 未取到）→ 运行期对齐到实际地址栏 .arc-urlbar 的左右边（favorites/index.ts alignGrid）；无地址栏时 0（= 区块 8px 内边距）。
 * 列数 / 左右内边距由 JS 写内联样式（覆盖 sidepanel.css:403 的 4 列固定 + padding 8）。 */
:root .arc-part .arc-fav-grid { display: grid; grid-template-columns: repeat(var(--fav-cols, 4), minmax(0, 1fr)); gap: 8px; padding: 8px var(--fav-pr, 0px) 10px var(--fav-pl, 0px); }
/* F-03 / F-05（audit-arc-diff-52193；audit-52193-answers.md §2、§27；favorites-tile-shadow-border.md）：
 * 磁贴本身无填充；底色 = 模糊 favicon 图层 α（深 静止 .2 / hover .3；浅 0 / .1）；选中 = 白色填充 α 深 .45 / 浅 .8 + 2pt 选中环（外 r12 / 内 r10）。
 * 阴影 = 磁贴专用 0 1px 2px rgb(0 0 0 / .1)，深浅同值、hover / 选中 / 按下不变；没有描边（原 inset .5px --arc-border 已删）。不动全局 --arc-raise-sm。
 * ⛔ 选中环颜色未追到（暂用 --arc-border）；⛔ isDimmed（模糊层 α 0、选中 ×.5）的触发条件未追到，不实现；⛔ 底色切换动画时长，沿用 --arc-t-fast。 */
.arc-fav-grid { --fav-shadow: 0 1px 2px rgb(0 0 0 / .1); --fav-blur-a: 0; --fav-blur-a-hover: .1; --fav-sel: rgb(255 255 255 / .8); --fav-ring: var(--arc-border); }
:root[data-theme="dark"] .arc-fav-grid { --fav-blur-a: .2; --fav-blur-a-hover: .3; --fav-sel: rgb(255 255 255 / .45); }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .arc-fav-grid { --fav-blur-a: .2; --fav-blur-a-hover: .3; --fav-sel: rgb(255 255 255 / .45); } }
/* 选择器带 :root .arc-fav-grid：压过 static/sidepanel.css:315–317 的 :root .arc-fav-tile 阴影规则（--arc-raise-sm / --arc-raise / --arc-inset；建议删除，见 patches） */
:root .arc-fav-grid .arc-fav-tile {
  position: relative; overflow: hidden;
  height: 47px; min-width: 0; border: 0; border-radius: 12px; /* Rea：高 47、圆角 12（AppTrayItemBackgroundView） */ background: transparent; cursor: pointer;
  display: grid; place-items: center; box-shadow: var(--fav-shadow);
  transition: background var(--arc-t-fast) var(--arc-ease), transform var(--arc-t-fast) var(--arc-ease);
}
/* 模糊底层（fav-tile-blur2；Rea /workspace/arc-analysis/fav-tile-blur.md）。Arc 的图 = 对 favicon 先 CIGaussianBlur radius 5（源图像素、缩放前）再 CIColorControls
 * 饱和度 1.5 / 亮度 +0.05 / 对比度 0.85（§1.3），画进 47×47 画布：绘制边长 = 画布宽 / 5 × renderSize（favicon 16 → 150.4pt，只露出中间约 31%，§1.4），
 * 再由 NSImageView（imageScaling = AxesIndependently）两轴各自拉伸铺满磁贴（§2）；frame = 背景视图 bounds，无 outset / inset，裁剪 = 磁贴的 12 圆角 masksToBounds（§3；磁贴规则里 overflow:hidden + border-radius:12px）。
 * 所以：层 inset:0（不向外多铺）、没有 --fav-blur-r；模糊 / 调色在 favorites/blurFx.ts + index.ts 的内联 SVG 滤镜里（viewBox 64×64 = 源图像素，stdDeviation 5 即“缩放前”），
 * svg 宽高 = renderSize/5 × 100% = 320%（--fav-render: 16，多项磁贴 12 ⛔ 未接），居中，随磁贴宽高两轴各自拉伸（preserveAspectRatio=none）。
 * ⛔ 以上“等价 web 做法”是推出来的（§5.1），不是源码常量，自测框架 / 实机需对照：① 磁贴实际宽高（决定拉伸倍率）；② CIGaussianBlur 外扩量、CIColorControls 内部公式 / 顺序（亮度加法 + 对比度的合成 slope .85 / intercept .1175 是假定）；
 * ③ CIContext() 默认工作色彩空间（线性？）→ 这里 SVG 滤镜用 sRGB 插值，改 linearRGB 差异大；④ favicon 实际像素尺寸（这里按 _favicon 64px）；⑤ 圆角 continuous：CSS 没有，用普通 12px；⑥ 明暗切换是否触发重新生成（Arc 管线里没有主题输入，α 随外观变）。
 * α：深 静止 .2 / hover .3，浅 0 / .1（见上方变量，不变）。动画（§4）：只有“选中且未 dim”的磁贴 hover 才 0.12s 过渡（--fav-blur-t，NSAnimationContext 没设 timingFunction → 用 CSS 默认缓动，AppKit 默认曲线 ⛔，不用 --arc-ease）；
 * 未选中磁贴 hover、外观切换、创建时都瞬时。“选中” = 现有 .active（白色填充那一态）；isDimmed 未追到触发条件，未实现（⛔）；选中磁贴的外观切换这里也会过渡 0.12s，Arc 是瞬时（⛔ 小差异）。
 * 磁贴背景（white × α）只在选中时设置（§3，未选中 nil）：现有规则 .arc-fav-tile 透明、.active 才填 --fav-sel（暗 .45 / 亮 .8），一致，无需改；isDimmed ×.5 未实现。 */
.arc-fav-grid { --fav-blur-t: .12s; --fav-render: 16; }
.arc-fav-blur { position: absolute; inset: 0; opacity: var(--fav-blur-a); pointer-events: none; }
.arc-fav-blur > svg { position: absolute; left: 50%; top: 50%; width: calc(var(--fav-render) * 20%); height: calc(var(--fav-render) * 20%); transform: translate(-50%, -50%); overflow: visible; }
.arc-fav-tile:hover .arc-fav-blur { opacity: var(--fav-blur-a-hover); }
.arc-fav-tile.active .arc-fav-blur { transition: opacity var(--fav-blur-t, .12s); }
.arc-fav-tile > :not(.arc-fav-blur) { position: relative; }
.arc-fav-tile img.arc-fav-empty { width: 14px; height: 14px; border-radius: 0; filter: none; opacity: 1; } /* EmptyFavicon 14×14（资源自带圆角）；尺寸在格内 ⛔ */
.arc-fav-tile img { width: 16px; height: 16px; border-radius: 4px; transition: transform var(--arc-t) var(--arc-spring); }
:root .arc-fav-grid .arc-fav-tile:active:not(.active) { box-shadow: var(--fav-shadow); } /* 按下只缩放（sidepanel.css:406），阴影不变 */
:root .arc-fav-grid .arc-fav-tile.active { background: var(--fav-sel); box-shadow: inset 0 0 0 2px var(--fav-ring), var(--fav-shadow); }
/* 多出项（Favorites 设置 openedStyle，默认关）：已打开磁贴用 hover 底色、未打开降饱和——Arc 没有这一态 */
:root .arc-fav-grid[data-opened-style="true"] .arc-fav-tile.open:not(.active) { background: var(--arc-tile-hover); }
.arc-fav-grid[data-opened-style="true"] .arc-fav-tile:not(.open) img { filter: saturate(.85); opacity: .85; }
/* F-01：favicon regular 16（sidebar-features.md:160 / T-S15 “Icons small 12 / regular 16”）。small 12 ⛔：Arc 何时用 small 没有出处，扩展也没有对应尺寸档，暂不接 */
/* F-02：空状态 = 标题 + 副标题（sidebar-features.md:161、181）；原虚线框无出处已去掉。字号 / 颜色 ⛔ 无出处，沿用 .arc-hint（sidepanel.css:115） */
.arc-fav-grid .arc-hint { grid-column: 1 / -1; padding: 12px 8px; display: flex; flex-direction: column; gap: 2px; }
/* H-02：深色颗粒层（static/sidepanel.css:279–282 的 body::after）默认关，Themes 设置 darkGrain 打开时根元素 data-dark-grain="true" */
:root:not([data-dark-grain="true"]) body::after { display: none; }
/* B-10：Space 切换器的 SF 图标 regular 14 / 紧凑 12（space-switcher.md:17，同 emoji；spaceManager/index.ts 传 14） */
:root .arc-space-bar.compact .arc-space-dot svg.arc-sym { width: 12px; height: 12px; }

/* 空间切换滑动（spaces 功能按方向给 #app 加类） */
#app.arc-swipe-next .arc-scroll, #app.arc-swipe-next .arc-slot-favorites ~ .arc-scroll { animation: arc-swipe-next var(--arc-t-slow) var(--arc-ease); }
#app.arc-swipe-prev .arc-scroll { animation: arc-swipe-prev var(--arc-t-slow) var(--arc-ease); }
@keyframes arc-swipe-next { from { opacity: 0; transform: translateX(28px); } }
@keyframes arc-swipe-prev { from { opacity: 0; transform: translateX(-28px); } }

/* 自定义主题选择器（移植自 Zen 的 zen-gradient-generator.css，按 Arc 的“Edit Theme Color…”排版；单色、克制） */
.arc-menu.arc-panel.arc-theme-picker { flex-shrink: 0; width: min(300px, calc(100vw - 16px)); padding: 8px; gap: 10px; border-radius: 16px; display: flex; flex-direction: column; }
.arc-tp-plane { flex: none; position: relative; aspect-ratio: 1; border-radius: 10px; overflow: hidden; cursor: crosshair; touch-action: none;
  background-color: color-mix(in srgb, var(--arc-fg) 4%, transparent);
  background-image: radial-gradient(color-mix(in srgb, var(--arc-fg) 13%, transparent) 1px, transparent 0); background-size: 6px 6px; background-position: -2px -2px; }
.arc-tp-scheme { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); display: flex; gap: 8px; z-index: 3; }
.arc-tp-actions { position: absolute; bottom: 10px; left: 50%; transform: translateX(-50%); display: flex; gap: 14px; z-index: 3; }
.arc-tp-iconbtn { all: unset; box-sizing: border-box; width: 30px; height: 30px; border-radius: 8px; display: grid; place-items: center; cursor: pointer;
  color: color-mix(in srgb, var(--arc-fg) 70%, transparent); transition: background var(--arc-t-fast), color var(--arc-t-fast); }
.arc-tp-iconbtn svg { width: 17px; height: 17px; }
.arc-tp-iconbtn:hover:not(:disabled), .arc-tp-iconbtn.on { background: color-mix(in srgb, var(--arc-fg) 10%, transparent); color: var(--arc-fg); }
.arc-tp-iconbtn:disabled { opacity: 1; cursor: default; color: var(--arc-disabled-text); }
.arc-tp-actions .arc-tp-iconbtn { color: color-mix(in srgb, var(--arc-fg) 45%, transparent); }
.arc-tp-hint { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); margin: 0; font-size: 12.5px; font-weight: 600; white-space: nowrap; pointer-events: none; color: var(--arc-fg); }
.arc-tp-dots { position: absolute; inset: 0; pointer-events: none; }
.arc-tp-dot { position: absolute; width: 18px; height: 18px; border-radius: 50%; background: var(--dot); border: 3px solid #fff; transform: translate(-50%, -50%);
  box-shadow: 0 1px 4px rgb(0 0 0 / .3); transition: left .35s var(--arc-spring), top .35s var(--arc-spring); }
.arc-tp-dot.primary { width: 34px; height: 34px; border-width: 5px; z-index: 2; }
.arc-tp-plane.dragging .arc-tp-dot { transition: none; }
.arc-tp-plane.dragging .arc-tp-dot.primary { transform: translate(-50%, -50%) scale(1.12); }
.arc-tp-swatches { display: flex; align-items: center; justify-content: space-between; gap: 2px; }
.arc-tp-page { width: 22px; height: 21px; } /* 与色块同高（21），整行盒子一致、居中 */
.arc-tp-swatches > * { flex: none; box-sizing: border-box; vertical-align: middle; }
.arc-tp-swatch { all: unset; width: 21px; height: 21px; border-radius: 50%; background: var(--sw); cursor: pointer; box-shadow: inset 0 0 0 1px rgb(0 0 0 / .12); transition: transform var(--arc-t-fast) var(--arc-ease); }
.arc-tp-swatch:hover { transform: scale(1.12); }
.arc-tp-bottom { display: flex; align-items: center; gap: 12px; padding: 2px 2px 4px; }
.arc-tp-wave { position: relative; flex: 1; height: 36px; display: flex; align-items: center; }
.arc-tp-wave::before { content: ""; position: absolute; left: 0; right: 0; top: 50%; height: 16px; transform: translateY(-50%); border-radius: 999px; background: color-mix(in srgb, var(--arc-fg) 9%, transparent); }
.arc-tp-wave svg { position: relative; width: 100%; height: 30px; overflow: visible; pointer-events: none; }
.arc-tp-wave path { fill: none; stroke-linecap: round; stroke-width: 5; vector-effect: non-scaling-stroke; }
.arc-tp-wave .arc-tp-wave-on { stroke: color-mix(in srgb, var(--arc-fg) 55%, transparent); }
.arc-tp-wave .arc-tp-wave-off { stroke: color-mix(in srgb, var(--arc-fg) 20%, transparent); }
.arc-tp-range { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: pointer; }
.arc-tp-dial { position: relative; width: 66px; height: 66px; flex: none; cursor: grab; touch-action: none; border-radius: 50%; outline: none; }
.arc-tp-dial:focus-visible { box-shadow: 0 0 0 2px color-mix(in srgb, var(--arc-fg) 30%, transparent); }
.arc-tp-dial::after { content: ""; position: absolute; inset: 15px; border-radius: 50%; border: 1px solid color-mix(in srgb, var(--arc-fg) 35%, transparent);
  background: linear-gradient(-45deg, transparent -10%, color-mix(in srgb, var(--arc-fg) 8%, transparent) 110%); }
.arc-tp-ring-dot { position: absolute; width: 4px; height: 4px; border-radius: 50%; transform: translate(-50%, -50%); background: color-mix(in srgb, var(--arc-fg) 30%, transparent); }
.arc-tp-ring-dot.on { background: color-mix(in srgb, var(--arc-fg) 62%, transparent); }
.arc-tp-handle { position: absolute; width: 5px; height: 11px; border-radius: 2px; background: color-mix(in srgb, var(--arc-fg) 80%, transparent); z-index: 2; pointer-events: none; }
`;

/* 插件组 Tabs 的样式：固定区、文件夹、Today 区（新标签 / 清空）、多选条、自动归档提示 */
export default /* css */ `
/* 行 pitch（Rea space-header-layout.md §3：sidebarItem 行高 40 = hover/选中盒 36 + 上下各 2（行 margin，static/sidepanel.css:403），NSTableView intercellSpacing 1 → 盒 pitch 41）。
 * --arc-row-gap = intercell 1：定义在这里（tabs 样式），不碰共享 static/sidepanel.css；固定区 .arc-pinned 本来就是 gap 1px（= 41），不改。⛔ 盒在 40 高行里的 y（按 margin 居中是推断）。 */
:root { --arc-row-gap: 1px; }
.arc-pinned { display: flex; flex-direction: column; gap: 1px; min-height: 8px; }
.arc-pinned .arc-hint { border: 1px dashed var(--arc-divider); border-radius: var(--arc-r); margin: 2px 0; }
.arc-slot-pinned .arc-divider { margin: 8px var(--arc-pad-x) 6px; }

.arc-folder-head { font-weight: 500; }
/* ListHeader.folderIconSize = 17×17（unconfirmed-values-verified.md §8，@0x102a25a10）；图标 = FolderIconView 代码绘制（见下）；颜色实际值 ⛔ */
.arc-folder-icon { width: 17px; height: 17px; flex: none; display: grid; place-items: center; color: var(--arc-muted); }
.arc-folder-head:hover .arc-folder-icon { color: var(--arc-fg); } /* 只影响自定义图标（spaceIconNode）；代码绘制的文件夹颜色见下，不随悬停变 */
/* 审计 52193 D-01：文件夹行图标 = Arc FolderIconView 的代码绘制复刻（icons.ts folderGlyph：back / front 两张 SVG 图层；几何与出处见那里）。
 * 颜色：Arc 取 SemanticColorPalette（stroke = maxContrastColor、后板 = foregroundSecondary、前板 = cutoutColor，folder-icon-search-padding.md §B“颜色”），实际 RGB ⛔ 源码未找到
 * → 按字段语义映射到现有变量：--arc-fg / --arc-muted / --arc-base（非 Arc 取值；cutout 是否等于侧栏底色 ⛔）。图标不随行悬停变色（Arc 的颜色只来自调色板）。
 * 开合 = 同一组图层做 3D 变换（rLH/1016647f4.c）：m34 = −1/350；展开 translateX 3、绕 Y 32°、后板绕 X 28°（锚点左下 (0,1)）、前板容器绕 X −30°；
 * 前板阴影 / 后板阴影 opacity：展开 1 / 1，折叠 0 / 0.2。动画时长 ⛔，不加过渡；锚点（前板）/ 旋转方向约定 ⛔，按 CSS 字面。 */
.arc-folder-glyph { --arc-folder-stroke: var(--arc-fg); --arc-folder-back: var(--arc-muted); --arc-folder-front: var(--arc-base); position: relative; display: block; flex: none; }
.arc-folder-glyph > svg { position: absolute; left: 0; overflow: visible; display: block; }
.arc-folder-glyph > .arc-fg-back { top: 0; transform-origin: 0 100%; }
.arc-folder-glyph > .arc-fg-front { top: var(--fg-top, 4px); transform-origin: 50% 50%; }
.arc-fg-back-fill { fill: var(--arc-folder-back); stroke: var(--arc-folder-stroke); }
.arc-fg-front-fill { fill: var(--arc-folder-front); stroke: var(--arc-folder-stroke); }
.arc-fg-shade { stroke: none; }
.arc-fg-bshade { opacity: .2; }
.arc-fg-fshade { opacity: 0; }
.arc-folder-glyph[data-open="true"] > .arc-fg-back { transform: perspective(350px) translateX(3px) rotateY(32deg) rotateX(28deg); }
.arc-folder-glyph[data-open="true"] > .arc-fg-front { transform: perspective(350px) translateX(3px) rotateY(32deg) rotateX(-30deg); }
.arc-folder-glyph[data-open="true"] .arc-fg-shade { opacity: 1; }

/* 今日：Arc 的 “+ New Tab” 行与右侧 “Clear” */
/* Today 标题行：arc-analysis/clear-button.md。分隔线 → 插件按钮 → Clear；左右 18 */
.arc-today-head { display: flex; align-items: center; gap: 8px /* stack spacing ⛔ 源码未找到，候选 8 */; padding: 0 calc(18px - 8px); height: 16px; min-height: 16px; box-sizing: border-box; } /* edge insets 0/18/0/18 距侧栏边：#app 已有左右 8（sidepanel.css:79），这里只补 10 → 分隔线与其它行内容同在 18 起（52003 为 8+18=26）；sectionDividerCellHeight 16 */
.arc-today-sep { flex: 1; min-width: 0; height: .5px; background: rgb(0 0 0/.15); } /* DividerLineHeight 0.5；颜色 SidebarSeparator T-C10 浅 #000 α.15 / 深 #FFF α.15（sidebar-features.md §4.2、T-C10）；原 var(--arc-sep) 未定义 */
:root[data-theme="dark"] .arc-today-sep { background: rgb(255 255 255/.15); }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .arc-today-sep { background: rgb(255 255 255/.15); } }
:root[data-bb-dark="1"] .arc-today-sep { background: rgb(255 255 255/.15); } :root[data-bb-dark="0"] .arc-today-sep { background: rgb(0 0 0/.15); } /* 实际色调优先（ToneProbe） */
/* Arc 只有这一条分隔线：有 Today 分隔线行时隐藏固定区自带的那条 */
.arc-slot-pinned:has(+ .arc-slot-today .arc-today-head) > .arc-part > .arc-divider:last-child { display: none; }
/* Clear 图标 SF arrow.down Bold，字号 = 标签字号（clear-button.md §3；字形已导出 arc-icons/sf/arrow.down_10pt_bold.svg，映射 arrowDownBold 已由 底栏图标与边距 加入） */
/* Clear 字体 = FontSet.sectionHeaderButton 系统 10pt Bold（clear-button.md，Rea 5:49；Tidy 等其他按钮字体 ⛔） */
.arc-today-hbtn.arc-today-clear { font-size: 10px; font-weight: 700; }
/* 箭头只在 clearTabAction = clearAll 时显示；我们的 Clear 清空全部 Today 标签（clearToday）→ clearAll → 显示，tooltip “Clear Today tabs”；设置 clearTabAction 的来源 ⛔ */
.arc-today-clear > .arc-svg { width: 7.837px; height: 9.351px; flex: none; align-self: center; transition: transform .175s; } /* SF arrow.down Bold 10pt 自身宽高比（原 1em×1em 拉成方形）；与文字间距 2（.arc-today-hbtn gap） */
.arc-today-clear.pressed > .arc-svg { transform: translateY(3px); }
.arc-today-clear.pressed > .arc-today-clear-label { transform: none; } /* Arc 只有图标下移 3pt（clear-button.md §3） */
.arc-today-hbtn { display: inline-flex; align-items: center; justify-content: flex-end; gap: 2px; border: 0; padding: 0; margin: 0; background: none !important; border-radius: 0;
  font: inherit; font-size: var(--arc-fs-sm); /* 字号 源码未找到，沿用 */ cursor: default;
  color: rgb(0 0 0/.30); /* ForegroundTertiary */
  opacity: 1; /* 静止即可见（颜色 Tertiary α.30），不隐藏 */ transition: opacity .1s ease-out, color .175s /* 颜色过渡时长 ⛔ 沿用 */; }
:root[data-theme="dark"] .arc-today-hbtn { color: rgb(255 255 255/.30); }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .arc-today-hbtn { color: rgb(255 255 255/.30); } } /* 系统深色（主题“自动”）同样生效 */
/* 显示条件：有可清空的 Today 标签就显示（clear-button.md），静止 α.30、不再悬停才出现 */
.arc-today-hbtn:hover { color: rgb(14 15 16/.90); } /* ForegroundPrimary；布尔触发 ⛔ 推定为 hover；无背景、无圆角 */
:root[data-theme="dark"] .arc-today-hbtn:hover { color: rgb(255 255 255/.80); }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .arc-today-hbtn:hover { color: rgb(255 255 255/.80); } } /* 系统深色（主题“自动”）同样生效 */
/* 按下：ForegroundPrimary × .66（算法 ⛔，按 Primary 的 α 乘 .66：浅 .90×.66=.594，深 .80×.66=.528） */
.arc-today-hbtn.pressed { color: rgb(14 15 16/.594); }
:root[data-theme="dark"] .arc-today-hbtn.pressed { color: rgb(255 255 255/.528); }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .arc-today-hbtn.pressed { color: rgb(255 255 255/.528); } }
/* 实际色调优先（ToneProbe → data-bb-dark，与底栏同一判据）：data-theme 被自适应 / 空间主题改写、与真实底色不一致时，Clear 仍按真实深浅取 Tertiary / Primary（自测 52019：data-theme 被 Adaptive 改回 light，箭头取到浅色 rgba(0,0,0,.3)） */
:root[data-bb-dark="1"] .arc-today-hbtn { color: rgb(255 255 255/.30); }
:root[data-bb-dark="1"] .arc-today-hbtn:hover { color: rgb(255 255 255/.80); }
:root[data-bb-dark="1"] .arc-today-hbtn.pressed { color: rgb(255 255 255/.528); }
:root[data-bb-dark="0"] .arc-today-hbtn { color: rgb(0 0 0/.30); }
:root[data-bb-dark="0"] .arc-today-hbtn:hover { color: rgb(14 15 16/.90); }
:root[data-bb-dark="0"] .arc-today-hbtn.pressed { color: rgb(14 15 16/.594); }
.arc-today-hbtn > * { transition: transform .175s; }
.arc-today-hbtn.pressed > * { transform: translateY(3px); }
.arc-today-clear-label { display: inline-block; width: 27.5px; text-align: left; /* 原 right：27.5 宽比 “Clear” 10pt Bold 字形宽约 1.45 多，右对齐把余量放到箭头与字之间（实测 3.45）；左对齐让箭头紧贴字形 2，余量落在右侧 */ letter-spacing: 0; white-space: nowrap; overflow: visible; }
.arc-today-tidy { margin-right: 0; /* 原 6 + gap 8 = 14；stack spacing ⛔ 统一用 gap 8 */ }
.arc-today-tidy .arc-svg { width: 12px; height: 12px; transition: transform .4s cubic-bezier(.34,1.56,.64,1); }
.arc-today-tidy.pressed .arc-svg { transform: translateY(3px) rotate(-25deg); }
.arc-today-hbtn.no-icon { gap: 0; } /* 无图标插件按钮：只有标签，不留间距 / 竖线 */
.arc-today-hbtn.no-icon.pressed > * { transform: none; } /* 按下下移只作用于图标；无图标时标签不动 */
/* Tidy 扫帚（broom-stick 模板图，12pt；颜色继承 .arc-today-hbtn：Tertiary 静止 / Primary 悬停，与 Clear 相同）。
 * 审计 52193 N-01：只在按下时转到 −25°（−0.4363 rad），hover 不转；锚点 (0.6, 1.0)（Rea sidebar-features.md §7.3 L326）。
 * spring 1.5/150/15/8、0.4s 后弹回（同处）：CSS 无弹簧，仍以 linear() 近似欠阻尼回弹（曲线形状为近似值）。只转不下移。 */
.arc-today-hbtn:has(> .arc-svg-broom) > .arc-svg-broom { width: 12px; height: 12px; flex: none; transform-origin: 60% 100%; transform: none; transition: transform .45s linear(0, .22 8%, .62 18%, .95 30%, 1.08 40%, 1.06 50%, 1.01 62%, .99 75%, 1); }
.arc-today-hbtn:has(> .arc-svg-broom).pressed > .arc-svg-broom { transform: rotate(-25deg); }
.arc-today-hbtn.disabled, .arc-today-hbtn:disabled { pointer-events: none; color: var(--arc-disabled-text) !important; opacity: 1; } /* 禁用 = 只改颜色 MenuDisabledText 浅 #ABABAB / 深 #797881（arc-colors-all.tsv:30/37，menus-spec.md:50） */
.arc-today-vrule { width: .5px; align-self: stretch; margin: 3px 0; background: currentColor; }
.arc-newtab {
  flex: 1; width: 100%; /* 51999 修正：独立整行卡片（Arc 结构；button 默认按内容收缩） */ display: flex; align-items: center; gap: var(--arc-gap); height: var(--arc-row-h); padding: 0 var(--arc-pad-x);
  border: 0; background: transparent; color: var(--arc-muted); cursor: pointer; border-radius: var(--arc-r); text-align: left;
  transition: background var(--arc-t-fast) var(--arc-ease), color var(--arc-t-fast);
}
.arc-newtab .arc-svg { width: var(--arc-fav-size); }
/* New Tab「+」：Arc NewTabCellView = SF plus，NSImageSymbolConfiguration(16pt, medium)，图标视图 16×16（ionicons-to-arc.md L17，rIon2/1000104c4.c L25–40）。符号按 pt 取自然大小（plus 16pt medium = 13.086×13.086，ionGlyphs.plusMedium 的 w/h），在 16×16 视图里居中，不会被拉满视图。
 * 原 CSS 把 svg 撑成 16×16 且 viewBox 就是字形外框，字形被放大到 16（+22%），笔画也同比变粗；用 padding 把内容区收回 13.086、整个槽仍是 16×16（左边距 / 文字间距不变）。 */
.arc-newtab > .arc-svg-plusMedium { box-sizing: border-box; padding: calc((var(--arc-fav-size) - 13.086px) / 2); }
/* 52003 修正（Cat / 用户指定）：静止透明，只有悬停才有圆角底。悬停底 = NewTabPageButtonBackground Hovered 浅 #000 α.06 / 深 #FFF α.075（sidebar-features.md T-C13 / sidebar-full-spec.md:38）。
 * 源码的静止值 α.04 / α.0375 与用户指定冲突，按用户指定为透明（已保留差异，待 Rea 确认该色是否只用于侧栏行）。
 * 静止文字 / 图标 = --arc-muted、悬停 = --arc-fg、圆角 --arc-r：⛔源码未找到（sidebar-full-spec.md 变更 #7） */
.arc-newtab { background: transparent; }
.arc-newtab:hover { background: rgb(0 0 0/.06); }
/* New Tab 行颜色（Rea newtab-plus.md §2，Assets.car 解码）：图标 = ForegroundSecondary 浅 #000 α.5 / 深 #FFF α.5；文字 = SidebarForeground 浅 #000 α.3 / 深 #FFF α.45（文字比图标淡）。
 * 原来两者都用 --arc-muted（深色是不透明 #ababab，比 Arc 的白 α.5 亮，也和文字同色）。hover 改前景色 = 之前 Cat/用户指定的值，Rea：Arc ⛔ 未找到 hover 改前景色，保留不动（待 Cat 定）。主题调色板分支 ⛔。 */
.arc-newtab { --nt-text: rgb(0 0 0/.3); --nt-icon: rgb(0 0 0/.5); color: var(--nt-text); }
.arc-newtab > .arc-svg { color: var(--nt-icon); }
.arc-newtab > span { font-size: 14px; } /* Rea newtab-plus.md §4：New Tab 文字 = FontSet.label.withSize(14.0)（FUN_102a25690）；只此一处有源码依据，--arc-fs 与其它标题仍 13（字号 ⛔ 源码未找到）。行高沿用 --arc-text-lh 固定值，行高不变 */
:root[data-theme="dark"] .arc-newtab { --nt-text: rgb(255 255 255/.45); --nt-icon: rgb(255 255 255/.5); }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .arc-newtab { --nt-text: rgb(255 255 255/.45); --nt-icon: rgb(255 255 255/.5); } }
:root .arc-newtab:hover { --nt-text: var(--arc-fg); --nt-icon: var(--arc-fg); }
:root[data-theme="dark"] .arc-newtab:hover { background: rgb(255 255 255/.075); }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .arc-newtab:hover { background: rgb(255 255 255/.075); } }
.arc-today { display: flex; flex-direction: column; gap: var(--arc-row-gap, 1px); }
/* 文件夹头 + 子行：原是块级，相邻行 margin 2+2 折叠成 2（pitch 38）；改 flex 列 + intercell 1 → 41（与固定区一致）。折叠且无子行时 body 为空，display:none 免得 gap 白占 1px。 */
.arc-folder, .arc-folder-body { display: flex; flex-direction: column; gap: var(--arc-row-gap, 1px); }
.arc-folder-body:empty { display: none; }
/* static/sidepanel.css:404 的 .arc-tab + .arc-folder { margin-top: 2px } 是给块级折叠模型用的（folder 头无 margin 时补 2）；文件夹子行改 flex 后不折叠，会在 tab→子文件夹上再多 2（pitch 43）→ 子行容器里清零 */
.arc-folder-body > .arc-tab + .arc-folder { margin-top: 0; }
/* 固定区顶层同理：.arc-pinned 本来就是 flex（gap 1），sidepanel.css:404 的 .arc-tab + .arc-folder { margin-top: 2px } 让 tab → 文件夹 = 2+1+2+2 = 7（pitch 43，Rea 41）→ 清零后 5（41）。:root 前缀让特异性 (0,4,0) 高过共享规则 (0,3,0)，不依赖注入顺序；只作用于 .arc-pinned 的直接子行，其它区域不受影响 */
:root .arc-pinned > .arc-tab + .arc-folder { margin-top: 0; }
/* 新标签行：Rea newTabButton 行高 40（同 sidebarItem，盒 36 居中，⛔）→ margin 2 上下，下面再补 intercell 1（与 Today 首行相接 pitch 41） */
.arc-newtab { margin: calc((var(--arc-row-pitch, 40px) - var(--arc-row-h)) / 2) 0 calc((var(--arc-row-pitch, 40px) - var(--arc-row-h)) / 2 + var(--arc-row-gap, 1px)); }

/* MultiSelect（审计 52193 P-03）：底色 = TabCellBackgroundMutiselected 浅 #000 α.10 / 深 #FAFBFF α.10（Rea sidebar-features.md §0.1 T-C8；§4.1 状态色“多选 Mutiselected”）。
 * 原强调色 14% / 24% + inset 描边已删：Rea 多选态没有描边 / 阴影。多选规则用 :not(.active)，当前标签保持 TabCellBackgroundCurrent 样式。 */
:root .arc-tab.selected:not(.active) { background: rgb(0 0 0/.10); box-shadow: none; }
:root[data-theme="dark"] .arc-tab.selected:not(.active) { background: rgb(250 251 255/.10); }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .arc-tab.selected:not(.active) { background: rgb(250 251 255/.10); } }
:root[data-bb-dark="1"] .arc-tab.selected:not(.active) { background: rgb(250 251 255/.10); } :root[data-bb-dark="0"] .arc-tab.selected:not(.active) { background: rgb(0 0 0/.10); }
/* 多选且为当前标签：不覆盖，沿用 .arc-tab.active（static/sidepanel.css:129、310） */

/* 左图标 hover 副标题（pinned-hover.md §B/O3；取代审计 52193 P-01 的「hover 行标题右移 7」——那个 7 的来源 0x100944eb0 与 CaptureConstants.cornerRadius 同址，绑定错误，
 * 真正的 7 只在「已偏离固定网址 + 指针在左图标区」时出现，是标题行的平移，见 sidebar-features.md §4.1 修正）。
 * data-hz="icon" 由 TabRow 在指针进入图标区（行左缘 → 斜杠左缘）时置位：标题行平移 7（方向 ⛔，取向上，让副标题落在标题下方）、
 * 副标题 alpha 0.5 淡入（单行尾截断，0.1s easeInEaseOut）、右按钮隐藏。副标题字号 / 位置 ⛔ 无数值 → 11px，紧贴标题下方。 */
.arc-tab > .arc-tab-title { transition: transform .1s ease-in-out; }
:root .arc-tab[data-hz="icon"] > .arc-tab-title { transform: translateY(-7px); }
.arc-tab-sub { position: absolute; left: var(--arc-sub-left, 0); right: 6px; /* ⑤ 右界 = 行内容右缘（行 padding-right 6）= 第一行右界；不再用 --arc-sub-width（图标区悬停时 −/✕ 不占位，两行都到最右；pinned-icon-hover.md：副标题 trailing ≤ bodyStack.trailing） */ top: calc(50% - 7px + var(--arc-text-lh, 18px) / 2); height: 14px; line-height: 14px;
  font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; pointer-events: none; opacity: 0; transition: opacity .1s ease-in-out;
  color: color-mix(in srgb, var(--arc-row-fg, currentColor) 50%, transparent); /* ⑥ 行文字色 × 0.5（Rea ✅：palette.title ×0.5；调色板色值本身 ⛔） */ }
:root .arc-tab[data-hz="icon"] > .arc-tab-sub { opacity: 1; }
:root .arc-tab[data-hz="icon"] .arc-tab-close { opacity: 0; pointer-events: none; display: none; } /* rel47 ⑤：−/✕ 隐藏且不占位（Rea ⚠ detachesHiddenViews；第一行 / 第二行右界都延到行内容最右） */
/* 图标区 region0 高亮块（pinned-icon-hover.md 结论 5 / §3，Rea ✅ 色值 / 圆角 / cornerMask；宽 36 ⚠ 推导值 = 2 × 图标容器 minX(10) + 16，源码只有公式 2×minX + 宽，没有常量）。
 * region view = selectionStateView.bounds.insetBy(8,8) = 行卡片（Cat 的 .arc-tab 已是 8 外边距内的卡片，--arc-row-inset），region0 从卡片左缘起 → left 0、整行高。只在偏离行（canResetTab）的图标区悬停时出现（data-hz="icon" 即该条件）。
 * hover 底色 SidebarItemBackground：浅 #0E0F10 α.05 / 深 #FAFBFF α.10；按下 TabCellBackgroundPressed：浅 #0E0F10 α.065 / 深 #FAFBFF α.065；圆角 12；cornerMask：普通行 0xF 四角圆，当前 / 选中行 5 只左两角圆（右侧直）。
 * 深浅色用与 .arc-tab.selected 同一套判定（data-theme / prefers-color-scheme / Adaptive data-bb-dark），不硬编码。 */
:root { --arc-hz-bg: rgb(14 15 16 / .05); --arc-hz-press: rgb(14 15 16 / .065); }
:root[data-theme="dark"] { --arc-hz-bg: rgb(250 251 255 / .10); --arc-hz-press: rgb(250 251 255 / .065); }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --arc-hz-bg: rgb(250 251 255 / .10); --arc-hz-press: rgb(250 251 255 / .065); } }
:root[data-bb-dark="1"] { --arc-hz-bg: rgb(250 251 255 / .10); --arc-hz-press: rgb(250 251 255 / .065); } :root[data-bb-dark="0"] { --arc-hz-bg: rgb(14 15 16 / .05); --arc-hz-press: rgb(14 15 16 / .065); }
:root .arc-tab[data-hz="icon"] { isolation: isolate; }
:root .arc-tab[data-hz="icon"]::before { content: ""; position: absolute; z-index: -1; left: 0; top: 0; bottom: 0; width: 36px; border-radius: 12px; background: var(--arc-hz-bg); pointer-events: none; }
:root .arc-tab[data-hz="icon"]:active::before { background: var(--arc-hz-press); }
:root .arc-tab.active[data-hz="icon"]::before, :root .arc-tab.selected[data-hz="icon"]::before { border-radius: 12px 0 0 12px; }
`;

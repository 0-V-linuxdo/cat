/* 插件组 Library 的样式：媒体控制卡片（Library 浮层本身用核心的 overlay / list / tabs 组件） */
export default /* css */ `
.arc-media {
  display: flex; flex-direction: column; gap: 2px; padding: 6px 6px 4px 10px; margin-bottom: 4px; border-radius: var(--arc-r-lg);
  background: var(--arc-active); animation: arc-pop-in var(--arc-t) var(--arc-ease);
}
.arc-media-row { display: flex; align-items: center; gap: 6px; }
.arc-media-title { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; cursor: pointer; font-weight: 500; -webkit-mask-image: linear-gradient(90deg, transparent, #000 8px, #000 calc(100% - 12px), transparent); }
.arc-media-title[data-marquee="1"] span { display: inline-block; animation: arc-marquee 12s linear infinite; }
.arc-media-title[data-marquee="0"] { text-overflow: ellipsis; -webkit-mask-image: none; } /* M-01：滚动关（默认）= 省略号，无渐隐遮罩 */
.arc-media .arc-icon-btn { height: 26px; min-width: 26px; }
@keyframes arc-marquee { 0%, 20% { transform: translateX(0); } 100% { transform: translateX(-60%); } }
/* Library（Arc）：替换侧边栏内容；左侧窄栏 大图标 + 标签，选中 = 凸起圆角块 + 蓝色图标；底部返回；右侧每个分区一个视图 */
.arc-overlay.arc-overlay-page { inset: 0; border-radius: 0; box-shadow: none; background: var(--arc-base); isolation: isolate; -webkit-backdrop-filter: none; backdrop-filter: none; animation: arc-lib-in var(--arc-t) var(--arc-ease); }
.arc-overlay.arc-overlay-page::before { content: ""; position: absolute; inset: 0; z-index: -1; background: var(--arc-tint); background-attachment: fixed; }
@keyframes arc-lib-in { from { opacity: 0; transform: translateX(-8px); } }
.arc-overlay-page > .arc-overlay-body { padding: 0; overflow: hidden; display: flex; }
.arc-lib { display: flex; min-height: 0; }
.arc-lib-rail { container: lib-rail / inline-size; /* 标签显隐按栏宽（library-entries.md §2：FUN_1026ff5e8 “65.0 < width”） */
  --lib-primary: var(--arc-fg); /* ⛔ Representable.primaryColor 的来源未找到（library-entries.md §2），推测 = 前景色；深浅随 --arc-fg 切换（[data-theme=dark] / 系统深色两路已在 --arc-fg 上） */
  width: 84px; flex: none; display: flex; flex-direction: column; padding: 8px 6px; border-right: 1px solid var(--arc-hairline, var(--arc-border)); background: color-mix(in srgb, var(--arc-fg) 3%, transparent); }
.arc-lib-items { flex: 1; display: flex; flex-direction: column; justify-content: center; gap: 6px; }
.arc-lib-item { all: unset; display: flex; flex-direction: column; align-items: center; gap: 5px; padding: 10px 2px 8px; border-radius: 12px; color: var(--arc-fg); cursor: default; transition: background var(--arc-t-fast); }
.arc-lib-item:hover { background: color-mix(in srgb, var(--lib-primary) 5%, transparent); } /* Color.primary α.05（FUN_1027006c8，library-full-spec.md 变更清单） */
.arc-lib-item:active { background: var(--arc-press, var(--arc-hover)); }
.arc-lib-item:focus-visible { outline: 2px solid color-mix(in srgb, var(--arc-accent) 70%, transparent); }
.arc-lib-ic { display: grid; place-items: center; width: 28px; height: 28px; color: var(--lib-primary); } /* 透明度由 Lottie 按图层设（primary .7/1、secondary 0/1，library-entries.md §2） */
.arc-lib-item.active .arc-lib-ic { color: var(--lib-primary); } /* 选中不变蓝：Arc 按图层名覆盖色，archive.json 写死的 #3134FB 不显示（library-entries.md §3） */
.arc-lib-lbl { font-size: 11px; font-weight: 700; line-height: 1.15; text-align: center; color: var(--lib-primary); opacity: .7; } /* Font.system(11, .bold)、Color.primary 未选中 .7（FUN_1026ff0b0 / FUN_1027003a8） */
.arc-lib-item.active .arc-lib-lbl { opacity: 1; }
@container lib-rail (max-width: 65px) { .arc-lib-lbl { display: none; } } /* 宽 ≤65 不生成 Text；比较的是栏内容宽（84 − 左右 padding 6 = 72 → 显示） */
.arc-lib-item.active { background: color-mix(in srgb, var(--lib-primary) 10%, transparent); box-shadow: none; } /* RoundedRectangle(12)，Color.primary α.10 */
.arc-lib-back { align-self: flex-start; margin: 4px 0 2px 4px; }
.arc-lib-pane { flex: 1; min-width: 0; display: flex; flex-direction: column; container-type: inline-size; }
/* 窄侧栏：Filter 只留图标，把宽度让给搜索框（否则占位文字被截断） */
.arc-lib-top { display: flex; align-items: center; gap: 6px; padding: 8px 8px 4px; min-height: 32px; flex: none; } /* flex:none：栏是 flex 列，原先可被列表压缩到 min-height 32（< 输入框 32 + 上下内边距 12），搜索栏溢出盖住首个分组标题。尺寸 ⛔（archive-page.md §1） */
.arc-lib-heading { font-weight: 600; padding-left: 4px; }
.arc-lib-searchwrap { position: relative; flex: 1; min-width: 0; display: flex; align-items: center; }
.arc-lib-searchwrap > .arc-svg { position: absolute; left: 14.5px; color: var(--arc-muted); pointer-events: none; }
.arc-lib-searchwrap > .arc-svg-search { width: 15px; height: 15px; color: var(--lib-primary); opacity: .4; } /* SF magnifyingglass，resizable frame 15×15，Color.primary α.4（SelectedFilter / PageHeader @0x1026e91d0，ionicons-to-arc.md L20）；调用处 icon("search", 14) 由此覆盖为 15 */
.arc-input.arc-lib-search { min-width: 0; width: 100%; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; padding-left: 44px; padding-right: 10px; border-radius: 10px; } /* 搜索框 = HStack(spacing 10){ 放大镜 15×15 + padding(h 4.5) ; TextField }.padding(.horizontal 10).frame(height 36)（Rea folder-icon-search-padding.md §C，rFB/1026e8570.c L99–169、rIon/1026e91d0.c L165–245）：放大镜 x = 10 + 4.5 = 14.5（上面 left），TextField 起点 x = 10 + (4.5 + 15 + 4.5) + 10 = 44 → padding-left 44；右 = 水平 padding 10。⛔ 源码未找到：文字字形相对 TextField 左缘的 AppKit 内部偏移（plain NSTextField cell / lineFragmentPadding）、背景形状 / 颜色（FUN_1026e2bf0）、搜索框在页头里的外部偏移；高 36（Rea）本补丁未改，仍用 .arc-input 的高，字体 14pt 同 */
.arc-input.arc-lib-search::placeholder { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; } /* 占位符由 libraryView/searchPlaceholder.ts 按页面标题生成（Archive 页恒为 "Search Archive…"，Rea library-search-placeholder.md）；窄栏省略号；尺寸/圆角 ⛔（archive-page.md §1） */
.arc-input.arc-lib-search:placeholder-shown::-webkit-search-cancel-button { display: none; } /* 52086：Chrome 的 type=search 清除按钮为空时也占 ~13px 宽，把占位文字挤成 "Search Arch…"；空时去掉，输入后仍显示。尺寸 ⛔ 不变 */
.arc-lib-filter { all: unset; display: inline-flex; align-items: center; gap: 5px; height: 32px; padding: 0 10px; border-radius: 10px; color: var(--arc-fg); background: var(--arc-tile); box-shadow: inset 0 0 0 .5px var(--arc-border); cursor: default; flex: none; }
.arc-lib-filter:hover { background: var(--arc-tile-hover, var(--arc-hover)); }
.arc-lib-filter.on { color: var(--arc-accent); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--arc-accent) 45%, transparent); }
/* 窄栏：Filter 只留图标、gap 收到 4，把宽度让给搜索框。必须写在 .arc-lib-filter / .arc-lib-top 基础规则之后：同权重时后者胜，原先放在前面导致 padding 0 9 从未生效。⛔ 数值 */
@container (max-width: 260px) { .arc-lib-filter > span { display: none; } .arc-lib-filter { padding: 0 9px; } .arc-lib-top { gap: 4px; } }
.arc-lib-group { font-size: 11px; font-weight: 600; color: var(--arc-muted); padding: 10px 6px 4px; }
/* Arc 归档行（2x 截图实测 ÷2）：行 56 高、悬停高亮圆角 12、左内边距 10；图标方块 24 圆角 6；标题 15 / URL 13；悬停按钮 18 号图标 */
/* 源码未找到（unconfirmed-values-verified.md §1）：行高 56、内边距、圆角 12、图标方块 24 / 6 / 5%、悬停 8%、按钮 28 / 18 / 75%、标题 15/500、URL 13px —— 均为截图实测现值，不是源码值。
 * URL α0.6 = library-full-spec.md §3 Foreground2。 */
/* archive-page.md §8 ContentCell 列表分支（FUN_1026d2f04 L424–502）：HStack .center，leading/trailing padding 12，frame height 56，RoundedRectangle 12 continuous；
 * 背景 Color.primary.opacity(高亮 ? .1 : 0)，高亮 = hover || isSelected（hover 与选中相同）。元素间水平 gap 10 ⛔ 源码未找到（HStack spacing 不可见） */
.arc-lib-row { display: flex; flex-direction: row; align-items: center; gap: 10px; min-height: 56px; padding: 0 12px; border-radius: 12px; background: transparent; cursor: default; transition: background var(--arc-t-fast); box-sizing: border-box; }
.arc-lib-row:hover, .arc-lib-row:focus-visible, .arc-lib-row.current { background: color-mix(in srgb, var(--arc-fg) 10%, transparent); box-shadow: none; outline: none; }
.arc-lib-row:active { background: var(--arc-press, var(--arc-hover)); } /* 按下态 ⛔ 源码未找到（保留原值） */
/* §4/§8 rightAccessory FUN_10270a498：HStack spacing 2，高亮时 66×32 α1，否则宽 0 α0；isScrolling 时不显示（集成需在 .arc-lib-list 滚动时切 .scrolling 类）。按钮 28×28 ⛔ */
.arc-lib-acts { display: flex; flex-direction: row; align-items: center; gap: 2px; width: 0; height: 32px; opacity: 0; overflow: hidden; flex: none; }
.arc-lib-row:hover .arc-lib-acts, .arc-lib-row:focus-within .arc-lib-acts, .arc-lib-row.current .arc-lib-acts { width: 66px; opacity: 1; }
.arc-lib-list.scrolling .arc-lib-acts { width: 0; opacity: 0; }
.arc-lib-row .arc-lib-act { width: 0; height: 28px; opacity: 0; overflow: hidden; flex: none; color: color-mix(in srgb, var(--arc-fg) 75%, transparent); } /* 色 ⛔ */
.arc-lib-row:hover .arc-lib-act, .arc-lib-row:focus-within .arc-lib-act, .arc-lib-row.current .arc-lib-act { width: 28px; opacity: 1; }
.arc-lib-space-ic { width: 24px; height: 24px; display: grid; place-items: center; border-radius: 6px; background: color-mix(in srgb, var(--sc, var(--arc-accent)) 22%, transparent); font-size: 13px; flex: none; }
/* 迷你播放器按钮（MediaControlsFeature.MiniPlayerView，AssetButton.body @0x1024963e4，见 arc-icons/sf/MAPPING.md）：
 * 图标框 16×16，字形按自身 pt 尺寸居中（超出框的宽字形如 video.fill 允许溢出，不缩放）；音量按钮外加 24×24 框（媒体行第 4 个按钮）。
 * AssetButton（FUN_1024963e4）无 background / 圆角 / contentShape / padding（MAPPING.md「MiniPlayer 补充」）。
 * 命中区、hover/pressed 背景与圆角、按钮间距 ⛔ 源码未找到 → 保留现有值（26px 按钮、gap 6px、通用 .arc-icon-btn hover）。 */
.arc-media .arc-icon-btn { display: inline-grid; grid-template: 16px / 16px; place-content: center; place-items: center; padding: 0; }
/* 前景 PlaybackControlForeground（ARC_MediaControlsFeature，sidebar-features.md T-C26）：浅 #000 α.5 / 深 #FFF α.66 */
.arc-media .arc-icon-btn { color: rgb(0 0 0/.5); }
:root[data-theme="dark"] .arc-media .arc-icon-btn { color: rgb(255 255 255/.66); }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .arc-media .arc-icon-btn { color: rgb(255 255 255/.66); } }
.arc-media .arc-icon-btn > .arc-svg { margin: 0; overflow: visible; }
.arc-media-row:has(> button:nth-of-type(5)) > button:nth-of-type(4) { grid-template: 24px / 24px; }
`;

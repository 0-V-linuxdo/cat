/* 插件组 Command 的样式：命令栏（Arc 的 ⌘T 大输入框 + 结果列表）、底栏 ＋ 菜单、快捷键编辑 */
export default /* css */ `
.arc-overlay[data-overlay="commandBar"] { inset: 10px 8px auto; max-height: calc(100% - 20px); border-radius: var(--arc-r-xl); }
.arc-overlay[data-overlay="commandBar"] .arc-overlay-head { position: absolute; top: 8px; right: 8px; padding: 0; z-index: 1; }
.arc-overlay[data-overlay="commandBar"] .arc-overlay-head > span { display: none; }
.arc-overlay[data-overlay="commandBar"] .arc-overlay-body { padding: 6px; }
body.arc-popup .arc-overlay[data-overlay="commandBar"] { inset: 0; max-height: none; border-radius: 0; }
.arc-cmd-input {
  font-size: 17px; letter-spacing: -.01em; height: 48px; padding: 0 44px 0 14px; margin-bottom: 4px;
  background: transparent; box-shadow: none; border-radius: var(--arc-r-lg);
}
.arc-cmd-input:focus { background: transparent; box-shadow: none; }
.arc-cmd-results { border-top: 1px solid var(--arc-divider); padding-top: 6px; }
.arc-cmd-results:empty { display: none; }
/* 命令栏颜色（unconfirmed-values-verified.md §7，ARC_CommandBar.bundle Assets.car / arcdl/colors.tsv）：
 * CommandBarRowHoverBackgroundColor = 浅 #000 α0.05 / 深 #FFF α0.05；CommandBarAccessoryBackgroundColor 同；SecondaryWindowInputBackground = #FAFBFF / #0E0F10。
 * 源码未找到：行高 38、输入框 17px / 48、favicon 18、选中行实色 accent（以下保留现值）。 */
.arc-overlay[data-overlay="commandBar"] { --cb-hover: rgb(0 0 0 / .05); --cb-input: #fafbff; }
:root[data-theme="dark"] .arc-overlay[data-overlay="commandBar"] { --cb-hover: rgb(255 255 255 / .05); --cb-input: #0e0f10; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .arc-overlay[data-overlay="commandBar"] { --cb-hover: rgb(255 255 255 / .05); --cb-input: #0e0f10; } }
.arc-overlay[data-overlay="commandBar"] .arc-cmd-input, .arc-overlay[data-overlay="commandBar"] .arc-cmd-input:focus { background: var(--cb-input); }
.arc-cmd-results .arc-list-row:hover:not(.sel) { background: var(--cb-hover); }
.arc-cmd-results .arc-list-row :is(kbd, .arc-cmd-acc) { background: var(--cb-hover); }
.arc-cmd-results .arc-list-row { min-height: 38px; border-radius: var(--arc-r); }
/* Arc 命令栏：选中行 = 主题色实心圆角块 + 白字（同“+”菜单） */
.arc-cmd-results .arc-list-row.sel { background: var(--arc-accent); color: #fff; }
.arc-cmd-results .arc-list-row.sel :is(small, .arc-svg, .arc-menu-kbd) { color: rgb(255 255 255 / .75); }
.arc-cmd-results .arc-fav { width: 18px; height: 18px; }
.arc-cmd-results .arc-tab-title { -webkit-mask-image: none; mask-image: none; text-overflow: ellipsis; }

.arc-plus { position: relative; }
/* —— “+” 菜单 = ArcMenu 默认 Configuration（/workspace/arc-analysis/menus-spec.md §2，ArcMenu.Configuration.init(width:) @0x101e3adf4）——
 * ✅ menuEdgeInsets 8,8,8,8；menuItemHeight 40；menuItemHorizontalSpacing 8；menuItemImageDimension 24（SF Symbol 20pt Medium）；
 *    menuItemFont systemFont 13 Medium；MenuBackground 浅 #FAFBFF / 深 #393841；MenuText #494949 / #EBEBEC；
 *    MenuHoverBackground #B7D1FF / #3970C5；MenuTextHover #151515 / #FFFFFF；MenuDisabledText #ABABAB / #797881（用颜色不用透明度）；
 *    separatorThickness 1、separatorInsets 8,4,8,4（上左下右）、MenuSeparator #C4C4C4；hideDisclosure=false（显示箭头）。
 * 源码未找到（保留现值，不是源码值）：菜单圆角 12 ⛔、阴影、行圆角 8、行内左右 padding、箭头 12×6、弹出距离 10、出现动画、themeColorView 叠加参数、快捷键字样。 */
.arc-plus-menu {
  --pm-bg: #fafbff; --pm-fg: #494949; --pm-hover: #b7d1ff; --pm-hover-fg: #151515; --pm-dis: #ababab; --pm-sep: #c4c4c4; --pm-sub: #ababab; /* 快捷键灰 = MenuDisabledText */
  position: absolute; bottom: calc(100% + 10px) /* 源码未找到 */; right: -2px; width: max-content; min-width: 210px /* 宽 210（bottom-bar.md） */; max-width: calc(100vw - 8px);
  padding: 6px /* ArcMenu 四边 6（bottom-bar.md §7） */; box-sizing: border-box; border-radius: 12px /* ⛔ */; overflow: visible; transform-origin: bottom right; animation: none /* 动画源码未找到 */;
  background: var(--pm-bg); color: var(--pm-fg); -webkit-backdrop-filter: none; backdrop-filter: none; box-shadow: none /* 审计 52193 B-04：ArcMenu hasShadow=false（Rea sidebar-features.md:110 T-K3；§8.5 L374 “无系统阴影”） */;
  animation: arc-pm-in .1s ease-out;
}
:root[data-theme="dark"] .arc-plus-menu { --pm-bg: #242626 /* 用户指定：对齐 Helium（Neutral15，helium-chromium 832faa7）；Arc 源值 #393841 */; --pm-fg: #ebebec; --pm-hover: #3970c5; --pm-hover-fg: #fff; --pm-dis: #797881; --pm-sub: #797881; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .arc-plus-menu { --pm-bg: #242626 /* 用户指定：对齐 Helium（Neutral15，helium-chromium 832faa7）；Arc 源值 #393841 */; --pm-fg: #ebebec; --pm-hover: #3970c5; --pm-hover-fg: #fff; --pm-dis: #797881; --pm-sub: #797881; } }
/* 箭头：尺寸源码未找到 */
.arc-plus-menu::after { content: ""; position: absolute; right: 12px; bottom: -6px; width: 0; height: 0; border: 6px solid transparent; border-bottom: 0; border-top-color: var(--pm-bg); }
.arc-plus-menu .arc-plus-item { height: 40px; min-height: 40px; padding: 0 8px /* 行左右 8（§7） */; gap: 8px; border-radius: 8px /* 行高亮圆角 8（§7） */; font-size: 13px; font-weight: 500; color: var(--pm-fg); background: transparent; justify-content: flex-start; outline: none; }
.arc-plus-menu .arc-plus-item > .arc-svg { flex: none; width: 24px; height: 24px; padding: 2px; box-sizing: border-box; }
.arc-plus-menu .arc-plus-item:not(.disabled):is(:hover, :focus-visible) { background: var(--pm-hover); color: var(--pm-hover-fg); } /* 高亮仅悬停 / 键盘焦点（MenuHoverBackground #B7D1FF / #3970C5 + MenuTextHover #151515 / #FFFFFF）；打开时 JS 预选 .sel（plusMenu:78）不再上色 */
.arc-plus-menu .arc-plus-item:focus:not(:focus-visible) { outline: none; }
.arc-plus-menu .arc-plus-item.disabled { opacity: 1; color: var(--pm-dis); cursor: default; }
.arc-plus-menu .arc-menu-label { flex: none; }
/* 快捷键：13 Regular、与禁用文字同灰（bottom-bar.md） */
.arc-plus-menu .arc-menu-kbd { margin-left: auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding-left: 16px; font-size: 13px; font-weight: 400; color: var(--pm-sub); letter-spacing: .02em; }
.arc-plus-menu .arc-plus-item:not(.disabled):is(:hover, :focus-visible) .arc-menu-kbd { color: inherit; }
.arc-plus-menu .arc-menu-sep { height: 1px; margin: 8px 4px; background: var(--pm-sep); }
/* “+”→“×”及打开时的按下底色：源码没有（bottom-bar.md），已删除 */

/* Navigation：顶部 后退 / 前进 / 刷新 + 精简地址胶囊（加载中底部进度条） */
.arc-nav { display: flex; align-items: center; gap: 2px; padding: 2px 0 8px; }
.arc-urlbar {
  position: relative; flex: 1; min-width: 0; height: 36px; padding: 0 12px 0 13px; border: 0; border-radius: var(--arc-r);
  background: var(--arc-tile); color: var(--urlbar-fg); font: inherit; font-size: var(--arc-fs-sm); text-align: left; cursor: text;
  display: flex; align-items: center; gap: 6px; overflow: hidden; box-shadow: inset 0 0 0 .5px var(--arc-border);
}
/* 审计 52193 U-03：文字左边距 无图标 13 / 有图标 34（Rea urlbar-icon.md §5 L58–59）。右边距 ⛔ 源码未找到（保留 12）。
 * 有图标时的 34 绑定在下方 .arc-urlbar.has-icon（U-01 命令栏实现）。 */
/* 审计 52193 U-04：文字色 CommandBarPlaceholderText 浅 #000 α.6；占位文字 α.3（Rea sidebar-features.md:146 T-C20）。
 * 深色沿用 --arc-muted / --arc-faint（跟 Helium，审计 U-04 注明不算差异）。占位文字需导航插件给空地址加 .empty（arc-ui/audit52193-6.patch）。 */
.arc-urlbar { --urlbar-fg: rgb(0 0 0/.6); --urlbar-placeholder: rgb(0 0 0/.3); }
:root[data-theme="dark"] .arc-urlbar { --urlbar-fg: var(--arc-muted); --urlbar-placeholder: var(--arc-faint, var(--arc-muted)); }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .arc-urlbar { --urlbar-fg: var(--arc-muted); --urlbar-placeholder: var(--arc-faint, var(--arc-muted)); } }
.arc-urlbar-host.empty { color: var(--urlbar-placeholder); }
.arc-nav > * + .arc-urlbar { margin-left: 4px; } /* 只有前面有后退/前进按钮时才留 4px；默认无按钮 → 左右都 8，与其他区块对齐 */
.arc-urlbar:hover { background: var(--arc-tile-hover); color: var(--arc-fg); }
.arc-urlbar-host { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
/* 左侧图标槽（urlbar-icon.md）：22×22，左缘 7，垂直居中（§1）；有图标时文字左缘 34（§5）。
 * insecureLock 着色 CommandBarPlaceholderIconLockInsecure 浅 #F53714 / 深 #F25E6B（哪个文件对应深色 ⛔，按惯例），α .75；鼠标悬停在图标按钮上 α .95
 * （urlbar-menus-followup.md §2.2，rUB2/1002a2f88.c L95–123：FUN_1009e4dac = HoverableButton.isHovered，强推断，精确符号 ⛔）。按钮 iconOnly：无背景 / 阴影（§3）。
 * iconOnly ✅（rUB/1003adbe4.c L98–103 固定写 iconOnly），22×22（L70–74）。滑入动画（leading -22 → 7）时长 ⛔，且每次重绘都会重播，未做。 */
.arc-urlbar.has-icon { padding-left: 34px; }
.arc-urlbar-icon { all: unset; position: absolute; left: 7px; top: 50%; width: 22px; height: 22px; margin-top: -11px; display: grid; place-items: center; cursor: pointer; }
.arc-urlbar-icon:focus-visible { outline: 2px solid color-mix(in srgb, var(--arc-accent) 70%, transparent); outline-offset: -1px; border-radius: 11px; }
.arc-urlbar-icon.arc-insecure { color: rgb(245 55 20 / .75); }
.arc-urlbar-icon.arc-insecure:hover { color: rgb(245 55 20 / .95); }
:root[data-theme="dark"] .arc-urlbar-icon.arc-insecure { color: rgb(242 94 107 / .75); }
:root[data-theme="dark"] .arc-urlbar-icon.arc-insecure:hover { color: rgb(242 94 107 / .95); }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .arc-urlbar-icon.arc-insecure { color: rgb(242 94 107 / .75); } :root:not([data-theme="light"]) .arc-urlbar-icon.arc-insecure:hover { color: rgb(242 94 107 / .95); } }
/* 地址框右侧操作（Arc）：复制链接 + 站点控制，平时隐藏，悬停 / 聚焦时出现；不安全警告常驻 */
.arc-urlbar-actions { margin-left: auto; display: inline-flex; align-items: center; gap: 2px; margin-right: -6px; flex: none; }
/* 审计 52193 U-05：hover 按钮 28×28 = HoverButtonDimension 28（Rea sidebar-features.md:145 T-S17）；圆角 7 ⛔ 源码未找到（保留） */
.arc-urlbar-btn { all: unset; display: inline-grid; place-items: center; width: 28px; height: 28px; border-radius: 7px; color: var(--arc-muted); cursor: pointer; opacity: 0; transition: opacity var(--arc-t-fast), background var(--arc-t-fast); }
.arc-urlbar:hover .arc-urlbar-btn, .arc-urlbar:focus-within .arc-urlbar-btn { opacity: 1; }
.arc-urlbar-btn:hover { background: var(--arc-hover); color: var(--arc-fg); }
.arc-urlbar-btn:focus-visible { opacity: 1; outline: 2px solid color-mix(in srgb, var(--arc-accent) 70%, transparent); outline-offset: -1px; }

/* 站点控制面板（Arc：地址栏左侧图标） */
.arc-menu.arc-panel.arc-site-controls { width: min(300px, calc(100vw - 16px)); padding: 8px; gap: 6px; border-radius: 14px; display: flex; flex-direction: column; }
.arc-sc-top { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
.arc-sc-action { all: unset; height: 36px; border-radius: 8px; display: grid; place-items: center; cursor: pointer; color: var(--arc-fg); background: color-mix(in srgb, var(--arc-fg) 7%, transparent); box-shadow: inset 0 0 0 .5px color-mix(in srgb, var(--arc-fg) 10%, transparent); }
.arc-sc-action:hover:not(:disabled) { background: color-mix(in srgb, var(--arc-fg) 12%, transparent); }
.arc-sc-action:disabled { opacity: 1; cursor: default; color: var(--arc-disabled-text); } /* MenuDisabledText（全局变量：浅 #ABABAB / 深 #797881，arc-colors-all.tsv:30/37，menus-spec.md:50），只改颜色 */
.arc-sc-label { font-size: 12.5px; font-weight: 600; color: var(--arc-muted); padding: 6px 2px 0; }
.arc-sc-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; max-height: 236px; overflow: auto; }
.arc-sc-ext { all: unset; height: 40px; border-radius: 8px; display: grid; place-items: center; cursor: pointer; background: color-mix(in srgb, var(--arc-fg) 6%, transparent); }
.arc-sc-ext:hover { background: color-mix(in srgb, var(--arc-fg) 12%, transparent); }
.arc-sc-ext img { width: 20px; height: 20px; }
.arc-sc-ext.off img, .arc-sc-ext.off .arc-sc-ext-letter { opacity: .35; filter: grayscale(1); }
.arc-sc-ext-letter { width: 20px; height: 20px; border-radius: 5px; display: grid; place-items: center; font-size: 11px; font-weight: 700; color: #fff; background: hsl(var(--h) 35% 45%); }
.arc-sc-add { color: var(--arc-muted); }
.arc-sc-ext-letter[hidden], .arc-sc-ext[hidden], .arc-sc-search[hidden] { display: none; }
.arc-sc-ext.busy { opacity: .5; pointer-events: none; }
.arc-sc-search { height: 32px; margin: 0 0 2px; font-size: 12.5px; }
.arc-sc-search:placeholder-shown::-webkit-search-cancel-button { display: none; } /* 空时不给 × 留位，占位文字不被截断 */
.arc-sc-rows { display: flex; flex-direction: column; gap: 2px; }
.arc-sc-row { all: unset; display: flex; align-items: center; gap: 10px; padding: 4px 4px; border-radius: 8px; cursor: pointer; }
.arc-sc-row:hover { background: var(--arc-hover); }
.arc-sc-row-icon { width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center; flex: none; color: var(--arc-fg); background: color-mix(in srgb, var(--arc-fg) 12%, transparent); }
.arc-sc-row[data-value="allow"] .arc-sc-row-icon { background: var(--arc-fg); color: var(--arc-pop-solid); }
.arc-sc-row-text { display: flex; flex-direction: column; min-width: 0; font-size: 13px; font-weight: 600; color: var(--arc-fg); }
.arc-sc-row-text small { font-size: 11.5px; font-weight: 500; color: var(--arc-muted); }
.arc-sc-sep { height: 1px; margin: 4px 2px; background: var(--arc-divider); }
.arc-sc-bottom { display: flex; align-items: center; justify-content: space-between; }
.arc-sc-secure { all: unset; display: inline-flex; align-items: center; gap: 5px; height: 28px; padding: 0 10px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; color: var(--arc-fg); background: color-mix(in srgb, var(--arc-fg) 8%, transparent); }
.arc-sc-secure.insecure { color: var(--arc-danger, #d9534f); }
.arc-sc-more { all: unset; width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center; cursor: pointer; color: var(--arc-fg); background: color-mix(in srgb, var(--arc-fg) 8%, transparent); }
.arc-sc-more:hover, .arc-sc-secure:hover { background: color-mix(in srgb, var(--arc-fg) 14%, transparent); }
.arc-urlbar-progress { position: absolute; left: 0; bottom: 0; height: 2px; width: 0; background: var(--arc-accent); opacity: 0; }
/* 审计 52193 多出项 #6：加载进度条 Arc 没有 → 默认关闭；只有 :root[data-urlbar-progress]（Navigation 设置 “loadingBar”，见 arc-ui/audit52193-6.patch）时显示。
 * 元素保留（自测 selftest.ts 以它判断导航区已渲染），关闭时只是不可见。 */
:root[data-urlbar-progress] .arc-urlbar.loading .arc-urlbar-progress { opacity: 1; animation: arc-progress 2.4s cubic-bezier(.1,.6,.3,1) forwards; }
@keyframes arc-progress { from { width: 4%; } to { width: 88%; } }
/* ArcMenu 出现：scale .95→1 0.1s、不透明度 0.05s；消失 0.07s（§7） */
@keyframes arc-pm-in { from { transform: scale(.95); opacity: 0; } 50% { opacity: 1; } to { transform: none; opacity: 1; } }
.arc-plus-menu.closing { transition: opacity .07s; opacity: 0; }
/* 共用 :root .arc-menu（var(--arc-menu) + 毛玻璃）优先级更高，会盖掉 MenuBackground（验收测得 #21223D）→ 这里提高优先级 */
:root .arc-menu.arc-plus-menu { background: var(--pm-bg); -webkit-backdrop-filter: none; backdrop-filter: none; box-shadow: none; } /* box-shadow none：共用 :root .arc-menu 的 --arc-pop-shadow 会盖掉上面的 B-04（T-K3 hasShadow=false） */
:root .arc-menu.arc-plus-menu .arc-menu-sep { height: 1px; margin: 8px 4px; background: var(--pm-sep); }
`;

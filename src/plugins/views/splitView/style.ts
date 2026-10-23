/* SplitView 的样式：分屏页（split.html，page 上下文）——Arc 式圆角面板、细地址栏，跟随浅色 / 深色 */
/* 深浅判定顺序同 ArcTooltip：Space 实际色调 data-bb-dark > data-theme > 系统 prefers-color-scheme（后写的规则优先，特异性相同）。
 * 色值：深色 #1E2020 = Helium kColorSysHeader→Neutral12（chromium sys_color_mixer.cc:88）、#242626 = kColorSysBaseContainer→Neutral15（:236）——
 * 来自 Helium，非 Rea 的 Arc 逆向；Arc 分屏面板 / 地址栏色值 ⛔（arc-analysis 中未找到）。浅色值沿用原值 ⛔。
 * 面板底色（iframe 加载前可见）：浅 #fff / 深 #1E2020 ⛔。 */
export const SPLIT_LIGHT = `--sv-page: #e7e5ee; --sv-pane: #fff; --sv-bar: rgb(255 255 255 / .9); --sv-bar-line: rgb(0 0 0 / .08); --sv-url: rgb(0 0 0 / .05); --sv-url-fg: rgb(20 20 28 / .85); --sv-url-focus: #fff; --sv-btn: rgb(20 20 28 / .5); --sv-btn-hover-bg: rgb(0 0 0 / .06); --sv-btn-hover: rgb(20 20 28 / .9); color-scheme: light;`;
export const SPLIT_DARK = `--sv-page: #1E2020; --sv-pane: #1E2020; --sv-bar: #242626; --sv-bar-line: rgb(255 255 255 / .08); --sv-url: rgb(255 255 255 / .07); --sv-url-fg: rgb(255 255 255 / .85); --sv-url-focus: rgb(255 255 255 / .1); --sv-btn: rgb(255 255 255 / .5); --sv-btn-hover-bg: rgb(255 255 255 / .08); --sv-btn-hover: #fff; color-scheme: dark;`;
export default /* css */ `
html, body { font: 12.5px -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", system-ui, sans-serif; }
:root { ${SPLIT_LIGHT} }
@media (prefers-color-scheme: dark) { :root { ${SPLIT_DARK} } }
:root[data-theme="light"] { ${SPLIT_LIGHT} }
:root[data-theme="dark"] { ${SPLIT_DARK} }
:root[data-bb-dark="0"] { ${SPLIT_LIGHT} }
:root[data-bb-dark="1"] { ${SPLIT_DARK} }
html, body { background: var(--sv-page); }
#split { gap: 8px; padding: 8px; }
.split-pane { background: var(--sv-pane); border-radius: 10px; box-shadow: 0 0 0 .5px rgb(0 0 0 / .12), 0 2px 8px rgb(0 0 0 / .08); transition: box-shadow .2s; }
.split-pane:focus-within { box-shadow: 0 0 0 2px rgb(110 80 230 / .55), 0 4px 14px rgb(0 0 0 / .12); }
.split-bar { gap: 2px; padding: 5px 6px; background: var(--sv-bar); border-bottom: .5px solid var(--sv-bar-line); }
.split-url { border-radius: 7px; padding: 4px 8px; background: var(--sv-url); color: var(--sv-url-fg); font: inherit; outline: none; }
.split-url:focus { background: var(--sv-url-focus); box-shadow: 0 0 0 2px rgb(110 80 230 / .45); }
.split-bar button { width: 24px; height: 24px; border-radius: 6px; color: var(--sv-btn); }
.split-bar button:hover { background: var(--sv-btn-hover-bg); color: var(--sv-btn-hover); }
/* 可拖动的分隔条（替代面板间的固定间距） */
#split { gap: 0 !important; }
.split-gutter { flex: none; position: relative; z-index: 2; }
.split-gutter.row { width: 8px; cursor: col-resize; }
.split-gutter.column { height: 8px; cursor: row-resize; }
.split-gutter::after { content: ""; position: absolute; inset: 0; margin: auto; border-radius: 2px; background: rgb(128 128 128 / .35); opacity: 0; transition: opacity .15s; }
.split-gutter.row::after { width: 3px; height: 32px; }
.split-gutter.column::after { height: 3px; width: 32px; }
.split-gutter:hover::after, #split.resizing .split-gutter::after { opacity: 1; }
#split.resizing iframe { pointer-events: none; }
.split-pane.focused { box-shadow: 0 0 0 1.5px rgb(110 80 230 / .4), 0 2px 8px rgb(0 0 0 / .08); }
`;

/*
 * 层级常量（z-index 唯一来源）。起因：插件设置对话框（options.css .arc-vdialog-scrim，原 z-index 50）盖住了对话框里下拉框的菜单（Menu.ts / sidepanel.css .arc-menu，z-index 20）——
 * 两者都是 <body> 的直接子元素 + position:fixed，处在同一个根层叠上下文里，谁的 z-index 大谁在上，菜单（20）整个落在遮罩 + 对话框（50）后面，点不到也看不见。
 *
 * 三个世界各有一套层级，不要混用：
 *   1) 扩展页（sidepanel.html / options.html / split.html …）：同一个文档里弹层的先后次序 → Z（下面）。
 *   2) 网页里的内容脚本 UI（页内侧栏宿主、截取覆盖层、Zap、Peek 工具条、配色层）：CSS 上限 2147483647，宿主页面里没有比它更高的层 → PAGE_Z_MAX。
 *      同值时按 DOM 顺序（后插入的在上），无法再细分 → 层间次序只能靠插入顺序（见 README「层级关系表」）。
 *   3) 页内侧栏 shadow root 内部的相对次序 → INPAGE_LAYERS（同值 = 原 host.css.ts 的数字，只是改成有名字的常量）。
 *
 * 值说明：10 / 20 / 21 / 30 / 2147483000 镜像共享的 static/sidepanel.css（本文件不能改它）；tests/zLayersDialog.test.ts 逐条断言两边相等，改一边忘了另一边会红。
 * 15 与 60 / 1000：数值本身 ⛔ 源码未找到（Arc 是原生窗口层级，没有 z-index；Rea 的分析里没有对应数值），取「次序正确的最小改动」：
 *   对话框遮罩只需 < 菜单（20）、> 页面内容（options 页里没有任何 z-index）→ 15；确认框 60（原值）、行内重命名输入框 1000（原值）不动。
 * 新增弹层先在这里加一个有名字的值、写明它盖住谁 / 被谁盖住，再用；不要在别处写裸的 z-index 数字（tests/zLayersNoMagic.test.ts）。
 */
export const Z = {
    /** 命令栏 / Library / 侧栏设置浮层（sidepanel.css .arc-overlay） */
    overlay: 10,
    /** 设置页「插件配置」对话框遮罩（options.css .arc-vdialog-scrim）。必须 < menu：对话框里的下拉菜单要盖在对话框上。⛔ 数值无来源（原 50 是 bug） */
    dialog: 15,
    /** 右键菜单 / 下拉框菜单（sidepanel.css .arc-menu） */
    menu: 20,
    /** 子菜单（sidepanel.css .arc-submenu） */
    submenu: 21,
    /** Toast（sidepanel.css .arc-toast）：要盖住 dialog，设置对话框里的校验 / 「已恢复默认」提示才看得见 */
    toast: 30,
    /** 侧栏内确认 / 输入对话框（Dialog.ts .arc-dlg-mask）：盖住一切弹层（它由菜单项触发，菜单已先关闭） */
    confirm: 60,
    /** 标签行内联重命名输入框（TabRow.ts，position:fixed 在 body 下） */
    inlineEdit: 1000,
    /** 深色模式的噪点层（sidepanel.css body::after，pointer-events:none，盖在所有 UI 上但在 tooltip 下） */
    grain: 2147483000,
    /** 悬停提示（ArcTooltip.ts，文件已冻结，值由测试对齐） */
    tooltip: 2147483647,
} as const;

/** 扩展页里层级由低到高的顺序（测试断言严格递增） */
export const Z_ORDER = ["overlay", "dialog", "menu", "submenu", "toast", "confirm", "inlineEdit", "grain", "tooltip"] as const satisfies readonly (keyof typeof Z)[];

/** 网页里的内容脚本 UI（宿主页面中的最高层；CSS z-index 的 32 位上限） */
export const PAGE_Z_MAX = 2147483647;

/** 页内侧栏 shadow root 内部（host.css.ts）：保持层 / 触发条 < 容器 < 把手 / 提示 < 拖拽遮罩（对应 Arc 浮出容器 6 < resize 区 7，见 host.css.ts 头注释） */
export const INPAGE_LAYERS = { hold: 0, trigger: 0, box: 1, handle: 2, hint: 2, mask: 3 } as const;

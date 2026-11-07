/* 页内侧边栏：常量。Arc 值与网页近似的来源见 DESIGN.md 5.2.1 / 5.2.2；⛔ = 未知占位，⚠ = 网页近似 / 待实测。 */

/** 插件名（PascalCase，与 PLUGIN_CARD_ICON / 设置路径 plugins.InpageSidebar.* 一致；目录 inpageSidebar、存储键 data:inpageSidebar） */
export const NAME = "InpageSidebar";
export const STORE_KEY = "inpageSidebar";

export const HOST_ID = "arc-inpage-sidebar-host";
/** 内容脚本 ↔ 后台 的长连接（L1 端口注册） */
export const PORT_NAME = "inpage:host";
/** 菜单 id 前缀：顶层 contextMenus.onClicked 监听只认这个前缀（避免吞别的插件的菜单） */
export const MENU_PREFIX = "inpage-";
export const MENU_TOGGLE_PAGE = "inpage-toggle-page";
export const MENU_TOGGLE_ACTION = "inpage-toggle-action";
/** 工具栏图标的角标（受限页 / 内嵌被拦时的降级提示：下一次手势再点会走原生侧栏） */
export const BADGE_TEXT = "↗";

export const MSG = {
    /** 后台 → 内容（tabs.sendMessage，L2 主动探测）；回复 { ok, proto, ver, shown, ready } */
    status: "inpage:status",
    /** 内容 / iframe → 后台（runtime.sendMessage）：「切到 Chrome 侧边栏」按钮。⚠ 待 E8 实测 */
    switchNative: "inpage:switch-native",
    /** iframe / 命令栏弹窗 / 宿主页链接点击 → 后台（runtime.sendMessage）：「进受限页之前先切原生」。与 @api/HostMode 的 ENSURE_NATIVE_MSG 同值（有测试）。⚠ 手势经扩展页 / 内容脚本到 SW 是否有效 = E8 */
    ensureNative: "inpage:ensure-native",
    /** 内容 / iframe → 后台：首次手势「预热」（设置 prewarm 开启时才发；SW 同步 setOptions(当前标签 enabled:false) + open）。⚠ E2/E3 待真机人眼确认 */
    prewarm: "inpage:prewarm",
    /** iframe → 宿主（window.postMessage，L4 握手） */
    frameReady: "arc-inpage-ready",
    framePing: "arc-inpage-ping",
    /** 宿主 → iframe（postMessage）：{ type, flat: boolean } 当前是不是「常驻推开」的平贴态（DESIGN 3.8.8）。iframe 据此决定背景：平贴 = 不透明 Space 主题底；卡片 = 半透明叠在宿主的 backdrop-filter 上 */
    frameLook: "arc-inpage-look",
    /** iframe → 宿主（postMessage）：{ type, base, scheme } 侧栏页自己的 Space 主题底色（--arc-base 解析后的色值）和它实际使用的 color-scheme；宿主用来给平贴态垫不透明底、让 iframe 的 color-scheme 与文档一致（否则 iframe 画布不透明，卡片透不出去） */
    frameTheme: "arc-inpage-theme",
} as const;

/** L3 版本握手：内容脚本与后台协议号不一致 → 后台回 stale，内容脚本自毁 */
export const PROTOCOL = 1;

/** Arc 值（FS，见 DESIGN 5.2.1）——不得改成别的数；网页近似见 SPRING / 下面的 ⚠ 注释 */
export const ARC = {
    defaultWidth: 228,
    minWidth: 164,
    maxWidth: 500,
    /** 容器 x = y = 5；高 = 视口高 − 10 */
    inset: 5,
    vInset: 10,
    radius: 12,
    border: 1,
    /** 触发区：未悬停 50；已在条带内 / 已浮出 250（⚠ 对 Arc「ArcWindow 已悬停」规则的收窄）；进入需停留 160ms */
    triggerNarrow: 50,
    triggerWide: 250,
    dwellMs: 160,
    /** 保持区 = 侧栏宽 + 80（= 5 + 宽 + 75） */
    holdExtra: 80,
    /** 拖拽把手：宽 8；left = 5 + 宽 − 4；top 11；高 = 100vh − 22 */
    handleWidth: 8,
    handleTop: 11,
    handleVInset: 22,
    /** 隐藏态位移 = 宽 + 15（展示 x = +5，隐藏 x = −宽 − 10） */
    hiddenExtra: 15,
} as const;

/** ⚠ 弹簧（response 0.18 / ζ 0.8）的 CSS linear() 近似；0.25 s 是近似（Arc 的 settlingDuration ⛔ 未知） */
export const SPRING = {
    durationMs: 250,
    easing: "linear(0, .075, .237, .421, .59, .73, .836, .911, .96, .99, 1.006, 1.013, 1.015, 1.014, 1.012, 1.009, 1.006, 1.004, 1.002, 1.001, 1)",
} as const;

/** ⛔ 占位（Arc / P0 都没有给出）：真机调。不得当成已知值 */
export const TIMING = {
    /** L2 探测超时与重试 */
    pingMs: 800,
    pingRetries: 1,
    /** 防抖：tabs.onActivated / onUpdated 之后再探测 */
    debounceMs: 150,
    /** L4：iframe 创建后多久没握手 = 被页面 CSP / 扩展拦截（frame-blocked） */
    handshakeMs: 4000,
    /** 内容脚本重连退避（端口断开：SW 被回收 / bfcache） */
    reconnectMs: [200, 400, 800, 1600, 3200] as readonly number[],
    /** 宿主 DOM 被页面删掉后的重建：最多 5 次，间隔 1 s */
    rebuildMax: 5,
    rebuildMs: 1000,
    /** 按钮失败提示显示多久 */
    hintMs: 4000,
    /** 补丁 12 修正：收起闸的兜底超时（松手后这么久后台仍没收起 → 恢复起始宽；正常 ≪ 此值，滑出 ~0.2 s） */
    collapseGateMs: 1500,
} as const;

/** 补丁 inpage-tabswitch-noreload：冷 SW 启动后，意图（openByWin）/ 宽度要等 storage.local 读完才恢复。读完之前后台**不向内容脚本下发状态**（否则第一条状态是 show:false / 默认宽，
 *  切回标签的页内侧栏先收起再展开 = 「重播展开动画」）。读不回来（存储挂住）时最多等这么久，照现有（可能是默认）值下发，不让宿主一直拿不到状态。 */
export const STATE_RESTORE = { maxWaitMs: 1500 } as const;
/** 补丁 rel62-intent-persist：开原生（预热 / ensure）时把「原来是开着的」落盘意图保留为 suppressedByWin（storage.local，扩展重载 / 浏览器重启都在）。
 *  启动时怎么区分「扩展重载 / 浏览器重启」和「SW 回收」：storage.session 里的存活键 sessionKey（每次 start 写入；重载 / 重启时 Chrome 清空 session，SW 回收不清）。
 *  - 没有存活键（重载 / 重启）→ 该窗口还在、等 graceMs 仍没有原生面板（端口 / 打开中）就恢复页内意图；原生还开着 → 等它关了再恢复。
 *  - 有存活键（SW 回收）→ 完全交给原来的 restoreOnClose 逻辑（含过期 / 不匹配 / sweep「宁可不恢复」）；没有对应标记 → 撤掉 suppressed（落盘意图跟内存 false）。
 *  - storage.session 不可用 → 分不出 → 保守按 SW 回收处理（不恢复）。 */
export const SUPPRESS_RESTORE = { graceMs: 500, sessionKey: "inpageSidebarAlive" } as const;

/** ⚠「待 E8 实测」：页内「切到 Chrome 侧边栏」按钮。
 * 路径：真实点击（isTrusted）→ runtime.sendMessage → SW 顶层同步 onMessage 监听 → openPanelInGesture（同步，前面没有 await）。
 * E8 四问：① 能不能开 ② 手势从内容脚本消息到 SW 能撑多久、是否必须同步 ③ 点 iframe（扩展页）里的按钮再 chrome.runtime.sendMessage 是否同样 ④ 脚本 el.click() 是否失败。
 * 结果出来前默认值是 ⚠ 的：翻这里的常量即可，不用改代码。失败时的降级（快捷键 + 右键菜单 + 角标）始终在，不受这个开关影响。 */
export const NATIVE_SWITCH = {
    /** 总开关：false = 按钮不渲染、后台不处理该消息（回到纯降级：快捷键 / 右键菜单 / 角标）。**E8 已测（2026-10-25）：宿主 / iframe 里真点击 → sendMessage → SW 同步 open 6/6 成功（含冷启动、严格 CSP）⇒ 默认 true** */
    viaClick: true,
    /** 按钮放在哪：host = 宿主（内容脚本）里的按钮；frame = iframe（扩展页）里的按钮——E8 问 3 的对照。默认只放 host */
    sources: ["host"] as readonly ("host" | "frame")[],
    /** E8 变体：SW 里先同一调用栈 setOptions({ tabId, enabled: true }) 再 open。只会「启用」，**永远不 disable**（E3）。默认关 */
    setOptionsFirst: false,
} as const;

/** 补丁 12：侧栏右缘「调整宽度」把手（Arc `SidebarResizeRegionView`，Rea `/workspace/arc-analysis/arc-sidebar-resize-handle.md`）。取代 28×28「↗」按钮（已删除，Arc 没有它；切原生仍是快捷键 / 右键菜单 / 工具栏图标）。
 * **8 px 热区始终存在**（拖宽 / 双击重置 / col-resize 不依赖开关，Cat 裁定）；设置 `showHandle`（「显示侧栏把手」）默认 false，只控制 **3 px 竖条渲不渲染**：false = 竖条始终不在 DOM 里（含拖动中、吸附脉冲都看不到）。
 * ✅ = Rea 源码事实；⚠ = 推断 / 网页近似；⛔ = 未查到。热区几何见 ARC.handleWidth / handleTop / handleVInset（8 / 11 / 100vh−22）。 */
export const HANDLE = {
    /** 设置 showHandle（竖条）的默认值（Cat：false = 默认看不到竖条）；已存的值不被覆盖（SettingsStore 只在存储值为 undefined 时才取默认） */
    defaultOn: false,
    /** ✅ 竖条路径 3 × (热区高 − 8)、圆角 4（> 宽/2 → 胶囊）、中心线在热区本地 x = 0；⚠ CAShapeLayer 默认 lineWidth 1 的同色描边 → 可见宽 3 + 1 = 4（Cat 11:5x 定按可见 4 px 实现）。
     *  水平位置算式：left = barCenterX − barVisible / 2 = 0 − 4 / 2 = −2 px（相对热区）→ locked 热区 x = W − 4：条占 [W − 6, W − 2]（路径 [W − 5.5, W − 2.5] 两侧各 +0.5 描边）；floating 热区 x = W + 1：[W − 1, W + 3]。
     *  竖直：top = barVInset / 2 = 4（热区 top 11 → 窗口 15 px）、高 = 热区高 − 8 = H − 30，上下对称（⚠ 描边也会让上下各多 0.5 px，没采用）。 */
    barWidth: 3, barStroke: 1, barVisible: 4, barVInset: 8, barRadius: 4, barCenterX: 0,
    /** ✅ layer.opacity = 0.5（显示态；静止 hidden = 0）。⚠ 颜色 = 主题 SemanticColorPalette.maxContrastColor（AH.1#1）：有 Space 色（--arc-space）→ 侧栏页按 libPalette 同一规则算（T0 / T3，⚠ 近似）经 frameTheme.bar 回报；
     *  没有 → 默认主题估算值：浅色外观 ≈ #006278 = rgb(0 98 120)，深色外观 ≈ #00FFFF（Rea 的计算估算 ⚠，A=浅 / B=深 的对应也是推断）。Space 自定义主题的真实值 ⛔ 运行时数据 */
    barOpacity: 0.5, barEstimate: { light: "rgb(0 98 120)", dark: "rgb(0 255 255)" },
    /** ✅ 悬停 0.25 s 后淡入 0 → 0.5（0.2 s）；移出立即淡出（0.2 s）；拖动中常显。⚠ 缓动未设置 = 线性 */
    hoverDelayMs: 250, fadeMs: 200,
    /** ✅ 光标：系统 resizeLeftRight → CSS ew-resize（Cat 定） */
    cursor: "ew-resize",
    /** ✅ 宽度规则：w = trunc(起始宽 + 位移)；w < 82 → 0（收起）；82 ≤ w < 164 → 164；w > 500 → 500；|w − 228| < 14 → 吸到 228（拖动中先离开过 14 带才武装） */
    collapseBelow: 82, snapWidth: 228, snapBand: 14,
    /** ✅ ended 分支（locked 起手）：Int(起始 + 位移) ≤ 82（**含 82**）→ 收起，宽度恢复为 min(500, 起始宽)。注意边界差一：拖动中 w = 82 不收起（夹到 164），松手时 82 收起 */
    collapseOnReleaseAtMost: 82,
    /** ✅ 吸附脉冲：竖条 scale.x 1 → 1.7，0.08 s，autoreverse，cubic-bezier(.215,.61,.355,1)。⚠ 触发条件简化为「刚吸上」（Arc 另有速度 / 方向条件，⚠ 解读不确定） */
    pulseScaleX: 1.7, pulseMs: 80, pulseEasing: "cubic-bezier(0.215, 0.61, 0.355, 1)",
    /** ✅ 吸附反馈冷却：脉冲 / 触觉后 state[5]=0，要离开带且距上次 > 0.5 s 才再允许（触觉网页没有，省略；脉冲沿用同一冷却 ⚠ Arc 是触觉 + 脉冲同一分支） */
    pulseCooldownMs: 500,
} as const;

/** ⚠ 冷启动纠偏（未实测）：SW 刚起来、路由还没装时的首次手势只能开原生；开了之后若该页可页内显示，是否立刻把原生关掉换页内（会闪一下）。
 * 默认 false = 接受「多一次点击 / 可能闪一下原生」（裁定 I）。 */
export const COLD_START_CORRECTION = false;

/** 第 8 层 cold-key-wait：冷启动那一次 ⌃S 仍在手势栈里同步开原生（不丢手势；E8：SW 里 await / microtask / setTimeout 之后再 open 会被拒，commands 的延迟手势 ⚠ 未验证），
 * 但随后在 start() 起算的有界窗口 COLD_KEY_WAIT_MS 内——内容脚本重连的 hello 到达 / 原生面板端口出现、该标签可页内显示且默认方式是页内——就把这次的原生收起、恢复页内。
 * 窗口过了没等到 = 保留原生（= 旧行为）。与 COLD_START_CORRECTION 并存：后者开着时走它那条无界路径，本开关不再重复处理。 */
export const COLD_KEY_WAIT = true;
export const COLD_KEY_WAIT_MS = 400;

/** 补丁 inpage-prewarmopened-persist：「窗口的原生是首次手势预热开的」标记（prewarmOpened）持久化到 chrome.storage.session，SW 回收后 ⌃S 仍能把页内以常驻恢复（restore-pinned 的遗留缺口）。常量集中在这里。 */
export const PREWARM_OPENED = {
    /** chrome.storage.session 键：{ [windowId]: { tabId, windowId, t } }（session 区随浏览器会话清空，不进备份 dump） */
    key: "inpagePrewarmOpened",
    /** 记录寿命：超过 = 过期（预热开的原生一般几分钟内就被用掉；过期宁可当「用户自己开的」只关，不误恢复） */
    ttlMs: 10 * 60_000,
    /** 异步加载的等待上限：storage.session 卡住也不能让 ⌃S 一直等（到点按「没有标记」处理 = 旧行为） */
    loadTimeoutMs: 1_500,
    /** 加载后多久复核：只从存储恢复、而这个 SW 生命里没见到对应面板端口的记录 → 作废（防止陈旧记录把之后用户自己开的原生误当预热）。略大于面板页重连退避上限 5.5 s */
    sweepMs: 7_000,
} as const;

/** 补丁 inpage-restoreonclose-persist：「原生关了要恢复页内」标记（restoreOnClose）持久化到 chrome.storage.session（存取层 = 第 10 层的 PrewarmOpened 类，另起一个键）。SW 回收后设置改 Off / 用户关原生时页内才能恢复（b9b COLD=1 实测 HIDDEN 的缺口）。常量集中在这里。 */
export const RESTORE_ON_CLOSE = {
    /** chrome.storage.session 键：{ [windowId]: { tabId, windowId, t } }（tabId = 该窗口当前激活标签，onActivated 时跟随更新；t = 打标时间，不随之更新） */
    key: "inpageRestoreOnClose",
    /** 记录寿命：超过 = 过期。宁可不恢复（回到第 12 层以前的行为）也不在很久以后误弹页内 */
    ttlMs: 10 * 60_000,
    /** 异步加载的等待上限：storage.session 卡住 = 按「没有标记」处理（旧行为） */
    loadTimeoutMs: 1_500,
    /** 加载后多久复核：只从存储恢复、而这个 SW 生命里没见到对应原生面板（面板端口 / 正在打开）的记录 → 作废（**不恢复**，只清除）。同 PREWARM_OPENED.sweepMs */
    sweepMs: 7_000,
} as const;

/** 受限页前预热（plugins.InpageSidebar.prewarm，DESIGN.md 3.6）。E8 已在 CDP 层确认：先禁用再 open（P1）文档存活，open 后同栈禁用（P2）不出现，300 ms 后禁用（P3）约 345 ms 销毁（= E3）——E2 / E3 是顺序差异不是矛盾。⚠ 原生像素 / 闪烁 / 占位 / 内存仍没测过（M9 / MANUAL I14–I18），所以默认仍 off */
export const PREWARM = {
    /** 设置项默认值（off / window）：⚠ **off**（只做 ensure-native：页内操作进受限页前同步切原生，窗口级 open，不预先常驻）。
     *  window = 首次手势就窗口级 open 原生（互斥：页内收起，整个窗口看到的都是原生，等于「原生锁定」）——不设为默认：它让页内侧栏在这个窗口里整体不可见。
     *  已移除 tab（标签级 enabled:false 预热）：Chrome ≥132（commit 6dd962b30f 移除了 d0a5fa8 的「tab 级 disabled 隐藏全局面板」机制）里藏不住，E 段实测（prewarm-2026-10-26T07-35-06-467Z.json）也确认原生展开；见 patches/inpage-prewarm-tab/downgrade/README.md。 */
    defaultMode: "off" as "off" | "window",
    /** 在原生面板端口上每隔这么久发一次 {type:"heartbeat"}（panel 端不听 port 消息，只是探活：向死端口 postMessage 会抛 → 当作断开；⚠ 是否能延长 SW 寿命 ⛔ 未测） */
    heartbeatMs: 25_000,
    /** 原生面板（由 ensure / 窗口级预热打开）关闭时，把当时的页内意图恢复（Vertitab 的 sidepanel_closed → 重建）。⚠ 默认开：只影响「由本插件为进受限页而打开的原生」 */
    restoreInpageOnClose: true,
    /** 内容脚本 / iframe 里用哪些真实手势触发首次预热（isTrusted 的第一次；capture、passive） */
    gestureEvents: ["pointerdown", "keydown"] as readonly string[],
    /** 内容脚本两次发送预热消息的最小间隔（后台幂等，这里只防刷） */
    resendMs: 2000,
    /** iframe 里拿不到后台状态（不知道已不已预热），发得更稀 */
    frameResendMs: 30_000,
    /** ⛔ 占位（E8 P1：点击后约 35 ms 出现面板文档、约 137 ms visible，CDP 范围内；6000 是保守值）：预热后多久还没有 panel:<winId> 端口 = 没开成 → 结束预热并恢复所有被禁标签；SW 重启后等面板重连（核心重连退避上限 5 s）也用它 */
    connectWaitMs: 6000,
} as const;

/** 侧栏形态跟着标签切换自动切（补丁 switch-auto）。方向：页内 → 受限页 = 既有 ensure-native（要手势，同步 open，先切后进）；**原生 → 普通页 = 本补丁（不要手势，只 close）**。
 *  viaSidebar：在原生侧栏 / 非页内弹窗里点标签行（激活已有标签）→ 目的地是普通网页 → 后台关原生、恢复页内。
 *  onArrive：浏览器 UI 触发的到达（标签栏 / 地址栏 / Cmd+T 之后的导航）——**没有手势、事先切不了**；但若原生是我们为进受限页而开的（restoreOnClose 标记），到达普通页时同样关原生、恢复页内（事后回落，会闪一下，⚠ 真机）。
 *  hostWaitMs：目的标签的内容脚本还没握手（刚加载 / 被丢弃重载）时，等它的 hello 再切，最长等这么久；超时 = 放弃（留在原生，行为同补丁前）。 */
export const AUTO_SWITCH = { viaSidebar: true, onArrive: true, hostWaitMs: 3000 } as const;

export type Mode = "inpage" | "native";
export const DEFAULT_MODE: Mode = "inpage";

/** 显示方式（设置 plugins.InpageSidebar.displayMode，DESIGN.md 3.8）：push = 常驻（展开 / 固定）的侧栏把页面推开，页面可视区让出左侧；overlay = 浮在页面上（盖住）。
 *  悬停浮出（hover-reveal）不论哪种方式都是浮层，从不改页面布局（Arc 浮动侧栏：只动容器 frame，不碰内容容器，arc-floating-sidebar.md §0-1c）。 */
export type DisplayMode = "push" | "overlay";
/** ⚠ 默认推开（用户硬要求：展开的侧栏不得盖住页面内容）；翻这里就能回到旧行为（覆盖） */
export const DEFAULT_DISPLAY: DisplayMode = "push";

/** 侧栏容器的两套外观（DESIGN 3.8.8）。flat = Arc locked（常驻推开）：贴窗口左缘、整高、无外边距 / 圆角 / 边框 / 阴影；card = Arc floating（悬停浮出）和「浮在页面上」显示方式：x / y +5、高 −10、圆角 12、1 px 边框、阴影。
 *  数值全部来自 ARC（Rea：locked 无卡片样式，卡片样式只属于 floatingSidebarContainer，arc-locked-sidebar.md） */
export const CHROME = {
    card: { left: ARC.inset, top: ARC.inset, vInset: ARC.vInset, radius: ARC.radius, border: ARC.border },
    flat: { left: 0, top: 0, vInset: 0, radius: 0, border: 0 },
} as const;

/** 卡片（floating）材质，全部 ⚠ 网页近似 / ⛔ = Arc 里没有对应物：
 *  - border = SidebarBorderColor #FFF α0.3（✅ 值）；shadow ≈ CellDropShadow（α0.2 × 9-slice 峰值 ≈0.376 → ≈0.075，外扩 10，⚠ 近似）。
 *  - Arc 卡片内部是 NSVisualEffectView material 6（popover，withinWindow，emphasized）+ 主题层 = 半透明、网页被模糊透出（✅）；网页做不了跨源页面的 behind-page 模糊，
 *    只能在宿主元素上用 backdrop-filter（⚠）。blur / saturate 是近似 popover 的取值（⛔ 无 Arc 数值）；
 *  - tint = 侧栏页主题色盖在模糊上的不透明度：Rea 没找到 Arc 有任何「文字可读性补偿」（⛔），这里自己选 .85——按 WCAG 公式估算（DESIGN 3.8.8 估算表，模糊后的页面取纯黑 / 纯白 / 中灰）：正文对比度最差 9.1:1，60% 不透明的次级文字最差 3.7:1（浅主题盖在黑页上）——⚠ 只是估算，不是 Arc 的值，真机眼看见 MANUAL I40 */
export const CARD_LOOK = {
    border: "rgba(255,255,255,.3)",
    shadow: "0 0 10px rgba(0,0,0,.075)",
    blur: 24,
    saturate: 1.8,
    tint: 0.85,
} as const;

/** 平贴态的不透明底色兜底（侧栏页还没回报主题色时用；与 static/sidepanel.css 的 --arc-base 浅 / 深默认值相同）：
 *  浅 #ece9f1 = :root --arc-base（sidepanel.css:24）；深 #1e2020 = Helium 默认深色窗框色 kColorSysHeader（sidepanel.css:36–44 注释出处）。
 *  Rea：Arc locked 的底 = 窗口级 WindowBackgroundContainerView（Space 主题着色，alpha 由主题配置决定，⛔ 数值未解）；这里选「不透明」是为可读性，⚠ 不是 Arc 原值 */
export const FLAT_BASE = { light: "#ece9f1", dark: "#1e2020" } as const;

/** 推开页面（DESIGN.md 3.8）。全部 ⚠ = 网页近似，不是 Arc 原值 */
export const PUSH = {
    /** 右留白 = 0，且平贴态（Arc locked）的侧栏 x = 0、没有 5 px 外边距，所以推开量 = 侧栏宽（默认 228，不再是 233）。
     *  证据（/workspace/arc-analysis/arc-locked-sidebar.md 置顶 + 对比表；arc-floating-sidebar.md §5.0 / §5.1 / §5.5）：locked 侧栏 frame = (minX, minY, W, 整高)，内容区 x = 侧栏 maxX = W；
     *  5 pt 外边距 / 高 −10 / 圆角 / 边框 / 阴影 / popover 模糊「全部只属于 floatingSidebarContainer」（✅ 源码确认）。
     *  （21:2x 的 233 是 Cat 之前按「卡片仍在 x = 5」折中得来的；用户投诉「四周透光」后按 Rea 的 locked 证据改成平贴，DESIGN 3.8.8。）
     *  overlay 显示方式（浮在页面上）仍是卡片，不推页面，与此无关 */
    gap: 0,
    /** 推开 / 收回的曲线（Cat 裁定：arc80 默认）：arc80 = Arc 常驻（locked）切换的值，0.08 s easeOutQuad CAMediaTimingFunction(0.25,0.46,0.45,0.94)（arc-floating-sidebar.md §0-1a' / §2.1：locked→hidden、floating→locked、hidden→locked 都是它）；
     *  spring = 与悬停浮出同一条弹簧近似，仍可选。悬停浮出（hidden↔floating）不论这里选什么都继续用弹簧（host.css .box 的默认 transition，见 data-curve） */
    curve: "arc80" as "spring" | "arc80",
    arc80: { ms: 80, easing: "cubic-bezier(.25,.46,.45,.94)" },
    /** 占满视口的页面（html{width:100%} / body{width:100vw} / body{min-width:100vw}）推开后会横向溢出：宽度落在 [视口宽 − fitSlack, innerWidth + 1] 内算「想占满」，推开期间 html 改 width:auto、body 夹 max-width:100%（DESIGN 3.8.6） */
    fitSlack: 20,
    /** 固定定位元素补偿：一次最多扫描的元素数 / 变更后的去抖 / 过渡结束后多等一会再扫 */
    scanMax: 4000,
    /** 核对扫描：补偿后元素左缘比推开量多出这么多 px 以上 = 补过头（扫描时 html 过渡还没走完），还原重测 */
    overshootTol: 2,
    /** 补丁 10：扫描前先等 html 的 margin-left（computed）到达目标（origMl + 推开量，±settleTol px）；没到就 settleRetryMs 后重试，最多 settleMaxTries 次（≈1 s），超时照旧扫描并 console.warn。
     *  成因（真机 GitHub lp-IntroHero：left:auto 的 fixed 随 html margin 走，扫描恰在过渡中间量到 left≈155 → 写 inline margin-left 72 → 终态 left 300，~250 ms 后核对扫描才还原）：
     *  定时器与动画时间线脱钩（页面忙时帧晚到）。门控读的是同一张 computed 样式，所以时间线停在中间相位时读到的也是中间值 → 继续等，不会误判到位 */
    settleRetryMs: 50,
    settleMaxTries: 20,
    settleTol: 0.5,
    scanDebounceMs: 250,
    settleExtraMs: 60,
} as const;

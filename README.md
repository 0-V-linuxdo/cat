# Cat（Chrome MV3 扩展，Arc 风格侧边栏）

在 Chrome 侧边栏（Side Panel）里实现 Arc 风格的纵向侧边栏。
核心原则是 **一切皆插件**：核心只有插件注册表、生命周期、事件总线、存储 / 设置 API 和一个空白的侧边栏外壳。
所有功能都按 Void++ 的方式写成**扁平的插件**：`src/plugins/<插件>/index.ts` 里一个 `definePlugin`，构建时自动发现，每个插件一个开关。
插件用 `tags` 归到 6 个分类：标签（tabs）、空间（spaces）、命令（command）、视图（views）、资料库（library）、数据（data）；设置页按分类浏览（同 Void++ 的分类标签页）。
`plugins/_core/` 下的 Sidebar、PluginSettings、TabState 是必需插件，`plugins/_api/` 下的 CommandsAPI 在有插件需要时自动启用。

整体架构照搬 Void++（`0-V-linuxdo/VoidPP`，dev 分支），对应关系见下文。

---

## 安装（加载已解压的扩展程序）

```bash
bun install          # 只有开发依赖：typescript / oxlint / @types/chrome
bun run build        # 输出到 dist/（bun run build:dev 会带 sourcemap，并包含 *.dev 插件）
```

1. 打开 `chrome://extensions`，在右上角打开 **开发者模式**。
2. 点 **加载已解压的扩展程序**，选择本项目的 `dist/` 目录（不要选项目根目录）。
3. 点击工具栏上的扩展图标（或按 Alt+Shift+A）即可打开侧边栏。
   要让侧边栏显示在左侧（Arc 风格），在 `chrome://settings/appearance` 中把“侧边栏位置”设为左侧。
4. 全局快捷键可以在 `chrome://extensions/shortcuts` 修改：
   - 命令栏：Alt+T（mac 上是 ⌃T）
   - 显示 / 隐藏侧边栏：Mac 上 Ctrl+S（⌃S），其它平台 Alt+S（可在 chrome://extensions/shortcuts 修改）
   - 页面内的其它快捷键在侧边栏 ⚙ → 命令栏输入“编辑快捷键”里修改。

需要 Chrome 116 及以上版本；程序化关闭侧边栏需要 Chrome 141 及以上。

## 校验

```bash
bun run check   # tsc + oxlint + bun test + build + scripts/validate-manifest.ts
# 真浏览器冒烟测试（可选）：
google-chrome --headless=new --remote-debugging-port=9333 --enable-unsafe-extension-debugging --user-data-dir=/tmp/p about:blank &
EXT_ID=$(bun run load:cdp) bun run smoke   # 覆盖：Spaces、命令栏、右键固定、Undo（⌘Z 重开关闭的标签）、MultiSelect（多选 / 批量固定 / 取消固定 / 撤销 / Delete 关闭）、插件跨上下文启停、分屏
```

品牌版 Chrome 137 起会忽略 `--load-extension` 参数，所以冒烟测试改用 CDP 的 `Extensions.loadUnpacked` 加载扩展。

---

## 架构（照 Void++ 的目录与命名）

```
src/
├─ ArcSidebar.ts         启动流程（对应 Void++ src/VoidPP.ts）：注册 ~plugins → initSettings → initPluginManager → startAllPlugins(StartAt)
├─ utils/                与 Void++ src/utils 同名
│  ├─ types.ts           definePlugin / PluginDef / Plugin / OptionType / StartAt / DefinedSettings / SettingsChecks
│  ├─ SettingsStore.ts   Proxy 设置树：路径 / 前缀 / 全局监听、默认值 getter、markReady 后防抖写盘
│  ├─ constants.ts       Devs（authors）
│  └─ Logger.ts / misc.ts / guards.ts
├─ api/                  与 Void++ src/api 同名：核心 API 与扩展点
│  ├─ PluginManager.ts   registerPlugin / isPluginEnabled / togglePlugin / startPlugin / stopPlugin / startAllPlugins / initPluginManager / isNewPlugin
│  ├─ Settings.ts        Settings / PlainSettings / SettingsStore、definePluginSettings(def, checks)、migratePluginSettings、收藏 / 置顶
│  ├─ Events.ts          subscribe / dispatch + ArcEventMap（可跨上下文广播）
│  ├─ registry.ts        有序注册表（照搬）
│  ├─ Storage.ts         createPluginStore：插件数据（对应 IndexedDB VoidPP）
│  ├─ Commands.ts / ContextMenus.ts / Slots.ts / Search.ts / Claims.ts / Undo.ts / DragData.ts / Keys.ts / Clipboard.ts / dom.ts / icons.ts
│  └─ RPC.ts / ChromeEvents.ts / PanelShell.ts / context.ts   扩展特有：跨上下文调用、SW 事件缓冲、侧边栏外壳
├─ components/
│  ├─ settings/          与 Void++ components/settings 对应：SettingField（按 OptionType 渲染）、PluginCard（+ 徽标）、utils（分类 / 筛选）
│  └─ TabRow.ts
├─ entries/              background / sidepanel / content / page / options 入口，各自调用 bootstrap(ctx)
└─ plugins/              构建期扫描：_core/ → _api/ → 其它目录（跳过 _ / . 开头；*.dev 只在 --dev 构建；*.chrome 标记 chrome）
   ├─ _core/             必需插件：sidebar、pluginSettings、tabState
   ├─ _api/              API 插件：commands（CommandsAPI）
   ├─ tabs/              插件「标签」Tabs（必需）：pinnedTabs todayTabs tabActions archive autoArchive folders undo multiSelect
   ├─ spaces/            插件「空间」Spaces（必需）：spaceManager themes favorites
   ├─ command/           插件「命令」Command（必需）：commandBar shortcuts plusMenu
   ├─ views/             插件「视图」Views（可选）：splitView peek
   ├─ library/           插件「资料库」Library（可选）：libraryView media
   └─ data/              插件「数据」Data（可选）：backup
                         每个目录的 index.ts 是一个 definePlugin；子目录是插件内部的功能，不是插件
build.ts                 生成虚拟模块 ~plugins（导入 + 构建期写入 updatedAt / dev / chrome），用 Bun 打包到 dist/
static/                  manifest.json、sidepanel.html/css、options.html/css、split.html、图标
```

### 插件长什么样

```ts
const settings = definePluginSettings({
    intensity: { type: OptionType.SLIDER, min: 0, max: 60, default: 22, description: "主题色浓度（%）" },
}, {
    intensity: { isValid: v => v >= 0 || "不能小于 0" },        // checks：disabled() / isValid()，同 Void++
});

export default definePlugin({
    name: "Favorites",
    label: "收藏",                         // 中文显示名（Void++ 直接显示 name）
    description: "…",
    authors: [Devs.ArcSidebar],
    tags: ["spaces"],                     // 设置页分类
    dependencies: ["SpaceManager"],       // 启动前先递归启动；被依赖时 isDependency=true，不能关闭
    enabledByDefault: true,
    settings,
    onSettingsChange() { … },             // 本插件设置变化（前缀监听）时调用
    commands: [{ id: "fav.add", label: "…", context: "panel", defaultKey: "Mod+D", run() { … } }],
    contextMenuItems: { tab: [{ id: "fav", label: "添加到收藏", run(t) { … } }] },
    background: { start() { return listen("tabs.onRemoved", …); } },   // 返回的清理函数在停用时调用
    panel:      { start() { return addSection("favorites", "Favorites", { render(el) { … } }); }, managedStyle: "…", events: { … } },
    content:    { start() { … } },
    page:       { start() { … } },
});
```

扩展有多个运行上下文，每个上下文（background SW、侧边栏、网页 content script、扩展页面、设置页）**各自运行一份 PluginManager**，
所以 Void++ 的 `start` / `stop` / `managedStyle` / `events` 按上下文放进 `background` / `panel` / `content` / `page` / `options`。
开关与设置保存在共享的 `ArcSidebarSettings`（`Settings.plugins[name].{enabled,…}`）；任一上下文改动后，其它上下文经 `storage.onChanged` 同步启停并触发 `onSettingsChange`。

### 插件 = 分组；功能 = 插件的设置项

设置里能看到的插件只有 6 个（标签 / 空间 / 命令 / 视图 / 资料库 / 数据），每个都是一个 `definePlugin`。
插件里的功能（固定区、今日、归档、文件夹、撤销、多选……）**不是插件**，而是这个插件 `definePluginSettings` 里的设置项：

```ts
const features = [PinnedTabs, TodayTabs, TabActions, Archive, AutoArchive, Folders, Undo, MultiSelect];
export default definePlugin({
    name: "Tabs", label: "标签", required: true, authors: [Devs.ArcSidebar], tags: ["tabs"],
    settings: featureSettings(features),   // 可选功能 → BOOLEAN 开关（键 = 功能名）+ 它自己的设置项
    features,
});
```

- `featureSettings()`：每个可选功能生成一个 BOOLEAN 设置项（默认取 `enabledByDefault`），后面跟它自己的设置项（关闭时 `checks.disabled` 变灰）；**必需功能（`required: true`）不生成开关**，只列出它的设置项。功能代码里原来的 `settings.store` 直接读写所属插件的设置（`Settings.plugins.Tabs.maxItems` 等）。
- `PluginManager` 把功能注册为隐藏的内部单元（`parent` = 插件名）：功能运行 = 插件启用 且（必需 或 对应设置项为真）；改设置项即在各上下文启停该功能，不能对功能调用 `togglePlugin`。
- 必需插件（Tabs / Spaces / Command）没有开关；Views / Library / Data 有开关。数据插件里的 Backup 是必需功能，所以插件开关就是备份开关。
- 迁移：旧版每个功能独立的设置（`Settings.plugins[功能] = { enabled, … }`）在 background 首次启动时并入所属插件，然后删除。

### 界面语言（i18n）

- 默认“自动”：`chrome.i18n.getUILanguage()`（或 `navigator.language`）以 `zh` 开头用中文，否则英文；设置页“通用 › 界面语言”和侧边栏设置浮层底部可改为 中文 / English（存于 `Settings.plugins.PluginSettings.language`，改后扩展页面自动重新加载）。
- 清单文字用 `_locales/{en,zh_CN}/messages.json`（`default_locale: en`）：扩展名称、描述、工具栏标题、全局命令描述。
- 其余所有界面文本走核心模块 `src/api/i18n.ts` 的 `tr(key, ...args)`，文本在 `src/i18n/{zh,en}.ts`（键一一对应）。`definePlugin` 的 label / description、设置描述、选项名、命令名、菜单名只写键，在显示处翻译。
- 校验：单元测试检查两种语言键与占位符一致、英文无中文；selftest 切到 English 后检查侧边栏 / 设置浮层 / 命令栏 / 设置页 6 个分类没有中文；manifest 校验检查 `__MSG__` 都有条目。

### 工具栏按钮与底栏

点击工具栏扩展按钮（或按 Alt+Shift+A）直接打开侧边栏，没有弹出菜单；右键扩展按钮的“选项”或“设置”打开完整设置页，也可以从 ＋ 菜单或命令栏（“打开设置页”）进入。侧边栏底栏不再有设置齿轮：左边资料库、中间空间切换、＋ 固定在最右下角（同 Arc）。侧边栏内仍可用 Mod+, 打开设置浮层。

### 设置页由定义驱动

侧边栏“设置 · 插件”浮层和完整设置页（options.html）都不为任何插件写专门界面：
- 插件列表 = 所有非 `hidden` 的插件（6 个）；分类 = `tags`（加“收藏”），不显示计数；搜索匹配 name / label / description / 设置描述。
- 每个插件一行：开关（`required` / `isDependency` 时锁定并说明是谁依赖它）、徽标（新插件 `knownPlugins` 2 天内、`requiresRestart`）、收藏星标、依赖说明。
- 设置项由 `settings.def` 按 `OptionType` 渲染（STRING / NUMBER / BIGINT / BOOLEAN / SELECT / SLIDER / COMPONENT；CUSTOM 与 `hidden` 不显示），`checks.disabled` 禁用控件、`checks.isValid` 拦截无效值，`restartNeeded` 提示重新加载；“恢复默认设置”删除已存的值即回到声明的默认值。

### 与 Void++ 架构的对应

| Void++（0-V-linuxdo/VoidPP dev） | 本扩展 | 说明 |
|---|---|---|
| `src/utils/types.ts`：`definePlugin`、`PluginDef`、`Plugin`、`OptionType`（8 种）、`StartAt`、`DefinedSettings`、`SettingsChecks` | `utils/types.ts` | 字段同名：name / description / authors / icon / chrome / dependencies / required / hidden / dev / enabledByDefault / requiresRestart / startAt / settings / tags / updatedAt / contextMenuItems / cleanupSelectors / onSettingsChange。`start/stop/managedStyle/events` 按上下文分组；`patches` / `zustand` / `chatBarButton` 无宿主可补丁，换成 `commands` |
| `src/utils/SettingsStore.ts` | `utils/SettingsStore.ts` | 同一个 Proxy + 路径 / 前缀监听 + 默认值 getter；存储换成 chrome.storage，多了 `applyExternal`（跨上下文同步，不回写） |
| `src/api/Settings.ts`：`Settings` / `PlainSettings` / `SettingsStore`、`definePluginSettings(def, checks)`、`pluginPath`、`migratePluginSettings`、`getSettingsPluginData`、pinned / starred | `api/Settings.ts` | 同名同语义；`use()` 是 React hook，这里是 DOM 版（订阅 + 返回退订） |
| `src/api/PluginManager.ts`：`registerPlugin`、`isPluginEnabled`、`togglePlugin`、`startPlugin`（依赖递归、循环检测、`markAsEnabledDependency`、`ensureMethodsBound`）、`stopPlugin`（`pluginUnsubscribers`、`cleanupSelectors`）、`startAllPlugins(StartAt)`、`initPluginManager`（`pruneOrphanedPluginSettings`、`trackNewPlugins`、neededApis）、`isNewPlugin` | `api/PluginManager.ts` | 同名同语义。`togglePlugin` 是异步的（上下文钩子可异步），返回值同 Void++（是否需重载；不可切换返回 null）。额外：`features` / `parent`（插件内部功能，开关在插件设置里），`migrateFeaturesIntoPlugins` 迁移旧的逐功能设置 |
| `src/api/Events.ts` | `api/Events.ts` | 同构；含 `pluginToggle` / `pluginPin` / `pluginStar` / `reloadNeeded`，另支持 `{ broadcast: true }` |
| `src/api/registry.ts` | `api/registry.ts` | 照搬 |
| `plugins/_core/*`（required）、`plugins/_api/*`（按需自动启用） | `plugins/_core/*`、`plugins/_api/commands` | 有插件声明 `commands` 时 CommandsAPI 作为隐式依赖启用（对应 neededApis 里的 ChatBarButtonAPI / ContextMenuAPI） |
| `plugins/_core/settings` + `components/settings/{SettingField,PluginCard,pluginBadges,utils,tabs/PluginsTab}` | `plugins/_core/pluginSettings` + `components/settings/{SettingField,PluginCard,utils}` + `entries/options.ts` | 分类标签页、启用筛选、收藏、新插件徽标、按 OptionType 渲染设置项 |
| `build.ts`：扫描 `_core` → `_api` → `plugins`，`FOLDER_CONVENTIONS`（`.dev` / `.chrome` / `.extension`），写入 `updatedAt` | `build.ts` | 同一套；`updatedAt` 用目录内最新修改时间（本项目不是 git 仓库）；没有 userscript 渠道，所以无 `.extension` |
| `src/index.ts` 导出 `window.VoidPP` | `globalThis.ArcSidebar`（`plugins` / `Settings` / `runCommand`） | 每个上下文各一份 |
| Turbopack `patches`（find / match / replace、`$self`）、`zustand` 订阅、`StartAt.TurbopackReady` | **不适用** | 扩展不修改宿主代码；chrome 事件订阅用 `ChromeEvents.listen()` 托管 |
| oxlint + `tsc --noEmit` + `bun test` | 同上 | |

---

## 功能清单（对照规格文档 §1–§22）

### 已实现（按插件列出；粗体是功能，“必需”的没有开关，其余是插件里的开关设置项）

| 插件 | 功能 | 规格 | 内容 |
|---|---|---|---|
| **标签 Tabs**（必需） | **PinnedTabs**（必需） | §6.1 | 每个 Space 各有一个固定区；关闭标签后条目仍保留（显示为灰色）；重命名、重置网址、替换网址、取消固定、拖动排序；固定区可折叠（折叠后仍显示当前激活的固定标签）；Mod+D 固定 / 取消固定 |
| | **TodayTabs**（必需） | §6.2 | 分隔线下方的临时标签（当前 Space 中未被认领的标签）；“＋ 新标签页”按钮；一键清空（Mod+Shift+K）；拖动排序 |
| | **Archive** | §6.4 | 关闭的标签进入归档（区分手动关闭和自动归档）；右键“归档以下标签”；Alt+Shift+T 重新打开 |
| | **AutoArchive** | §6.3 | 可选 12 小时 / 24 小时 / 7 天 / 30 天 / 从不（默认 12 小时）；跳过收藏、固定、文件夹中的标签，以及当前激活或正在播放声音的标签 |
| | **Folders** | §7 | 位于固定区，可嵌套；折叠 / 展开、重命名、新建子文件夹、复制全部链接（包括子文件夹）、粘贴网址为新标签、复制文件夹、删除；可拖入 / 拖出 |
| | **TabActions**（必需） | §10 / §16 | 复制链接（自动去掉追踪参数，Mod+Shift+C）、复制为 Markdown（Mod+Shift+Alt+C）、复制标签、移动到其它 Space、关闭、按侧边栏顺序切到上 / 下一个标签（Mod+Alt+↑/↓） |
| | **Undo**（新） | §6.2 / §15 / §17 | 侧边栏中 ⌘Z / Ctrl+Z 撤销：关闭的标签按原位置、原 Space 重新打开，并重新关联固定项、从归档中移除（连续关闭的标签，例如清空 Today、批量关闭，合并为一步）；清空归档、移除收藏、取消固定 / 删除固定项、删除文件夹、批量移动都可撤销。命令“重新打开刚关闭的标签”（Mod+Shift+T）。网页中不拦截 ⌘Z。设置：撤销步数（默认 50）、是否记录关闭的标签 |
| | **MultiSelect**（新） | §15 / §16 | ⌘ / Ctrl+单击切换、Shift+单击按侧边栏可见顺序连续选择（Today、固定区、文件夹都可以，也可以混选）；普通单击只选该项；选中项有区别于当前标签的淡色高亮（深色模式适配）；没有工具栏，右键任一选中项弹出作用于全部选中项的菜单：关闭 N 个、归档、固定 / 取消固定、添加到收藏、移到文件夹 › / 用所选新建文件夹、移到 Space ›、复制链接、复制标签（均可撤销）；Delete / Backspace / ⌘W 关闭所选；拖动任一选中项整组拖放；Esc 或点空白处取消选择。扩展里不使用原生 &lt;select&gt;（自绘菜单 / 下拉框） |
| **空间 Spaces**（必需） | **SpaceManager**（必需） | §5 | 多个 Space（名称 / emoji 图标 / 颜色），标签按 Space 归属；底栏切换；触控板左右滑动切换；Alt+1…9 切到第 N 个 Space、Ctrl+Alt+←/→ 切到上 / 下一个；右键可重命名、换图标、换颜色、删除；用 Chrome 标签组映射 Space（切换时折叠其它 Space 的组，可在设置中关闭） |
| | **Themes** | §5.3 | 侧边栏随 Space 颜色着色（可选渐变、可调浓度）；浅色 / 深色 / 跟随系统 |
| | **Favorites** | §4 | 顶部图标网格，跨 Space 共享；拖入即可收藏；右键可重置为收藏的网址、用当前网址替换、移除 |
| **命令 Command**（必需） | **CommandBar**（必需） | §3.2 / §11 | 搜索打开的标签、历史（可删除单条建议）、书签、命令、Space；回车打开网址，或用默认搜索引擎搜索；Mod+L 编辑当前网址；全局快捷键（Windows / Linux：Alt+T；macOS：⌃T）弹出居中的命令栏小窗，自动获得键盘焦点；↑/↓、⌃N/⌃P、Tab 选择 |
| | **Shortcuts**（必需） | §17 | 所有命令都能绑定快捷键，在网页和侧边栏中都生效；支持录制、清除、恢复默认 |
| | **PlusMenu** | §12 | 底栏的“＋”菜单，只列出已启用功能提供的“新建”命令 |
| **视图 Views**（可选） | **SplitView** | §8 | 用一个标签承载 2–4 个面板（左右或上下排列）；Mod+Shift+= / Mod+Shift+-；Alt+点击链接、或在页面链接上右键“在分屏中打开链接”；“拆分分屏”把各面板拆回独立标签 |
| | **Peek** | §10.6 | 点击指向其它站点的链接时，在居中的小窗中预览；失焦自动关闭；Mod+O 把 Peek 移为正常标签；Shift+点击照常打开；会议链接直接在新标签打开 |
| **资料库 Library**（可选） | **LibraryView** | §13 | 归档（搜索 / 恢复 / 清空）、下载（进度、取消、在文件夹中显示）、Spaces 一览 |
| | **Media** | §15 | 底部媒体托盘：所有正在发声的标签都可以播放 / 暂停、静音、画中画、跳转；长标题滚动显示 |
| **数据 Data**（可选） | **Backup**（必需） | §1（Restore Data） | 每天自动快照（保留 10 份）；可导出 / 导入 JSON |
| 核心 | **Sidebar** | §1 / §14 | 点击图标打开侧边栏；显示 / 隐藏命令 |
| 核心 | **PluginSettings**、**TabState** | — | 插件列表（分类 / 搜索 / 启用筛选 / 收藏）、开关和各插件设置；当前窗口标签的缓存 |
| API | **CommandsAPI** | — | 命令跨上下文路由；有插件声明 commands 时自动启用 |

> 旧版逐功能的开关和设置会在 background 首次启动时自动并入所属插件的设置。

### Arc 对齐（P0，对照 /workspace/arc-parity-gaps.md）

- 命令 › **导航栏**（新功能 Navigation，可关）：精简地址胶囊（侧边栏顶部不再有后退 / 前进 / 刷新按钮）（域名、加载进度、非 https 警告）；点胶囊 = ⌘L。
- ⌘L 再按一次关闭命令栏；不改网址直接回车 = 刷新。「+ 新标签页」默认弹出居中命令栏小窗（命令 › 命令栏 · 居中小窗）。
- 固定标签偏离固定网址时标题前显示 “/”，点图标重置；固定项 / 今日标签双击标题就地重命名。
- 拖放：固定项 / 收藏拖到分隔线下方 = 取消固定 / 移出收藏；收藏拖进固定区；标签或固定项拖到底栏空间圆点 = 移到该空间；⌥ 拖一个标签到另一个标签上 = 组成分屏。
- 分屏面板之间的分隔条可拖动（双击恢复均分）；内容脚本也注入分屏面板，快捷键在面板里生效。
- 触控板横向滑动时内容跟手位移；文件夹折叠后仍显示其中激活的标签；速览默认只在固定标签 / 收藏里生效（视图 › 速览 · 范围）。

### 待确认项的处理

- 新标签在 Today 中的位置：默认显示在顶部，可在设置里改。
- 自动归档的档位：12 小时 / 24 小时 / 7 天 / 30 天全部提供，另加“从不”。
- Archive Below：关闭列表中该项以下的所有 Today 标签。
- 文件夹只能放在固定区；嵌套层数不限。
- 分屏快捷键：Mod+Shift+= / Mod+Shift+-。
- Shift+点击：不使用 Peek（按 Windows 发布说明的行为）。
- 侧边栏的左 / 右位置由 Chrome 设置决定。

### 未实现 / 跳过

- **macOS 专属或已下线的功能**：Little Arc、Easels、Arc Notes（已下线）、Boosts、悬停预览（Previews）、Share Space / Folder、Air Traffic Control、顶部工具栏、触感反馈、Live Calendar。
- **Arc Max 的 AI 功能**：Tidy Tabs、Instant Links。
- **Arc Sync**：`chrome.storage.sync` 的容量放不下完整的侧边栏数据，目前只能用 Backup 导出 / 导入代替。
- **受浏览器限制**：
  - Ctrl/⌘+T/W/N/Tab 这些组合被浏览器保留，扩展无法截获，所以 Ctrl+Tab 最近标签切换器没有实现；命令栏改用 Alt+T。
  - 自动隐藏 / 悬停呼出侧边栏、拖动宽度由 Chrome 侧边栏本身负责，扩展无法控制。
  - 关闭侧边栏需要 Chrome 141 及以上。
  - 自动画中画请使用 Chrome 自带的同名功能。
- **尚未实现**：撤销侧边栏操作（⌘Z）、Shift 多选后批量操作、文件夹悬停预览、分屏面板分别静音。
- **已知限制**：
  - 分屏用 iframe 承载网页，而且只对本扩展发起的子框架请求去掉 X-Frame-Options / CSP；依赖第三方 Cookie 的网站在分屏里可能需要重新登录。
  - 侧边栏未打开时，属于 panel 上下文的命令（例如命令栏）不会响应全局快捷键。

## Arc 对齐 · P1

- 空间：新建后在标题处行内命名、点标题行内重命名；右键「更换颜色 ›」子菜单；删除空间可 ⌘Z 撤销（连同其固定项）。
- 侧边栏空白处右键：新标签 / 新空间 / 新文件夹 / 重命名空间 / 空间颜色 / 外观（系统·浅色·深色·渐变）；双击空白处新建标签；拖链接进来新开标签、拖文字进来搜索。
- 命令栏：输入 “/” 只搜动作；再按 ⌘T / ⌘L 关闭；新增「重置标签」「重命名当前标签」「移到 [空间]」「粘贴网址为新标签」「新建空白窗口」。
- 文件夹：新建即行内命名「未命名」、行内重命名；拖到头部上沿 / 下沿 = 放在之前 / 之后；展开动画。
- 分屏：每个分屏可切换方向（⇅ / ⇄）；关闭当前聚焦面板；Ctrl+Shift+1–4 聚焦第 N 个面板。
- 速览窗口内有「在标签中打开」按钮，Esc 关闭。
- 标签：点音频图标静音；右键「移到 ›」（收藏 / 固定 / 取消固定 / 空间）；⌘1–9 按侧边栏顺序跳转；⌘⌥↑↓ 按侧边栏顺序切换；⌥ 单击加入分屏；拖出侧边栏生成新窗口；今日标签可重命名；清空跳过正在播放的标签。
- 收藏：拖动排序；当前收藏偏离原网址时再点一次 = 回到原网址。
- 侧边栏底部显示下载进度。

## Arc 对齐 · P2（第一批）

- 窗口失焦时侧边栏变暗；收藏最多 12 个；静音的标签不再出现在媒体托盘。
- ⌘Y 打开历史记录；⌘⌥V 把剪贴板网址粘贴为新标签；页面加载中按 Esc 停止加载。

## Arc 对齐 · P2（第二批）

- 当前标签滚出视区时顶部 / 底部出现指示条；无痕窗口显示「无痕」标识；底栏拖动空间圆点排序。
- 固定项 / 收藏右键「编辑网址…」；中键关闭收藏打开的标签；文件夹右键「移到 ›」空间。
- 备份分层保留（最近 10 份 + 每天 / 每周 / 每月）；资料库清空归档可撤销；恢复到其它空间时提示。
- 命令栏标签结果优先当前空间；速览可「加入分屏」；媒体托盘「下一首」与关闭（X）。

## Arc 对齐 · P2（第三批）

- 命令栏站点搜索：`yt 关键词` / `gh` / `w` / `bili` / `zhihu` / 域名 + 空格。
- 选中文字右键「复制高亮链接」（Share Quote 的替代）。
- 空间图标子菜单（常用 emoji / 自定义 / 移除）；首次自动归档时提示一次。
- 分屏命令：在左 / 右 / 上 / 下新建分屏。＋ 菜单不再有「新建笔记」（Arc 已于 2024 年下线 Notes）。

## Arc 对齐 · P2（第四批）+ P1 遗留

- 每个空间独立主题：纯色 / 柔和渐变 / 双色渐变、第二颜色、噪点纹理（空间右键或空白处右键 › 空间主题）。
- 多窗口：每个窗口各自切换空间，空间与固定项在窗口间共享。
- 速览窗口按 Arc 比例居中；Little Arc 小窗（⌘⌥N）；收藏悬停预览（缩略图）与自定义图标。
- Air Traffic Control：标签右键「总是在此空间打开 某站点」；最近标签切换器（Alt+Q）。
- 地址胶囊右键：复制链接 / 网站设置 / 强制刷新 / 画中画 / 静音。

## Arc 对齐 · P2（第五批）

- 跨设备同步：空间 / 固定项 / 收藏写入 Chrome 同步（可在「数据」里开自动同步；命令「上传 / 从同步恢复」）。
- 实时日历（资料库，默认关闭）：填 iCal 私密地址后底部显示下一个会议、倒计时与「加入」。
- 实时文件夹（标签，默认关闭）：GitHub 搜索查询显示为自动更新的文件夹（可选令牌）。
- 媒体托盘里的 Google Meet 控制（麦克风 / 摄像头 / 离开）；分屏面板单独静音、面板内 ⌘L 只改该面板。
- ⌥ 拖到今日区空白处 = 复制标签；悬停折叠的文件夹预览内容；悬停资料库按钮显示最近下载。

## Arc 对齐 · P2（第六批）

- 「整理标签」按网站排列今日标签（Tidy Tabs 的非 AI 版）；空间右键「复制空间为链接列表」（分享 Space 的替代）。

## 空间主题选择器（Edit Theme Color…）

空间菜单「编辑主题颜色…」（侧边栏右键也有）打开 Arc 风格的主题选择器，属于「空间」插件的可选功能 Themes，取代并合并了原来的渐变 / 第二颜色 / 噪点选项：

- 点状网格颜色平面：点按放置主色，拖动改色；下方 − / + 增删颜色（最多 3 个，按色彩和声自动摆放）；顶部 自动（✦）/ 浅色 / 深色。
- 色板行 9 色（奶油、粉、紫、红、橙、黄、绿、蓝、石板灰），‹ › 分页为 1 / 2 / 3 色预设。
- 左下波浪滑块 = 浓度；右下圆点刻度盘 = 颗粒（16 档，同 Arc / Zen）。自动模式按 WCAG 对比度决定浅 / 深界面（文字颜色随之切换）。
- 存储：设置存储 `Spaces.spaceThemes`（chrome.storage.local，所有窗口 / 上下文实时同步）。

### 第三方代码许可

`src/plugins/spaces/themes/gradient.ts` 与 `picker.ts` 移植自 [Zen Browser](https://github.com/zen-browser/desktop) 的
`src/zen/spaces/ZenGradientGenerator.mjs` 与 `zen-gradient-generator.css`，遵循 **Mozilla Public License 2.0**（MPL-2.0），
文件头保留了 MPL 声明；这两个文件（及其修改）按 MPL-2.0 提供，其余代码不受影响。许可全文：https://mozilla.org/MPL/2.0/

## 站点控制（Site Controls）

点地址胶囊左侧的图标（https 为锁，其它页面为设置图标；不安全时为警告）打开 Arc 式站点控制面板；右键地址胶囊仍是原来的快捷菜单；命令栏「站点控制」也可打开。

**归属：「视图」插件（可选）**。它和分屏 / 速览一样是“看当前网页时的辅助视图”，不管理标签的结构，所以不放「标签」；放在可选分组里，不需要的用户可以整组关闭。

| 区块 | 实现 | 说明 |
|---|---|---|
| 分享 | 复制干净的链接 | Chrome 没有 Arc 的分享菜单 |
| Boost | — | **不可行 / 跳过**：本扩展没有 Boost 插件；… 菜单里的 Manage Boosts / New Boost 也省略 |
| 截图 | `tabs.captureVisibleTab` → `downloads`（“Screenshot 域名 时间.png”）+ 剪贴板图片 | 只截可见区域；整页截图不可行 |
| 提取正文 | `scripting` 读取选中文本，否则 article / main 的文本，复制 | Arc 的 Live Text（OCR）不可行 |
| 扩展网格 | `management.getAll`；点按打开选项页（无选项页则启用 / 停用），右键：选项 / 启用·停用 / 管理；+ 打开网上应用店 | **不可行**：无法触发其它扩展的工具栏弹窗（`action.openPopup` 只能打开自己的），悬停提示里写明 |
| 站点设置 | `contentSettings`：通知 / 位置 / 摄像头 / 麦克风 / 弹出窗口 / JavaScript，作用于 `origin/*` | Arc 的 Developer Mode、自动画中画等是浏览器私有设置，不可行 |
| 安全胶囊 | https = “安全”，http = “不安全”，点按打开该站点的设置页 | 证书查看器无法从扩展打开 |
| … 菜单 | 清除缓存 / 清除 Cookie：`browsingData.remove({ origins: [当前 origin] })`；管理扩展；添加扩展；所有站点设置 | 只清当前站点，不碰其它数据 |

**新增权限及理由**

- `management`：列出已安装扩展、打开其选项页、按用户点击启用 / 停用。只读取名称 / 图标 / 选项页地址，不卸载任何扩展。
- `contentSettings`：按用户在面板里的选择为当前站点设置通知、位置、摄像头、麦克风、弹出窗口、JavaScript 权限。
- `browsingData`：用户点「清除缓存 / 清除 Cookie」时，只清除当前站点 origin 的缓存 / Cookie。

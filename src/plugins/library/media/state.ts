/*
 * 迷你播放器按钮：状态 → SF 图标名（纯函数，tests/mediaState.test.ts）。
 * 出处：/workspace/arc-icons/sf/MAPPING.md「MiniPlayer 开关按钮的状态与尺寸核对」，FUN_102492888（rSF/1024938f4.c）与 FUN_102495334。
 */
import type { IconName } from "@api/icons";

/* mic / video（MAPPING.md「MiniPlayer 补充」）：Recording { canToggleMicrophone, canToggleCamera, isMicrophoneOn, isCameraOn }（@0x103d1256c）；
 * 掩码 0x10001 / 0x1000100 == 1 / 0x100 即 canToggle && !isOn → slash，否则（含不可切换）非 slash。
 * ⛔ 按字段顺序推断，Rea 未逐条追到读取点。扩展里 canToggle = 页面中找到对应的 Meet 按钮。 */
/** 麦克风（FUN_102492888 L345–352） */
export const micIcon = (canToggle: boolean, isOn: boolean): IconName => (canToggle && !isOn ? "micSlashFill" : "micFill");
/** 摄像头（L426–431） */
export const camIcon = (canToggle: boolean, isOn: boolean): IconName => (canToggle && !isOn ? "videoSlashFill" : "videoFill");
/** 播放（L549–556）：state == 2 → play.fill，否则 pause.fill。2 候选 = MediaSessionStatus.suspended（{active, ducking, suspended, inactive} @0x103c9c5f8）；
 * ⛔ 未确认比较的就是该字段（PiPPlaybackState 2=endOfVideo、PlaybackState 2=playing 也存在）。扩展里 suspended ≈ 页面媒体全部暂停。 */
export const playIcon = (paused: boolean): IconName => (paused ? "play" : "pause");
/** 音量（FUN_102495334）完整分档：静音 → speaker.slash.fill；0 → speaker.fill；<1/3 wave.1；<2/3 wave.2；其余 wave.3。level ∈ [0,1]。 */
export function volumeIcon(muted: boolean, level?: number): IconName {
    if (muted) return "speakerSlashFill";
    // 档位拿不到，只分静音/wave.3：chrome.tabs 只有 mutedInfo，没有标签页音量值，level 未知时按最高档处理。
    if (level == null || !Number.isFinite(level)) return "speakerWave3Fill";
    if (level <= 0) return "speakerFill";
    if (level < 1 / 3) return "speakerWave1Fill";
    if (level < 2 / 3) return "speakerWave2Fill";
    return "speakerWave3Fill";
}

/** 分屏面板真实静音状态：面板里有媒体且全部 muted → true；无媒体 → null（未知，按未静音显示）。 */
export const paneMuted = (muted: readonly boolean[]): boolean | null => (muted.length ? muted.every(Boolean) : null);
/** 分屏静音按钮图标：沿用 ionicons mute / volume（MAPPING.md：分屏场景 ⛔ 无 Arc 对应）。 */
export const splitMuteIcon = (muted: boolean | null): "muteSlash" | "volume" => (muted ? "muteSlash" : "volume"); // 与 TabRow 静音一致：空心 speaker + 代码斜杠（Rea 标签行静音分析）

/** 媒体行图标来源（archive-page.md §9，与 Archive 的 favBox 一致）：标签自带 favIconUrl（非 chrome:// 内部图）优先 → 直接用；
 * 否则交给 Archive 的 favBox(url)（无地址 / 默认地球 → .no-fav 占位）。返回 null = 走 favBox。 */
export const mediaFavSrc = (favIconUrl: string | undefined): string | null =>
    favIconUrl && !favIconUrl.startsWith("chrome://") ? favIconUrl : null;

/* 迷你播放器标题滚动（审计 52193 M-01；audit-52193-answers.md「17 补」：功能开关 mini-player-marquee-title-enabled 默认 false，outFL/0x1013db120.c L15–18）。
 * 开（用户显式打开）：保留现有跑马灯（library/style.ts .arc-media-title span，12s 循环；速度 / 停顿 ⛔ Rea 无值，沿用现值）。
 * 关（默认）：不滚动。不滚动时的显示方式 ⛔（MiniPlayer 字体 / 截断 / 行数 Rea 未找到，sidebar-features.md §16.2「MiniPlayer 尺寸、字体、圆角 ⛔」）
 *   → 回退：单行、末尾省略号；去掉为跑马灯准备的两端渐隐遮罩。以内联样式实现（library/style.ts 不在本线程范围，见交接补丁）。 */
export const MEDIA_MARQUEE_DEFAULT = false;
/** data-marquee 值：样式在 library/style.ts（"1" 跑马灯；"0" 省略号、无遮罩 ⛔ Rea 无 MiniPlayer 截断方式） */
export const mediaMarqueeAttr = (marquee: boolean): "1" | "0" => (marquee ? "1" : "0");

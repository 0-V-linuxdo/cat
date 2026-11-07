/* [system-color-scheme/4] 自定义 Space 主题的明暗解析（纯函数，无 DOM，可单测）。
 * 之前：custom.scheme=auto 时按「主色 + 底色」对比度（prefersLightText）决定明暗，并把 data-theme 钉成 dark / light
 *   → 系统明暗变化时这类主题不跟着变（用户抱怨「不自适应」）。
 * 现在：
 *   - 主题里显式选了 light / dark → 钉死该值（与之前一致）；
 *   - 主题选 auto → 跟随全局外观 plugins.Spaces.mode：mode=auto 时 data-theme="auto"（不钉死，样式靠
 *     prefers-color-scheme，页内侧栏 iframe 靠 补丁 1 的 follow/fw 判成「跟随」）；mode=light/dark 时钉成该值，
 *     与「没有自定义主题的 Space」完全一致。
 *   - dark 仅用于挑选渐变底色（BASE_DARK / BASE_LIGHT）。
 * 出处：用户抱怨「不自适应」；选择器里 auto 按钮标签 =「跟随系统」(themes.system)。Rea 无「Arc automatic 档是否跟系统」的出处 ⛔。 */
export type ThemeMode = "auto" | "light" | "dark";
export interface SpaceScheme { theme: ThemeMode; dark: boolean; follows: boolean }
const parse = (v: unknown): ThemeMode => (v === "light" || v === "dark" ? v : "auto");

/** @param customScheme 自定义主题的 scheme（无自定义主题传 undefined）  @param mode 全局 plugins.Spaces.mode  @param systemDark 当前系统是否深色 */
export function resolveSpaceScheme(customScheme: unknown, mode: unknown, systemDark: boolean): SpaceScheme {
    const pinned = parse(customScheme);
    const theme = pinned !== "auto" ? pinned : parse(mode);
    return { theme, dark: theme === "dark" || (theme === "auto" && systemDark), follows: theme === "auto" };
}

/* [system-color-scheme/7] 独立 Boost 编辑器窗口（boost-editor.html，page 上下文）跟随「外观」设置 plugins.Spaces.mode：
 *   auto = 不写 data-theme（跟系统，sidepanel.css 的 @media + color-scheme: light dark）；light / dark = 钉住（data-theme，sidepanel.css 已有对应规则与补丁 5 的 color-scheme）。
 *   Themes 功能被关掉时 appearanceMode() 返回 auto（Appearance.modeFrom）。
 * 为什么放这里：Themes 插件只在 panel 上下文写 data-theme，page 上下文没人写 → 该页以前永远跟系统。
 * 首帧由 boost-editor.html <head> 里的 options-theme-head.js（补丁 3b，localStorage 缓存）负责；本函数在设置加载后以设置为准纠正（缓存缺失 / 过期最多一帧旧值）。
 * 只复用 Appearance.ts（读 + 订阅），不含任何色值。 */
import { appearanceMode, applyThemeAttr, watchAppearance, type WatchDeps } from "@api/Appearance";

/** 立即按当前 mode 写 / 去掉 root 上的 data-theme，并订阅 mode / 系统变化（只改属性，不重建 DOM、不重载）。返回取消函数。 */
export function followAppearance(root: { dataset: DOMStringMap } = document.documentElement, deps?: WatchDeps): () => void {
    applyThemeAttr(root, (deps?.mode ?? appearanceMode)());
    return watchAppearance(s => applyThemeAttr(root, s.mode), deps);
}

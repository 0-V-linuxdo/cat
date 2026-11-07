/* [system-color-scheme/3b] 设置页首帧脚本：<head> 里同步（classic、非 module / defer / async）执行，在首次 paint 之前把缓存里钉住的外观模式写到 <html data-theme>。
 * 构建产物 options-theme-head.js（build.ts 的入口列表）；只依赖 AppearanceCache（无其它 import）。auto / 无缓存 = 什么都不做。 */
import { applyCachedTheme } from "@api/AppearanceCache";

applyCachedTheme(document.documentElement);

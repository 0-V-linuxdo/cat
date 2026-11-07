/* 最近一次导入的内存快照（只在内存里：不进 storage、不落盘；面板停用 / 关闭即丢）。单独成模块，让 index.ts 的清理函数不必加载重模块。 */
import type { Snapshot } from "./apply";
let last: Snapshot | null = null;
export const getSnapshot = () => last;
export const setSnapshot = (s: Snapshot | null) => { last = s; };
export const dropSnapshot = () => { last = null; };

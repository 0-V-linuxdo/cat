/* 页内侧边栏：早实例的「登记簿」（补丁 inpage-residual；纯逻辑，无 chrome / DOM 依赖）。
 * entries/content.ts 在 bootstrap 之前调 runEarly（earlyEntry.ts）：有提示就先起一个 startContent({early})；之后 bootstrap 走完设置 / Init 阶段，
 * 插件的 content.start 先 adoptEarly（接管这个早实例：不重建宿主 / iframe），没有早实例才走原来的 startContent()。
 * 同一个 content.js 包里的模块级变量（不用全局：页面看不到、也不依赖两个脚本共享隔离世界）。 */
export interface EarlyHandle {
    alive(): boolean;
    stop(): void;
    /** 接管：把主脚本（i18n 已注册）的翻译函数交给早实例 */
    adopt(t: (key: string) => string): void;
}

let current: EarlyHandle | undefined;
export const registerEarly = (h: EarlyHandle) => { current = h; };
export const clearEarly = (h: EarlyHandle) => { if (current === h) current = undefined; };
/** 主脚本的 content.start：有活着的早实例就接管（返回它的清理函数），没有返回 undefined（调用方走 startContent） */
export function adoptEarly(trFn: (key: string) => string): (() => void) | undefined {
    const e = current;
    if (!e?.alive()) return undefined;
    e.adopt(trFn);
    return e.stop;
}

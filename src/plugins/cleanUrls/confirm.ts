/* 快捷键复制的「确认成功后才提示」逻辑（纯函数，可单测）。 */

/** 命令返回值 → 是否确认复制成功（核心 tabActions copyUrl：成功返回复制的文本，失败返回 false / undefined） */
export const copySucceeded = (r: unknown) => typeof r === "string" && r.length > 0;

/** 记录一次命令执行期间变换是否有改动；wrap 后的命令只在「有改动 + 已确认写入成功」时调用 onConfirmed */
export function createCopyTracker() {
    let changed = false;
    return {
        markChanged() { changed = true; },
        wrap(run: (arg?: unknown) => unknown, onConfirmed: () => void) {
            return async (arg?: unknown) => {
                changed = false;
                try {
                    const r = await run(arg);
                    if (changed && copySucceeded(r)) onConfirmed();
                    return r;
                } finally { changed = false; }
            };
        },
    };
}

/* 命令栏的「手势时刻」与「一次性提交」（patch 08，纯逻辑，单测 tests/popupGuards.test.ts）。
 *
 * ① 手势时刻：回车（keydown）/ 点行（click）是用户手势；但回车时结果可能还是 stale，要 `await waitFresh()` 之后才执行，tab: 行的 run 里还有别的 await。
 *    手势时刻在**第一个同步时刻**（keydown / click 处理器入口）取，用 withGesture(at, fn) 让 fn **同步段**里的 ensureNativeAck / navigateAfterNative 通过 gestureNow() 读到它，
 *    传给 helper 的 gestureAt，超过 NATIVE_GESTURE_BUDGET_MS（3000 ms）就降级：不发那条注定失败的消息，直接导航。
 * ② 一次性提交：弹窗里 go() 在发了 ensure-native 后要等 ack（≤ 500 ms）才导航，等待期间再按回车 / 再点一行 = 导航两次或建两个标签。
 *    提交（回车 / 点行）之后整个命令栏实例不再接受第二次提交（含 stale 等待期间的第二次回车）；同步抛错或等待被拒绝才释放。 */

let slot: number | undefined;
/** 当前同步调用栈里「这次提交」的手势时刻；不在 withGesture 里 = undefined（不判预算，行为同 07 之前） */
export const gestureNow = (): number | undefined => slot;
export function withGesture<T>(at: number, fn: () => T): T {
    const prev = slot; slot = at;
    try { return fn(); } finally { slot = prev; }
}

export interface Committer {
    /** 第一次返回 true 并执行 fn（有 wait 就等它 resolve 之后）；已提交过返回 false，什么都不做。fn 总在 withGesture(at, …) 里同步执行 */
    press(at: number, fn: () => void, wait?: Promise<unknown>): boolean;
    /** 提交后发现什么都没做（例如空输入回车）→ 释放，让用户可以继续输入 */
    release(): void;
    readonly committed: boolean;
}
export function createCommitter(): Committer {
    let c = false;
    const run = (at: number, fn: () => void) => { try { withGesture(at, fn); } catch (e) { c = false; throw e; } };
    return {
        press(at, fn, wait) {
            if (c) return false;
            c = true;
            if (wait) void wait.then(() => run(at, fn), () => { c = false; }); else run(at, fn);
            return true;
        },
        release() { c = false; },
        get committed() { return c; },
    };
}

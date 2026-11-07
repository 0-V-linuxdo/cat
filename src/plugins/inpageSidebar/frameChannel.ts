/* 补丁 rel66-postmessage-origin：宿主 → 侧栏 iframe 的 postMessage 只发给「已握手」的那个窗口。
 * 根因（rel66-logs/rootcause.md）：iframe 刚插进页面、还没导航到 chrome-extension://…/sidepanel.html 时，contentWindow 是继承页面源的初始 about:blank；
 * 这时 postMessage(msg, 扩展源) 不会抛异常（try/catch 接不住），而是由浏览器往控制台记一条
 * “Failed to execute 'postMessage' on 'DOMWindow': The target origin provided (…) does not match the recipient window's origin (…)”，进扩展错误列表。
 * 规则：
 *  - 只有 ready(win) 认定过的窗口（宿主在 onWindowMessage 里已核对 e.source === iframe.contentWindow 且 e.origin === 扩展源）才直接发；
 *  - 其余（还没握手 / iframe 被页面删掉后重挂、换了新的浏览上下文 / 文档仍与页面同源）一律不发、不抛、不记日志，按 key 只留最新一条，握手后按顺序补发；
 *  - targetOrigin 永远是扩展源，绝不放宽成 "*"。 */

/** postMessage 的最小形状（便于单测） */
export interface FrameWindowLike { postMessage(message: unknown, targetOrigin: string): void }

export interface FrameChannelDeps {
    /** 当前 iframe 的 contentWindow（没有 iframe / 已脱离文档 = null / undefined） */
    win: () => FrameWindowLike | null | undefined;
    /** 扩展源，例如 chrome-extension://<id>；只会用它做 targetOrigin */
    origin: string;
    /** iframe 的文档能被宿主读到 = 与页面同源（初始 about:blank / 还没导航）→ 一定不是扩展页。跨源时 contentDocument 为 null，读它不抛、不记日志 */
    sameOriginDoc?: () => boolean;
}

export interface FrameChannel {
    /** 已握手且窗口没换：立即发，返回 true；否则按 key 排队（同 key 只留最新），返回 false */
    post(key: string, message: unknown): boolean;
    /** 收到来自 win 的 ready（调用方已核对 source / origin）：认定该窗口，按入队顺序补发；win 不是当前 contentWindow = 忽略 */
    ready(win: unknown): boolean;
    /** iframe 销毁：清掉认定的窗口和队列 */
    reset(): void;
    /** 当前 contentWindow 就是已握手的窗口（且文档不与页面同源） */
    isReady(): boolean;
    /** 队列里的 key（单测 / 追踪用） */
    pendingKeys(): string[];
}

export function createFrameChannel(d: FrameChannelDeps): FrameChannel {
    if (!d.origin || d.origin === "*") throw new Error("frameChannel: targetOrigin must be the extension origin");
    let readyWin: FrameWindowLike | null = null;
    const queue = new Map<string, unknown>();
    const live = (): FrameWindowLike | null => {
        const w = d.win();
        if (!w || w !== readyWin) return null;
        if (d.sameOriginDoc?.()) return null; // 同一浏览上下文里又回到了与页面同源的文档（理论上不会）：不发
        return w;
    };
    const send = (w: FrameWindowLike, m: unknown) => { try { w.postMessage(m, d.origin); return true; } catch { return false; /* 窗口已销毁：下次 ready 再发 */ } };
    return {
        post(key, message) {
            const w = live();
            if (!w) { queue.delete(key); queue.set(key, message); return false; } // 重新入队 = 排到最后（保持“最近一次变化最后到”）
            return send(w, message);
        },
        ready(win) {
            const w = d.win();
            if (!w || w !== win) return false;
            readyWin = w;
            const items = [...queue.values()]; queue.clear();
            for (const m of items) send(w, m);
            return true;
        },
        reset() { readyWin = null; queue.clear(); },
        isReady: () => !!live(),
        pendingKeys: () => [...queue.keys()],
    };
}

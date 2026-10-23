/* panel/content → background 的请求-响应调用（扩展里的“跨上下文 API”） */
import { Logger } from "@utils/Logger";

const RPC = "arc-sidebar:rpc";
const logger = new Logger("RPC");
type Fn = (args: unknown[], sender: chrome.runtime.MessageSender) => unknown;
const handlers = new Map<string, Fn>();

export function handle(method: string, fn: Fn): () => void {
    handlers.set(method, fn);
    return () => { if (handlers.get(method) === fn) handlers.delete(method); };
}

export async function call<T = unknown>(method: string, ...args: unknown[]): Promise<T> {
    // service worker 刚重载时可能还没注册监听：对 “Receiving end does not exist” 短暂重试
    let res: { result?: unknown; error?: string } | undefined;
    for (let i = 0; ; i++) {
        try { res = await chrome.runtime.sendMessage({ type: RPC, method, args }); break; } catch (e) {
            if (i >= 5 || !/Receiving end does not exist|Could not establish connection/.test(String((e as Error)?.message))) throw e;
            await new Promise(r => setTimeout(r, 150 * (i + 1)));
        }
    }
    if (res?.error) throw new Error(res.error);
    return res?.result as T;
}

export function serveRpc() {
    chrome.runtime.onMessage.addListener((msg, sender, respond) => {
        if (msg?.type !== RPC) return;
        const fn = handlers.get(msg.method);
        if (!fn) return;
        Promise.resolve()
            .then(() => fn(msg.args ?? [], sender))
            .then(result => respond({ result }), e => { logger.error(msg.method, e); respond({ error: String(e?.message ?? e) }); });
        return true;
    });
}

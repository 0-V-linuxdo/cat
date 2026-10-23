/* 焦点 / 关闭 / 命令事件日志（实机排查用）：写到 storage.local 的 debug:focusLog:<where>，每个 key 最多 80 条。
 * 按 key 分队列，写入串行化，避免并发读改写丢条目。 */
const queues = new Map<string, string[]>();
let t: ReturnType<typeof setTimeout> | undefined;
let chain: Promise<void> = Promise.resolve();
export function flog(where: string, ev: string) {
    const key = `debug:focusLog:${where.split(":")[0]}`;
    const q = queues.get(key) ?? [];
    q.push(`${new Date().toISOString().slice(11, 23)} ${where} ${ev}`);
    queues.set(key, q);
    clearTimeout(t);
    t = setTimeout(() => {
        const batches = [...queues]; queues.clear();
        chain = chain.then(async () => {
            for (const [k, batch] of batches) {
                try {
                    const cur = ((await chrome.storage.local.get(k))[k] as string[] | undefined) ?? [];
                    await chrome.storage.local.set({ [k]: [...cur, ...batch].slice(-80) });
                } catch { /* 扩展已重载 */ }
            }
        });
    }, 120);
}

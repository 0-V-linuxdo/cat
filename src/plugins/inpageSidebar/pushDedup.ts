/* 补丁 inpage-parked-timers-stop：SW → 页内侧栏的状态推送去重（纯函数，便于单测）。
 * 同一个端口上，状态序列化后与上次真正发出的相同 → 不再发（返回 null）；force（hello 的应答 / 带 hint 的提示）永远发。
 * 返回要记录的 key（调用方在 postMessage 成功后写回 rec.sentKey）。不引入时间 / 序号字段，所以「状态没变」判得准。 */
export function nextPushKey(prev: string | undefined, state: object, force: boolean): string | null {
    const key = JSON.stringify(state);
    return !force && prev === key ? null : key;
}

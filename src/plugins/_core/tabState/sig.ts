/** 标签列表签名：去掉与侧栏无关、又会频繁变化的字段（width / height / sessionId）。签名相同 = 渲染结果相同，TabState 不必整屏重绘 */
export function tabsSig(tabs: readonly chrome.tabs.Tab[], windowId?: number): string {
    return JSON.stringify([windowId, tabs.map(t => { const { width: _w, height: _h, sessionId: _s, ...rest } = t as chrome.tabs.Tab & { sessionId?: string }; return rest; })]);
}

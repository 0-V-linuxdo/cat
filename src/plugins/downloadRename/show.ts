/* 在文件夹中显示下载，并确认成功。chrome.downloads.show 没有返回值，所以：
 * 先 downloads.search 确认该下载存在、exists 为 true、state 为 complete；再调用 show 并捕获异常。
 * 尽力而为：show 不带回调，事后读 lastError 永远是 undefined，平台检测不到 Finder / 资源管理器是否真的打开。纯逻辑，API 可注入以便测试。 */
export interface ShowApi {
    search(q: { id: number }): Promise<{ exists?: boolean; state?: string }[]>;
    show(id: number): void;
}

export const chromeShowApi = (): ShowApi => ({
    search: q => chrome.downloads.search(q),
    show: id => chrome.downloads.show(id),
});

export async function showDownloadVerified(id: number, api: ShowApi = chromeShowApi()): Promise<boolean> {
    let item: { exists?: boolean; state?: string } | undefined;
    try { [item] = await api.search({ id }); } catch { return false; }
    if (!item || item.exists !== true || item.state !== "complete") return false;
    try { api.show(id); } catch { return false; }
    return true;
}

/** “Download name reverted!” 只在复制和显示都成功时弹 */
export const shouldToastReverted = (copied: boolean, shown: unknown) => copied && shown === true;

/* 会话传递（SessionTransfer）导出的文件名：session-<host>-<ISO时间>.session / .arcsession（浏览器去重时可能再加 " (1)"）。
 * Download Rename 不碰它们：文件名里的站点与时间是用户找文件的依据，也不应该把含站点域名的名字发给 AI 模型。 */
export const SESSION_EXPORT_RE = /^session-.+\.(session|arcsession)$/i;
export const isSessionExport = (base: string) => SESSION_EXPORT_RE.test(base);

/* 本扩展的 blob:chrome-extension://<自己的 id>/… 下载（会话导出 saveBytes 的两条路径都是这种 url）。
 * 更正（rel61，Chrome 156 有头实测 H10c）：只要有 onDeterminingFilename 监听器，chrome.downloads.download({ filename }) 指定的
 * filename 就会丢——监听器 return false 和无参 suggest() 一样落到浏览器生成名（blob → uuid），"整体放行"保不住名字。
 * 保名靠 @utils/ownDownload 登记的意图（DownloadRename 取出后 suggest({ filename })）；这里只用于"没有登记"的本扩展 blob
 * （<a download> 路径：item.filename 已是 download 属性的名字）不改名。页面发起的 <a download> 仍按文件名规则判断。 */
export const isOwnBlobDownload = (item: { url?: string; finalUrl?: string }, extId?: string): boolean => {
    if (!extId) return false;
    const pre = `blob:chrome-extension://${extId}/`;
    return !!item.url?.startsWith(pre) || !!item.finalUrl?.startsWith(pre);
};

/* 本扩展发起的下载：byExtensionId === 自己，或本扩展 blob。
 * 更正（rel61）：原注释说扩展指定名是"创建者建议"、return false 不 suggest 就能保住——Chrome 156 实测不成立：有监听器时
 * 扩展指定名（连同 "Captures/" 子目录）被丢掉，return false / 无参 suggest() 得到 "download.png" / uuid；而且 156 上
 * byExtensionId 是空串，Capture 的 data: 下载这里认不出来。保名改由 @utils/ownDownload 的意图登记完成；
 * 本函数只决定"未登记的本扩展下载不改名"。 */
export const isOwnDownload = (item: { url?: string; finalUrl?: string; byExtensionId?: string }, extId?: string): boolean =>
    !!extId && (item.byExtensionId === extId || isOwnBlobDownload(item, extId));

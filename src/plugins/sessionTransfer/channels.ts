/* 传输通道扩展点（预留，当前没有任何通道）。
 * 复制 / 粘贴（令牌）与导出 / 导入（文件）是内置的两条通道；以后新增通道（例如 WebDAV，DESIGN v3 §5A / 补丁 3）只需要：
 *   1. 新建 webdav/ 目录，在里面 registerChannel({...})；通道的设置子开关加在 settings.ts 里标注的位置（开关关闭时 enabled() 返回 false → 面板不画按钮）；
 *   2. 在 index.ts 的 panel.start() 里（标注的位置）调用通道的注册函数，并把清理函数放进返回数组；
 *   3. 通道只拿到 container.ts 打包后的密文字节（pack() 的输出），不接触明文载荷。
 * 本文件很轻（无 chrome / DOM 依赖），section.ts 静态引入它来画按钮；通道的重代码应在 run() 里 import()。 */
export interface Channel {
    id: string;
    /** i18n 键：按钮文字 */
    label: string;
    /** data-test */
    test: string;
    /** 子开关是否打开（关闭时不画按钮、不加载代码） */
    enabled(): boolean;
    /** 点击后执行（面板已关闭）；tab = 当前标签页 */
    run(tab: chrome.tabs.Tab): void | Promise<void>;
}

const reg = new Map<string, Channel>();
export const registerChannel = (c: Channel): (() => void) => { reg.set(c.id, c); return () => { reg.delete(c.id); }; };
export const activeChannels = (): Channel[] => [...reg.values()].filter(c => c.enabled());

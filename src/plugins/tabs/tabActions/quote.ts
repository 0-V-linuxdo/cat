/** Share Quote 的可移植版：选中文字右键「复制高亮链接」（文本片段 URL，打开即滚动并高亮） */
export const quoteUrl = (url: string, text: string) => `${url.replace(/#.*$/, "")}#:~:text=${encodeURIComponent(text.trim().replace(/\s+/g, " ").slice(0, 300)).replace(/-/g, "%2D")}`;


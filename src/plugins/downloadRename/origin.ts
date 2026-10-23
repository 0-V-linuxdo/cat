/* 发起下载的标签：只按下载的 referrer 精确匹配标签 URL。对应不上（或多个标签标题不一致）就返回 undefined，
 * 绝不回退到当前激活的其他标签。纯函数，可单测。 */
export function originTabTitle(referrer: string | undefined, tabs: { url?: string; title?: string }[]): string | undefined {
    if (!referrer) return undefined;
    const titles = [...new Set(tabs.filter(t => t.url === referrer && t.title).map(t => t.title!))];
    return titles.length === 1 ? titles[0] : undefined;
}

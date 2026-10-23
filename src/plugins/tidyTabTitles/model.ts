/* 第二层：模型改写。提示词逐字用 Arc 原文（arc-analysis/tidy-tabs.md §B，字符串 537034–537046）。
 * 原文里 `<title>` 后面的 “…” 和 “(<site>)” 是运行时插值处；“…” 后面具体还有什么：源码未找到，这里只插标题。 */
import { chatJson, type Fetcher, type LlmConfig, parseJsonContent } from "../_shared/llm";

export function buildPrompt(p: { title: string; site: string; language: string }): string {
    return `You are a perfect editor, summarizer and translator.
I am bookmarking a tab in my browser.
The title is \`${p.title}\`
- Remove the name of the site (${p.site}), if it's not the only thing there).
- Remove other SEO cruft
- Don't make the title too general. As specific as possible without going over the word count.
- If the page is about a proper noun (personal site, restaurant homepage, brand homepage), the new title should always include the proper noun along with context. For example, "Individualized Eng Expectations - Anna Delvey" would translate to "Anna's Eng Expectations", and "Arc by the Browser Company: Monetization Strategy" would translate to "Arc Monetization".
- Remove words that describe the 'kind of page' (video, recipe, guide, etc)
- Err on the side of keeping the subject, main verb, and direct object. Remove other parts of speech.
Return a response using JSON, according to this schema:
    filtered: string // The title translated and filtered to remove the cruft. No word limit.
    rewritten: string // The title rewritten in 1-3 words
Write responses (but not JSON keys) in ${p.language}`;
}

export interface TidyResult { filtered: string; rewritten: string }

/** 校验：rewritten 必须非空、1-3 个词（按空白分词；CJK 无空格算 1 个）；否则视为 generationFailed → null */
export function validateTidy(raw: unknown): TidyResult | null {
    const o = parseJsonContent(raw);
    if (!o) return null;
    const rewritten = typeof o.rewritten === "string" ? o.rewritten.replace(/\s+/g, " ").trim() : "";
    const filtered = typeof o.filtered === "string" ? o.filtered.replace(/\s+/g, " ").trim() : "";
    if (!rewritten) return null;
    const words = rewritten.split(" ").length;
    if (words < 1 || words > 3) return null;
    return { filtered, rewritten };
}

export async function modelTidy(input: { title: string; site: string }, cfg: LlmConfig & { language: string }, fetcher?: Fetcher): Promise<TidyResult | null> {
    if (!input.title.trim()) return null;
    const content = await chatJson(buildPrompt({ ...input, language: cfg.language }), cfg, fetcher);
    return content == null ? null : validateTidy(content);
}

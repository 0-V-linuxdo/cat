/* 模型模式：OpenAI 兼容接口，提示词逐字用 Arc 原文（arc-analysis/download-rename.md §3）。 */
import { chatJson, type Fetcher, type LlmConfig } from "../_shared/llm";
import { keepExt } from "./rules";

export const ARC_PROMPT = `I am downloading a file. Rewrite its filename to be helpful, concise and readable. 2-4 words.
- Keep informative names mostly the same. For non-informative names, add information from the tab title or website.
- Remove machine-generated cruft, like IDs, (1), (copy), etc.
- Clean up messy text, especially dates. Make timestamps concise, human readable, and remove seconds.
- Clean up text casing and letter spacing to make it easier to read.
Some examples, in the form "original name, tab title, domain -> new name"
- 'Arc-1.6.0-41215.dmg', 'Arc from The Browser Company', 'arc.net' -> 'Arc 1.6.0 41215.dmg' (same info, easier to read)
- 'swift-chat-main.zip', 'huggingface/swift-chat: Mac app to demonstrate swift-transformers', 'github.com' -> 'swift-chat main.zip' (same info, easier to read)
- 'folio_option3_6691488.PDF', 'Your Guest Stay Folio from the LINE LA 08-14-23', 'mail.google.com' -> 'Line LA Folio, Aug 14.pdf' (remove ID numbers, make easier to read, add helpful info from tab title)
- 'image.png', 'Feedback: Card border radius - nateparro2t@gmail.com - Gmail', 'mail.google.com' -> 'Card border radius feedback.png' (remove non-useful words like 'image', add helpful info from tab title)
- 'Brooklyn_Bridge_September_2022_008.jpg', 'nyc bridges - Google Images', 'images.google.com' -> 'Brooklyn Bridge Sept 2022.jpg' (keep useful information, clean up formatting, remove '008' ID)
- 'AdobeStock_184679416.jpg', 'ladybug - Google Images', 'images.google.com' -> 'Ladybug.jpg' (add info from title, remove 'AdobeStock' cruft)
- 'CleanShot 2023-08-17 at 19.51.05@2x.png', 'dogfooding - The Browser Company - Slack', 'app.slack.com' -> 'CleanShot Aug 17 from dogfooding.png' (keep useful info, trim date, add source from title)
- 'Screenshot 2023-09-26 at 11.12.18\u202fPM', 'DM with Nate - Twitter', 'twitter.com' -> 'Sept 26 Screenshot from Nate.png' (keep useful info, trim date, add source from title)
- 'image0.png', 'Nate - Slack', 'files.slack.com' -> 'Image from Nate via Slack.png' (add info from title)
Return a response using JSON, according to this schema:
    newName: string // The new filename
Write responses (but not JSON keys) in {language}
Original filename: '{filename}'
Source tab title: '{title}'
Source domain: '{domain}'`;

export function buildPrompt(p: { filename: string; title?: string; domain?: string; language: string }): string {
    return ARC_PROMPT.replace("{language}", p.language).replace("{filename}", p.filename).replace("{title}", p.title ?? "").replace("{domain}", p.domain ?? "");
}

/** 校验模型输出：取 newName；空或以 "." 开头视为失败（Arc 同规则）；强制原扩展名；非法字符清掉 */
export function validateModelName(original: string, raw: unknown): string | null {
    let obj: unknown = raw;
    if (typeof raw === "string") { try { obj = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, "")); } catch { return null; } }
    const n = (obj as { newName?: unknown } | null)?.newName;
    if (typeof n !== "string") return null;
// eslint-disable-next-line no-control-regex
    const clean = n.replace(/[\\/:*?"<>|]/g, " ").replace(/\p{Cc}/gu, " ").replace(/\s+/g, " ").trim();
    if (!clean || clean.startsWith(".")) return null;
    return keepExt(original, clean);
}

export interface ModelConfig extends LlmConfig { language: string }
export type { Fetcher };

/** 调模型；超时 / 出错 / 校验失败都返回 null（由调用方回退） */
export async function modelRename(input: { filename: string; title?: string; domain?: string }, cfg: ModelConfig, fetcher: Fetcher = fetch): Promise<string | null> {
    const content = await chatJson(buildPrompt({ ...input, language: cfg.language }), cfg, fetcher);
    return content == null ? null : validateModelName(input.filename, content);
}

/** 总控：模型模式失败回退规则模式；结果和原名相同返回 null */
export async function decideName(input: { filename: string; title?: string; domain?: string }, opts: { useModel: boolean; cfg: ModelConfig; fallbackToRules: boolean; rule: (i: typeof input) => string; fetcher?: Fetcher }): Promise<string | null> {
    let name: string | null = null;
    if (opts.useModel) name = await modelRename(input, opts.cfg, opts.fetcher);
    if (name == null && (!opts.useModel || opts.fallbackToRules)) name = opts.rule(input);
    return name && name !== input.filename ? name : null;
}

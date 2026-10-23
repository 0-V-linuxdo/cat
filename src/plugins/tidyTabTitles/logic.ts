/* 总流程（Arc AIRenameTabsFeature）：用户已改过名 → userAlreadyRenamed，不动；站点规则 → 模型；都失败 → generationFailed。 */
import type { Fetcher, LlmConfig } from "../_shared/llm";
import { modelTidy } from "./model";
import { applyTidyTitleRules, type TidyTitleConfiguration } from "./rules";

export type TidyOutcome =
    | { ok: true; title: string; source: "rule" | "model" }
    | { ok: false; error: "userAlreadyRenamed" | "generationFailed" };

export const siteOf = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } };

export async function tidyTitle(
    input: { url: string; title: string; userRenamed: boolean },
    opts: { cfg: LlmConfig & { language: string }; rules?: TidyTitleConfiguration[]; fetcher?: Fetcher },
): Promise<TidyOutcome> {
    if (input.userRenamed) return { ok: false, error: "userAlreadyRenamed" };
    const byRule = applyTidyTitleRules(input.url, input.title, opts.rules);
    if (byRule) return { ok: true, title: byRule, source: "rule" };
    const m = await modelTidy({ title: input.title, site: siteOf(input.url) }, opts.cfg, opts.fetcher);
    if (m && m.rewritten !== input.title) return { ok: true, title: m.rewritten, source: "model" };
    return { ok: false, error: "generationFailed" };
}

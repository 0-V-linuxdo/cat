import { describe, expect, test } from "bun:test";
import { chatUrl, type Fetcher } from "../src/plugins/_shared/llm";
import { coreReady } from "../src/plugins/tidyTabTitles/coreHooks";
import { STRINGS } from "../src/plugins/tidyTabTitles/i18n";
import { siteOf, tidyTitle } from "../src/plugins/tidyTabTitles/logic";
import { buildPrompt, validateTidy } from "../src/plugins/tidyTabTitles/model";
import { applyTidyTitleRules, BUNDLED_TIDY_TITLES, type TidyTitleConfiguration } from "../src/plugins/tidyTabTitles/rules";

const cfg = { endpoint: "https://api.example.com/v1", model: "m", apiKey: "k", timeoutMs: 50, language: "English" };
const reply = (content: string): Fetcher => async () => ({ ok: true, json: async () => ({ choices: [{ message: { content } }] }) });
const hang: Fetcher = () => new Promise(() => {});

describe("站点规则（数据源码未找到）", () => {
    test("内置规则为空", () => expect(BUNDLED_TIDY_TITLES).toEqual([]));
    test("空规则不命中", () => expect(applyTidyTitleRules("https://github.com/a/b", "a/b: desc")).toBeNull());
    const rules: TidyTitleConfiguration[] = [{ siteName: "Ex", host: "example.com", rules: [
        { match: { type: "pathEquals", value: "/inbox" }, title: { type: "always", title: "Inbox" } },
        { match: { type: "pathContainsRegex", value: "^/doc/" }, title: { type: "removingPattern", pattern: " - Ex Docs$" } },
        { match: { type: "fragmentEquals", value: "settings" }, title: { type: "removingPatterns", patterns: ["^Ex: ", " \\(\\d+\\)$"] } },
        { match: { type: "fragmentContainsRegex", value: "^bad[" }, title: { type: "always", title: "X" } },
    ] }];
    test("四种匹配 + 三种修改（接口可用）", () => {
        expect(applyTidyTitleRules("https://www.example.com/inbox", "whatever", rules)).toBe("Inbox");
        expect(applyTidyTitleRules("https://example.com/doc/1", "Intro - Ex Docs", rules)).toBe("Intro");
        expect(applyTidyTitleRules("https://app.example.com/#settings", "Ex: Settings (3)", rules)).toBe("Settings");
        expect(applyTidyTitleRules("https://example.com/other#bad", "t", rules)).toBeNull(); // 非法正则不抛
        expect(applyTidyTitleRules("https://other.com/inbox", "t", rules)).toBeNull();
        expect(applyTidyTitleRules("not a url", "t", rules)).toBeNull();
    });
});

describe("模型", () => {
    test("提示词逐字含 Arc 原文并插值", () => {
        const p = buildPrompt({ title: "Individualized Eng Expectations - Anna Delvey", site: "notion.so", language: "English" });
        expect(p.startsWith("You are a perfect editor, summarizer and translator.\nI am bookmarking a tab in my browser.\nThe title is `Individualized Eng Expectations - Anna Delvey`")).toBe(true);
        expect(p).toContain("- Remove the name of the site (notion.so), if it's not the only thing there).");
        expect(p).toContain("    rewritten: string // The title rewritten in 1-3 words\nWrite responses (but not JSON keys) in English");
    });
    test("校验 filtered / rewritten", () => {
        expect(validateTidy('{"filtered":"Arc Monetization Strategy","rewritten":"Arc Monetization"}')).toEqual({ filtered: "Arc Monetization Strategy", rewritten: "Arc Monetization" });
        expect(validateTidy('```json\n{"filtered":"x","rewritten":"  Anna\'s  Eng Expectations "}\n```')?.rewritten).toBe("Anna's Eng Expectations");
        expect(validateTidy('{"rewritten":"中文标题"}')?.rewritten).toBe("中文标题");
    });
    test("空 / 超过 3 个词 / 非 JSON / 缺字段 → null", () => {
        for (const v of ['{"rewritten":""}', '{"rewritten":"one two three four"}', "nope", '{"filtered":"x"}', '{"rewritten":5}']) expect(validateTidy(v)).toBeNull();
    });
    test("共用工具 chatUrl", () => {
        expect(chatUrl("https://a.com/v1/")).toBe("https://a.com/v1/chat/completions");
        expect(chatUrl("https://a.com/v1/chat/completions")).toBe("https://a.com/v1/chat/completions");
    });
});

describe("总流程", () => {
    const rules: TidyTitleConfiguration[] = [{ siteName: "Ex", host: "example.com", rules: [{ match: { type: "pathEquals", value: "/" }, title: { type: "always", title: "Home" } }] }];
    test("用户已改名 → userAlreadyRenamed，不调用模型", async () => {
        let called = false;
        const f: Fetcher = async (u, i) => { called = true; return reply("{}")(u, i); };
        expect(await tidyTitle({ url: "https://a.com", title: "T", userRenamed: true }, { cfg, fetcher: f })).toEqual({ ok: false, error: "userAlreadyRenamed" });
        expect(called).toBe(false);
    });
    test("规则优先于模型", async () => {
        expect(await tidyTitle({ url: "https://example.com/", title: "Long", userRenamed: false }, { cfg, rules, fetcher: hang })).toEqual({ ok: true, title: "Home", source: "rule" });
    });
    test("规则未命中走模型", async () => {
        expect(await tidyTitle({ url: "https://arc.net/x", title: "Arc by the Browser Company: Monetization Strategy", userRenamed: false }, { cfg, fetcher: reply('{"filtered":"Arc Monetization Strategy","rewritten":"Arc Monetization"}') }))
            .toEqual({ ok: true, title: "Arc Monetization", source: "model" });
    });
    test("模型超时 / 未配置 → generationFailed", async () => {
        expect(await tidyTitle({ url: "https://a.com", title: "T", userRenamed: false }, { cfg, fetcher: hang })).toEqual({ ok: false, error: "generationFailed" });
        expect(await tidyTitle({ url: "https://a.com", title: "T", userRenamed: false }, { cfg: { ...cfg, endpoint: "" }, fetcher: reply('{"rewritten":"X"}') })).toEqual({ ok: false, error: "generationFailed" });
    });
    test("siteOf", () => { expect(siteOf("https://www.youtube.com/watch")).toBe("youtube.com"); expect(siteOf("bad")).toBe(""); });
});

describe("核心接口与文案", () => {
    test("核心还没有固定标签标题接口时降级", () => expect(coreReady()).toBe(false));
    test("中英键一致，含 Arc 原文菜单项", () => {
        expect(Object.keys(STRINGS.en).toSorted()).toEqual(Object.keys(STRINGS.zh).toSorted());
        expect(STRINGS.en["tidyTabTitles.reset"]).toBe("Reset Name and Icon");
    });
});

import { describe, expect, test } from "bun:test";
import { buildPrompt, decideName, modelRename, validateModelName, type Fetcher, type ModelConfig } from "../src/plugins/downloadRename/model";
import { keepExt, ruleRename as r, splitExt } from "../src/plugins/downloadRename/rules";
import { STRINGS } from "../src/plugins/downloadRename/i18n";

describe("规则模式", () => {
    const cases: [string, string, string?][] = [
        ["report (1).pdf", "report.pdf"],
        ["Budget (copy).xlsx", "Budget.xlsx"],
        ["Notes - Copy.docx", "Notes.docx"],
        ["Copy of Plan.pptx", "Plan.pptx"],
        ["Arc-1.6.0-41215.dmg", "Arc 1.6.0 41215.dmg"],
        ["folio_option3_6691488.PDF", "folio option3.PDF"],
        ["Brooklyn_Bridge_September_2022_008.jpg", "Brooklyn Bridge September 2022.jpg"],
        ["AdobeStock_184679416.jpg", "Ladybug.jpg", "ladybug - Google Images"],
        ["CleanShot 2023-08-17 at 19.51.05@2x.png", "CleanShot Aug 17 2023 19.51.png"],
        ["Screenshot 2023-09-26 at 11.12.18\u202fPM.png", "Screenshot Sept 26 2023 11.12 PM.png"],
        ["image.png", "Card border radius feedback.png", "Card border radius feedback - Gmail"],
        ["image0.png", "Nate.png", "Nate - Slack"],
        ["invoice_20240315.pdf", "invoice Mar 15 2024.pdf"],
        ["export_3f2b8c1e-9d4a-4b6e-8f1a-2c3d4e5f6a7b.csv", "export.csv"],
        ["data.tar.gz", "data.tar.gz"],
        ["swift-chat-main.zip", "swift-chat-main.zip"],
    ];
    for (const [from, to, title] of cases) test(`${from} → ${to}`, () => expect(r({ filename: from, title })).toBe(to));
    test("无信息量的截图名加来源", () => {
        expect(r({ filename: "Screenshot.png", title: "DM with Nate - Twitter" })).toBe("Screenshot from DM with Nate.png");
    });
    test("清理后为空时保留原名", () => {
        expect(r({ filename: "123456789.pdf" })).toBe("123456789.pdf");
    });
    test("非法字符清掉", () => {
        expect(r({ filename: "a:b*c?.txt" })).toBe("a b c.txt");
    });
});

describe("扩展名保留", () => {
    test("splitExt", () => {
        expect(splitExt("a.tar.gz")).toEqual(["a", ".tar.gz"]);
        expect(splitExt("README")).toEqual(["README", ""]);
    });
    test("模型漏掉 / 改掉扩展名时补回原扩展名", () => {
        expect(keepExt("x.PDF", "Line LA Folio")).toBe("Line LA Folio.PDF");
        expect(keepExt("x.PDF", "Line LA Folio.pdf")).toBe("Line LA Folio.PDF");
        expect(keepExt("x.png", "Shot.jpg")).toBe("Shot.jpg.png");
        expect(keepExt("README", "Readme notes")).toBe("Readme notes");
    });
});

describe("模型结果校验", () => {
    test("取 newName 并补扩展名", () => {
        expect(validateModelName("a.pdf", '{"newName":"Line LA Folio, Aug 14.pdf"}')).toBe("Line LA Folio, Aug 14.pdf");
        expect(validateModelName("a.pdf", '```json\n{"newName":"X"}\n```')).toBe("X.pdf");
    });
    test("空 / 以 . 开头 / 非 JSON / 缺字段 → null", () => {
        for (const v of ['{"newName":""}', '{"newName":"  "}', '{"newName":".hidden"}', "nope", '{"name":"x"}', '{"newName":3}']) expect(validateModelName("a.pdf", v)).toBeNull();
    });
    test("提示词逐字含 Arc 原文并填入参数", () => {
        const p = buildPrompt({ filename: "a.pdf", title: "T", domain: "d.com", language: "English" });
        expect(p.startsWith("I am downloading a file. Rewrite its filename to be helpful, concise and readable. 2-4 words.")).toBe(true);
        expect(p).toContain("Write responses (but not JSON keys) in English\nOriginal filename: 'a.pdf'\nSource tab title: 'T'\nSource domain: 'd.com'");
        expect(p).toContain("11.12.18\u202fPM");
    });
});

const cfg: ModelConfig = { endpoint: "https://api.example.com/v1", model: "m", apiKey: "k", timeoutMs: 50, language: "English" };
const reply = (content: string): Fetcher => async () => ({ ok: true, json: async () => ({ choices: [{ message: { content } }] }) });
const hang: Fetcher = () => new Promise(() => {});

describe("模型调用与超时回退", () => {
    test("正常返回", async () => {
        let url = "", body = "";
        const f: Fetcher = async (u, init) => { url = u; body = String(init.body); return reply('{"newName":"Ladybug"}')(u, init); };
        expect(await modelRename({ filename: "AdobeStock_1.jpg" }, cfg, f)).toBe("Ladybug.jpg");
        expect(url).toBe("https://api.example.com/v1/chat/completions");
        expect(JSON.parse(body).model).toBe("m");
    });
    test("超时返回 null", async () => {
        const t = Date.now();
        expect(await modelRename({ filename: "a.pdf" }, cfg, hang)).toBeNull();
        expect(Date.now() - t).toBeLessThan(1000);
    });
    test("超时后回退规则模式", async () => {
        const rule = () => "rule.pdf";
        expect(await decideName({ filename: "a (1).pdf" }, { useModel: true, cfg, fallbackToRules: true, rule, fetcher: hang })).toBe("rule.pdf");
    });
    test("超时且不回退时保留原名（null）", async () => {
        expect(await decideName({ filename: "a (1).pdf" }, { useModel: true, cfg, fallbackToRules: false, rule: () => "x.pdf", fetcher: hang })).toBeNull();
    });
    test("HTTP 错误 / 未配置 → null", async () => {
        expect(await modelRename({ filename: "a.pdf" }, cfg, async () => ({ ok: false, json: async () => ({}) }))).toBeNull();
        expect(await modelRename({ filename: "a.pdf" }, { ...cfg, endpoint: "" }, reply('{"newName":"x"}'))).toBeNull();
    });
    test("规则模式结果与原名相同返回 null", async () => {
        expect(await decideName({ filename: "ok.pdf" }, { useModel: false, cfg, fallbackToRules: true, rule: () => "ok.pdf" })).toBeNull();
    });
});

describe("发起下载的标签", () => {
    test("只按 referrer 精确匹配，不回退到激活标签", async () => {
        const { originTabTitle } = await import("../src/plugins/downloadRename/origin");
        const tabs = [{ url: "https://a.com/p", title: "Origin", active: false }, { url: "https://b.com/", title: "Active", active: true }];
        expect(originTabTitle("https://a.com/p", tabs)).toBe("Origin");
        expect(originTabTitle("https://c.com/", tabs)).toBeUndefined();
        expect(originTabTitle(undefined, tabs)).toBeUndefined();
        expect(originTabTitle("https://a.com/p", [...tabs, { url: "https://a.com/p", title: "Other" }])).toBeUndefined();
    });
    test("没有标题时规则模式不补名字", () => {
        expect(r({ filename: "image.png" })).toBe("image.png");
        expect(r({ filename: "image.png", title: undefined })).toBe("image.png");
    });
});

describe("共用 API key", () => {
    const mem = () => { const m: Record<string, unknown> = {}; return { m, get: async (k: string) => (k in m ? { [k]: m[k] } : {}), set: async (o: Record<string, unknown>) => { Object.assign(m, o); }, remove: async (k: string) => { delete m[k]; } } as any; };
    test("读写单独的键，空值删除", async () => {
        const { getApiKey, setApiKey, API_KEY_STORAGE } = await import("../src/plugins/_shared/llm");
        const st = mem();
        expect(await getApiKey(st)).toBe("");
        await setApiKey(" sk-1 ", st);
        expect(st.m[API_KEY_STORAGE]).toBe("sk-1");
        await setApiKey("", st);
        expect(API_KEY_STORAGE in st.m).toBe(false);
        expect(API_KEY_STORAGE.startsWith("secret:")).toBe(true);
    });
    test("迁移旧设置：取第一个非空值，清掉旧字段；新键已有值时不覆盖", async () => {
        const { getApiKey, migrateLegacyApiKey } = await import("../src/plugins/_shared/llm");
        const legacy: Record<string, Record<string, unknown>> = { DownloadRename: { apiKey: "" }, TidyTabTitles: { apiKey: "sk-old" } };
        const read = (p: string) => legacy[p]?.apiKey, clear = (p: string) => { delete legacy[p].apiKey; };
        const st = mem();
        expect(await migrateLegacyApiKey(read, clear, st, null)).toBe(true);
        expect(await getApiKey(st)).toBe("sk-old");
        expect(legacy).toEqual({ DownloadRename: {}, TidyTabTitles: {} });
        const st2 = mem(); st2.m["secret:llmApiKey"] = "sk-new";
        const legacy2: Record<string, Record<string, unknown>> = { DownloadRename: { apiKey: "sk-x" }, TidyTabTitles: {} };
        expect(await migrateLegacyApiKey(p => legacy2[p]?.apiKey, p => { delete legacy2[p].apiKey; }, st2, null)).toBe(false);
        expect(await getApiKey(st2)).toBe("sk-new");
        expect(legacy2.DownloadRename).toEqual({});
    });
    test("51947 版 storage.local 的旧键迁到新位置并删除；新位置不可用时不删旧值", async () => {
        const { getApiKey, migrateLegacyApiKey, API_KEY_STORAGE } = await import("../src/plugins/_shared/llm");
        const st = mem(), local = mem(); local.m[API_KEY_STORAGE] = "sk-local";
        expect(await migrateLegacyApiKey(() => undefined, () => {}, st, local)).toBe(true);
        expect(await getApiKey(st)).toBe("sk-local");
        expect(API_KEY_STORAGE in local.m).toBe(false);
        const local2 = mem(); local2.m[API_KEY_STORAGE] = "sk-keep";
        expect(await migrateLegacyApiKey(() => undefined, () => {}, null, local2)).toBe(false);
        expect(local2.m[API_KEY_STORAGE]).toBe("sk-keep");
    });
    test("设置项：sensitive + 组件控件，说明里有明文提醒", async () => {
        const { apiKeySetting } = await import("../src/plugins/_shared/llm");
        expect(apiKeySetting("k")).toMatchObject({ description: "k", sensitive: true });
        expect(typeof apiKeySetting("k").component).toBe("function");
        expect(STRINGS.en["downloadRename.apiKey"]).toContain("plain text");
        expect(STRINGS.en["downloadRename.apiKey"]).not.toContain("backup");
        expect(STRINGS.zh["downloadRename.apiKey"]).toContain("明文");
    });
});

describe("文案", () => {
    test("中英键一致，含 Arc 原文", () => {
        expect(Object.keys(STRINGS.en).toSorted()).toEqual(Object.keys(STRINGS.zh).toSorted());
        expect(STRINGS.en["downloadRename.renamed"]).toBe("Download renamed!");
        expect(STRINGS.en["downloadRename.oldNameCopied"]).toBe("Original name copied");
        expect(STRINGS.zh["downloadRename.oldNameCopied"]).toBe("原文件名已复制");
        expect(STRINGS.en["downloadRename.reverted"]).toBe("Download name reverted!");
        expect(STRINGS.en["downloadRename.bannerTitle"]).toBe("Download renamed to:");
        expect(STRINGS.en["downloadRename.revert"]).toBe("Revert to original name");
    });
});

describe("在文件夹中显示：确认成功才弹 reverted", () => {
    const api = (o: { items?: { exists?: boolean; state?: string }[]; searchThrows?: boolean; showThrows?: boolean } = {}) => {
        const calls: number[] = [];
        return { calls, search: async () => { if (o.searchThrows) throw new Error("x"); return o.items ?? [{ exists: true, state: "complete" }]; }, show: (id: number) => { calls.push(id); if (o.showThrows) throw new Error("y"); } };
    };
    test("存在、exists、complete 且 show 无错 → true", async () => {
        const { showDownloadVerified } = await import("../src/plugins/downloadRename/show");
        const a = api();
        expect(await showDownloadVerified(5, a)).toBe(true);
        expect(a.calls).toEqual([5]);
    });
    test("不存在 / 文件已删 / 未完成时不调用 show", async () => {
        const { showDownloadVerified } = await import("../src/plugins/downloadRename/show");
        for (const items of [[], [{ exists: false, state: "complete" }], [{ exists: true, state: "in_progress" }], [{ exists: true, state: "interrupted" }]]) {
            const a = api({ items });
            expect(await showDownloadVerified(5, a)).toBe(false);
            expect(a.calls).toEqual([]);
        }
    });
    test("search 抛错 / show 抛错 → false（lastError 不可检测，不判断）", async () => {
        const { showDownloadVerified } = await import("../src/plugins/downloadRename/show");
        expect(await showDownloadVerified(5, api({ searchThrows: true }))).toBe(false);
        expect(await showDownloadVerified(5, api({ showThrows: true }))).toBe(false);
    });
    test("复制和显示都成功才弹", async () => {
        const { shouldToastReverted } = await import("../src/plugins/downloadRename/show");
        expect(shouldToastReverted(true, true)).toBe(true);
        expect(shouldToastReverted(false, true)).toBe(false);
        expect(shouldToastReverted(true, false)).toBe(false);
        expect(shouldToastReverted(true, undefined)).toBe(false);
    });
});

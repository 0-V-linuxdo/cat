/* 插件管理页卡片底部统一（用户 12:58）：所有可见插件卡片底部都显示功能标签，不再出现作者名 “Cat Contributors”。
 * 根因：options.ts card() 底部 = features 名称，没有 features 的插件（Adaptive / Clean URLs / Tab Sleep / Tidy Tabs / Tidy Tab Titles / Boosts / Capture / Tidy Downloads）回落成 authorsOf(p) = Devs.ArcSidebar = "Cat Contributors"。
 * 修复：PluginDef.featureTags（i18n 键）+ cardTags()（features 名 → featureTags → 插件名，永不回落成作者）。
 * ⛔ Arc 没有这张卡片（Rea 分析里没有插件管理页 / 卡片底部样式的依据），视觉保持现状，只统一内容来源。 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";

import { LOCALES, setLang } from "../src/api/i18n";
import { cardTags } from "../src/components/settings/utils";
import { Devs } from "../src/utils/constants";
import type { Plugin } from "../src/utils/types";

const dirs = readdirSync("src/plugins", { withFileTypes: true }).filter(e => e.isDirectory() && !e.name.startsWith("_") && !e.name.startsWith(".")).map(e => e.name).sort();
const listed: Plugin[] = [];
for (const d of dirs) {
    const m = await import(`../src/plugins/${d}/index.ts`);
    if (m.default && !m.default.hidden) listed.push(m.default as Plugin);
}

describe("插件卡片底部 = 功能标签", () => {
    test("扫到了全部可见插件（至少 14 个：Spaces / Command / Tabs / Views / Library / Data + 8 个可选插件）", () => {
        expect(listed.map(p => p.name)).toEqual(expect.arrayContaining(["Adaptive", "CleanUrls", "TabSleep", "TidyTabs", "TidyTabTitles", "Boosts", "Capture", "DownloadRename", "Views", "Library", "Data", "Spaces", "Command", "Tabs"]));
        expect(listed.length).toBeGreaterThanOrEqual(14);
    });
    for (const lang of ["en", "zh"] as const) test(`${lang}：每张卡片底部非空、不是作者名、没有重复 / 原始键`, () => {
        setLang(lang);
        for (const p of listed) {
            const tags = cardTags(p);
            expect(tags.length, p.name).toBeGreaterThan(0);
            const foot = tags.join(" · ");
            expect(foot.trim(), p.name).not.toBe("");
            expect(foot, p.name).not.toContain(Devs.ArcSidebar);
            expect(foot, p.name).not.toContain("Cat Contributors");
            for (const a of p.authors) expect(foot, p.name).not.toContain(a);
            for (const t of tags) { expect(t.trim(), p.name).not.toBe(""); expect(t, p.name).not.toMatch(/\.tag\./); } // 没有未翻译的键
            expect(new Set(tags).size, p.name).toBe(tags.length);
        }
    });
    test("没有 features 的插件必须显式写 featureTags（不靠回落到插件名），键在 en / zh 都有文字", () => {
        for (const p of listed.filter(x => !x.features?.length)) {
            expect(p.featureTags?.length ?? 0, p.name).toBeGreaterThan(0);
            for (const k of p.featureTags!) for (const lang of ["en", "zh"] as const) expect(LOCALES[lang][k], `${p.name} ${k} ${lang}`).toBeTruthy();
        }
    });
    test("有 features 的插件底部 = 各功能名（Views / Library / Data 不变）", () => {
        setLang("en");
        const by = Object.fromEntries(listed.map(p => [p.name, cardTags(p).join(" · ")]));
        expect(by.Views).toBe("Split View · Peek · Site Controls");
        expect(by.Library).toBe("Library View · Media Controls · Live Calendar");
        expect(by.Data).toBe("Backup");
    });
    test("options.ts 卡片底部不再回落到 authorsOf；底部取 cardTags", () => {
        const src = readFileSync("src/entries/options.ts", "utf8");
        const foot = src.match(/class: "arc-vcard-foot"[^\n]*/)![0];
        expect(foot).not.toContain("authorsOf");
        expect(src).toMatch(/featureNames = cardTags/);
    });
});

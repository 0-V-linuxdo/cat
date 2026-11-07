/* 插件配置对话框的设置行：标题 + 一句话说明；详细限制放 detail（悬停 ArcTooltip），不能把整行撑高。
 * 用户 bug：In-page Sidebar 的「Restricted-page warm-up」说明 669 个字符挤在左栏，行高 ≈ 450px。 */
import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";

import { LOCALES, setLang } from "../src/api/i18n";
import { settingText, settingTip } from "../src/components/settings/SettingField";
import { isVisibleSetting } from "../src/components/settings/SettingField";
import type { Plugin } from "../src/utils/types";

const dirs = readdirSync("src/plugins", { withFileTypes: true }).filter(e => e.isDirectory() && !e.name.startsWith("_") && !e.name.startsWith(".")).map(e => e.name).toSorted();
const plugins: Plugin[] = [];
for (const d of dirs) { const m = await import(`../src/plugins/${d}/index.ts`); if (m.default?.settings) plugins.push(m.default as Plugin); }
/* 上限（标题 + 说明 总字符数）：⛔ 无 Arc / Void++ 来源；取比现有最长的正常行略宽的值（修复后实测最长：en CleanUrls.extended 117、zh 同项 67；
 * 修复前 en TabSleep.closeTier 整句 149 当标题、InpageSidebar.prewarm 说明 669）。中文按字数。 */
const MAX = { en: { total: 130, tipLine: 140 }, zh: { total: 70, tipLine: 60 } } as const;

describe("设置行文字不撑高整行", () => {
    for (const lang of ["en", "zh"] as const) {
        test(`${lang}：每个可见设置项 标题 + 说明 ≤ ${MAX[lang].total}；detail 每行 ≤ ${MAX[lang].tipLine}，且最多 2 行（标题 + 副标题）`, () => {
            setLang(lang);
            const bad: string[] = [];
            for (const p of plugins) for (const [k, def] of Object.entries(p.settings!.def).filter(isVisibleSetting)) {
                const t = settingText(def, k);
                if (t.title.length + t.desc.length > MAX[lang].total) bad.push(`${p.name}.${k} 标题 + 说明 ${t.title.length + t.desc.length} 字`);
                if ((def as { detail?: string }).detail) {
                    const text = LOCALES[lang][(def as { detail: string }).detail];
                    if (!text) { bad.push(`${p.name}.${k} detail 缺 ${lang} 文案`); continue; }
                    const lines = text.split("\n");
                    if (lines.length > 2) bad.push(`${p.name}.${k} detail ${lines.length} 行（最多 2）`);
                    for (const l of lines) if (l.length > MAX[lang].tipLine) bad.push(`${p.name}.${k} detail 一行 ${l.length} 字`);
                }
            }
            expect(bad).toEqual([]);
        });
    }
    test("Restricted-page warm-up / 显示方式：标题与说明都按「标题：一句话」拆开，详细限制走 detail", () => {
        const p = plugins.find(x => x.name === "InpageSidebar")!;
        for (const k of ["prewarm", "displayMode"] as const) {
            const def = p.settings!.def[k] as { description: string; detail?: string };
            expect(def.detail, `${k} 缺 detail`).toBe(`${def.description}.detail`);
            setLang("en");
            const t = settingText(def as never, k);
            expect(t.title).toBe(k === "prewarm" ? "Restricted-page warm-up" : "Display mode");
            expect(t.desc.length).toBeGreaterThan(10);
        }
    });
    test("settingTip：第一行 = 提示标题，其余行合成副标题；空串 → 都是空", () => {
        expect(settingTip("a\nb\n c ")).toEqual({ title: "a", subtitle: "b c" });
        expect(settingTip("only")).toEqual({ title: "only", subtitle: "" });
        expect(settingTip("")).toEqual({ title: "", subtitle: "" });
    });
    test("SettingField 把 detail 挂成 .arc-setting-text 的 data-tip / data-tip-subtitle（项目现有的 ArcTooltip 机制），不渲染成行内文字", async () => {
        const { readFileSync } = await import("node:fs");
        const s = readFileSync("src/components/settings/SettingField.ts", "utf8");
        expect(s).toMatch(/class: "arc-setting-text", "data-tip": tip\.title \|\| null, "data-tip-subtitle": tip\.subtitle \|\| null/);
        expect(s).toMatch(/settingTip\(def\.detail \? tr\(def\.detail\) : ""\)/);
    });
});

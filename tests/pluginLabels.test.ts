import { describe, expect, test } from "bun:test";

import { LOCALES } from "@api/i18n";

/* 验收 51950：插件页卡片显示键名。所有可选插件的名称 / 描述键必须在模块加载时就能解析（插件默认关闭，start() 不会执行） */
const OPTIONAL = ["boosts", "capture", "cleanUrls", "downloadRename", "inpageSidebar", "sessionTransfer", "tabSleep", "tidyTabTitles", "tidyTabs"];

describe("可选插件名称和描述都能解析出文字", () => {
    for (const dir of OPTIONAL) test(dir, async () => {
        const src = await Bun.file(`src/plugins/${dir}/index.ts`).text();
        // 插件入口在模块顶层加载 i18n（不能只在 start() 里注册）
        expect(src).toMatch(/^import "\.\/i18n";$/m);
        expect(src).not.toMatch(/start\([^)]*\)\s*\{[^}]*registerLocale/);
        await import(`../src/plugins/${dir}/i18n`);
        const keys = [...src.matchAll(/^\s{4}(label|description): "([^"]+)"/gm)].map(m => m[2]);
        expect(keys).toHaveLength(2);
        for (const lang of ["en", "zh"] as const) for (const k of keys) {
            expect(LOCALES[lang][k]).toBeTruthy();
        }
    });
});

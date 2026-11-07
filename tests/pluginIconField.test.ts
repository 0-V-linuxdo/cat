/* 插件定义里的 `icon:` 字段已无人读取（卡片图标只来自 settings/utils.ts 的 PLUGIN_CARD_ICON，按插件 name）；留着会让人以为改这里能改卡片图标。 */
import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";

import { PLUGIN_CARD_ICON } from "../src/components/settings/utils";

test("src/plugins/*/index.ts 不再声明 icon 字段；图标改 PLUGIN_CARD_ICON", () => {
    const dirs = readdirSync("src/plugins", { withFileTypes: true }).filter(e => e.isDirectory() && !e.name.startsWith("_") && !e.name.startsWith(".")).map(e => e.name);
    const withIcon = dirs.filter(d => /^ {4}icon:/m.test(readFileSync(`src/plugins/${d}/index.ts`, "utf8")));
    expect(withIcon).toEqual([]);
    expect(Object.keys(PLUGIN_CARD_ICON).length).toBeGreaterThanOrEqual(14);
});

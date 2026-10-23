import { describe, expect, test } from "bun:test";
import { keepSensitive, stripSensitive } from "../src/plugins/data/backup/index";

const K = "ArcSidebarSettings";
const keys: [string, string][] = [["AI", "apiKey"]];
describe("sensitive 设置项", () => {
    test("导出 / 备份跳过", () => {
        const out = stripSensitive({ [K]: { plugins: { AI: { apiKey: "sk-1", model: "x" } } }, other: 1 }, keys) as any;
        expect(out[K].plugins.AI).toEqual({ model: "x" }); expect(out.other).toBe(1);
    });
    test("导入保留现有值", () => {
        const out = keepSensitive({ [K]: { plugins: { AI: { apiKey: "OLD-FILE", model: "y" } } } }, { [K]: { plugins: { AI: { apiKey: "cur" } } } }, keys) as any;
        expect(out[K].plugins.AI).toEqual({ model: "y", apiKey: "cur" });
    });
});
import { stripSecrets } from "../src/plugins/data/backup/index";
describe("secret:* 键", () => {
    test("导出 / 快照跳过 secret:*", () => { expect(stripSecrets({ "secret:llmApiKey": "sk", "data:x": 1 })).toEqual({ "data:x": 1 }); });
});

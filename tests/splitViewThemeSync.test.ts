import { test, expect } from "bun:test";
import { readTheme, applyTheme, SPLIT_THEME_KEY } from "../src/plugins/views/splitView/theme";

const root = (d: Record<string, string> = {}) => ({ dataset: { ...d } as DOMStringMap });

test("侧栏读取 data-theme / data-bb-dark", () => {
    expect(readTheme(root({ theme: "dark", bbDark: "1" }))).toEqual({ theme: "dark", bbDark: "1" });
    expect(readTheme(root())).toEqual({ theme: null, bbDark: null });
    expect(SPLIT_THEME_KEY).toBe("splitTheme");
});
test("分屏页写入并实时覆盖；缺失则删除（回到系统）", () => {
    const r = root();
    applyTheme(r, { theme: "light", bbDark: "1" }); expect(r.dataset).toEqual({ theme: "light", bbDark: "1" });
    applyTheme(r, { theme: "dark", bbDark: null }); expect(r.dataset).toEqual({ theme: "dark" });
    applyTheme(r, null); expect(r.dataset).toEqual({});
});
test("分屏页注册了订阅，侧栏注册了发布", async () => {
    const src = await Bun.file(new URL("../src/plugins/views/splitView/index.ts", import.meta.url)).text();
    expect(src).toContain("panel: { start: () => publishTheme() }");
    expect(src).toContain("subscribeTheme()");
});

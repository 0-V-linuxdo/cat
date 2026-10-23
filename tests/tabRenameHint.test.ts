import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import en from "../src/i18n/en";
import zh from "../src/i18n/zh";

const src = readFileSync(resolve(import.meta.dir, "../src/components/TabRow.ts"), "utf8");
// TabRow 里副标题的表达式，抽成函数按 props 求值（无 DOM 环境）
const expr = src.match(/"data-tip-subtitle":\s*([^,\n]+),/)![1];
const tr = (k: string) => (en as Record<string, string>)[k];
const subtitle = (p: { onRename?: () => void; renamed?: boolean }) => new Function("p", "tr", `return ${expr};`)(p, tr);

test("tab.renameHint 文案（en / zh）", () => {
    expect(tr("tab.renameHint")).toBe("Double-click to rename");
    expect((zh as Record<string, string>)["tab.renameHint"]).toBe("双击重命名");
});

test("未改名（可改名、无自定义名）→ 副标题「Double-click to rename」（FUN_1002b5cd4 L16–25；反转 52032 / 52034）", () => {
    expect(subtitle({ onRename: () => { } })).toBe("Double-click to rename");
    expect(subtitle({ onRename: () => { }, renamed: false })).toBe("Double-click to rename");
});

test("改过名 → 无副标题；不可改名 → 无副标题", () => {
    expect(subtitle({ onRename: () => { }, renamed: true })).toBeNull();
    expect(subtitle({ renamed: true })).toBeNull();
    expect(subtitle({})).toBeNull();
});

test("提示标题 = 行标题（自定义名或页面标题），不再是 host；声明 cursor 锚点 / 1.5s / maxWidth 500", () => {
    expect(src).toContain(`"data-tip": (p.title || p.url || "").trim() || null`);
    expect(src).not.toContain("tipHost(");
    expect(src).toContain(`"data-tip-anchor": "cursor", "data-tip-delay": "1.5", "data-tip-max-width": "500"`);
    const t = new Function("p", `return ${src.match(/"data-tip":\s*([^,\n]+),/)![1]};`);
    expect(t({ title: "My name", url: "https://www.example.com/" })).toBe("My name");
    expect(t({ title: "", url: "chrome-extension://abc/options.html" })).toBe("chrome-extension://abc/options.html");
});

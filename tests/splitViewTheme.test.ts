import { test, expect } from "bun:test";
import style, { SPLIT_LIGHT, SPLIT_DARK } from "../src/plugins/views/splitView/style";

test("splitView 深浅：bb-dark > data-theme > 系统，后写优先", () => {
    const i = (k: string) => style.indexOf(k);
    expect(i("@media (prefers-color-scheme: dark)")).toBeGreaterThan(-1);
    expect(i(':root[data-theme="dark"]')).toBeGreaterThan(i("@media (prefers-color-scheme: dark)"));
    expect(i(':root[data-bb-dark="0"]')).toBeGreaterThan(i(':root[data-theme="dark"]'));
    expect(style).toContain(`:root[data-bb-dark="1"] { ${SPLIT_DARK} }`);
    expect(style).toContain(`:root[data-theme="light"] { ${SPLIT_LIGHT} }`);
});
test("splitView：面板 / 栏用变量，不再硬编码 #fff", () => {
    expect(style).toContain(".split-pane { background: var(--sv-pane)");
    expect(style).toContain("background: var(--sv-bar)");
    expect(SPLIT_DARK).toContain("--sv-pane: #1E2020"); expect(SPLIT_DARK).toContain("--sv-bar: #242626");
    expect(SPLIT_LIGHT).toContain("--sv-pane: #fff");
});
test("split.html：面板底色走变量并有深色回退", async () => {
    const html = await Bun.file(new URL("../static/split.html", import.meta.url)).text();
    expect(html).not.toMatch(/\.split-pane \{[^}]*background: #fff;/);
    expect(html).toContain("var(--sv-pane, #1E2020)");
});
test("分隔条：不用原生 title，改 data-tip + role=separator", async () => {
    const src = await Bun.file(new URL("../src/plugins/views/splitView/index.ts", import.meta.url)).text();
    const line = src.split("\n").find(l => l.includes("split-gutter ${dir}"))!;
    expect(line).not.toContain("title:");
    expect(line).toContain('"data-tip": tr("split.resize")');
    expect(line).toContain('role: "separator"');
});

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// rel42 字号补丁（Rea font-sizes.md，Arc 1.169.0 反编译）：
//   Tab 标题 / 行内编辑框 = label.withSize(14) Regular；文件夹标题 / 行内编辑框 = listHeader 14 Semibold；副标题 = subLabel 11 Regular；
//   Space 标题 13 Semibold、New Tab 14 不动；--arc-fs 保持 13。⛔ 活动标签标题字重 500、浮动编辑框、活动态等源码未找到 → 沿用。
const rd = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const css = rd("../static/sidepanel.css"), tabsCss = rd("../src/plugins/tabs/style.ts"), spacesCss = rd("../src/plugins/spaces/style.ts"), selftest = rd("../src/selftest/selftest.ts");
/** 取 `selector { body }` 的 body（单行规则，选择器按字面匹配） */
const mine = () => css.split("\n").filter(l => /^:root \.arc-(tab|folder-head) > \.arc-(tab-title|rename)\b.*font-size: 14px/.test(l));
const body = (src: string, sel: string) => { const i = src.indexOf(`${sel} {`); if (i < 0) return null; return src.slice(i + sel.length + 2, src.indexOf("}", i)).trim(); };

test("Tab 标题 14px（只改字号，字重不碰：活动态 500 ⛔ 沿用）", () => {
    expect(body(css, ":root .arc-tab > .arc-tab-title")).toBe("font-size: 14px;");
    expect(css).toContain(".arc-tab.active .arc-tab-title { font-weight: 500; }"); // 原样保留
});

test("Tab 行内编辑框 14px Regular（.arc-rename 是 .arc-tab 的直接子元素）", () => {
    expect(body(css, ":root .arc-tab > .arc-rename")).toBe("font-size: 14px; font-weight: 400;");
});

test("文件夹标题与行内编辑框 14px Semibold（600）", () => {
    const sel = ":root .arc-folder-head > .arc-tab-title, :root .arc-folder-head > .arc-rename";
    expect(body(css, sel)).toBe("font-size: 14px; font-weight: 600;");
});

test("作用域只限行内：命令栏 / Recent / 备份等 .arc-list-row 里的 .arc-tab-title、浮动编辑框、其它控件不在选择器里", () => {
    const rules = mine();
    expect(rules.length).toBe(3);
    for (const l of rules) { expect(l).not.toContain("arc-list-row"); expect(l).not.toContain("arc-float-edit"); expect(l).not.toContain("arc-space"); expect(l).not.toContain("arc-newtab"); expect(l).not.toContain("arc-menu"); }
    // 没有无作用域的 .arc-tab-title 字号规则（那会带动 .arc-list-row 里的）
    expect(css).not.toMatch(/(^|\n|\})\s*\.arc-tab-title[^{]*\{[^}]*font-size/);
    expect(tabsCss).not.toMatch(/(^|\n)\s*\.arc-tab-title[^{]*\{[^}]*font-size/);
});

test("副标题仍 11px Regular（subLabel 11）", () => {
    expect(tabsCss).toMatch(/\.arc-tab-sub \{[^}]*font-size: 11px;/);
    expect(tabsCss).not.toMatch(/\.arc-tab-sub \{[^}]*font-weight: [5-9]00/);
});

test("--arc-fs 仍 13；Space 标题 13px Semibold；New Tab 文字 14px —— 都不在本补丁里改", () => {
    expect(css).toContain("--arc-fs: 13px;");
    expect(spacesCss).toMatch(/font-weight: 600; font-size: 13px; color: var\(--sh-text\)/);
    expect(tabsCss).toContain(".arc-newtab > span { font-size: 14px; }");
    expect(css).not.toContain("--arc-fs: 14px");
});

test("行高 / 行距不变：行 36、pitch 40 + gap 1、文字行高 18、行内编辑框高 28", () => {
    expect(css).toContain("--arc-row-h: 36px; --arc-row-pitch: 40px;");
    expect(css).toContain("--arc-text-lh: 18px;");
    expect(tabsCss).toContain(":root { --arc-row-gap: 1px; }");
    expect(css).toContain(".arc-rename { height: 28px;");
    // 本补丁的三条规则不带 line-height / height / padding / margin / gap
    for (const l of mine()) expect(l).not.toMatch(/line-height|height|padding|margin|gap/);
});

test("标题起点变量不被碰（title-column）：--arc-icon-pad / --arc-gap 原值", () => {
    expect(css).toContain("--arc-icon-pad: calc((var(--arc-icon-box) - var(--arc-fav-size)) / 2);");
    expect(css).toContain("--arc-gap: 6px;");
});

test("自测页有 font-size-14 用例（harness 可见，SELFTEST 73–80）", () => {
    expect(selftest).toContain("标题字号 14（font-size-14，rel42，SELFTEST 73–80）");
    expect(selftest.indexOf("标题字号 14（font-size-14")).toBeGreaterThan(selftest.indexOf("恢复界面语言设置"));
});

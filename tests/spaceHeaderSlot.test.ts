/* Space 标题行：折叠箭头与图标共用一个 24×24 槽（space-header-layout）。
 * Rea space-header-idle.md §3.1：箭头显示时图标 isHidden；§3.2 / §5：箭头隐藏时 isHidden + customSpacing 0 → 行首只有一个槽，标题起点 = 左内边距 + 24 + 4。
 * 真实渲染（headless Chrome 加载构建产物，53129 → 本补丁）：图标左 41 → 17（字形）、标题起点 69 → 41，下方文件夹行标题 41、标签行 40；title-column 后标签标题 44（Rea）、Space 标题相应 38 → 42（删 margin-left -4）。源码 / CSS 断言；真实渲染由 selftest「视觉：行内图标…」（标题起始列，自测框架补丁）覆盖。 */
import { test, expect, describe } from "bun:test";
import { readFileSync } from "node:fs";
const r = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const sp = r("src/plugins/spaces/style.ts"), side = r("static/sidepanel.css");
const num = (s: string, re: RegExp) => Number(s.match(re)![1]);

describe("箭头与图标同槽", () => {
    test("图标紧跟箭头时 margin-left = −(箭头宽 + gap)：叠在同一个 24×24 槽上，不再把图标右推 28px", () => {
        const w = num(sp, /\.arc-space-chevron \{[^}]*width: (\d+)px/), gap = num(sp, /\.arc-space-title \{[^}]*?gap: (\d+)px/);
        expect(w).toBe(24); expect(gap).toBe(4);
        expect(sp).toContain(`.arc-space-chevron + .arc-space-icon { margin-left: -${w + gap}px; }`);
    });
    test("hover（0.1s 延迟后瞬间）互换：箭头 opacity 1、图标 opacity 0；idle 反之；离开时无过渡（立即）", () => {
        expect(sp).toContain(".arc-space-title:hover .arc-space-chevron { opacity: 1; transition: opacity 0s linear .1s; }");
        expect(sp).toContain(".arc-space-title:hover .arc-space-chevron + .arc-space-icon { opacity: 0; transition: opacity 0s linear .1s; }");
        expect(sp.match(/\n\.arc-space-chevron \{([^}]*)\}/)![1]).toContain("opacity: 0");
        expect(sp.match(/\.arc-space-title \.arc-space-icon \{([^}]*)\}/)![1]).not.toContain("opacity");
    });
    test("DOM 顺序不变 [箭头, 图标, 标题, “…”]（spaceHeaderIdle 另有断言）", () => {
        const m = r("src/plugins/spaces/spaceManager/index.ts"), i = (s: string) => m.indexOf(s, m.indexOf('class: "arc-space-title"'));
        expect(i('class: "arc-space-chevron"')).toBeLessThan(i('class: "arc-space-icon"'));
    });
});

describe("相对列（Rea space-header-layout.md §1.2 / §4.6）", () => {
    const padL = () => num(sp, /\.arc-space-title \{[^}]*?padding: \d+px \d+(?:px)? \d+px (\d+)px/), padX = () => num(side, /--arc-pad-x:\s*(\d+)px/);
    test("槽左缘 = 标签 favicon 左缘 − 4（favicon 16 居中于 24 槽）→ 与标签 / 文件夹图标容器左缘差 0；Space 字形（16 居中）与标签 favicon 同列", () => {
        expect(padL()).toBe(padX() - (24 - 16) / 2); // 6 = 10 − 4；Arc 里没有 5
    });
    test("标题起点 = 槽左 + 24 + 4 = 标签标题 − 2（Rea：Space 42 对 tab 44，槽左 14 起算 +28 对 +30；不再有 margin-left: -4px）", () => {
        // Rea 裁定 tab 标题非 drift 44（槽左 14 → +30 = 24 + customSpacing 4 + titleStack inset 2）；Space = 24 + stack spacing 4 = +28
        const REA_TAB_TITLE_FROM_SLOT = 30, gap = 4; // 44 - 14
        const spaceTitle = padL() + 24 + gap; // 相对行左；标题名上没有负 margin
        expect(sp).not.toMatch(/\.arc-space-title > \.arc-space-name \{[^}]*margin-left/);
        expect(spaceTitle).toBe(padL() + REA_TAB_TITLE_FROM_SLOT - 2);
        // 与 Cat 标签行对照（命令栏 title-column 补丁：favicon 右外边距 --arc-icon-pad（= (槽 24 − favicon 16) / 2 = 4）+ 行 gap 6 = favicon→标题 10）：标签标题 − Space 标题 = 2。
        // 两个补丁必须同 rel 合入：没有 title-column 的 --arc-icon-pad 时这条会失败（Space 会比标签标题右 2）
        expect(side).toContain("--arc-icon-pad: calc((var(--arc-icon-box) - var(--arc-fav-size)) / 2)");
        const iconPad = (num(side, /--arc-icon-box:\s*(\d+)px/) - num(side, /--arc-fav-size:\s*(\d+)px/)) / 2;
        const tabTitleAfterTitleColumn = padX() + 16 + iconPad + Number([...side.matchAll(/--arc-gap:\s*(\d+)px/g)].pop()![1]); // sidepanel.css 末段 :root 的 6
        expect(tabTitleAfterTitleColumn - spaceTitle).toBe(2);
    });
    test("右侧：“…” 右缘比标签行右按钮靠右 6：标签行关闭按钮距行右 6（--arc-pad 右 6）；相对量 padding-right 0，实现填 4（“…” hover 底不贴卡片右缘，Arc 里距卡片 4）→ 比标签按钮右缘靠右 2，偏离 Rea 6 共 4", () => {
        expect(side).toMatch(/padding: 0 6px 0 var\(--arc-pad-x\)/);
        expect(sp).toMatch(/\.arc-space-title \{[^}]*?padding: 6px 4px 2px 6px;/);
        expect(sp).toContain(".arc-slot-header:has(.arc-space-title) { padding-bottom: 0; }"); // header → 第一行：Space 行底到第一行元素顶 6 → 2（= 卡片下缘）
    });
    test("卡片 = 行元素整宽、y 2…−2；行高 36（≥36 下限，idle 恰 36，⛔ 推算）", () => {
        expect(sp).toMatch(/\.arc-space-title::before \{[^}]*left: 0; right: 0; top: 2px; bottom: -2px;/);
        expect(sp).toMatch(/\.arc-space-title \{[^}]*?height: 36px;/);
    });
});

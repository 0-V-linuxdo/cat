/* Space 标题行 idle / hover 外观（Rea space-header-idle.md §1–§5；Cat 裁定）。源码 / CSS 字符串断言（bun 无 jsdom）；真实渲染由 selftest「Space 标题行 idle 外观」检查。 */
import { test, expect, describe } from "bun:test";
import { readFileSync } from "node:fs";
const r = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const sp = r("src/plugins/spaces/style.ts"), side = r("static/sidepanel.css");
const block = (sel: string) => sp.match(new RegExp(`\\n${sel.replace(/[.[\]()*+?^$|\\]/g, "\\$&")} \\{([^}]*)\\}`))?.[1] ?? "";

describe("idle：无底色、无卡片、无描边", () => {
    const t = block(".arc-space-title");
    test("行本身透明；无 pill 变量；伪元素卡片 idle opacity 0", () => {
        expect(t).toContain("background: transparent");
        expect(sp).not.toContain("--arc-space-pill");
        expect(sp).toMatch(/\.arc-space-title::before \{[^}]*opacity: 0;/);
    });
    test("发丝描边被盖掉：sidepanel.css 的 :root .arc-space-title 描边（共享、不改）仍在，style.ts 用更高特异性 box-shadow: none（含 :active 底色）", () => {
        expect(side).toContain(":root .arc-space-title { box-shadow: inset 0 0 0 .5px var(--arc-hairline); }");
        expect(side).toContain(":root .arc-space-title:active { background: var(--arc-press); }");
        // 选择器 .arc-space-title.arc-space-title（0,3,0）> :root .arc-space-title（0,2,0）；:active 版 0,4,0 > 0,3,0
        expect(sp).toContain(":root .arc-space-title.arc-space-title { box-shadow: none; background: transparent; }");
        expect(sp).toContain(":root .arc-space-title.arc-space-title:active { background: transparent; }");
    });
    test("没有 hover 整行底色（:hover 只改伪元素卡片 / 箭头 / “…”）", () => {
        expect(sp).not.toMatch(/\.arc-space-title:hover \{ background/);
    });
});

describe("hover：圆角 8 卡片，浅 #0E0F10 α.05 / 深 #FAFBFF α.10，卡片 = 行元素整宽（Arc 页内 8 = 标签行 hover 盒，Cat 元素本身已在 #app 内缩 8），0.1s ease-out，进入延迟 0.1s", () => {
    test("卡片几何 / 圆角 / 动画", () => {
        const b = sp.match(/\.arc-space-title::before \{([^}]*)\}/)![1]!;
        expect(b).toContain("left: 0; right: 0"); // Arc §1.2 卡片左缘 = tab / 文件夹行 hover 盒左缘；Cat 行元素即盒子 → 0（不是 8，见 style.ts 注释）
        expect(b).toContain("border-radius: 8px");
        expect(b).toContain("pointer-events: none");
        expect(b).toContain("transition: opacity .1s ease-out;"); // 离开：无延迟
        expect(sp).toContain(".arc-space-title:hover::before { opacity: 1; transition: opacity .1s ease-out .1s; }"); // 进入：延迟 0.1s
    });
    test("色值：浅 / 深 / data-bb-dark 三路，bb-dark 排最后", () => {
        expect(block(".arc-space-title")).toContain("--sh-card: rgb(14 15 16 / .05)");
        const dark = "--sh-card: rgb(250 251 255 / .10)";
        expect(sp).toContain(`:root[data-theme="dark"] .arc-space-title { ${dark}`);
        expect(sp).toContain(`:root:not([data-theme="light"]) .arc-space-title { ${dark}`);
        expect(sp).toContain(`:root[data-bb-dark="1"] .arc-space-title { ${dark}`);
        expect(sp).toContain(':root[data-bb-dark="0"] .arc-space-title { --sh-card: rgb(14 15 16 / .05)');
        expect(sp.indexOf('data-bb-dark="1"] .arc-space-title')).toBeGreaterThan(sp.indexOf(':root[data-theme="dark"] .arc-space-title'));
    });
});

describe("标题文字 / 图标 / 间距", () => {
    test("文字 SidebarForegroundDarker 浅 #000 α.45 / 深 #FFF α.45；13px、600、单行 ellipsis", () => {
        const t = block(".arc-space-title");
        expect(t).toContain("--sh-text: rgb(0 0 0 / .45)"); expect(t).toContain("color: var(--sh-text)");
        expect(t).toContain("font-size: 13px"); expect(t).toContain("font-weight: 600");
        expect(sp).toContain("--sh-text: rgb(255 255 255 / .45)");
        expect(sp).toMatch(/\.arc-space-title > \.arc-space-name \{[^}]*white-space: nowrap; text-overflow: ellipsis/);
    });
    test("图标槽 24×24，默认色 ForegroundTertiary 浅 α.3 / 深 α.3", () => {
        expect(sp).toMatch(/\.arc-space-title \.arc-space-icon \{[^}]*width: 24px; height: 24px; color: var\(--sh-icon\)/);
        expect(block(".arc-space-title")).toContain("--sh-icon: rgb(0 0 0 / .3)");
        expect(sp).toContain("--sh-icon: rgb(255 255 255 / .3)");
    });
    test("stack spacing 4、centerY；contentInset top 6 / bottom 2；左 = --arc-pad-x − 4（槽左缘 = 标签 favicon 左缘 − 4，相对关系，见 spaceHeaderSlot.test.ts）；右 4（“…” 右缘比标签行右按钮靠右 2；Rea 6，偏差 4 见 style.ts）", () => {
        const t = block(".arc-space-title");
        expect(t).toContain("gap: 4px"); expect(t).toContain("align-items: center");
        expect(t).toMatch(/padding: 6px 4px 2px 6px;/);
        expect(t).toContain("height: 36px"); // Rea space-header-layout §0：header.height ≥ 36，空闲恰 36（⛔ 推算：标题单行高 ≤ 28）
    });
    test("行内顺序 [箭头, 图标, 标题, “…”]", () => {
        const m = r("src/plugins/spaces/spaceManager/index.ts");
        const i = (s: string) => m.indexOf(s, m.indexOf('class: "arc-space-title"'));
        expect(i('class: "arc-space-chevron"')).toBeLessThan(i('class: "arc-space-icon"'));
        expect(i('class: "arc-space-icon"')).toBeLessThan(i('class: "arc-space-name"'));
        expect(i('class: "arc-space-name"')).toBeLessThan(i("more));"));
    });
});

describe("折叠箭头 / “…”：idle 隐藏、hover 显示", () => {
    test("箭头：idle opacity 0 且保留 24×24 占位；hover opacity 1（0.1s 延迟后瞬间）", () => {
        const c = block(".arc-space-chevron");
        expect(c).toContain("opacity: 0"); expect(c).toContain("width: 24px; height: 24px");
        expect(c).not.toMatch(/display: none|visibility: hidden/);
        expect(sp).toContain(".arc-space-title:hover .arc-space-chevron { opacity: 1; transition: opacity 0s linear .1s; }");
    });
    test("“…”：idle 宽 0 + opacity 0（不 hidden）；hover / 菜单打开 / 焦点宽 24 + opacity 1；色 GrayA11、悬停底 GrayA4", () => {
        const m = sp.match(/\.arc-space-title \.arc-space-more \{([^}]*)\}/)![1]!;
        expect(m).toContain("width: 0; min-width: 0"); expect(m).toContain("opacity: 0"); expect(m).not.toMatch(/display: none|visibility: hidden/);
        expect(sp).toMatch(/\.arc-space-title:hover \.arc-space-more, \.arc-space-title \.arc-space-more\.open, \.arc-space-title \.arc-space-more:focus-visible \{ width: 24px; min-width: 24px; opacity: 1; \}/);
        expect(sp).toContain("--sh-more: rgb(0 0 0 / .565)"); expect(sp).toContain("--sh-more: rgb(255 255 255 / .592)");
        expect(sp).toContain("--sh-more-hover: rgb(0 0 0 / .071)"); expect(sp).toContain("--sh-more-hover: rgb(255 255 255 / .077)");
        expect(sp).toContain(".arc-space-title .arc-space-more:hover, .arc-space-title .arc-space-more.open { background: var(--sh-more-hover); }");
    });
});

describe("没有拖动把手（Rea §3.2）", () => {
    test("style.ts 里没有 .arc-space-grabber；Manage Spaces 的 .arc-manage-grip 保留", () => {
        expect(sp).not.toContain("arc-space-grabber");
        expect(sp).toContain(".arc-manage-grip {");
    });
});

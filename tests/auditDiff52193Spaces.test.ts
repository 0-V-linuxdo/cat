import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";

/* audit-arc-diff-52193：设置页与 Space 面板线程的修复（H-01 / H-02 / F-01 / F-02 / B-08 / B-10 / S-02 / S-04） */
const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const themes = src("src/plugins/spaces/themes/index.ts");
const style = src("src/plugins/spaces/style.ts");

describe("audit-arc-diff-52193（设置页与 Space 面板）", () => {
    test("H-01：失焦变暗是 Themes 设置 blurDim，默认关；关闭时不写 data-blurred", () => {
        expect(themes).toMatch(/blurDim:\s*\{\s*type:\s*OptionType\.BOOLEAN,\s*default:\s*false/);
        const body = themes.slice(themes.indexOf("const onFocus"), themes.indexOf("chrome.windows.onFocusChanged.addListener"));
        expect(body).toMatch(/if \(!settings\.store\.blurDim\) \{ delete document\.documentElement\.dataset\.blurred; return; \}/);
        // apply()（onSettingsChange）里关掉开关立即撤销
        expect(themes).toMatch(/if \(!settings\.store\.blurDim\) delete root\.dataset\.blurred;/);
    });
    test("H-02：深色颗粒是 Themes 设置 darkGrain，默认关；未开启时隐藏 body::after", () => {
        expect(themes).toMatch(/darkGrain:\s*\{\s*type:\s*OptionType\.BOOLEAN,\s*default:\s*false/);
        expect(themes).toMatch(/root\.dataset\.darkGrain = String\(!!settings\.store\.darkGrain\)/);
        expect(themes).toMatch(/delete r\.dataset\.darkGrain/);
        expect(style).toContain(':root:not([data-dark-grain="true"]) body::after { display: none; }');
    });
    test("H-01 / H-02 文案已注册（en / zh）", async () => {
        const { STRINGS } = await import("../src/plugins/spaces/themes/i18n");
        for (const k of ["themes.blurDim", "themes.darkGrain"]) { expect(STRINGS.en[k as keyof typeof STRINGS.en]).toBeTruthy(); expect(STRINGS.zh[k as keyof typeof STRINGS.zh]).toBeTruthy(); }
    });
    test("F-01：favicon regular 16（T-S15），不再是 20", () => {
        expect(style).toMatch(/\.arc-fav-tile img \{ width: 16px; height: 16px;/);
        expect(style).not.toMatch(/\.arc-fav-tile img \{ width: 20px/);
    });
    test("F-02：空状态有 Arc 副标题，去掉无出处的虚线框", async () => {
        const fav = src("src/plugins/spaces/favorites/index.ts");
        expect(fav).toMatch(/tr\("fav\.dropHint"\)[\s\S]{0,80}tr\("fav\.dropHintSub"\)/);
        const { STRINGS } = await import("../src/plugins/spaces/favorites/i18n");
        expect(STRINGS.en["fav.dropHintSub"]).toBe("Favorites keep your most used sites and apps close");
        expect(src("src/i18n/en.ts")).toContain('"fav.dropHint": "Drag to add Favorites"');
        const rule = style.split("\n").find(l => l.startsWith(".arc-fav-grid .arc-hint {"))!;
        expect(rule).toBeDefined();
        expect(rule).not.toMatch(/dashed/);
    });
    test("B-08：撤销文案 Delete Space（大写 S）", () => {
        expect(src("src/i18n/en.ts")).toContain('"spaces.delete": "Delete Space"');
    });
    test("B-10：切换器 SF 图标 14，紧凑 12", () => {
        expect(src("src/plugins/spaces/spaceManager/index.ts")).toMatch(/spaceIconNode\(s\.icon, 14\)/);
        expect(style).toContain(":root .arc-space-bar.compact .arc-space-dot svg.arc-sym { width: 12px; height: 12px; }");
    });
    test("S-02：Archive tabs after", () => {
        expect(src("src/i18n/en.ts")).toContain('"autoArchive.after": "Archive tabs after"');
    });
    test("S-04：设置分类不用手绘 command / views 图标；data 为 SF externaldrive.fill 条目", async () => {
        const { PLUGIN_CATEGORY_TABS } = await import("../src/components/settings/utils");
        const icons = PLUGIN_CATEGORY_TABS.map(t => t.icon as string);
        for (const bad of ["command", "views", "cards", "sparkles"]) expect(icons).not.toContain(bad);
        expect(src("src/api/ionGlyphs.ts")).toMatch(/\n    data: \{ src: "arc-icons\/sf\/suggested\/externaldrive\.fill/);
        expect(icons).toEqual(["star", "plugin", "tabs", "spaces", "search", "splitCols", "library", "data"]);
    });
    test("F-05：磁贴专用阴影 0 1px 2px rgb(0 0 0 / .1)，各状态不变；无 .5px 描边；不改全局 --arc-raise-sm", () => {
        expect(style).toContain("--fav-shadow: 0 1px 2px rgb(0 0 0 / .1)");
        const tileRules = style.split("\n").filter(l => /\.arc-fav-tile/.test(l) && /box-shadow/.test(l));
        expect(tileRules.length).toBeGreaterThan(0);
        for (const l of tileRules) { expect(l).toContain("var(--fav-shadow)"); expect(l).not.toMatch(/\.5px|--arc-raise|--arc-inset|--arc-active-shadow/); }
        expect(style).not.toMatch(/--arc-raise-sm\s*:/);
    });
    test("F-03：模糊 favicon 底层 α（深 .2/.3，浅 0/.1），选中白 .45/.8 + 2pt 环；已打开态是默认关的选项", () => {
        expect(style).toMatch(/\.arc-fav-grid \{[^}]*--fav-blur-a: 0; --fav-blur-a-hover: \.1; --fav-sel: rgb\(255 255 255 \/ \.8\)/);
        expect(style).toMatch(/:root\[data-theme="dark"\] \.arc-fav-grid \{ --fav-blur-a: \.2; --fav-blur-a-hover: \.3; --fav-sel: rgb\(255 255 255 \/ \.45\); \}/);
        expect(style).toContain(".arc-fav-tile.active { background: var(--fav-sel); box-shadow: inset 0 0 0 2px var(--fav-ring), var(--fav-shadow); }");
        expect(style).not.toMatch(/^\.arc-fav-tile\.open \{/m);
        expect(style).not.toMatch(/^\.arc-fav-tile:not\(\.open\) img/m);
        expect(style).toMatch(/\[data-opened-style="true"\] \.arc-fav-tile:not\(\.open\) img/);
        const fav = src("src/plugins/spaces/favorites/index.ts");
        expect(fav).toMatch(/openedStyle:\s*\{\s*type:\s*OptionType\.BOOLEAN,\s*default:\s*false/);
        expect(fav).toMatch(/class: "arc-fav-blur"/);
    });
    test("F-03 / fav-tile-blur2（fav-tile-blur.md）：模糊层 inset:0（Arc 无 outset）、不用 cover、不用 blur(12px) / --fav-blur-r / --arc-ease；模糊 + 调色走 SVG 滤镜；磁贴 overflow:hidden 裁 12 圆角", () => {
        const fav = src("src/plugins/spaces/favorites/index.ts"), css = style.replace(/\/\*[\s\S]*?\*\//g, ""); // 去掉注释再断言规则本身
        const rule = css.split("\n").find(l => l.startsWith(".arc-fav-blur {"))!;
        expect(rule).toBeTruthy();
        expect(rule).toContain("inset: 0;");
        expect(rule).not.toMatch(/cover|calc\(-2|filter:|background:/);
        expect(css).not.toContain("--fav-blur-r");
        expect(css).not.toMatch(/blur\(12px\)|filter: blur\(|cover/);
        expect(fav).toMatch(/stdDeviation: String\(radius\)/);
        expect(fav).toMatch(/preserveAspectRatio: "none"/); // 两轴各自拉伸（imageScaling = AxesIndependently）
        const tile = style.split("\n").slice(style.split("\n").findIndex(l => l.startsWith(":root .arc-fav-grid .arc-fav-tile {"))).slice(0, 4).join("\n");
        expect(tile).toMatch(/overflow: hidden/); /* 裁掉模糊层溢出，圆角 12 */
        expect(tile).toMatch(/border-radius: 12px/);
    });
    test("S-01：自动归档 7 档同 Arc（1h / 6h / 12h / 24h / 7d / 30d / Never），无 6h → 12h 迁移；默认 12h（已定案，audit-52193-answers.md）", () => {
        const aa = src("src/plugins/tabs/autoArchive/index.ts");
        const opts = aa.slice(aa.indexOf("options: ["), aa.indexOf("],", aa.indexOf("options: [")));
        const vals = [...opts.matchAll(/value: (\d+)/g)].map(m => Number(m[1]));
        expect([...vals].sort((a, b) => a - b)).toEqual([0, 1, 6, 12, 24, 168, 720]);
        expect(opts).toMatch(/value: 12, default: true/);
        expect(aa).not.toMatch(/after\s*===?\s*6\b|migrat/i);
        const en = src("src/i18n/en.ts");
        for (const k of ["1h", "6h", "12h", "24h", "7d", "30d", "never"]) expect(en).toContain(`"autoArchive.${k}":`);
    });
});

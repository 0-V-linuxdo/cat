/* 设置页（options.html）左侧导航 2 个图标 + 插件卡「配置」按钮（Cat 裁定 /workspace/patches/options-nav-icons/PROPOSAL.md）：
 * Plugins = SF powerplug.portrait、General = SF gearshape、配置 = SF slider.horizontal.3；16pt Regular，14 盒；不手写路径（与 /workspace/arc-icons/sf 导出文件一致）。
 * `sliders`（Arc 站点控制中心入口）/ `plugin`（Arc 扩展面板）不改，地址栏站点控制按钮等仍在用。
 * ⛔ 三者都没有 Arc / Rea 源码依据（Arc 无设置页导航图标），语义取自 Void++ dev（UnplugIcon / SettingsIcon / Settings2Icon），字形是 SF。 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";

import { ICON_NAMES, SF_GLYPHS } from "../src/api/icons";
import { PLUGIN_CARD_ICON } from "../src/components/settings/utils";

const r = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
type G = { src: string; pt: number; w: number; h: number; vb: string; body: string };
const FILES: Record<string, string> = {
    powerplugPortrait: "suggested/powerplug.portrait_16pt_regular.svg",
    gearshape: "suggested/gearshape_16pt_regular.svg",
    sliderHorizontal3: "suggested/slider.horizontal.3_16pt_regular.svg",
};
const sf = SF_GLYPHS as unknown as Record<string, G>;
const opts = r("src/entries/options.ts"), css = r("static/options.css");

describe("设置页导航 / 配置按钮的 SF 图标", () => {
    for (const [n, f] of Object.entries(FILES)) test(`${n} = /workspace/arc-icons/sf/${f}（16pt Regular，viewBox / path 原样拷贝）`, () => {
        const g = sf[n]!;
        expect(g, n).toBeDefined();
        expect(g.src).toBe(`arc-icons/sf/${f}`);
        expect(g.pt).toBe(16);
        expect(f).toMatch(/_16pt_regular\.svg$/);
        expect(g.body).toContain('fill="currentColor"');
        expect((g.body.match(/<path/g) ?? []).length).toBeGreaterThan(0);
        expect(g.body).not.toContain("<image"); // 矢量，不是位图遮罩
        const p = `/workspace/arc-icons/sf/${f}`;
        if (!existsSync(p)) return; // CI 没有 /workspace 时只验证源码里的条目
        const svg = readFileSync(p, "utf8");
        expect(svg).toContain(`viewBox="${g.vb}"`);
        expect(svg).toContain(g.body);
        expect(svg).toContain(`width="${g.w.toFixed(3)}"`);
        expect(svg).toContain(`height="${g.h.toFixed(3)}"`);
    });
    test("三个条目都在 ICON_NAMES，互不相同，也不和 rel44 卡片图标 / 旧图标重名", () => {
        const names = Object.keys(FILES);
        for (const n of names) expect(ICON_NAMES as string[], n).toContain(n);
        expect(new Set(names.map(n => sf[n]!.src)).size).toBe(3);
        for (const n of names) expect(Object.values(PLUGIN_CARD_ICON) as string[], `${n} 与卡片图标重复`).not.toContain(n);
        expect(names).not.toContain("plugin");
        expect(names).not.toContain("sliders");
    });
    test("三个条目注明 ⛔（SF closest / 没有 Arc 依据）+ Void++ 语义出处", () => {
        const lines = r("src/api/icons.ts").split("\n");
        for (const n of Object.keys(FILES)) {
            const i = lines.findIndex(l => l.startsWith(`    ${n}: {`));
            expect(i, n).toBeGreaterThan(0);
            expect(lines[i - 1], n).toContain("⛔");
            expect(lines[i - 1], n).toContain("Void++");
        }
    });
    test("尺寸：16pt 导出，14 盒 = ×14/16（powerplug.portrait 16pt 高 17.8 > 16，所以导航不用 16 盒）", () => {
        expect(sf.powerplugPortrait!.h).toBeGreaterThan(16);
        expect(+(sf.powerplugPortrait!.h * 14 / 16).toFixed(3)).toBeLessThanOrEqual(16);
        expect(+(sf.gearshape!.w * 14 / 16).toFixed(3)).toBeLessThanOrEqual(16);
        expect(+(sf.sliderHorizontal3!.w * 14 / 16).toFixed(3)).toBeLessThanOrEqual(16);
    });
});

describe("options.ts / options.css 用法", () => {
    test("导航：Plugins = powerplugPortrait、General = gearshape；不再用 plugin / sliders", () => {
        expect(opts).toMatch(/navItem\("plugins", tr\("settings\.plugins"\), "powerplugPortrait"\)/);
        expect(opts).toMatch(/navItem\("general", tr\("settings\.general"\), "gearshape"\)/);
        expect(opts).not.toMatch(/navItem\([^)]*\), "plugin"\)/);
        expect(opts).not.toMatch(/navItem\([^)]*\), "sliders"\)/);
    });
    test("导航图标：glyph 14 盒 + 16×16 居中容器（文字起点对齐）", () => {
        expect(opts).toContain("const NAV_ICON_BOX = 14;");
        expect(opts).toMatch(/h\("span", \{ class: "arc-opt-nav-icon"[^}]*\}, icon\(ic, NAV_ICON_BOX\)\)/);
        const rule = css.split("\n").find(l => l.startsWith(".arc-opt-nav-icon {"))!;
        expect(rule).toBeDefined();
        expect(rule).toMatch(/width: 16px/);
        expect(rule).toMatch(/height: 16px/);
        expect(rule).toMatch(/justify-content: center/);
        expect(rule).toMatch(/align-items: center/);
        expect(rule).toMatch(/flex: none/);
        expect(css).toContain(".arc-opt-nav-item .arc-svg { color: var(--opt-muted); flex: none; }"); // 颜色规则不变
    });
    test("卡片「配置」按钮 = sliderHorizontal3（14 盒）；options.ts 里不再有 icon(\"sliders\"", () => {
        expect(opts).toContain("const CFG_ICON_BOX = 14;");
        expect(opts).toMatch(/"data-config": p\.name[^\n]*icon\("sliderHorizontal3", CFG_ICON_BOX\)/);
        expect(opts).not.toContain('icon("sliders"');
    });
});

describe("sliders / plugin 保持不动（其它地方在用）", () => {
    test("icons.ts 仍有 sliders / plugin 名字，arcIcons.ts 仍映射到 Arc 资源", () => {
        expect(ICON_NAMES as string[]).toContain("sliders");
        expect(ICON_NAMES as string[]).toContain("plugin");
        const a = r("src/api/arcIcons.ts");
        expect(a).toContain('"sliders": "vector/ARC_SiteControlCenter.bundle/icon-control-center.svg"');
        expect(a).toContain('"plugin": "vector/ARC_ContentPanel.bundle/ExtensionsIcon.svg"');
    });
    test("地址栏站点控制按钮仍是 sliders（command/navigation + selftest 断言）", () => {
        expect(r("src/plugins/command/navigation/index.ts")).toContain('icon("sliders", 13)');
        expect(r("src/selftest/selftest.ts")).toContain('"arc-svg-sliders"');
    });
});

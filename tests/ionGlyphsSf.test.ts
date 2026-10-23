/* 原 ionicons → Arc / SF 字形（ionGlyphs.ts，对照 /workspace/arc-analysis/ionicons-to-arc.md）：读源码 + 最小 DOM 替身断言。 */
import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { ION_GLYPHS, ION_VARIANT_OF } from "../src/api/ionGlyphs";

const r = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const ionSrc = r("src/api/ionGlyphs.ts");
const G = ION_GLYPHS as Record<string, { src: string; pt: number; w: number; h: number; vb: string; body: string }>;

/* 名字 → Rea 导出文件（根目录 = 字号字重有源码依据；unsized/ = 名有依据、字号 ⛔；suggested/ = ⛔ 仅建议） */
const WANT: Record<string, string> = {
    arrowLeft: "unsized/arrow.left_16pt_medium.svg", minus: "minus_16pt_semibold.svg", plus: "plus_16pt_semibold.svg", plusMedium: "plus_16pt_medium.svg",
    search: "magnifyingglass_15x15frame_regular.svg", image: "unsized/photo.on.rectangle.angled_28pt_regular.svg", volume: "unsized/speaker_14pt_regular.svg",
    mute: "speaker.slash.fill_12pt_medium.svg", alert: "lock.slash.fill_13pt_semibold.svg", lock: "lock.fill_13pt_semibold.svg",
    external: "unsized/arrow.up.left.and.arrow.down.right_13pt_regular.svg", popup: "suggested/macwindow.on.rectangle_14pt_regular.svg",
    bell: "bell.fill_14pt_medium.svg", location: "location.fill_14pt_medium.svg", camera: "camera.fill_14pt_medium.svg", mic: "mic.fill_14pt_medium.svg",
    code: "suggested/curlybraces_14pt_regular.svg", arrowDown: "unsized/arrow.down.circle_16pt_regular.svg", chevronRight: "chevron.forward_14pt_bold.svg",
    chevronRightRegular: "unsized/chevron.forward_16pt_regular.svg", chevronDownRegular: "suggested/chevron.down_16pt_regular.svg",
    chevronLeft: "unsized/chevron.backward_16pt_regular.svg", downloadBox: "suggested/square.and.arrow.down_16pt_regular.svg",
    data: "suggested/externaldrive.fill_16pt_regular.svg", scanText: "suggested/text.viewfinder_17pt_regular.svg",
};

test("每个原 ionicons 名字都换成 Rea 导出的 SF 字形（viewBox / path 原样拷贝）", () => {
    expect(Object.keys(G).filter(k => k !== "muteSlash" && k !== "chevronDown").sort()).toEqual(Object.keys(WANT).sort()); // muteSlash = volume + 代码斜杠；chevronDown = chevronRight 旋转 90°（chevronFrame.test.ts），单独测
    for (const [n, f] of Object.entries(WANT)) {
        expect(G[n]!.src).toBe(`arc-icons/sf/${f}`);
        const svg = readFileSync(`/workspace/arc-icons/sf/${f}`, "utf8");
        expect(svg).toContain(`viewBox="${G[n]!.vb}"`);
        expect(svg).toContain(G[n]!.body);
        expect(G[n]!.body).toContain('fill="currentColor"');
    }
});

test("没有 ionicons 残留；4 个无引用的已删；sparkles 不在这里（icons.ts 手写 ⛔）", () => {
    expect(ionSrc).not.toMatch(/-outline_UF[0-9A-F]+\.svg/);
    for (const n of ["arrowUp", "folderOpen", "leave", "history", "sparkles"]) expect(n in G).toBe(false);
    expect(r("src/api/icons.ts")).toMatch(/sparkles: "M7 2\.5/);
});

test("每条都有出处注释（ionicons-to-arc.md 行号）；suggested/ 的条目注明 ⛔ 源码未找到（suggestion）", () => {
    const lines = ionSrc.split("\n");
    for (const [n, f] of Object.entries(WANT)) {
        const i = lines.findIndex(l => l.startsWith(`    ${n}: {`));
        const c = lines[i - 1]!;
        expect(c).toMatch(/^\s+\/\/ .*ionicons-to-arc\.md L\d+/);
        if (f.startsWith("suggested/")) expect(c).toContain("⛔ 源码未找到（suggestion）");
    }
});

test("icon() 用 SF 路径渲染（按 size/pt 缩放，带 arc-src / arc-sf）；变体保留语义类名", async () => {
    const fake = () => { const attrs: Record<string, string> = {}, cls: string[] = []; return { dataset: {}, innerHTML: "", setAttribute: (k: string, v: string) => { attrs[k] = v; }, getAttribute: (k: string) => attrs[k] ?? null, classList: { add: (...c: string[]) => { for (const x of c) if (!cls.includes(x)) cls.push(x); }, contains: (c: string) => cls.includes(c), list: cls } }; };
    const g0 = globalThis as unknown as { document?: unknown }; const prev = g0.document;
    g0.document = { createElementNS: fake };
    const { icon } = await import("../src/api/icons");
    const mk = (n: string, s?: number) => icon(n as never, s) as unknown as ReturnType<typeof fake>;
    const plus = mk("plus", 13), nt = mk("plusMedium"), data = mk("data"), cmd = mk("command", 14);
    g0.document = prev;
    expect(plus.getAttribute("viewBox")).toBe(G.plus!.vb);
    expect(Number(plus.getAttribute("width"))).toBeCloseTo(G.plus!.w * 13 / 16, 3);
    expect(plus.classList.contains("arc-sf") && plus.classList.contains("arc-src")).toBe(true);
    expect(nt.classList.list.filter(c => c.startsWith("arc-svg-"))).toEqual(["arc-svg-plus", "arc-svg-plusMedium"]); // 自测按第一个 arc-svg-* 认图标
    expect(data.innerHTML).toBe(G.data!.body); // data 不再是 downloadBox 别名
    expect(cmd.innerHTML).toBe(G.search!.body); // command → search 别名保留
    expect(cmd.classList.contains("arc-svg-command")).toBe(true);
    expect(ION_VARIANT_OF).toEqual({ plusMedium: "plus", chevronRightRegular: "chevronRight", chevronDownRegular: "chevronDown", muteSlash: "mute" });
});

test("New Tab 行用 plusMedium；Library 搜索放大镜 15×15、primary α.4；底栏 + 仍是代码绘制", () => {
    expect(r("src/plugins/tabs/todayTabs/index.ts")).toContain('icon("plusMedium"), h("span", null, tr("today.newTab"))');
    expect(r("src/plugins/library/style.ts")).toContain(".arc-lib-searchwrap > .arc-svg-search { width: 15px; height: 15px; color: var(--lib-primary); opacity: .4; }");
    const css = r("static/sidepanel.css");
    expect(css).toContain(":root .arc-slot-bottom .arc-plus-btn > .arc-svg { visibility: hidden; }");
    expect(css).toMatch(/\.arc-plus-btn::before[^{]*\{[^}]*width: 14\.4px; height: 2px;/);
});

test("muteSlash = 空心 speaker（同 volume）+ 斜杠；共用 mute 不变；splitSeparate 用 Arc icon-separate-from-split", async () => {
    expect(G.muteSlash!.vb).toBe(G.volume!.vb);
    expect(G.muteSlash!.body.startsWith(G.volume!.body)).toBe(true);
    expect(G.muteSlash!.body).toMatch(/<line [^>]*stroke="currentColor"[^>]*stroke-linecap="round"\/>$/);
    expect(G.mute!.src).toContain("speaker.slash.fill");
    expect(ionSrc).toMatch(/斜杠端点 \/ 线宽 \/ 颜色 \/ 留缝 ⛔ 源码未找到/);
    const { ARC_ICONS, ARC_ICON_SOURCE } = await import("../src/api/arcIcons");
    expect(ARC_ICON_SOURCE.splitSeparate).toContain("ARC_ContextMenus.bundle/icon-separate-from-split-opaque__icon-separate-from-split-opaque-light_1.svg"); expect(ARC_ICONS.splitSeparate!.body).toContain("currentColor"); expect(ARC_ICONS.splitSeparate!.body).not.toMatch(/rgb\(/);
    expect(ARC_ICONS.splitSeparate!.vb).toBe("0 0 22 22");
});

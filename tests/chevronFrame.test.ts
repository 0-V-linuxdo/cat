/* Space / Pinned 折叠箭头（chevronRight / chevronDown）：方框居中 + 收起展开同字重。
 * 根因：SF 字形按 w×h 包围盒渲染（非方形），图标列 x = svg 左边 → 随字形宽度漂移；rel31 为 14×14 方盒。
 * Rea：ionicons-to-arc.md L37 —— 文件夹行折叠箭头只加载 SF chevron.forward，NSImageSymbolConfiguration(14, .bold)；展开是否旋转 ⛔、方框边长 ⛔。 */
import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { ION_GLYPHS } from "../src/api/ionGlyphs";
import { squareVb } from "../src/api/icons";

type G = { src: string; pt: number; w: number; h: number; vb: string; body: string; sq?: boolean };
const GL = ION_GLYPHS as unknown as Record<string, G>;
const vb = (s: string) => s.split(/\s+/).map(Number) as [number, number, number, number];
const center = (s: string) => { const [x, y, w, h] = vb(s); return [x + w / 2, y + h / 2] as const; };
const r = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

const fake = () => { const attrs: Record<string, string> = {}, cls: string[] = []; return { dataset: {}, innerHTML: "", setAttribute: (k: string, v: string) => { attrs[k] = v; }, getAttribute: (k: string) => attrs[k] ?? null, classList: { add: (...c: string[]) => { for (const x of c) if (!cls.includes(x)) cls.push(x); }, contains: (c: string) => cls.includes(c), list: cls } }; };
async function render(names: string[], size: number) {
    const g0 = globalThis as unknown as { document?: unknown }; const prev = g0.document;
    g0.document = { createElementNS: fake };
    const { icon } = await import("../src/api/icons");
    const out = names.map(n => icon(n as never, size) as unknown as ReturnType<typeof fake>);
    g0.document = prev; return out;
}

test("只有两个折叠箭头带 sq（其他 SF 字形仍按 w×h 包围盒，布局不变）", () => {
    expect(Object.entries(GL).filter(([, g]) => g.sq).map(([n]) => n).sort()).toEqual(["chevronDown", "chevronRight"]);
});

test("展开态 = 同一张 chevron.forward 14pt Bold 顺时针转 90°（同字重），绕字形中心转", () => {
    const R = GL.chevronRight!, D = GL.chevronDown!;
    expect(R.src).toBe("arc-icons/sf/chevron.forward_14pt_bold.svg");
    expect(D.src).toBe(R.src);
    expect(D.pt).toBe(14);
    const [cx, cy] = center(R.vb);
    expect(D.body).toBe(`<g transform="rotate(90 ${cx} ${cy})">${R.body}</g>`);
    expect(center(D.vb)).toEqual([cx, cy]);
    const [, , rw, rh] = vb(R.vb), [, , dw, dh] = vb(D.vb);
    expect([dw, dh]).toEqual([rh, rw]);
    expect([D.w, D.h]).toEqual([R.h, R.w]);
    expect(readFileSync(`/workspace/arc-icons/sf/${R.src.replace("arc-icons/sf/", "")}`, "utf8")).toContain(`viewBox="${R.vb}"`);
    expect(r("src/api/ionGlyphs.ts")).toMatch(/展开态 = 同一张 chevron\.forward 14pt Bold.*是否靠旋转、旋转动画 ⛔ 源码未找到/);
});

test("squareVb：正方形、与字形同心、比例不变（1 pt = vbW / w 单位）", () => {
    for (const n of ["chevronRight", "chevronDown"]) {
        const g = GL[n]!; const s = vb(squareVb(g));
        expect(s[2]).toBeCloseTo(s[3], 6);
        expect(s[2]).toBeCloseTo(g.pt * vb(g.vb)[2] / g.w, 1);
        expect(s[2]).toBeCloseTo(g.pt * vb(g.vb)[3] / g.h, 0); // 横纵同比例
        const c = center(squareVb(g)), c0 = center(g.vb);
        expect(c[0]).toBeCloseTo(c0[0], 1); expect(c[1]).toBeCloseTo(c0[1], 1);
    }
});

test("icon(chevron*, 14) 渲染成 14×14 方框（同 rel31 盒），收起 / 展开同盒同心；其他 SF 字形尺寸不变", async () => {
    const [R, D, RR, DR, P] = await render(["chevronRight", "chevronDown", "chevronRightRegular", "chevronDownRegular", "plus"], 14);
    for (const s of [R!, D!]) { expect(s.getAttribute("width")).toBe("14"); expect(s.getAttribute("height")).toBe("14"); }
    expect(center(R!.getAttribute("viewBox")!)[0]).toBeCloseTo(center(D!.getAttribute("viewBox")!)[0], 1);
    expect(center(R!.getAttribute("viewBox")!)[1]).toBeCloseTo(center(D!.getAttribute("viewBox")!)[1], 1);
    // 非 sq：w×h × size/pt，viewBox 原样
    expect(RR!.getAttribute("viewBox")).toBe(GL.chevronRightRegular!.vb);
    expect(Number(RR!.getAttribute("width"))).toBeCloseTo(GL.chevronRightRegular!.w * 14 / 16, 3);
    expect(DR!.getAttribute("viewBox")).toBe(GL.chevronDownRegular!.vb);
    expect(Number(DR!.getAttribute("height"))).toBeCloseTo(GL.chevronDownRegular!.h * 14 / 16, 3);
    expect(DR!.classList.list.filter(c => c.startsWith("arc-svg-"))).toEqual(["arc-svg-chevronDown", "arc-svg-chevronDownRegular"]);
    expect(P!.getAttribute("viewBox")).toBe((ION_GLYPHS as unknown as Record<string, G>).plus!.vb);
});

test("几何：Space 标题 24 槽左缘 = 标签图标容器左缘（favicon 16 居中于 24 槽 → 左缘 = favicon 左 − 4）；箭头字形 14 居中 → 比 favicon 左多 1（Rea §1：19 对 18）", () => {
    const css = r("static/sidepanel.css"), sp = r("src/plugins/spaces/style.ts");
    const padX = Number(css.match(/--arc-pad-x:\s*(\d+)px/)![1]); // 标签行 favicon 左边 = 行左 + pad-x
    const titlePadL = Number(sp.match(/\.arc-space-title \{[^}]*?display: flex;[^}]*?padding: \d+px \d+(?:px)? \d+px (\d+)px/)![1]); // 6 0 2 6：top right bottom left（左 = pad-x − 4，见 style.ts 注释）
    const spanW = Number(sp.match(/\.arc-space-chevron \{[^}]*width: (\d+)px/)![1]);
    const box = 14; // spaceManager / pinnedTabs 调用 svgIcon(chevron*, 14)，sq → 14×14
    expect(titlePadL + (spanW - 16) / 2).toBe(padX); // 6 + (24 − 16) / 2 = 10：槽里 16 字形 / favicon 左缘 = pad-x（槽左 = pad-x − 4，Arc 没有 5）
    expect(titlePadL + (spanW - box) / 2 - padX).toBe(1); // 14 字形居中：比 favicon 左 +1（Rea §1 ⚠ 字形宽度未验证）
    // 旧（非方形）：展开 chevron.down 按 w 渲染 → 左边多出 (14 − 11.874) / 2 ≈ 1.06px（实测 37.06 − 18 = 19.06 = 流式把手 12 + gap 6 + 这 1.06）
    const oldW = 13.57 * 14 / 16;
    expect(+(((box - oldW) / 2)).toFixed(2)).toBe(1.06);
});

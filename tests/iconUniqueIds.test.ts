/* Arc / SF 图标资源（icons.ts）：卡片图标要用的 4 个新 SF 条目（Cat 裁定：五个“SF closest”同一规格 16pt Regular）+ icon() 内部 id 每个实例唯一。
 * 不手写路径：条目的 viewBox / path 必须与 /workspace/arc-icons/sf/ 导出文件一致。 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";

import { ARC_ICONS } from "../src/api/arcIcons";
import { SF_GLYPHS, uniqueIds } from "../src/api/icons";
import { ION_GLYPHS } from "../src/api/ionGlyphs";

const r = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

describe("SF Symbols 导出（不手写路径）", () => {
    /* 名 → Rea 导出文件；五个“SF closest”同一规格：16pt Regular */
    const SF_FILES: Record<string, string> = {
        moonZzz: "suggested/moon.zzz_16pt_regular.svg", textformat: "suggested/textformat_16pt_regular.svg", paintpalette: "suggested/paintpalette_16pt_regular.svg",
        externaldrive: "suggested/externaldrive_16pt_regular.svg", arrowDown: "unsized/arrow.down.circle_16pt_regular.svg", cameraRegular: "camera_16pt_regular.svg",
    };
    const G = { ...ION_GLYPHS, ...SF_GLYPHS } as Record<string, { src: string; pt: number; w: number; h: number; vb: string; body: string }>;
    for (const [n, f] of Object.entries(SF_FILES)) test(`${n} = /workspace/arc-icons/sf/${f}（16pt Regular，viewBox / path 原样拷贝）`, () => {
        expect(G[n]!.src).toBe(`arc-icons/sf/${f}`);
        expect(G[n]!.pt).toBe(16);
        expect(f).toMatch(/_16pt_regular\.svg$/);
        const p = `/workspace/arc-icons/sf/${f}`;
        if (!existsSync(p)) return; // CI 没有 /workspace 时只验证源码里的条目
        const svg = readFileSync(p, "utf8");
        expect(svg).toContain(`viewBox="${G[n]!.vb}"`);
        expect(svg).toContain(G[n]!.body);
        expect(G[n]!.body).toContain('fill="currentColor"');
    });
    test("新增的 4 个 SF 条目注明 ⛔（SF closest, not from Arc ⛔ 图标选择）", () => {
        const lines = r("src/api/icons.ts").split("\n");
        for (const n of ["moonZzz", "textformat", "paintpalette", "externaldrive"]) {
            const i = lines.findIndex(l => l.startsWith(`    ${n}: {`));
            expect(i, n).toBeGreaterThan(0);
            expect(lines[i - 1]).toContain("SF closest, not from Arc ⛔ 图标选择");
        }
    });
    test("data（设置分类标签）仍是 externaldrive.fill，线框 externaldrive 是另一个条目", () => {
        expect(ION_GLYPHS.data.src).toContain("externaldrive.fill");
        expect(SF_GLYPHS.externaldrive.src).not.toContain(".fill");
    });
});

describe("icon() 内部 id 每个实例唯一（遮罩 / 滤镜 / 裁剪）", () => {
    const refs = (b: string) => [...b.matchAll(/(?:href="#|url\(#)([^")]+)/g)].map(m => m[1]!);
    const ids = (b: string) => [...b.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]!);
    test("同一图标两个实例没有重复 id，引用都指向自己的 id", () => {
        for (const [name, v] of Object.entries(ARC_ICONS)) {
            const body = v.body.replaceAll(`#${name}-${name}-`, `#${name}-`); // 同 icon()
            if (!ids(body).length) continue;
            const a = uniqueIds(body), b = uniqueIds(body);
            expect(ids(a).length, name).toBe(ids(body).length);
            expect(ids(a).filter(i => ids(b).includes(i)), name).toEqual([]);
            for (const x of [a, b]) for (const ref of refs(x)) expect(ids(x), `${name}:${ref}`).toContain(ref);
        }
    });
    test("没有 id 的图标原样返回；位图遮罩（tabs / spaces）带后缀", () => {
        expect(uniqueIds("<path d=\"M0 0\"/>")).toBe("<path d=\"M0 0\"/>");
        const t = uniqueIds(ARC_ICONS.tabs!.body);
        expect(t).toMatch(/<mask id="arcm-tabs__\d+"/);
        expect(t).toMatch(/mask="url\(#arcm-tabs__\d+\)"/);
        expect(t).not.toContain('id="arcm-tabs"');
    });
    test("icon() 用 uniqueIds 渲染 Arc 原图", () => {
        expect(r("src/api/icons.ts")).toContain("svg.innerHTML = uniqueIds(arc.body);");
    });
});

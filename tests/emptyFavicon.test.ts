/* EmptyFavicon（archive-page.md §9）：与 Arc 导出的原件一致；TabRow 无图 / 出错 / 默认地球时用它 */
import { test, expect } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { EMPTY_FAVICON_PATH, EMPTY_FAVICON_LAYERS, emptyFavicon } from "../src/components/EmptyFavicon";

const ORIG = "/workspace/arc-icons/favicon-placeholder/EmptyFavicon.svg";
const ROOT = resolve(import.meta.dir, "..");

test.skipIf(!existsSync(ORIG))("路径与两层填充 = Arc 原件 EmptyFavicon.svg", () => {
    const svg = readFileSync(ORIG, "utf8");
    const paths = [...svg.matchAll(/<path d="([^"]+)" fill="([^"]+)" fill-opacity="([^"]+)"/g)].map(m => ({ d: m[1], fill: m[2], opacity: Number(m[3]) }));
    expect(paths.map(p => p.d)).toEqual([EMPTY_FAVICON_PATH, EMPTY_FAVICON_PATH]);
    expect(paths.map(({ fill, opacity }) => ({ fill, opacity }))).toEqual([...EMPTY_FAVICON_LAYERS]);
    expect(svg).toContain(`viewBox="0 0 14 14"`);
});

test("emptyFavicon(size) 生成 14×14 viewBox 的 svg，默认 14，可改尺寸（最小 DOM 桩）", () => {
    const made: any[] = [];
    const el = (tag: string) => { const o: any = { tag, attrs: {} as Record<string, string>, kids: [] as any[], setAttribute(k: string, v: string) { this.attrs[k] = v; }, append(c: any) { this.kids.push(c); } }; made.push(o); return o; };
    const g = globalThis as any, had = g.document;
    g.document = { createElementNS: (_: string, t: string) => el(t) };
    try {
        const a: any = emptyFavicon(), b: any = emptyFavicon(24);
        expect([a.attrs.width, a.attrs.height, a.attrs.viewBox, a.attrs.class]).toEqual(["14", "14", "0 0 14 14", "arc-fav arc-fav-empty"]);
        expect([b.attrs.width, b.attrs.height]).toEqual(["24", "24"]);
        expect(a.kids.map((k: any) => [k.attrs.fill, k.attrs["fill-opacity"]])).toEqual([["#FAFBFF", "0.1"], ["#86888D", "0.2"]]);
    } finally { g.document = had; }
});

test("TabRow：没有图标用 emptyFavicon()，有图标的 <img> 套 withEmptyFallback（出错 / 默认地球兜底）", () => {
    const src = readFileSync(resolve(ROOT, "src/components/TabRow.ts"), "utf8");
    expect(src).toContain(`import { emptyFavicon, withEmptyFallback } from "@components/EmptyFavicon";`);
    expect(src).toMatch(/icon \? withEmptyFallback\(h\("img", \{ class: `arc-fav[^\n]* as HTMLImageElement\) : iconBtn\(emptyFavicon\(\)\),/);
    expect(src).not.toContain(`: h("span", { class: "arc-fav" }),`);
});

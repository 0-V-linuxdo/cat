import { test, expect } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { prepareLottie, PRIMARY_CLASS, SECONDARY_CLASS } from "../src/plugins/library/libraryView/lottieColor";

const DIR = resolve(import.meta.dir, "../src/plugins/library/libraryView/lottie");
const files = readdirSync(DIR).filter(f => f.endsWith(".json"));
const colors = (o: any, out: number[][] = []): number[][] => { if (Array.isArray(o)) o.forEach(x => colors(x, out)); else if (o && typeof o === "object") { if ((o.ty === "fl" || o.ty === "st") && o.c) out.push(o.c.k); Object.values(o).forEach(x => colors(x, out)); } return out; };

test("6 个 Arc 原生 Library Lottie 都在", () => {
    expect(files.toSorted()).toEqual(["archive.json", "boosts.json", "downloads.json", "easels.json", "screenshots.json", "spaces.json"]);
});

test("按图层名打 class：primaryColor → lib-lp，secondaryColor → lib-ls", () => {
    for (const f of files) {
        const src = JSON.parse(readFileSync(resolve(DIR, f), "utf8")), d = prepareLottie(src);
        d.layers.forEach((l: any, i: number) => {
            const nm = src.layers[i].nm;
            expect(l.cl).toBe(nm === "primaryColor" ? PRIMARY_CLASS : nm === "secondaryColor" ? SECONDARY_CLASS : undefined);
        });
    }
});

test("archive.json 写死的蓝 #3134FB 被覆盖；所有纯色中和为白；原数据不被改", () => {
    const src = JSON.parse(readFileSync(resolve(DIR, "archive.json"), "utf8"));
    const blue = (c: number[]) => Math.round(c[0] * 255) === 0x31 && Math.round(c[1] * 255) === 0x34 && Math.round(c[2] * 255) === 0xfb;
    expect(colors(src.layers).some(blue)).toBe(true);
    const out = colors(prepareLottie(src).layers);
    expect(out.length).toBeGreaterThan(0);
    expect(out.every(c => c.join() === "1,1,1,1")).toBe(true);
    expect(colors(src.layers).some(blue)).toBe(true);
});

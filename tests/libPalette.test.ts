import { test, expect } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";
const src = readFileSync(resolve(import.meta.dir, "../src/plugins/library/libraryView/libIcons.ts"), "utf8");
test("Library Lottie：primary=maxContrast、secondary=cutout，不再用 --lib-secondary / accent", () => {
    expect(src).toContain("fill: var(--lib-max-contrast");
    expect(src).toContain("fill: var(--lib-cutout");
    expect(src).not.toMatch(/var\(--lib-secondary/);
    expect(src).toMatch(/\.7; \}/);
    expect(src).toContain("Rea 按亮度做的推断");
});

test("libPalette：cutout 跟随 Space 基色色相（深色 = 最暗档），与 --arc-accent 无关", async () => {
    const { libPalette } = await import("../src/plugins/library/libraryView/libIcons");
    const rgb = (s: string) => s.match(/\d+/g)!.map(Number);
    const purple = rgb(libPalette([110, 80, 230], true).cutout);
    expect(purple[2]).toBeGreaterThan(purple[1]); // 蓝紫基色 → 蓝紫暗档
    const teal = rgb(libPalette([76, 178, 160], true).cutout);
    expect(teal[1]).toBeGreaterThan(teal[0]); // 青绿基色才会得到青绿暗档（52141 实机的 (62,95,90) 即来自 Space 基色本身）
    expect(libPalette([110, 80, 230], false).cutout).toBe(libPalette([110, 80, 230], true).maxContrast);
});

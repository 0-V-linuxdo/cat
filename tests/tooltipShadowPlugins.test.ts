import { test, expect } from "bun:test";
const read = (p: string) => Bun.file(new URL(`../src/plugins/${p}`, import.meta.url)).text();

test("capture 菜单（closed shadow root）直接调 arcTooltip，不再写 data-tip", async () => {
    const s = await read("capture/page.ts");
    expect(s).toContain('attachShadow({ mode: "closed" })');
    expect(s).toContain('import { arcTooltip } from "@components/ArcTooltip"');
    expect(s).toContain('arcTooltip(row, tr("capture.unavailable"))');
    expect(s).not.toMatch(/dataset\.tip|"data-tip"/);
});
test("capture / siteControls 不带原生 title（只用 ArcTooltip）", async () => {
    for (const p of ["capture/page.ts", "views/siteControls/index.ts"]) {
        const s = await read(p);
        expect(s).not.toMatch(/\btitle:\s*[^,}]*[,}]|\.title\s*=|setAttribute\(\s*["']title/);
    }
});

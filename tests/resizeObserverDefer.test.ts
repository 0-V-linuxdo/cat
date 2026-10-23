// 52187：ResizeObserver 回调不得同步写布局（loop 错误）；底栏 Space 首帧需在挂载后计算、宽度 0 时不写
import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

function roCallbacks(src: string) {
    const out: string[] = []; let i = 0;
    while ((i = src.indexOf("new ResizeObserver(", i)) >= 0) {
        let d = 0, j = i + "new ResizeObserver".length;
        for (; j < src.length; j++) { if (src[j] === "(") d++; else if (src[j] === ")" && --d === 0) break; }
        out.push(src.slice(i, j + 1)); i = j;
    }
    return out;
}
const FILES = ["src/components/Menu.ts", "src/plugins/spaces/favorites/index.ts", "src/plugins/spaces/spaceManager/index.ts"];

describe("ResizeObserver 回调延后写入", () => {
    for (const f of FILES) test(f, () => {
        const cbs = roCallbacks(read(f));
        expect(cbs.length).toBeGreaterThan(0);
        for (const cb of cbs) {
            expect(cb).not.toMatch(/style\.|setProperty|classList/);
            expect(cb).toMatch(/requestAnimationFrame|schedule/);
        }
    });
    test("合并 rAF：已排队则不重复", () => {
        expect(read("src/components/Menu.ts")).toMatch(/if \(!raf\) raf = requestAnimationFrame/);
        expect(read("src/plugins/spaces/favorites/index.ts")).toMatch(/if \(!raf\) raf = requestAnimationFrame/);
        expect(read("src/plugins/spaces/spaceManager/index.ts")).toMatch(/if \(st\.raf\) return/);
    });
    test("值未变不写", () => {
        expect(read("src/plugins/spaces/favorites/index.ts")).toMatch(/getPropertyValue\(k\) !== v/);
        expect(read("src/plugins/spaces/spaceManager/index.ts")).toMatch(/st\?\.key !== key/);
    });
});

describe("底栏 Space 首帧布局", () => {
    const s = read("src/plugins/spaces/spaceManager/index.ts");
    test("挂载后排一次计算 + RO 监听宿主宽度", () => {
        expect(s).toMatch(/function layoutDock[\s\S]*scheduleDock\(bar\)[\s\S]*new ResizeObserver\(\(\) => scheduleDock\(bar\)\)/);
    });
    test("宿主宽度 0 时不写 8px 紧凑宽度", () => {
        expect(s).toMatch(/if \(host\.clientWidth <= 0\) return;/);
    });
});

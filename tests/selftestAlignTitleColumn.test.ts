/* 自测框架：selftest 对齐检查（src/selftest/align.ts）量 Space 的 idle 可见图标与标题起始列，相对标签标题 −2（Rea space-header-layout.md §1.2 / §4.6）。 */
import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
const r = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const align = r("src/selftest/align.ts"), st = r("src/selftest/selftest.ts");
test("align.ts：Space 取 idle 可见的 .arc-space-icon；标题起始列相对量（标签 0 / 文件夹 0（title-column：文件夹也是图标左缘 + 26，不再 +1）/ Space −2）", () => {
    expect(align).toMatch(/arc-space-title.*\.arc-space-icon \.arc-svg/);
    expect(align).toContain("badTextX");
    expect(align).toContain("{ tab: 0, newtab: 0, folder: 0, space: -2 }");
});
test("selftest：对齐检查把 badTextX 算进失败；idle 检查要求箭头与图标共用 24×24 槽", () => {
    expect(st).toContain("!badY.length && !badX.length && !badTextX.length");
    expect(st).toContain("箭头与图标应共用同一个 24×24 槽");
});

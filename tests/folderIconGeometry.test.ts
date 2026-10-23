/* D-01：FolderIconView 几何（Rea folder-icon-search-padding.md §B，FUN_101664d8c）：r=round(W/7)，线宽 px(1.25)，frontTop=px(round(H·.25))，tabDrop=floor(frontTop/1.5)，x42/x58=px(W·.42/.58)。 */
import { test, expect } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { folderGeometry } from "../src/api/icons";
const r = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const css = r("src/plugins/tabs/style.ts");

test("17pt @2x：r=2、线宽 1.5、frontTop 4、tabDrop 2、x42=7、x58=10（Rea 给出的具体值）", () => {
    const g = folderGeometry(17, 2);
    expect([g.r, g.stroke, g.frontTop, g.tabDrop, g.x42, g.x58]).toEqual([2, 1.5, 4, 2, 7, 10]);
});
test("17pt @1x：线宽 1，其余相同（Rea：@1x 线宽 1）", () => {
    const g = folderGeometry(17, 1);
    expect([g.r, g.stroke, g.frontTop, g.tabDrop, g.x42, g.x58]).toEqual([2, 1, 4, 2, 7, 10]);
});
test("16pt @2x（Archive 行）：由同一公式算出 r2、frontTop 4、tabDrop 2、x42 6.5、x58 9.5", () => {
    const g = folderGeometry(16, 2);
    expect([g.r, g.stroke, g.frontTop, g.tabDrop, g.x42, g.x58]).toEqual([2, 1.5, 4, 2, 6.5, 9.5]);
});
test("后板路径 = Rea 重建 SVG（按代码几何，17@2x）", () => {
    const d = folderGeometry(17, 2).back;
    expect(d).toBe("M2,0 L7,0 L10,2 L15,2 A2,2 0 0 1 17,4 L17,15 A2,2 0 0 1 15,17 L2,17 A2,2 0 0 1 0,15 L0,2 A2,2 0 0 1 2,0 Z");
    const f = "/workspace/arc-icons/folder/folder_collapsed_17_RECONSTRUCTED.svg";
    if (existsSync(f)) expect(readFileSync(f, "utf8").replace(/\s+/g, " ")).toContain(d.replace(/ A/g, " A"));
});
test("渐变阴影与状态：前板 α.15 / 后板 α.36；opacity 折叠 前 0 / 后 .2，展开 1 / 1", () => {
    const icons = r("src/api/icons.ts");
    expect(icons).toContain("? .36 : .15");
    expect(css).toMatch(/\.arc-fg-bshade \{ opacity: \.2; \}/); expect(css).toMatch(/\.arc-fg-fshade \{ opacity: 0; \}/);
    expect(css).toMatch(/\[data-open="true"\] \.arc-fg-shade \{ opacity: 1; \}/);
});
test("展开 3D：m34 −1/350、translateX 3、绕 Y 32°、后板 X 28°（锚点左下）、前板 X −30°", () => {
    expect(css).toContain("transform: perspective(350px) translateX(3px) rotateY(32deg) rotateX(28deg);");
    expect(css).toContain("transform: perspective(350px) translateX(3px) rotateY(32deg) rotateX(-30deg);");
    expect(css).toMatch(/\.arc-fg-back \{ top: 0; transform-origin: 0 100%; \}/);
});
test("颜色只来自三个变量（stroke / 后板 / 前板），无写死 RGB；非 Arc 取值已 ⛔ 注明", () => {
    expect(css).toMatch(/--arc-folder-stroke: var\(--arc-fg\); --arc-folder-back: var\(--arc-muted\); --arc-folder-front: var\(--arc-base\)/);
    expect(css).toContain("实际 RGB ⛔ 源码未找到");
});

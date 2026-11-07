/* 不再有裸的 z-index 魔法数字：≥ 4（含 2147483647）的层级必须来自 src/utils/zLayers.ts。
 * 例外：共享 static/sidepanel.css（别的线负责，值由 zLayersDialog.test.ts 对齐）、ArcTooltip.ts（已冻结，同样对齐）、selftest。
 * 0–3 / −1 是「某个组件内部」的局部层叠（spaces 图标选择器、splitView 分隔条、标签行 ::before 底板 等），不参与跨组件排序，允许。 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";

import { join } from "node:path";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]);
const root = new URL("..", import.meta.url).pathname;
const files = walk(join(root, "src")).filter(f => f.endsWith(".ts") && !/\/selftest\/|\/utils\/zLayers\.ts$|\/components\/ArcTooltip\.ts$/.test(f)).concat(join(root, "static/options.css"));

describe("层级常量化", () => {
    test("src/**/*.ts 与 options.css 里没有 ≥ 4 的裸 z-index / zIndex 数字，也没有裸的 2147483647", () => {
        const bad: string[] = [];
        for (const f of files) {
            const s = readFileSync(f, "utf8");
            for (const m of s.matchAll(/z-?[iI]ndex["']?\s*[:=]\s*["']?(-?\d+)/g)) if (Math.abs(Number(m[1])) >= 4) bad.push(`${f.replace(root, "")}: z-index ${m[1]}`);
            if (/2147483647/.test(s)) bad.push(`${f.replace(root, "")}: 裸 2147483647（请用 PAGE_Z_MAX）`);
        }
        expect(bad).toEqual([]);
    });
    test("页内侧栏宿主 host.css.ts：根用 PAGE_Z_MAX，shadow 内部每层用 INPAGE_LAYERS（.native 已随 handle 补丁删除，zLayers 里的 native 层也已一并删除）", () => {
        const s = readFileSync(join(root, "src/plugins/inpageSidebar/host.css.ts"), "utf8");
        expect(s).toMatch(/:host \{[^}]*z-index: \$\{PAGE_Z_MAX\}/);
        for (const [sel, k] of [[".hold", "hold"], [".trigger", "trigger"], [".box", "box"], [".handle", "handle"], [".hint", "hint"], [".mask", "mask"]] as const)
            expect(new RegExp(`^\\${sel} \\{[^\\n]*z-index: \\$\\{L\\.${k}\\}`, "m").test(s), `${sel} 应使用 L.${k}`).toBe(true);
    });
    test("内容脚本 UI（截取 / Zap / Peek / 配色层 / 区域截取）都用 PAGE_Z_MAX", () => {
        for (const f of ["src/plugins/capture/page.ts", "src/plugins/views/siteControls/regionCapture.ts", "src/plugins/boosts/zap.ts", "src/plugins/boosts/tint.ts", "src/plugins/views/peek/index.ts"])
            expect(readFileSync(join(root, f), "utf8"), f).toContain("PAGE_Z_MAX");
    });
    test("页内侧栏侧栏 iframe 里的「切到 Chrome 侧栏」角落按钮不再用 2147483647 盖住菜单", () => {
        const s = readFileSync(join(root, "src/plugins/inpageSidebar/panel.ts"), "utf8");
        expect(s).toMatch(/z-index:\$\{Z\.overlay\}/);
        expect(s).not.toMatch(/z-index:2147483647/);
    });
    test("Dialog.ts 确认框遮罩用 Z.confirm、TabRow 行内重命名用 Z.inlineEdit（不写裸数字）", () => {
        const d = read("src/components/Dialog.ts"), t = read("src/components/TabRow.ts");
        expect(d).toMatch(/\.arc-dlg-mask \{[^}]*z-index: \$\{Z\.confirm\}/);
        expect(d).toMatch(/import \{ Z \} from "@utils\/zLayers"/);
        expect(t).toMatch(/z-index:\$\{Z\.inlineEdit\}/);
    });
});

/* B-12：Manage Spaces 拖动把手图标 = Arc icomoon.ttf U+E9A7 四向箭头（audit-52193-answers.md #31）：16pt template 16×16，单色 currentColor。 */
import { test, expect } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { ARC_ICONS, ARC_ICON_SOURCE } from "../src/api/arcIcons";

const SRC = "/workspace/arc-icons/drag-handle/drag-handle-uniE9A7-16.svg"; // 只在有 Rea 导出目录的机器上比对源文件
const tIf = (c: boolean) => c ? test : test.skip;
const fake = () => { const attrs: Record<string, string> = {}, cls: string[] = []; return { innerHTML: "", dataset: {}, setAttribute: (k: string, v: string) => { attrs[k] = v; }, getAttribute: (k: string) => attrs[k] ?? null, querySelectorAll: () => [], classList: { add: (...c: string[]) => { for (const x of c) if (!cls.includes(x)) cls.push(x); }, contains: (c: string) => cls.includes(c), list: cls } }; };

tIf(existsSync(SRC))("arcIcons 有 dragHandle，源文件 = Rea 导出的 U+E9A7 SVG，viewBox = 1em 方框 0 0 1024 1024", () => {
    expect(ARC_ICON_SOURCE.dragHandle).toBe("drag-handle/drag-handle-uniE9A7-16.svg");
    const svg = readFileSync(SRC, "utf8");
    expect(svg).toContain('viewBox="0 0 1024 1024"'); expect(svg).toContain('width="16" height="16"');
    expect(ARC_ICONS.dragHandle!.vb).toBe("0 0 1024 1024");
    const d = svg.match(/ d="([^"]+)"/)![1]!;
    expect(ARC_ICONS.dragHandle!.body).toContain(d);
});

test("单色：没有写死的颜色，只有 currentColor；无 id / url 引用", () => {
    const b = ARC_ICONS.dragHandle!.body;
    expect(b).toContain('fill="currentColor"');
    expect(b).not.toMatch(/#[0-9a-f]{3,6}|rgb\(|black|white|\burl\(|\bid=/i);
});

test("icon('dragHandle', 16) 渲染 16×16，带 arc-src / arc-svg-dragHandle；不是 ionicons / SF 条目", async () => {
    const g0 = globalThis as unknown as { document?: unknown }; const prev = g0.document;
    g0.document = { createElementNS: fake };
    const { icon, ICON_NAMES } = await import("../src/api/icons");
    const { ION_GLYPHS } = await import("../src/api/ionGlyphs");
    const el = icon("dragHandle", 16) as unknown as ReturnType<typeof fake>;
    g0.document = prev;
    expect(el.getAttribute("viewBox")).toBe("0 0 1024 1024");
    expect(el.getAttribute("width")).toBe("16"); expect(el.getAttribute("height")).toBe("16");
    expect(el.classList.contains("arc-src") && el.classList.contains("arc-svg-dragHandle")).toBe(true);
    expect(el.getAttribute("fill")).toBe("currentColor");
    expect("dragHandle" in ION_GLYPHS).toBe(false);
    expect((ICON_NAMES as string[]).includes("dragHandle")).toBe(true);
});

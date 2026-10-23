/* B-12：Manage Spaces 的拖动把手用 dragHandle SVG（不再有 ⋮⋮ 文本；侧栏 Space 标题的把手已按 Rea 移除）；Manage 把手的 hover 值取 Rea（audit-52193-answers.md #31）。需 b12-arcIcons / menu / spaceManager / spaces-style 都打上。 */
import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
const r = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const menu = r("src/plugins/spaces/spaceManager/menu.ts"), mgr = r("src/plugins/spaces/spaceManager/index.ts"), css = r("src/plugins/spaces/style.ts");

test("Manage Spaces menu.ts 的 grip 用 icon('dragHandle', 16)，没有 ⋮ 文本", () => {
    expect(menu).toMatch(/class: "arc-manage-grip"[^\n]*svgIcon\("dragHandle", 16\)/);
    expect(menu).not.toContain("⋮");
});
test("侧栏 Space 标题没有把手（Rea space-header-idle.md §3.2：只有 Manage Spaces 有）：节点和 .arc-space-grabber 样式都已移除，也没有 ⋮", () => {
    expect(mgr).not.toContain("arc-space-grabber");
    expect(mgr).not.toContain("space-grabber");
    expect(mgr).not.toContain("⋮");
    expect(css).not.toContain(".arc-space-grabber");
});
test("Manage 把手 CSS：28×28、圆角 6、浅 #000 α.071 / 深 #FFF α.077、不悬停透明、openHand、当前文字色", () => {
    const g = css.match(/\n\.arc-manage-grip \{([^}]*)\}/)![1]!;
    expect(g).toContain("width: 28px"); expect(g).toContain("border-radius: 6px"); expect(g).toContain("cursor: grab");
    expect(g).toContain("--arc-grip-hover: rgb(0 0 0 / .071)"); expect(g).toContain("background: transparent"); expect(g).toContain("color: inherit");
    expect(css).toMatch(/:root\[data-theme="dark"\] \.arc-manage-grip \{ --arc-grip-hover: rgb\(255 255 255 \/ \.077\); \}/);
    expect(css).toMatch(/prefers-color-scheme: dark\) \{ :root:not\(\[data-theme="light"\]\) \.arc-manage-grip \{ --arc-grip-hover: rgb\(255 255 255 \/ \.077\)/);
    expect(css).toContain(".arc-manage-grip:hover { background: var(--arc-grip-hover); }");
    expect(css).toMatch(/\.arc-manage-grip > \.arc-svg \{ width: 16px; height: 16px;/);
    expect(css).toMatch(/\.arc-manage-row \{[^}]*padding: 4px 8px/);
});

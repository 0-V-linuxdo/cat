/* Library 左栏入口（library-entries.md §2/§3、library-full-spec.md 变更清单） */
import { test, expect } from "bun:test";
const css = await Bun.file(new URL("../src/plugins/library/style.ts", import.meta.url)).text();
const app = await Bun.file(new URL("../static/sidepanel.css", import.meta.url)).text();
test("栏作用域变量 --lib-primary（⛔ 推测）与容器查询", () => {
    expect(css).toMatch(/\.arc-lib-rail \{ container: lib-rail \/ inline-size;/);
    expect(css).toMatch(/--lib-primary: var\(--arc-fg\); \/\* ⛔/);
    expect(css).toContain("@container lib-rail (max-width: 65px) { .arc-lib-lbl { display: none; } }");
});
test("标签 11 Bold，未选中 .7 / 选中 1", () => {
    expect(css).toMatch(/\.arc-lib-lbl \{ font-size: 11px; font-weight: 700;[^}]*color: var\(--lib-primary\); opacity: \.7;/);
    expect(css).toContain(".arc-lib-item.active .arc-lib-lbl { opacity: 1; }");
});
test("选中底 primary α.10、hover α.05、圆角 12", () => {
    expect(css).toContain(".arc-lib-item.active { background: color-mix(in srgb, var(--lib-primary) 10%, transparent); box-shadow: none; }");
    expect(css).toContain(".arc-lib-item:hover { background: color-mix(in srgb, var(--lib-primary) 5%, transparent); }");
    expect(app).toContain(":root .arc-lib-item { border-radius: 12px;");
    expect(app).toContain(":root .arc-lib-item.active { background: color-mix(in srgb, var(--lib-primary, var(--arc-fg)) 10%, transparent)");
});
test("选中图标不变蓝 / 强调色；容器不再设 opacity（透明度交给 Lottie 图层，避免未选中双重 .7）", () => {
    expect(css).not.toMatch(/#3b6cf6|#6f93ff/);
    expect(css).toContain(".arc-lib-item.active .arc-lib-ic { color: var(--lib-primary); }");
    expect(css).not.toMatch(/\.arc-lib-ic \{[^}]*opacity/);
    const sel = app.split("\n").filter(l => l.includes(".arc-lib-item.active .arc-lib-ic"));
    expect(sel.length).toBe(2);
    for (const l of sel) { expect(l).not.toContain("--arc-accent"); expect(l).toContain("var(--lib-primary, var(--arc-fg))"); }
});
test("Lottie 图层透明度：primary .7/1、secondary 0/1（library-entries.md §2）", async () => {
    const li = await Bun.file(new URL("../src/plugins/library/libraryView/libIcons.ts", import.meta.url)).text();
    const lc = await Bun.file(new URL("../src/plugins/library/libraryView/lottieColor.ts", import.meta.url)).text();
    expect(li).toContain(".arc-lib-lottie .${PRIMARY_CLASS} > * { opacity: .7; }");
    expect(li).toContain(".arc-lib-lottie .${SECONDARY_CLASS} > * { opacity: 0; }");
    expect(li).toContain(".arc-lib-item.active .arc-lib-lottie .${PRIMARY_CLASS} > *, .arc-lib-item.active .arc-lib-lottie .${SECONDARY_CLASS} > * { opacity: 1; }");
    expect(lc).toContain('l.nm === "secondaryColor"');
});

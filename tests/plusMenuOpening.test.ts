import { test, expect } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";
const R = (p: string) => readFileSync(resolve(import.meta.dir, "..", p), "utf8");
test("＋ 菜单异步打开期间：标 data-opening，renderAll 推迟；被换掉时不打开游离菜单（st19 回归）", () => {
    const plus = R("src/plugins/command/plusMenu/index.ts"), shell = R("src/api/PanelShell.ts");
    expect(plus).toContain(`menu.dataset.opening = "1";`);
    expect(plus).toMatch(/finally \{ delete menu\.dataset\.opening; \}/);
    expect(plus).toContain("if (!menu.isConnected) return;");
    expect(shell).toContain(`.arc-menu[data-opening]`);
});
test("指针按下期间 renderAll 推迟（按下后 ＋ 被换新会吞掉 click）", () => {
    const shell = R("src/api/PanelShell.ts");
    expect(shell).toContain(`if (pressing || root.querySelector(`);
    expect(shell).toContain(`addEventListener("pointerdown", () => { pressing = true;`);
});

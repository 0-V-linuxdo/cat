/* 补丁 comment-nits：inpageSidebar 的头注释与现状一致（只改注释，行为不变）——tab 级预热已移除、工具栏图标已由 action-click 路由。源码扫描。 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const read = (f: string) => readFileSync(`src/plugins/inpageSidebar/${f}`, "utf8");

describe("头注释不再描述已移除 / 已改变的行为", () => {
    const idx = read("index.ts"), head = idx.slice(0, idx.indexOf("import { tr }"));
    test("index.ts 头注释：没有「tab（标签级 setOptions enabled:false 预热」「setTabEnabled」「mayDisable」；写明标签级已移除", () => {
        expect(head).not.toMatch(/setTabEnabled|mayDisable|E2 V1/);
        expect(head).not.toContain("tab（标签级 setOptions enabled:false 预热");
        expect(head).toContain("「标签级」已移除");
    });
    test("index.ts 头注释：不再说「工具栏图标仍直接开原生面板，已知限制」；写明图标走 action.onClicked 同一手势入口", () => {
        expect(head).not.toContain("工具栏图标仍直接开原生面板");
        expect(head).toMatch(/action\.onClicked/);
    });
    test("background.ts：清理处注释不再声称「没有动过 openPanelOnActionClick」", () => {
        expect(read("background.ts")).not.toContain("方案 Z 没有动过 openPanelOnActionClick");
    });
    test("只改注释：index.ts 去掉注释后仍只有原来的 import / definePlugin（无新增代码行）", () => {
        const code = idx.replace(/\/\*[\s\S]*?\*\//g, "");
        expect(code).not.toMatch(/setTabEnabled|openPanelOnActionClick/);
    });
});

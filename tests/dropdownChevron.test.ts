/* 下拉框箭头保持 SF chevron.down Regular（chevronDown 名字已让给折叠箭头：Bold 旋转） */
import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
test("Dropdown 用 chevronDownRegular", () => {
    const m = readFileSync(new URL("../src/components/Menu.ts", import.meta.url), "utf8");
    expect(m).toContain('}, text, icon("chevronDownRegular"));');
    expect(m).not.toContain('icon("chevronDown")');
});

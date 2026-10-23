import { expect, test } from "bun:test";
import { readFileSync } from "fs";
test("地址栏无后退/前进按钮时不留左侧 4px（左右均 8）", () => {
    const s = readFileSync("src/plugins/command/style.ts", "utf8");
    const base = /\.arc-urlbar \{([^}]*)\}/.exec(s)![1];
    expect(base).not.toContain("margin-left");
    expect(s).toContain(".arc-nav > * + .arc-urlbar { margin-left: 4px; }");
});

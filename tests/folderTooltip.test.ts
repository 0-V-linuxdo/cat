import { test, expect } from "bun:test";
import { readFileSync } from "fs";
const f = readFileSync("src/plugins/tabs/folders/index.ts", "utf8");
const l = readFileSync("src/plugins/tabs/liveFolders/index.ts", "utf8");
test("folder row tooltip: title only, delay 1.5, no native title", () => {
    expect(f).toContain('arcTooltip(head, () => n.title ?? tr("plugin.folders.label"), { delay: 1.5, anchor: "cursor" })');
    expect(f).not.toMatch(/["']title["']\s*:|setAttribute\(["']title/);
    expect(f).not.toContain("data-tip-subtitle");
});
test("live folder item tooltip: title only, delay 1.5", () => {
    expect(l).toContain('i.title, { delay: 1.5, anchor: "cursor" })');
    expect(l).not.toContain("${i.repo} ·");
    expect(l).not.toMatch(/["']title["']\s*:|setAttribute\(["']title/);
});

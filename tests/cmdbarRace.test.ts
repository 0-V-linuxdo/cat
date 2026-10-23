import { expect, test } from "bun:test";
const src = await Bun.file("src/plugins/command/commandBar/index.ts").text();
test("input marks results stale and drops old highlight", () => {
    expect(src).toContain("stale = true;");
    expect(src).toContain(`list.querySelector(".sel")?.classList.remove("sel")`);
});
test("Enter waits for latest search when stale", () => {
    expect(src).toMatch(/if \(stale\) \{ const shift = e\.shiftKey; void waitFresh\(\)\.then\(\(\) => enter\(shift\)\)/);
    expect(src).toContain("if (stale) { go(input.value); return; }");
});
test("out-of-order results discarded via seq", () => {
    expect(src).toContain("if (my !== seq) return;");
    expect(src).toMatch(/stale = false;[\s\S]*paint\(\);/);
});

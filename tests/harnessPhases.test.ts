/* rel47：harness 默认阶段 / 自测页「url 空串回退 pendingUrl」写法的源码守卫（无界面）。
 * 1) 默认 PHASES 必须含 pinhover（真鼠标固定标签图标区 hover），且每个默认阶段名在 harness 里都有对应的 PH.has(...) 代码块（防止改名后默认值指向空阶段）。
 * 2) pinhover / hoverrerender 块都在 SIDEPANEL !== "0" 的大块里，并各自快照 / 还原 data:pinned（互不残留）。
 * 3) selftest.ts / harness 里不再有 `x.url ?? x.pendingUrl`（Chrome 在首次导航未提交时 tab.url 是 ""，?? 不会回退）。 */
import { expect, test } from "bun:test";
import { readFileSync } from "fs";

const harness = readFileSync("scripts/harness-cdp.ts", "utf8");
const selftest = readFileSync("src/selftest/selftest.ts", "utf8");

test("harness 默认 PHASES 含 pinhover，且每个默认阶段都有对应代码块", () => {
    const m = harness.match(/process\.env\.PHASES \?\? "([^"]+)"/);
    expect(m).not.toBeNull();
    const phases = m![1].split(",");
    expect(phases).toContain("pinhover");
    expect(phases).toContain("hoverrerender");
    for (const p of phases) expect(harness).toContain(`PH.has("${p}")`);
    expect(new Set(phases).size).toBe(phases.length);
});

test("pinhover 与 hoverrerender：同在 SIDEPANEL 块内，各自还原 data:pinned", () => {
    const sp = harness.indexOf('if (process.env.SIDEPANEL !== "0") {');
    const spEnd = harness.indexOf("} // SIDEPANEL");
    const ph = harness.indexOf('if (PH.has("pinhover"))'), hr = harness.indexOf('if (PH.has("hoverrerender"))');
    expect(sp).toBeGreaterThan(0);
    expect(ph).toBeGreaterThan(sp); expect(hr).toBeGreaterThan(sp);
    expect(ph).toBeLessThan(spEnd); expect(hr).toBeLessThan(spEnd);
    const phBlock = harness.slice(ph, hr);
    expect(phBlock).toContain('chrome.storage.local.get("data:pinned")'); // 快照
    expect(phBlock).toContain('chrome.storage.local.set({ "data:pinned": r["data:pinned"] })'); // 还原
    const hrBlock = harness.slice(hr, hr + 6000);
    expect(hrBlock).toContain('"data:pinned"');
});

test("隔离子进程（设置全扫 / 自测页）用 PHASES=none，不会重复跑 pinhover", () => {
    expect((harness.match(/PHASES: "none"/g) ?? []).length).toBeGreaterThanOrEqual(2);
});

test("selftest.ts / harness 不再用 url ?? pendingUrl（空串不回退）", () => {
    const re = /\.url \?\? \w+\.pendingUrl/;
    expect(selftest.split("\n").filter(l => re.test(l))).toEqual([]);
    expect(harness.split("\n").filter(l => re.test(l))).toEqual([]);
});

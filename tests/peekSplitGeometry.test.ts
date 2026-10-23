import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { peekWidth, PEEK_CARD_WIDTH_FACTOR } from "../src/plugins/views/peek/geometry";
import { splitRatio, SPLIT_MIN_PANE } from "../src/plugins/views/splitView/geometry";

test("M-02 Peek 宽 = 父窗口 × 0.8，无 720 / 160 / 1280 夹值", () => {
    expect(PEEK_CARD_WIDTH_FACTOR).toBe(0.8);
    expect(peekWidth(1000)).toBe(800);
    expect(peekWidth(600)).toBe(480); // 原先会被夹到 720
    expect(peekWidth(2560)).toBe(2048); // 原先会被夹到 1280
    expect(peekWidth(1601)).toBe(1281);
    const src = readFileSync("src/plugins/views/peek/index.ts", "utf8");
    expect(src).not.toMatch(/Math\.max\(720|pw - 160|, 1280\)/);
    expect(src).toContain("peekWidth(pw)");
});
test("分屏拖动：最小窗格 220（T-S16），替代 0.1 / 0.9", () => {
    expect(SPLIT_MIN_PANE).toBe(220);
    expect(splitRatio(500, 1000)).toBe(0.5);
    expect(splitRatio(50, 1000)).toBeCloseTo(0.22);
    expect(splitRatio(990, 1000)).toBeCloseTo(0.78);
    expect(splitRatio(100, 400)).toBe(0.5); // 不足 2×220
    expect(splitRatio(10, 0)).toBe(0.5);
    expect(readFileSync("src/plugins/views/splitView/index.ts", "utf8")).not.toContain("Math.min(0.9, Math.max(0.1");
});

import { peekHeight, PEEK_DEFAULT_K } from "../src/plugins/views/peek/geometry";
test("Peek size 选项：关闭 → 默认高度公式；打开 → size 影响高度；宽度始终 × 0.8", () => {
    expect(PEEK_DEFAULT_K).toBe(0.8);
    const def = (ph: number) => Math.round(Math.min(ph - 48, ph * 0.9));
    // 关闭：不管 size 是多少都用默认公式
    expect(peekHeight(800, false, 80)).toBe(def(800));
    expect(peekHeight(800, false, 40)).toBe(def(800));
    expect(peekHeight(800, false, 95)).toBe(def(800));
    expect(peekHeight(2000, false, 40)).toBe(1800);
    // 打开：size 代入
    expect(peekHeight(1000, true, 40)).toBe(500);
    expect(peekHeight(1000, true, 60)).toBe(700);
    expect(peekHeight(1000, true, 95)).toBe(940);
    expect(peekHeight(1000, true, 40)).not.toBe(peekHeight(1000, false, 40));
    // 宽度不受影响
    expect(peekWidth(1000)).toBe(800);
    const src = readFileSync("src/plugins/views/peek/index.ts", "utf8");
    expect(src).toMatch(/customSize: \{ type: OptionType\.BOOLEAN, default: false/);
    expect(src).toContain("peekHeight(ph, !!settings.store.customSize, Number(settings.store.size))");
    expect(src).toContain("const width = peekWidth(pw);");
});

test("peek.size 挂在 customSize 下：关闭时设置页隐藏", async () => {
    const src = await Bun.file(new URL("../src/plugins/views/peek/index.ts", import.meta.url)).text();
    expect(/size:\s*\{[^}]*parent:\s*"customSize"/.test(src)).toBe(true);
});

test("splitView「在标签中打开」用 splitSeparate（Arc icon-separate-from-split）", async () => {
    const src = await Bun.file(new URL("../src/plugins/views/splitView/index.ts", import.meta.url)).text();
    expect(src).toMatch(/split\.openInTab"\)[^\n]*icon\("splitSeparate", 14\)/);
    expect(src).not.toMatch(/icon\("external"/);
});

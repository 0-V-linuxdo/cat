import { test, expect } from "bun:test";
import { placeAtCursor, cursorCorners, tipAttrOpts, nextDelay, TOOLTIP_CURSOR_OFFSET, TOOLTIP_ROW_DELAY_S, TOOLTIP_ROW_MAX_WIDTH, TOOLTIP_TITLE_WEIGHT } from "../src/components/ArcTooltip";

const vp = { width: 400, height: 600 };
test("常量（tooltip-row.md）", () => {
    expect(TOOLTIP_CURSOR_OFFSET).toBe(12); expect(TOOLTIP_ROW_DELAY_S).toBe(1.5); expect(TOOLTIP_ROW_MAX_WIDTH).toBe(500); expect(TOOLTIP_TITLE_WEIGHT).toBe(700);
});
test("cursor：默认在光标上方（底边 = y − 12，pinned-hover.md / Cat 定案），x = 鼠标 x", () => {
    expect(placeAtCursor(100, 300, 80, 28, vp)).toEqual({ left: 100, top: 260, flipX: false, flipY: true });
});
test("cursor：上方放不下 → 翻到光标下方（y + 12）", () => {
    expect(placeAtCursor(100, 20, 80, 28, vp)).toEqual({ left: 100, top: 32, flipX: false, flipY: false });
});
test("cursor：右侧放不下 → 向左（右边贴光标）", () => {
    expect(placeAtCursor(380, 300, 80, 28, vp)).toEqual({ left: 300, top: 260, flipX: true, flipY: true });
});
test("cursor：可用区内缩 8，过宽时夹紧", () => {
    const p = placeAtCursor(200, 100, 1000, 28, vp);
    expect(p.left).toBe(8);
    const q = placeAtCursor(2, 2, 40, 28, vp);
    expect(q.left).toBe(8); expect(q.top).toBe(14);
});
test("cursor 圆角：靠光标的角 3，其余 14", () => {
    expect(cursorCorners(false, false)).toEqual([3, 14, 14, 14]);
    expect(cursorCorners(true, false)).toEqual([14, 3, 14, 14]);
    expect(cursorCorners(true, true)).toEqual([14, 14, 3, 14]);
    expect(cursorCorners(false, true)).toEqual([14, 14, 14, 3]);
});
test("data-tip-anchor / -delay / -max-width 解析", () => {
    expect(tipAttrOpts("cursor", 1.5, 500)).toEqual({ anchor: "cursor", delay: 1.5, maxWidth: 500 });
    expect(tipAttrOpts("other", NaN, NaN)).toEqual({});
    expect(tipAttrOpts(null, -1, 0)).toEqual({});
    expect(tipAttrOpts(null, 0.01, NaN)).toEqual({ delay: 0.01 });
});
test("预热：关闭后 0.6s 内再显示 → 0.01s", () => {
    expect(nextDelay(1.5, 0.59)).toBe(0.01); expect(nextDelay(1.5, 0.6)).toBe(1.5);
});

import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { MEDIA_MARQUEE_DEFAULT, mediaMarqueeAttr } from "../src/plugins/library/media/state";

test("M-01：标题滚动开关默认关（mini-player-marquee-title-enabled = false）", () => {
    expect(MEDIA_MARQUEE_DEFAULT).toBe(false);
    const src = readFileSync("src/plugins/library/media/index.ts", "utf8");
    expect(src).toMatch(/mediaMarqueeTitle: \{ type: OptionType\.BOOLEAN, default: MEDIA_MARQUEE_DEFAULT/);
    expect(src).toContain("settings,"); expect(src).toContain("onSettingsChange: () => refresh()");
    // 两处标题都走 mediaTitle（不再直接写 arc-media-title + 裸 span）
    expect(src.match(/mediaTitle\(t\.title/g)!.length).toBe(2);
    expect(src).not.toMatch(/class: "arc-media-title", (onclick|"data-tip")/);
});
test("关 = data-marquee 0（省略号、无遮罩）；开 = 1（跑马灯）；样式只在 style.ts，无内联", () => {
    expect(mediaMarqueeAttr(false)).toBe("0");
    expect(mediaMarqueeAttr(true)).toBe("1");
    const css = readFileSync("src/plugins/library/style.ts", "utf8");
    expect(css).toMatch(/\.arc-media-title\[data-marquee="1"\] span \{[^}]*animation: arc-marquee 12s linear infinite/);
    expect(css).toMatch(/\.arc-media-title\[data-marquee="0"\] \{[^}]*text-overflow: ellipsis[^}]*-webkit-mask-image: none/);
    const src = readFileSync("src/plugins/library/media/index.ts", "utf8");
    expect(src).not.toMatch(/animation: none|st\.outer|st\.inner/);
});

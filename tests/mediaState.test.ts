import { test, expect } from "bun:test";
import { micIcon, camIcon, playIcon, volumeIcon } from "../src/plugins/library/media/state";
import { SF_GLYPHS } from "../src/api/icons";

test("mic / cam / play 状态 → 图标", () => {
    expect(micIcon(true, true)).toBe("micFill"); expect(micIcon(true, false)).toBe("micSlashFill");
    expect(micIcon(false, false)).toBe("micFill"); expect(micIcon(false, true)).toBe("micFill");
    expect(camIcon(true, true)).toBe("videoFill"); expect(camIcon(true, false)).toBe("videoSlashFill");
    expect(camIcon(false, false)).toBe("videoFill"); expect(camIcon(false, true)).toBe("videoFill");
    expect(playIcon(true)).toBe("play"); expect(playIcon(false)).toBe("pause");
});
test("音量分档（FUN_102495334）", () => {
    expect(volumeIcon(true, 1)).toBe("speakerSlashFill");
    expect(volumeIcon(false)).toBe("speakerWave3Fill");
    expect(volumeIcon(false, 0)).toBe("speakerFill");
    expect(volumeIcon(false, 0.2)).toBe("speakerWave1Fill");
    expect(volumeIcon(false, 1 / 3)).toBe("speakerWave2Fill");
    expect(volumeIcon(false, 0.5)).toBe("speakerWave2Fill");
    expect(volumeIcon(false, 2 / 3)).toBe("speakerWave3Fill");
});
test("图标都在 SF_GLYPHS 且字号正确", () => {
    const g = SF_GLYPHS as Record<string, { pt: number }>;
    for (const n of ["micFill", "micSlashFill", "videoFill", "videoSlashFill", "play", "pause"]) expect(g[n]?.pt).toBe(14);
    for (const n of ["speakerSlashFill", "speakerFill", "speakerWave1Fill", "speakerWave2Fill", "speakerWave3Fill"]) expect(g[n]?.pt).toBe(12);
});

import { paneMuted, splitMuteIcon } from "../src/plugins/library/media/state";
test("分屏面板静音：读真实媒体状态", () => {
    expect(paneMuted([])).toBeNull();
    expect(paneMuted([true, true])).toBe(true);
    expect(paneMuted([true, false])).toBe(false);
    expect(splitMuteIcon(null)).toBe("volume"); expect(splitMuteIcon(false)).toBe("volume"); expect(splitMuteIcon(true)).toBe("muteSlash");
});

test("迷你播放器：无「离开会议」按钮（Arc 无）；音量选择器只作用于 ≥5 按钮的媒体行", async () => {
    const src = await Bun.file(new URL("../src/plugins/library/media/index.ts", import.meta.url)).text();
    expect(src).not.toContain("media.meetLeave"); expect(src).not.toContain('icon("leave")'); expect(src).not.toContain('"leave"');
    const media = src.slice(src.indexOf('media.map(t => h("div", { class: "arc-media-row" }'));
    const btns = media.slice(0, media.indexOf("},\n                }),")).match(/h\("button"/g) ?? [];
    expect(btns.length).toBe(5); // play, next, pip, volume(第 4 个), close
    const css = await Bun.file(new URL("../src/plugins/library/style.ts", import.meta.url)).text();
    expect(css).toContain(".arc-media-row:has(> button:nth-of-type(5)) > button:nth-of-type(4)");
});

test("媒体行图标框：同 Archive（.arc-lib-favbox / .no-fav），加载失败切 no-fav", async () => {
    const { mediaFavSrc } = await import("../src/plugins/library/media/state");
    expect(mediaFavSrc("https://x.com/favicon.ico")).toBe("https://x.com/favicon.ico");
    expect(mediaFavSrc(undefined)).toBeNull(); expect(mediaFavSrc("")).toBeNull();
    expect(mediaFavSrc("chrome://favicon/x")).toBeNull();
    const src = await Bun.file(new URL("../src/plugins/library/media/index.ts", import.meta.url)).text();
    expect(src).not.toContain('h("img", { class: "arc-fav", src: t.favIconUrl');
    expect(src.match(/mediaFav\(t\)/g)?.length).toBe(2); // Meet 行 + 媒体行
    expect(src).toContain('import { favBox } from "../libraryView"');
    expect(src).toContain('h("span", { class: "arc-lib-favbox"');
    expect(src).toMatch(/onerror: [^\n]*box\.classList\.add\("no-fav"\)/);
    const css = await Bun.file(new URL("../static/sidepanel.css", import.meta.url)).text();
    expect(css).toContain(".arc-lib-favbox.no-fav {"); expect(css).toMatch(/\.arc-lib-favbox \{[^}]*background: none/);
});

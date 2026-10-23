/* 图标回归：生成的 Arc SVG 内部引用（<use href> / url()）修正后必须都能找到目标 id（否则遮罩为空 → 图标空白 / 缺块）；
 * “+”菜单图标集合与彩色判定。 */
import { test, expect } from "bun:test";
import { ARC_ICONS } from "../src/api/arcIcons";
import { isChromatic, PLUS_MENU_ICONS } from "../src/api/icons";

test("Arc 图标内部引用都能解析（id 前缀去重后）", () => {
    const bad: string[] = [];
    for (const [name, v] of Object.entries(ARC_ICONS)) {
        const body = v.body.replaceAll(`#${name}-${name}-`, `#${name}-`); // 同 icons.ts icon()
        const ids = new Set([...body.matchAll(/id="([^"]+)"/g)].map(m => m[1]));
        for (const m of body.matchAll(/(?:href="#|url\(#)([^")]+)/g)) if (!ids.has(m[1])) bad.push(`${name}:${m[1]}`);
    }
    expect(bad).toEqual([]);
});
test("“+”菜单图标集合 / 彩色判定", () => {
    for (const n of ["addSpace", "folder", "splitAdd", "addTab", "boost"]) expect(PLUS_MENU_ICONS.has(n)).toBe(true);
    expect(isChromatic(ARC_ICONS.trash!.body)).toBe(true);
    expect(isChromatic(ARC_ICONS.addTab!.body)).toBe(false);
});

test("“+”菜单 New Folder 用 SF folder 20pt（非 PNG）", async () => {
    const src = await Bun.file(new URL("../src/api/icons.ts", import.meta.url)).text();
    const line = src.split("\n").find(l => /^\s+folder: \{ src: "arc-icons\/sf\/folder_20pt_medium\.svg", pt: 20,/.test(l));
    expect(line).toBeTruthy();
    expect(line).toContain("fill=\\\"currentColor\\\"");
    expect(line).not.toContain(".png");
    const sfStart = src.indexOf("export const SF_GLYPHS = {"), sfEnd = src.indexOf("} as const;", sfStart);
    expect(src.indexOf(line!)).toBeGreaterThan(sfStart);
    expect(src.indexOf(line!)).toBeLessThan(sfEnd);
    const menu = await Bun.file(new URL("../src/plugins/command/plusMenu/index.ts", import.meta.url)).text();
    expect(menu).toContain('label: "plus.newFolder", icon: "folder"');
    expect(menu).toContain("icon(it.icon, 20)");
});

test("SF_GLYPHS 含 arrowDownBold（arrow.down Bold 10pt，currentColor）", async () => {
    const src = await Bun.file(new URL("../src/api/icons.ts", import.meta.url)).text();
    const line = src.split("\n").find(l => /^\s+arrowDownBold: \{ src: "arc-icons\/sf\/arrow\.down_10pt_bold\.svg", pt: 10, w: 7\.837, h: 9\.351,/.test(l));
    expect(line).toBeTruthy();
    expect(line).toContain("fill=\\\"currentColor\\\"");
    const sfStart = src.indexOf("export const SF_GLYPHS = {"), sfEnd = src.indexOf("} as const;", sfStart);
    expect(src.indexOf(line!)).toBeGreaterThan(sfStart);
    expect(src.indexOf(line!)).toBeLessThan(sfEnd);
});

test("SF_GLYPHS 已导出，含自测要求的 12 个名字", async () => {
    const { SF_GLYPHS } = await import("../src/api/icons");
    for (const n of ["arrowDownBold", "micFill", "micSlashFill", "videoFill", "videoSlashFill", "speakerFill", "speakerSlashFill", "speakerWave1Fill", "speakerWave2Fill", "speakerWave3Fill", "xmark", "xmarkCircleFill"]) expect(n in SF_GLYPHS).toBe(true);
});

test("broom：Arc 模板图 broom-stick（arc-icons/tidy/broom.svg），12pt、单色 currentColor、无 clip / 白色", async () => {
    const { SF_GLYPHS } = await import("../src/api/icons");
    const b = (SF_GLYPHS as Record<string, { src: string; pt: number; w: number; h: number; vb: string; body: string }>).broom!;
    expect(b.src).toBe("arc-icons/tidy/broom.svg"); expect([b.pt, b.w, b.h, b.vb]).toEqual([12, 12, 12, "0 0 28 28"]);
    expect(b.body.match(/<path /g)?.length).toBe(2);
    expect(b.body).not.toMatch(/black|white|clip/);
    expect(b.body.match(/fill="currentColor"/g)?.length).toBe(2);
});

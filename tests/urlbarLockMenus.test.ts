import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";

/* urlbar-menus-followup.md（Rea）：地址栏 lock.slash.fill 字形 / 悬停 α、固定标签菜单组 6、文件夹菜单顺序与删除确认 */
const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const en = src("src/i18n/en.ts"), zh = src("src/i18n/zh.ts");
const menus = src("src/api/ContextMenus.ts");
const layout = (kind: string) => Object.fromEntries([...menus.match(new RegExp(`\\b${kind}: \\{([^}]*)\\}`))![1].matchAll(/(\w+): \[(\d+), (\d+)\]/g)].map(m => [m[1], [+m[2], +m[3]]]));

describe("urlbar-menus-followup", () => {
    test("§1 lockSlashFill = arc-icons/urlbar 14×14 导出原样（currentColor 模板图）", async () => {
        const { SF_GLYPHS } = await import("../src/api/icons");
        const g = (SF_GLYPHS as Record<string, { src: string; pt: number; w: number; h: number; vb: string; body: string }>).lockSlashFill!;
        expect([g.src, g.pt, g.w, g.h, g.vb]).toEqual(["arc-icons/urlbar/lock.slash.fill_14x14.svg", 14, 14, 14, "0 0 14 14"]);
        const svg = readFileSync("/workspace/arc-icons/urlbar/lock.slash.fill_14x14.svg", "utf8").match(/<path[^>]*\/>/)?.[0];
        if (svg) expect(g.body).toBe(svg);
        expect(g.body).toContain('fill="currentColor"');
    });
    test("§2.2 不安全图标 α .75，悬停 .95（浅 / 深）", () => {
        const st = src("src/plugins/command/style.ts");
        expect(st).toContain(".arc-urlbar-icon.arc-insecure { color: rgb(245 55 20 / .75); }");
        expect(st).toContain(".arc-urlbar-icon.arc-insecure:hover { color: rgb(245 55 20 / .95); }");
        expect(st).toContain(':root[data-theme="dark"] .arc-urlbar-icon.arc-insecure:hover { color: rgb(242 94 107 / .95); }');
        expect(st).toMatch(/width: 22px; height: 22px/);
    });
    test("§4 固定标签右键菜单：无 Reset / Unpin / Delete，组 6 只有 Remove Pin（「菜单定案」§4）", () => {
        const pin = src("src/plugins/tabs/pinnedTabs/index.ts");
        const items = pin.slice(pin.indexOf("        pinned: ["), pin.indexOf("    background:"));
        for (const id of ["reset", "unpin", "delete"]) expect(items).not.toContain(`id: "${id}"`);
        expect(items).not.toContain('id: "closeTab"');
        // rel65 ①：Remove Pin 不再关标签（removePinsKeepOpen：标签回到 Today 顶部）
        expect(items).toMatch(/id: "removePin", label: "pinned\.removePin", run: t => removePinsKeepOpen\(\[t\.itemId!\]\)/);
        expect(items).not.toContain("unpin(t.itemId!, true)");
        const l = layout("pinned");
        expect(l.closeTab).toBeUndefined(); expect(l.removePin).toEqual([6, 61]);
        expect(Object.keys(l)).not.toContain("reset");
        expect(en).not.toContain('"pinned.closeTab"'); expect(en).toContain('"pinned.removePin": "Remove Pin"');
        expect(zh).not.toContain('"pinned.closeTab"'); expect(zh).toContain('"pinned.removePin":');
    });
    test("§5.1 文件夹菜单顺序", () => {
        const l = layout("folder");
        const order = ["sub", "toSpace", "copyLinks", "copyMd", "changeIcon", "rename", "dup", "move", "delete"];
        const keyed = order.map(id => l[id]![0] * 1000 + l[id]![1]);
        expect([...keyed].sort((a, b) => a - b)).toEqual(keyed);
        expect(l.sub![0]).toBe(l.copyLinks![0]); expect(l.changeIcon![0]).toBe(l.rename![0]); expect(l.dup![0]).toBe(l.move![0]);
        expect(new Set([l.sub![0], l.changeIcon![0], l.dup![0], l.delete![0]]).size).toBe(4);
        const f = src("src/plugins/tabs/folders/index.ts");
        for (const id of order) expect(f).toContain(`id: "${id}"`);
        expect(f).not.toMatch(/id: "share"/); // Share Folder… 扩展没有 ⛔
        expect(f).toMatch(/id: "toSpace", label: t => tr\("folders\.toSpace", t\.title \?\? ""\)/);
        for (const kv of ['"folders.copyAll": "Copy All Links"', '"folders.newSub": "New Nested Folder…"', '"folders.rename": "Rename…"', '"folders.toSpace": "Turn “{0}” into Space"']) expect(en).toContain(kv);
    });
    test("§5.2 链接格式：普通 = 网址逐行；Markdown = 多项 \"- [t](u)\"、单项无前缀", () => {
        const f = src("src/plugins/tabs/folders/index.ts");
        expect(f).toMatch(/folderLinks\(f\)\.map\(l => l\.url\)\.join\("\\n"\)/);
        expect(f).toMatch(/pre = links\.length !== 1 \? "- " : ""/);
        expect(f).toContain("links.map(l => `${pre}[${l.title}](${l.url})`).join(\"\\n\")");
    });
    test("§5.3 删除确认文案与按钮", () => {
        const f = src("src/plugins/tabs/folders/index.ts");
        expect(f).toContain('title ? tr("folders.deleteConfirm", title) : tr("folders.deleteConfirmNoName")');
        expect(f).toMatch(/ok: tr\("folders\.delete"\)/);
        for (const kv of ['"folders.deleteConfirm": "Delete your “{0}” folder?"', '"folders.deleteConfirmNoName": "Are you sure?"', '"folders.deleteDetail": "Deleting this folder will archive the tabs inside it."', '"folders.delete": "Delete Folder"', '"common.cancel": "Cancel"']) expect(en).toContain(kv);
        for (const k of ["folders.deleteConfirmNoName", "folders.copyAllMd", "folders.rename"]) expect(zh).toContain(`"${k}":`);
    });
});

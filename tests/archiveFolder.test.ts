/* 补丁 archive-folder：文件夹归档 / Put back 整体取回（urlbar-menus-followup.md「菜单定案」§3） —— 复制到 tests/ */
import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import { putBackFolder } from "@plugins/tabs/archive";

test("putBackFolder：子项一起放回原空间末尾；id 冲突时换新 id；不改原条目", () => {
    const folder = { id: "f", kind: "folder", title: "F", children: [{ id: "a", kind: "tab", url: "https://a" }, { id: "b", kind: "tab", url: "https://b" }] } as never;
    const bySpace: Record<string, { id: string; children?: unknown[] }[]> = { s1: [{ id: "x" }], s2: [{ id: "a" }] };
    const n = putBackFolder(bySpace as never, "s1", folder) as unknown as { id: string; children: { id: string; url: string }[] };
    expect(bySpace.s1!.at(-1)).toBe(n as never);
    expect(n.id).toBe("f");
    expect(n.children.map(c => c.url)).toEqual(["https://a", "https://b"]);
    expect(n.children[0]!.id).not.toBe("a"); expect(n.children[1]!.id).toBe("b");
    expect((folder as { children: { id: string }[] }).children[0]!.id).toBe("a");
});
test("archive:addFolder 标记随文件夹关闭的标签不再逐个归档；restore 文件夹走 Put back", () => {
    const s = readFileSync("src/plugins/tabs/archive/index.ts", "utf8");
    expect(s).toContain("if (folderClosing.delete(id)) return;");
    expect(s).toContain('handle("archive:addFolder"'); expect(s).toContain('reason: "closed", folder: f });');
    expect(s).toMatch(/if \(it\.folder\) \{[\s\S]{0,300}putBackFolder\(x\.bySpace, sp, it\.folder!\)/);
    const lib = readFileSync("src/plugins/library/libraryView/index.ts", "utf8");
    expect(lib).toContain('"data-test": "lib-folderbox"');
});

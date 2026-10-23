import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import type { ArchivedTab } from "@plugins/tabs/archive";
import { expectedArchiveCount, pickCreatedArchiveIds, withoutArchiveIds } from "../src/plugins/spaces/spaceManager/archiveUndo";

/* audit-arc-diff-52193 B-09：删除 Space → 撤销后，归档里不留下本次删除新增的条目；删除前已有的条目保留 */
const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const T0 = 1_000_000;
const a = (id: string, url: string, closedAt: number, spaceId?: string): ArchivedTab => ({ id, url, title: url, closedAt, spaceId, reason: "closed" });

/** 模拟 spaces:delete：直接写入未打开的固定项，Archive 的 onRemoved 再异步写入打开的标签（无 spaceId）；同时别的空间也关了一个标签 */
function simulateDelete(before: ArchivedTab[]) {
    const beforeIds = new Set(before.map(i => i.id));
    const direct = ["pin1", "pin2"];
    const closedUrls = ["https://a.com/", "https://a.com/", "https://b.com/", "chrome://newtab/"];
    const items = [
        a("other", "https://a.com/", T0 + 5, "space-2"), // 别的空间同时关闭的同网址标签：不属于本次删除
        a("t3", "https://b.com/", T0 + 4), a("t2", "https://a.com/", T0 + 3), a("t1", "https://a.com/", T0 + 2),
        a("pin2", "https://pinned2.com/", T0 + 1), a("pin1", "https://pinned1.com/", T0 + 1),
        ...before,
    ];
    return { items, created: pickCreatedArchiveIds(items, beforeIds, direct, closedUrls, T0), want: expectedArchiveCount(direct, closedUrls) };
}

describe("B-09 撤销删除 Space 不留重复归档项", () => {
    const before = [a("old1", "https://a.com/", T0 - 1000), a("old2", "https://pinned1.com/", T0 - 2000, "space-x"), a("old3", "https://b.com/", T0 - 10)];

    test("delete → 认领的正好是本次删除新增的 id（不含别的空间 / 删除前已有的同网址项；chrome:// 不计）", () => {
        const { created, want } = simulateDelete(before);
        expect(want).toBe(5);
        expect(created.toSorted()).toEqual(["pin1", "pin2", "t1", "t2", "t3"]);
    });

    test("delete → undo：没有新增 / 重复的归档项，删除前已有的条目全部保留且顺序不变", () => {
        const { items, created } = simulateDelete(before);
        const after = withoutArchiveIds(items, created);
        expect(after.map(i => i.id)).toEqual(["other", "old1", "old2", "old3"]);
        const beforeIds = new Set(before.map(i => i.id));
        expect(after.filter(i => !beforeIds.has(i.id)).map(i => i.id)).toEqual(["other"]); // 只剩与本次删除无关的
        for (const b of before) expect(after).toContainEqual(b);
    });

    test("onRemoved 还没写完时只认领已写入的；无关项和删除前已有项永远不会被认领", () => {
        const beforeIds = new Set(before.map(i => i.id));
        const items = [a("t1", "https://a.com/", T0 + 2), a("pin1", "https://pinned1.com/", T0 + 1), ...before];
        expect(pickCreatedArchiveIds(items, beforeIds, ["pin1", "pin2"], ["https://a.com/", "https://a.com/"], T0).toSorted()).toEqual(["pin1", "t1"]);
        expect(pickCreatedArchiveIds(before, beforeIds, [], ["https://a.com/", "https://b.com/"], T0 - 5000)).toEqual([]);
    });

    test("Archive 关闭时：没有新增，撤销什么都不删", () => {
        expect(pickCreatedArchiveIds(before, new Set(before.map(i => i.id)), [], [], T0)).toEqual([]);
        expect(withoutArchiveIds(before, [])).toEqual(before);
    });

    test("接线：spaces:delete 返回新增 id；deleteSpace 记 spaceDelete 撤销；撤销只删这些 id", () => {
        const sm = src("src/plugins/spaces/spaceManager/index.ts");
        expect(sm).toContain("return created;");
        expect(sm).toMatch(/recordUndo\("spaceDelete", tr\("spaces\.delete"\), \{ items, archiveIds \}/);
        expect(sm).toContain('addUndoKind("spaceDelete", revertSpaceDelete)');
        expect(sm).toMatch(/x\.items = withoutArchiveIds\(x\.items, archiveIds\)/);
        expect(sm).not.toContain("snapshotStores([spacesStore, pinnedStore])");
    });
});

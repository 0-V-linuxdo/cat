/* 补丁 rel65-pin-unpin（用户 11/2 定，Arc 行为）：① Remove Pin 不关标签、标签回到 Today 顶部、不进最近关闭；没打开的只移除条目 ② Today 行右键「Pin Tab」= 拖进固定区；两者都有 ⌘Z 撤销 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { openTabIdsOf, todayTopIndex } from "../src/plugins/tabs/pinnedTabs/keepOpen";
import { detach, type PinNode } from "../src/plugins/tabs/pinnedTabs/model";

const r = (p: string) => readFileSync(p, "utf8");

/** 按 Chrome 的 tabs.move(ids, { index }) 语义模拟（逐个移动，每个落到 index 的最终位置，index ≠ -1 时依次 +1） */
function simMove(strip: number[], ids: number[], index: number) {
    const s = [...strip];
    let at = index;
    for (const id of ids) {
        s.splice(s.indexOf(id), 1);
        if (at === -1 || at > s.length) s.push(id); else s.splice(at, 0, id);
        if (at !== -1) at++;
    }
    return s;
}
const pos = (strip: number[]) => strip.map((id, index) => ({ id, index }));
/** Today 的显示顺序（todayTabs()：top = 标签条倒序，bottom = 正序） */
const todayView = (strip: number[], today: Set<number>, order: "top" | "bottom") => { const l = strip.filter(id => today.has(id)); return order === "top" ? l.toReversed() : l; };

describe("todayTopIndex：标签回到 Today 顶部", () => {
    test("order=top（默认 / 未设置）→ -1（标签条末尾 = Today 顶部）", () => {
        expect(todayTopIndex("top", pos([1, 2, 3]), [2, 3], [1])).toBe(-1);
        expect(todayTopIndex(undefined, pos([1, 2, 3]), [2, 3], [1])).toBe(-1);
        const s = simMove([1, 2, 3], [1], -1);
        expect(todayView(s, new Set([1, 2, 3]), "top")[0]).toBe(1);
    });
    test("order=bottom：放到第一个 Today 标签之前；被移动的标签在前面时不计入（最终位置语义）", () => {
        // 标签条：P(1, 固定) T(2) T(3)；把 1 移回 Today 顶部
        const i = todayTopIndex("bottom", pos([1, 2, 3]), [2, 3], [1]);
        expect(i).toBe(0);
        expect(todayView(simMove([1, 2, 3], [1], i), new Set([1, 2, 3]), "bottom")).toEqual([1, 2, 3]);
        // F(9, 收藏) T(2) P(1) T(3)：1 在后面 → 放到 2 之前（前面只有 9）
        const j = todayTopIndex("bottom", pos([9, 2, 1, 3]), [2, 3], [1]);
        expect(j).toBe(1);
        expect(todayView(simMove([9, 2, 1, 3], [1], j), new Set([1, 2, 3]), "bottom")).toEqual([1, 2, 3]);
    });
    test("order=bottom 多个标签：保持给定顺序，整体在 Today 顶部", () => {
        const strip = [5, 6, 2, 3]; // 5、6 是被移除固定的两个，2、3 是 Today
        const i = todayTopIndex("bottom", pos(strip), [2, 3], [6, 5]);
        expect(todayView(simMove(strip, [6, 5], i), new Set([2, 3, 5, 6]), "bottom")).toEqual([6, 5, 2, 3]);
    });
    test("Today 为空 → -1", () => {
        expect(todayTopIndex("bottom", pos([1]), [], [1])).toBe(-1);
        expect(todayTopIndex("bottom", pos([1, 2]), [1], [1])).toBe(-1); // 唯一的 Today 就是被移动的
    });
});

describe("openTabIdsOf：哪些标签要保持打开", () => {
    test("只要还活着的 tabId；没打开（无 tabId / 死 id）的只移除条目；文件夹子项也算；去重", () => {
        const alive = new Set([1, 2, 4]);
        const nodes: PinNode[] = [{ id: "a", kind: "tab", tabId: 1 }, { id: "b", kind: "tab", url: "https://x" }, { id: "c", kind: "tab", tabId: 3, closedTabId: 3 }, { id: "f", kind: "folder", children: [{ id: "d", kind: "tab", tabId: 2 }, { id: "e", kind: "tab", tabId: 1 }] }];
        expect(openTabIdsOf(nodes, id => alive.has(id))).toEqual([1, 2]);
        expect(openTabIdsOf([], () => true)).toEqual([]);
    });
    test("移除固定项：只删条目，其它固定项不动", () => {
        const list: PinNode[] = [{ id: "a", kind: "tab", tabId: 1 }, { id: "b", kind: "tab", tabId: 2 }];
        const n = detach(list, "a");
        expect(n?.tabId).toBe(1);
        expect(list.map(x => x.id)).toEqual(["b"]);
    });
});

describe("源码扫描", () => {
    const pin = r("src/plugins/tabs/pinnedTabs/index.ts");
    const fn = (name: string) => pin.slice(pin.indexOf(`export async function ${name}`), pin.indexOf("\n}\n", pin.indexOf(`export async function ${name}`)));
    test("① removePinsKeepOpen：先记固定区快照撤销，再移除；不调 chrome.tabs.remove（不进最近关闭），打开的标签移到 Today 顶部", () => {
        const f = fn("removePinsKeepOpen");
        expect(f.indexOf("recordStoreUndo(label, pinnedStore)")).toBeGreaterThan(0);
        expect(f.indexOf("recordStoreUndo(")).toBeLessThan(f.indexOf("mutateSpace("));
        expect(f).not.toContain("chrome.tabs.remove");
        expect(f).toContain("moveToTodayTop(open)");
        const m = pin.slice(pin.indexOf("async function moveToTodayTop"), pin.indexOf("export async function pinFromToday"));
        expect(m).not.toContain("chrome.tabs.remove");
        expect(m).toContain('getPluginSettings("TodayTabs").order');
        expect(m).toContain("todayTopIndex(order, tabs, today, mine)");
    });
    test("① 单项 Remove Pin 与多选 Remove Pins 都走 removePinsKeepOpen；多选不再关标签", () => {
        expect(pin).toContain('{ id: "removePin", label: "pinned.removePin", run: t => removePinsKeepOpen([t.itemId!]) }');
        const ms = r("src/plugins/tabs/multiSelect/index.ts");
        const rp = ms.slice(ms.indexOf("async removePins()"), ms.indexOf("async archive()"));
        expect(rp).toContain('await removePinsKeepOpen(pins.map(p => p.id), tr("pinned.removePins"));');
        expect(rp).not.toContain("chrome.tabs.remove");
    });
    test("② Pin Tab：注册到 tab（Today）菜单，只对未固定的标签显示；= handleDrop(tab:<id>, {})（与拖进固定区同一入口），先记撤销", () => {
        expect(pin).toContain('tab: [{ id: "pin", label: "pinned.pinTab", command: "pin.toggle", visible: t => t.tabId != null && !pinnedOwner(t.tabId), run: t => pinFromToday(t.tabId) }]');
        const f = fn("pinFromToday");
        expect(f).toContain("pinnedOwner(tabId)");
        expect(f.indexOf('recordStoreUndo(tr("pinned.pinTab"), pinnedStore)')).toBeGreaterThan(0);
        expect(f.indexOf("recordStoreUndo(")).toBeLessThan(f.indexOf("handleDrop("));
        expect(f).toContain("await handleDrop(`tab:${tabId}`, {});");
        // 拖进固定区（空白处）就是 handleDrop(data, {})
        expect(pin).toContain('box.addEventListener("drop", e => { const data = e.dataTransfer?.getData("text/arc-item"); if (data) { e.preventDefault(); void handleDrop(data, {}); } });');
    });
    test("② 文案与版式：en Pin Tab / zh 固定标签；MENU_LAYOUT.tab pin [6, 59] 紧挨 Archive Tab [6, 60]", () => {
        expect(r("src/i18n/en.ts")).toContain('"pinned.pinTab": "Pin Tab"');
        expect(r("src/i18n/zh.ts")).toContain('"pinned.pinTab": "固定标签"');
        expect(r("src/api/ContextMenus.ts")).toMatch(/tab: \{[^}]*pin: \[6, 59\], close: \[6, 60\]/);
    });
    test("撤销：store 撤销按快照整体写回 pinnedStore（固定项连同 tabId 回来 → 标签重新被固定区认领）", () => {
        const u = r("src/plugins/tabs/undo/index.ts");
        expect(u).toContain('addUndoKind("store", async data => { const { key, value } = data as { key: string; value: unknown }; await chrome.storage.local.set({ [key]: value }); })');
    });
});

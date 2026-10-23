import { describe, expect, test } from "bun:test";

import type { UndoEntry } from "../src/api/Undo";
import { encodeMulti, expandDragData } from "../src/api/DragData";
import { applyClick, splitKeys } from "../src/plugins/tabs/multiSelect/logic";
import { type ClosedTab, MERGE_MS, popEntry, pushEntry, restoreOrder } from "../src/plugins/tabs/undo/logic";

const tab = (oldId: number, index: number): ClosedTab => ({ oldId, url: `https://e.com/${oldId}`, title: "", index });
const entry = (kind: string, at: number, data: unknown = null): UndoEntry => ({ id: String(at), kind, label: kind, at, data });

describe("Undo 逻辑", () => {
    test("短时间内连续关闭的标签合并为一条", () => {
        let s: UndoEntry[] = [];
        s = pushEntry(s, entry("tabsClosed", 1000, [tab(1, 0)]), 50);
        s = pushEntry(s, entry("tabsClosed", 1000 + MERGE_MS - 1, [tab(2, 1)]), 50);
        expect(s.length).toBe(1);
        expect((s[0].data as ClosedTab[]).map(t => t.oldId)).toEqual([1, 2]);
        setLang("zh");
        expect(pushEntry([], entry("tabsClosed", 1, [tab(1, 0)]), 50).length).toBe(1);
        expect(s[0].label).toMatch(/^(关闭 2 个标签|Close 2 tabs)$/);
        s = pushEntry(s, entry("tabsClosed", 1000 + MERGE_MS * 3, [tab(3, 0)]), 50);
        expect(s.length).toBe(2);
    });
    test("其它种类不合并，超出上限丢最旧", () => {
        let s: UndoEntry[] = [];
        for (let i = 0; i < 5; i++) s = pushEntry(s, entry("store", i * 10_000), 3);
        expect(s.map(e => e.at)).toEqual([20_000, 30_000, 40_000]);
    });
    test("pop 取最新，可限定 kind", () => {
        const s = [entry("tabsClosed", 1, []), entry("store", 2), entry("store", 3)];
        expect(popEntry(s).entry?.at).toBe(3);
        const r = popEntry(s, "tabsClosed");
        expect(r.entry?.at).toBe(1);
        expect(r.rest.map(e => e.at)).toEqual([2, 3]);
        expect(popEntry([], "x").entry).toBeUndefined();
    });
    test("恢复顺序按原位置", () => {
        expect(restoreOrder([tab(1, 5), tab(2, 1), tab(3, 3)]).map(t => t.oldId)).toEqual([2, 3, 1]);
    });
});

describe("MultiSelect 逻辑", () => {
    const order = ["pin:a", "pin:b", "tab:1", "tab:2", "tab:3"];
    test("⌘/Ctrl 单击切换", () => {
        let r = applyClick(order, new Set(), null, "tab:1", "toggle");
        r = applyClick(order, r.sel, r.anchor, "pin:a", "toggle");
        expect([...r.sel].toSorted()).toEqual(["pin:a", "tab:1"]);
        r = applyClick(order, r.sel, r.anchor, "tab:1", "toggle");
        expect([...r.sel]).toEqual(["pin:a"]);
    });
    test("Shift 单击按可见顺序连续选择（双向）", () => {
        const r = applyClick(order, new Set(["pin:b"]), "pin:b", "tab:2", "range");
        expect([...r.sel]).toEqual(["pin:b", "tab:1", "tab:2"]);
        const back = applyClick(order, new Set(), "tab:3", "tab:1", "range");
        expect([...back.sel]).toEqual(["tab:1", "tab:2", "tab:3"]);
    });
    test("拆分选择键并保持可见顺序", () => {
        const r = splitKeys(order, new Set(["tab:3", "pin:a", "tab:1"]));
        expect(r.keys).toEqual(["pin:a", "tab:1", "tab:3"]);
        expect(r.tabIds).toEqual([1, 3]);
        expect(r.pinIds).toEqual(["a"]);
    });
    test("多选拖放数据编解码", () => {
        expect(expandDragData(encodeMulti(["tab:1", "pin:x"]))).toEqual(["tab:1", "pin:x"]);
        expect(expandDragData("tab:9")).toEqual(["tab:9"]);
    });
});

import { LOCALES, setLang, tr } from "../src/api/i18n";
describe("i18n", () => {
    test("zh / en 键完全一致，占位符一致，英文没有中文字符", () => {
        expect(Object.keys(LOCALES.zh).toSorted()).toEqual(Object.keys(LOCALES.en).toSorted());
        for (const k of Object.keys(LOCALES.en)) {
            expect((LOCALES.zh[k].match(/\{\d\}/g) ?? []).toSorted()).toEqual((LOCALES.en[k].match(/\{\d\}/g) ?? []).toSorted());
            expect(/[\u4e00-\u9fff]/.test(LOCALES.en[k])).toBe(false);
        }
    });
    test("tr：语言切换、参数替换、非键原样返回", () => {
        setLang("en"); expect(tr("multi.closeN", 3)).toBe("Close 3 tabs");
        setLang("zh"); expect(tr("multi.closeN", 3)).toBe("关闭 3 个标签");
        expect(tr("My Space")).toBe("My Space");
    });
});

import { tier } from "../src/plugins/data/backup/tier";
describe("Backup 分层保留（P2）", () => {
    test("最近 10 份 + 每天 / 每周 / 每月各 1 份", () => {
        const now = Date.UTC(2026, 9, 16); const H = 36e5;
        const list = Array.from({ length: 24 * 500 / 6 }, (_, i) => ({ at: now - i * 6 * H, data: {} }));
        const out = tier(list, now);
        expect(out.slice(0, 10).map(s => s.at)).toEqual(list.slice(0, 10).map(s => s.at));
        expect(out.length).toBeLessThan(10 + 10 + 9 + 14);
        expect(out.length).toBeGreaterThan(30);
        expect(new Set(out.map(s => s.at)).size).toBe(out.length);
    });
});

import { siteSearch } from "../src/plugins/command/commandBar/siteSearch";
import { quoteUrl } from "../src/plugins/tabs/tabActions/quote";
describe("P2 站点搜索 / 高亮链接", () => {
    test("关键词 + 空格", () => {
        expect(siteSearch("yt lo-fi beats")?.url).toBe("https://www.youtube.com/results?search_query=lo-fi%20beats");
        expect(siteSearch("github.com bun")?.name).toBe("GitHub");
        expect(siteSearch("hello world")).toBeNull();
        expect(siteSearch("yt")).toBeNull();
    });
    test("文本片段 URL", () => {
        expect(quoteUrl("https://a.com/x#old", " Hello   big-world ")).toBe("https://a.com/x#:~:text=Hello%20big%2Dworld");
    });
});

import { chunk, pickSyncable } from "../src/plugins/data/backup/sync";
describe("P2 同步", () => {
    test("去掉标签 id、只同步结构；分块", () => {
        const p = pickSyncable({ "data:spaces": { spaces: [{ id: "a" }], activeId: "a", tabSpace: { 1: "a" } }, "data:pinned": { bySpace: { a: [{ id: "n", tabId: 5, url: "u" }] } }, "data:favorites": { items: [{ id: "f", tabId: 9 }] } });
        expect(JSON.stringify(p)).not.toContain("tabId");
        expect(JSON.stringify(p)).not.toContain("tabSpace");
        expect(chunk("x".repeat(15000)).map(c => c.length)).toEqual([7000, 7000, 1000]);
    });
});

import { nextEvent, parseIcs, parseIcsDate } from "../src/plugins/library/liveCalendar/ics";
describe("P2 Live Calendar（iCal）", () => {
    const ics = ["BEGIN:VCALENDAR", "BEGIN:VEVENT", "DTSTART:20261016T020000Z", "DTEND:20261016T030000Z", "SUMMARY:Standup", "DESCRIPTION:Join: https://meet.google.com/abc-defg-hij\\n", "END:VEVENT",
        "BEGIN:VEVENT", "DTSTART;TZID=Asia/Shanghai:20261016T150000", "SUMMARY:Design\\, review", "LOCATION:https://us02web.zoom.us/j/123?pwd=x", "END:VEVENT", "END:VCALENDAR"].join("\r\n");
    test("解析事件与会议链接", () => {
        const ev = parseIcs(ics);
        expect(ev.length).toBe(2);
        expect(ev[0].title).toBe("Standup");
        expect(ev[0].join).toBe("https://meet.google.com/abc-defg-hij");
        expect(ev[1].title).toBe("Design, review");
        expect(ev[1].join).toContain("zoom.us/j/123");
        expect(parseIcsDate("20261016T020000Z")).toBe(Date.UTC(2026, 9, 16, 2));
        expect(nextEvent(ev, Date.UTC(2026, 9, 16, 2, 30))?.title).toBe("Standup");
    });
});

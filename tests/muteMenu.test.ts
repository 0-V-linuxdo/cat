import { describe, expect, test } from "bun:test";
import { muteItemOf, muteMenuState, muteTabs, newMutedFor, type MuteItem } from "../src/plugins/library/media/muteMenu";
import { STRINGS } from "../src/plugins/library/media/i18n";

/* urlbar-menus-followup.md L467–572「Mute 细节」 */
const I = (open: boolean, muted: boolean, audible: boolean): MuteItem => ({ open, muted, audible });
const CLOSED = I(false, false, false), IDLE = I(true, false, false), PLAY = I(true, false, true), MUTED = I(true, true, false);

describe("muteMenuState（验证器 FUN_102eb7de8）", () => {
    test("全部已静音 → Unmute，可点", () => {
        expect(muteMenuState([MUTED])).toEqual({ unmute: true, disabled: false });
        expect(muteMenuState([MUTED, MUTED])).toEqual({ unmute: true, disabled: false });
    });
    test("含未打开项不算全部已静音（未打开按未静音计）→ Mute", () => {
        expect(muteMenuState([MUTED, CLOSED]).unmute).toBe(false);
    });
    test("未打开 → 置灰；已打开但没在发声 → 置灰；至少一个在发声 → 可点", () => {
        expect(muteMenuState([CLOSED])).toEqual({ unmute: false, disabled: true });
        expect(muteMenuState([IDLE])).toEqual({ unmute: false, disabled: true });
        expect(muteMenuState([PLAY])).toEqual({ unmute: false, disabled: false });
        expect(muteMenuState([CLOSED, IDLE, PLAY])).toEqual({ unmute: false, disabled: false });
    });
    test("空选中集：allSatisfy 为真 → Unmute（理论情况）", () => expect(muteMenuState([]).unmute).toBe(true));
});

describe("newMutedFor（FUN_1028c44b4）", () => {
    test("任一已打开且未静音 → 静音；全部已静音或全部未打开 → 取消静音", () => {
        expect(newMutedFor([PLAY])).toBe(true);
        expect(newMutedFor([MUTED, IDLE])).toBe(true);
        expect(newMutedFor([MUTED, MUTED])).toBe(false);
        expect(newMutedFor([CLOSED, CLOSED])).toBe(false);
        expect(newMutedFor([MUTED, CLOSED])).toBe(false);
    });
});

describe("muteItemOf / muteTabs", () => {
    test("muteItemOf：undefined = 未打开", () => {
        expect(muteItemOf(undefined)).toEqual(CLOSED);
        expect(muteItemOf({ audible: true, mutedInfo: { muted: true } as chrome.tabs.MutedInfo })).toEqual(I(true, true, true));
    });
    test("muteTabs：多选统一设成同一状态，未打开 / 已关闭的不动", async () => {
        const tabs: Record<number, { id: number; mutedInfo: { muted: boolean } }> = { 1: { id: 1, mutedInfo: { muted: true } }, 2: { id: 2, mutedInfo: { muted: false } } };
        const calls: [number, boolean][] = [];
        (globalThis as any).chrome = { tabs: { get: async (id: number) => { if (!tabs[id]) throw new Error("No tab with id"); return tabs[id]; }, update: async (id: number, p: { muted: boolean }) => { calls.push([id, p.muted]); } }, runtime: {} };
        await muteTabs([1, 2, 99, undefined]);
        expect(calls.toSorted()).toEqual([[1, true], [2, true]]); // 1 已静音、2 未静音 → 统一静音（不是逐个翻转）
        calls.length = 0; tabs[2].mutedInfo.muted = true;
        await muteTabs([1, 2, undefined]);
        expect(calls.toSorted()).toEqual([[1, false], [2, false]]); // 全部已静音 → 统一取消静音
        calls.length = 0;
        await muteTabs([99, undefined]);
        expect(calls).toEqual([]);
    });
});

test("i18n：Unmute / 取消静音", () => {
    expect(STRINGS.en["media.unmute"]).toBe("Unmute"); expect(STRINGS.zh["media.unmute"]).toBe("取消静音");
});

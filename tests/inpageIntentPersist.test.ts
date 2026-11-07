/* 补丁 rel62-intent-persist（rel62 ④）：全局最近意图 lastOpen（storage.local）新窗口继承；开原生收起页内时不删落盘意图，记 suppressedByWin，重载 / 重启后恢复。
 * A) 纯逻辑（logic.ts nextLastOpen / inheritIntent + decideToggle 串起来）；C) 源码 / 常量约束。
 * 控制器级（chrome mock）：tests/inpageColdStateRestore.test.ts（冷启动继承 / 重载恢复 / 回收不恢复 / 原生还开着）、tests/inpageRestoreOnClosePersist.test.ts（预热 → 重载 / 重启 全链）。
 * 真机 headed：/workspace/rel62-logs/repro/r62.ts SC=4 NATIVE_BEFORE=1 RESTRICTED_BEFORE=1。 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { SUPPRESS_RESTORE } from "../src/plugins/inpageSidebar/constants";
import { decideToggle, inheritIntent, nextLastOpen } from "../src/plugins/inpageSidebar/logic";

const DIR = resolve(import.meta.dir, "../src/plugins/inpageSidebar");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("A) 纯逻辑", () => {
    test("inheritIntent：没有记录 + inpage → true（全新安装 / 新窗口 / 重启后 id 变了）；有记录照记录；默认方式 native → 一律 false", () => {
        expect(inheritIntent(undefined, "inpage")).toBe(true);
        expect(inheritIntent(true, "inpage")).toBe(true);
        expect(inheritIntent(false, "inpage")).toBe(false);
        for (const v of [undefined, true, false]) expect(inheritIntent(v, "native")).toBe(false);
    });
    test("nextLastOpen：只有用户在页内的展开 / 收起改全局最近意图；关原生 / 回落原生 / native 模式不改", () => {
        expect(nextLastOpen({ why: "show-inpage", native: "keep", intent: true })).toBe(true);
        expect(nextLastOpen({ why: "hide-visible", native: "keep", intent: false })).toBe(false);
        expect(nextLastOpen({ why: "hide-visible", native: "close", intent: false })).toBeUndefined(); // ⌃S 关的是原生
        expect(nextLastOpen({ why: "hide-visible", native: "close", intent: true })).toBe(true); // 关原生后页内常驻（pinned）
        expect(nextLastOpen({ why: "fallback-native", native: "open", intent: false })).toBeUndefined();
        expect(nextLastOpen({ why: "native-mode", native: "open", intent: false })).toBeUndefined();
    });
    test("和 decideToggle 串起来：新窗口（继承 true → 已可见）第一次 ⌃S = 收起，lastOpen → false；再开一个新窗口继承 false → ⌃S = 展开，lastOpen → true", () => {
        const base = { defaultMode: "inpage" as const, kind: "ok" as const, hostAlive: true, frameBlocked: false, nativeOpen: false };
        let last: boolean | undefined;
        const d1 = decideToggle({ ...base, intent: inheritIntent(last, "inpage") } as never); expect(d1.why).toBe("hide-visible"); last = nextLastOpen(d1) ?? last; expect(last).toBe(false);
        const d2 = decideToggle({ ...base, intent: inheritIntent(last, "inpage") } as never); expect(d2.why).toBe("show-inpage"); last = nextLastOpen(d2) ?? last; expect(last).toBe(true);
    });
});

describe("C) 源码 / 常量约束", () => {
    const bg = strip(readFileSync(resolve(DIR, "background.ts"), "utf8"));
    test("常量：graceMs / 存活键只在 constants.ts", () => {
        expect(SUPPRESS_RESTORE).toEqual({ graceMs: 500, sessionKey: "inpageSidebarAlive" });
        expect(bg).not.toContain('"inpageSidebarAlive"'); expect(bg).toMatch(/SUPPRESS_RESTORE\.graceMs/); expect(bg).toMatch(/SUPPRESS_RESTORE\.sessionKey/);
    });
    test("开原生收起页内：带 suppress（hadIntent 且 restoreInpageOnClose）——内存 false、落盘 true + suppressedByWin；不再删落盘意图", () => {
        expect(bg).toMatch(/setIntent\(w, false, \{ suppress: hadIntent && PREWARM\.restoreInpageOnClose \}\);/);
        expect(bg).toMatch(/if \(sup\) \{ d\.openByWin\[w\] = true; \(d\.suppressedByWin \?\?= \{\}\)\[w\] = true; return; \}/);
        expect(bg).not.toMatch(/delete d\.openByWin\[w\]; \}\);\n\s*\};\n/); // 旧的 setIntent(false) = 删键
    });
    test("未知窗口继承：intentOf 走 inheritIntent(lastOpen, defaultMode)；toggleFor 落 nextLastOpen；窗口关闭 forgetWin（意图 + suppressed 一起删）", () => {
        expect(bg).toMatch(/const intentOf = \(w: number\) => knownWin\(w\) \? !!mem\.openByWin\[w\] : inheritIntent\(lastOpen,/);
        expect(bg).toMatch(/setLastOpen\(nextLastOpen\(d\)\);/);
        expect(bg).toMatch(/forgetWin\(/);
    });
    test("启动：区分重载 / SW 回收靠 storage.session 存活键；回收 → 交给 restoreOnClose（没有标记 = dropSuppressed，不恢复）；sweep 作废时 dropSuppressed", () => {
        expect(bg).toMatch(/if \(!fresh\) \{ dropSuppressed\(w\); continue; \}/);
        expect(bg).toMatch(/if \(restoreOnClose\.restored\.has\(w\) \|\| restoreOnClose\.has\(w\)\) \{ bootSuppressed\.delete\(w\); continue; \}/);
        expect(bg).toMatch(/restoreOnClose\.delete\(w\); dropSuppressed\(w\);/);
        expect(bg).toMatch(/if \(bootFresh && bootSuppressed\.has\(w\) && restoreOnClose\.loaded/);
    });
});

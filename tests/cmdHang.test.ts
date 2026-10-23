/* 52005：tab.copyUrl / tab.duplicate 不返回、重启快照为空 的回归 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";

const never = () => new Promise<never>(() => { });
const g = globalThis as any;

describe("Clipboard 超时退回注入", () => {
    test("离屏 sendMessage 永不回复时 2s 内退回 executeScript", async () => {
        let injected = 0;
        g.chrome = {
            offscreen: { Reason: { CLIPBOARD: "C", MATCH_MEDIA: "M" }, createDocument: async () => { } },
            runtime: { getURL: (p: string) => p, getContexts: async () => [{}], ContextType: { OFFSCREEN_DOCUMENT: "O" }, sendMessage: never },
            storage: { local: { get: async () => ({}), set: async () => { } } },
            scripting: { executeScript: async () => { injected++; return [{ result: true }]; } },
        };
        const { copyText } = await import("../src/api/Clipboard");
        const t0 = Date.now();
        expect(await copyText("x", 1)).toBe(true);
        expect(injected).toBe(1);
        expect(Date.now() - t0).toBeLessThan(2500);
    });
    test("全部永不回复时也会返回 false", async () => {
        g.chrome.scripting.executeScript = never;
        const { copyText } = await import("../src/api/Clipboard");
        expect(await copyText("x", 1)).toBe(false);
    }, 6000);
    test("withTimeout：被拒绝的 Promise 不抛出", async () => {
        const { withTimeout } = await import("../src/api/Clipboard");
        expect(await withTimeout(Promise.reject(new Error("boom")), 50, "t", "fb")).toBe("fb");
    });
});

describe("源码守护", () => {
    const ta = readFileSync("src/plugins/tabs/tabActions/index.ts", "utf8");
    const sm = readFileSync("src/plugins/spaces/spaceManager/index.ts", "utf8");
    const rs = readFileSync("src/plugins/spaces/spaceManager/restore.ts", "utf8");
    test("tab.duplicate 不等待 chrome.tabs.duplicate", () => {
        expect(ta).not.toMatch(/await chrome\.tabs\.duplicate/);
        expect(ta).toMatch(/void safe\(chrome\.tabs\.duplicate/);
    });
    test("快照：force、onStartup finally 启用、tabs.onCreated 解冻", () => {
        expect(rs).toMatch(/scheduleSnapshot\(force = false\)/);
        expect(sm).toMatch(/finally\(\(\) => enableSnapshots\(\)\)/);
        expect(sm).toMatch(/tabs\.onCreated", \(\) => void safe\(maybeUnfreeze\(\)/);
        expect(sm).toMatch(/scheduleSnapshot\(true\)/);
    });
});

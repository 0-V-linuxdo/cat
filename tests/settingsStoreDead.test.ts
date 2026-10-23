import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { SettingsStore } from "../src/utils/SettingsStore";

let sets = 0;
let setImpl: () => Promise<void> = async () => { };
let errors: unknown[][] = [];
const origError = console.error;
const g = globalThis as any;
const origChrome = g.chrome;

function makeChrome(id: string | undefined) {
    g.chrome = { runtime: { id }, storage: { local: { set: () => { sets++; return setImpl(); } } } };
}
function store() { const s = new SettingsStore<any>({ plugins: { A: { n: 1 } } }); s.markReady(); return s; }

beforeEach(() => { sets = 0; errors = []; setImpl = async () => { }; console.error = (...a: unknown[]) => { errors.push(a); }; });
afterEach(() => { console.error = origError; g.chrome = origChrome; });

describe("SettingsStore：扩展上下文失效时停止写盘", () => {
    test("chrome.runtime.id 缺失 → 不调用存储、不记日志，之后的保存也跳过", async () => {
        makeChrome(undefined);
        const s = store();
        await s.flush();
        s.store.plugins.A.n = 2; await new Promise(r => setTimeout(r, 80));
        await s.flush();
        expect(sets).toBe(0);
        expect(errors.length).toBe(0);
        expect(s.isDead).toBe(true);
    });

    test("写入报 “Extension context invalidated” → 不记日志，之后的 save / flush 都跳过", async () => {
        makeChrome("ext");
        setImpl = () => Promise.reject(new Error("Extension context invalidated."));
        const s = store();
        await s.flush();
        expect(sets).toBe(1);
        expect(errors.length).toBe(0);
        expect(s.isDead).toBe(true);
        s.store.plugins.A.n = 3; await new Promise(r => setTimeout(r, 80));
        await s.flush();
        expect(sets).toBe(1);
        expect(errors.length).toBe(0);
    });

    test("其他错误照常记日志，且不停止后续写盘", async () => {
        makeChrome("ext");
        setImpl = () => Promise.reject(new Error("QUOTA_BYTES quota exceeded"));
        const s = store();
        await s.flush();
        expect(errors.length).toBe(1);
        expect(String(errors[0].at(-1))).toContain("QUOTA_BYTES");
        expect(s.isDead).toBe(false);
        setImpl = async () => { };
        await s.flush();
        expect(sets).toBe(2);
    });
});

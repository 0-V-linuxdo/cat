/* rel61 补丁 downloadrename-own-filename：@utils/ownDownload 意图表的单测。
 * 覆盖：匹配（url / finalUrl、blob、长 data:、同长同首尾的不同 data:）、用完即删、同一 url 并发（先进先出、并发取不重复）、
 * 超时（60 s）清理、下载失败 / 中断 / 已定名 / 已结束 清理、服务进程启动清理、闹钟、DownloadRename 关闭时 download() 参数不变、
 * 4 个调用点都走 downloadOwn。变异检查见补丁 README（去掉新逻辑后这些用例必须失败）。 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const C = globalThis as any;
const saved = C.chrome;
const sess: Record<string, unknown> = {};
const alarms: { name: string; info: any }[] = [];
type L = (d: any) => void;
const dl = {
    calls: [] as any[], onChanged: new Set<L>(), searchResult: [] as any[], fail: false as false | string, nextId: 100,
};
beforeAll(() => {
    C.chrome = {
        ...saved,
        storage: {
            ...saved?.storage,
            session: {
                get: async (k?: any) => (k == null ? structuredClone(sess) : Object.fromEntries([k].flat().filter((x: string) => x in sess).map((x: string) => [x, structuredClone(sess[x])]))),
                set: async (o: any) => { Object.assign(sess, structuredClone(o)); },
                remove: async (k: any) => { for (const x of [k].flat()) delete sess[x]; },
            },
        },
        alarms: { create: async (name: string, info: any) => { alarms.push({ name, info }); } },
        downloads: {
            download: async (o: any) => { dl.calls.push(o); if (dl.fail) throw new Error(dl.fail); return dl.nextId++; },
            search: async () => dl.searchResult,
            onChanged: { addListener: (l: L) => dl.onChanged.add(l), removeListener: (l: L) => dl.onChanged.delete(l) },
        },
    };
});
afterAll(() => { C.chrome = saved; });
beforeEach(() => { for (const k of Object.keys(sess)) delete sess[k]; alarms.length = 0; dl.calls = []; dl.onChanged.clear(); dl.searchResult = [{ id: 0, filename: "", state: "in_progress" }]; dl.fail = false; });

const M = await import("../src/utils/ownDownload");
const own = () => Object.keys(sess).filter(k => k.startsWith(M.OWN_DL_PREFIX));
const tick = () => new Promise(r => setTimeout(r, 5));
const EXT = "geeallpjapgkkjnmmfkgnilggobekckd";
const BLOB = `blob:chrome-extension://${EXT}/9970e303-9e0a-4e01-a162-534fa56f61bd`;
const png = (mid: string) => `data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA${mid}AAAAAElFTkSuQmCC`;

describe("键：SHA-256(url)", () => {
    test("同一 url 同一键；长度、头、尾都相同的两段不同 data: 键不同（前缀 / 首尾 + 长度方案会撞）", async () => {
        const a = png("A".repeat(5000) + "x" + "A".repeat(5000)), b = png("A".repeat(5000) + "y" + "A".repeat(5000));
        expect(a.length).toBe(b.length); expect(a.slice(0, 200)).toBe(b.slice(0, 200)); expect(a.slice(-200)).toBe(b.slice(-200));
        expect(await M.ownDlHash(a)).toBe(await M.ownDlHash(a));
        expect(await M.ownDlHash(a)).not.toBe(await M.ownDlHash(b));
    });
    test("几 MB 的 data: 键长固定（不把 url 本身存进 storage.session）", async () => {
        const big = png("B".repeat(3_000_000));
        await M.registerOwnIntent(big, "Capture big.png");
        const [k] = own();
        expect(k!.length).toBeLessThan(100);
        expect(JSON.stringify(sess).length).toBeLessThan(1000);
    });
});

describe("匹配与用完即删", () => {
    test("data: 按 url 命中，取出即删；第二次取不到", async () => {
        const u = png("C1");
        await M.registerOwnIntent(u, "Captures/lib 1.png", "uniquify");
        expect(own().length).toBe(1);
        expect(await M.takeOwnIntent([u, u])).toMatchObject({ filename: "Captures/lib 1.png", conflictAction: "uniquify" });
        expect(own()).toEqual([]);
        expect(await M.takeOwnIntent([u])).toBeNull();
    });
    test("blob：只有 finalUrl 对得上也命中；别的 url 不命中、不被删", async () => {
        await M.registerOwnIntent(BLOB, "session-localhost-x.session");
        expect(await M.takeOwnIntent(["https://example.com/a", undefined])).toBeNull();
        expect(own().length).toBe(1);
        expect((await M.takeOwnIntent(["https://example.com/redirect", BLOB]))?.filename).toBe("session-localhost-x.session");
        expect(own()).toEqual([]);
    });
    test("同一 url 并发两次下载：先登记先取（先进先出）；并发取两次各拿一条、不重复", async () => {
        const u = png("SAME");
        await M.registerOwnIntent(u, "Capture A.png");
        await M.registerOwnIntent(u, "Captures/Capture A.png");
        expect(own().length).toBe(2);
        const [x, y] = await Promise.all([M.takeOwnIntent([u]), M.takeOwnIntent([u])]);
        expect([x?.filename, y?.filename]).toEqual(["Capture A.png", "Captures/Capture A.png"]);
        expect(own()).toEqual([]);
    });
    test("没有登记时走快路径（不算哈希）", async () => {
        const orig = crypto.subtle.digest; let n = 0;
        (crypto.subtle as any).digest = (...a: any[]) => { n++; return (orig as any).apply(crypto.subtle, a); };
        try { expect(await M.takeOwnIntent([png("Z")])).toBeNull(); } finally { (crypto.subtle as any).digest = orig; }
        expect(n).toBe(0);
    });
});

describe("超时清理（60 s）", () => {
    test("TTL 是 60 s", () => { expect(M.OWN_DL_TTL_MS).toBe(60_000); });
    test("超过 60 s 的条目不再匹配，并在取用时删掉", async () => {
        const u = png("OLD"); const h = await M.ownDlHash(u);
        sess[`${M.OWN_DL_PREFIX}${h}:old`] = { h, filename: "stale.png", conflictAction: "uniquify", at: Date.now() - 61_000, seq: 0 };
        expect(await M.takeOwnIntent([u])).toBeNull();
        expect(own()).toEqual([]);
    });
    test("gcOwnIntents：删过期 / 损坏 / 时间在未来的条目，留下未过期的，并为剩下的重排闹钟；别的 session 键不动", async () => {
        const now = Date.now();
        sess["catIconDark"] = true;
        sess[`${M.OWN_DL_PREFIX}a:1`] = { h: "a", filename: "x", conflictAction: "uniquify", at: now - 60_001, seq: 0 };
        sess[`${M.OWN_DL_PREFIX}b:1`] = { garbage: 1 };
        sess[`${M.OWN_DL_PREFIX}c:1`] = { h: "c", filename: "y", conflictAction: "uniquify", at: now + 3_600_000, seq: 0 };
        sess[`${M.OWN_DL_PREFIX}d:1`] = { h: "d", filename: "z", conflictAction: "uniquify", at: now - 1_000, seq: 0 };
        expect(await M.gcOwnIntents(now)).toBe(3);
        expect(own()).toEqual([`${M.OWN_DL_PREFIX}d:1`]);
        expect(sess["catIconDark"]).toBe(true);
        expect(alarms.at(-1)?.name).toBe(M.OWN_DL_GC_ALARM);
        alarms.length = 0;
        expect(await M.gcOwnIntents(now + 61_000)).toBe(1);
        expect(own()).toEqual([]); expect(alarms).toEqual([]); // 空了不再排闹钟
    });
    test("登记时排一次性 GC 闹钟（TTL 之后）", async () => {
        await M.registerOwnIntent(png("AL"), "a.png");
        expect(alarms[0]).toEqual({ name: M.OWN_DL_GC_ALARM, info: { delayInMinutes: (M.OWN_DL_TTL_MS + 5_000) / 60_000 } });
    });
    test("服务进程重启：background.ts 顶层监听 GC 闹钟并启动即清理；DownloadRename 启动时也清理", () => {
        const bg = readFileSync(resolve(import.meta.dir, "../src/entries/background.ts"), "utf8");
        expect(bg).toMatch(/chrome\.alarms\.onAlarm\.addListener\(a => \{ if \(a\.name === OWN_DL_GC_ALARM\) void gcOwnIntents\(\)/);
        expect(bg).toMatch(/^void gcOwnIntents\(\)/m);
        const dr = readFileSync(resolve(import.meta.dir, "../src/plugins/downloadRename/index.ts"), "utf8");
        const start = dr.slice(dr.indexOf("background: {"));
        expect(start.indexOf("gcOwnIntents()")).toBeGreaterThan(0);
        expect(start.indexOf("gcOwnIntents()")).toBeLessThan(start.indexOf("onDeterminingFilename.addListener"));
    });
});

describe("downloadOwn：参数不变 + 失败 / 中断 / 定名后清理", () => {
    test("DownloadRename 关闭（没有监听器取用）：download() 收到的 url / filename / saveAs / conflictAction 与原调用一致", async () => {
        const id = await M.downloadOwn({ url: png("P"), filename: "Captures/a.png", saveAs: false, conflictAction: "uniquify" });
        expect(id).toBe(100);
        expect(dl.calls).toEqual([{ url: png("P"), filename: "Captures/a.png", saveAs: false, conflictAction: "uniquify" }]);
        await M.downloadOwn({ url: BLOB, filename: "s.session", saveAs: true });
        expect(dl.calls[1]).toEqual({ url: BLOB, filename: "s.session", saveAs: true, conflictAction: "uniquify" });
    });
    test("没有监听器取用时：filename 已定（onChanged.filename）→ 条目删掉、监听摘掉", async () => {
        const id = await M.downloadOwn({ url: png("F"), filename: "a.png" });
        await tick();
        expect(own().length).toBe(1); expect(dl.onChanged.size).toBe(1);
        for (const l of Array.from(dl.onChanged)) l({ id: id + 1, filename: { current: "/d/other.png" } }); // 别的下载：不动
        expect(own().length).toBe(1);
        for (const l of Array.from(dl.onChanged)) l({ id, filename: { current: "/d/a.png" } });
        await tick();
        expect(own()).toEqual([]); expect(dl.onChanged.size).toBe(0);
    });
    test("下载中断（interrupted）→ 条目删掉", async () => {
        const id = await M.downloadOwn({ url: png("I"), filename: "a.png" });
        await tick();
        for (const l of Array.from(dl.onChanged)) l({ id, state: { current: "interrupted" }, error: { current: "FILE_FAILED" } });
        await tick();
        expect(own()).toEqual([]);
    });
    test("download() 抛错（发起失败）→ 条目立刻删掉，错误照常抛出", async () => {
        dl.fail = "Invalid filename";
        await expect(M.downloadOwn({ url: png("E"), filename: "../bad.png" })).rejects.toThrow("Invalid filename");
        expect(own()).toEqual([]);
    });
    test("download() 返回前已经定名 / 结束（事件已错过）→ 查一次现状就删", async () => {
        dl.searchResult = [{ id: 100, filename: "/d/a.png", state: "complete" }];
        await M.downloadOwn({ url: png("S"), filename: "a.png" });
        await tick();
        expect(own()).toEqual([]); expect(dl.onChanged.size).toBe(0);
    });
    test("一直没有事件：等到 TTL 也删", async () => {
        const rel = { n: 0 };
        await M.registerOwnIntent(png("T"), "a.png");
        M.releaseWhenSettled(5, async () => { rel.n++; }, 20);
        await new Promise(r => setTimeout(r, 60));
        expect(rel.n).toBe(1); expect(dl.onChanged.size).toBe(0);
    });
    test("监听器先取走、之后定名：release 只是空删，不报错、不留监听", async () => {
        const u = png("R");
        const id = await M.downloadOwn({ url: u, filename: "a.png" });
        expect((await M.takeOwnIntent([u]))?.filename).toBe("a.png");
        for (const l of Array.from(dl.onChanged)) l({ id, filename: { current: "/d/a.png" } });
        await tick();
        expect(own()).toEqual([]); expect(dl.onChanged.size).toBe(0);
    });
});

describe("调用点（4 处）都走 downloadOwn / registerOwnIntent，不再直接 chrome.downloads.download", () => {
    const src = (p: string) => readFileSync(resolve(import.meta.dir, "../src", p), "utf8");
    test("Capture：capture.download 与 saveToLibrary 的 Captures/ 回退", () => {
        const s = src("plugins/capture/index.ts");
        expect(/chrome\.downloads\.download\(\{ url/.test(s)).toBe(false); // 注释里提到 downloads.download({ filename }) 不算
        expect(s).toContain("downloadOwn({ url, filename, saveAs: !!saveAs, conflictAction: \"uniquify\" })");
        expect(s).toContain("downloadOwn({ url, filename: `${LIB_DIR}/${filename}`, saveAs: false, conflictAction: \"uniquify\" })");
    });
    test("siteControls 截图", () => {
        const s = src("plugins/views/siteControls/index.ts");
        expect(/chrome\.downloads\.download\(\{ url/.test(s)).toBe(false); // 注释里提到 downloads.download({ filename }) 不算
        expect(s).toContain("downloadOwn({ url: dataUrl, filename: `Screenshot ${host} ${stamp}.png`, saveAs: false })");
    });
    test("会话导出：saveAs 开（downloadOwn）与关（<a download> 前 registerOwnIntent）", () => {
        const s = src("plugins/sessionTransfer/ui.ts");
        expect(/chrome\.downloads\.download\(\{ url/.test(s)).toBe(false); // 注释里提到 downloads.download({ filename }) 不算
        expect(s).toContain("downloadOwn({ url, filename: name, saveAs: true, conflictAction: \"uniquify\" })");
        expect(s).toContain("registerOwnIntent(url, name, \"uniquify\")");
    });
    test("全仓只有 ownDownload.ts 调用 chrome.downloads.download（代码，不含注释）", () => {
        const { execSync } = require("node:child_process") as typeof import("node:child_process");
        const out = execSync("grep -rlnE 'downloads\\.download\\(\\{ *url|downloads\\.download\\([a-z]' src || true", { cwd: resolve(import.meta.dir, ".."), encoding: "utf8" }).trim().split("\n").filter(Boolean);
        expect(out).toEqual(["src/utils/ownDownload.ts"]);
    });
});

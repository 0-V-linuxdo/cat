/* 本扩展自己发起的下载与 DownloadRename（rel60 引入，rel61 补丁 downloadrename-own-filename 更正语义）。
 * 更正：rel60 版本这里假设"扩展 downloads.download({ filename }) 指定的名字是创建者建议，监听器 return false / 不 suggest 就保留"，
 * 并用 chromeMerge() 照此建模——Chrome 156 有头实测（H10c、isOwnDownload-probe.json）不成立：只要有 onDeterminingFilename 监听器，
 * 扩展指定的 filename（连同 "Captures/" 子目录）就丢了，return false / 无参 suggest() 都落到浏览器生成名（data: → "download.png"，
 * blob → uuid）；byExtensionId 在 156 上是空串。
 * rel61：发起方先用 @utils/ownDownload 把意图登记到 storage.session，监听器取出后 suggest({ filename, conflictAction })。
 * chrome156() 按实测语义建模：有监听器时，结果 = suggest 给的 filename，否则浏览器生成名。
 * 覆盖：Capture 的 data: 下载与捕获库 Captures/ 子目录；sessionTransfer「询问保存位置」路径；规则模式 / 模型模式；别的扩展 / 页面下载照常改名。
 * 意图表本身（匹配、用完即删、超时、并发、清理）见 ownDownloadIntent.test.ts。 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isOwnBlobDownload, isOwnDownload } from "../src/plugins/downloadRename/skip";
import { OWN_DL_PREFIX, registerOwnIntent } from "../src/utils/ownDownload";

const EXT = "nnoppgdokgnadlkmgklomfpipobknoph";
const OTHER = "aaaabbbbccccddddeeeeffffgggghhhh";
const CAPTURE = "Capture 2026-10-29 at 17.10.00.png";
const DATA = "data:image/png;base64,iVBORw0KGgo=";
const BLOB = `blob:chrome-extension://${EXT}/6f1c2e9a-3b7d-4c55-9a0e-1d2f3a4b5c6d`;
const SESSION = "session-example.com-2026-10-29T09-10-00-000Z.session";
// Chromium：data: 无 Content-Disposition → 生成名 "download" + mime 扩展名；blob → uuid。创建者 filename 都不在 item.filename 里
const capItem = (id: number, extra: object = {}) => ({ id, url: DATA, finalUrl: DATA, referrer: "", filename: "/home/u/Downloads/download.png", byExtensionId: EXT, byExtensionName: "Cat", mime: "image/png", ...extra });
const sessItem = (id: number, extra: object = {}) => ({ id, url: BLOB, finalUrl: BLOB, referrer: "", filename: "/home/u/Downloads/6f1c2e9a-3b7d-4c55-9a0e-1d2f3a4b5c6d", byExtensionId: EXT, byExtensionName: "Cat", mime: "application/octet-stream", ...extra });

/** Chrome 156 实测语义：存在监听器时，下载发起方给的 filename 不参与；suggest({filename}) 给了就用，否则用浏览器生成名 */
function chrome156(browserName: string, s: { filename?: string } | undefined): string {
    return s?.filename || browserName;
}

describe("isOwnDownload（纯函数）", () => {
    test("byExtensionId = 本扩展 → true（data: / https / blob 都算）", () => {
        expect(isOwnDownload({ url: DATA, byExtensionId: EXT }, EXT)).toBe(true);
        expect(isOwnDownload({ url: "https://x.test/a.png", byExtensionId: EXT }, EXT)).toBe(true);
        expect(isOwnDownload({ url: BLOB, byExtensionId: EXT }, EXT)).toBe(true);
    });
    test("没有 byExtensionId 时退回 blob 前缀判断（H10c）", () => {
        expect(isOwnDownload({ url: BLOB }, EXT)).toBe(true);
        expect(isOwnDownload({ url: "https://x.test/", finalUrl: BLOB }, EXT)).toBe(true);
        expect(isOwnDownload({ url: BLOB }, EXT)).toBe(isOwnBlobDownload({ url: BLOB }, EXT));
    });
    test("别的扩展 / 页面 / 没有 extId → false", () => {
        expect(isOwnDownload({ url: DATA, byExtensionId: OTHER }, EXT)).toBe(false);
        expect(isOwnDownload({ url: `blob:chrome-extension://${OTHER}/x`, byExtensionId: OTHER }, EXT)).toBe(false);
        expect(isOwnDownload({ url: "https://x.test/a.png" }, EXT)).toBe(false);
        expect(isOwnDownload({ url: DATA, byExtensionId: EXT }, undefined)).toBe(false);
        expect(isOwnDownload({ url: DATA, byExtensionId: undefined }, undefined)).toBe(false); // undefined === undefined 不能算自己
    });
});

/* ---------- 监听器（mock chrome） ---------- */
/* storage.session mock：get(null) 返回全部，remove 支持单键 / 数组 */
const sess: Record<string, unknown> = {};
const sessArea = {
    get: async (k?: any) => (k == null ? structuredClone(sess) : Object.fromEntries([k].flat().filter((x: string) => x in sess).map((x: string) => [x, structuredClone(sess[x])]))),
    set: async (o: any) => { Object.assign(sess, structuredClone(o)); },
    remove: async (k: any) => { for (const x of [k].flat()) delete sess[x]; },
};
const ownKeys = () => Object.keys(sess).filter(k => k.startsWith(OWN_DL_PREFIX));
const clearSess = () => { for (const k of Object.keys(sess)) delete sess[k]; };
let modelReply = "";
let fetches = 0;
const C = globalThis as any;
const saved = { chrome: C.chrome, fetch: C.fetch };
const added: Function[] = [];
beforeAll(async () => {
    const mem: Record<string, unknown> = {};
    const area = { get: async (k?: any) => (k == null ? { ...mem } : typeof k === "string" ? { [k]: mem[k] } : Object.fromEntries((Array.isArray(k) ? k : Object.keys(k)).map((x: string) => [x, mem[x]]))), set: async (o: any) => { Object.assign(mem, o); }, remove: async (k: any) => { for (const x of [k].flat()) delete mem[x]; } };
    C.chrome = {
        ...saved.chrome,
        downloads: { onDeterminingFilename: { addListener: (f: Function) => { added.push(f); }, removeListener() { } } },
        runtime: { ...saved.chrome?.runtime, id: EXT, getURL: (p: string) => `chrome-extension://${EXT}/${p}`, onMessage: { addListener() { }, removeListener() { } } },
        tabs: { query: async () => [{ url: "https://example.com/", title: "Example page" }] },
        storage: { local: area, sync: area, session: sessArea, onChanged: { addListener() { }, removeListener() { } } }, // rel61：独立的 storage.session mock
    };
    C.fetch = async () => { fetches++; return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ newName: modelReply }) } }] }) }; };
    const S = await import("../src/api/Settings");
    await S.initSettings().catch(() => { /* 无完整环境时退回默认 */ });
});
afterAll(() => { C.chrome = saved.chrome; C.fetch = saved.fetch; });

async function setMode(useModel: boolean) {
    const S = await import("../src/api/Settings");
    S.mergePluginSettings("DownloadRename", useModel ? { useModel: true, endpoint: "http://model.invalid/v1", model: "m", fallback: true, timeout: 2 } : { useModel: false });
}
async function run(it: object): Promise<{ ret: boolean; s: { filename?: string; conflictAction?: string } | undefined; called: boolean }> {
    const { default: plugin } = await import("../src/plugins/downloadRename/index");
    if (!(plugin as any).settings.pluginName) (plugin as any).settings.pluginName = "DownloadRename";
    const cleanup = (plugin.background!.start as () => (() => void)[])();
    const l = added.at(-1) as (i: unknown, s: (x?: { filename?: string; conflictAction?: string }) => void) => boolean;
    let s: { filename?: string; conflictAction?: string } | undefined, called = false, ret = false;
    await new Promise<void>(r => {
        ret = l(it, x => { called = true; s = x; r(); });
        if (!ret) r(); else setTimeout(r, 4000);
    });
    for (const f of cleanup) f();
    return { ret, s, called };
}

const MODES = [["规则模式", false], ["模型模式", true]] as const;

describe("Capture data: 下载（capture.download / saveToLibrary 的 Captures/ 回退）", () => {
    for (const [label, useModel] of MODES) {
        test(`${label}：已登记意图 → suggest({ filename: "Captures/…", conflictAction }) ，不调模型，子目录与扩展指定名保住，条目用完即删`, async () => {
            clearSess(); await setMode(useModel); modelReply = "Downloaded image"; fetches = 0;
            await registerOwnIntent(DATA, `Captures/${CAPTURE}`, "uniquify");
            expect(ownKeys().length).toBe(1);
            const r = await run(capItem(10, { byExtensionId: "" })); // Chrome 156：byExtensionId 是空串
            expect(r.ret).toBe(true); expect(r.called).toBe(true); expect(fetches).toBe(0);
            expect(r.s).toEqual({ filename: `Captures/${CAPTURE}`, conflictAction: "uniquify" });
            expect(chrome156("download.png", r.s)).toBe(`Captures/${CAPTURE}`);
            expect(ownKeys()).toEqual([]);
        });
        test(`${label}：没有登记、byExtensionId = Cat → 无参 suggest()，不调模型（Chrome 156 上这只会得到浏览器名 "download.png"——所以发起方必须登记）`, async () => {
            clearSess(); await setMode(useModel); modelReply = "Downloaded image"; fetches = 0;
            const r = await run(capItem(12));
            expect(r.ret).toBe(true); expect(r.called).toBe(true); expect(r.s).toBeUndefined(); expect(fetches).toBe(0);
            expect(chrome156("download.png", r.s)).toBe("download.png");
        });
    }
});

describe("sessionTransfer 导出，「询问保存位置」打开（downloadOwn({ url: blob, filename, saveAs: true })）", () => {
    test("源码：saveAs 路径走 downloadOwn({ url, filename: name, saveAs: true })；<a download> 路径点击前 registerOwnIntent(url, name)", () => {
        const ui = readFileSync(resolve(import.meta.dir, "../src/plugins/sessionTransfer/ui.ts"), "utf8");
        expect(ui).toContain("URL.createObjectURL(new Blob(");
        expect(ui).toContain("downloadOwn({ url, filename: name, saveAs: true");
        expect(ui.indexOf("registerOwnIntent(url, name")).toBeGreaterThan(0);
        expect(ui.indexOf("registerOwnIntent(url, name")).toBeLessThan(ui.indexOf("a.click()"));
    });
    for (const [label, useModel] of MODES) {
        test(`${label}：已登记意图（本扩展 blob）→ suggest({ filename: 会话文件名 })，不调模型`, async () => {
            clearSess(); await setMode(useModel); modelReply = "Session backup"; fetches = 0;
            await registerOwnIntent(BLOB, SESSION, "uniquify");
            const r = await run(sessItem(20 + Number(useModel), { byExtensionId: "" }));
            expect(r.ret).toBe(true); expect(fetches).toBe(0);
            expect(r.s).toEqual({ filename: SESSION, conflictAction: "uniquify" });
            expect(chrome156("6f1c2e9a-3b7d-4c55-9a0e-1d2f3a4b5c6d", r.s)).toBe(SESSION);
            expect(ownKeys()).toEqual([]);
        });
        test(`${label}：没有登记、只有 byExtensionId=Cat（url 不是本扩展 blob 前缀）→ 无参 suggest()，不调模型`, async () => {
            clearSess(); await setMode(useModel); modelReply = "Session backup"; fetches = 0;
            const r = await run(sessItem(30 + Number(useModel), { url: "blob:null/6f1c2e9a-3b7d-4c55-9a0e-1d2f3a4b5c6d", finalUrl: "" }));
            expect(r.ret).toBe(true); expect(r.called).toBe(true); expect(r.s).toBeUndefined(); expect(fetches).toBe(0);
        });
    }
});

describe("别的扩展 / 页面下载不受影响（照常改名）", () => {
    const IMG = "https://cdn.example.com/IMG_20231001_123456.jpg";
    test("页面 https 下载（无 byExtensionId）：规则模式照常改名；意图表里有别的 url 的条目也不影响，且不被误取", async () => {
        clearSess(); await setMode(false);
        await registerOwnIntent(DATA, `Captures/${CAPTURE}`);
        const r = await run(capItem(40, { byExtensionId: undefined, byExtensionName: undefined, url: IMG, finalUrl: IMG, filename: "/d/IMG_20231001_123456.jpg", mime: "image/jpeg" }));
        expect(r.ret).toBe(true); expect(r.s?.filename).toBe("IMG Oct 1 2023.jpg");
        expect(ownKeys().length).toBe(1);
    });
    test("别的扩展的下载（byExtensionId = 其它 id）：规则模式照常改名", async () => {
        clearSess(); await setMode(false);
        const r = await run(capItem(41, { byExtensionId: OTHER, byExtensionName: "Other", url: IMG, finalUrl: IMG, filename: "/d/IMG_20231001_123456.jpg", mime: "image/jpeg" }));
        expect(r.ret).toBe(true); expect(r.s?.filename).toBe("IMG Oct 1 2023.jpg");
    });
    test("页面下载 report (1).txt → report.txt（有头实测对照项）", async () => {
        clearSess(); await setMode(false);
        const r = await run(capItem(42, { byExtensionId: undefined, url: "http://127.0.0.1/report.txt", finalUrl: "http://127.0.0.1/report.txt", filename: "/d/report (1).txt", mime: "text/plain" }));
        expect(r.ret).toBe(true); expect(r.s?.filename).toBe("report.txt");
    });
});

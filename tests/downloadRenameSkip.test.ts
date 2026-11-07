/* 补丁 3b：Download Rename 跳过会话传递导出的文件（session-*.session / .arcsession）。 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { isOwnBlobDownload, isSessionExport, SESSION_EXPORT_RE } from "../src/plugins/downloadRename/skip";

describe("文件名判定", () => {
    test("会话传递导出的文件名 → 跳过（含浏览器去重后缀、大小写）", () => {
        for (const n of ["session-app.example.com-2026-10-28T12-00-00.session", "session-a.b-1.arcsession", "session-x.session", "SESSION-A.SESSION"]) expect(isSessionExport(n)).toBe(true);
        expect(isSessionExport("session-host-2026-10-28T12-00-00 (1).session")).toBe(true);
    });
    test("别的文件一律不跳过", () => {
        for (const n of ["session.session", "session-.session", "my-session-a.session", "session-a.session.bak", "session-a.txt", "session-a.pdf", "report (1).pdf", "sessions-a.session", "xsession-a.arcsession", "session-a.sessionx", ""]) expect(isSessionExport(n)).toBe(false);
    });
    test("正则锚定首尾，不接受换行夹带", () => {
        expect(SESSION_EXPORT_RE.source.startsWith("^")).toBe(true); expect(SESSION_EXPORT_RE.source.endsWith("$")).toBe(true);
        expect(isSessionExport("evil.pdf\nsession-a.session")).toBe(false);
    });
});

const EXT = "geeallpjapgkkjnmmfkgnilggobekckd";
const UUID = "9970e303-9e0a-4e01-a162-534fa56f61bd";

describe("DownloadRename 监听器", () => {
    const calls = { added: [] as Function[], store: 0 };
    const C = globalThis as any;
    const saved = C.chrome;
    beforeAll(() => {
        C.chrome = {
            ...saved,
            downloads: { onDeterminingFilename: { addListener: (f: Function) => { calls.added.push(f); }, removeListener() { } } },
            runtime: { ...saved?.runtime, id: EXT, onMessage: { addListener() { }, removeListener() { } } },
            storage: { local: { get: async () => ({}), set: async () => { } }, session: { get: async () => ({}), set: async () => { }, remove: async () => { } }, onChanged: { addListener() { }, removeListener() { } } }, // rel61：storage.session mock（空：没有登记意图）
        };
    });
    afterAll(() => { C.chrome = saved; });
    /* rel61（downloadrename-own-filename）：监听器一律 return true、异步 suggest（先查 storage.session 里的下载意图）。
     * 原来 return false 的分支现在是无参 suggest()——Chrome 里两者效果相同（不改名）。这里 storage.session 是空的 mock（没有登记意图）。 */
    const call = (l: (i: unknown, s: (x?: unknown) => void) => boolean, item: object) => new Promise<{ ret: boolean; args: unknown[][] }>(r => {
        const args: unknown[][] = [];
        const ret = l(item, (...a: unknown[]) => { args.push(a); setTimeout(() => r({ ret, args }), 5); });
        setTimeout(() => r({ ret, args }), 1500);
    });
    const noRename = (x: { ret: boolean; args: unknown[][] }) => { expect(x.ret).toBe(true); expect(x.args.length).toBe(1); expect(x.args[0]![0]).toBeUndefined(); };
    test("会话导出文件：监听器无参 suggest() 一次（浏览器按原名保存，等同原来的 return false）（别的文件走改名流程：规则 / 模型行为见 downloadRename.test.ts，此处不重复；设置未初始化时不能调用）", async () => {
        const { default: plugin } = await import("../src/plugins/downloadRename/index");
        const cleanup = (plugin.background!.start as () => (() => void)[])();
        const l = calls.added.at(-1) as (i: unknown, s: (x?: unknown) => void) => boolean;
        noRename(await call(l, { id: 1, filename: "/Users/me/Downloads/session-app.example.com-2026-10-28T12-00-00.arcsession", url: "blob:x" }));
        noRename(await call(l, { id: 2, filename: "C:\\Users\\me\\Downloads\\session-a.example.com-t.session", url: "blob:x" }));
        for (const f of cleanup) f();
    });
    test("本扩展 blob 下载、没有登记意图：无参 suggest()（不改名、不调模型）。⚠ Chrome 156 上这样保不住 downloads.download 指定的名字（得 uuid），所以发起方必须先登记意图（见 ownDownloadIntent.test.ts）", async () => {
        const { default: plugin } = await import("../src/plugins/downloadRename/index");
        const cleanup = (plugin.background!.start as () => (() => void)[])();
        const l = calls.added.at(-1) as (i: unknown, s: (x?: unknown) => void) => boolean;
        noRename(await call(l, { id: 11, filename: `/Users/me/Downloads/${UUID}`, url: `blob:chrome-extension://${EXT}/${UUID}`, finalUrl: `blob:chrome-extension://${EXT}/${UUID}`, byExtensionId: EXT }));
        noRename(await call(l, { id: 12, filename: `C:\\Users\\me\\Downloads\\${UUID}`, url: `blob:chrome-extension://${EXT}/${UUID}` })); // 只有 url（byExtensionId 缺失）也识别
        noRename(await call(l, { id: 13, filename: `/x/${UUID}`, url: `https://example.com/a`, finalUrl: `blob:chrome-extension://${EXT}/${UUID}` })); // 只有 finalUrl
        for (const f of cleanup) f();
    });
    test("H10c（扩展页 <a download> 路径）、没有登记意图：item.filename 已是 download 属性的名字 → 无参 suggest()（会话导出名与本扩展 blob 两道放行各自独立有效）", async () => {
        const { default: plugin } = await import("../src/plugins/downloadRename/index");
        const cleanup = (plugin.background!.start as () => (() => void)[])();
        const l = calls.added.at(-1) as (i: unknown, s: (x?: unknown) => void) => boolean;
        const blob = `blob:chrome-extension://${EXT}/${UUID}`;
        noRename(await call(l, { id: 21, filename: "/Users/me/Downloads/session-app.example.com-2026-10-28T12-00-00.session", url: blob, finalUrl: blob, referrer: `chrome-extension://${EXT}/panel.html` })); // 名字规则放行
        noRename(await call(l, { id: 22, filename: "C:\\Users\\me\\Downloads\\session-a.example.com-t.arcsession", url: blob }));
        noRename(await call(l, { id: 23, filename: "/Users/me/Downloads/other-name.txt", url: blob })); // 名字规则不认时，本扩展 blob 放行仍有效
        for (const f of cleanup) f();
    });
    test("isOwnBlobDownload：只认本扩展的 blob:chrome-extension://<自己的 id>/；别的扩展 / 页面 blob / data: / https / 前缀相似的 id / 缺 id 都不是", () => {
        const own = (u: string, f?: string) => isOwnBlobDownload({ url: u, finalUrl: f }, EXT);
        expect(own(`blob:chrome-extension://${EXT}/${UUID}`)).toBe(true);
        expect(own("https://x.example/", `blob:chrome-extension://${EXT}/${UUID}`)).toBe(true);
        for (const u of [`blob:chrome-extension://${"a".repeat(32)}/${UUID}`, `blob:https://example.com/${UUID}`, `blob:null/${UUID}`, "data:image/png;base64,AAAA", "https://example.com/a.session",
            `blob:chrome-extension://${EXT}x/${UUID}`, `blob:chrome-extension://${EXT.slice(0, 31)}/${UUID}`, `chrome-extension://${EXT}/page.html`, `xblob:chrome-extension://${EXT}/${UUID}`, "", `blob:chrome-extension://${EXT}`]) expect(own(u)).toBe(false);
        expect(isOwnBlobDownload({ url: `blob:chrome-extension://${EXT}/${UUID}` }, "")).toBe(false); // 取不到 runtime.id 时不跳过
        expect(isOwnBlobDownload({ url: `blob:chrome-extension:///${UUID}` }, undefined)).toBe(false);
        expect(isOwnBlobDownload({}, EXT)).toBe(false);
    });
    test("静态：先查意图，再在读取设置 / 取标题 / 调用模型之前做跳过判定（decide 的第一条语句）", () => {
        const s = readFileSync(new URL("../src/plugins/downloadRename/index.ts", import.meta.url), "utf8");
        // rel61：onDetermining 先查意图（takeOwnIntent），没命中才进 decide()；跳过判定是 decide() 的第一批语句
        const od = s.slice(s.indexOf("function onDetermining"), s.indexOf("function decide"));
        expect(od.indexOf("takeOwnIntent(")).toBeGreaterThan(0);
        expect(od.indexOf("takeOwnIntent(")).toBeLessThan(od.indexOf("decide(item"));
        const body = s.slice(s.indexOf("function decide"));
        expect(body.indexOf("isSessionExport(base)")).toBeGreaterThan(0);
        expect(body.indexOf("isSessionExport(base)")).toBeLessThan(body.indexOf("settings.store"));
        expect(body.indexOf("isSessionExport(base)")).toBeLessThan(body.indexOf("titleFor"));
        expect(body.indexOf("isSessionExport(base)")).toBeLessThan(body.indexOf("decideName"));
        expect(body.indexOf("isOwnDownload(item")).toBeGreaterThan(0); // H10c：自家 blob 下载同样在第一批语句里
        for (const k of ["settings.store", "titleFor", "decideName", "suggest("]) expect(body.indexOf("isOwnDownload(item")).toBeLessThan(body.indexOf(k));
    });
});

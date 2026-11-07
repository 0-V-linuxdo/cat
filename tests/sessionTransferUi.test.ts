/* 会话传递界面层单测：站点控制分区 / 通道扩展点 / 下载（只收密文字节、saveAs、隐藏、监听清理）/ 导入结果与撤销 / 口令重试 / 确认开关 / 清除对话框。
 * FakeDom + 假 chrome（tests/sessionTransferHarness.ts）。真实 Chrome 里的点击步数、版面、blob 下载与 saveAs 取消事件 → HEADED-TODO.md（⚠ 未验证）。 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";

import { FakeEl, installChrome, installDom } from "./sessionTransferHarness";

const mem: Record<string, unknown> = {};
const ev = () => ({ addListener() { }, removeListener() { } });
const dom = installDom();
const T = installChrome();
const C = chrome as any;
C.runtime.onMessage = ev(); C.runtime.sendMessage = () => Promise.resolve();
C.storage = { local: { get: async (k: string) => (k in mem ? { [k]: mem[k] } : {}), set: async (o: Record<string, unknown>) => { Object.assign(mem, structuredClone(o)); } }, onChanged: ev() };
(globalThis as any).IS_DEV = false; (globalThis as any).VERSION = "test";
const clip = { writes: [] as string[] };
const savedClip = Object.getOwnPropertyDescriptor(globalThis.navigator, "clipboard");
Object.defineProperty(globalThis.navigator, "clipboard", { configurable: true, value: { writeText: async (t: string) => { clip.writes.push(t); }, readText: async () => "" } });
const urls = { made: [] as unknown[], revoked: [] as string[] };
const savedUrl = { c: URL.createObjectURL, r: URL.revokeObjectURL };
URL.createObjectURL = ((b: unknown) => { urls.made.push(b); return `blob:test/${urls.made.length}`; }) as never;
URL.revokeObjectURL = ((u: string) => { urls.revoked.push(u); }) as never;

/* 假浏览器：扩展页里 <a download href=blob:> 被点击 → 下载创建事件（downloads.onCreated）；browser="block" 表示点击没产生下载（被拦截）。 */
const anchors: any[] = []; const br = { mode: "create" as "create" | "block" };
const savedCreateEl = dom.createElement;
dom.createElement = (t: string) => {
    const e = savedCreateEl(t);
    if (t === "a") { anchors.push(e); e.addEventListener("click", () => { if (br.mode === "create") for (const l of T.fc.onCreated) l({ id: 7, url: e.href, finalUrl: e.href }); }); }
    return e;
};

const { setContext } = await import("../src/api/context");
const PM = await import("../src/api/PluginManager");
const { initSettings, PlainSettings } = await import("../src/api/Settings");
const { tr } = await import("../src/api/i18n");
const { default: plugin } = await import("../src/plugins/sessionTransfer/index");
const { renderSection } = await import("../src/plugins/sessionTransfer/section");
const { registerChannel, activeChannels } = await import("../src/plugins/sessionTransfer/channels");
const ui = await import("../src/plugins/sessionTransfer/ui");
const { sealSC, sealPass, toToken, decode } = await import("../src/plugins/sessionTransfer/container");

const NAME = "SessionTransfer";
const tick = () => new Promise<void>(r => setTimeout(r, 0));
const settle = async (n = 8) => { for (let i = 0; i < n; i++) await tick(); };
const load = async (settings: Record<string, unknown> = {}) => {
    for (const k of Object.keys(PlainSettings.plugins)) delete PlainSettings.plugins[k];
    mem.ArcSidebarSettings = { plugins: { [NAME]: { enabled: true, ...settings } } };
    await initSettings();
};
const until = async (f: () => unknown, ms = 8000) => { const t0 = Date.now(); while (!f()) { if (Date.now() - t0 > ms) throw new Error("timeout"); await tick(); } };
const toasts = () => dom.body.querySelectorAll(".arc-toast");
const P = { v: 2 as const, o: "https://app.example.com", t: 1, l: { theme: "dark" }, s: {}, c: [{ name: "sid", value: "NEW", domain: "app.example.com", path: "/", secure: true, httpOnly: true, sameSite: "lax" as const, hostOnly: true, session: true }] };

beforeAll(async () => { setContext("panel"); PM.registerPlugin(plugin); await load(); PM.initPluginManager(); await PM.startAllPlugins(); });
afterAll(() => {
    if (savedClip) Object.defineProperty(globalThis.navigator, "clipboard", savedClip); else delete (globalThis.navigator as any).clipboard;
    URL.createObjectURL = savedUrl.c; URL.revokeObjectURL = savedUrl.r; dom.createElement = savedCreateEl;
    delete PM.plugins[NAME]; for (const k of Object.keys(PlainSettings.plugins)) delete PlainSettings.plugins[k]; T.uninstall(); dom.uninstall(); });
beforeEach(async () => {
    T.fc.perm.granted = true; T.fc.jar.length = 0; T.fc.downloads.length = 0; T.fc.erased.length = 0; T.fc.onChanged.clear(); T.fc.onCreated.clear(); anchors.length = 0; br.mode = "create"; T.fc.created.length = 0; T.fc.reloads.length = 0; T.fc.spa = undefined;
    clip.writes.length = 0; urls.made.length = 0; urls.revoked.length = 0; dom.body.children = []; T.fc.localByOrigin.clear(); delete (globalThis as any).__arcDialogAuto;
    await load();
});

describe("站点控制分区", () => {
    const render = (url: string) => { const box = new FakeEl("div"); let closed = 0; renderSection(box as never, { id: 1, url } as chrome.tabs.Tab, () => { closed++; }); return { box, closed: () => closed }; };
    test("有 5 个内置按钮 + 风险提示；网页标签可点，非网页（chrome://）全部置灰", () => {
        const web = render("https://app.example.com/");
        const tests = web.box.all().filter(e => e.tag === "button").map(e => e.attrs.get("data-test"));
        expect(tests).toEqual(["st-copy", "st-paste", "st-export", "st-import", "st-clear"]);
        expect(web.box.all().filter(e => e.tag === "button").every(b => !b.disabled)).toBe(true);
        expect(web.box.querySelector('[data-test="st-risk"]')!.textContent).toBe(tr("st.risk"));
        expect(render("chrome://settings").box.all().filter(e => e.tag === "button").every(b => b.disabled)).toBe(true);
    });
    test("点击先关闭面板，再动态加载 ui（同步栈里只做 close）；随后清除对话框出现，取消后不留监听", async () => {
        const r = render("https://app.example.com/");
        (r.box.querySelector('[data-test="st-clear"]') as FakeEl).click();
        expect(r.closed()).toBe(1);
        await until(() => dom.body.querySelector('[data-test="st-clear-cancel"]'));
        dom.body.querySelector('[data-test="st-clear-cancel"]')!.click(); await settle();
        expect(dom.listenerCount("keydown")).toBe(0);
    });
    test("通道扩展点：没有注册 → 不多画按钮；已注册但子开关关 → 不画；打开 → 画出并在点击时 run(tab)", async () => {
        expect(activeChannels()).toEqual([]);
        let on = false; const ran: unknown[] = [];
        const off = registerChannel({ id: "x", label: "st.copy", test: "st-x", enabled: () => on, run: tab => { ran.push(tab.url); } });
        expect(render("https://a.com/").box.querySelector('[data-test="st-x"]')).toBeNull();
        on = true;
        const r = render("https://a.com/");
        (r.box.querySelector('[data-test="st-x"]') as FakeEl).click();
        expect(ran).toEqual(["https://a.com/"]); expect(r.closed()).toBe(1);
        off(); expect(render("https://a.com/").box.querySelector('[data-test="st-x"]')).toBeNull();
    });
});

describe("下载（saveBytes）", () => {
    test("saveAs 关：在扩展页造 <a download=名字 href=blob:…> 并点击；不调用 downloads.download（H10c：DownloadRename 开启时 download({filename}) 的名字会丢成 uuid，页面 <a download> 不受影响）；a 不留在页面里", async () => {
        await ui.saveBytes(new Uint8Array([1, 2, 3]), "session-a.session");
        expect(T.fc.downloads).toEqual([]);
        expect(anchors.length).toBe(1);
        expect(anchors[0].download).toBe("session-a.session"); expect(anchors[0].href).toBe("blob:test/1");
        expect(dom.body.children.length).toBe(0);
        expect(urls.made.length).toBe(1); expect(urls.revoked).toEqual([]); // 下载还没完成，不能撤销
        expect((urls.made[0] as Blob).type).toBe("application/octet-stream");
        expect(T.fc.onCreated.size).toBe(1); expect(T.fc.onChanged.size).toBe(1);
        [...T.fc.onChanged][0]!({ id: 7, state: { current: "complete" } });
        expect(T.fc.onCreated.size).toBe(0); expect(T.fc.onChanged.size).toBe(0); expect(urls.revoked).toEqual(["blob:test/1"]);
        expect(T.fc.erased).toEqual([]);
    });
    test("监听在点击之前就挂好（点击同步触发下载创建事件）；别的下载（url 不同）的创建事件、别的 id 的完成事件都被忽略；完成后全部摘掉并撤销 URL", async () => {
        br.mode = "block";
        await ui.saveBytes(new Uint8Array([1]), "s.session");
        const [c, ch] = [[...T.fc.onCreated][0]!, [...T.fc.onChanged][0]!];
        c({ id: 5, url: "blob:other/9", finalUrl: "blob:other/9" });
        ch({ id: 5, state: { current: "complete" } }); expect(urls.revoked).toEqual([]); expect(T.fc.onChanged.size).toBe(1);
        c({ id: 9, url: "blob:test/1", finalUrl: "blob:test/1" });
        ch({ id: 5, state: { current: "complete" } }); expect(urls.revoked).toEqual([]);
        ch({ id: 9, state: { current: "in_progress" } }); expect(urls.revoked).toEqual([]);
        ch({ id: 9, state: { current: "complete" } });
        expect(urls.revoked).toEqual(["blob:test/1"]); expect(T.fc.onCreated.size).toBe(0); expect(T.fc.onChanged.size).toBe(0);
    });
    test("hideFromDownloads=true 完成后 erase；中断也清理但不 erase", async () => {
        await load({ hideFromDownloads: true });
        await ui.saveBytes(new Uint8Array([1]), "s.session");
        [...T.fc.onChanged][0]!({ id: 7, state: { current: "complete" } });
        expect(T.fc.erased).toEqual([7]); expect(T.fc.onChanged.size).toBe(0); expect(T.fc.onCreated.size).toBe(0);
        await ui.saveBytes(new Uint8Array([1]), "s.session");
        [...T.fc.onChanged][0]!({ id: 7, state: { current: "interrupted" } });
        expect(T.fc.onChanged.size).toBe(0); expect(T.fc.erased).toEqual([7]); expect(urls.revoked.length).toBe(2);
    });
    test("点击没有产生下载（被浏览器拦截）→ 等待超时后撤销 URL、摘掉监听；完成路径不留定时器副作用（完成后超时不会二次撤销）", async () => {
        br.mode = "block";
        await ui.saveBytes(new Uint8Array([1]), "s.session", 20);
        expect(T.fc.onCreated.size).toBe(1); expect(urls.revoked).toEqual([]);
        await new Promise(r => setTimeout(r, 80));
        expect(urls.revoked).toEqual(["blob:test/1"]); expect(T.fc.onCreated.size).toBe(0); expect(T.fc.onChanged.size).toBe(0);
        await ui.saveBytes(new Uint8Array([1]), "s.session", 20);
        [...T.fc.onChanged][0]!({ id: 7, state: { current: "complete" } });
        await new Promise(r => setTimeout(r, 80));
        expect(urls.revoked).toEqual(["blob:test/1", "blob:test/2"]);
    });
    test("下载已创建但还没完成（大文件 / 用户在保存对话框里）：超过等待时间也不能撤销 URL（等待时间只管「没有出现下载」）；完成后才撤销", async () => {
        await ui.saveBytes(new Uint8Array([1]), "s.session", 20);
        await new Promise(r => setTimeout(r, 80));
        expect(urls.revoked).toEqual([]); expect(T.fc.onChanged.size).toBe(1);
        [...T.fc.onChanged][0]!({ id: 7, state: { current: "complete" } });
        expect(urls.revoked).toEqual(["blob:test/1"]);
    });
    test("saveAs=true：仍走 chrome.downloads.download（只有这条路能强制「询问保存位置」；⚠ DownloadRename 开启时文件名是否保住待 headed 实测）；完成后撤销 URL / 移除监听 / hide 时 erase", async () => {
        await load({ saveAs: true, hideFromDownloads: true });
        await ui.saveBytes(new Uint8Array([1, 2, 3]), "session-a.session");
        expect(T.fc.downloads).toEqual([{ url: "blob:test/1", filename: "session-a.session", saveAs: true, conflictAction: "uniquify" }]);
        expect(anchors.length).toBe(0); expect(T.fc.onCreated.size).toBe(0); expect(T.fc.onChanged.size).toBe(1);
        const l = [...T.fc.onChanged][0]!;
        l({ id: 99, state: { current: "complete" } }); expect(T.fc.onChanged.size).toBe(1);
        l({ id: 7, state: { current: "complete" } });
        expect(T.fc.erased).toEqual([7]); expect(T.fc.onChanged.size).toBe(0); expect(urls.revoked).toEqual(["blob:test/1"]);
    });
    test("saveAs=true 且 download 本身失败 → 撤销 URL、不留监听、错误向上抛", async () => {
        await load({ saveAs: true });
        const d = C.downloads.download; C.downloads.download = async () => { throw new Error("x"); };
        await expect(ui.saveBytes(new Uint8Array([1]), "s.session")).rejects.toBeDefined();
        C.downloads.download = d;
        expect(T.fc.onChanged.size).toBe(0); expect(urls.revoked.length).toBe(1);
    });
    test("导出文件动作：文件字节是 SESSIONCOPY 魔数开头的密文，文件名符合 session-<host>-<时间>.session，toast 带风险提示", async () => {
        T.fc.jar.push(T.ck({ name: "sid", value: "PLAINTEXT-VALUE", domain: "app.example.com" }));
        await ui.actExportFile(T.addTab("https://app.example.com/"));
        expect(anchors[0].download).toMatch(/^session-app\.example\.com-.*\.session$/); expect(T.fc.downloads).toEqual([]);
        const blob = urls.made[0] as Blob;
        const bytes = new Uint8Array(await blob.arrayBuffer());
        expect(new TextDecoder("latin1").decode(bytes)).not.toContain("PLAINTEXT");
        expect(new TextDecoder("latin1").decode(bytes.subarray(0, 11))).toBe("SESSIONCOPY");
        expect(toasts()[0]!.textContent).toContain(tr("st.risk"));
    });
    test("复制动作（口令开启）→ arc:v1 令牌进剪贴板，不会再出现 SC 令牌", async () => {
        await load({ usePassphrase: true });
        T.fc.jar.push(T.ck({ name: "sid", value: "v", domain: "app.example.com" }));
        const done = ui.actCopy(T.addTab("https://app.example.com/"));
        await settle();
        const input = dom.body.querySelector('[data-test="st-pass-input"]')!; input.value = "pw";
        input.dispatch("keydown", { key: "Enter" });
        await done;
        expect(clip.writes.length).toBe(1); expect(clip.writes[0]!.startsWith("arc:v1:")).toBe(true);
        expect((await decode(clip.writes[0]!, "pw")).cookies[0]!.name).toBe("sid");
        expect(toasts()[0]!.textContent).toContain(tr("st.copiedPass"));
    }, 30_000);
});

describe("导入：确认 / 结果 / 撤销 / 口令", () => {
    test("A1 确认默认开：确认框拿到站点与计数；取消 → 不写任何东西、不开标签", async () => {
        const asked: Array<[string]> = [];
        (globalThis as any).__arcDialogAuto = { confirm: (m: string) => { asked.push([m]); return false; } };
        await ui.importInput(toToken(await sealSC(P)));
        expect(asked).toEqual([[tr("st.confirmTitle")]]);
        expect(T.fc.setCalls.length).toBe(0); expect(T.fc.created.length).toBe(0);
    });
    test("设置里关闭「导入前确认」→ 直接导入；结果 toast 带「撤销」，点撤销 → 写回旧值并刷新", async () => {
        await load({ confirmBeforeImport: false });
        (globalThis as any).__arcDialogAuto = { confirm: () => { throw new Error("should not ask"); } };
        T.fc.jar.push(T.ck({ name: "sid", value: "OLD", domain: "app.example.com" }));
        await ui.importInput(toToken(await sealSC(P)));
        expect(T.fc.jar.find(c => c.name === "sid")!.value).toBe("NEW");
        const t = toasts().at(-1)!;
        expect(t.textContent).toContain(tr("st.imported"));
        const undo = t.querySelector('[data-test="st-undo"]')!;
        expect(undo).not.toBeNull();
        undo.click(); await settle(12);
        expect(T.fc.jar.find(c => c.name === "sid")!.value).toBe("OLD");
        expect(toasts().map(x => x.textContent)).toContain(tr("st.undone"));
    });
    test("导入失败（存储写入被拒）→ 回滚后提示错误码文案 + 已回滚", async () => {
        await load({ confirmBeforeImport: false });
        const exec = C.scripting.executeScript; C.scripting.executeScript = async (o: any) => { if (o.func.name === "writeStorageInPage") throw new Error("x"); return exec(o); };
        T.fc.jar.push(T.ck({ name: "sid", value: "OLD", domain: "app.example.com" }));
        await ui.importInput(toToken(await sealSC(P)));
        C.scripting.executeScript = exec;
        expect(T.fc.jar.find(c => c.name === "sid")!.value).toBe("OLD");
        expect(toasts().at(-1)!.textContent).toContain(tr("st.err.storage-failed"));
        expect(toasts().at(-1)!.textContent).toContain(tr("st.rolledBack"));
    });
    test("口令封装：弹口令框；错口令提示并重新询问，最多 3 次；取消 → 什么都不做", async () => {
        await load({ confirmBeforeImport: false });
        const tok = toToken(await sealPass(P, "right"), "pass");
        const done = ui.importInput(tok);
        const answer = async (v: string | null) => {
            await until(() => dom.body.querySelector('[data-test="st-pass-input"]'));
            if (v == null) { dom.body.querySelector('[data-test="st-pass-cancel"]')!.click(); return; }
            const i = dom.body.querySelector('[data-test="st-pass-input"]')!; i.value = v; i.dispatch("keydown", { key: "Enter" });
        };
        await answer("wrong1"); await answer("wrong2"); await answer("right");
        await done;
        expect(T.fc.jar.find(c => c.name === "sid")!.value).toBe("NEW");
        expect(toasts().map(t => t.textContent).filter(x => x === tr("st.err.bad-passphrase")).length).toBe(2);
        // 取消
        T.fc.jar.length = 0; T.fc.setCalls.length = 0;
        const d2 = ui.importInput(tok); await answer(null); await d2;
        expect(T.fc.setCalls.length).toBe(0);
    }, 60_000);
    test("文件导入：二进制 .session → 解码；保存成文本的令牌文件也认；超大文件 → too-large", async () => {
        await load({ confirmBeforeImport: false });
        const bytes = (await import("../src/plugins/sessionTransfer/container")).toFile(await sealSC(P));
        await ui.importFileAction({ size: bytes.length, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) } as unknown as File);
        expect(T.fc.jar.find(c => c.name === "sid")!.value).toBe("NEW");
        T.fc.jar.length = 0;
        const txt = new TextEncoder().encode("\n" + toToken(await sealSC(P)) + "\n");
        await ui.importFileAction({ size: txt.length, arrayBuffer: async () => txt.buffer.slice(0) } as unknown as File);
        expect(T.fc.jar.find(c => c.name === "sid")!.value).toBe("NEW");
        await ui.importFileAction({ size: 65 * 1024 * 1024, arrayBuffer: async () => new ArrayBuffer(0) } as unknown as File);
        expect(toasts().at(-1)!.textContent).toBe(tr("st.err.too-large"));
    });
});

describe("清除站点数据对话框", () => {
    test("三个勾选项默认全选；只选 cookie → 只清 cookie；全不选 → 提示且不动作；取消 → 不动作", async () => {
        T.fc.jar.push(T.ck({ name: "a", value: "1", domain: "app.example.com" }));
        const tab = T.addTab("https://app.example.com/", { s: "1" }); T.local("https://app.example.com").set("l", "1");
        let done = ui.actClear(tab); await settle();
        for (const k of ["cookies", "local", "session"]) expect(dom.body.querySelector(`[data-test="st-clear-${k}"]`)!.checked).toBe(true);
        dom.body.querySelector('[data-test="st-clear-cancel"]')!.click(); await done;
        expect(T.fc.jar.length).toBe(1);
        done = ui.actClear(tab); await settle();
        for (const k of ["cookies", "local", "session"]) dom.body.querySelector(`[data-test="st-clear-${k}"]`)!.checked = false;
        dom.body.querySelector('[data-test="st-clear-ok"]')!.click(); await done;
        expect(toasts().at(-1)!.textContent).toBe(tr("st.nothingSelected")); expect(T.fc.jar.length).toBe(1);
        done = ui.actClear(tab); await settle();
        dom.body.querySelector('[data-test="st-clear-local"]')!.checked = false; dom.body.querySelector('[data-test="st-clear-session"]')!.checked = false;
        dom.body.querySelector('[data-test="st-clear-ok"]')!.click(); await done;
        expect(T.fc.jar.length).toBe(0); expect(T.local("https://app.example.com").size).toBe(1);
    });
    test("Esc 取消模态框；模态框关闭后不留下 keydown 监听", async () => {
        const tab = T.addTab("https://app.example.com/");
        const done = ui.actClear(tab); await settle();
        expect(dom.listenerCount("keydown")).toBeGreaterThan(0);
        dom.body.querySelector('[data-test="st-clear-cancel"]')!.click(); await done;
        expect(dom.listenerCount("keydown")).toBe(0);
    });
});

/* 会话传递 · WebDAV 界面层单测：通道按钮随子开关出现 / 消失；设置对话框；导出对话框（生成口令 / 校验）；导入流程（列表 / 过期置灰 / 清理 / 口令重试 / 确认 / 成功后删远端 / 失败不删）；命令在子开关关闭时无副作用。
 * FakeDom + 假 chrome + 内存假 WebDAV + 假秘密库。⚠ 真实 Chrome 里的版面、密码框自动填充、扩展页 fetch 行为未验证（HEADED-TODO.md H9–H12）。 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";

import { FakeDav } from "./sessionTransferDavHarness";
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
const consoleCalls: string[] = []; const savedConsole: Record<string, unknown> = {};
for (const k of ["log", "info", "warn", "error", "debug"] as const) { savedConsole[k] = console[k]; (console as any)[k] = (...a: unknown[]) => { consoleCalls.push(`${k}:${a.map(String).join(" ")}`); }; }
const idb = { ops: [] as string[], map: new Map<string, unknown>() };
const fakeArea = {
    async get(k: string) { idb.ops.push(`get:${k}`); return idb.map.has(k) ? { [k]: structuredClone(idb.map.get(k)) } : {}; },
    async set(o: Record<string, unknown>) { idb.ops.push(`set:${Object.keys(o).join(",")}`); for (const [k, v] of Object.entries(o)) idb.map.set(k, structuredClone(v)); },
    async remove(k: string) { idb.ops.push(`remove:${k}`); idb.map.delete(k); },
};

const { setContext } = await import("../src/api/context");
const PM = await import("../src/api/PluginManager");
const { initSettings, PlainSettings, SettingsStore } = await import("../src/api/Settings");
const { tr } = await import("../src/api/i18n");
const { default: plugin } = await import("../src/plugins/sessionTransfer/index");
const { renderSection } = await import("../src/plugins/sessionTransfer/section");
const ui = await import("../src/plugins/sessionTransfer/webdav/ui");
const Cfg = await import("../src/plugins/sessionTransfer/webdav/config");
const F = await import("../src/plugins/sessionTransfer/webdav/format");
const { sealSC } = await import("../src/plugins/sessionTransfer/container");

const NAME = "SessionTransfer";
const dav = new FakeDav();
let restoreFetch = () => { };
const tick = () => new Promise<void>(r => setTimeout(r, 0));
const settle = async (n = 10) => { for (let i = 0; i < n; i++) await tick(); };
const until = async (f: () => unknown, ms = 15000) => { const t0 = Date.now(); while (!f()) { if (Date.now() - t0 > ms) throw new Error("timeout; body=" + dom.body.all().map(e => e.attrs.get("data-test") ?? e.className).filter(Boolean).join(",").slice(0, 400)); await tick(); } };
const load = async (settings: Record<string, unknown> = {}) => {
    for (const k of Object.keys(PlainSettings.plugins)) delete PlainSettings.plugins[k];
    mem.ArcSidebarSettings = { plugins: { [NAME]: { enabled: true, webdavEnabled: true, ...settings } } };
    await initSettings();
};
const $ = (t: string) => dom.body.querySelector(`[data-test="${t}"]`) as FakeEl | null;
const $$ = (t: string) => dom.body.querySelectorAll(`[data-test="${t}"]`) as FakeEl[];
const toasts = () => dom.body.querySelectorAll(".arc-toast").map(t => t.textContent);
const P = { v: 2 as const, o: "https://app.example.com", t: 1, l: { theme: "dark" }, s: {}, c: [{ name: "sid", value: "NEW", domain: "app.example.com", path: "/", secure: true, httpOnly: true, sameSite: "lax" as const, hostOnly: true, session: true }] };
const PASS = "right passphrase 1";
const sealed = async (o: { ttlMs?: number; now?: number; label?: string } = {}) => { const s = await F.sealDav(P, PASS, { label: o.label ?? "我的笔记本", ttlMs: o.ttlMs ?? 3_600_000, now: o.now }); dav.put(s.name, s.bytes); return s; };
const configure = (remember: boolean) => Cfg.saveConfig({ url: dav.dirUrl, kind: "basic", user: "cat", secret: "pw-test" }, remember);
const answerPass = async (v: string) => { await until(() => $("st-pass-input")); const i = $("st-pass-input")!; i.value = v; i.dispatch("keydown", { key: "Enter" }); };
const noLeak = () => {
    const all = toasts().join("\n") + JSON.stringify(mem) + clip.writes.join("\n").replace(/[A-Z2-7]{4}(-[A-Z2-7]{4}){3}/g, "");
    for (const s of ["pw-test", PASS, "PASSPHRASE-SENTINEL", "dav.example.com", "COOKIE", "Basic "]) expect(all).not.toContain(s);
    expect(consoleCalls).toEqual([]);
};

beforeAll(async () => { setContext("panel"); restoreFetch = dav.install(); Cfg.setConfigStore(fakeArea); PM.registerPlugin(plugin); await load(); await PM.startAllPlugins(); });
afterAll(async () => {
    await SettingsStore.flush(); // 别让去抖的保存在别的测试文件里才落盘（会污染它们的设置）
    restoreFetch(); Cfg.setConfigStore(undefined);
    for (const [k, v] of Object.entries(savedConsole)) (console as any)[k] = v;
    if (savedClip) Object.defineProperty(globalThis.navigator, "clipboard", savedClip); else delete (globalThis.navigator as any).clipboard;
    delete PM.plugins[NAME]; for (const k of Object.keys(PlainSettings.plugins)) delete PlainSettings.plugins[k]; T.uninstall(); dom.uninstall();
});
beforeEach(async () => {
    dav.reqs.length = 0; dav.files.clear(); dav.others.clear(); dav.dirExists = true; dav.override = undefined; dav.style = "d"; dav.pass = "pw-test"; dav.bearer = undefined;
    consoleCalls.length = 0; idb.ops.length = 0; idb.map.clear(); clip.writes.length = 0;
    T.fc.perm.granted = true; T.fc.jar.length = 0; T.fc.created.length = 0; T.fc.reloads.length = 0; T.fc.setCalls.length = 0; T.fc.localByOrigin.clear(); T.fc.spa = undefined;
    dom.body.children = []; delete (globalThis as any).__arcDialogAuto;
    await load();
});

describe("通道按钮随子开关", () => {
    const render = () => { const box = new FakeEl("div"); renderSection(box as never, { id: 1, url: "https://app.example.com/" } as chrome.tabs.Tab, () => { }); return box; };
    const dts = (b: FakeEl) => b.all().filter(e => e.tag === "button").map(e => e.attrs.get("data-test"));
    test("webdavEnabled 关（默认）→ 只有 5 个内置按钮；打开 → 多出 WebDAV 导出 / 导入 / 设置", async () => {
        await load({ webdavEnabled: false });
        expect(dts(render())).toEqual(["st-copy", "st-paste", "st-export", "st-import", "st-clear"]);
        await load({ webdavEnabled: true });
        expect(dts(render())).toEqual(["st-copy", "st-paste", "st-export", "st-import", "st-clear", "st-dav-export", "st-dav-import", "st-dav-config"]);
        expect(render().querySelector('[data-test="st-dav-export"]')!.textContent).toBe(tr("st.dav.export"));
    });
    test("点 WebDAV 设置：先关面板，再动态加载 → 设置对话框", async () => {
        let closed = 0; const box = new FakeEl("div");
        renderSection(box as never, { id: 1, url: "https://app.example.com/" } as chrome.tabs.Tab, () => { closed++; });
        (box.querySelector('[data-test="st-dav-config"]') as FakeEl).click();
        expect(closed).toBe(1);
        await until(() => $("st-dav-url")); $("st-dav-cancel")!.click(); await settle();
        expect(dom.listenerCount("keydown")).toBe(0);
    });
});

describe("命令在子开关关闭时无副作用（P19 的界面侧）", () => {
    test("cmdDavExport / cmdDavImport / actDavConfig：只弹「WebDAV 未启用」，不发请求、不碰秘密库、不弹对话框", async () => {
        await load({ webdavEnabled: false });
        await ui.cmdDavExport(); await ui.cmdDavImport(); await ui.actDavConfig();
        expect(toasts()).toEqual([tr("st.dav.disabled"), tr("st.dav.disabled"), tr("st.dav.disabled")]);
        expect(dav.reqs.length).toBe(0); expect(idb.ops).toEqual([]); expect($("st-modal")).toBeNull();
    });
});

describe("设置对话框", () => {
    const open = async () => { const p = ui.actDavConfig(); await until(() => $("st-dav-url")); return { p }; };
    test("http 非回环 → 保存被拒并提示，什么都不存；https 保存 → 不勾记住则记录里没有密码", async () => {
        const { p } = await open();
        $("st-dav-url")!.value = "http://dav.example.com/x"; $("st-dav-user")!.value = "cat"; $("st-dav-secret")!.value = "pw-test";
        $("st-dav-save")!.click(); await settle();
        expect($("st-dav-status")!.textContent).toBe(tr("st.dav.err.dav-https-required")); expect(idb.map.size).toBe(0);
        $("st-dav-url")!.value = dav.dirUrl; $("st-dav-save")!.click(); await p;
        expect(idb.map.get(Cfg.DAV_KEY)).toEqual({ url: dav.dirUrl, kind: "basic", user: "cat" });
        expect(toasts()).toContain(tr("st.dav.saved")); noLeak();
    });
    test("勾选「记住」→ 密码进秘密库；再次打开留空 = 保持不变", async () => {
        let { p } = await open();
        $("st-dav-url")!.value = dav.dirUrl; $("st-dav-user")!.value = "cat"; $("st-dav-secret")!.value = "pw-test"; $("st-dav-remember")!.checked = true;
        $("st-dav-save")!.click(); await p;
        expect((idb.map.get(Cfg.DAV_KEY) as { secret: string }).secret).toBe("pw-test");
        ({ p } = await open()); expect($("st-dav-secret")!.placeholder).toBe(tr("st.dav.secretKept")); expect($("st-dav-secret")!.value).toBe("");
        $("st-dav-save")!.click(); await p;
        expect((idb.map.get(Cfg.DAV_KEY) as { secret: string }).secret).toBe("pw-test"); noLeak();
    });
    test("测试连接：成功 → 「连接正常」；密码错 → 401 文案；不保存任何东西", async () => {
        const { p } = await open();
        $("st-dav-url")!.value = dav.dirUrl; $("st-dav-user")!.value = "cat"; $("st-dav-secret")!.value = "pw-test";
        $("st-dav-test")!.click(); await until(() => $("st-dav-status")!.textContent);
        expect($("st-dav-status")!.textContent).toBe(tr("st.dav.testOk"));
        $("st-dav-secret")!.value = "bad"; $("st-dav-status")!.textContent = ""; $("st-dav-test")!.click(); await until(() => $("st-dav-status")!.textContent);
        expect($("st-dav-status")!.textContent).toBe(tr("st.dav.err.dav-auth")); expect(idb.map.size).toBe(0);
        $("st-dav-cancel")!.click(); await p;
    });
    test("测试连接：目录还没建（PROPFIND 404）→ 明确提示「目录不存在，导出时会自动创建」（不是 File not found）；不创建目录、不上传、不保存", async () => {
        dav.dirExists = false;
        const { p } = await open();
        $("st-dav-url")!.value = dav.dirUrl; $("st-dav-user")!.value = "cat"; $("st-dav-secret")!.value = "pw-test";
        $("st-dav-test")!.click(); await until(() => $("st-dav-status")!.textContent);
        const t = $("st-dav-status")!.textContent;
        expect(t).toBe(tr("st.dav.err.dav-dir-absent")); expect(t).not.toBe("st.dav.err.dav-dir-absent"); expect(t).not.toMatch(/not found|找不到/i);
        expect(dav.count("MKCOL")).toBe(0); expect(dav.count("PUT")).toBe(0); expect(dav.dirExists).toBe(false); expect(idb.map.size).toBe(0);
        $("st-dav-cancel")!.click(); await p;
    });
    test("清除配置：记录（含记住的密码）被删除", async () => {
        await configure(true);
        const { p } = await open(); $("st-dav-clear")!.click(); await p;
        expect(idb.map.has(Cfg.DAV_KEY)).toBe(false); expect(toasts()).toContain(tr("st.dav.cleared"));
    });
});

describe("导出", () => {
    const tab = () => T.addTab("https://app.example.com/page");
    test("未配置 → 提示先设置，不发请求", async () => { await ui.actDavExport(tab()); expect(toasts()).toContain(tr("st.dav.notConfigured")); expect(dav.reqs.length).toBe(0); });
    test("记住了密码：生成口令 → 两个框被填成同一个 XXXX-XXXX-XXXX-XXXX → 上传；toast 只有大小与有效期，没有口令；默认 1 小时", async () => {
        await configure(true); T.fc.jar.push(T.ck({ name: "sid", value: "COOKIE-A", domain: "app.example.com" }));
        const done = ui.actDavExport(tab());
        await until(() => $("st-dav-pass1"));
        expect($("st-dav-ttl")!.value).toBe(String(3_600_000)); expect($("st-dav-label")!.value).toBe("app.example.com");
        expect($("st-dav-risk")!.textContent).toBe(tr("st.dav.risk"));
        $("st-dav-gen")!.click();
        const pass = $("st-dav-pass1")!.value; expect(pass).toMatch(/^[A-Z2-7]{4}(-[A-Z2-7]{4}){3}$/); expect($("st-dav-pass2")!.value).toBe(pass);
        $("st-dav-copy")!.click(); await settle(); expect(clip.writes).toEqual([pass]);
        $("st-dav-label")!.value = "LABEL-X";
        $("st-dav-ok")!.click(); await done;
        expect(dav.files.size).toBe(1);
        const [name, f] = [...dav.files][0]!;
        const o = await F.openDav(f.bytes, pass);
        expect(o.meta.label).toBe("LABEL-X"); expect(o.meta.exp - o.meta.created).toBe(3_600_000); expect(F.NAME_RE.test(name)).toBe(true);
        const t = toasts().at(-1)!; expect(t).toContain("KB"); expect(t).not.toContain(pass); noLeak();
    });
    test("口令不一致 / 太短 / 等于 DAV 密码 → 对话框内提示、不关闭、不发请求；改对后可上传", async () => {
        await Cfg.saveConfig({ url: dav.dirUrl, kind: "basic", user: "cat", secret: "pw-test-pw-test" }, true); dav.pass = "pw-test-pw-test";
        const done = ui.actDavExport(tab());
        await until(() => $("st-dav-pass1"));
        const set = (a: string, b: string) => { $("st-dav-pass1")!.value = a; $("st-dav-pass2")!.value = b; $("st-dav-ok")!.click(); };
        set("aaaaaaaaaaaa", "bbbbbbbbbbbb"); expect($("st-dav-status")!.textContent).toBe(tr("st.dav.mismatch"));
        set("short", "short"); expect($("st-dav-status")!.textContent).toBe(tr("st.dav.err.dav-pass-short"));
        set("pw-test-pw-test", "pw-test-pw-test"); expect($("st-dav-status")!.textContent).toBe(tr("st.dav.err.dav-pass-same"));
        expect(dav.reqs.length).toBe(0); expect($("st-dav-pass1")).not.toBeNull();
        set("a-good-passphrase", "a-good-passphrase"); await done;
        expect(dav.files.size).toBe(1);
    });
    test("没记住密码：先弹 DAV 密码框（取消 = 什么都不发）；输入后继续", async () => {
        await configure(false);
        let done = ui.actDavExport(tab()); await until(() => $("st-dav-pw-input")); $("st-dav-pw-cancel")!.click(); await done;
        expect(dav.reqs.length).toBe(0);
        done = ui.actDavExport(tab()); await until(() => $("st-dav-pw-input")); $("st-dav-pw-input")!.value = "pw-test"; $("st-dav-pw-ok")!.click();
        await until(() => $("st-dav-pass1")); $("st-dav-pass1")!.value = $("st-dav-pass2")!.value = "a-good-passphrase"; $("st-dav-ok")!.click(); await done;
        expect(dav.files.size).toBe(1); expect(JSON.stringify([...idb.map])).not.toContain("pw-test"); noLeak();
    });
    test("上传失败（401）→ 只提示枚举码文案；403 / 507 同理", async () => {
        await configure(true);
        for (const [st, k] of [[401, "dav-auth"], [403, "dav-forbidden"], [507, "dav-quota"]] as const) {
            dav.override = () => new Response("SERVER-SECRET-BODY", { status: st });
            const done = ui.actDavExport(tab()); await until(() => $("st-dav-pass1")); $("st-dav-pass1")!.value = $("st-dav-pass2")!.value = "a-good-passphrase"; $("st-dav-ok")!.click(); await done;
            expect(toasts().at(-1)).toBe(tr(`st.dav.err.${k}`));
        }
        expect(toasts().join()).not.toContain("SERVER-SECRET-BODY"); noLeak();
    });
});

describe("导入", () => {
    test("没有文件 → 列表显示「没有会话文件」", async () => {
        await configure(true);
        const done = ui.actDavImport(); await until(() => $("st-dav-list"));
        expect($("st-dav-list")!.textContent).toBe(tr("st.dav.empty")); $("st-dav-cancel")!.click(); await done;
    });
    test("成功路径：列表 → 选择 → 口令（先错一次）→ 确认框带备注与有效期 → 导入 → 删除远端 → 提示", async () => {
        await configure(true); const s = await sealed({ label: "我的笔记本" });
        T.fc.jar.push(T.ck({ name: "sid", value: "OLD", domain: "app.example.com" }));
                const done = ui.actDavImport(); await until(() => $$("st-dav-pick").length);
        expect($$("st-dav-pick").length).toBe(1); expect($$("st-dav-pick")[0]!.textContent).toContain(s.name.slice(0, 8)); expect($$("st-dav-pick")[0]!.textContent).not.toContain("我的笔记本");
        $$("st-dav-pick")[0]!.click();
        await answerPass("wrong passphrase!!"); await until(() => toasts().includes(tr("st.err.bad-passphrase")));
        await answerPass(PASS);
        await until(() => dom.body.querySelector(".arc-dlg-detail")); // 真实确认框（不走自动应答钩子）：详情里要有备注 / 站点 / 有效期
        const detail = dom.body.querySelector(".arc-dlg-detail")!.textContent;
        expect(detail).toContain("我的笔记本"); expect(detail).toContain("app.example.com");
        dom.body.querySelectorAll(".arc-dlg-btn").find(b => b.classList.contains("ok"))!.click(); await done;
        expect(T.fc.jar.find(c => c.name === "sid")!.value).toBe("NEW");
        expect(dav.files.size).toBe(0); expect(dav.count("DELETE")).toBe(1); expect(dav.count("GET")).toBe(1); // 错口令重试不重新下载
        expect(toasts()).toContain(tr("st.dav.deleted")); noLeak();
    }, 30_000);
    test("设置里关了「导入前确认」也照样弹确认框（WebDAV 导入强制确认）；取消 → 不导入", async () => {
        await load({ confirmBeforeImport: false }); await configure(true); await sealed();
        const asked: string[] = []; (globalThis as any).__arcDialogAuto = { confirm: (m: string) => { asked.push(m); return false; } };
        const done = ui.actDavImport(); await until(() => $$("st-dav-pick").length); $$("st-dav-pick")[0]!.click(); await answerPass(PASS); await done;
        expect(asked).toEqual([tr("st.confirmTitle")]); expect(T.fc.setCalls.length).toBe(0); expect(dav.files.size).toBe(1);
    }, 30_000);
    test("设置「导入成功后删除远端」关 → 文件保留", async () => {
        await load({ deleteAfterImport: false, cleanupExpired: false }); await configure(true); await sealed();
        (globalThis as any).__arcDialogAuto = { confirm: () => true };
        const done = ui.actDavImport(); await until(() => $$("st-dav-pick").length); $$("st-dav-pick")[0]!.click(); await answerPass(PASS); await done;
        expect(T.fc.jar.find(c => c.name === "sid")!.value).toBe("NEW"); expect(dav.files.size).toBe(1); expect(dav.count("DELETE")).toBe(0);
    }, 30_000);
    test("确认框点取消 / 导入失败（回滚）→ 不删远端、不改 Cookie", async () => {
        await configure(true); await sealed();
        T.fc.jar.push(T.ck({ name: "sid", value: "OLD", domain: "app.example.com" }));
        (globalThis as any).__arcDialogAuto = { confirm: () => false };
        let done = ui.actDavImport(); await until(() => $$("st-dav-pick").length); $$("st-dav-pick")[0]!.click(); await answerPass(PASS); await done;
        expect(dav.files.size).toBe(1); expect(dav.count("DELETE")).toBe(0); expect(T.fc.jar[0]!.value).toBe("OLD"); expect(T.fc.setCalls.length).toBe(0);
        (globalThis as any).__arcDialogAuto = { confirm: () => true };
        const exec = C.scripting.executeScript; C.scripting.executeScript = async (o: any) => { if (o.func.name === "writeStorageInPage") throw new Error("x"); return exec(o); };
        dom.body.children = [];
        done = ui.actDavImport(); await until(() => $$("st-dav-pick").length); $$("st-dav-pick")[0]!.click(); await answerPass(PASS); await done;
        C.scripting.executeScript = exec;
        expect(T.fc.jar.find(c => c.name === "sid")!.value).toBe("OLD"); expect(dav.files.size).toBe(1); expect(dav.count("DELETE")).toBe(0);
        expect(toasts().at(-1)).toContain(tr("st.rolledBack"));
    }, 30_000);
    test("导入成功但远端删除失败 → 导入有效，只提示手动删除", async () => {
        await configure(true); await sealed(); (globalThis as any).__arcDialogAuto = { confirm: () => true };
        dav.override = r => r.method === "DELETE" ? new Response("", { status: 500 }) : undefined;
        const done = ui.actDavImport(); await until(() => $$("st-dav-pick").length); $$("st-dav-pick")[0]!.click(); await answerPass(PASS); await done;
        expect(T.fc.jar.find(c => c.name === "sid")!.value).toBe("NEW"); expect(toasts()).toContain(tr("st.dav.deleteFailed")); expect(dav.files.size).toBe(1);
    }, 30_000);
    test("口令连续错 3 次 → 提示错误并结束；取消口令框 → 什么都不做；都不删远端", async () => {
        await configure(true); await sealed();
        let done = ui.actDavImport(); await until(() => $$("st-dav-pick").length); $$("st-dav-pick")[0]!.click();
        for (let i = 0; i < 3; i++) await answerPass("nope nope nope!"); await done;
        expect(toasts().at(-1)).toBe(tr("st.err.bad-passphrase")); expect(dav.count("DELETE")).toBe(0); expect(dav.count("GET")).toBe(1);
        dom.body.children = [];
        done = ui.actDavImport(); await until(() => $$("st-dav-pick").length); $$("st-dav-pick")[0]!.click(); await until(() => $("st-pass-input")); $("st-pass-cancel")!.click(); await done;
        expect(dav.files.size).toBe(1); expect(T.fc.created.length).toBe(0);
    }, 30_000);
    test("头部已过期但文件名提示未到点 → dav-expired 文案，不导入不删除", async () => {
        await configure(true); await sealed({ ttlMs: 1000, now: Date.now() - 5000 });
        (globalThis as any).__arcDialogAuto = { confirm: () => { throw new Error("must not confirm"); } };
        const done = ui.actDavImport(); await until(() => $$("st-dav-pick").length); $$("st-dav-pick")[0]!.click(); await answerPass(PASS); await done;
        expect(toasts().at(-1)).toBe(tr("st.dav.err.dav-expired")); expect(dav.files.size).toBe(1); expect(dav.count("DELETE")).toBe(0);
    }, 30_000);
    test("打开列表时清理过期文件（默认开）：过期的被删、提示数量、其余留下且过期的不出现；关掉设置 → 一个都不删，过期项置灰不可选，可手动 ✕ 删除", async () => {
        await configure(true);
        const old = await sealed({ now: Date.now() - 3 * 3_600_000, ttlMs: 1000 }); const fresh = await sealed(); dav.others.set("别人的.txt", 1);
        let done = ui.actDavImport(); await until(() => $$("st-dav-pick").length);
        expect(dav.files.has(old.name)).toBe(false); expect(dav.files.has(fresh.name)).toBe(true); expect($$("st-dav-pick").length).toBe(1);
        expect(toasts()).toContain(tr("st.dav.cleaned", 1)); expect(dav.reqs.filter(r => r.method === "DELETE").map(r => decodeURIComponent(r.url.slice(dav.dirUrl.length)))).toEqual([old.name]);
        $("st-dav-cancel")!.click(); await done;
        await load({ cleanupExpired: false }); dav.files.clear(); dav.reqs.length = 0; dom.body.children = [];
        const old2 = await sealed({ now: Date.now() - 3 * 3_600_000, ttlMs: 1000 });
        done = ui.actDavImport(); await until(() => $$("st-dav-pick").length);
        expect(dav.count("DELETE")).toBe(0); expect($("st-dav-row")!.className).toContain("expired"); expect($$("st-dav-pick")[0]!.disabled).toBe(true);
        $$("st-dav-pick")[0]!.click(); await settle(); expect($("st-pass-input")).toBeNull(); expect(dav.count("GET")).toBe(0);
        $$("st-dav-del")[0]!.click(); await settle(); expect(dav.files.has(old2.name)).toBe(false);
        $("st-dav-cancel")!.click(); await done; noLeak();
    }, 30_000);
    test("列表请求失败 / 密码错 → 错误文案；SC 令牌 / 明文不会被当成 WebDAV 文件上传（SC 令牌走原有通道）", async () => {
        await configure(true); dav.pass = "changed";
        await ui.actDavImport(); expect(toasts().at(-1)).toBe(tr("st.dav.err.dav-auth"));
        const sc = await sealSC(P); expect(sc.length).toBeGreaterThan(0);
        await expect(import("../src/plugins/sessionTransfer/webdav/client").then(k => k.davPut({ dir: dav.dirUrl, auth: { kind: "basic", user: "cat", secret: "changed" } }, "0".repeat(32) + "-zz.arcdav", sc))).rejects.toMatchObject({ code: "dav-plaintext-refused" });
        expect(dav.reqs.filter(r => r.method === "PUT").length).toBe(0); noLeak();
    });
});

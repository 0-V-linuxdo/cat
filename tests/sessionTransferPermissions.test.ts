/* 会话传递的权限生命周期（DESIGN §6.4 P1–P15、P17；P16 oneClickPaste 不在本补丁范围，未实现；P18–P20 WebDAV 见 sessionTransferDavPermissions.test.ts）。
 * 走真实的 PluginManager / PluginCard.toggleWithFeedback / 真实插件定义；chrome 与 DOM 用 sessionTransferHarness 的内存假件。
 * Chrome 里才能验证的部分（真实授权弹窗、扩展重启后权限是否保留、paste 事件的 clipboardData）见 HEADED-TODO.md（⚠ 未验证）。 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { installChrome, installDom } from "./sessionTransferHarness";

const mem: Record<string, unknown> = {};
const ev = () => ({ addListener() { }, removeListener() { } });
const dom = installDom();
const T = installChrome();
const C = chrome as any;
C.runtime.onMessage = ev(); C.runtime.sendMessage = () => Promise.resolve();
C.storage = { local: { get: async (k: string) => (k in mem ? { [k]: mem[k] } : {}), set: async (o: Record<string, unknown>) => { Object.assign(mem, structuredClone(o)); } }, onChanged: ev() };
(globalThis as any).IS_DEV = false; (globalThis as any).VERSION = "test";
const clip = { writes: [] as string[], reads: 0 };
Object.defineProperty(globalThis.navigator, "clipboard", { configurable: true, value: { writeText: async (t: string) => { clip.writes.push(t); }, readText: async () => { clip.reads++; return ""; } } });
const unhandled: unknown[] = []; const onUnhandled = (e: unknown) => { unhandled.push(e); }; process.on("unhandledRejection", onUnhandled);
let timers = 0; const realST = globalThis.setTimeout, realSI = globalThis.setInterval;

const { setContext } = await import("../src/api/context");
const PM = await import("../src/api/PluginManager");
const { initSettings, PlainSettings } = await import("../src/api/Settings");
const { commands } = await import("../src/api/Commands");
const { siteControlSections } = await import("../src/api/Slots");
const { tr } = await import("../src/api/i18n");
const { PluginCard, toggleWithFeedback } = await import("../src/components/settings/PluginCard");
const { default: plugin } = await import("../src/plugins/sessionTransfer/index");
const { default: definePlugin } = await import("../src/utils/types");
const { Devs } = await import("../src/utils/constants");
const { decode, toToken, sealSC } = await import("../src/plugins/sessionTransfer/container");

const NAME = "SessionTransfer";
const CMDS = ["sessionTransfer.export", "sessionTransfer.import", "sessionTransfer.davExport", "sessionTransfer.davImport"]; // 后两条来自 WebDAV 补丁（子开关 webdavEnabled 默认关；开关与权限的关系见 sessionTransferDavPermissions.test.ts）
const load = async (saved: unknown) => {
    for (const k of Object.keys(PlainSettings.plugins)) delete PlainSettings.plugins[k];
    if (saved === undefined) delete mem.ArcSidebarSettings; else mem.ArcSidebarSettings = saved;
    await initSettings();
};
const tick = () => new Promise<void>(r => realST(r, 0));
const reset = async () => {
    PM.stopPlugin(plugin);
    for (const k of ["contains", "request", "remove"] as const) T.fc.perm[k] = 0;
    Object.assign(T.fc.perm, { granted: false, requestResult: true, removeArgs: [], requestArgs: [] });
    T.fc.cookiesApiTouches = 0; T.fc.exec.length = 0; T.fc.getAllCalls.length = 0; T.fc.setCalls.length = 0;
    clip.writes.length = 0; clip.reads = 0; dom.body.children = []; delete (globalThis as any).__arcDialogAuto;
    for (const k of Object.keys(mem)) if (k !== "ArcSidebarSettings") delete mem[k];
};
const cb = () => { const r = { msgs: [] as string[], changes: 0 }; return { r, cb: { onMessage: (m: string) => { r.msgs.push(m); }, onChange: () => { r.changes++; } } }; };
const toasts = () => dom.body.querySelectorAll(".arc-toast").map(t => t.textContent);

beforeAll(async () => {
    setContext("panel");
    PM.registerPlugin(plugin);
    await load(undefined);
    PM.initPluginManager();
    await PM.startAllPlugins();
});
afterAll(() => {
    delete PM.plugins[NAME]; delete PM.plugins.OtherCookies;
    for (const k of Object.keys(PlainSettings.plugins)) delete PlainSettings.plugins[k];
    process.off("unhandledRejection", onUnhandled); T.uninstall(); dom.uninstall();
    globalThis.setTimeout = realST; globalThis.setInterval = realSI;
});

describe("声明", () => {
    test("P1 manifest: cookies only in optional_permissions", () => {
        const m = JSON.parse(readFileSync("static/manifest.json", "utf8"));
        for (const p of ["cookies", "clipboardRead", "clipboardWrite"]) expect(m.permissions ?? []).not.toContain(p);
        expect(m.optional_permissions).toContain("cookies");
        expect(m.optional_permissions).not.toContain("clipboardRead");
        expect(m.optional_permissions).not.toContain("clipboardWrite");
        expect(m.host_permissions).toEqual(["<all_urls>"]);
        expect("optional_host_permissions" in m).toBe(false);
    });
    test("P2 declares star-key cookies only; default off; no background/content hooks", () => {
        expect(plugin.optionalPermissions).toEqual({ "*": ["cookies"] });
        expect(plugin.enabledByDefault).toBeFalsy();
        for (const k of ["background", "content", "page", "options"]) expect((plugin as unknown as Record<string, unknown>)[k]).toBeUndefined();
        expect(plugin.commands!.map(c => c.id)).toEqual(CMDS);
        for (const c of plugin.commands!) { expect((c as { defaultKey?: string }).defaultKey).toBeUndefined(); expect(c.context).toBe("panel"); }
    });
});

describe("启用 / 停用", () => {
    test("P3 enable requests cookies synchronously in the click (before any await), before togglePlugin", async () => {
        await reset(); await load(undefined);
        const { r, cb: callbacks } = cb();
        const card = PluginCard(PM.plugins[NAME]!, callbacks);
        const box = card.querySelector("input")! as unknown as { dispatch(t: string): unknown };
        T.fc.perm.requestResult = true;
        const e = box.dispatch("change");
        void e;
        // 同步栈内：request 已被调用，参数正确；插件此时还没被启用
        expect(T.fc.perm.request).toBe(1);
        expect(T.fc.perm.requestArgs[0]).toEqual({ permissions: ["cookies"] });
        expect(PM.isPluginEnabled(NAME)).toBe(false);
        expect(PlainSettings.plugins[NAME]?.enabled).toBeUndefined();
        await tick(); await tick();
        expect(PM.isPluginEnabled(NAME)).toBe(true);
        expect(r.msgs).toEqual([]);
    });
    test("P4 denied: toggle reverts and plugin stays off", async () => {
        await reset(); await load(undefined);
        T.fc.perm.requestResult = false;
        const { r, cb: callbacks } = cb();
        await toggleWithFeedback(PM.plugins[NAME]!, callbacks);
        expect(PM.isPluginEnabled(NAME)).toBe(false);
        expect(PM.plugins[NAME]!.started).toBe(false);
        expect(r.msgs).toEqual([tr("settings.permissionDenied")]); expect(r.changes).toBe(1);
        expect(PlainSettings.plugins[NAME]?.enabled).not.toBe(true);
        for (const id of CMDS) expect(!!commands.get(id)).toBe(false);
        expect(!!siteControlSections.get("sessionTransfer")).toBe(false);
        expect(await chrome.permissions.contains({ permissions: ["cookies"] })).toBe(false);
        expect(PluginCard(PM.plugins[NAME]!, callbacks).querySelector("input")!.checked).toBe(false); // 重绘后开关是关的
    });
    test("P5 request throws treated as denied, nothing starts, no unhandled rejection", async () => {
        await reset(); await load(undefined); unhandled.length = 0;
        T.fc.perm.requestResult = "throw";
        const { r, cb: callbacks } = cb();
        await toggleWithFeedback(PM.plugins[NAME]!, callbacks);
        await tick();
        expect(PM.isPluginEnabled(NAME)).toBe(false); expect(PM.plugins[NAME]!.started).toBe(false);
        expect(r.msgs).toEqual([tr("settings.permissionDenied")]);
        expect(unhandled).toEqual([]);
    });
    test("P6 granted: enables and starts; commands and site-controls section registered", async () => {
        await reset(); await load(undefined);
        const { r, cb: callbacks } = cb();
        await toggleWithFeedback(PM.plugins[NAME]!, callbacks);
        expect(PM.isPluginEnabled(NAME)).toBe(true); expect(PM.plugins[NAME]!.started).toBe(true);
        for (const id of CMDS) expect(!!commands.get(id)).toBe(true);
        expect(!!siteControlSections.get("sessionTransfer")).toBe(true);
        expect(r.msgs).toEqual([]);
    });
    test("P7 disable releases cookies; commands and section unloaded", async () => {
        await reset(); await load(undefined);
        await toggleWithFeedback(PM.plugins[NAME]!, cb().cb);
        expect(T.fc.perm.granted).toBe(true);
        await PM.togglePlugin(NAME, false); await tick(); await tick();
        expect(T.fc.perm.removeArgs).toEqual([{ permissions: ["cookies"] }]);
        expect(await chrome.permissions.contains({ permissions: ["cookies"] })).toBe(false);
        for (const id of CMDS) expect(!!commands.get(id)).toBe(false);
        expect(!!siteControlSections.get("sessionTransfer")).toBe(false);
        expect(PM.plugins[NAME]!.started).toBe(false);
    });
    test("P8 disable keeps permission shared by another enabled plugin", async () => {
        await reset(); await load(undefined);
        PM.registerPlugin(definePlugin({ name: "OtherCookies", description: "x", authors: [Devs.ArcSidebar], optionalPermissions: { "*": ["cookies"] } }));
        await toggleWithFeedback(PM.plugins[NAME]!, cb().cb);
        await PM.togglePlugin("OtherCookies", true);
        T.fc.perm.removeArgs.length = 0; T.fc.perm.remove = 0;
        await PM.togglePlugin(NAME, false); await tick(); await tick();
        expect(T.fc.perm.removeArgs.flatMap(a => a.permissions)).not.toContain("cookies");
        expect(T.fc.perm.granted).toBe(true);
        await PM.togglePlugin("OtherCookies", false); await tick();
        delete PM.plugins.OtherCookies;
    });
    test("P9 disabled plugin has zero footprint", async () => {
        await reset(); await load(undefined);
        const adds = { n: 0 }; const add = chrome.tabs.onUpdated.addListener; chrome.tabs.onUpdated.addListener = ((l: never) => { adds.n++; add(l); }) as never;
        globalThis.setTimeout = ((...a: never[]) => { timers++; return (realST as any)(...a); }) as never;
        globalThis.setInterval = ((...a: never[]) => { timers++; return (realSI as any)(...a); }) as never;
        timers = 0;
        await PM.startAllPlugins();
        globalThis.setTimeout = realST; globalThis.setInterval = realSI; chrome.tabs.onUpdated.addListener = add;
        expect(PM.plugins[NAME]!.started).toBe(false);
        expect(T.fc.cookiesApiTouches).toBe(0); expect(T.fc.exec.length).toBe(0); expect(adds.n).toBe(0);
        expect(T.fc.perm.contains + T.fc.perm.request + T.fc.perm.remove).toBe(0);
        expect(timers).toBe(0);
        expect(T.fc.downloads.length).toBe(0); expect(dom.body.children.length).toBe(0);
        expect(dom.head.children.filter(c => (c as { tag: string }).tag === "style").length).toBe(0);
    });
});

describe("启用但没有权限（备份恢复等绕过申请的路径）与重启", () => {
    const tab = () => T.addTab("https://app.example.com/");
    const seed = () => { T.fc.jar.push(T.ck({ name: "sid", value: "SECRET", domain: "app.example.com", httpOnly: true })); };
    const startEnabledNoPerm = async () => { await reset(); await load({ plugins: { [NAME]: { enabled: true } } }); T.fc.jar.length = 0; seed(); await PM.startAllPlugins(); };

    test("P10 enabled-without-permission is inert: guard asks contains then request in the gesture; denied → cookies never touched, toast, no errlog", async () => {
        await startEnabledNoPerm();
        expect(PM.plugins[NAME]!.started).toBe(true); // 启动不抛
        T.fc.perm.requestResult = false;
        const order: string[] = []; const c0 = C.permissions.contains, r0 = C.permissions.request;
        C.permissions.contains = (...a: unknown[]) => { order.push("contains"); return c0(...a); }; C.permissions.request = (...a: unknown[]) => { order.push("request"); return r0(...a); };
        const ui = await import("../src/plugins/sessionTransfer/ui");
        await ui.actCopy(tab());
        C.permissions.contains = c0; C.permissions.request = r0;
        expect(order).toEqual(["contains", "request"]);
        expect(T.fc.cookiesApiTouches).toBe(0); expect(T.fc.getAllCalls.length).toBe(0);
        expect(toasts()).toContain(tr("st.err.perm-denied"));
        expect(clip.writes).toEqual([]);
        expect(Object.keys(mem).some(k => /errlog/i.test(k))).toBe(false);
    });
    test("P11 enabled-without-permission recovers on re-grant", async () => {
        await startEnabledNoPerm();
        T.fc.perm.requestResult = true;
        const ui = await import("../src/plugins/sessionTransfer/ui");
        await ui.actCopy(tab());
        expect(T.fc.perm.request).toBe(1);
        expect(clip.writes.length).toBe(1);
        expect((await decode(clip.writes[0]!)).cookies.map(c => c.name)).toEqual(["sid"]);
    });
    test("P12 external revoke mid-session: every operation re-guards, no cached grant", async () => {
        await startEnabledNoPerm();
        T.fc.perm.granted = true;
        const ui = await import("../src/plugins/sessionTransfer/ui");
        await ui.actCopy(tab());
        expect(T.fc.perm.request).toBe(0); expect(clip.writes.length).toBe(1);
        const contains = T.fc.perm.contains;
        T.fc.perm.granted = false; T.fc.perm.requestResult = false; // 用户在 chrome://extensions 里撤销
        await ui.actCopy(tab());
        expect(T.fc.perm.contains).toBeGreaterThan(contains);
        expect(T.fc.perm.request).toBe(1); expect(clip.writes.length).toBe(1);
    });
    test("P13 restart consistency: settings on + permission → started; on without permission → started but inert; off + leftover permission → not started", async () => {
        await reset(); await load({ plugins: { [NAME]: { enabled: true } } }); T.fc.perm.granted = true;
        PM.stopPlugin(plugin); await PM.startAllPlugins();
        expect(PM.plugins[NAME]!.started).toBe(true);
        await reset(); await load({ plugins: { [NAME]: { enabled: true } } }); T.fc.perm.granted = false;
        await PM.startAllPlugins();
        expect(PM.plugins[NAME]!.started).toBe(true);
        expect(T.fc.cookiesApiTouches).toBe(0); // 启动本身不碰 cookies
        await reset(); await load({ plugins: { [NAME]: { enabled: false } } }); T.fc.perm.granted = true;
        await PM.startAllPlugins();
        expect(PM.plugins[NAME]!.started).toBe(false);
        expect(T.fc.cookiesApiTouches).toBe(0);
    });
});

describe("剪贴板", () => {
    const tab = () => T.addTab("https://app.example.com/");
    test("P14 clipboard write needs no permission request: writeText called, permissions.request 0", async () => {
        await reset(); await load({ plugins: { [NAME]: { enabled: true } } }); T.fc.perm.granted = true;
        T.fc.jar.length = 0; T.fc.jar.push(T.ck({ name: "sid", value: "v", domain: "app.example.com" }));
        await PM.startAllPlugins();
        const ui = await import("../src/plugins/sessionTransfer/ui");
        await ui.actCopy(tab());
        expect(clip.writes.length).toBe(1); expect(clip.writes[0]!.startsWith("sc:v2:")).toBe(true);
        expect(T.fc.perm.request).toBe(0); expect(clip.reads).toBe(0);
        const t = toasts()[0]!; expect(t).toContain(tr("st.copied")); expect(t).toContain(tr("st.risk")); // 风险提示随复制结果一起出现
    });
    test("P15 paste box is the only read path: no readText, no permission request; paste event auto-decodes into the confirm dialog; non-SC text → no-token", async () => {
        await reset(); await load({ plugins: { [NAME]: { enabled: true } } }); T.fc.perm.granted = true;
        await PM.startAllPlugins();
        const ui = await import("../src/plugins/sessionTransfer/ui");
        const token = toToken(await sealSC({ v: 2, o: "https://app.example.com", t: 1, l: { a: "1" }, s: {}, c: [{ name: "sid", value: "v", domain: "app.example.com", path: "/", secure: true, httpOnly: false, sameSite: "lax", hostOnly: true, session: true }] }));
        const asked: string[] = [];
        (globalThis as any).__arcDialogAuto = { confirm: (m: string) => { asked.push(m); return false; } }; // 在确认框处取消，不真的导入
        const done = ui.actPaste();
        const ta = dom.body.querySelector('[data-test="st-paste-input"]')!;
        expect(ta).not.toBeNull();
        expect(clip.reads).toBe(0); expect(T.fc.perm.request).toBe(0);
        const e = ta.dispatch("paste", { clipboardData: { getData: (t: string) => (t === "text" ? token : "") } });
        await done;
        expect(e.defaultPrevented).toBe(true); expect(ta.value).toBe("");
        expect(asked).toEqual([tr("st.confirmTitle")]);
        expect(dom.body.querySelector('[data-test="st-modal"]')).toBeNull(); // 粘贴框已关闭
        expect(T.fc.created.length).toBe(0); expect(T.fc.perm.request).toBe(0); expect(clip.reads).toBe(0);
        // 非 SC 令牌
        const done2 = ui.actPaste();
        dom.body.querySelector('[data-test="st-paste-input"]')!.dispatch("paste", { clipboardData: { getData: () => "hello world" } });
        await done2;
        expect(toasts()).toContain(tr("st.err.no-token"));
        expect(asked.length).toBe(1);
    });
});

describe("入口一致性", () => {
    test("P17 options page uses the same toggle path (toggleWithFeedback)", () => {
        const s = readFileSync("src/entries/options.ts", "utf8");
        expect(s).toMatch(/onchange: \(\) => void toggleWithFeedback\(/);
        const card = readFileSync("src/components/settings/PluginCard.ts", "utf8");
        expect(card).toMatch(/onchange: \(\) => void toggleWithFeedback\(p, cb\)/);
    });
});

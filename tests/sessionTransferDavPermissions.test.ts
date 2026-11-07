/* 会话传递 · WebDAV 子开关与权限（DESIGN §5A / §6.4 P18–P20）。
 * P18 子开关 webdavEnabled 只是功能开关：默认关、不在 optionalPermissions 里、开关它不触发任何 permissions.request / remove / contains（<all_urls> 已常驻，没有可申请的东西）。
 * P19 子开关关闭：命令零副作用（无 fetch、无 IndexedDB），面板没有 WebDAV 入口。
 * P20 关闭子开关（走真实 SettingField 的 onChange 路径）→ 清除凭据；重新打开是空配置。整插件停用不清凭据（已知限制，下面有特征化测试）。
 * ⚠ 真实 Chrome 里设置页 / 侧栏浮层的开关点击路径、重启后的状态 → HEADED-TODO.md H9。 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

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
const idb = { ops: [] as string[], map: new Map<string, unknown>() };
const fakeArea = {
    async get(k: string) { idb.ops.push(`get:${k}`); return idb.map.has(k) ? { [k]: structuredClone(idb.map.get(k)) } : {}; },
    async set(o: Record<string, unknown>) { idb.ops.push(`set:${Object.keys(o).join(",")}`); for (const [k, v] of Object.entries(o)) idb.map.set(k, structuredClone(v)); },
    async remove(k: string) { idb.ops.push(`remove:${k}`); idb.map.delete(k); },
};
const dav = new FakeDav();
let restoreFetch = () => { };
const tick = () => new Promise<void>(r => setTimeout(r, 0));
const until = async (f: () => unknown, ms = 3000) => { const t0 = Date.now(); while (!f()) { if (Date.now() - t0 > ms) throw new Error("timeout"); await tick(); } };

const { setContext } = await import("../src/api/context");
const PM = await import("../src/api/PluginManager");
const { initSettings, PlainSettings, SettingsStore } = await import("../src/api/Settings");
const { commands } = await import("../src/api/Commands");
const { tr } = await import("../src/api/i18n");
const { SettingField } = await import("../src/components/settings/SettingField");
const { toggleWithFeedback } = await import("../src/components/settings/PluginCard");
const { default: plugin } = await import("../src/plugins/sessionTransfer/index");
const { settings } = await import("../src/plugins/sessionTransfer/settings");
const Cfg = await import("../src/plugins/sessionTransfer/webdav/config");

const NAME = "SessionTransfer";
const load = async (saved: unknown) => {
    for (const k of Object.keys(PlainSettings.plugins)) delete PlainSettings.plugins[k];
    if (saved === undefined) delete mem.ArcSidebarSettings; else mem.ArcSidebarSettings = saved;
    await initSettings();
};
const toasts = () => dom.body.querySelectorAll(".arc-toast").map(t => t.textContent);
const resetPerm = () => { for (const k of ["contains", "request", "remove"] as const) T.fc.perm[k] = 0; T.fc.perm.removeArgs = []; T.fc.perm.requestArgs = []; };
const switchEl = () => {
    const f = SettingField(plugin, "webdavEnabled", plugin.settings!.def.webdavEnabled!, () => { })!;
    return (f as unknown as FakeEl).all().find(e => e.attrs.get("data-setting") === `${NAME}.webdavEnabled`)!;
};
const flip = (on: boolean) => { const el = switchEl(); el.checked = on; el.dispatch("change"); };

beforeAll(async () => { setContext("panel"); restoreFetch = dav.install(); Cfg.setConfigStore(fakeArea); PM.registerPlugin(plugin); await load(undefined); await PM.startAllPlugins(); });
afterAll(async () => {
    PM.stopPlugin(plugin);
    await SettingsStore.flush(); // 别让去抖的保存在别的测试文件里才落盘（会污染它们的设置）
    restoreFetch(); Cfg.setConfigStore(undefined);
    delete PM.plugins[NAME]; for (const k of Object.keys(PlainSettings.plugins)) delete PlainSettings.plugins[k]; T.uninstall(); dom.uninstall();
});

describe("P18 子开关只是功能开关", () => {
    test("声明：webdavEnabled 默认 false；optionalPermissions 仍只有 cookies；manifest 不变（<all_urls> 已常驻，没有 optional_host_permissions）", () => {
        const d = plugin.settings!.def.webdavEnabled!;
        expect(d.default).toBe(false);
        expect(settings.def.deleteAfterImport!.default).toBe(true); expect(settings.def.cleanupExpired!.default).toBe(true);
        expect(plugin.optionalPermissions).toEqual({ "*": ["cookies"] });
        const m = JSON.parse(readFileSync("static/manifest.json", "utf8"));
        expect(m.host_permissions).toEqual(["<all_urls>"]); expect("optional_host_permissions" in m).toBe(false);
        expect(m.optional_permissions).toEqual(expect.not.arrayContaining(["clipboardRead", "clipboardWrite"]));
        expect(m.permissions ?? []).not.toContain("cookies");
    });
    test("基础插件已启用后，开 / 关子开关各两次 → permissions.request / remove / contains 调用数为 0；cookies 权限保持授予", async () => {
        await load(undefined); T.fc.perm.granted = false; T.fc.perm.requestResult = true;
        await toggleWithFeedback(PM.plugins[NAME]!, { onMessage: () => { }, onChange: () => { } });
        expect(PM.isPluginEnabled(NAME)).toBe(true); expect(T.fc.perm.granted).toBe(true);
        resetPerm();
        flip(true); expect(settings.store.webdavEnabled).toBe(true);
        flip(false); flip(true); flip(false);
        await tick(); await tick();
        expect(T.fc.perm.request).toBe(0); expect(T.fc.perm.remove).toBe(0); expect(T.fc.perm.contains).toBe(0);
        expect(T.fc.perm.granted).toBe(true); expect(settings.store.webdavEnabled).toBe(false);
    });
    test("基础插件关闭时，子开关取值与权限互不影响（子开关不会替用户启用插件）", async () => {
        await PM.togglePlugin(NAME, false); await tick(); await tick(); resetPerm();
        flip(true); await tick();
        expect(PM.isPluginEnabled(NAME)).toBe(false); expect(T.fc.perm.request + T.fc.perm.remove + T.fc.perm.contains).toBe(0);
        flip(false); await tick();
    });
});

describe("P19 子开关关闭", () => {
    test("命令存在但执行 → 只弹「WebDAV 未启用」：0 次 fetch、0 次 IndexedDB 访问", async () => {
        await load({ plugins: { [NAME]: { enabled: false, webdavEnabled: false } } });
        T.fc.perm.granted = true; await PM.togglePlugin(NAME, true); expect(PM.plugins[NAME]!.started).toBe(true);
        dom.body.children = []; dav.reqs.length = 0; idb.ops.length = 0;
        for (const [i, id] of ["sessionTransfer.davExport", "sessionTransfer.davImport"].entries()) {
            const c = commands.get(id)!; expect(c).toBeTruthy(); expect(c.context).toBe("panel");
            await c.run(); await until(() => toasts().length > i);
            expect(toasts().at(-1)).toBe(tr("st.dav.disabled"));
        }
        expect(dav.reqs.length).toBe(0); expect(idb.ops).toEqual([]);
    });
    test("面板上没有 WebDAV 入口（通道 enabled() 为假）；打开子开关后才出现", async () => {
        const { renderSection } = await import("../src/plugins/sessionTransfer/section");
        const dts = () => { const b = new FakeEl("div"); renderSection(b as never, { id: 1, url: "https://a.example.com/" } as chrome.tabs.Tab, () => { }); return b.all().filter(e => e.tag === "button").map(e => e.attrs.get("data-test")!); };
        expect(dts().some(x => x.startsWith("st-dav-"))).toBe(false);
        settings.store.webdavEnabled = true;
        expect(dts().filter(x => x.startsWith("st-dav-"))).toEqual(["st-dav-export", "st-dav-import", "st-dav-config"]);
        settings.store.webdavEnabled = false;
    });
});

describe("P20 关闭子开关清除凭据", () => {
    const seed = () => Cfg.saveConfig({ url: dav.dirUrl, kind: "basic", user: "cat", secret: "pw-test" }, true);
    test("设置里关掉开关（真实 SettingField 路径）→ secret:sessionTransferDav 被删除（含记住的密码）；再打开是空配置", async () => {
        settings.store.webdavEnabled = true; await seed(); expect(idb.map.has(Cfg.DAV_KEY)).toBe(true);
        flip(false);
        await until(() => !idb.map.has(Cfg.DAV_KEY));
        expect(idb.ops).toContain(`remove:${Cfg.DAV_KEY}`);
        flip(true); await tick();
        expect(await Cfg.loadConfig()).toBeUndefined(); flip(false);
    });
    test("开着的时候点开关（再次设为开）不会清除", async () => {
        settings.store.webdavEnabled = true; await seed(); flip(true); await tick(); await tick();
        expect(idb.map.has(Cfg.DAV_KEY)).toBe(true); flip(false); await until(() => !idb.map.has(Cfg.DAV_KEY));
    });
    test("特征化（⚠ 已知限制，与 DESIGN 的差异）：整插件停用 / 设置被备份恢复改成关 → 不会清凭据（onChange 只在设置界面触发）；子开关关着时命令也不会读它", async () => {
        settings.store.webdavEnabled = true; await seed();
        await load({ plugins: { [NAME]: { enabled: true, webdavEnabled: false } } }); // 模拟恢复备份：绕过 SettingField
        await tick(); await tick();
        expect(idb.map.has(Cfg.DAV_KEY)).toBe(true);
        idb.ops.length = 0; const c = commands.get("sessionTransfer.davImport")!; await c.run(); await tick();
        expect(idb.ops).toEqual([]); // 但关着时不会读取
        await Cfg.clearConfig();
    });
});

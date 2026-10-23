import { beforeAll, describe, expect, mock, test } from "bun:test";

/* 极简 chrome.* 桩，用于测试核心（不依赖浏览器） */
const mem: Record<string, unknown> = {};
const ev = () => ({ addListener() { }, removeListener() { } });
(globalThis as any).IS_DEV = false;
(globalThis as any).VERSION = "test";
(globalThis as any).chrome = {
    runtime: { id: "test", onMessage: ev(), sendMessage: mock(() => Promise.resolve()) },
    storage: {
        local: {
            get: async (k: string) => (k in mem ? { [k]: mem[k] } : {}),
            set: async (o: Record<string, unknown>) => { Object.assign(mem, structuredClone(o)); },
        },
        onChanged: ev(),
    },
};

const { setContext } = await import("../src/api/context");
const PM = await import("../src/api/PluginManager");
const { initSettings, definePluginSettings, featureSettings, Settings, PlainSettings, SettingsStore, getStarredPlugins, togglePluginStarred } = await import("../src/api/Settings");
const { dispatch, subscribe } = await import("../src/api/Events");
const { commands } = await import("../src/api/Commands");
const { normalizeCombo } = await import("../src/api/Keys");
const { looksLikeUrl } = await import("../src/utils/misc");
const { registerUrlTransform, applyUrlTransforms, applyUrlTransformsDetailed } = await import("../src/api/UrlTransforms");
const { registerLinkRouter, resolveLinkRoute } = await import("../src/api/LinkRouting");
const { default: definePlugin, OptionType } = await import("../src/utils/types");

const log: string[] = [];
const A = ["Arc"];
const settings = definePluginSettings({ n: { type: OptionType.NUMBER, default: 3, description: "n" } }, { n: { isValid: (v: number) => v > 0 || "必须大于 0" } });
let changes = 0;
const base = definePlugin({ name: "Base", description: "", authors: A, background: { start: () => { log.push("base+"); return () => log.push("base-"); } } });
const child = definePlugin({
    name: "Child", description: "", authors: A, dependencies: ["Base"], settings, enabledByDefault: true,
    onSettingsChange: () => { changes++; },
    commands: [{ id: "child.cmd", label: "x", context: "background", run: () => 42 }],
    background: { start: () => { log.push("child+"); }, events: { refresh: () => log.push("refresh") } },
});
const off = definePlugin({ name: "Off", description: "", authors: A, background: { start: () => { log.push("off+"); } } });
const core = definePlugin({ name: "Core", description: "", authors: A, required: true });
const cmdApi = definePlugin({ name: "CommandsAPI", description: "", authors: A, hidden: true });
const featASettings = definePluginSettings({ x: { type: OptionType.NUMBER, default: 1, description: "x" } });
const featA = definePlugin({ name: "FeatA", description: "a", authors: A, enabledByDefault: true, settings: featASettings });
const featB = definePlugin({ name: "FeatB", description: "b", authors: A, enabledByDefault: false });
const featR = definePlugin({ name: "FeatR", description: "r", authors: A, required: true });
const group = definePlugin({ name: "Tabs", description: "", authors: A, required: true, features: [featA, featB, featR], settings: featureSettings([featA, featB, featR]) });

beforeAll(async () => {
    /* 旧版插件组设置 + 一个已删除插件的孤立设置 */
    mem.ArcSidebarSettings = { plugins: { FeatA: { enabled: false, x: 5 }, FeatB: { enabled: true }, FeatR: { enabled: false }, Removed: { enabled: true } } };
    setContext("background");
    for (const p of [core, cmdApi, base, child, off, group]) PM.registerPlugin(p);
    await initSettings();
    PM.initPluginManager();
    await PM.startAllPlugins();
});

describe("PluginManager（Void++ 语义）", () => {
    test("依赖先启动、默认关闭的不启动、依赖被标记 isDependency 并写入 enabled", () => {
        expect(log.slice(0, 2)).toEqual(["base+", "child+"]);
        expect(off.started).toBe(false);
        expect(base.isDependency).toBe(true);
        expect(PlainSettings.plugins.Base.enabled).toBe(true);
    });
    test("有插件声明 commands 时自动启用 CommandsAPI（同 Void++ neededApis）", () => {
        expect(cmdApi.isDependency).toBe(true);
        expect(cmdApi.started).toBe(true);
    });
    test("required / isDependency 的插件 togglePlugin 返回 null", async () => {
        expect(await PM.togglePlugin("Core", false)).toBeNull();
        expect(await PM.togglePlugin("Base", false)).toBeNull();
        expect(PM.dependentsOf("Base").map(p => p.name)).toEqual(["Child"]);
    });
    test("插件事件 / 命令随启停注册与注销", async () => {
        dispatch("refresh");
        expect(log).toContain("refresh");
        expect(commands.get("child.cmd")).toBeTruthy();
        expect(await PM.togglePlugin("Child", false)).toBe(false);
        expect(commands.get("child.cmd")).toBeUndefined();
        const before = log.length;
        dispatch("refresh");
        expect(log.length).toBe(before);
        expect(Settings.plugins.Child.enabled).toBe(false);
    });
    test("依赖方关闭后，被依赖插件可以关闭，清理函数执行", async () => {
        expect(base.isDependency).toBe(false);
        expect(await PM.togglePlugin("Base", false)).toBe(false);
        expect(log).toContain("base-");
    });
    test("启用插件", async () => {
        await PM.togglePlugin("Off", true);
        expect(off.started).toBe(true);
    });
    test("功能不是插件：开关与设置迁入所属插件，旧设置删除；必需功能无开关", () => {
        expect(PlainSettings.plugins.FeatA).toBeUndefined();
        expect(PlainSettings.plugins.FeatB).toBeUndefined();
        expect(PlainSettings.plugins.Tabs).toEqual({ FeatA: false, x: 5, FeatB: true });
        expect(featA.started).toBe(false);
        expect(featB.started).toBe(true);
        expect(featR.started).toBe(true);
        expect(Object.keys(group.settings!.def)).toEqual(["FeatA", "x", "FeatB"]);
        expect(featASettings.store.x).toBe(5);
        expect((group.settings!.checks as any).x?.disabled?.call(group.settings)).toBe(true);
    });
    test("改插件设置里的功能开关即启停功能；功能本身不能 togglePlugin", async () => {
        expect(await PM.togglePlugin("FeatA", true)).toBeNull();
        Settings.plugins.Tabs.FeatA = true;
        await new Promise(r => setTimeout(r, 0));
        expect(featA.started).toBe(true);
        Settings.plugins.Tabs.FeatB = false;
        await new Promise(r => setTimeout(r, 0));
        expect(featB.started).toBe(false);
        expect(featR.started).toBe(true);
    });
    test("清理已删除插件的孤立设置；登记 knownPlugins", () => {
        expect(PlainSettings.plugins.Removed).toBeUndefined();
        expect(Object.keys((PlainSettings.plugins.Settings as any).knownPlugins)).toContain("Child");
    });
    test("收藏插件", () => {
        togglePluginStarred("Off");
        expect(getStarredPlugins()).toEqual(["Off"]);
        togglePluginStarred("Off");
        expect(getStarredPlugins()).toEqual([]);
    });
});

describe("Settings / Events / utils", () => {
    test("definePluginSettings 默认值、写入、checks、前缀监听（onSettingsChange / use）", async () => {
        await PM.togglePlugin("Child", true);
        expect(settings.store.n).toBe(3);
        expect(PlainSettings.plugins.Child.n).toBeUndefined();
        let used = 0;
        const un = settings.use(() => used++, ["n"]);
        const before = changes;
        settings.store.n = 7;
        expect(settings.store.n).toBe(7);
        expect(settings.plain.n).toBe(7);
        expect(changes).toBe(before + 1);
        expect(used).toBe(1);
        un();
        expect(settings.checks.n?.isValid?.call(settings, 0)).toBe("必须大于 0");
        expect(SettingsStore.plain.plugins.Child.n).toBe(7);
    });
    test("subscribe 返回退订函数", () => {
        let hit = 0;
        const un = subscribe("refresh", () => hit++);
        dispatch("refresh"); un(); dispatch("refresh");
        expect(hit).toBe(1);
    });
    test("快捷键规范化", () => {
        expect(normalizeCombo("shift+ctrl+k")).toBe("Ctrl+Shift+K");
        expect(normalizeCombo("Alt+ArrowLeft")).toBe("Alt+ArrowLeft");
    });
    test("去追踪参数 / 网址识别", () => {
        expect(applyUrlTransforms("copy", "https://a.com/x?utm_source=1")).toBe("https://a.com/x?utm_source=1"); // 无插件：原样
        const c1 = registerUrlTransform("copy", u => u.replace(/[?&]utm_[^&]*/g, ""));
        const c2 = registerUrlTransform("copy", () => { throw new Error("boom"); });
        const c3 = registerUrlTransform("copy", u => u + "#z");
        expect(applyUrlTransforms("copy", "https://a.com/x?utm_source=1")).toBe("https://a.com/x#z"); // 按顺序、抛错跳过
        c1(); c2(); c3();
        expect(applyUrlTransforms("copy", "https://a.com/y")).toBe("https://a.com/y");
        const c5 = registerUrlTransform("copy", u => ({ url: u + "1", changed: true, toastKey: "k1" }));
        const c6 = registerUrlTransform("copy", u => ({ url: u + "2", changed: true, toastKey: "k2" }));
        expect(applyUrlTransformsDetailed("copy", "x")).toEqual({ url: "x12", changed: true, toastKey: "k2" });
        c5(); c6();
        // LinkRouting：第一个返回目标的路由器生效；抛错跳过；都不返回 → undefined（走默认）
        const ctx = { url: "https://a.com", source: "newTab" as const };
        expect(resolveLinkRoute(ctx)).toBeUndefined();
        const r1 = registerLinkRouter(() => { throw new Error("x"); });
        const r2 = registerLinkRouter(c => c.url.includes("a.com") ? { kind: "space", spaceId: "s1" } : undefined);
        const r3 = registerLinkRouter(() => ({ kind: "mostRecent" }));
        expect(resolveLinkRoute(ctx)).toEqual({ kind: "space", spaceId: "s1" });
        expect(resolveLinkRoute({ url: "https://b.com", source: "page" })).toEqual({ kind: "mostRecent" });
        r1(); r2(); r3();
        expect(resolveLinkRoute(ctx)).toBeUndefined();
        expect(looksLikeUrl("example.com/path")).toBe(true);
        expect(looksLikeUrl("hello world")).toBe(false);
    });
});


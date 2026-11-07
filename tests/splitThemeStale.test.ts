/* 补丁 6：分屏页启动以「当前系统明暗 / 当前 plugins.Spaces.mode」为准，侧栏关闭后遗留的 storage.session["splitTheme"] 旧值只能做首帧提示，
 * 与当前系统 / mode 不一致就丢弃。无 DOM：用假依赖驱动 subscribeTheme / publishTheme。动态 import，缺函数时每条各自失败。 */
import { test, expect } from "bun:test";

const T = () => import("../src/plugins/views/splitView/theme");
import type { SplitTheme as Rec } from "../src/plugins/views/splitView/theme";
const root = () => ({ dataset: {} as DOMStringMap });

function fakeEnv(init: { sysDark: boolean; mode: "auto" | "light" | "dark"; stored?: Rec }) {
    const st = { sysDark: init.sysDark, mode: init.mode, stored: init.stored as Rec | undefined };
    const sysL = new Set<() => void>(), modeL = new Set<() => void>(), sessL = new Set<(v: Rec | undefined) => void>();
    const obsL = new Set<() => void>(); const published: Rec[] = []; const deferred: (() => void)[] = [];
    const r = root();
    const deps: import("../src/plugins/views/splitView/theme").SplitDeps = {
        root: r,
        ctx: () => ({ sysDark: st.sysDark, mode: st.mode }),
        onSystem: (l: () => void) => { sysL.add(l); return () => sysL.delete(l); },
        onMode: (l: () => void) => { modeL.add(l); return () => modeL.delete(l); },
        session: {
            get: async () => st.stored,
            set: (v: Rec) => { published.push(v); },
            onChange: (l: (v: Rec | undefined) => void) => { sessL.add(l); return () => sessL.delete(l); },
        },
        observe: (l: () => void) => { obsL.add(l); return () => obsL.delete(l); },
        defer: (f: () => void) => { deferred.push(f); },
    };
    return {
        st, r, deps, published,
        flipSystem(dark: boolean) { st.sysDark = dark; for (const l of sysL) l(); },
        setMode(m: "auto" | "light" | "dark") { st.mode = m; for (const l of modeL) l(); },
        session(v: Rec | undefined) { for (const l of sessL) l(v); },
        attr(k: string, v?: string) { if (v === undefined) delete r.dataset[k]; else r.dataset[k] = v; for (const l of obsL) l(); },
        flush() { while (deferred.length) deferred.shift()!(); },
        counts: () => ({ sys: sysL.size, mode: modeL.size, sess: sessL.size, obs: obsL.size }),
    };
}
const tick = () => new Promise(r => setTimeout(r, 0));

// —— 纯函数 ——
test("baseTheme：auto 不钉（theme/bbDark 都空，交给 @media），light/dark 钉成 data-theme", async () => {
    const { baseTheme } = await T();
    expect(baseTheme("auto")).toEqual({ theme: null, bbDark: null });
    expect(baseTheme("light")).toEqual({ theme: "light", bbDark: null });
    expect(baseTheme("dark")).toEqual({ theme: "dark", bbDark: null });
});
test("isFresh：必须带戳且 sys、mode 都与当前一致；旧格式（无戳）一律不新鲜", async () => {
    const { isFresh } = await T();
    const ctx = { sysDark: false, mode: "auto" as const };
    expect(isFresh({ theme: "auto", bbDark: "0", sys: false, mode: "auto" }, ctx)).toBe(true);
    expect(isFresh({ theme: "auto", bbDark: "1", sys: true, mode: "auto" }, ctx)).toBe(false); // 系统已变
    expect(isFresh({ theme: "light", bbDark: "0", sys: false, mode: "light" }, ctx)).toBe(false); // mode 已变
    expect(isFresh({ theme: "auto", bbDark: "1" }, ctx)).toBe(false); // 旧格式
    expect(isFresh(null, ctx)).toBe(false);
    expect(isFresh(undefined, ctx)).toBe(false);
});
test("effectiveTheme：不新鲜 → 回到 baseTheme（丢弃）；新鲜 → 保留（Space 自定义主题仍可钉住与系统不同的明暗）", async () => {
    const { effectiveTheme } = await T();
    const stale = { theme: "auto", bbDark: "1", sys: true, mode: "auto" as const };
    expect(effectiveTheme(stale, { sysDark: false, mode: "auto" })).toEqual({ theme: null, bbDark: null });
    expect(effectiveTheme(stale, { sysDark: true, mode: "light" })).toEqual({ theme: "light", bbDark: null });
    const custom = { theme: "dark", bbDark: "1", sys: false, mode: "auto" as const }; // 浅色系统 + 深色自定义 Space 主题
    expect(effectiveTheme(custom, { sysDark: false, mode: "auto" })).toBe(custom);
});
test("stampTheme：给发布值盖上当时的系统明暗与 mode，不改 theme/bbDark", async () => {
    const { stampTheme } = await T();
    expect(stampTheme({ theme: "dark", bbDark: "1" }, { sysDark: false, mode: "auto" })).toEqual({ theme: "dark", bbDark: "1", sys: false, mode: "auto" });
});
test("splitModeFrom：Themes 功能关掉按 auto；非法值按 auto；读的是 plugins.Spaces.mode 同一份设置包", async () => {
    const { splitModeFrom } = await T();
    expect(splitModeFrom({ mode: "dark" })).toBe("dark");
    expect(splitModeFrom({ mode: "light", Themes: false })).toBe("auto");
    expect(splitModeFrom({ mode: "weird" })).toBe("auto");
    expect(splitModeFrom(undefined)).toBe("auto");
});
test("原有 API 不变：readTheme 只返回 {theme,bbDark}（不带戳）", async () => {
    const { readTheme } = await T();
    expect(readTheme({ dataset: { theme: "dark", bbDark: "1" } as DOMStringMap })).toEqual({ theme: "dark", bbDark: "1" });
});

// —— 分屏页 subscribeTheme ——
test("【核心】浅色系统 + 遗留的深色旧值（侧栏关闭后留下）→ 启动不信任：不钉 bbDark/theme（交给系统）", async () => {
    const { subscribeTheme } = await T();
    const e = fakeEnv({ sysDark: false, mode: "auto", stored: { theme: "auto", bbDark: "1", sys: true, mode: "auto" } });
    subscribeTheme(e.deps); await tick();
    expect(e.r.dataset.bbDark).toBeUndefined();
    expect(e.r.dataset.theme).toBeUndefined();
});
test("旧格式遗留值（升级前写下、无戳）同样丢弃", async () => {
    const { subscribeTheme } = await T();
    const e = fakeEnv({ sysDark: false, mode: "auto", stored: { theme: "dark", bbDark: "1" } });
    subscribeTheme(e.deps); await tick();
    expect(e.r.dataset.bbDark).toBeUndefined(); expect(e.r.dataset.theme).toBeUndefined();
});
test("mode 已改成 light：遗留的 auto 旧值丢弃，钉 data-theme=light（不是旧值）", async () => {
    const { subscribeTheme } = await T();
    const e = fakeEnv({ sysDark: true, mode: "light", stored: { theme: "auto", bbDark: "1", sys: true, mode: "auto" } });
    subscribeTheme(e.deps); await tick();
    expect(e.r.dataset.theme).toBe("light"); expect(e.r.dataset.bbDark).toBeUndefined();
});
test("新鲜旧值（系统、mode 都一致）仍作为首帧提示使用——自定义 Space 主题不丢", async () => {
    const { subscribeTheme } = await T();
    const e = fakeEnv({ sysDark: false, mode: "auto", stored: { theme: "dark", bbDark: "1", sys: false, mode: "auto" } });
    subscribeTheme(e.deps); await tick();
    expect(e.r.dataset.theme).toBe("dark"); expect(e.r.dataset.bbDark).toBe("1");
});
test("运行中系统切换：新鲜值变不新鲜 → 立即回到系统/mode（不重载）；侧栏随后发布新鲜值 → 再套用", async () => {
    const { subscribeTheme } = await T();
    const e = fakeEnv({ sysDark: true, mode: "auto", stored: { theme: "auto", bbDark: "1", sys: true, mode: "auto" } });
    subscribeTheme(e.deps); await tick();
    expect(e.r.dataset.bbDark).toBe("1");
    e.flipSystem(false);
    expect(e.r.dataset.bbDark).toBeUndefined();
    e.session({ theme: "auto", bbDark: "0", sys: false, mode: "auto" });
    expect(e.r.dataset.bbDark).toBe("0");
});
test("运行中 mode 切换同理；侧栏发布的旧戳值（mode 不符）不会被套用", async () => {
    const { subscribeTheme } = await T();
    const e = fakeEnv({ sysDark: false, mode: "auto" });
    subscribeTheme(e.deps); await tick();
    e.setMode("dark"); expect(e.r.dataset.theme).toBe("dark");
    e.session({ theme: "auto", bbDark: "0", sys: false, mode: "auto" }); // 戳是 auto，当前是 dark
    expect(e.r.dataset.theme).toBe("dark"); expect(e.r.dataset.bbDark).toBeUndefined();
});
test("不闪烁：值没变就不写 dataset；停止订阅会摘掉全部监听", async () => {
    const { subscribeTheme } = await T();
    const e = fakeEnv({ sysDark: false, mode: "auto", stored: { theme: "dark", bbDark: "1", sys: false, mode: "auto" } });
    let writes = 0; const ds = e.r.dataset as Record<string, string>; const store = { ...ds };
    e.r.dataset = new Proxy(store, { set(t, k, v) { writes++; (t as Record<string | symbol, unknown>)[k] = v; return true; } }) as DOMStringMap;
    const off = subscribeTheme(e.deps); await tick();
    const after = writes; e.flipSystem(false); e.setMode("auto"); e.session({ theme: "dark", bbDark: "1", sys: false, mode: "auto" });
    expect(writes).toBe(after);
    expect(e.counts()).toEqual({ sys: 1, mode: 1, sess: 1, obs: 0 });
    off(); expect(e.counts()).toEqual({ sys: 0, mode: 0, sess: 0, obs: 0 });
});

// —— 侧栏 publishTheme ——
test("侧栏发布带戳的值（当时的系统明暗 + mode）；值没变不重复写", async () => {
    const { publishTheme } = await T();
    const e = fakeEnv({ sysDark: false, mode: "auto" });
    publishTheme(e.deps);
    expect(e.published).toEqual([{ theme: null, bbDark: null, sys: false, mode: "auto" }]);
    e.attr("theme", "dark"); e.attr("bbDark", "1");
    expect(e.published.at(-1)).toEqual({ theme: "dark", bbDark: "1", sys: false, mode: "auto" });
    const n = e.published.length; e.attr("theme", "dark"); expect(e.published.length).toBe(n);
});
test("侧栏：系统明暗 / mode 变了也重发（延后一拍，等 Themes 先改完 data-theme），否则新戳缺席会让分屏页把有效值当旧值", async () => {
    const { publishTheme } = await T();
    const e = fakeEnv({ sysDark: false, mode: "auto" });
    publishTheme(e.deps); e.published.length = 0;
    e.flipSystem(true); expect(e.published.length).toBe(0); e.flush();
    expect(e.published).toEqual([{ theme: null, bbDark: null, sys: true, mode: "auto" }]);
    e.setMode("light"); e.flush();
    expect(e.published.at(-1)).toEqual({ theme: null, bbDark: null, sys: true, mode: "light" });
});
test("侧栏：返回的取消函数摘掉全部监听", async () => {
    const { publishTheme } = await T();
    const e = fakeEnv({ sysDark: false, mode: "auto" });
    const off = publishTheme(e.deps); expect(e.counts()).toEqual({ sys: 1, mode: 1, sess: 0, obs: 1 });
    off(); expect(e.counts()).toEqual({ sys: 0, mode: 0, sess: 0, obs: 0 });
});

// —— 接线 / 源码守卫 ——
test("splitView/index.ts 仍只是 publishTheme()/subscribeTheme() 调用（签名向后兼容：无参）", async () => {
    const src = await Bun.file(new URL("../src/plugins/views/splitView/index.ts", import.meta.url)).text();
    expect(src).toContain("panel: { start: () => publishTheme() }");
    expect(src).toContain("subscribeTheme()");
});
test("split.html 首帧底色：不再默认 #1e1e24（浅色系统首帧是深色）；默认 = SPLIT_LIGHT 的 --sv-page，深色靠既有 @media / data-theme 规则", async () => {
    const html = await Bun.file(new URL("../static/split.html", import.meta.url)).text();
    const { default: _s, SPLIT_LIGHT, SPLIT_DARK } = await import("../src/plugins/views/splitView/style");
    const page = (s: string) => /--sv-page: (#[0-9a-fA-F]+)/.exec(s)![1];
    const line = html.split("\n").find(l => l.includes("html, body { margin: 0"))!;
    expect(line).not.toContain("#1e1e24");
    expect(line).toContain(`background: ${page(SPLIT_LIGHT)}`);
    expect(html).toContain(`background: ${page(SPLIT_DARK)}`);
});
test("没有新增色值：split.html 里出现的 hex 都已存在于补丁前的文件", async () => {
    const html = await Bun.file(new URL("../static/split.html", import.meta.url)).text();
    const known = new Set(["#e7e5ee", "#1e2020", "#fff", "#2a2a33", "#3a3a45", "#eee", "#ccc"]);
    for (const m of html.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []) expect(known.has(m.toLowerCase())).toBe(true);
});

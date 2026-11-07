/* 补丁 rel66-postmessage-origin：宿主 → 侧栏 iframe 的 postMessage 只发给已握手的窗口（握手前 / 重挂后排队，ready 补发；不放宽 targetOrigin） */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { createFrameChannel, type FrameWindowLike } from "../src/plugins/inpageSidebar/frameChannel";

const ORIGIN = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";
/** 假窗口：模拟浏览器在 targetOrigin 与接收方源不一致时“不投递 + 往控制台记错误”（不抛） */
class FakeWin implements FrameWindowLike {
    got: unknown[] = []; consoleErrors: string[] = [];
    constructor(public origin: string) {}
    postMessage(m: unknown, target: string) { if (target !== "*" && target !== this.origin) { this.consoleErrors.push(`target origin ${target} != ${this.origin}`); return; } this.got.push(m); }
}
const setup = (w0: FakeWin | null, sameOrigin = false) => {
    const env = { win: w0 as FakeWin | null, same: sameOrigin, targets: [] as string[] };
    const wrap = () => env.win && ({ postMessage: (m: unknown, t: string) => { env.targets.push(t); env.win!.postMessage(m, t); }, __w: env.win } as unknown as FrameWindowLike);
    // win() 每次返回同一个对象（WindowProxy 身份）：按底层 FakeWin 缓存
    const cache = new Map<FakeWin, FrameWindowLike>();
    const ch = createFrameChannel({ win: () => { const w = env.win; if (!w) return null; if (!cache.has(w)) cache.set(w, wrap()!); return cache.get(w)!; }, origin: ORIGIN, sameOriginDoc: () => env.same });
    const proxy = (w: FakeWin) => { if (!cache.has(w)) { const s = env.win; env.win = w; ch.isReady(); env.win = s; } return cache.get(w)!; };
    return { env, ch, proxy };
};

describe("frameChannel：握手前排队", () => {
    test("iframe 还在初始 about:blank（页面源）：不发、不触发控制台错误；ready 后按顺序补发，同 key 只留最新", () => {
        const blank = new FakeWin("https://www.youtube.com");
        const { env, ch, proxy } = setup(blank, true);
        expect(ch.post("look", { flat: false })).toBe(false);
        expect(ch.post("idle", { idle: true })).toBe(false);
        expect(ch.post("look", { flat: true })).toBe(false);
        expect(blank.got).toEqual([]); expect(blank.consoleErrors).toEqual([]); expect(env.targets).toEqual([]);
        expect(ch.pendingKeys()).toEqual(["idle", "look"]); // 重新入队的 look 排到最后
        // 导航到扩展页（同一个 WindowProxy，源变为扩展源）→ 面板发 ready
        blank.origin = ORIGIN; env.same = false;
        expect(ch.ready({})).toBe(false); // 不是当前 contentWindow：忽略，队列保留
        expect(ch.pendingKeys()).toEqual(["idle", "look"]);
        expect(ch.ready(proxy(blank))).toBe(true);
        expect(blank.got).toEqual([{ idle: true }, { flat: true }]); expect(blank.consoleErrors).toEqual([]);
        expect(env.targets).toEqual([ORIGIN, ORIGIN]);
    });
    test("ready(当前窗口) → 补发队列、清空；之后直接发；targetOrigin 永远是扩展源", () => {
        const ext = new FakeWin(ORIGIN);
        const { env, ch, proxy } = setup(ext);
        ch.post("look", { flat: true }); ch.post("idle", { idle: false });
        expect(ext.got).toEqual([]);
        expect(ch.ready(proxy(ext))).toBe(true);
        expect(ext.got).toEqual([{ flat: true }, { idle: false }]); expect(ch.pendingKeys()).toEqual([]);
        expect(ch.isReady()).toBe(true);
        expect(ch.post("look", { flat: false })).toBe(true);
        expect(ext.got.at(-1)).toEqual({ flat: false });
        expect(env.targets.every(t => t === ORIGIN)).toBe(true); expect(ext.consoleErrors).toEqual([]);
    });
});

describe("frameChannel：源不匹配 / 窗口换了", () => {
    test("页面删掉宿主后重挂：contentWindow 换成新对象（初始 about:blank）→ 不发，排队；新窗口 ready 后补发", () => {
        const a = new FakeWin(ORIGIN);
        const { env, ch, proxy } = setup(a);
        ch.ready(proxy(a)); ch.post("look", { flat: true }); expect(a.got.length).toBe(1);
        const b = new FakeWin("https://www.youtube.com"); env.win = b; env.same = true; // 重挂后的新浏览上下文，还没导航
        expect(ch.isReady()).toBe(false);
        expect(ch.post("idle", { idle: true })).toBe(false); expect(ch.post("look", { flat: false })).toBe(false);
        expect(b.got).toEqual([]); expect(b.consoleErrors).toEqual([]); expect(a.got.length).toBe(1);
        expect(ch.ready(proxy(a))).toBe(false); // 旧窗口的 ready：不认
        b.origin = ORIGIN; env.same = false;
        expect(ch.ready(proxy(b))).toBe(true);
        expect(b.got).toEqual([{ idle: true }, { flat: false }]); expect(b.consoleErrors).toEqual([]);
    });
    test("同一窗口但文档又与页面同源（sameOriginDoc）→ 不发", () => {
        const a = new FakeWin(ORIGIN);
        const { env, ch, proxy } = setup(a);
        ch.ready(proxy(a)); env.same = true; a.origin = "https://x.test";
        expect(ch.post("look", { flat: true })).toBe(false); expect(a.consoleErrors).toEqual([]);
    });
    test("没有 iframe / reset：不发、不抛；reset 清队列和握手", () => {
        const { env, ch, proxy } = setup(null);
        expect(() => ch.post("look", 1)).not.toThrow(); expect(ch.ready({})).toBe(false);
        const a = new FakeWin(ORIGIN); env.win = a; ch.ready(proxy(a)); expect(a.got).toEqual([1]);
        ch.post("idle", 2); expect(a.got).toEqual([1, 2]);
        ch.reset(); expect(ch.isReady()).toBe(false); expect(ch.post("look", 3)).toBe(false); expect(a.got).toEqual([1, 2]);
        ch.reset(); expect(ch.pendingKeys()).toEqual([]);
    });
    test("postMessage 抛异常（窗口已销毁）：吞掉，返回 false", () => {
        const bad = { postMessage() { throw new Error("detached"); } };
        const ch = createFrameChannel({ win: () => bad, origin: ORIGIN });
        expect(ch.ready(bad)).toBe(true); expect(ch.post("look", 1)).toBe(false);
    });
    test("targetOrigin 不允许是 \"*\" / 空", () => {
        expect(() => createFrameChannel({ win: () => null, origin: "*" })).toThrow();
        expect(() => createFrameChannel({ win: () => null, origin: "" })).toThrow();
    });
});

describe("接线（源码扫描）", () => {
    const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    const c = strip(readFileSync(new URL("../src/plugins/inpageSidebar/content.ts", import.meta.url), "utf8"));
    const f = strip(readFileSync(new URL("../src/plugins/inpageSidebar/frameChannel.ts", import.meta.url), "utf8"));
    test("content.ts：宿主 → iframe 的 look / idle 只经 frameChannel；直接 contentWindow.postMessage 只剩 load 时的 ping（且先确认文档不与页面同源）", () => {
        expect(c).toMatch(/const postLook = \(\) => \{ frameChan\.post\("look"/); expect(c).toMatch(/const postIdle = \(idle: boolean\) => \{ frameChan\.post\("idle"/);
        const direct = c.match(/contentWindow\?\.postMessage\(/g) ?? []; expect(direct.length).toBe(1);
        expect(c).toMatch(/f\.addEventListener\("load", \(\) => \{ if \(iframe !== f \|\| f\.contentDocument\) return;/);
        expect(c).toMatch(/frameChan\.reset\(\); iframe\?\.remove\(\)/); // 销毁清握手
    });
    test("ready：来源 / 源校验在前，认定 e.source；重挂后的新窗口再次 ready 也会补发", () => {
        expect(c.indexOf("frameChan.ready(e.source)")).toBeGreaterThan(c.indexOf("e.origin !== frameOrigin"));
        expect(c).toMatch(/if \(!frameChan\.isReady\(\)\) \{ postLook\(\); if \(parked\) postIdle\(true\); frameChan\.ready\(e\.source\); \}/);
    });
    test("没有任何地方把 targetOrigin 放宽成 \"*\"（content.ts / frameChannel.ts）", () => {
        expect(c).not.toMatch(/postMessage\([^)]*,\s*"\*"\)/); expect(f).not.toMatch(/postMessage\([^)]*,\s*"\*"\)/);
        expect(f).toMatch(/w\.postMessage\(m, d\.origin\)/);
    });
});

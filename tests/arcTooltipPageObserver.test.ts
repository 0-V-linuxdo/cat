/* 补丁 arctooltip-page-observer（rel60，yt-perf REPORT.md「定位与修复」第 1 项）：
 * installTips() 在模块顶层执行；内容脚本 all_frames，以前会在每个网页（及每个子框架）的 document.documentElement 上挂整页
 * MutationObserver（subtree + childList + title/data-tip）。现在：
 *   ① 普通网页（location.protocol 不是 chrome-extension:）→ 不在 document 上装；
 *   ② 扩展页 → 照常装（scanTips(document) + 观察 documentElement）；
 *   ③ shadow root 里的提示（peek / capture 的 closed root）→ 照常由 arcTooltip() → watchRoot() 观察该 root，data-tip 照常挂上。
 * installed 标志与 watched 集合是模块级的，所以每个场景用 ?query 导入独立模块实例（同 inpageParkedTimersB.test.ts）。 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const MOD = resolve(import.meta.dir, "../src/components/ArcTooltip.ts");
type TT = typeof import("../src/components/ArcTooltip");
let n = 0;
const load = async () => (await import(`${MOD}?pageobs${++n}`)) as TT;

type Rec = { type: string; target: unknown; attributeName?: string | null; addedNodes?: unknown[] };
const g = globalThis as unknown as Record<string, unknown>;
const KEYS = ["document", "location", "MutationObserver", "ShadowRoot", "Element"] as const;
let saved: Record<string, unknown>;
let observed: { target: unknown; opts: MutationObserverInit; cb: (ms: Rec[]) => void }[];
let docScans: string[];
const docEl = { tagName: "HTML" };

class FakeMO {
    constructor(private cb: (ms: Rec[]) => void) { }
    observe(target: unknown, opts: MutationObserverInit) { observed.push({ target, opts, cb: this.cb }); }
    disconnect() { }
}
class FakeShadowRoot { appended: unknown[] = []; append(...x: unknown[]) { this.appended.push(...x); } }
/** 够 arcTooltip / applyTip / handleMutations 用的极简元素 */
class El {
    nodeType = 1; attrs = new Map<string, string>(); ls = new Map<string, unknown[]>(); parentElement: El | null = null;
    constructor(public tagName: string, private root: unknown, a: Record<string, string> = {}) { for (const [k, v] of Object.entries(a)) this.attrs.set(k, v); }
    getAttribute(k: string) { return this.attrs.get(k) ?? null; } hasAttribute(k: string) { return this.attrs.has(k); }
    setAttribute(k: string, v: string) { this.attrs.set(k, v); } removeAttribute(k: string) { this.attrs.delete(k); }
    addEventListener(t: string, f: unknown) { this.ls.set(t, [...(this.ls.get(t) ?? []), f]); }
    querySelectorAll() { return []; } getRootNode() { return this.root; } contains() { return false; }
}

beforeEach(() => {
    saved = Object.fromEntries(KEYS.map(k => [k, g[k]]));
    observed = []; docScans = [];
    g.document = {
        documentElement: docEl,
        querySelectorAll: (sel: string) => { docScans.push(sel); return []; },
        addEventListener: () => { },
    };
    g.MutationObserver = FakeMO; g.ShadowRoot = FakeShadowRoot; g.Element = El; // scanTips 对 addedNode 自身用 instanceof Element
});
afterEach(() => { for (const k of KEYS) { if (saved[k] === undefined) delete g[k]; else g[k] = saved[k]; } });

describe("shouldObserveDocument（纯函数）", () => {
    test("chrome-extension: → true；http / https / file / about → false；没有 location → true（保持原行为）", async () => {
        g.location = { protocol: "chrome-extension:" };
        const { shouldObserveDocument } = await load();
        expect(shouldObserveDocument({ protocol: "chrome-extension:" })).toBe(true);
        for (const p of ["https:", "http:", "file:", "about:", "data:"]) expect(shouldObserveDocument({ protocol: p })).toBe(false);
        expect(shouldObserveDocument(undefined)).toBe(true);
    });
});

describe("① 普通网页（内容脚本）：不在 document 上装 MutationObserver", () => {
    for (const protocol of ["https:", "http:"]) test(`${protocol} 页面：模块加载后没有任何观察者，也不扫 document`, async () => {
        g.location = { protocol, href: `${protocol}//www.youtube.com/watch?v=x` };
        const m = await load();
        expect(observed).toEqual([]);
        expect(docScans).toEqual([]);
        m.installTips(); // 再调也不装
        expect(observed).toEqual([]);
    });
});

describe("② 扩展页：照常安装", () => {
    test("chrome-extension: 页面：scanTips(document) + 观察 documentElement（subtree / childList / data-tip、title），只装一次", async () => {
        g.location = { protocol: "chrome-extension:", href: "chrome-extension://abc/sidepanel.html" };
        const m = await load();
        expect(observed.length).toBe(1);
        expect(observed[0]!.target).toBe(docEl);
        expect(observed[0]!.opts).toEqual({ subtree: true, childList: true, attributes: true, attributeFilter: ["data-tip", "title"] });
        expect(docScans).toEqual(["[data-tip]"]);
        m.installTips(); expect(observed.length).toBe(1);
    });
});

describe("③ 网页里的 shadow root：照常工作", () => {
    test("https 页面：shadow root 内 arcTooltip() → 观察该 root；之后插入的 data-tip 元素照常挂上 ArcTooltip", async () => {
        g.location = { protocol: "https:", href: "https://example.com/" };
        const { arcTooltip, HOST_ATTR } = await load();
        expect(observed).toEqual([]); // document 上没装
        const root = new FakeShadowRoot();
        const btn = new El("BUTTON", root);
        arcTooltip(btn as unknown as HTMLElement, "Close");
        expect(btn.hasAttribute(HOST_ATTR)).toBe(true);
        expect(btn.getAttribute("aria-label")).toBe("Close");
        expect(btn.ls.has("mouseenter")).toBe(true);
        expect(observed.length).toBe(1);
        expect(observed[0]!.target).toBe(root); // 只观察 shadow root，不是 document
        expect(observed[0]!.opts).toMatchObject({ subtree: true, childList: true });
        // 同一 root 再挂宿主：不重复观察
        arcTooltip(new El("BUTTON", root) as unknown as HTMLElement, "Split");
        expect(observed.length).toBe(1);
        // root 里新插入带 data-tip 的元素 → 观察者回调 → applyTip 消费 data-tip、挂 ArcTooltip
        const late = new El("BUTTON", root, { "data-tip": "Open as tab" });
        observed[0]!.cb([{ type: "childList", target: root, addedNodes: [late] }]);
        expect(late.hasAttribute("data-tip")).toBe(false);
        expect(late.hasAttribute(HOST_ATTR)).toBe(true);
        expect(late.getAttribute("aria-label")).toBe("Open as tab");
    });
    test("扩展页同样：document 一个 + shadow root 一个", async () => {
        g.location = { protocol: "chrome-extension:" };
        const { arcTooltip } = await load();
        const root = new FakeShadowRoot();
        arcTooltip(new El("BUTTON", root) as unknown as HTMLElement, "x");
        expect(observed.map(o => o.target)).toEqual([docEl, root]);
    });
});

test("源码：installTips 用 shouldObserveDocument() 门控，整页观察仍挂 documentElement", () => {
    const s = readFileSync(MOD, "utf8");
    expect(s).toContain("if (!shouldObserveDocument()) return;");
    expect(s).toContain('loc.protocol === "chrome-extension:"');
    expect(s).toContain("new MutationObserver(handleMutations).observe(document.documentElement, OBS_OPTS);");
});

/* 补丁 t903u-tab-switch v2：窗口级预热下，页内侧栏里点「已知普通页」的收藏 / 标签不发预热（原来：任何主键 pointerdown 都发 → 原生先开再关 = 闪现 ≈0.5 s）。
 * 受限页 / 判不出类型的已开标签 / 不是收藏或标签的位置：照发（手势内 open 原生链路不变）。
 * 纯逻辑直接测（假元素只实现 closest / getAttribute）；接线（panel.ts / TabRow / favorites / today / pinned）按源码约束测；真机 = headed（/workspace/rel58-bug-t903u/scripts/t903u.ts）。 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { createGestureGate } from "../src/plugins/inpageSidebar/gestureGate";
import { framePrewarmTargetOk, PW_ATTR, PW_NON_NAV, prewarmTargetNeedsNative, readPrewarmTarget } from "../src/plugins/inpageSidebar/prewarmTarget";

const SRC = resolve(import.meta.dir, "../src");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const code = (f: string) => strip(readFileSync(resolve(SRC, f), "utf8"));

/** 假 DOM：一个带属性的「行」+ 里面的子元素（closest 按 [attr] / 类名 / 标签名匹配，够用即可） */
type Fake = { attrs: Record<string, string>; cls?: string[]; tag?: string; parent?: Fake; getAttribute(n: string): string | null; closest(sel: string): Fake | null };
const matches = (el: Fake, one: string) => {
    one = one.trim(); const a = /^\[([\w-]+)\]$/.exec(one); if (a) return a[1]! in el.attrs;
    if (one.startsWith(".")) return (el.cls ?? []).includes(one.slice(1));
    return (el.tag ?? "div") === one;
};
const fake = (attrs: Record<string, string | null | undefined>, o: { cls?: string[]; tag?: string; parent?: Fake } = {}): Fake => {
    const clean: Record<string, string> = {}; for (const [k, v] of Object.entries(attrs)) if (v != null) clean[k] = v;
    const el: Fake = { attrs: clean, ...o, getAttribute: n => (n in clean ? clean[n]! : null), closest(sel) { for (let e: Fake | undefined = el; e; e = e.parent) if (sel.split(",").some(s => matches(e!, s))) return e; return null; } };
    return el;
};
/** 与 favorites/index.ts 写的属性同形 */
const favTile = (url: string, tab?: { id: number; url: string }) => fake({ "data-fav": "f1", [PW_ATTR.target]: "fav", [PW_ATTR.tab]: tab ? String(tab.id) : null, [PW_ATTR.tabUrl]: tab ? tab.url : null, [PW_ATTR.url]: url }, { tag: "button", cls: ["arc-fav-tile"] });
/** 与 TabRow 写的属性同形 */
const tabRow = (o: { tabId?: number; tabUrl?: string; url?: string; alt?: string }) => fake({ [PW_ATTR.target]: "tab", [PW_ATTR.tab]: o.tabId != null ? String(o.tabId) : null, [PW_ATTR.tabUrl]: o.tabId != null ? (o.tabUrl ?? "") : null, [PW_ATTR.url]: o.tabId == null ? o.url : null, [PW_ATTR.altUrl]: o.alt }, { cls: ["arc-tab", "arc-row"] });
const inside = (row: Fake, cls: string[] = ["arc-tab-title"], tag = "span") => fake({}, { parent: row, cls, tag });
const down = (target: unknown) => ({ type: "pointerdown", button: 0, isTrusted: true, target });

describe("回归 t903u v2：普通页目标不发预热（修复前：任何主键 pointerdown 都发）", () => {
    test("未打开的收藏 / 固定项：URL 是普通网页（github / youtube）→ 不发", () => {
        expect(framePrewarmTargetOk(down(favTile("https://github.com/")))).toBe(false);
        expect(framePrewarmTargetOk(down(inside(favTile("https://www.youtube.com/"), ["arc-fav-emoji"])))).toBe(false); // 点在磁贴里的子元素上
        expect(framePrewarmTargetOk(down(inside(tabRow({ url: "https://github.com/cat" }))))).toBe(false);
    });
    test("已打开的标签：按它此刻的 tab.url 判（普通页 → 不发），即使收藏保存的 URL 不同", () => {
        expect(framePrewarmTargetOk(down(favTile("chrome://extensions/", { id: 7, url: "https://github.com/x" })))).toBe(false); // 收藏的标签已导航到普通页
        expect(framePrewarmTargetOk(down(inside(tabRow({ tabId: 8, tabUrl: "https://www.youtube.com/watch?v=1" }))))).toBe(false);
    });
    test("整条手势链：gate 放行（主键、可信）→ 目标判定 = 普通页 → 不发；同一个 gate 下点受限页照发", () => {
        const gate = createGestureGate({ mac: false });
        const send = (e: ReturnType<typeof down>) => gate.accept(e, 10_000, false) && framePrewarmTargetOk(e);
        expect(send(down(favTile("https://github.com/")))).toBe(false);
        expect(send(down(favTile("chrome://extensions/")))).toBe(true);
    });
});

describe("受限页 / 判不出 → 照发（手势内 open 原生链路不变）", () => {
    test("受限页 URL：chrome:// / Web Store / PDF / chrome-extension / about:", () => {
        for (const u of ["chrome://extensions/", "https://chromewebstore.google.com/detail/x/abc", "https://example.com/a.pdf", "chrome-extension://abc/page.html", "about:blank", "edge://settings", "file:///Users/x/a.pdf"])
            expect(framePrewarmTargetOk(down(favTile(u)))).toBe(true);
        expect(framePrewarmTargetOk(down(tabRow({ tabId: 3, tabUrl: "chrome://settings/" })))).toBe(true);
    });
    test("已打开的标签判不出类型（tab.url 为空：未提交 / 刚丢弃 / 渲染端没给）→ 当受限页照发，哪怕收藏 URL 是普通页", () => {
        expect(framePrewarmTargetOk(down(favTile("https://github.com/", { id: 9, url: "" })))).toBe(true);
        expect(framePrewarmTargetOk(down(tabRow({ tabId: 10 })))).toBe(true);
        expect(framePrewarmTargetOk(down(tabRow({ tabId: 11, tabUrl: "not a url" })))).toBe(true);
    });
    test("没有 URL 的未开目标 / 偏离固定行的保存网址是受限页 → 照发", () => {
        expect(framePrewarmTargetOk(down(fake({ [PW_ATTR.target]: "fav" })))).toBe(true);
        expect(framePrewarmTargetOk(down(tabRow({ tabId: 12, tabUrl: "https://github.com/", alt: "chrome://settings/" })))).toBe(true);
        expect(framePrewarmTargetOk(down(tabRow({ tabId: 12, tabUrl: "https://github.com/", alt: "" })))).toBe(true); // 偏离行没有保存网址：判不出
        expect(framePrewarmTargetOk(down(tabRow({ tabId: 12, tabUrl: "https://github.com/", alt: "https://github.com/cat" })))).toBe(false);
    });
    test("rel62-frame-prewarm-navonly（①）：不是收藏 / 标签导航目标 → 不发（修前照发）——空白处、行内按钮（关闭 / 静音 / 偏离图标）、输入框、非激活键", () => {
        expect(framePrewarmTargetOk(down(fake({})))).toBe(false);
        expect(framePrewarmTargetOk(down(null))).toBe(false);
        const row = tabRow({ tabId: 5, tabUrl: "chrome://settings/" }); // 即使行本身是受限页：点在行内控件上也不算导航
        for (const c of ["arc-tab-close", "arc-audio", "arc-fav-btn"]) expect(framePrewarmTargetOk(down(inside(row, [c], "button")))).toBe(false);
        expect(framePrewarmTargetOk(down(inside(row, [], "input")))).toBe(false);
        expect(framePrewarmTargetOk(down(inside(row, [], "textarea")))).toBe(false);
        for (const key of ["a", "ArrowDown", "Tab", "Escape", "Meta", "r"]) expect(framePrewarmTargetOk({ type: "keydown", key, target: row })).toBe(false);
        expect(framePrewarmTargetOk({ type: "keydown", target: row })).toBe(false); // 没有 key
        expect(framePrewarmTargetOk({ type: "click", target: row })).toBe(false); // 只管 pointerdown / keydown
        expect(PW_NON_NAV).toContain(".arc-tab-close");
    });
    test("rel62 ①：site-controls / 复制链接 / 地址栏 / 命令栏 / 新建标签 / 设置按钮等 frame 控件（没有 data-pw-target）→ 不发（-18 / -34：首击被吞 + 翻成原生）", () => {
        for (const [cls, tag] of [["arc-site-controls", "button"], ["arc-copy-url", "button"], ["arc-urlbar", "div"], ["arc-cmdbar", "input"], ["arc-new-tab", "button"], ["arc-settings-btn", "button"]] as const) {
            const el = fake({}, { cls: [cls], tag }); expect([cls, framePrewarmTargetOk(down(el))]).toEqual([cls, false]);
            expect([cls, framePrewarmTargetOk(down(inside(el, ["arc-icon"], "svg")))]).toEqual([cls, false]); // 点在按钮里的图标上
            expect([cls, framePrewarmTargetOk({ type: "keydown", key: "Enter", target: el })]).toEqual([cls, false]);
        }
    });
    test("rel62 ①：受限 / 判不出的导航行照发（pointerdown 与 Enter / 空格同样）；普通页导航行不发", () => {
        const restricted = [favTile("chrome://settings/"), tabRow({ tabId: 7, tabUrl: "chrome://extensions/" }), tabRow({ tabId: 8, tabUrl: "" }), fake({ [PW_ATTR.target]: "fav" }), tabRow({ url: "chrome://history/" })];
        for (const r of restricted) { expect(framePrewarmTargetOk(down(r))).toBe(true); expect(framePrewarmTargetOk(down(inside(r)))).toBe(true); for (const key of ["Enter", " "]) expect(framePrewarmTargetOk({ type: "keydown", key, target: r })).toBe(true); }
        for (const r of [favTile("https://github.com/"), tabRow({ tabId: 9, tabUrl: "https://a.test/" })]) { expect(framePrewarmTargetOk(down(r))).toBe(false); expect(framePrewarmTargetOk({ type: "keydown", key: "Enter", target: r })).toBe(false); }
    });
    test("rel62 ①：源码约束——panel.ts 的 frame 手势仍先过 framePrewarmTargetOk 再发 MSG.prewarm；宿主页 content.ts 的预热不经过它（不变）", () => {
        const panel = code("plugins/inpageSidebar/panel.ts"); expect(panel).toMatch(/if \(!framePrewarmTargetOk\(e\)\) return;/);
        const content = code("plugins/inpageSidebar/content.ts"); expect(content).not.toContain("framePrewarmTargetOk"); expect(content).toMatch(/MSG\.prewarm|inpage:prewarm/);
        const pt = code("plugins/inpageSidebar/prewarmTarget.ts"); expect(pt).toMatch(/const t = readPrewarmTarget\(e\.target\); if \(!t\) return false;/); expect(pt).toMatch(/PW_ACTIVATE_KEYS: readonly string\[\] = \["Enter", " "\]/);
    });
    test("prewarmTargetNeedsNative / readPrewarmTarget 直接测", () => {
        expect(prewarmTargetNeedsNative(undefined)).toBe(true);
        expect(prewarmTargetNeedsNative({ url: "https://a.test/" })).toBe(false);
        expect(prewarmTargetNeedsNative({ tabId: 1, tabUrl: "https://a.test/", url: "chrome://x" })).toBe(false); // 已开：只看 tab.url
        expect(prewarmTargetNeedsNative({ tabId: 1, url: "https://a.test/" })).toBe(true); // 已开但 tab.url 缺失
        expect(readPrewarmTarget(favTile("https://a.test/", { id: 4, url: "https://b.test/" }))).toEqual({ tabId: 4, tabUrl: "https://b.test/", url: "https://a.test/" });
        expect(readPrewarmTarget(tabRow({ url: "https://a.test/" }))).toEqual({ url: "https://a.test/" });
        expect(readPrewarmTarget({})).toBeUndefined();
    });
});

describe("接线（源码约束）", () => {
    test("panel.ts：onGesture 里 gate.accept 之后、shouldSendPrewarm 之前同步判目标（无 await / 无 Promise），判为普通页直接 return（lastSent 不动）", () => {
        const pn = code("plugins/inpageSidebar/panel.ts"); const f = pn.slice(pn.indexOf("const onGesture"), pn.indexOf("NATIVE_SWITCH.viaClick"));
        const ia = f.indexOf("gestureGate.accept("), it = f.indexOf("if (!framePrewarmTargetOk(e)) return;"), is = f.indexOf("shouldSendPrewarm(");
        expect(ia).toBeGreaterThan(-1); expect(it).toBeGreaterThan(ia); expect(is).toBeGreaterThan(it);
        expect(f).not.toMatch(/await |\.then\(/);
        expect(f).toMatch(/lastSent = now; try \{ void Promise\.resolve\(chrome\.runtime\.sendMessage\(\{ type: MSG\.prewarm, source: "frame" \}\)\)/); // 发送本身（受限页的手势链）不变
    });
    test("prewarmTarget.ts：纯逻辑（不碰 chrome / document / console）", () => {
        const s = code("plugins/inpageSidebar/prewarmTarget.ts"); expect(s).not.toMatch(/chrome\.|document\.|console\./);
    });
    test("渲染端写属性：TabRow（已开 = tab.url，未开 = 网址，偏离 = 保存网址）；收藏磁贴（已开 = tab.url，另带收藏 URL）；今日 / 固定把 tab.url 传进 TabRow", () => {
        const tr = code("components/TabRow.ts"), fv = code("plugins/spaces/favorites/index.ts"), td = code("plugins/tabs/todayTabs/index.ts"), pt = code("plugins/tabs/pinnedTabs/index.ts");
        expect(tr).toMatch(/"data-pw-target": "tab", "data-pw-tab": p\.tabId != null \? String\(p\.tabId\) : null, "data-pw-tab-url": p\.tabId != null \? \(p\.tabUrl \?\? ""\) : null,/);
        expect(tr).toMatch(/"data-pw-url": p\.tabId == null \? \(p\.url \|\| null\) : null, "data-pw-alt-url": p\.drifted && p\.onIconClick \? \(p\.savedUrl \?\? ""\) : null,/);
        expect(fv).toMatch(/"data-pw-target": "fav", "data-pw-tab": tab\?\.id != null \? String\(tab\.id\) : null, "data-pw-tab-url": tab\?\.id != null \? \(tab\.url \|\| tab\.pendingUrl \|\| ""\) : null, "data-pw-url": f\.url \|\| null,/);
        expect(td).toMatch(/tabId: t\.id, tabUrl: t\.url \|\| t\.pendingUrl \|\| "",/);
        expect(pt).toMatch(/tabId: tab\?\.id, tabUrl: tab \? \(tab\.url \|\| tab\.pendingUrl \|\| ""\) : undefined,/);
        for (const [k, v] of Object.entries(PW_ATTR)) expect(`${k}:${v}`).toMatch(/^\w+:data-pw-/);
    });
});

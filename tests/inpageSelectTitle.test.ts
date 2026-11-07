/* 补丁 inpage-select-title：设置页 SELECT 下拉按钮的文字是单行省略号（.arc-dropdown-label），按钮只有 160px 可用宽，
 * window 项 zh 要 342px / en 要 450px → 当前值被截断且没有任何提示（i54 shots-b8：buttonLabel client 160 / scroll 342|450、truncatedByEllipsis、title / aria-label 都为 null）。
 * 修法：Dropdown 加 tipShown，按钮 data-tip = 当前选中项的完整显示文案（与按钮文字同源 dropdownShownLabel）；SettingField 的 SELECT 打开它。
 * 提示走 data-tip（ArcTooltip，会补 aria-label），不写原生 title（selftest「没有元素同时带原生 title 和 Cat/Arc 提示」）。布局 / 标签文案都不改。
 * bun 无 jsdom：Dropdown 用一个极小的假 document 真实构造（先 import、后装假 document、测完还原，不影响别的测试文件）。 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { setLang } from "../src/api/i18n";
import { dropdownShownLabel, Dropdown } from "../src/components/Menu";
import { selectShown } from "../src/components/settings/selectShown";
import { STRINGS } from "../src/plugins/inpageSidebar/i18n";
import { settings } from "../src/plugins/inpageSidebar/settings";

/* 极小假 DOM：只实现 Dropdown / h() / icon() / openMenu 用到的成员；点击菜单项用 clicks 里登记的回调触发（openMenu 的 build 会给每个 .arc-menu-item 加 click 监听） */
class FakeEl {
    attrs = new Map<string, string>(); dataset: Record<string, string> = {}; children: unknown[] = []; className = ""; textContent = ""; innerHTML = "";
    listeners = new Map<string, Function[]>(); style: Record<string, string> = {}; offsetWidth = 100; offsetHeight = 20; isConnected = true;
    classes = new Set<string>();
    classList = { add: (...c: string[]) => c.forEach(x => this.classes.add(x)), remove: (...c: string[]) => c.forEach(x => this.classes.delete(x)), contains: (c: string) => this.classes.has(c) };
    constructor(public tagName: string) { }
    setAttribute(k: string, v: string) { this.attrs.set(k, v); if (k === "class") this.className = v; }
    getAttribute(k: string) { return this.attrs.get(k) ?? null; }
    hasAttribute(k: string) { return this.attrs.has(k); }
    removeAttribute(k: string) { this.attrs.delete(k); }
    addEventListener(t: string, f: Function) { (this.listeners.get(t) ?? this.listeners.set(t, []).get(t)!).push(f); }
    appendChild(c: unknown) { this.children.push(c); return c; }
    append(...c: unknown[]) { this.children.push(...c); }
    replaceChildren(...c: unknown[]) { this.children = c; }
    querySelector() { return null; } querySelectorAll() { return []; } contains() { return false; } focus() { } remove() { }
    getBoundingClientRect() { return { left: 0, bottom: 20, width: 160, height: 20, top: 0, right: 160 }; }
    fire(t: string) { for (const f of this.listeners.get(t) ?? []) f({ stopPropagation() { }, preventDefault() { }, target: this }); }
}
const fakeDoc = {
    createElement: (t: string) => new FakeEl(t), createElementNS: (_ns: string, t: string) => new FakeEl(t), createTextNode: (s: string) => ({ nodeValue: s }),
    documentElement: { lang: "" }, querySelectorAll: () => [], body: new FakeEl("body"), activeElement: null, addEventListener() { },
};
const fakeWin = { innerWidth: 1492, innerHeight: 859, addEventListener() { } };
const g = globalThis as unknown as Record<string, unknown>;
const saved: Record<string, { had: boolean; v: unknown }> = {};
beforeAll(() => { for (const [k, v] of [["document", fakeDoc], ["window", fakeWin]] as const) { saved[k] = { had: k in g, v: g[k] }; g[k] = v; } });
afterAll(() => { for (const [k, { had, v }] of Object.entries(saved)) { if (had) g[k] = v; else delete g[k]; } setLang("en"); });

const opts = (settings.def as unknown as Record<string, { options: { label: string; short?: string; value: string; default?: boolean }[] }>).prewarm!.options;
const labelOf = (L: "en" | "zh", v: string) => (STRINGS[L] as Record<string, string>)[opts.find(o => o.value === v)!.label]!;
/** 补丁 inpage-settings-copy-fix：按钮上的文字 = 选中项的 short（有的话）否则整句；data-tip / 菜单项仍是整句 */
const btnTextOf = (L: "en" | "zh", v: string) => { const o = opts.find(x => x.value === v)! as { label: string; short?: string }; return o.short ? (STRINGS[L] as Record<string, string>)[o.short]! : labelOf(L, v); };
const tipOf = (b: FakeEl) => b.getAttribute("data-tip");
const dd = (value: unknown, o: { label: string; value: string }[] = opts, extra: Record<string, unknown> = {}) =>
    Dropdown({ options: o, value: value as string, onChange: () => { }, tipShown: true, ...extra }) as unknown as FakeEl;
const labelSpan = (b: FakeEl) => b.children[0] as FakeEl;
/** 打开菜单并点第 i 项（用 Menu.ts 自己的 openMenu/build，经假 DOM）：返回被点的菜单项 test 名 */
const clickOption = async (b: FakeEl, value: string) => {
    b.fire("click");
    const menu = (fakeDoc.body.children.at(-1)) as FakeEl; const items = menu.children as FakeEl[];
    const it = items.find(x => x.getAttribute("data-test") === `option:${value}`)!; it.fire("click");
    await Promise.resolve(); await Promise.resolve();
};

describe("dropdownShownLabel：与按钮文字同源，无匹配 → 空串", () => {
    for (const L of ["zh", "en"] as const) {
        test(`${L}：window / off 返回完整显示文案（= i18n 表里的整句，未截断、未换成短标签）`, () => {
            setLang(L);
            expect(dropdownShownLabel(opts, "window")).toBe(labelOf(L, "window"));
            expect(dropdownShownLabel(opts, "off")).toBe(labelOf(L, "off"));
            expect(labelOf(L, "window").length).toBeGreaterThan(labelOf(L, "off").length); // 长文案才是被截断的那个
            expect(labelOf(L, "window").length).toBeGreaterThan(20);
        });
    }
    test("无匹配 / 空值 / 空选项 / 标签键缺失 → \"\"（不是 \"undefined\" / \"null\"）", () => {
        setLang("en");
        for (const bad of [undefined, null, "", "tab", "WINDOW", 0, false, NaN]) expect(dropdownShownLabel(opts, bad)).toBe("");
        expect(dropdownShownLabel([], "window")).toBe("");
        expect(dropdownShownLabel([{ label: undefined as unknown as string, value: "x" }], "x")).toBe("");
        expect(dropdownShownLabel([{ label: "no.such.key", value: "x" }], "x")).toBe("no.such.key"); // tr 的既有行为：键缺失原样返回，与按钮文字一致
    });
});

describe("Dropdown（假 DOM）：tipShown → 按钮 data-tip = 当前选中项完整文案", () => {
    for (const L of ["zh", "en"] as const) {
        test(`${L}：window 选中 → data-tip 是整句、按钮文字是短标签；off 选中 → 都是 off 文案（没有 short）`, () => {
            setLang(L);
            const w = dd("window"); expect(tipOf(w)).toBe(labelOf(L, "window")); expect(labelSpan(w).textContent).toBe(btnTextOf(L, "window")); expect(labelSpan(w).textContent).not.toBe(tipOf(w)!);
            const o = dd("off"); expect(tipOf(o)).toBe(labelOf(L, "off")); expect(labelSpan(o).textContent).toBe(tipOf(o)!);
        });
    }
    test("经 selectShown 的旧值（\"tab\" 等）：按钮显示 off → 提示也是 off 的完整文案，和按钮文字一致", () => {
        setLang("zh");
        for (const stored of ["tab", "bogus", undefined, null, true, 0]) {
            const b = dd(selectShown<unknown>(opts, stored)); expect(tipOf(b)).toBe(labelOf("zh", "off")); expect(labelSpan(b).textContent).toBe(tipOf(b)!);
        }
    });
    test("选中项变化：点开菜单选另一项 → 按钮文字与 data-tip 一起变（zh / en），onChange 照常收到新值", async () => {
        for (const L of ["zh", "en"] as const) {
            setLang(L); const calls: string[] = [];
            const b = Dropdown({ options: opts, value: "off", onChange: v => calls.push(v), tipShown: true }) as unknown as FakeEl;
            expect(tipOf(b)).toBe(labelOf(L, "off"));
            await clickOption(b, "window"); expect(calls).toEqual(["window"]);
            expect(tipOf(b)).toBe(labelOf(L, "window")); expect(labelSpan(b).textContent).toBe(btnTextOf(L, "window")); expect(b.dataset.value).toBe("window");
            await clickOption(b, "off"); expect(calls).toEqual(["window", "off"]);
            expect(tipOf(b)).toBe(labelOf(L, "off")); expect(labelSpan(b).textContent).toBe(labelOf(L, "off"));
        }
    });
    test("没有可显示的文案：不出现 data-tip（更不会是 \"undefined\"）；空选项 / 值无匹配", () => {
        setLang("en");
        for (const b of [dd("zzz"), dd(undefined), dd("x", []), dd(undefined, [])]) { expect(b.hasAttribute("data-tip")).toBe(false); expect(labelSpan(b).textContent).toBe(""); }
        for (const b of [dd("zzz"), dd(undefined)]) for (const k of ["data-tip", "title", "aria-label"]) expect(b.getAttribute(k)).not.toBe("undefined");
    });
    test("不开 tipShown：行为同旧版（无 data-tip）；给了 title：title 优先（category 下拉不变）", () => {
        setLang("en");
        const plain = Dropdown({ options: opts, value: "window", onChange: () => { } }) as unknown as FakeEl; expect(plain.hasAttribute("data-tip")).toBe(false);
        const withTitle = dd("window", opts, { title: "Category" }); expect(tipOf(withTitle)).toBe("Category");
        const noTitle = Dropdown({ options: opts, value: "window", onChange: () => { } }) as unknown as FakeEl; expect(noTitle.getAttribute("title")).toBeNull();
    });
    test("不写原生 title / 不写 aria-label（aria-label 由 ArcTooltip 按 data-tip 自动补）", () => {
        setLang("zh"); const b = dd("window");
        expect(b.hasAttribute("title")).toBe(false); expect(b.hasAttribute("aria-label")).toBe(false);
        expect(b.getAttribute("class")).toBeNull(); expect(b.className).toBe("arc-field arc-dropdown"); // 样式 / 布局类不变
    });
});

describe("源码接线（布局 / 存储语义不变）", () => {
    const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    const rd = (p: string) => strip(readFileSync(resolve(import.meta.dir, "..", p), "utf8"));
    test("Menu.ts：data-tip 来自 dropdownShownLabel（整句）、按钮文字来自 dropdownButtonLabel（short 优先）；sync 里只在 tipShown 且无 title 时写 data-tip；CSS 没动", () => {
        const m = rd("src/components/Menu.ts");
        expect(m).toContain("const shown = dropdownShownLabel(opts.options, value);"); expect(m).toContain("text.textContent = dropdownButtonLabel(opts.options, value);");
        expect(m).toContain('if (opts.tipShown && !opts.title && shown) btn.setAttribute("data-tip", shown);');
        expect(m).not.toMatch(/\.title\s*=|"title"\s*:|setAttribute\("title"/); // 不写原生 title
        const css = readFileSync(resolve(import.meta.dir, "../static/sidepanel.css"), "utf8");
        expect(css).toContain(".arc-dropdown .arc-dropdown-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }"); // 仍是省略号单行：不改布局
    });
    test("SettingField：SELECT 打开 tipShown；value 仍是 selectShown(...)，set 仍原样写入", () => {
        const sf = rd("src/components/settings/SettingField.ts");
        expect(sf).toContain("Dropdown({ options: d.options, value: selectShown(d.options, cur), onChange: set, disabled: dis, tipShown: true })");
    });
    test("别处的 Dropdown（插件分类 / 列表过滤）不受影响：不带 tipShown", () => {
        for (const f of ["src/entries/options.ts", "src/plugins/_core/pluginSettings/index.ts"]) expect(rd(f)).not.toContain("tipShown");
    });
});

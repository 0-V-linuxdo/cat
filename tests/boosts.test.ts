import { describe, expect, test } from "bun:test";
import { activeBoostsFor, assembleCss, boostMatches, cannotShareReason, colorActionFor, decodeShare, defaultWheel, encodeShare, isComplementary, wheelToMatrixInput, newBoost, secondaryHue, shuffleWheel, type Boost } from "../src/plugins/boosts/model";
import { isGibberish, partsFor, selectorForRelated, selectorForThis, type ElLike } from "../src/plugins/boosts/selector";

/* 极简 DOM：支持 tag / #id / .class / [attr="v"] / tag:nth-child(n)，以及空格、> 组合 */
interface N extends ElLike { tagName: string; id: string; classList: string[]; attributes: { name: string; value: string }[]; parentElement: N | null; children: N[] }
function el(tag: string, a: { id?: string; cls?: string; attrs?: Record<string, string> } = {}, ...kids: N[]): N {
    const n: N = { tagName: tag.toUpperCase(), id: a.id ?? "", classList: a.cls ? a.cls.split(" ") : [], attributes: Object.entries(a.attrs ?? {}).map(([name, value]) => ({ name, value })), parentElement: null, children: kids };
    for (const k of kids) k.parentElement = n;
    return n;
}
const all = (r: N): N[] => [r, ...r.children.flatMap(all)];
function simple(n: N, s: string): boolean {
    const m = s.match(/^([a-z][\w-]*)?(.*)$/i)!;
    if (m[1] && n.tagName.toLowerCase() !== m[1].toLowerCase()) return false;
    for (const p of m[2].match(/#[\w-]+|\.[\w-]+|\[[^\]]+\]|:nth-child\(\d+\)/g) ?? []) {
        if (p[0] === "#" && n.id !== p.slice(1)) return false;
        if (p[0] === "." && !n.classList.includes(p.slice(1))) return false;
        if (p[0] === "[") { const [k, v] = p.slice(1, -1).split("="); if (n.attributes.find(x => x.name === k)?.value !== JSON.parse(v)) return false; }
        if (p.startsWith(":nth")) if ((n.parentElement?.children.indexOf(n) ?? -1) + 1 !== Number(p.match(/\d+/)![0])) return false;
    }
    return true;
}
function matches(n: N, sel: string): boolean {
    const toks = sel.replace(/\s*>\s*/g, " > ").trim().split(/\s+/);
    const go = (cur: N | null, i: number): boolean => {
        if (!cur || !simple(cur, toks[i])) return false;
        if (i === 0) return true;
        if (toks[i - 1] === ">") return go(cur.parentElement, i - 2);
        for (let a = cur.parentElement; a; a = a.parentElement) if (go(a, i - 1)) return true;
        return false;
    };
    return go(n, toks.length - 1);
}
const counter = (root: N) => (sel: string) => all(root).filter(n => matches(n, sel)).length;

describe("选择器生成", () => {
    const ad1 = el("div", { cls: "promo-card x9k2jq7" }), ad2 = el("div", { cls: "promo-card" }), ad3 = el("div", { cls: "promo-card" });
    const btn = el("button", { attrs: { "aria-label": "Close" } });
    const tid = el("span", { attrs: { "data-testid": "sidebar-trending" } });
    const plain2 = el("p"), plain1 = el("p");
    const main = el("main", { id: "content" }, ad1, ad2, ad3, btn, tid, el("section", {}, plain1, plain2));
    const root = el("html", {}, el("body", {}, main));
    const count = counter(root);

    test("乱码判定", () => {
        expect(isGibberish("x9k2jq7")).toBe(true);
        expect(isGibberish("fooBar")).toBe(false);
        expect(isGibberish("cssXyZ")).toBe(true);
        expect(isGibberish("promo-card")).toBe(false);
        expect(isGibberish("bcdfgh")).toBe(true);
    });
    test("data-testid 优先", () => expect(selectorForThis(tid, count)).toBe('[data-testid="sidebar-trending"]'));
    test("aria-label", () => expect(selectorForThis(btn, count)).toBe('button[aria-label="Close"]'));
    test("#id", () => expect(selectorForThis(main, count)).toBe("#content"));
    test("无语义时退到唯一的 nth-child 路径，且稳定", () => {
        const s = selectorForThis(plain2, count);
        expect(count(s)).toBe(1);
        expect(matches(plain2, s)).toBe(true);
        expect(selectorForThis(plain2, count)).toBe(s);
    });
    test("乱码类名不进候选的前列", () => expect(partsFor(ad1)[0].sel).toBe(".promo-card"));
    test("相关元素：语义类名，2..100 个", () => expect(selectorForRelated(ad2, count)).toBe(".promo-card"));
    test("没有相关元素时返回 null", () => expect(selectorForRelated(tid, count)).toBeNull());
    test("特殊字符转义", () => expect(partsFor(el("div", { id: "a:b" }))[0].sel).toBe("#a\\:b"));
});

const B = (o: Partial<Boost> = {}): Boost => ({ ...newBoost("example.com", 1, "b1"), ...o });

describe("CSS 组装", () => {
    test("空 Boost 不产生 CSS", () => expect(assembleCss(B())).toBe(""));
    test("Zap 用 display:none !important", () => expect(assembleCss(B({ zaps: [".ad", "#x"] }))).toBe(".ad,\n#x { display: none !important; }"));
    test("丢弃含花括号的 Zap（防注入）", () => expect(assembleCss(B({ zaps: ["a{}", " "] }))).toBe(""));
    test("字体规则跳过图标字体，并转义引号", () => {
        expect(assembleCss(B({ font: { type: "custom", family: 'Inter"; }' } }))).toBe('*:not(i, .material-symbols-outlined, .material-icons) { font-family: "Inter; }" !important; }');
    });
    test("顺序：font → zaps → 颜色 → 用户 CSS", () => {
        const css = assembleCss(B({ css: "body{color:red}", zaps: [".a"], font: { type: "custom", family: "Inter" }, colorScheme: { type: "colorWheelDriven", ...defaultWheel(), primaryHueDegrees: 90 } }));
        const idx = ["font-family", "display: none", "body{color:red}"].map(s => css.indexOf(s));
        expect(idx.every(i => i >= 0)).toBe(true);
        expect([...idx].sort((a, b) => a - b)).toEqual(idx);
    });
});

describe("站点匹配", () => {
    test("同主机、子域、www", () => {
        expect(boostMatches(B(), "https://example.com/a")).toBe(true);
        expect(boostMatches(B(), "https://www.example.com/")).toBe(true);
        expect(boostMatches(B(), "http://news.example.com/")).toBe(true);
        expect(boostMatches(B({ host: "www.example.com" }), "https://example.com/")).toBe(true);
    });
    test("不匹配：相似域名、非网页", () => {
        expect(boostMatches(B(), "https://notexample.com/")).toBe(false);
        expect(boostMatches(B(), "https://example.com.evil.io/")).toBe(false);
        expect(boostMatches(B(), "chrome://settings")).toBe(false);
        expect(boostMatches(B(), "file:///example.com")).toBe(false);
        expect(boostMatches(B(), undefined)).toBe(false);
    });
    test("只取启用的", () => {
        expect(activeBoostsFor([B(), B({ id: "b2", isActive: false })], "https://example.com").map(b => b.id)).toEqual(["b1"]);
    });
});

describe("配色计算", () => {
    const w = (o = {}) => ({ type: "colorWheelDriven" as const, ...defaultWheel(), ...o });
    test("themeDriven 既不应用也不移除，没有配色时移除（同 Arc 应用器）", () => {
        expect(colorActionFor([{ colorScheme: { type: "themeDriven" } }])).toEqual({ kind: "keep" });
        expect(colorActionFor([])).toEqual({ kind: "remove" });
        expect(colorActionFor([{ colorScheme: w() }]).kind).toBe("apply");
    });
    test("旧数据 preservedSaturation=true 视为 1", () => {
        expect(wheelToMatrixInput(w({ advancedSettings: { preservedSaturation: true } }))!.preservedSaturation).toBe(1);
        expect(wheelToMatrixInput(w({ advancedSettings: { preservedSaturation: false } }))!.preservedSaturation).toBeUndefined();
        expect(wheelToMatrixInput({ type: "themeDriven" })).toBeNull();
    });
    test("副色相 / 互补", () => {
        expect(secondaryHue({ ...defaultWheel(), primaryHueDegrees: 300 })).toBe(120);
        expect(isComplementary(defaultWheel())).toBe(true);
        expect(isComplementary({ ...defaultWheel(), secondaryHueOffset: 30 })).toBe(false);
    });
    test("shuffle 只改主色相", () => {
        const s = shuffleWheel(defaultWheel(), () => 0.5);
        expect(s).toEqual({ ...defaultWheel(), primaryHueDegrees: 180 });
    });
});

describe("分享限制", () => {
    test("空 Boost 不能分享", () => expect(cannotShareReason(B())).toBe("isEmpty"));
    test("含 JS 不能分享（优先于空）", () => {
        expect(cannotShareReason(B({ js: "alert(1)" }))).toBe("hasJS");
        expect(cannotShareReason(B({ js: "x()", css: "a{}" }))).toBe("hasJS");
        expect(() => encodeShare(B({ js: "x()" }))).toThrow();
    });
    test("只含空白 CSS 仍算空；默认色环算空", () => {
        expect(cannotShareReason(B({ css: "  \n" }))).toBe("isEmpty");
        // Arc 的默认色环也会构造矩阵并应用（不是恒等变换），所以不算空
        expect(cannotShareReason(B({ colorScheme: { type: "colorWheelDriven", ...defaultWheel() } }))).toBeNull();
    });
    test("可以分享并安装（往返，含中文）", () => {
        const b = B({ title: "无广告", css: "a{color:red}", zaps: [".ad"] });
        expect(cannotShareReason(b)).toBeNull();
        const got = decodeShare(encodeShare(b), 5)!;
        expect(got).toMatchObject({ title: "无广告", host: "example.com", css: "a{color:red}", zaps: [".ad"], js: "", isActive: true });
        expect(got.id).not.toBe(b.id);
    });
    test("安装时丢弃 JS、拒绝坏码", () => {
        const forged = "cat-boost:" + btoa(JSON.stringify({ host: "a.com", css: "x{}", js: "steal()" }));
        expect(decodeShare(forged)!.js).toBe("");
        expect(decodeShare("cat-boost:!!!")).toBeNull();
        expect(decodeShare("hello")).toBeNull();
        expect(decodeShare("cat-boost:" + btoa(JSON.stringify({ host: "a.com" })))).toBeNull();
    });
});

describe("Boosts：验收 51945 修复", () => {
    test("配色不注入 CSS：不碰 html/body/::after，由专用层处理", async () => {
        const { COLOR_OVERLAY_SELECTOR } = await import("../src/plugins/boosts/model");
        const b = newBoost("e.com"); b.colorScheme = { type: "colorWheelDriven", ...defaultWheel(), primaryHueDegrees: 90 };
        const css = assembleCss(b);
        expect(css).not.toMatch(/filter/);
        expect(css).not.toContain("::after");
        expect(COLOR_OVERLAY_SELECTOR).toBe("cat-boost-tint");
        const tint = await Bun.file("src/plugins/boosts/tint.ts").text();
        for (const v of ["\"pointer-events\": \"none\"", "contain: \"strict\"", "position: \"fixed\"", "feColorMatrix", "color-interpolation-filters", "无法对齐：需要内核"]) expect(tint).toContain(v);
    });
    test("大小写：循环、注入顺序 font → textTransform → zaps，分享码带上", async () => {
        const { nextTextTransform, TEXT_TRANSFORMS } = await import("../src/plugins/boosts/model");
        expect(TEXT_TRANSFORMS).toEqual(["capitalize", "uppercase", "lowercase"]);
        expect([undefined, "capitalize", "uppercase", "lowercase"].map(t => nextTextTransform(t as never))).toEqual(["capitalize", "uppercase", "lowercase", null]);
        const b = newBoost("e.com"); b.font = { type: "custom", family: "Inter" }; b.textTransform = "uppercase"; b.zaps = [".ad"];
        const css = assembleCss(b);
        expect(css).toContain("*:not(i, .material-symbols-outlined, .material-icons) { text-transform: uppercase !important; }");
        expect(css).not.toMatch(/(^|\n)\* \{ text-transform/);
        expect(css.indexOf("font-family")).toBeLessThan(css.indexOf("text-transform"));
        expect(css.indexOf("text-transform")).toBeLessThan(css.indexOf("display: none"));
        const only = newBoost("e.com"); only.textTransform = "lowercase";
        expect(cannotShareReason(only)).toBeNull();
        expect(decodeShare(encodeShare(only))?.textTransform).toBe("lowercase");
        expect(assembleCss({ ...newBoost("e.com"), textTransform: "bogus" as never })).not.toContain("text-transform");
    });
    test("大小写规则与字体规则用同一个选择器排除图标元素", async () => {
        const { FONT_SELECTOR } = await import("../src/plugins/boosts/model");
        for (const t of ["capitalize", "uppercase", "lowercase"] as const) {
            const css = assembleCss({ ...newBoost("e.com"), textTransform: t });
            expect(css).toBe(`${FONT_SELECTOR} { text-transform: ${t} !important; }`);
            expect(css).toContain(":not(i, .material-symbols-outlined, .material-icons)");
        }
    });
    test("Zap 边框色：注明源码未找到、暂用 BoostsOrange，值不变", async () => {
        const { ZAP_BORDER_COLOR_PENDING } = await import("../src/plugins/boosts/zap");
        expect(ZAP_BORDER_COLOR_PENDING).toBe("AccentColor");
        const src = await Bun.file("src/plugins/boosts/zap.ts").text();
        expect(src).toContain("Zap 框颜色：源码未找到");
        expect(src).not.toMatch(/= "#FF560E"/);
        expect(src).not.toContain("TODO");
    });
    test("分享提示与文本分享码相符，不再提“链接”；自加文案精简", async () => {
        const { STRINGS } = await import("../src/plugins/boosts/i18n");
        expect(STRINGS.en["boosts.shareNotice"]).not.toMatch(/link/i);
        expect(STRINGS.zh["boosts.shareNotice"]).not.toContain("链接");
        expect(STRINGS.en["boosts.shareNotice"]).toContain("code");
        for (const k of ["boosts.emptySub", "boosts.zapHint", "boosts.installSafety", "boosts.shareHasJS"] as const) expect(STRINGS.en[k].length).toBeLessThanOrEqual(60);
        for (const k of ["boosts.textCase", "boosts.capitalize", "boosts.uppercase", "boosts.lowercase", "boosts.textCaseNone"] as const) { expect(STRINGS.en[k]).toBeTruthy(); expect(STRINGS.zh[k]).toBeTruthy(); }
        expect(STRINGS.en["boosts.textCase"]).toBe("Change text case");
    });
    test("编辑器独立窗口：扩展页地址带 boost id 和目标标签，Shelf 高 58", async () => {
        const { editorUrl, SHELF_HEIGHT, EDITOR_PAGE, EDITOR_PAGE_HTML } = await import("../src/plugins/boosts/model");
        expect(SHELF_HEIGHT).toBe(58);
        expect(EDITOR_PAGE).toBe("boost-editor.html");
        expect(editorUrl("b1", 7)).toBe("boost-editor.html?boostEditor=b1&tab=7");
        expect(editorUrl("a b")).toBe("boost-editor.html?boostEditor=a%20b");
        // 独立页面只加载 page.js，不加载侧边栏脚本
        expect(EDITOR_PAGE_HTML).toContain('src="page.js"');
        expect(EDITOR_PAGE_HTML).not.toContain("sidepanel.js");
        const idx = await Bun.file("src/plugins/boosts/index.ts").text();
        expect(idx).toMatch(/page: \{[\s\S]*boost-editor\.html/);
        expect(idx).not.toContain("mountEditorWindow");
    });
});

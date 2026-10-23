import { test, expect } from "bun:test";
import { handleMutations, fixTitle, HOST_ATTR } from "../src/components/ArcTooltip";

/** 极简假 DOM：够 fixTitle / handleMutations 用 */
class El {
    nodeType = 1; attrs = new Map<string, string>(); kids: El[] = []; parentElement: El | null = null; writes = 0;
    constructor(public tagName: string, a: Record<string, string> = {}, public cls = "") { for (const [k, v] of Object.entries(a)) this.attrs.set(k, v); }
    add(...k: El[]) { for (const c of k) { c.parentElement = this; this.kids.push(c); } return this; }
    getAttribute(k: string) { return this.attrs.get(k) ?? null; } hasAttribute(k: string) { return this.attrs.has(k); }
    setAttribute(k: string, v: string) { this.writes++; this.attrs.set(k, v); } removeAttribute(k: string) { this.writes++; this.attrs.delete(k); }
    all(): El[] { return this.kids.flatMap(k => [k, ...k.all()]); }
    m(sel: string): boolean {
        if (sel === `[${HOST_ATTR}]`) return this.hasAttribute(HOST_ATTR);
        if (sel === "[title]") return this.hasAttribute("title");
        if (sel === "[data-tip]") return this.hasAttribute("data-tip");
        return sel.split(",").some(s => { s = s.trim(); return s.startsWith(".") ? this.cls.split(" ").includes(s.slice(1)) : s.startsWith("[role=") ? this.getAttribute("role") === s.slice(6, -1) : false; });
    }
    matches(sel: string) { return this.m(sel); }
    closest(sel: string): El | null { if (this.m(sel)) return this; let e = this.parentElement; while (e) { if (e.m(sel)) return e; e = e.parentElement; } return null; }
    querySelector(sel: string) { return this.all().find(e => e.m(sel)) ?? null; }
    querySelectorAll(sel: string) { return this.all().filter(e => e.m(sel)); }
}
const host = (tag = "BUTTON") => new El(tag, { [HOST_ATTR]: "" });
const attr = (t: El, name = "title") => ({ type: "attributes", target: t as unknown as Node, attributeName: name });

test("宿主被写回 title：立即移除，aria-label 兜底（不覆盖已有）", () => {
    const b = host(); b.attrs.set("title", "Close");
    handleMutations([attr(b)]);
    expect(b.hasAttribute("title")).toBe(false); expect(b.getAttribute("aria-label")).toBe("Close");
    const c = host(); c.attrs.set("aria-label", "Keep"); c.attrs.set("title", "x");
    handleMutations([attr(c)]); expect(c.getAttribute("aria-label")).toBe("Keep"); expect(c.hasAttribute("title")).toBe(false);
});
test("宿主内 favicon img 与包住宿主的行（TabRow title=url）都去 title；无关元素保留", () => {
    const img = new El("IMG"), btn = host(); btn.add(img);
    const row = new El("DIV", {}, "arc-tab arc-row").add(btn);
    img.attrs.set("title", "github.com"); row.attrs.set("title", "https://github.com");
    handleMutations([attr(img), attr(row)]);
    expect(img.hasAttribute("title")).toBe(false); expect(row.hasAttribute("title")).toBe(false);
    expect(row.hasAttribute("aria-label")).toBe(false); // 非交互行不补
    const other = new El("DIV", { title: "keep" }, "arc-row");
    handleMutations([attr(other)]); expect(other.getAttribute("title")).toBe("keep");
});
test("新插入节点：子树里的 title 与外层行容器一并处理", () => {
    const row = new El("DIV", { title: "url" }, "arc-tab");
    const b = host(); const img = new El("IMG", { title: "fav" }); b.add(img);
    row.add(b);
    handleMutations([{ type: "childList", target: row as unknown as Node, addedNodes: [b as unknown as Node] }]);
    expect(img.hasAttribute("title")).toBe(false); expect(row.hasAttribute("title")).toBe(false);
});
test("不自循环：移除产生的记录（已无 title）不再写 DOM", () => {
    const b = host(); b.attrs.set("title", "x");
    expect(fixTitle(b as unknown as Element)).toBe(true);
    const w = b.writes;
    for (let i = 0; i < 5; i++) handleMutations([attr(b)]);
    expect(b.writes).toBe(w);
});
test("悬停态排查：去行 title 只删属性，不替换 / 移动节点、不改 class、不触发后续写入", () => {
    const btn = host(); const row = new El("DIV", { title: "https://x" }, "arc-tab arc-row").add(btn);
    const kids = [...row.kids], cls = row.cls, parent = btn.parentElement;
    handleMutations([attr(row)]);
    expect(row.kids).toEqual(kids); expect(btn.parentElement).toBe(parent); expect(row.cls).toBe(cls);
    expect([...row.attrs.keys()]).toEqual([]); // 仅 title 被删，未加 aria-label（非交互行）
    const w = row.writes; handleMutations([attr(row), attr(row)]); expect(row.writes).toBe(w);
});

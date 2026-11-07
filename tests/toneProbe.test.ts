/* ToneProbe（共享文件 src/api/ToneProbe.ts）：按正文颜色 --arc-fg 的亮度写 <html data-bb-dark>。
 * 缺陷（分屏页 split.html）：该页没有 --arc-fg（只加载 splitView 自己的样式），探针色 = 继承色 = 页面 color-scheme 决定的 canvastext；
 * 而 splitView 的 `:root[data-bb-dark="1"] { …color-scheme: dark }` 又让继承色变白 → 探针永远判深（锁存），系统切回浅色也回不来。
 * 修复判据：根上没有 --arc-fg 时 ToneProbe 什么都不写、也不删（该页的 data-bb-dark 由 splitView/theme.ts 从侧栏抄过来，归它管）。
 * 有 --arc-fg 的页面（侧栏 / 设置页 / boost 编辑器）行为不变（下面标「守卫」的用例在未修的树上也应是绿的）。 */
import { afterEach, beforeEach, expect, test } from "bun:test";

type Fake = { dataset: Record<string, string>; writes: string[] };
const g = globalThis as unknown as Record<string, unknown>;
const saved: Record<string, unknown> = {};
let fake: Fake;
/** 搭一个最小 DOM：documentElement 上的 --arc-fg（"" = 没有）、探针 span 解析到的颜色（有 --arc-fg 时 = 它；没有时 = 继承色 inherited） */
function setup(opts: { fg: string; inherited: string; bb?: string }) {
    const writes: string[] = [];
    const dataset = new Proxy({} as Record<string, string>, { set(t, k, v) { writes.push(`${String(k)}=${v}`); t[k as string] = v; return true; } });
    if (opts.bb !== undefined) { dataset.bbDark = opts.bb; writes.length = 0; }
    const root = { dataset };
    const probeColor = () => (opts.fg ? opts.fg : opts.inherited);
    g.document = {
        documentElement: root,
        body: { append() { /* 探针只需「被挂上」 */ } },
        createElement: () => ({ style: { cssText: "" }, remove() { /* noop */ } }),
    };
    g.getComputedStyle = (el: unknown) => el === root
        ? { getPropertyValue: (n: string) => (n === "--arc-fg" ? opts.fg : "") }
        : { color: probeColor() };
    fake = { dataset, writes };
    return { set: (o: Partial<typeof opts>) => Object.assign(opts, o) };
}
beforeEach(() => { for (const k of ["document", "getComputedStyle"]) saved[k] = g[k]; });
afterEach(() => { for (const k of ["document", "getComputedStyle"]) { if (saved[k] === undefined) delete g[k]; else g[k] = saved[k]; } });

const load = async () => (await import("../src/api/ToneProbe")) as typeof import("../src/api/ToneProbe");
const WHITE = "rgb(255, 255, 255)", BLACK = "rgb(0, 0, 0)";

test("缺陷：根上没有 --arc-fg、继承色为白（被 color-scheme: dark 带的）→ 不得写 data-bb-dark（锁存）", async () => {
    setup({ fg: "", inherited: WHITE });
    (await load()).updateTone();
    expect(fake.dataset.bbDark).toBeUndefined();
    expect(fake.writes).toEqual([]);
});

test("缺陷：没有 --arc-fg 时也不得覆盖 / 删除别处（splitView/theme.ts 从侧栏抄来的）已写好的 data-bb-dark", async () => {
    setup({ fg: "", inherited: WHITE, bb: "0" });
    (await load()).updateTone();
    expect(fake.dataset.bbDark).toBe("0");
    expect(fake.writes).toEqual([]);
});

test("缺陷：没有 --arc-fg、继承色为黑 → 同样不写（不能因为碰巧判浅就写，否则 bb-dark=0 又会钉死浅色）", async () => {
    setup({ fg: "", inherited: BLACK });
    (await load()).updateTone();
    expect(fake.dataset.bbDark).toBeUndefined();
});

test("缺陷：分屏页来回切（锁存复现）：深色继承色出现后再回浅色，data-bb-dark 始终是「没写」", async () => {
    const s = setup({ fg: "", inherited: BLACK });
    const { updateTone } = await load();
    updateTone(); s.set({ inherited: WHITE }); updateTone(); s.set({ inherited: BLACK }); updateTone();
    expect(fake.dataset.bbDark).toBeUndefined();
    expect(fake.writes).toEqual([]);
});

test("守卫：有 --arc-fg（浅色前景 = 深色底）→ data-bb-dark=1；深色前景 → 0", async () => {
    const s = setup({ fg: "rgb(227, 226, 226)", inherited: BLACK });
    const { updateTone } = await load();
    updateTone(); expect(fake.dataset.bbDark).toBe("1");
    s.set({ fg: "rgb(20, 20, 28)" }); updateTone(); expect(fake.dataset.bbDark).toBe("0");
});

test("守卫：有 --arc-fg 时来回切不锁存（深→浅→深→浅）", async () => {
    const s = setup({ fg: "rgb(227, 226, 226)", inherited: WHITE });
    const { updateTone } = await load();
    const seq: (string | undefined)[] = [];
    for (const fg of ["rgb(227, 226, 226)", "rgb(20, 20, 28)", "rgb(227, 226, 226)", "rgb(20, 20, 28)"]) { s.set({ fg }); updateTone(); seq.push(fake.dataset.bbDark); }
    expect(seq).toEqual(["1", "0", "1", "0"]);
});

test("守卫（不闪烁）：值没变就不写（不触发 MutationObserver / 重绘）；变了才写一次", async () => {
    const s = setup({ fg: "rgb(227, 226, 226)", inherited: WHITE });
    const { updateTone } = await load();
    updateTone(); updateTone(); updateTone();
    expect(fake.writes).toEqual(["bbDark=1"]);
    s.set({ fg: "rgb(20, 20, 28)" }); updateTone(); updateTone();
    expect(fake.writes).toEqual(["bbDark=1", "bbDark=0"]);
});

test("守卫：--arc-fg 带空白 / 无法解析成色值 → 不写（沿用旧的 Number.isFinite 判据）", async () => {
    setup({ fg: "  ", inherited: WHITE });
    (await load()).updateTone();
    expect(fake.dataset.bbDark).toBeUndefined();
    setup({ fg: "notacolor", inherited: WHITE });
    (await load()).updateTone();
    expect(fake.dataset.bbDark).toBeUndefined();
});

test("守卫（源码）：不新增色值、不重载（ToneProbe.ts 里没有 hex / rgb( 字面量、没有 location / reload）", async () => {
    const src = (await Bun.file(new URL("../src/api/ToneProbe.ts", import.meta.url)).text()).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(src).not.toMatch(/rgba?\(/);
    expect(src).not.toMatch(/location|reload|\.src\s*=|\.replaceWith|innerHTML/);
});

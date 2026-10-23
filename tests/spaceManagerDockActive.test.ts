/* spaceManager.measureDock：选中项的身份取 data-space（Space id）；不再回退读 data-tip（已被 ArcTooltip.applyTip 消费，恒为 null） */
import { afterEach, beforeEach, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { scheduleDock } from "../src/plugins/spaces/spaceManager/index";

const src = readFileSync("src/plugins/spaces/spaceManager/index.ts", "utf8");

test("源码：选中项身份只读 dataset.space，没有 getAttribute('data-tip') 回退", () => {
    expect(src).toContain('const actId = act?.dataset.space ?? "";');
    expect(src).not.toMatch(/getAttribute\("data-tip"\)/);
});

let raf: ((t: number) => void)[] = []; const g = globalThis as unknown as { requestAnimationFrame?: unknown };
let oldRaf: unknown;
beforeEach(() => { oldRaf = g.requestAnimationFrame; raf = []; g.requestAnimationFrame = (cb: (t: number) => void) => (raf.push(cb), raf.length); });
afterEach(() => { g.requestAnimationFrame = oldRaf; });

function fakeBar(activeId: () => string | undefined) {
    const scrolls: unknown[] = [];
    const act = { get dataset() { return { space: activeId() } as DOMStringMap; }, getAttribute: () => null, offsetLeft: 100, offsetWidth: 30 };
    const bar = {
        isConnected: true, clientWidth: 200, style: { setProperty() {} }, classList: { toggle() {} },
        querySelectorAll: () => [act, act], querySelector: () => act, scrollTo: (o: unknown) => scrolls.push(o),
        parentElement: { clientWidth: 300, children: [] as unknown[] },
    };
    bar.parentElement.children.push(bar);
    return { bar: bar as unknown as HTMLElement, scrolls };
}

test("行为：选中的 Space 变了才滚动到选中项；没变不重复滚；用的是 data-space", () => {
    let id: string | undefined = "s1";
    const { bar, scrolls } = fakeBar(() => id);
    scheduleDock(bar); raf.shift()!(0); expect(scrolls.length).toBe(1); // 首次
    scheduleDock(bar); raf.shift()!(0); expect(scrolls.length).toBe(1); // 同一个 Space：不再滚
    id = "s2"; scheduleDock(bar); raf.shift()!(0); expect(scrolls.length).toBe(2); // 换了 Space：滚
    expect(scrolls[1]).toEqual({ left: 100 - (200 - 30) / 2, behavior: "smooth" });
});

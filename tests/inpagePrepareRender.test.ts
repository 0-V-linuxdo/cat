import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { type InstantBox, type InstantHost, prepareRender } from "../src/plugins/inpageSidebar/instantRender";

/* 补丁 inpage-prepare-render：隐藏标签里 render 的「无动画」顺序（切 tab 又重新展开的残留，headed 13:10 样本 left=-238 / anim=19 / noanim=""）。
 * 只证明逻辑、顺序与接线，不声称真机时序（真机复测见 inpage-residual/shots/retest-residual.ts，只写没跑）。 */

const ROOT = resolve(import.meta.dir, "..");
const read = (f: string) => readFileSync(resolve(ROOT, f), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/* —— 假 DOM：只记录 host.dataset.noanim / box 内联 transition / rAF 队列 —— */
function fake() {
    const host: InstantHost = { dataset: {} };
    const inline: Record<string, string> = {};
    const box: InstantBox = { style: { setProperty: (n, v) => { inline[n] = v; }, removeProperty: n => { delete inline[n]; } } };
    const rafQ: Array<() => void> = [];
    const raf = (f: () => void) => { rafQ.push(f); return rafQ.length; };
    const frame = () => { const q = rafQ.splice(0); for (const f of q) f(); }; // 一帧：跑掉当前队列（新排的下一帧再跑）
    return { host, box, inline, raf, frame, pending: () => rafQ.length };
}

describe("① prepareRender：隐藏标签里的渲染也压过渡（先算有效 instant、再写 transition）", () => {
    test("隐藏页 + 入参 instant=false：返回 true、data-noanim=1、内联 transition:none（旧顺序这里什么都不写）", () => {
        const f = fake();
        expect(prepareRender({ instant: false, visible: false, host: f.host, box: f.box, raf: f.raf })).toBe(true);
        expect(f.host.dataset.noanim).toBe("1"); expect(f.inline.transition).toBe("none");
    });
    test("隐藏页的 rAF 不会跑 → 压制一直保持；可见后两帧才撤（覆盖「切回来那一刻」）", () => {
        const f = fake();
        prepareRender({ instant: false, visible: false, host: f.host, box: f.box, raf: f.raf });
        expect(f.host.dataset.noanim).toBe("1"); // 隐藏中：没有 frame()，一直在
        f.frame(); expect(f.host.dataset.noanim).toBe("1"); expect(f.inline.transition).toBe("none"); // 可见后第 1 帧：还在
        f.frame(); expect(f.host.dataset.noanim).toBeUndefined(); expect(f.inline.transition).toBeUndefined(); // 第 2 帧：撤
    });
    test("可见 + 非 instant（正常的用户操作）：不碰任何东西、返回 false（动画照常）", () => {
        const f = fake();
        expect(prepareRender({ instant: false, visible: true, host: f.host, box: f.box, raf: f.raf })).toBe(false);
        expect(f.host.dataset.noanim).toBeUndefined(); expect(f.inline.transition).toBeUndefined(); expect(f.pending()).toBe(0);
    });
    test("可见 + instant（新页面第一次 / 切回来）：同旧行为", () => {
        const f = fake();
        expect(prepareRender({ instant: true, visible: true, host: f.host, box: f.box, raf: f.raf })).toBe(true);
        expect(f.host.dataset.noanim).toBe("1"); expect(f.inline.transition).toBe("none");
        f.frame(); f.frame(); expect(f.host.dataset.noanim).toBeUndefined(); expect(f.inline.transition).toBeUndefined();
    });
    test("连续多次 render：只有最后一对 rAF 负责撤（前一对不能提前撤掉后一次刚压上的过渡）", () => {
        const f = fake();
        prepareRender({ instant: false, visible: false, host: f.host, box: f.box, raf: f.raf }); // 隐藏中第 1 次
        prepareRender({ instant: true, visible: true, host: f.host, box: f.box, raf: f.raf }); // 可见那一刻（onVisibility → render(true)）
        f.frame(); // 两对的外层 rAF 都跑；内层各排 1 个
        expect(f.pending()).toBe(2);
        f.frame(); // 内层：第 1 对被代际号拦下，第 2 对撤
        expect(f.host.dataset.noanim).toBeUndefined(); expect(f.inline.transition).toBeUndefined();
        // 反例：中途又来一次 render 时，较早的一对到点也不能撤
        const g = fake();
        prepareRender({ instant: true, visible: true, host: g.host, box: g.box, raf: g.raf });
        g.frame(); // 第 1 对的外层已跑，内层排着
        prepareRender({ instant: true, visible: true, host: g.host, box: g.box, raf: g.raf }); // 第 2 次
        g.frame(); // 第 1 对内层到点：被拦（代际号已变）
        expect(g.host.dataset.noanim).toBe("1"); expect(g.inline.transition).toBe("none");
        g.frame(); expect(g.host.dataset.noanim).toBeUndefined();
    });
    test("旧顺序复现（对照，证明这条测试能抓到 bug）：先按入参写、后用 !visible 抬高 → 隐藏页没压过渡", () => {
        const f = fake();
        const legacy = (instant: boolean, visible: boolean) => { // 补丁 tab-switch 之后 content.ts render 的原顺序
            if (instant) { f.host.dataset.noanim = "1"; f.box.style.setProperty("transition", "none"); }
            instant = instant || !visible; return instant;
        };
        expect(legacy(false, false)).toBe(true); // pager 不播（instant=true）…
        expect(f.inline.transition).toBeUndefined(); // …但 .box 的 transform 过渡没压住 → 隐藏文档里起跑、可见时补播
        expect(f.host.dataset.noanim).toBeUndefined();
    });
    test("接线：content.ts 的 render 里 prepareRender 在读 st / 写盒子之前，且不再有旧的「instant = instant || !vis」", () => {
        const s = strip(read("src/plugins/inpageSidebar/content.ts"));
        const r = s.slice(s.indexOf("const render = (instant = false)"), s.indexOf("const showHint"));
        expect(r).toContain("prepareRender({ instant, visible: vis, host, box, raf: requestAnimationFrame })");
        expect(r).not.toMatch(/instant\s*=\s*instant\s*\|\|\s*!vis/);
        expect(r.indexOf("prepareRender(")).toBeLessThan(r.indexOf("const active ="));
        expect(r.indexOf("prepareRender(")).toBeLessThan(r.indexOf("syncPush("));
        expect(r).not.toContain('setProperty("transition"'); // 写 transition 只在 instantRender.ts 一处
    });
});


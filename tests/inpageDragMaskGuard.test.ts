/* 拖宽遮罩兜底：拖动调宽时全屏透明遮罩（.mask，盖住 iframe）在 pointerdown 打开、endDrag 里关。
 * 缺口：鼠标在窗口外松手 / 指针捕获被抢走 / 切走窗口时 pointerup 到不了把手 → 遮罩一直开着，整页点不动。
 * 补：把手 lostpointercapture、window blur、document 转隐藏（visibilitychange）都 → endDrag(true)（= pointercancel 语义：夹 164–500、不收起、落盘一次、撤遮罩）。
 * 这个仓库的内容脚本测试不起 DOM，所以这里把 content.ts 里「let drag … function syncHandle」这一段真源码转译后，在假 DOM（假把手 / 假 window / 假 document）里真跑。 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { ARC, HANDLE, TIMING } from "../src/plugins/inpageSidebar/constants";
import { clampWidth, createResizeDrag, resetWidth } from "../src/plugins/inpageSidebar/logic";

const SRC = readFileSync("src/plugins/inpageSidebar/content.ts", "utf8");

class FakeTarget {
    ls = new Map<string, Array<(e: any) => void>>(); dataset: Record<string, string> = {}; visibilityState = "visible";
    addEventListener(t: string, f: (e: any) => void) { const a = this.ls.get(t) ?? []; a.push(f); this.ls.set(t, a); }
    removeEventListener(t: string, f: (e: any) => void) { this.ls.set(t, (this.ls.get(t) ?? []).filter(x => x !== f)); }
    count(t: string) { return this.ls.get(t)?.length ?? 0; }
    fire(t: string, e: any = {}) { for (const f of Array.from(this.ls.get(t) ?? [])) f(e); }
    setPointerCapture() { /* */ } matches() { return false; } remove() { /* */ } append() { /* */ }
}

const rig = () => {
    const win = new FakeTarget(), doc = new FakeTarget(), mask = new FakeTarget(), sent: any[] = []; mask.dataset.on = "0";
    const made: FakeTarget[] = [];
    const start = SRC.indexOf("let drag: ReturnType<typeof createResizeDrag>"), end = SRC.indexOf("function syncHandle");
    expect(start).toBeGreaterThan(0); expect(end).toBeGreaterThan(start);
    const js = new Bun.Transpiler({ loader: "ts" }).transformSync(SRC.slice(start, end));
    const env: Record<string, unknown> = {
        mk: () => { const t = new FakeTarget(); made.push(t); return t; }, mask, root: { append() { /* */ } }, window: win, document: doc, HANDLE, ARC, TIMING,
        createResizeDrag, clampWidth, resetWidth, syncPush() { /* */ }, send: (m: unknown) => { sent.push(m); }, render() { /* */ }, repeek: { arm() { /* */ } },
        collapseGate: { holding: false, begin() { /* */ }, expire: () => false, release() { /* */ } }, box: { dataset: { shown: "1" } }, stopped: false, st: undefined, pinnedNow: true,
    };
    const scope = new Proxy(env, { has: (t, k) => typeof k === "string" && k in t, get: (t, k) => (t as any)[k] });
    // 源码里引用、但不在这一段里声明的外部变量：handle / bar / dragging / peek / width / setWidth（content.ts 前面声明）→ 在这里声明
    const body = `with (scope) { let handle, bar, dragging = false, peek = false, width = 228; const setWidth = (w) => { width = w; };
        ${js}
        return { makeHandle, endDrag, get dragging() { return dragging; }, get handle() { return handle; } }; }`;
    const api = new Function("scope", body)(scope) as { makeHandle: () => void; endDrag: (c?: boolean) => void; dragging: boolean; handle: FakeTarget };
    api.makeHandle(); const h = made[0]!;
    const down = () => h.fire("pointerdown", { button: 0, clientX: 300, pointerId: 1, preventDefault() { /* */ } });
    return { win, doc, mask, sent, h, api, down };
};

describe("拖宽遮罩兜底（真源码 + 假 DOM）", () => {
    test("基线：pointerdown 开遮罩 + 只在拖动期间挂 blur / visibilitychange；pointerup 正常收尾（落盘一次）并摘掉两个监听", () => {
        const r = rig(); expect(r.win.count("blur")).toBe(0); expect(r.doc.count("visibilitychange")).toBe(0);
        r.down(); expect(r.mask.dataset.on).toBe("1"); expect(r.api.dragging).toBe(true); expect(r.win.count("blur")).toBe(1); expect(r.doc.count("visibilitychange")).toBe(1);
        r.h.fire("pointermove", { clientX: 250 }); r.h.fire("pointerup");
        expect(r.mask.dataset.on).toBe("0"); expect(r.api.dragging).toBe(false); expect(r.sent.length).toBe(1); expect(r.sent[0].type).toBe("width");
        expect(r.win.count("blur")).toBe(0); expect(r.doc.count("visibilitychange")).toBe(0);
    });
    test("窗口外松手 → 只来 lostpointercapture（没有 pointerup）：撤遮罩、落盘一次、不收起", () => {
        const r = rig(); r.down(); r.h.fire("pointermove", { clientX: 5 }); // 拖到很窄（松手本会触发收起）
        r.h.fire("lostpointercapture");
        expect(r.mask.dataset.on).toBe("0"); expect(r.api.dragging).toBe(false); expect(r.sent.length).toBe(1);
        expect(r.sent[0].type).toBe("width"); expect(r.sent[0].width).toBeGreaterThanOrEqual(164); // endDrag(true)：夹 164–500，不发 collapse
        expect(r.win.count("blur")).toBe(0); expect(r.doc.count("visibilitychange")).toBe(0);
    });
    test("window blur（切走窗口 / alt-tab / 外部弹窗抢焦点）→ 撤遮罩、落盘一次、摘监听", () => {
        const r = rig(); r.down(); r.win.fire("blur");
        expect(r.mask.dataset.on).toBe("0"); expect(r.api.dragging).toBe(false); expect(r.sent.map(m => m.type)).toEqual(["width"]);
        expect(r.win.count("blur")).toBe(0); expect(r.doc.count("visibilitychange")).toBe(0);
    });
    test("页面转隐藏（切标签）→ 撤遮罩；转可见 = 什么都不做（不误触发）", () => {
        const r = rig(); r.down(); r.doc.visibilityState = "visible"; r.doc.fire("visibilitychange");
        expect(r.mask.dataset.on).toBe("1"); expect(r.api.dragging).toBe(true); expect(r.sent.length).toBe(0); // 可见：不结束拖动
        r.doc.visibilityState = "hidden"; r.doc.fire("visibilitychange");
        expect(r.mask.dataset.on).toBe("0"); expect(r.api.dragging).toBe(false); expect(r.sent.length).toBe(1);
    });
    test("不重复收尾：pointerup 之后 lostpointercapture（浏览器必发）/ 再 blur 都是空操作；pointercancel 后同理；每次拖动只落盘一次", () => {
        const r = rig(); r.down(); r.h.fire("pointerup"); r.h.fire("lostpointercapture"); r.win.fire("blur"); r.doc.visibilityState = "hidden"; r.doc.fire("visibilitychange");
        expect(r.sent.length).toBe(1);
        const c = rig(); c.down(); c.h.fire("pointercancel"); c.h.fire("lostpointercapture"); c.win.fire("blur");
        expect(c.sent.length).toBe(1); expect(c.mask.dataset.on).toBe("0");
    });
    test("没有在拖动：blur / lostpointercapture / 隐藏都不发消息、不动遮罩（不误触发）", () => {
        const r = rig(); r.win.fire("blur"); r.h.fire("lostpointercapture"); r.doc.visibilityState = "hidden"; r.doc.fire("visibilitychange");
        expect(r.sent.length).toBe(0); expect(r.mask.dataset.on).toBe("0");
    });
    test("连续两次拖动：监听不累加（第二次 pointerdown 前摘旧的）；blur 后可以再拖、再兜底", () => {
        const r = rig(); r.down(); r.down(); expect(r.win.count("blur")).toBe(1); expect(r.doc.count("visibilitychange")).toBe(1); // 同一拖动里重复 pointerdown（多指）：不叠加
        r.win.fire("blur"); expect(r.win.count("blur")).toBe(0); expect(r.sent.length).toBe(1);
        r.down(); expect(r.mask.dataset.on).toBe("1"); expect(r.win.count("blur")).toBe(1); r.h.fire("lostpointercapture"); expect(r.sent.length).toBe(2); expect(r.win.count("blur")).toBe(0);
    });
    test("源码：teardown 也摘兜底监听；pointerup / pointercancel 原样保留；兜底不碰 trigger / hold", () => {
        expect(SRC).toMatch(/const teardown = \(\) => \{\s*if \(stopped\) return;[\s\S]{0,160}?stopped = true;[^\n]*\n\s*dragOff\?\.\(\); dragOff = undefined;/);
        expect(SRC).toContain('h.addEventListener("pointerup", () => endDrag()); h.addEventListener("pointercancel", () => endDrag(true));');
        expect(SRC).toContain('h.addEventListener("lostpointercapture", () => endDrag(true));');
        expect((SRC.match(/window\.addEventListener\("blur"/g) ?? []).length).toBe(1); // 整个 content.ts 只有拖动里这一处 blur 监听
    });
});

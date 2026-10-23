import { afterEach, expect, test } from "bun:test";
import { installContentGuard, isInvalidated, type ContentGuard } from "../src/api/contentGuard";

/* 模拟一个内容脚本的隔离世界：独立的 EventTarget / 定时器 / 观察者 / console / chrome 事件 */
function world() {
    class ET {
        map = new Map<string, Set<unknown>>();
        addEventListener(t: string, f: unknown, _o?: unknown) { (this.map.get(t) ?? this.map.set(t, new Set()).get(t)!).add(f); }
        removeEventListener(t: string, f: unknown) { this.map.get(t)?.delete(f); }
        fire(t: string, ev: any = {}) { for (const f of Array.from(this.map.get(t) ?? [])) (f as any).call(this, ev); }
        count(t: string) { return this.map.get(t)?.size ?? 0; }
    }
    const timers = new Map<number, () => void>(); let tid = 0;
    const observers: any[] = [];
    class MO { cb: any; connected = false; constructor(cb: any) { this.cb = cb; observers.push(this); } observe() { this.connected = true; } disconnect() { this.connected = false; } }
    const logs: string[] = [];
    const mkEv = () => { const s = new Set<any>(); return { s, addListener(f: any) { s.add(f); }, removeListener(f: any) { s.delete(f); } }; };
    const onMessage = mkEv(), onChanged = mkEv();
    const g: any = new ET();
    Object.setPrototypeOf(g, ET.prototype);
    Object.assign(g, {
        EventTarget: ET,
        setTimeout: (f: () => void) => { const id = ++tid; timers.set(id, f); return id; }, clearTimeout: (id: number) => { timers.delete(id); },
        setInterval: (f: () => void) => { const id = ++tid; timers.set(id, f); return id; }, clearInterval: (id: number) => { timers.delete(id); },
        MutationObserver: MO,
        console: { error: (...a: any[]) => logs.push("E " + a.join(" ")), warn: (...a: any[]) => logs.push("W " + a.join(" ")), log: (...a: any[]) => logs.push("L " + a.join(" ")), info: () => { }, debug: () => { } },
    });
    const state = { id: "ext" as string | undefined };
    const guard = installContentGuard({ g, runtimeId: () => state.id, chromeEvents: () => [onMessage, onChanged] });
    return { g, ET, timers, observers, logs, onMessage, onChanged, state, guard, runTimers: () => { for (const [id, f] of Array.from(timers)) { timers.delete(id); f(); } } };
}
let cur: ContentGuard | null = null;
afterEach(() => { cur?.uninstall(); cur = null; });

test("isInvalidated 识别 Error / 字符串，大小写不敏感", () => {
    expect(isInvalidated(new Error("Extension context invalidated."))).toBe(true);
    expect(isInvalidated("extension CONTEXT INVALIDATED")).toBe(true);
    expect(isInvalidated(new Error("Receiving end does not exist"))).toBe(false);
    expect(isInvalidated(undefined)).toBe(false);
});

test("上下文存活时一切照常：监听 / 定时器 / 观察者 / chrome 事件 / console", () => {
    const w = world(); cur = w.guard;
    let n = 0; const doc = new w.ET();
    doc.addEventListener("click", () => n++); w.g.addEventListener("pagehide", () => n++);
    w.g.setTimeout(() => n++); new w.g.MutationObserver(() => n++).observe();
    w.onMessage.addListener(() => n++);
    doc.fire("click"); w.g.fire("pagehide"); w.runTimers(); w.observers[0].cb(); [...w.onMessage.s][0]();
    expect(n).toBe(5); w.g.console.warn("ok"); expect(w.logs).toEqual(["W ok"]);
    expect(w.guard.dead).toBe(false);
});

test("runtime.id 消失：下一次事件即整体停用，移除全部监听 / 定时器 / 观察者 / chrome 监听，并静默", () => {
    const w = world(); cur = w.guard;
    let n = 0; const doc = new w.ET();
    doc.addEventListener("pointerdown", () => n++, true); w.g.addEventListener("pagehide", () => n++);
    w.g.setTimeout(() => n++); w.g.setInterval(() => n++);
    const mo = new w.g.MutationObserver(() => n++); mo.observe();
    w.onMessage.addListener(() => n++); w.onChanged.addListener(() => n++);
    expect(w.guard.stats()).toEqual({ listeners: 2, timers: 2, observers: 1, chrome: 2 });
    w.state.id = undefined; // 扩展重载
    doc.fire("pointerdown");
    expect(n).toBe(0); expect(w.guard.dead).toBe(true);
    expect(doc.count("pointerdown")).toBe(0); expect(w.g.count("pagehide")).toBe(0);
    expect(w.timers.size).toBe(0); expect(w.observers[0].connected).toBe(false);
    expect(w.onMessage.s.size).toBe(0); expect(w.onChanged.s.size).toBe(0);
    expect(w.guard.stats()).toEqual({ listeners: 0, timers: 0, observers: 0, chrome: 0 });
    w.g.console.error("anything"); w.g.console.warn("x"); expect(w.logs).toEqual([]);
    // 停用后再挂监听 / 定时器都是空操作
    doc.addEventListener("click", () => n++); w.g.setTimeout(() => n++);
    expect(doc.count("click")).toBe(0); expect(w.timers.size).toBe(0);
});

test("SettingsStore 路径：防抖写盘定时器触发时上下文已失效 → 不执行 save，不报错；pagehide → flush 监听被移除", () => {
    const w = world(); cur = w.guard;
    let saves = 0; const save = () => { saves++; throw new Error("Extension context invalidated."); };
    w.g.addEventListener("pagehide", save); w.g.setTimeout(save);
    w.state.id = undefined;
    w.runTimers();
    expect(saves).toBe(0); expect(w.guard.dead).toBe(true); expect(w.g.count("pagehide")).toBe(0); expect(w.logs).toEqual([]);
});

test("SettingsStore logger.error(\"Failed to save settings:\", Error(context invalidated)) → 吞掉并停用", () => {
    const w = world(); cur = w.guard;
    w.g.addEventListener("keydown", () => { });
    w.g.console.error("%c Cat %c SettingsStore", "", "", "Failed to save settings:", new Error("Extension context invalidated."));
    expect(w.logs).toEqual([]); expect(w.guard.dead).toBe(true); expect(w.g.count("keydown")).toBe(0);
});

test("peek 路径：console.warn(\"[Cat] peek …\", Error(context invalidated)) → 吞掉并停用；之后的警告也静默", () => {
    const w = world(); cur = w.guard;
    w.g.console.warn("[Cat] peek peek:eligible", new Error("Extension context invalidated."));
    w.g.console.warn("[Cat] later");
    expect(w.logs).toEqual([]); expect(w.guard.dead).toBe(true);
});

test("监听里同步抛出 context invalidated（runtime.id 仍在）→ 停用并吞掉；其它异常照常抛出", () => {
    const w = world(); cur = w.guard;
    const doc = new w.ET();
    doc.addEventListener("x", () => { throw new Error("boom"); });
    expect(() => doc.fire("x")).toThrow("boom"); expect(w.guard.dead).toBe(false);
    doc.addEventListener("y", () => { throw new Error("Extension context invalidated."); });
    expect(() => doc.fire("y")).not.toThrow(); expect(w.guard.dead).toBe(true);
});

test("异步拒绝 context invalidated → 停用；未处理拒绝事件被 preventDefault", async () => {
    const w = world(); cur = w.guard;
    w.g.addEventListener("click", () => Promise.reject(new Error("Extension context invalidated.")));
    w.g.fire("click"); await Promise.resolve(); await Promise.resolve();
    expect(w.guard.dead).toBe(true);
    const w2 = world(); const g2 = w2.guard;
    let prevented = false;
    w2.g.fire("unhandledrejection", { reason: new Error("Extension context invalidated."), preventDefault: () => { prevented = true; } });
    expect(prevented).toBe(true); expect(g2.dead).toBe(true); g2.uninstall();
});

test("removeEventListener 用原函数也能移除包装后的监听（keepHover 换监听依赖）", () => {
    const w = world(); cur = w.guard;
    const doc = new w.ET(); const f = () => { };
    doc.addEventListener("click", f); expect(doc.count("click")).toBe(1);
    doc.removeEventListener("click", f); expect(doc.count("click")).toBe(0); expect(w.guard.stats().listeners).toBe(0);
});

test("content.ts：守卫是第一个 import，bootstrap 前检查存活", async () => {
    const src = await Bun.file("src/entries/content.ts").text();
    expect(src.split("\n")[0]).toBe('import { contentGuard } from "./contentGuardInstall";');
    expect(src).toContain('if (contentGuard.alive()) void bootstrap("content");');
});

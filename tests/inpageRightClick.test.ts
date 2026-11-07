/* 补丁 rightclick-native（t762u）：页内侧栏里右键标签 → 变回原生。根因 = 预热「首个可信手势」监听不看鼠标键，右键 pointerdown(button=2) 被当手势 → window 预热时 SW 窗口级 open 原生。
 * 纯逻辑（gestureGate.ts）直接测；接线（content.ts / panel.ts）按源码约束测。真机 = headed 脚本（见 README）。 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { PREWARM } from "../src/plugins/inpageSidebar/constants";
import { createGestureGate, detectMac, gestureListenEvents, isPrimaryGesture, MENU_HOLD_MS, shouldSendPrewarmGesture } from "../src/plugins/inpageSidebar/gestureGate";
import { shouldSendPrewarm } from "../src/plugins/inpageSidebar/logic";

const SRC = resolve(import.meta.dir, "../src");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const code = (f: string) => strip(readFileSync(resolve(SRC, f), "utf8"));

const C = (o: object = {}) => ({ prewarm: true, warm: false, active: true, nativeOpen: false, trusted: true, now: 10_000, lastSent: 0, resendMs: 2000, ...o });
const down = (button: number, o: object = {}) => ({ type: "pointerdown", button, ...o });
const key = (k: string, o: object = {}) => ({ type: "keydown", key: k, ...o });
const CTX = { type: "contextmenu" };

describe("isPrimaryGesture（事件本身算不算手势）", () => {
    test("pointerdown：button 0 算；button 1 / 2 / 3 / 4 不算", () => {
        expect(isPrimaryGesture(down(0))).toBe(true);
        for (const b of [1, 2, 3, 4]) expect(isPrimaryGesture(down(b))).toBe(false);
        expect(isPrimaryGesture({ type: "pointerdown" })).toBe(false); // 没有 button 字段 = 不当手势（宁可漏）
    });
    test("Mac 上 Ctrl+左键 = 右键：不算；非 Mac 上 Ctrl+左键照算", () => {
        expect(isPrimaryGesture(down(0, { ctrlKey: true }), true)).toBe(false);
        expect(isPrimaryGesture(down(0, { ctrlKey: true }), false)).toBe(true);
        expect(isPrimaryGesture(down(0, { ctrlKey: false }), true)).toBe(true);
    });
    test("keydown：普通键算；单独的修饰键 / 锁定键 / Escape / ContextMenu 键 / Shift+F10 不算", () => {
        for (const k of ["a", "S", "Enter", " ", "Tab", "ArrowDown", "F2", "Backspace", "1"]) expect(isPrimaryGesture(key(k))).toBe(true);
        for (const k of ["Shift", "Control", "Alt", "Meta", "AltGraph", "OS", "CapsLock", "Fn", "NumLock", "Escape", "ContextMenu"]) expect(isPrimaryGesture(key(k))).toBe(false);
        expect(isPrimaryGesture(key("F10", { shiftKey: true }))).toBe(false); expect(isPrimaryGesture(key("F10"))).toBe(true);
        expect(isPrimaryGesture({ type: "keydown" })).toBe(false);
    });
    test("Alt+S（页内侧栏快捷键）：Alt 单独按下不算；S（altKey）仍算 —— 快捷键本身走 chrome.commands，不经这里，行为同补丁前", () => {
        expect(isPrimaryGesture(key("Alt", { altKey: true }))).toBe(false);
        expect(isPrimaryGesture(key("s", { altKey: true }))).toBe(true);
    });
    test("其它事件类型（mousedown / click / contextmenu / pointerup / touchstart）不算", () => {
        for (const t of ["mousedown", "click", "auxclick", "contextmenu", "pointerup", "touchstart", "wheel"]) expect(isPrimaryGesture({ type: t, button: 0, key: "a" })).toBe(false);
    });
});

describe("gate：button=2 的 pointerdown 不触发预热；button=0 触发", () => {
    test("右键 pointerdown → false；左键 pointerdown → true（原行为保持）", () => {
        const g = createGestureGate();
        expect(g.accept(down(2), 1000)).toBe(false);
        expect(g.accept(down(0), 2000)).toBe(true);
    });
    test("合并判定（gate + shouldSendPrewarm）：右键不发、左键发；原有条件仍然生效", () => {
        const g = createGestureGate();
        expect(shouldSendPrewarmGesture(g, down(2), false, C())).toBe(false);
        expect(shouldSendPrewarmGesture(g, down(0), false, C())).toBe(true);
        for (const o of [{ prewarm: false }, { warm: true }, { active: false }, { nativeOpen: true }, { trusted: false }, { lastSent: 9000 }]) expect(shouldSendPrewarmGesture(createGestureGate(), down(0), false, C(o))).toBe(false);
    });
    test("Off 不受影响：prewarm=false 时左键 / 键盘照旧不发（gate 不会把 Off 变成发送），且 gate 对 shouldSendPrewarm 的结果只会「更少」不会「更多」", () => {
        for (const ev of [down(0), down(2), key("a"), key("Shift"), CTX]) {
            expect(shouldSendPrewarmGesture(createGestureGate(), ev, false, C({ prewarm: false }))).toBe(false);
            const gated = shouldSendPrewarmGesture(createGestureGate(), ev, false, C());
            if (gated) expect(shouldSendPrewarm(C())).toBe(true);
        }
    });
});

describe("gate：右键菜单期间不触发", () => {
    test("Linux / macOS 序列（pointerdown(2) → contextmenu）：右键本身不发；菜单里的第一次主手势（点菜单项 / 点外面）不发；之后恢复", () => {
        const g = createGestureGate();
        expect(g.accept(down(2), 1000)).toBe(false); expect(g.accept(CTX, 1001)).toBe(false);
        expect(g.accept(down(0), 3000)).toBe(false); // 点菜单项 / 关菜单的这一下
        expect(g.accept(down(0), 4000)).toBe(true); // 之后的主手势照旧
    });
    test("Windows 序列（pointerdown(2) → … → contextmenu 在 mouseup 之后）同样", () => {
        const g = createGestureGate();
        expect(g.accept(down(2), 1000)).toBe(false); expect(g.accept(CTX, 1100)).toBe(false);
        expect(g.accept(down(0), 1500)).toBe(false); expect(g.accept(down(0), 1600)).toBe(true);
    });
    test("键盘开菜单（ContextMenu 键 / Shift+F10 → contextmenu）：keydown 本身不发；Esc 关菜单后恢复", () => {
        const g = createGestureGate();
        expect(g.accept(key("ContextMenu"), 1000)).toBe(false); expect(g.accept(CTX, 1001)).toBe(false);
        expect(g.accept(key("ArrowDown"), 1500)).toBe(false); // 在菜单里按键（用掉闸门）
        expect(g.accept(key("a"), 1600)).toBe(true);
        const g2 = createGestureGate(); g2.accept(CTX, 1000);
        expect(g2.accept(key("Escape"), 1200)).toBe(false); // Esc 关菜单：本身不是手势，也放开闸门
        expect(g2.accept(down(0), 1300)).toBe(true);
    });
    test("菜单一直没被用掉：超过 MENU_HOLD_MS 后恢复（兜底：原生菜单关闭时 DOM 常收不到事件）", () => {
        const g = createGestureGate(); g.accept(CTX, 1000);
        expect(g.accept(down(0), 1000 + MENU_HOLD_MS - 1)).toBe(false);
        const g2 = createGestureGate(); g2.accept(CTX, 1000);
        expect(g2.accept(down(0), 1000 + MENU_HOLD_MS)).toBe(true);
        expect(MENU_HOLD_MS).toBeGreaterThan(0); expect(MENU_HOLD_MS).toBeLessThanOrEqual(120_000);
    });
    test("DOM 里有菜单（iframe 自己的 .arc-menu）：主手势不发；用掉后恢复", () => {
        const g = createGestureGate();
        expect(g.accept(down(0), 1000, true)).toBe(false); expect(g.accept(key("a"), 1100, true)).toBe(false);
        expect(g.accept(down(0), 1200, false)).toBe(true);
    });
    test("没有 contextmenu 时，普通左键 / 键盘 / 连续手势不受影响（节流由 shouldSendPrewarm 管，gate 不拦）", () => {
        const g = createGestureGate();
        for (let i = 0; i < 5; i++) expect(g.accept(down(0), 1000 + i)).toBe(true);
        expect(g.accept(key("a"), 2000)).toBe(true);
    });
    test("右键 pointerdown / 修饰键 / Esc 之外的无关事件不会提前放开闸门", () => {
        const g = createGestureGate(); g.accept(CTX, 1000);
        expect(g.accept(down(2), 1100)).toBe(false); expect(g.accept(key("Shift"), 1200)).toBe(false); expect(g.accept(key("Alt", { altKey: true }), 1210)).toBe(false);
        expect(g.accept(down(0), 1300)).toBe(false); // 闸门仍在 → 这次被用掉
        expect(g.accept(down(0), 1400)).toBe(true);
    });
    test("Mac 上 Ctrl+左键（= 右键，先 pointerdown 后 contextmenu）：不发", () => {
        const g = createGestureGate({ mac: true });
        expect(g.accept(down(0, { ctrlKey: true }), 1000)).toBe(false); expect(g.accept(CTX, 1001)).toBe(false);
        expect(g.accept(down(0), 1500)).toBe(false); expect(g.accept(down(0), 1600)).toBe(true);
    });
});

describe("监听事件 / 常量", () => {
    test("gestureListenEvents：在 PREWARM.gestureEvents 上加 contextmenu（已含则不重复）；PREWARM.gestureEvents 本身没改", () => {
        expect(PREWARM.gestureEvents).toEqual(["pointerdown", "keydown"]);
        expect(gestureListenEvents(PREWARM.gestureEvents)).toEqual(["pointerdown", "keydown", "contextmenu"]);
        expect(gestureListenEvents(["pointerdown", "contextmenu"])).toEqual(["pointerdown", "contextmenu"]);
    });
    test("detectMac：返回布尔，navigator 缺失时不抛（内容脚本 / SW / 测试环境）", () => { expect(typeof detectMac()).toBe("boolean"); });
});

describe("源码约束（接线）", () => {
    const ct = code("plugins/inpageSidebar/content.ts"), pn = code("plugins/inpageSidebar/panel.ts"), gg = code("plugins/inpageSidebar/gestureGate.ts");
    test("content.ts：onGesture 里先过 gate.accept，再 shouldSendPrewarm；监听 / 摘除都用 gestureListenEvents（含 contextmenu）", () => {
        const f = ct.slice(ct.indexOf("const onGesture"), ct.indexOf("const onLink"));
        expect(f.indexOf("gestureGate.accept(e, now)")).toBeGreaterThan(-1); expect(f.indexOf("gestureGate.accept")).toBeLessThan(f.indexOf("shouldSendPrewarm("));
        expect(ct).toMatch(/for \(const ev of gestureListenEvents\(PREWARM\.gestureEvents\)\) document\.addEventListener\(ev, onGesture, \{ capture: true, passive: true \}\);/);
        expect(ct).toMatch(/for \(const ev of gestureListenEvents\(PREWARM\.gestureEvents\)\) document\.removeEventListener\(ev, onGesture, \{ capture: true \}\);/);
        expect(ct).not.toMatch(/for \(const ev of PREWARM\.gestureEvents\)/);
    });
    test("panel.ts：iframe 里同样；并把「DOM 里有 .arc-menu 菜单」传给 gate", () => {
        const f = pn.slice(pn.indexOf("const onGesture"), pn.indexOf("NATIVE_SWITCH.viaClick"));
        expect(f.indexOf("gestureGate.accept(e, now,")).toBeGreaterThan(-1); expect(f.indexOf("gestureGate.accept")).toBeLessThan(f.indexOf("shouldSendPrewarm("));
        expect(f).toMatch(/document\.querySelector\("\.arc-menu:not\(\[hidden\]\)"\)/);
        expect(f).toMatch(/for \(const ev of gestureListenEvents\(PREWARM\.gestureEvents\)\)/);
        expect(pn).not.toMatch(/for \(const ev of PREWARM\.gestureEvents\)/);
    });
    test("不影响既有路径：onLink（链接点击切原生）、Alt+S / 命令路由、ensure-native 的代码没被动", () => {
        expect(ct).toMatch(/if \(!a \|\| \(e\.button !== 0 && e\.button !== 1\) \|\| !linkNeedsNative/);
        expect(ct).toMatch(/document\.addEventListener\("click", onLink, \{ capture: true, passive: true \}\);/);
        expect(ct).toMatch(/document\.addEventListener\("auxclick", onLink, \{ capture: true, passive: true \}\);/);
    });
    test("gestureGate.ts：纯逻辑——只 import ./logic；无 chrome.* / 无控制台 / 无 DOM 访问（navigator 仅在 detectMac 里、带 typeof 守卫）", () => {
        expect(gg.match(/^import .*$/gm)).toEqual(['import { shouldSendPrewarm } from "./logic";']);
        expect(gg).not.toMatch(/chrome\.|console\.|document\.|window\./); expect((gg.match(/navigator/g) ?? []).length).toBe(2);
    });
});

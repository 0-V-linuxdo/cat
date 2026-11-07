/* 预热「首个可信手势」的过滤（补丁 rightclick-native，t762u）。纯逻辑：不 import chrome / DOM，单测见 tests/inpageRightClick.test.ts。
 * 背景：content.ts / panel.ts 的 onGesture 原来对任何 isTrusted 的 pointerdown / keydown 都当「首个手势」→ 预热 = window 时 SW 窗口级 open 原生（页内按互斥让位收起）。
 * 右键标签的 pointerdown(button=2) 因此把页内侧栏换成了原生。这里只放行「主键 pointerdown」和「真正的按键 keydown」，并在右键菜单期间不放行。
 * ⚠ 不处理的：Window 方式下**左键首击仍然会预热**（设计如此，见 constants.PREWARM.defaultMode 注释）；触屏长按（pointerdown button=0 先于 contextmenu）无法事先区分。 */
import { shouldSendPrewarm } from "./logic";

/** 单独按下不算手势的键：修饰键 / 锁定键；Escape 不是 user-activation 触发键（SW 里 open 会因无手势失败），ContextMenu 键只是弹菜单 */
const NON_GESTURE_KEYS: ReadonlySet<string> = new Set([
    "Shift", "Control", "Alt", "Meta", "AltGraph", "OS", "Hyper", "Super", "Fn", "FnLock", "CapsLock", "NumLock", "ScrollLock", "Symbol", "SymbolLock",
    "Escape", "ContextMenu",
]);

/** contextmenu 之后多久内（或直到下一次主手势把它「用掉」）算菜单期间。上限只是兜底：原生菜单关闭时 DOM 往往收不到事件（macOS 一个都没有），不能无限等 */
export const MENU_HOLD_MS = 60_000;

export interface GestureLike { type: string; button?: number; key?: string; ctrlKey?: boolean; shiftKey?: boolean }

/** 平台是不是 Mac（Ctrl+左键在 Mac 上是右键）。⚠ Chromium 是否把 Ctrl+左键的 pointerdown 报成 button=2 没查证，这里保守地一并忽略 */
export const detectMac = (): boolean => typeof navigator !== "undefined" && /Mac|iPhone|iPad/i.test(navigator.platform || "");

/** 事件本身算不算手势（不看菜单状态）：pointerdown 只认主键（button 0；Mac 上 Ctrl+左键 = 右键不算）；keydown 排除修饰键 / Escape / ContextMenu / Shift+F10；其它事件类型都不算 */
export function isPrimaryGesture(e: GestureLike, mac = false): boolean {
    if (e.type === "pointerdown") return e.button === 0 && !(mac && e.ctrlKey);
    if (e.type === "keydown") return !!e.key && !NON_GESTURE_KEYS.has(e.key) && !(e.key === "F10" && e.shiftKey);
    return false;
}

export interface GestureGate {
    /** 这个事件能不能当预热手势。contextmenu 事件：记下菜单开始，返回 false。菜单期间（contextmenu 之后、DOM 里有菜单、或还没被下一次主手势用掉）：返回 false，且这次主手势 / Esc 把闸门放开 */
    accept(e: GestureLike, now: number, menuDomOpen?: boolean): boolean;
}
export function createGestureGate(o: { mac?: boolean; holdMs?: number } = {}): GestureGate {
    const holdMs = o.holdMs ?? MENU_HOLD_MS; let ctxAt = Number.NEGATIVE_INFINITY;
    return {
        accept(e, now, menuDomOpen = false) {
            if (e.type === "contextmenu") { ctxAt = now; return false; }
            if (e.type === "keydown" && e.key === "Escape") { ctxAt = Number.NEGATIVE_INFINITY; return false; } // Esc 关菜单：菜单期间结束
            if (!isPrimaryGesture(e, o.mac)) return false; // 右键 pointerdown / 修饰键等：不动闸门（Linux / macOS 上它先于 contextmenu 到达，Windows 上在后）
            if (menuDomOpen || now - ctxAt < holdMs) { ctxAt = Number.NEGATIVE_INFINITY; return false; } // 关菜单 / 点菜单项的这一下手势：不预热，之后恢复
            return true;
        },
    };
}

/** 监听哪些事件：PREWARM.gestureEvents + contextmenu（闸门要看到它） */
export const gestureListenEvents = (base: readonly string[]): readonly string[] => base.includes("contextmenu") ? base : [...base, "contextmenu"];

/** 合并判定（单测用，也是 content / panel 里「gate.accept → shouldSendPrewarm」两步的等价物）：先过闸门，再过原有条件 */
export function shouldSendPrewarmGesture(gate: GestureGate, e: GestureLike, menuDomOpen: boolean, c: Parameters<typeof shouldSendPrewarm>[0]): boolean {
    return gate.accept(e, c.now, menuDomOpen) && shouldSendPrewarm(c);
}

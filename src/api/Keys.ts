/* 快捷键组合的规范化。"Mod" = macOS 上的 ⌘，其它平台上的 Ctrl */
export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

const ORDER = ["Ctrl", "Meta", "Alt", "Shift"];

export function normalizeCombo(combo: string): string {
    const parts = combo.split("+").map(p => p.trim()).filter(Boolean);
    let key = parts.pop() ?? "";
    if (combo.endsWith("++")) key = "+";
    const mods = new Set<string>(parts.map(m => {
        const l = m.toLowerCase();
        if (l === "mod") return isMac ? "Meta" : "Ctrl";
        if (l === "cmd" || l === "meta" || l === "⌘") return "Meta";
        if (l === "control" || l === "ctrl") return "Ctrl";
        if (l === "option" || l === "alt") return "Alt";
        return "Shift";
    }));
    return [...ORDER.filter(m => mods.has(m)), key.length === 1 ? key.toUpperCase() : key].join("+");
}

export function eventToCombo(e: KeyboardEvent): string | null {
    if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return null;
    let key = e.code.startsWith("Key") ? e.code.slice(3)
        : e.code.startsWith("Digit") ? e.code.slice(5)
            : e.code === "Equal" ? "=" : e.code === "Minus" ? "-" : e.key;
    if (key.length === 1) key = key.toUpperCase();
    const mods = [e.ctrlKey && "Ctrl", e.metaKey && "Meta", e.altKey && "Alt", e.shiftKey && "Shift"].filter(Boolean);
    if (!mods.length && !/^F\d+$/.test(key)) return null;
    return [...mods, key].join("+");
}

const ARROWS: Record<string, string> = { ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓", Comma: ",", Equal: "=", Minus: "-" };
export function prettyCombo(c: string): string {
    const n = normalizeCombo(c);
    const parts = n.split("+");
    let key = parts.pop() ?? "";
    if (n.endsWith("++")) key = "+";
    key = ARROWS[key] ?? key;
    if (!isMac) return [...parts.filter(Boolean), key].join("+");
    const sym: Record<string, string> = { Ctrl: "⌃", Alt: "⌥", Shift: "⇧", Meta: "⌘" };
    return parts.filter(Boolean).map(m => sym[m] ?? m).join("") + key;
}

/** 菜单里的快捷键列：Mac 本来就是 ⌃⌥⇧⌘ 符号；其他平台把 Shift / Alt 缩成 ⇧ / ⌥（保留 Ctrl），避免窄侧栏里“Ctrl+Alt+Shift+C”撑出菜单 */
export function menuCombo(pretty: string): string {
    if (isMac || !pretty) return pretty;
    return pretty.replace(/Shift\+/g, "⇧").replace(/Alt\+/g, "⌥").replace(/Ctrl\+/g, "Ctrl ");
}

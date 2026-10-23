/* MultiSelect 的纯逻辑：⌘/Ctrl 单击切换、Shift 单击按可见顺序连续选择 */
export type ClickMode = "toggle" | "range";

export function applyClick(order: string[], sel: ReadonlySet<string>, anchor: string | null, key: string, mode: ClickMode) {
    const next = new Set(sel);
    if (mode === "toggle") {
        if (next.has(key)) next.delete(key); else next.add(key);
        return { sel: next, anchor: key };
    }
    const a = anchor != null && order.includes(anchor) ? order.indexOf(anchor) : order.indexOf(key);
    const b = order.indexOf(key);
    if (b < 0) return { sel: next, anchor };
    const [lo, hi] = a <= b ? [a, b] : [b, a];
    return { sel: new Set(order.slice(lo, hi + 1)), anchor: anchor ?? key };
}

/** 按可见顺序输出选中项，并拆成 Today 标签 id 与固定项 id */
export function splitKeys(order: string[], sel: ReadonlySet<string>) {
    const keys = order.filter(k => sel.has(k));
    return {
        keys,
        tabIds: keys.filter(k => k.startsWith("tab:")).map(k => Number(k.slice(4))),
        pinIds: keys.filter(k => k.startsWith("pin:")).map(k => k.slice(4)),
    };
}

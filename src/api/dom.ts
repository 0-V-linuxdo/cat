/* 极小的 DOM 构造器：核心不依赖任何 UI 框架 */
type Child = Node | string | number | null | undefined | false | Child[];
type Props = Record<string, unknown> & { class?: string; style?: string };

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props?: Props | null, ...children: Child[]): HTMLElementTagNameMap[K] {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props ?? {})) {
        if (v == null || v === false) continue;
        if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
        else if (k === "class") el.className = String(v);
        else if (k in el && k !== "style" && !k.startsWith("data-") && !k.startsWith("aria-")) (el as unknown as Record<string, unknown>)[k] = v;
        else el.setAttribute(k, v === true ? "" : String(v));
    }
    append(el, children);
    return el;
}

function append(el: Node, children: Child[]) {
    for (const c of children) {
        if (c == null || c === false) continue;
        if (Array.isArray(c)) append(el, c);
        else el.appendChild(typeof c === "object" ? c : document.createTextNode(String(c)));
    }
}

let styleHost: HTMLElement | null = null;
const styles = new Map<string, HTMLStyleElement>();
export function enableStyle(id: string, css: string) {
    let s = styles.get(id);
    if (!s) {
        s = document.createElement("style");
        s.dataset.arcStyle = id;
        styles.set(id, s);
        (styleHost ??= document.head ?? document.documentElement).appendChild(s);
    }
    s.textContent = css;
}
export function disableStyle(id: string) { styles.get(id)?.remove(); styles.delete(id); }

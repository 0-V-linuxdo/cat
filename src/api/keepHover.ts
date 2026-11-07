/*
 * 整屏重绘时保住悬停：PanelShell.renderAll 每次标签变化（标题 / favicon / 加载状态…）都整棵重建侧栏，
 * 指针下的行被换成新节点 → :hover 丢失（鼠标不动时浏览器不会重新命中），用户看到“悬停态过一会儿自己没了”。
 * 做法：只针对当前悬停的那一行（最近的带 data-sel / data-test 的祖先），把旧节点留在原位、按新节点就地同步
 * 属性 / 子树，并把渲染时登记的事件监听换成新的（避免旧闭包里的过期数据）。其余节点照旧整棵替换。
 */
type Rec = { type: string; fn: EventListenerOrEventListenerObject; opts?: boolean | AddEventListenerOptions };
const recorded = new WeakMap<EventTarget, Rec[]>();

/** 同步执行 fn，期间登记所有 addEventListener（只给 keepHover 换监听用） */
export function recordListeners<T>(fn: () => T): T {
    const proto = EventTarget.prototype, orig = proto.addEventListener;
    proto.addEventListener = function (this: EventTarget, type: string, f: EventListenerOrEventListenerObject | null, opts?: boolean | AddEventListenerOptions) {
        if (f) { let l = recorded.get(this); if (!l) recorded.set(this, l = []); l.push({ type, fn: f, opts }); }
        return orig.call(this, type, f as EventListenerOrEventListenerObject, opts);
    } as typeof proto.addEventListener;
    try { return fn(); } finally { proto.addEventListener = orig; }
}

/** 悬停中的行被 morphInto 就地同步完后派发：行上由 JS 运行时写的悬停态（data-hz 等）被 syncAttrs 摘掉了，让行按最近的指针位置自己重判 */
export const REHOVER = "arc-rehover";

const rowKey = (e: Element) => e.getAttribute("data-sel") ?? e.getAttribute("data-folder");
const keyOf = (e: Element) => e.getAttribute("data-sel") ?? e.getAttribute("data-test");
/** 本模块不碰的属性：ArcTooltip 自己维护（data-tip 已被转走、aria-label 由它补） */
const SKIP = new Set(["aria-label", "data-tip"]);

function swapListeners(old: Element, nu: Element) {
    for (const r of recorded.get(old) ?? []) old.removeEventListener(r.type, r.fn, r.opts);
    const fresh = recorded.get(nu) ?? [];
    for (const r of fresh) old.addEventListener(r.type, r.fn, r.opts);
    recorded.set(old, fresh.slice());
}

function syncAttrs(old: Element, nu: Element) {
    for (const a of Array.from(old.attributes)) if (!SKIP.has(a.name) && !nu.hasAttribute(a.name)) old.removeAttribute(a.name);
    for (const a of Array.from(nu.attributes)) {
        if (a.name === "data-tip") { if (old.getAttribute("aria-label") !== a.value) old.setAttribute("data-tip", a.value); continue; }
        if (a.name === "aria-label" || old.getAttribute(a.name) !== a.value) old.setAttribute(a.name, a.value);
    }
    if (old instanceof HTMLInputElement && nu instanceof HTMLInputElement) old.value = nu.value;
}

/** 把 nu 的内容就地并入 old（old 保留身份）；子节点同标签 / 同 key 时递归保留，否则换新 */
const ROW = "[data-sel], [data-folder], .arc-row, .arc-folder-head, .arc-fav-tile";
const POPUP = "[aria-haspopup], .arc-menu";
export function morphInto(old: Element, nu: Element, keepOwnListeners = false) {
    syncAttrs(old, nu); if (!keepOwnListeners) swapListeners(old, nu); // keepOwnListeners：只同步属性 + 子树，自身监听保留旧的（见 commitKeepingHover 的按钮分支）
    const oc = Array.from(old.childNodes), nc = Array.from(nu.childNodes);
    const byKey = new Map<string, Element>();
    for (const c of oc) if (c instanceof Element && rowKey(c)) byKey.set(rowKey(c)!, c);
    const used = new Set<Node>();
    const out: Node[] = nc.map((n, i) => {
        const rk = n instanceof Element ? rowKey(n) : null;
        const o = rk ? byKey.get(rk) : (used.has(oc[i]) ? undefined : oc[i]);
        if (o) used.add(o);
        if (o && o.nodeType === 3 && n.nodeType === 3) { if (o.nodeValue !== n.nodeValue) o.nodeValue = n.nodeValue; return o; }
        if (o instanceof Element && n instanceof Element && o.tagName === n.tagName && keyOf(o) === keyOf(n) && o.namespaceURI === n.namespaceURI) {
            if (o.namespaceURI !== "http://www.w3.org/1999/xhtml") return n; // svg 图标直接换新
            if (n.matches(POPUP) || n.querySelector(POPUP)) return n; // 带弹出菜单的控件：按钮闭包捕获新树里的菜单，整块换新（52025 回归）
            if (n.matches("button, [role=button]") && !n.matches(ROW)) return n; // 子按钮换新：其闭包常捕获自身（52025：today-clear setPointerCapture 打在游离新节点上）
            morphInto(o, n); return o;
        }
        return n;
    });
    if (out.length !== oc.length || out.some((n, i) => n !== oc[i])) old.replaceChildren(...out);
    if (old.classList.contains("arc-row") && old.matches(":hover")) old.dispatchEvent(new Event(REHOVER));
}

const INTERACTIVE = "[data-sel], [data-folder], .arc-row, .arc-folder-head, .arc-fav-tile, [draggable=true], button, a, [role=button], [role=menuitem]";
/** 当前悬停链上要保留的元素（在 root 内）：最外层带 key 的可交互元素（行 / 按钮）；否则最深的可交互元素；再否则最深的悬停元素 */
export function hoveredKeyed(root: Element): Element | null {
    const hov = Array.from(root.querySelectorAll(":hover"));
    return hov.find(e => keyOf(e) && e.matches(INTERACTIVE)) ?? hov.filter(e => e.matches(INTERACTIVE)).at(-1) ?? hov.at(-1) ?? null;
}

const levelKey = (e: Element) => e.getAttribute("data-sel") ?? e.getAttribute("data-folder") ?? e.getAttribute("data-test") ?? e.getAttribute("data-slot") ?? e.getAttribute("data-plugin");
/** 无 key 时只比第一个 class（open / sel / active 之类状态 class 会变） */
const cls0 = (e: Element) => (e.getAttribute("class") ?? "").trim().split(/\s+/)[0] ?? "";
const sameLevel = (o: Element, n: Node): n is Element => n instanceof Element && n.tagName === o.tagName && (levelKey(o) ?? cls0(o)) === (levelKey(n) ?? cls0(n));

/** parent 的子节点改成 list（list 里已含 keep），全程不把 keep 移出文档（移出会让浏览器丢掉 :hover） */
function spliceAround(parent: Node, keep: Node, list: Node[]) {
    for (const c of Array.from(parent.childNodes)) if (c !== keep) parent.removeChild(c);
    const k = list.indexOf(keep);
    for (let j = 0; j < k; j++) parent.insertBefore(list[j], keep);
    let ref: Node | null = keep.nextSibling;
    for (let j = k + 1; j < list.length; j++) { parent.insertBefore(list[j], ref); }
}

/**
 * 用新树 frag 更新 root，但悬停元素 hovered 及其祖先链保持原节点、原位不动（不离开文档）：
 * 每一层祖先就地同步属性 / 监听、把兄弟换成新的；悬停元素本身 morphInto。找不到对应链时返回 false（调用方照常整棵替换）。
 */
export function commitKeepingHover(root: Element, frag: Node[], hovered: Element | null, fresh = false): boolean {
    if (!hovered || !root.contains(hovered)) return false;
    // 带弹出菜单的按钮（+ 等）：它的监听闭包捕获了新树里的菜单 / 按钮节点，换到旧节点上会指向游离的新菜单（52024 回归：+ → 新建空间 → Esc → 再点 + 菜单不出）。
    // 这类控件不保留，退到父层，让按钮和菜单一起换新
    const popup = hovered.closest(POPUP); // 也含菜单本身：悬停在关闭中的菜单项上重绘时，旧菜单不能留下配新按钮
    if (popup && popup !== root && root.contains(popup)) { const p = popup.parentElement; return p && p !== root ? commitKeepingHover(root, frag, p, true) : false; }
    const chain: Element[] = [];
    for (let e: Element | null = hovered; e && e !== root; e = e.parentElement) chain.unshift(e);
    const news: Element[] = [];
    let pool: Node[] = frag;
    for (const o of chain) {
        // 有 key 按 key 找；没有 key 的按“同类兄弟里的第几个”找（避免把第一个同类节点的内容并进悬停节点）
        const nth = (list: Node[], e: Element) => list.filter(x => sameLevel(e, x)).indexOf(e);
        const n = (levelKey(o) ? pool.find(x => sameLevel(o, x)) : pool.filter(x => sameLevel(o, x))[nth(Array.from(o.parentNode?.childNodes ?? []), o)]) as Element | undefined;
        if (!n) { const i = chain.indexOf(o); return i > 0 ? commitKeepingHover(root, frag, chain[i - 1], fresh) : false; } // 悬停节点在新树里没了（如该标签已关）：退一层，保住祖先
        news.push(n); pool = Array.from(n.childNodes);
    }
    // 先算好每层的新子节点列表（把新链节点换成旧链节点），最后自底向上提交
    // 非“行”的控件（按钮等）：闭包常捕获自身（setPointerCapture、classList…），换上新监听会指向游离新节点（52025：today-clear InvalidStateError）。
    // 这类保留旧节点 + 旧监听 + 旧子树，整体自洽，只是这一帧状态可能旧一点；下次指针离开后的重绘即换新
    const last = chain.at(-1)!;
    /* rel42 hover-rerender：原先“原样保留”整块不动 → 悬停中的按钮状态 / 内容停在旧的（Space 圆点点了之后 active 不跟过来、地址栏换域名后文字和
     * 复制链接按钮里的 URL 都是旧的，直到指针离开后的下一次重绘）。现在：自身监听仍保留旧的（闭包捕获自身，52025 不复发），
     * 属性（class / data-* / aria）和子节点照新树同步（子按钮换新，其闭包捕获的就是进了文档的它自己）。 */
    if (!fresh && last.matches("button, [role=button]") && !last.matches(ROW) && !last.querySelector(ROW)) morphInto(last, news.at(-1)!, true);
    else if (fresh) { const o = chain.at(-1)!, n = news.at(-1)!; syncAttrs(o, n); swapListeners(o, n); o.replaceChildren(...Array.from(n.childNodes)); } // 子树整体换新（不 morph：避免旧按钮配新闭包）
    else morphInto(chain.at(-1)!, news.at(-1)!);
    for (let i = chain.length - 2; i >= 0; i--) {
        const o = chain[i], n = news[i];
        syncAttrs(o, n); swapListeners(o, n);
        // 同层的行（data-sel / data-folder）也按 key 复用旧节点：被挤开的行保持身份，只就地更新
        const olds = new Map<string, Element>();
        for (const c of Array.from(o.children)) { const k = rowKey(c); if (k && c !== chain[i + 1]) olds.set(k, c); }
        spliceAround(o, chain[i + 1], Array.from(n.childNodes).map(c => {
            if (c === news[i + 1]) return chain[i + 1];
            const k = c instanceof Element ? rowKey(c) : null, prev = k ? olds.get(k) : undefined;
            if (prev && prev.tagName === (c as Element).tagName) { olds.delete(k!); morphInto(prev, c as Element); return prev; }
            return c;
        }));
    }
    spliceAround(root, chain[0], frag.map(c => c === news[0] ? chain[0] : c));
    return true;
}

/*
 * 自绘菜单（右键菜单 / 子菜单 / 下拉框共用）：扩展里不使用原生 <select>，菜单外观随浅色 / 深色主题。
 * openMenu(位置, 项)：项可带 submenu（悬停或点击展开到右侧）、separator、checked、danger。
 */
import "@components/ArcTooltip";
import { safe } from "@api/ErrorLog";
import { tr } from "@api/i18n";
import { restoreFocus } from "@api/FocusPolicy";
import { h } from "@api/dom";
import { icon } from "@api/icons";
import { menuCombo } from "@api/Keys";

export interface MenuEntry {
    label: string;
    run?(): unknown;
    submenu?: MenuEntry[];
    checked?: boolean;
    danger?: boolean;
    separator?: boolean;
    /** 不可用（灰显，悬停显示 title 说明原因） */
    disabled?: boolean;
    title?: string;
    test?: string;
    /** 右侧显示的快捷键（已格式化） */
    shortcut?: string;
}

let open: HTMLElement[] = [];
let wired = false;
/**
 * 点菜单外面：只关闭菜单，不把这次点击交给下面的元素（同 Arc / macOS 菜单）。
 * 在捕获阶段吞掉 pointerdown / mousedown，并吞掉紧随其后的那一次 click。
 */
export function swallowOutside(isOpen: () => boolean, isInside: (t: Node) => boolean, close: () => void) {
    const down = (e: Event) => {
        const t = e.target as Node | null;
        if (!isOpen() || !t || isInside(t)) return;
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation?.();
        if (e.type === "pointerdown") {
            close();
            const eat = (c: Event) => { c.preventDefault(); c.stopPropagation(); c.stopImmediatePropagation?.(); };
            document.addEventListener("click", eat, { capture: true, once: true });
            document.addEventListener("auxclick", eat, { capture: true, once: true });
            setTimeout(() => { document.removeEventListener("click", eat, true); document.removeEventListener("auxclick", eat, true); }, 400);
        }
    };
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("mousedown", down, true);
    return () => { document.removeEventListener("pointerdown", down, true); document.removeEventListener("mousedown", down, true); };
}
/** 打开菜单前的焦点（键盘用户关闭菜单后回到这里） */
let opener: HTMLElement | null = null;

export function closeMenus(depth = 0) {
    const hadFocus = open.slice(depth).some(m => m.contains(document.activeElement));
    for (const m of open.splice(depth)) m.remove();
    // 52148 防护：整层关闭时顺带清掉不在栈里的残留菜单 / 子菜单（只清 openMenu 挂在 body 下的）
    if (depth === 0) document.querySelectorAll("body > .arc-menu").forEach(m => m.remove());
    if (hadFocus) {
        const back = depth > 0 ? open[depth - 1]?.querySelector<HTMLElement>(".arc-menu-item.sub-open") : opener;
        restoreFocus(back); // 只在键盘导航时把焦点还给触发元素
    }
    if (!open.length) opener = null;
}

const FOCUSABLE = "button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex='-1'])";
/** 键盘：↑↓ / Home / End 在项之间移动；→ 展开子菜单；← 关闭子菜单；Tab 在面板内循环 */
function wireKeys(menu: HTMLElement, depth: number) {
    menu.addEventListener("keydown", e => {
        const items = [...menu.querySelectorAll<HTMLElement>(":scope > .arc-menu-item:not(.disabled)")];
        const i = items.indexOf(document.activeElement as HTMLElement);
        const go = (n: number) => { e.preventDefault(); e.stopPropagation(); items[(n + items.length) % items.length]?.focus(); };
        if (items.length && e.key === "ArrowDown") go(i + 1);
        else if (items.length && e.key === "ArrowUp") go(i < 0 ? items.length - 1 : i - 1);
        else if (items.length && e.key === "Home") go(0);
        else if (items.length && e.key === "End") go(items.length - 1);
        else if (e.key === "ArrowRight" && (document.activeElement as HTMLElement)?.classList.contains("has-sub")) {
            e.preventDefault(); e.stopPropagation(); (document.activeElement as HTMLElement).click();
            open[depth + 1]?.querySelector<HTMLElement>(".arc-menu-item:not(.disabled)")?.focus();
        } else if (e.key === "ArrowLeft" && depth > 0) { e.preventDefault(); e.stopPropagation(); closeMenus(depth); }
        else if (e.key === "Tab" && menu.classList.contains("arc-panel")) {
            const f = [...menu.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(x => x.offsetParent !== null);
            if (!f.length) return;
            const j = f.indexOf(document.activeElement as HTMLElement);
            e.preventDefault(); e.stopPropagation();
            f[(j + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus();
        }
    });
}
/** 打开后把焦点放进菜单（第一项 / 面板里第一个可聚焦元素），键盘可直接操作 */
export function focusMenu(menu: HTMLElement) {
    // 普通菜单（同 macOS NSMenu）：打开时不预先高亮任何项，焦点放在菜单本身；按 ↓ 从第一项开始
    if (!menu.classList.contains("arc-panel") && menu.querySelector(".arc-menu-item")) { menu.tabIndex = -1; menu.style.outline = "none"; menu.focus({ preventScroll: true }); return; }
    const first = menu.querySelector<HTMLElement>(".arc-menu-item:not(.disabled)") ?? menu.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus({ preventScroll: true });
}

function place(el: HTMLElement, x: number, y: number, flipFrom?: DOMRect) {
    document.body.appendChild(el);
    clamp(el, x, y, flipFrom);
    // 51998：内容在定位之后才填充 / 改变（如图标选择器 draw()、Emoji 页切换）→ 尺寸变了重新收进视口
    if (typeof ResizeObserver !== "undefined" && !el.dataset.clampObs) {
        el.dataset.clampObs = "1";
        // 52187：RO 回调只排合并的 rAF，不同步改 left/top/maxHeight（避免 ResizeObserver loop）；断开后停止
        let raf = 0;
        const ro = new ResizeObserver(() => {
            if (!el.isConnected) { ro.disconnect(); return; }
            if (!raf) raf = requestAnimationFrame(() => { raf = 0; if (el.isConnected) clamp(el, x, y, flipFrom); else ro.disconnect(); });
        });
        ro.observe(el);
    }
}

function clamp(el: HTMLElement, x: number, y: number, flipFrom?: DOMRect) {
    const { innerWidth: W, innerHeight: H } = window;
    /* 51998 布局防护：比视口还高的菜单 / 面板收进视口并自身滚动（边距 4 = 下面定位用的同一边距；⛔源码未找到（布局防护）） */
    // 用 offset 尺寸（不受打开动画 scale 影响，否则会少算高度、底部出视口）
    if (el.offsetHeight > H - 8) {
        el.style.boxSizing = "border-box"; el.style.maxHeight = `${H - 8}px`; el.style.overflowY = "auto"; el.style.overscrollBehavior = "contain";
    }
    const r = { width: el.offsetWidth, height: el.offsetHeight };
    const left = flipFrom && x + r.width > W - 4 ? flipFrom.left - r.width + 2 : Math.min(x, W - r.width - 4);
    el.style.left = `${Math.max(4, left)}px`;
    el.style.top = `${Math.max(4, Math.min(y, H - r.height - 4))}px`;
}

function build(items: MenuEntry[], depth: number, keep = 0): HTMLElement {
    const menu = h("div", { class: `arc-menu${depth ? " arc-submenu" : ""}`, role: "menu", "data-depth": depth });
    // 分隔线只出现在两组之间：去掉开头 / 结尾 / 连续的分隔线（如 Move to 只有 New Space… 时不留孤立分隔线）
    if (items.some(x => !x.separator)) items = items.filter((x, i, a) => !x.separator || (i > 0 && !a[i - 1]!.separator && a.slice(i + 1).some(y => !y.separator)));
    for (const it of items) {
        if (it.separator) { menu.append(h("div", { class: "arc-menu-sep", role: "separator" })); continue; }
        const btn = h("button", {
            class: `arc-menu-item${it.submenu ? " has-sub" : ""}${it.danger ? " danger" : ""}${it.checked ? " checked" : ""}`,
            role: "menuitem", "data-test": it.test, "aria-haspopup": it.submenu ? "menu" : null,
            "aria-disabled": it.disabled ? "true" : null, "data-tip": it.title || null,
        }, h("span", { class: "arc-menu-label" }, tr(it.label)), it.shortcut ? h("kbd", { class: "arc-menu-kbd" }, menuCombo(it.shortcut)) : null, it.submenu ? icon("chevronRightRegular") : null); // 子菜单箭头 Regular：Arc 为系统 NSMenu，箭头较细（Cat 定）；字号/粗细出处 ⛔ 源码未找到
        if (it.disabled) btn.classList.add("disabled");
        const openSub = () => {
            closeMenus(depth + 1);
            menu.querySelectorAll(".sub-open").forEach(x => x.classList.remove("sub-open"));
            if (!it.submenu?.length) return;
            btn.classList.add("sub-open");
            const r = btn.getBoundingClientRect();
            const sub = build(it.submenu, depth + 1, keep);
            open.push(sub);
            place(sub, r.right - 2, r.top - 4, menu.getBoundingClientRect());
        };
        btn.addEventListener("mouseenter", () => { if (!it.disabled) btn.focus({ preventScroll: true }); if (it.submenu && !it.disabled) openSub(); else closeMenus(depth + 1); });
        btn.addEventListener("click", e => {
            e.stopPropagation();
            if (it.disabled) return;
            if (it.submenu) { openSub(); return; }
            closeMenus(keep);
            void safe(Promise.resolve().then(() => it.run?.()), `menu:${it.test ?? it.label}`); // 51998：菜单项异步失败不再 Uncaught
        });
        menu.append(btn);
    }
    wireKeys(menu, depth);
    return menu;
}

export function openMenu(at: { x: number; y: number }, items: MenuEntry[], cls = "") {
    const prev = document.activeElement as HTMLElement | null;
    closeMenus();
    if (!items.length) return null;
    opener = prev && prev !== document.body ? prev : null;
    if (!wired) {
        wired = true;
        swallowOutside(() => open.length > 0, t => open.some(m => m.contains(t)) || (opener instanceof HTMLButtonElement && opener.contains(t)), () => closeMenus());
        document.addEventListener("click", () => closeMenus());
        document.addEventListener("keydown", e => { if (e.key === "Escape" && open.length) { e.stopPropagation(); closeMenus(); } }, true);
        window.addEventListener("blur", () => closeMenus());
    }
    const menu = build(items, 0);
    if (cls) menu.classList.add(...cls.split(" ").filter(Boolean));
    open.push(menu);
    place(menu, at.x, at.y);
    /* 52159 实机高危：焦点在网页时右键侧栏，侧栏文档拿不到焦点（右键不激活侧栏）。若当前网页没有内容脚本
     * （helium:// / chrome:// / 新标签页 / 商店 / PDF，或扩展重载后的旧标签），Esc 和网页点击都无法转发，
     * 侧栏又没有焦点可失去（window blur 不触发）→ 菜单卡住。打开时主动把焦点拉进侧栏：之后 Esc 直接到侧栏，
     * 点网页 = 侧栏失焦 → 上面的 blur 关闭整层。 */
    // 已知平台限制（52163 实机）：Helium 忽略侧栏 window.focus()；焦点在内部页（helium:// 等，无内容脚本）时，Esc / 点网页无法关闭菜单，
    // 点侧栏空白处可关闭。Cat 定：不加指针离开即关闭（Arc 没有）。保留下行（无害）。
    if (typeof document.hasFocus === "function" && !document.hasFocus()) { try { window.focus(); } catch { /* 不支持：仍有内容脚本转发兜底 */ } }
    queueMicrotask(() => { if (menu.isConnected && !menu.classList.contains("arc-panel")) focusMenu(menu); });
    return menu;
}

/** 在已打开的面板之上再弹一层菜单（面板不关闭）；keepPanel = 选中后仍保留面板 */
export function openSubMenu(at: { x: number; y: number }, items: MenuEntry[], cls = "", keepPanel = true) {
    if (!open.length) return openMenu(at, items, cls);
    closeMenus(1);
    const menu = build(items, 1, keepPanel ? 1 : 0);
    if (cls) menu.classList.add(...cls.split(" ").filter(Boolean));
    menu.addEventListener("click", e => e.stopPropagation());
    open.push(menu);
    place(menu, at.x, at.y);
    queueMicrotask(() => { if (menu.isConnected) focusMenu(menu); });
    return menu;
}

/** 自定义内容的弹出面板（图标 / 颜色选择器、分享面板）：外观同菜单，点外部或 Esc 关闭 */
export function openPanel(at: { x: number; y: number }, content: HTMLElement[], cls = "") {
    openMenu({ x: at.x, y: at.y }, [{ label: "", separator: true }]);
    const menu = open[0];
    if (!menu) return null;
    menu.replaceChildren(...content);
    menu.classList.add("arc-panel", ...cls.split(" ").filter(Boolean));
    menu.addEventListener("click", e => e.stopPropagation());
    place(menu, at.x, at.y);
    queueMicrotask(() => { if (menu.isConnected && !menu.contains(document.activeElement)) focusMenu(menu); });
    return menu;
}

/** 下拉框（替代原生 <select>）：按钮显示当前值，点击弹出菜单 */
export function Dropdown<V extends string | number | boolean>(opts: {
    options: readonly { label: string; value: V }[];
    value: V | undefined;
    onChange(v: V): void;
    disabled?: boolean;
    test?: string;
    title?: string;
}) {
    let value = opts.value;
    const text = h("span", { class: "arc-dropdown-label" });
    const btn = h("button", {
        type: "button", class: "arc-field arc-dropdown", disabled: !!opts.disabled, "data-tip": opts.title,
        "data-test": opts.test, "aria-haspopup": "menu",
    }, text, icon("chevronDownRegular")); // 下拉箭头 = SF chevron.down Regular（⛔ suggestion，ionicons-to-arc.md L39）；chevronDown 现为折叠箭头（Bold 旋转）
    const sync = () => { text.textContent = tr(opts.options.find(o => o.value === value)?.label); btn.dataset.value = String(value); };
    sync();
    btn.addEventListener("click", e => {
        e.stopPropagation();
        const r = btn.getBoundingClientRect();
        const m = openMenu({ x: r.left, y: r.bottom + 2 }, opts.options.map(o => ({
            label: o.label, checked: o.value === value, test: `option:${String(o.value)}`,
            run: () => { value = o.value; sync(); opts.onChange(o.value); },
        })));
        if (m) m.style.minWidth = `${r.width}px`;
    });
    return btn;
}

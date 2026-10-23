/* 焦点环策略：只有键盘导航（Tab / 方向键）时才画焦点环。
 * Chrome 在键盘快捷键（如 ⌘T）之后对程序化 .focus() 也会匹配 :focus-visible，所以不能只靠 :focus-visible：
 * 这里记录“最近一次交互是否为键盘导航”，写到 <html data-kbd-nav>，CSS 只在有该属性时画环；
 * 关闭菜单后是否把焦点还给触发按钮，也只在键盘导航时才做（restoreFocus）。 */
const NAV_KEYS = new Set(["Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"]);
let installed = false;

export const kbdNav = () => typeof document !== "undefined" && document.documentElement.dataset.kbdNav === "1";

export function setKbdNav(on: boolean) {
    if (typeof document === "undefined") return;
    if (on) document.documentElement.dataset.kbdNav = "1"; else delete document.documentElement.dataset.kbdNav;
}

/** 关闭菜单 / 浮层后归还焦点：只在键盘导航时 */
export function restoreFocus(el: HTMLElement | null | undefined) {
    if (el?.isConnected && kbdNav()) el.focus({ preventScroll: true });
}

export function installFocusPolicy() {
    if (installed || typeof document === "undefined") return;
    installed = true;
    // 挂在 window 捕获阶段（最先执行）：菜单等在 document 捕获阶段 stopPropagation 也不影响
    window.addEventListener("keydown", e => {
        // 带 ⌘ / Ctrl / Alt 的组合键（快捷键）不算键盘导航
        if (NAV_KEYS.has(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) setKbdNav(true);
        else if (e.metaKey || e.ctrlKey || e.altKey) setKbdNav(false);
    }, true);
    window.addEventListener("pointerdown", () => setKbdNav(false), true);
}

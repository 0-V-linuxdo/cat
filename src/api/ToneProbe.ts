/* 底栏按钮深浅判定（51979 实机：深色底栏上 Library / ＋ 用了浅色值 56.5% 黑，近黑看不见）。
 * data-theme 可能是 "auto"、或被自适应 / 空间主题改过，和实际底色不一致；这里直接看正文颜色 --arc-fg 的亮度：
 * 正文浅 = 深色底 → <html data-bb-dark="1">；CSS 据此选 GrayA 深色 / 浅色值（sidepanel.css --bb-*）。
 * 共享文件（所有扩展页面上下文都装，见 ArcSidebar.ts）。根上没有 --arc-fg 的页面（分屏页 split.html）不判定：探针色会退化成继承色，
 * 继承色又随页面 color-scheme 变，而该页 data-bb-dark="1" 的样式自己带 color-scheme: dark → 判深后永远锁在深色。
 * 这类页面的 data-bb-dark 由 splitView/theme.ts 从侧栏抄来，这里不写也不删。 */
let installed = false;
const lum = (c: string) => { const m = c.match(/[\d.]+/g); if (!m || m.length < 3) return NaN; const [r, g, b] = m.map(Number) as [number, number, number]; return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; };

export function updateTone() {
    const R = document.documentElement;
    if (!getComputedStyle(R).getPropertyValue("--arc-fg").trim()) return; // 没有 --arc-fg = 没有可看的正文色（见文件头），不判定、不锁存
    const probe = document.createElement("span"); probe.style.cssText = "position:absolute;visibility:hidden;color:var(--arc-fg)";
    document.body?.append(probe);
    const L = lum(getComputedStyle(probe).color); probe.remove();
    if (Number.isFinite(L)) { const v = L > 0.5 ? "1" : "0"; if (R.dataset.bbDark !== v) R.dataset.bbDark = v; }
}

export function installToneProbe() {
    if (installed || typeof document === "undefined") return; installed = true;
    const run = () => setTimeout(updateTone, 0); // 不用 rAF：隐藏 / 后台文档里 rAF 不触发
    new MutationObserver(run).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "style", "class", "data-adaptive"] });
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", run);
    if (document.body) run(); else addEventListener("DOMContentLoaded", run, { once: true });
}

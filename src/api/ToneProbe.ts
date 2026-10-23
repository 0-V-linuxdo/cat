/* 底栏按钮深浅判定（51979 实机：深色底栏上 Library / ＋ 用了浅色值 56.5% 黑，近黑看不见）。
 * data-theme 可能是 "auto"、或被自适应 / 空间主题改过，和实际底色不一致；这里直接看正文颜色 --arc-fg 的亮度：
 * 正文浅 = 深色底 → <html data-bb-dark="1">；CSS 据此选 GrayA 深色 / 浅色值（sidepanel.css --bb-*）。 */
let installed = false;
const lum = (c: string) => { const m = c.match(/[\d.]+/g); if (!m || m.length < 3) return NaN; const [r, g, b] = m.map(Number) as [number, number, number]; return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; };

export function updateTone() {
    const R = document.documentElement;
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

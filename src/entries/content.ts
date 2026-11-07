import { contentGuard } from "./contentGuardInstall";
import { bootstrap } from "@src/ArcSidebar";
import { runEarly } from "@plugins/inpageSidebar/earlyEntry";

/*
 * 内容脚本注入所有框架（manifest all_frames），但只在两种情况下运行：
 * 顶层页面，或者分屏页（本扩展的 split.html）里的面板 iframe——这样快捷键在分屏面板里也生效。
 */
const inSplitPane = (() => {
    if (window.top === window) return false;
    const anc = location.ancestorOrigins;
    return !!anc?.length && anc[anc.length - 1] === new URL(chrome.runtime.getURL("")).origin && anc.length === 1;
})();
/* 补丁 inpage-residual：bootstrap 要先读设置、走完 Init 阶段才轮到页内侧栏的 content.start；有「上次是展开的」提示时在这里（同一次同步执行里）先起早实例，壳不用等那条链（见 plugins/inpageSidebar/earlyEntry.ts） */
if (window.top === window && contentGuard.alive()) runEarly();
if (window.top === window || inSplitPane) { if (contentGuard.alive()) void bootstrap("content"); }
// 唤醒后台：浏览器重启后 MV3 后台不会自己启动（Helium 也收不到 onStartup），网页一加载就 ping，让“重启恢复”检查尽早运行
if (window.top === window) { try { void chrome.runtime.sendMessage({ type: "arc-ping", from: "content" }).catch((e: unknown) => { if (!/Receiving end does not exist/.test(String((e as Error)?.message ?? e))) console.warn("[Cat] content sendMessage", e); }); } catch { /* 扩展已重载 */ } /* 内容脚本里 @api/ErrorLog 不可达：只 console.warn；侧栏未开时“没有接收端”是预期，忽略 */ }

/* 点击网页 = 点击了侧边栏 / 弹窗之外：通知扩展页面关闭临时界面（菜单、面板、命令栏、切换器、扩展弹窗），同 Arc。
 * 点同一窗口里的网页不一定触发 windows.onFocusChanged / 侧边栏 blur，所以由内容脚本直接报告。 */
if (window.top === window) {
    let last = 0;
    addEventListener("pointerdown", () => {
        const now = Date.now();
        if (now - last < 250) return;
        last = now;
        try { void chrome.runtime.sendMessage({ type: "arc-outside-click" }).catch((e: unknown) => { if (!/Receiving end does not exist/.test(String((e as Error)?.message ?? e))) console.warn("[Cat] content sendMessage", e); }); } catch { /* 扩展已重载 */ } /* 内容脚本里 @api/ErrorLog 不可达：只 console.warn；侧栏未开时“没有接收端”是预期，忽略 */
    }, true);
    // 52148：右键菜单开着时键盘焦点常留在网页（侧边栏没拿到焦点），Esc 到不了侧边栏 → 由内容脚本转发
    addEventListener("keydown", (e: Event) => {        const k = e as KeyboardEvent; if (k.key !== "Escape" || k.repeat) return;
        try { void chrome.runtime.sendMessage({ type: "arc-outside-esc" }).catch((e: unknown) => { if (!/Receiving end does not exist/.test(String((e as Error)?.message ?? e))) console.warn("[Cat] content sendMessage", e); }); } catch { /* 扩展已重载 */ } /* 内容脚本里 @api/ErrorLog 不可达：只 console.warn；侧栏未开时“没有接收端”是预期，忽略 */
    }, true);
}

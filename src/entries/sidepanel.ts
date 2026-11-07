import { safe } from "@api/ErrorLog";
import { bootstrap } from "@src/ArcSidebar";
import { mountShell } from "@api/PanelShell";
import { openOverlay } from "@api/Slots";
import { nativeEnsurePending, pageBlurAction } from "@api/HostMode";

const popup = new URLSearchParams(location.search).get("popup");
if (popup) document.body.classList.add("arc-popup");
// 页内侧边栏的 iframe（?host=inpage，由 InpageSidebar 内容脚本嵌入）：给 body 一个钩子类，插件的面板样式据此微调
if (new URLSearchParams(location.search).get("host") === "inpage") document.body.classList.add("arc-inpage");
mountShell(document.getElementById("app")!);
import { startPrevTab } from "@api/PrevTab";
// 补丁 rel64-prev-seed：上一个标签在 bootstrap 之前启动（onActivated 同步注册，启动期间的激活不丢；种子见 PrevTab.ts）
if (!popup) startPrevTab();
void bootstrap("panel").then(() => {
    if (!popup) return;
    openOverlay(popup, new URLSearchParams(location.search).get("edit") ? { replace: true } : undefined);
    // 弹窗获得系统焦点时再次聚焦输入框，避免首个按键丢失
    const refocus = () => (document.querySelector(".arc-overlay input") as HTMLInputElement | null)?.focus();
    window.addEventListener("focus", refocus);
    setTimeout(refocus, 100); setTimeout(refocus, 400);
    // 失去焦点即关闭，与 Arc 命令栏一致
    // patch 08：切原生（sidePanel.open）会让焦点离开弹窗；还有 ensure-native 在等 ack（≤500 ms）时不关，每 200 ms 再看一次（pageBlurAction）
    const checkBlur = () => { const a = pageBlurAction({ hasFocus: document.hasFocus(), pending: nativeEnsurePending() }); if (a === "close") window.close(); else if (a === "wait") setTimeout(checkBlur, 200); };
    window.addEventListener("blur", () => setTimeout(checkBlur, 200));
});

// 侧边栏也上报系统深浅色（离屏文档之外的第二个来源）：后台据此 action.setIcon
{
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const send = () => void safe(chrome.runtime.sendMessage({ type: "arc-theme", dark: mq.matches }), "arc-theme");
    send(); mq.addEventListener("change", send);
}

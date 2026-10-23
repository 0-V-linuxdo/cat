import { safe } from "@api/ErrorLog";
import { bootstrap } from "@src/ArcSidebar";
import { mountShell } from "@api/PanelShell";
import { openOverlay } from "@api/Slots";

const popup = new URLSearchParams(location.search).get("popup");
if (popup) document.body.classList.add("arc-popup");
mountShell(document.getElementById("app")!);
import { startPrevTab } from "@api/PrevTab";
void bootstrap("panel").then(() => {
    if (!popup) void startPrevTab();
    if (!popup) return;
    openOverlay(popup, new URLSearchParams(location.search).get("edit") ? { replace: true } : undefined);
    // 弹窗获得系统焦点时再次聚焦输入框，避免首个按键丢失
    const refocus = () => (document.querySelector(".arc-overlay input") as HTMLInputElement | null)?.focus();
    window.addEventListener("focus", refocus);
    setTimeout(refocus, 100); setTimeout(refocus, 400);
    // 失去焦点即关闭，与 Arc 命令栏一致
    window.addEventListener("blur", () => setTimeout(() => { if (!document.hasFocus()) window.close(); }, 200));
});

// 侧边栏也上报系统深浅色（离屏文档之外的第二个来源）：后台据此 action.setIcon
{
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const send = () => void safe(chrome.runtime.sendMessage({ type: "arc-theme", dark: mq.matches }), "arc-theme");
    send(); mq.addEventListener("change", send);
}

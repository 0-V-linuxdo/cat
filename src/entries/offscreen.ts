import { safe } from "@api/ErrorLog";
/* 离屏文档（reason: CLIPBOARD）：后台命令（⌘⇧C 等）在网页没焦点 / chrome:// 页面时也能写剪贴板 */
chrome.runtime.onMessage.addListener((msg: { type?: string; text?: string }, _s, respond) => {
    if (msg?.type !== "arc-offscreen-copy") return;
    const ta = document.createElement("textarea");
    ta.value = msg.text ?? ""; document.body.append(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch { ok = false; }
    ta.remove(); respond(ok);
    return true;
});

/* 系统深浅色 → 后台（切换工具栏猫图标） */
const mq = matchMedia("(prefers-color-scheme: dark)");
const sendTheme = () => void safe(chrome.runtime.sendMessage({ type: "arc-theme", dark: mq.matches }), "arc-theme");
mq.addEventListener("change", sendTheme);
sendTheme();
chrome.runtime.onMessage.addListener((msg: { type?: string }, _s, respond) => { if (msg?.type === "arc-theme-query") { respond(mq.matches); return true; } });

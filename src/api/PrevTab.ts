import { safe } from "@api/ErrorLog";
/* 上一个标签（Arc TabCellBackgroundPrevious）：记住本窗口上一次激活的标签，在侧边栏对应行上加 .arc-prev */
let prev: number | undefined, cur: number | undefined;
function mark() {
    document.querySelectorAll(".arc-tab.arc-prev").forEach(e => e.classList.remove("arc-prev"));
    if (prev != null && prev !== cur) document.querySelector(`.arc-tab[data-sel="tab:${prev}"]`)?.classList.add("arc-prev");
}
export async function startPrevTab() {
    const me = await safe(chrome.windows.getCurrent(), "windows.getCurrent", null);
    cur = (await chrome.tabs.query({ active: true, windowId: me?.id }))[0]?.id;
    chrome.tabs.onActivated.addListener(i => { if (me && i.windowId !== me.id) return; if (i.tabId !== cur) { prev = cur; cur = i.tabId; } mark(); });
    let q = false;
    new MutationObserver(() => { if (q) return; q = true; requestAnimationFrame(() => { q = false; mark(); }); }).observe(document.getElementById("app") ?? document.body, { childList: true, subtree: true });
}
export const prevTabId = () => prev;

import { safe } from "@api/ErrorLog";
import { currentWindow } from "@api/HostMode";
import { applyActivation, seedState, type Activation, type PrevState } from "@api/prevSeed";
/* 上一个标签（Arc TabCellBackgroundPrevious）：记住本窗口上一次激活的标签，在侧边栏对应行上加 .arc-prev（只标普通标签行 tab:，固定行不加）
 * 补丁 rel64-prev-seed：页内侧栏每个标签一个 iframe，新标签 / 收藏打开 / ⌘Z 重开的新标签的 iframe 是在激活之后才生出来的，原来 prev 为空 → 不显示。
 * ① 启动时用 tab.lastAccessed 取同窗口第二近访问的标签做种子（没有 lastAccessed 时回落到旧行为）；
 * ② onActivated 在 bootstrap 之前同步注册（sidepanel.ts），启动快照之后到的激活按顺序重放，不丢。 */
let st: PrevState = {};
let started = false;
function mark() {
    document.querySelectorAll(".arc-tab.arc-prev").forEach(e => e.classList.remove("arc-prev"));
    const { prev, cur } = st;
    if (prev != null && prev !== cur) document.querySelector(`.arc-tab[data-sel="tab:${prev}"]`)?.classList.add("arc-prev");
}
export function startPrevTab() {
    if (started) return;
    started = true;
    let ready = false, snapped = false, winId: number | undefined;
    const later: Activation[] = [];
    chrome.tabs.onActivated.addListener(i => {
        if (!ready) { if (snapped) later.push({ tabId: i.tabId, windowId: i.windowId }); return; }
        st = applyActivation(st, i, winId);
        mark();
    });
    void (async () => {
        const me = await safe(currentWindow(), "windows.getCurrent", null);
        winId = me?.id;
        snapped = true;
        const tabs = await safe(chrome.tabs.query(winId != null ? { windowId: winId } : { currentWindow: true }), "tabs.query", [] as chrome.tabs.Tab[]);
        st = seedState(tabs, later.splice(0), winId);
        ready = true;
        mark();
        let q = false;
        new MutationObserver(() => { if (q) return; q = true; requestAnimationFrame(() => { q = false; mark(); }); }).observe(document.getElementById("app") ?? document.body, { childList: true, subtree: true });
    })();
}
export const prevTabId = () => st.prev;

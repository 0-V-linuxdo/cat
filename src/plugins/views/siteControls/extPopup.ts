/*
 * 在站点控制里“点扩展图标”：Chrome 不允许一个扩展打开另一个扩展的工具栏弹窗（action.openPopup 只能开自己的），
 * management API 也不返回 default_popup，别的扩展的 manifest.json 也读不到（不是 web_accessible_resources）。
 * 可行的最佳做法（参考 Extensity / One Click Extensions Manager：它们只做启用 / 停用 / 选项，不开弹窗）：
 *   1. 已知扩展：内置弹窗路径（如 uBlock Origin 的 popup-fenix.html?tabId=…，可以指定作用的标签）；
 *   2. 未知扩展：在最小化的 popup 窗口里依次尝试常见路径，用 webNavigation 判断是否加载成功，成功后缓存；
 *   3. 找到后把这个页面放进一个贴着侧边栏的小 popup 窗口，失焦即关闭（同工具栏弹窗）；
 *   4. 找不到：打开选项页；都没有则提示。
 * 当前标签：很多弹窗（如 Violentmonkey）在后台用 tabs.query({ active: true, currentWindow: true }) 取“当前标签”，
 * 后台里 currentWindow = 最后获得焦点的窗口。所以弹窗窗口先“不聚焦”打开，等页面加载完（它已取到用户正在看的标签）再聚焦，
 * 这样弹窗显示的是当前网页的数据，而不是弹窗自己。弹窗页自己在前台再查一次 currentWindow 的扩展仍会拿到弹窗本身（无法绕过）。
 */
import { safe } from "@api/ErrorLog";
import { createPluginStore } from "@api/Storage";

/** 已知扩展的弹窗页（{tab} = 当前网页的 tabId） */
export const KNOWN_POPUPS: Record<string, string> = {
    cjpalhdlnbpafiamejdnhcphjbkeiagm: "popup-fenix.html?tabId={tab}", // uBlock Origin（Chrome 网上应用店）
    blockjmkbacgjkknlgpkjjiijinjdanf: "popup-fenix.html?tabId={tab}", // uBlock Origin（Helium 内置）
    eimadpbcbfnmbkopoojfekhnkhdbieeh: "ui/popup/index.html", // Dark Reader
    nngceckbapebfimnlniiiahkandclblb: "popup/index.html", // Bitwarden
    jinjaccalgkegednnccohejagnlnfdag: "popup/index.html", // Violentmonkey
};
export const CANDIDATES = [
    "popup.html", "popup/popup.html", "popup/index.html", "src/popup/index.html", "src/popup.html", "ui/popup/index.html",
    "html/popup.html", "pages/popup.html", "action/index.html", "popup/main.html",
    "sidepanel.html", "sidepanel/index.html", "side-panel.html",
];
const cache = createPluginStore<Record<string, string>>("extPopup", () => ({}));
const key = (x: chrome.management.ExtensionInfo) => `${x.id}@${x.version}`;
export const cachedPopup = (x: chrome.management.ExtensionInfo) => KNOWN_POPUPS[x.id] ?? cache.get()[key(x)];

/** 在新的最小化弹窗里打开 url（别的扩展的页面只能直接作为窗口初始地址打开；在已有标签里跳转会被 ERR_BLOCKED_BY_CLIENT 拦截）。
 *  主框架提交（onCommitted）= 存在 → 返回窗口 id；出错（ERR_FILE_NOT_FOUND 等）/ 超时 → 关窗并返回 null */
async function load(url: string, ms = 3000): Promise<number | null> {
    let wid: number | undefined, tabId: number | undefined, verdict: boolean | undefined;
    const early: [number, boolean][] = [];
    return new Promise(resolve => {
        const done = (ok: boolean) => {
            if (verdict !== undefined) return;
            verdict = ok; clearTimeout(timer);
            chrome.webNavigation.onCommitted.removeListener(okL);
            chrome.webNavigation.onErrorOccurred.removeListener(errL);
            if (!ok && wid != null) void safe(chrome.windows.remove(wid), "extPopup windows.remove");
            resolve(ok && wid != null ? wid : null);
        };
        const hit = (t: number, ok: boolean) => { if (tabId == null) early.push([t, ok]); else if (t === tabId) done(ok); };
        const okL = (d: chrome.webNavigation.WebNavigationTransitionCallbackDetails) => { if (d.frameId === 0 && d.url.startsWith(url.split("?")[0])) hit(d.tabId, true); };
        const errL = (d: chrome.webNavigation.WebNavigationFramedErrorCallbackDetails) => { if (d.frameId === 0 && d.url.startsWith(url.split("?")[0])) hit(d.tabId, false); };
        const timer = setTimeout(() => done(false), ms);
        chrome.webNavigation.onCommitted.addListener(okL);
        chrome.webNavigation.onErrorOccurred.addListener(errL);
        chrome.windows.create({ url, type: "popup", state: "minimized", focused: false }).then(w => {
            wid = w?.id; tabId = w?.tabs?.[0]?.id;
            if (wid == null || tabId == null) return done(false);
            for (const [t, ok] of early) if (t === tabId) done(ok);
        }, () => done(false));
    });
}

/** 已打开的弹窗窗口 → 打开时间；聚焦到别的浏览器窗口即关闭（同工具栏弹窗）。
 *  忽略 WINDOW_ID_NONE（切到别的应用 / macOS 切换窗口时的瞬时事件）和刚打开 800ms 内的事件，否则弹窗会一闪即关。 */
const opened = new Map<number, number>();
let wired = false;
function wireBlurClose() {
    if (wired) return;
    wired = true;
    chrome.windows.onFocusChanged.addListener(id => {
        if (id === chrome.windows.WINDOW_ID_NONE) return;
        for (const [w, t] of opened) if (w !== id && Date.now() - t > 800) { opened.delete(w); void safe(chrome.windows.remove(w), "extPopup windows.remove"); }
    });
    chrome.windows.onRemoved.addListener(id => opened.delete(id));
    // 点网页（同一浏览器窗口里点击不一定触发 onFocusChanged）：内容脚本报告后关闭
    chrome.runtime.onMessage.addListener((msg: { type?: string }) => { if (msg?.type === "arc-outside-click") closeExtensionPopups(); });
}
/** 关闭所有扩展弹窗窗口（刚打开 800ms 内的除外，避免打开它的那次点击把它关掉） */
export function closeExtensionPopups(force = false) {
    for (const [w, t] of opened) if (force || Date.now() - t > 800) { opened.delete(w); void safe(chrome.windows.remove(w), "extPopup windows.remove"); }
}

/** 等窗口里的主框架加载完成（或超时） */
async function loaded(windowId: number, ms = 2500) {
    const tabId = (await safe(chrome.tabs.query({ windowId }), "extPopup tabs.query", [] as chrome.tabs.Tab[]))[0]?.id;
    if (tabId == null) return;
    if ((await safe(chrome.tabs.get(tabId), "extPopup tabs.get", null))?.status === "complete") return;
    await new Promise<void>(resolve => {
        const done = () => { clearTimeout(t); chrome.webNavigation.onCompleted.removeListener(l); resolve(); };
        const l = (d: chrome.webNavigation.WebNavigationFramedCallbackDetails) => { if (d.tabId === tabId && d.frameId === 0) done(); };
        const t = setTimeout(done, ms);
        chrome.webNavigation.onCompleted.addListener(l);
    });
}
/** 弹窗页加载完、已读取“当前标签”后再显示并聚焦 */
async function present(wid: number, bounds: { left: number; top: number; width: number; height: number }, wasMinimized: boolean) {
    await loaded(wid);
    await new Promise(r => setTimeout(r, 300));
    if (wasMinimized) await safe(chrome.windows.update(wid, { state: "normal" }), "extPopup windows.update");
    await safe(chrome.windows.update(wid, { ...bounds, focused: true }), "extPopup windows.update");
    opened.set(wid, Date.now());
}

export interface PopupResult { ok: boolean; path?: string; probed?: boolean; windowId?: number }

/** 打开扩展弹窗；at = 屏幕坐标（弹窗左上角） */
export async function openExtensionPopup(x: chrome.management.ExtensionInfo, at: { left: number; top: number }, pageTabId?: number): Promise<PopupResult> {
    wireBlurClose();
    const base = `chrome-extension://${x.id}/`;
    const fill = (p: string) => base + p.replace("{tab}", String(pageTabId ?? ""));
    const known = cachedPopup(x);
    const bounds = { left: Math.round(at.left), top: Math.round(at.top), width: 380, height: 580 };
    if (known === "none") return { ok: false };
    if (known) {
        // 先不聚焦：让弹窗在加载时把用户正在看的窗口当作“当前窗口”
        const kw = await chrome.windows.create({ url: fill(known), type: "popup", focused: false, ...bounds });
        if (kw?.id != null) await present(kw.id, bounds, false);
        return { ok: true, path: known, windowId: kw?.id };
    }
    // 未知：逐个候选在最小化窗口里尝试
    for (const p of CANDIDATES) {
        const wid = await load(fill(p));
        if (wid != null) {
            void cache.update(d => { d[key(x)] = p; });
            await present(wid, bounds, true);
            return { ok: true, path: p, probed: true, windowId: wid };
        }
    }
    void cache.update(d => { d[key(x)] = "none"; });
    return { ok: false, probed: true };
}
/** 右键“重新查找弹窗页”：清掉缓存 */
export function forgetPopup(x: chrome.management.ExtensionInfo) {
    void cache.update(d => { delete d[key(x)]; });
}

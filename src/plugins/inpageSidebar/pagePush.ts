/* 页内侧边栏：推开页面（补丁 09，DESIGN.md 3.8）。内容脚本里「唯一」改页面样式的地方。
 * 方案：给 documentElement 加 margin-left（一张构造样式表里的一条 html:root 规则，!important）；html 的 margin 让整个文档（含 body、水平居中、100% 宽布局）整体右移并变窄，
 *   position:sticky / absolute 跟着走；position:fixed 不跟着走，所以另外对「压进侧栏占用区」的固定元素逐个补偿（inline margin-left + max-width，保存并还原原 inline 值）。
 * 补丁 10：任何一轮固定元素扫描之前都先等 html 的 margin-left（computed）到目标（htmlSettled），避免在过渡中间相位量到 left:auto 元素的中间位置而写错 margin（GitHub lp-IntroHero 的 72px 瞬跳）。
 * 约束：不 import chrome.* / @api/ErrorLog（依赖全部由 PagePushDeps 注入，单测用假环境，见 tests/inpagePush.test.ts）；只写两处页面状态：① 那张样式表 ② 被补偿元素的两个 inline 属性；
 *   destroy() / set(0) 之后两处都归零（样式表整张摘掉，inline 值恢复到原值 / 原 !important 优先级）。 */
import { PUSH } from "./constants";
import { type Fit, type FitFacts, fitDecision, fixedShift, NO_FIT, pushCss, pushTiming, type Rect } from "./logic";

export interface StyleLike {
    getPropertyValue(p: string): string;
    getPropertyPriority(p: string): string;
    setProperty(p: string, v: string, priority?: string): void;
    removeProperty(p: string): string;
}
export interface ElLike { style: StyleLike; getBoundingClientRect(): Rect; getAttribute?(n: string): string | null; removeAttribute?(n: string): void }
export interface SheetOwner { set(css: string): void; clear(): void }
export interface PagePushDeps {
    /** 页面里除宿主外所有可能 position:fixed 的元素（body 子树；⚠ 进不了别人的 shadow root） */
    scan(): Iterable<ElLike>;
    /** 元素是否是我们自己的宿主 / 宿主内部（不补偿） */
    isOwn(el: ElLike): boolean;
    position(el: ElLike): string;
    /** 元素 / html 当前 margin-left 计算值（px，auto / 非数字按 0） */
    marginLeft(el: ElLike | "root"): number;
    /** 视口宽（不含竖直滚动条） */
    clientWidth(): number;
    /** RTL 页面竖直滚动条的宽（LTR = 0）。给 content 算 pushOffset 用 */
    rtlScrollbar(): number;
    /** 强制一次样式重算：首次安装样式表前后各读一次，过渡才有起点 */
    flush(): void;
    reducedMotion(): boolean;
    /** 「占满视口」的度量（html / body 宽、min-width、视口宽）；缺省或 null = 不做横向溢出缓解。在安装样式表之前读一次 */
    fitFacts?(): FitFacts | null;
    sheet: SheetOwner;
    /** 监听 body 子树增删（childList）+ 窗口滚动（滚动停手后补扫：覆盖「滚动后才变成 fixed」的 JS 吸顶）；返回停止函数。⚠ 不监听属性变化：不滚动、不增删节点、仅靠 class 切成 fixed 的元素要等下一次增删 / 滚动 / 宽度变化才会被补偿 */
    /** cb(immediate)：页面节点增删 / 滚动 → cb()；补丁 inpage-parked-idle：标签隐藏期间的变化不回调，切回可见时若有积压则 cb(true)（= 立刻补扫，不等去抖） */
    observe(cb: (immediate?: boolean) => void): () => void;
    setTimer(fn: () => void, ms: number): unknown;
    clearTimer(t: unknown): void;
    /** 超时等不到 html margin 到位时的告警（内容脚本不能 import @api/ErrorLog，所以由 content.ts 注入 console.warn；本文件不出现任何控制台调用——有源码约束单测；缺省 = 不告警） */
    warn?(msg: string): void;
}

interface Saved { ml: [string, string]; mw: [string, string]; ourMl: string | null; ourMw: string; hadStyleAttr: boolean }

export interface PagePush {
    /** 目标偏移（px，0 = 不推）。幂等；animate 默认 true（prefers-reduced-motion 时强制 false） */
    set(offset: number, o?: { animate?: boolean }): void;
    /** 立即归零（无过渡）：teardown 用 */
    destroy(): void;
    /** 调试 / 测试：当前目标偏移、被补偿元素数、样式表是否安装 */
    state(): { offset: number; fixed: number; installed: boolean };
    /** 当前这次推开用的横向溢出缓解决定（NO_FIT = 没做） */
    fit(): Fit;
    /** 补丁 early-show：document_start 就推开时 body 还不存在 / 页面样式还没到，原先「先量后装」量不到（fit = NO_FIT、origMl 可能不是最终值）。
     *  文档解析完 / 加载完 / body 出现后调用：同步（同一任务、中间没有绘制）摘掉样式表 → 重量 html 原 margin-left 与占满视口度量 → 按新结果重装 → 排一次全量固定元素扫描。没推开时什么都不做 */
    refit(): void;
}

export function createPagePush(d: PagePushDeps): PagePush {
    let cur = 0;
    let installed = false;
    let origMl = 0;
    let fit: Fit = NO_FIT;
    let settleTimer: unknown, scanTimer: unknown;
    let fitPending = false; // 补丁 early-show：安装时 body 还不存在（fitFacts 返回 null）→ body 一出现就补量一次
    let settleGaveUp = false; // 补丁 10：本次推开已经等超时过一次（页面压住了 margin 等）→ 之后不再门控、不再 warn，避免每次增量扫描都白等 1 s；偏移变化 / 收尾时清零
    let settleTries = 0; // 补丁 10：当前这一轮扫描已等了几次 html margin 到位（重试直接 setTimer(rescan)，不经 scheduleScan；外部排扫描 / 取消 / 收回都会清零）
    let stopObs: (() => void) | undefined;
    const saved = new Map<ElLike, Saved>();

    const clearTimers = () => { if (settleTimer != null) d.clearTimer(settleTimer); if (scanTimer != null) d.clearTimer(scanTimer); settleTimer = scanTimer = undefined; settleTries = 0; };

    const restoreOne = (el: ElLike, s: Saved) => {
        // 页面自己后来又改过这个 inline 值就不碰（只还原「仍是我们写的」）
        if (s.ourMl != null && el.style.getPropertyValue("margin-left") === s.ourMl) { if (s.ml[0] === "") el.style.removeProperty("margin-left"); else el.style.setProperty("margin-left", s.ml[0], s.ml[1]); }
        if (el.style.getPropertyValue("max-width") === s.ourMw) { if (s.mw[0] === "") el.style.removeProperty("max-width"); else el.style.setProperty("max-width", s.mw[0], s.mw[1]); }
        // 原本没有 style 属性、还原后只剩空属性（style=""）：摘掉，保证「还原精确」（真机 21:16 实测：头部 null → ""）
        if (!s.hadStyleAttr && el.getAttribute?.("style") === "") el.removeAttribute?.("style");
        saved.delete(el);
    };
    const restoreFixed = () => { for (const [el, s] of saved) restoreOne(el, s); };
    const scanFixed = () => {
        if (cur <= 0) return;
        const vw = d.clientWidth();
        let n = 0;
        for (const el of d.scan()) {
            if (++n > PUSH.scanMax) break; // ⚠ 超过上限的元素不补偿（极大 DOM）
            if (saved.has(el) || d.isOwn(el) || d.position(el) !== "fixed") continue;
            const sh = fixedShift(el.getBoundingClientRect(), cur, vw);
            if (!sh) continue;
            const ourMl = sh.dx > 0 ? `${d.marginLeft(el) + sh.dx}px` : null, ourMw = `${sh.maxWidth}px`;
            saved.set(el, {
                ml: [el.style.getPropertyValue("margin-left"), el.style.getPropertyPriority("margin-left")],
                mw: [el.style.getPropertyValue("max-width"), el.style.getPropertyPriority("max-width")], ourMl, ourMw, hadStyleAttr: el.getAttribute?.("style") != null,
            });
            if (ourMl != null) el.style.setProperty("margin-left", ourMl, "important");
            el.style.setProperty("max-width", ourMw, "important");
        }
    };
    /** 补丁 10：扫描（全量 / 核对 / 增量）之前的门控。true = 可以量；false = html margin-left 还没到目标，已排好 settleRetryMs 后重试同一轮（scanFull 标志保留）。
     *  超过 settleMaxTries 次仍不到位（页面压住了 margin / 动画被取消 / 时间线停住）→ 放行（和补丁 09 一样照旧扫描，后面还有核对扫描兜底）并 warn 一次 */
    const htmlSettled = (): boolean => {
        if (settleGaveUp) return true;
        const target = origMl + cur;
        if (Math.abs(d.marginLeft("root") - target) <= PUSH.settleTol) { settleTries = 0; return true; }
        if (settleTries >= PUSH.settleMaxTries) {
            settleTries = 0; settleGaveUp = true;
            d.warn?.(`[InpageSidebar] html margin-left did not reach ${target}px within ${PUSH.settleMaxTries * PUSH.settleRetryMs} ms (now ${d.marginLeft("root")}px); scanning fixed elements anyway`);
            return true;
        }
        settleTries++; scanTimer = d.setTimer(rescan, PUSH.settleRetryMs);
        return false;
    };
    /** full（偏移变了）：还原 → 重新测量 → 重新补偿，同步完成、中间没有绘制。增量（节点增删 / 滚动）：只把「已不再 fixed」的还原，再补上新出现的 */
    let scanFull = false;
    const rescan = () => {
        scanTimer = undefined; if (cur <= 0) return;
        if (fitPending && d.fitFacts?.()) { refit(); return; } // body 出现了：重量（refit 里会再排全量扫描）
        if (!htmlSettled()) return; // 补丁 10：html 的 margin 还在过渡中间 → 已排好重试（50 ms），这一轮不量、不写（还原 / 补偿都不做）
        const wasFull = scanFull;
        if (scanFull) restoreFixed();
        else for (const [el, s] of saved) {
            if (d.position(el) !== "fixed") restoreOne(el, s); // 吸顶元素放开后不能留着 margin 把它推歪
            else if (el.getBoundingClientRect().left > cur + PUSH.overshootTol) restoreOne(el, s); // 补偿过头（真机 21:4x GitHub lp-IntroHero：扫描恰在 html 过渡起点测到 left 0 → 补了 233，过渡完成后又被 html margin 推了 233 = 466）：还原，下面重测
        }
        scanFull = false; scanFixed();
        if (wasFull && saved.size > 0) scheduleScan(); // 全量扫描后补一次「核对」增量扫描：测量可能落在过渡 / 布局还没稳的时刻
    };
    const scheduleScan = (ms: number = PUSH.scanDebounceMs, full = false) => { if (full) scanFull = true; if (scanTimer != null) d.clearTimer(scanTimer); settleTries = 0; scanTimer = d.setTimer(rescan, ms); };
    /** 摘表重量（同步、无绘制）：origMl / fit 都用「没有我们样式」的页面算；然后按当前偏移（无过渡）重装。收回过渡进行中（cur 0）不动 */
    const refit = () => {
        if (!installed || cur <= 0) return;
        if (settleTimer != null) { d.clearTimer(settleTimer); settleTimer = undefined; }
        d.sheet.clear(); d.flush();
        origMl = d.marginLeft("root");
        const ff = d.fitFacts?.() ?? null;
        fit = fitDecision(ff); fitPending = !!d.fitFacts && ff == null;
        d.sheet.set(pushCss(origMl + cur, false, fit)); d.flush();
        settleGaveUp = false; scheduleScan(PUSH.scanDebounceMs, true);
    };
    const startObserve = () => { if (!stopObs) stopObs = d.observe(immediate => scheduleScan(immediate ? 0 : PUSH.scanDebounceMs)); };
    const stopObserve = () => { stopObs?.(); stopObs = undefined; };

    const finish = () => { settleTimer = undefined; d.sheet.clear(); installed = false; cur = 0; settleGaveUp = false; fitPending = false; };

    const set = (target: number, o: { animate?: boolean } = {}) => {
        const offset = Math.max(0, Math.round(Number.isFinite(target) ? target : 0));
        const animate = (o.animate ?? true) && !d.reducedMotion();
        const t = pushTiming();
        if (offset === cur) { // 幂等；收回过渡进行中（cur 0、installed）再要求 0：只有「不要动画」才提前收尾
            if (offset === 0 && installed && !animate) { if (settleTimer != null) d.clearTimer(settleTimer); finish(); }
            return;
        }
        if (settleTimer != null) { d.clearTimer(settleTimer); settleTimer = undefined; }
        if (offset > 0) {
            if (!installed) {
                origMl = d.marginLeft("root");
                const ff = d.fitFacts?.(); fit = fitDecision(ff); fitPending = !!d.fitFacts && ff == null; // 先量后装：html / body 此时还没被我们改（body 还没有 = ff 为 null，之后由 refit 补量）
                if (animate) { d.sheet.set(pushCss(origMl, false, fit)); d.flush(); } // 先以原值装一帧：过渡才有起点
                installed = true;
            }
            cur = offset; settleGaveUp = false;
            d.sheet.set(pushCss(origMl + offset, animate, fit));
            startObserve();
            scheduleScan(animate ? t.ms + PUSH.settleExtraMs : PUSH.scanDebounceMs, true); // 过渡结束（或拖拽停手）后再测，避免测到动画中间值
            return;
        }
        // 收回：固定元素立刻回原位（它们没有过渡，留着会和动画中的页面错开）→ html 回原值（带过渡）→ 过渡结束后整张样式表摘掉
        if (scanTimer != null) { d.clearTimer(scanTimer); scanTimer = undefined; }
        settleTries = 0; scanFull = false; restoreFixed(); stopObserve();
        cur = 0;
        if (!installed) return;
        if (animate) { d.sheet.set(pushCss(origMl, true, fit)); settleTimer = d.setTimer(finish, t.ms + PUSH.settleExtraMs); }
        else finish();
    };
    return {
        set,
        destroy: () => { clearTimers(); restoreFixed(); stopObserve(); finish(); },
        state: () => ({ offset: cur, fixed: saved.size, installed }),
        fit: () => fit,
        refit,
    };
}

/* —— 真实 DOM 环境（content.ts 用；不单测，行为由 selftest / 真机验证） —— */

/** 唯一的样式表拥有者：优先 adoptedStyleSheets（不受页面 CSP style-src 限制，也不往 DOM 里加节点）；不支持时退到 <style>（⚠ 严格 CSP 下会被拦，推开静默失效，只剩覆盖） */
function makeSheetOwner(doc: Document): SheetOwner {
    let sheet: CSSStyleSheet | undefined, style: HTMLStyleElement | undefined;
    return {
        set(css) {
            if (!sheet && !style) {
                try { sheet = new CSSStyleSheet(); doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet]; }
                catch { sheet = undefined; style = doc.createElement("style"); (doc.head ?? doc.documentElement).append(style); }
            }
            if (sheet) sheet.replaceSync(css); else if (style) style.textContent = css;
        },
        clear() {
            if (sheet) { const s = sheet; try { doc.adoptedStyleSheets = doc.adoptedStyleSheets.filter(x => x !== s); } catch { /* 文档已销毁 */ } sheet = undefined; }
            style?.remove(); style = undefined;
        },
    };
}

export function browserDeps(host: Element): PagePushDeps {
    const doc = document, root = doc.documentElement;
    const px = (v: string) => { const n = Number.parseFloat(v); return Number.isFinite(n) ? n : 0; };
    return {
        scan: () => (doc.body ? doc.body.querySelectorAll<HTMLElement>("*") : []),
        isOwn: el => el === (host as unknown) || host.contains(el as unknown as Node),
        position: el => getComputedStyle(el as unknown as Element).position,
        marginLeft: el => px(getComputedStyle(el === "root" ? root : (el as unknown as Element)).marginLeft),
        clientWidth: () => root.clientWidth,
        rtlScrollbar: () => getComputedStyle(root).direction === "rtl" ? Math.max(0, window.innerWidth - root.clientWidth) : 0,
        flush: () => { void root.offsetWidth; },
        fitFacts: () => {
            const b = doc.body; if (!b) return null;
            return { htmlW: root.getBoundingClientRect().width, htmlMl: px(getComputedStyle(root).marginLeft), clientW: root.clientWidth, innerW: window.innerWidth, bodyW: b.getBoundingClientRect().width, bodyMinW: px(getComputedStyle(b).minWidth) };
        },
        reducedMotion: () => !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
        sheet: makeSheetOwner(doc),
        observe: cb => {
            // 补丁 inpage-parked-idle：隐藏的标签（停放 / 后台）里页面自己的节点增删（SPA / 广告 / 聊天）不再每次触发整页 querySelectorAll("*") + getComputedStyle 的 fixed 扫描——
            // 只记脏位；切回可见（首帧前）若有积压，立刻补扫一次，所以切回时新出现的 fixed 元素已补偿
            let dirty = false;
            const on = () => { if (doc.visibilityState === "hidden") { dirty = true; return; } cb(); };
            const onVis = () => { if (dirty && doc.visibilityState === "visible") { dirty = false; cb(true); } };
            const mo = new MutationObserver(on);
            mo.observe(doc.body ?? root, { childList: true, subtree: true });
            window.addEventListener("scroll", on, { passive: true });
            doc.addEventListener("visibilitychange", onVis);
            return () => { mo.disconnect(); window.removeEventListener("scroll", on); doc.removeEventListener("visibilitychange", onVis); };
        },
        setTimer: (fn, ms) => setTimeout(fn, ms),
        clearTimer: t => clearTimeout(t as ReturnType<typeof setTimeout>),
    };
}

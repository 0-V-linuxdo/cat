/* 页内侧边栏：「早实例」入口——补丁 inpage-residual（新建 tab / 跨源导航「赶不上首帧」）。
 * 背景（headed 实测 + 静态核对）：content.js 是一个整包（prod ~1.2 MB / dev ~1.7 MB）。document_start 时它先**同步编译 + 执行**（阻塞主线程；本机 V8 实测 prod 约 25 ms 编译 + 15 ms 执行 ×1，CDP ×4 节流下 ×4），
 *   然后 bootstrap 才 `await initSettings()`（storage IPC）→ Init 阶段逐个插件 start → 才轮到 startContent，它再读第 2 层提示（又一次 IPC）/ 发 hello（再一次 IPC）。
 *   页面第一帧只能出现在那段同步执行结束之后；而壳要等「initSettings 回复 + Init 链 + 第 2 层 IPC（实测 tHint−tStart≈27 ms）或状态 IPC（≈45–52 ms）」，所以新渲染进程（新建 tab / 跨源导航）里壳总比首帧晚 ≥ 2–6 帧
 *   （headed：首帧 shown=0，约 90 ms 后 shown=1）。同源导航有 sessionStorage 同步提示，早就是首帧即显示。
 * 做法：entries/content.ts 在 bootstrap 之前（同一次同步执行里）调 runEarly：
 *   1. 第 1 层提示（sessionStorage，同步）命中 → 立刻 startContent({early})（首帧前建壳 + 推开 + 发 hello）；
 *   2. 同时发**一次** chrome.storage.local.get([第 2 层提示, 设置])：这个 IPC 在 content.js 剩下的同步执行期间就在路上，回复在线程一空闲时先于 bootstrap 自己的 initSettings 之后的整条链被处理；
 *      设置里本插件没启用 → 撤掉早实例并清提示；启用且第 2 层提示 show → startContent({early, hint})；
 *   3. 没有任何提示 = 什么都不做（插件的 content.start 照旧走原路径）。启用时 content.start 先 adoptEarly（earlyHandle.ts）接管早实例，不重建。
 * 为什么不单独拆一个更小的「早脚本」（manifest 里排在 content.js 之前）：同一次注入里线程被 content.js 的编译 / 执行占着，首帧本来就排在它之后，早脚本的壳也要等到那时才画得出来；
 *   它只能把第 2 层 IPC 提前约一个编译时长发出——但 IPC 回复本来就已在队列里（×4 下 content.js 的同步段 ≈ 160 ms，远大于 IPC ≈ 25 ms）。收益≈0，却要多一个构建入口 / manifest 改动 / 一份重复的 ~100 KB 代码。
 * 约束：不 import @api/ErrorLog / PluginManager / 控制台；不读设置框架（用提示里记的 dm / hv / hd）；代价：每个顶层页面多 1 次 storage IPC（读提示 + 设置，对没启用本插件的用户也一样 ⚠ 见 README）。 */
import type { Cleanup } from "@utils/types";
import { STORAGE_KEY } from "@utils/SettingsStore";

import { type StartOpts, startContent } from "./content";
import { EARLY, earlyPluginEnabled, type Hint, mayShowOptimistic, parseHint, withoutIds } from "./earlyShow";

export interface EarlyDeps {
    isTop(): boolean;
    hasRuntime(): boolean;
    visible(): boolean;
    prerendering(): boolean;
    /** 第 1 层（同步）；坏 JSON / 沙箱 iframe / 禁用存储 = undefined */
    readSession(): Hint | undefined;
    /** 一次读两个键：第 2 层提示 + 设置原始值 */
    getStorage(keys: string[]): Promise<Record<string, unknown> | undefined>;
    /** 设置里没启用：清掉两层提示（避免下一个页面又白建一次壳） */
    clearHints(): void;
    start(opts: StartOpts): Cleanup;
}

export function browserEarlyDeps(): EarlyDeps {
    return {
        isTop: () => typeof document !== "undefined" && window.top === window,
        hasRuntime: () => !!chrome.runtime?.id,
        visible: () => document.visibilityState === "visible",
        prerendering: () => !!(document as { prerendering?: boolean }).prerendering,
        readSession: () => { try { const r = sessionStorage.getItem(EARLY.sessionKey); return r ? parseHint(JSON.parse(r)) : undefined; } catch { return undefined; } },
        getStorage: keys => Promise.resolve(chrome.storage.local.get(keys)) as Promise<Record<string, unknown> | undefined>,
        clearHints: () => {
            try { sessionStorage.removeItem(EARLY.sessionKey); } catch { /* 沙箱 / 禁用存储 */ }
            try { void Promise.resolve(chrome.storage.local.remove(EARLY.localKey)).catch(() => undefined); } catch { /* 扩展上下文失效 */ }
        },
        start: o => startContent(o),
    };
}

/** 返回停止函数（测试用；生产里没人调——实例的生命周期由 startContent 的清理函数 / 接管后的插件管理器负责） */
export function runEarly(d: EarlyDeps = browserEarlyDeps()): () => void {
    const noop = () => undefined;
    if (!d.isTop() || !d.hasRuntime()) return noop;
    let started = false, stop: (() => void) | undefined;
    const go = (hint: Hint | undefined) => {
        if (started) return;
        started = true;
        const c = d.start({ early: true, ...(hint ? { hint } : {}) });
        stop = typeof c === "function" ? c : Array.isArray(c) ? () => { for (const f of c) f(); } : undefined;
    };
    const ok = (h: Hint | undefined) => mayShowOptimistic({ visible: d.visible(), prerendering: d.prerendering(), hint: h });
    const l1 = d.readSession();
    if (ok(l1)) go(l1); // 同步：赶在首帧之前
    if (!EARLY.localHint && !started) return noop;
    try {
        void d.getStorage([EARLY.localKey, STORAGE_KEY]).then(got => {
            if (!earlyPluginEnabled(got?.[STORAGE_KEY])) { // 没启用（或已停用）：撤早实例、清提示——主脚本也不会启动本插件
                const had = started || got?.[EARLY.localKey] !== undefined;
                if (started) { const s = stop; stop = undefined; s?.(); }
                if (had) d.clearHints();
                return;
            }
            if (started) return;
            const h = parseHint(got?.[EARLY.localKey]);
            if (h && ok(h)) go(withoutIds(h));
        }).catch(() => undefined);
    } catch { /* 扩展上下文失效 */ }
    return () => { const s = stop; stop = undefined; s?.(); };
}

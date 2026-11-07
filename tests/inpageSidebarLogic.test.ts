import { describe, expect, test } from "bun:test";

import { ARC, NATIVE_SWITCH, PREWARM, SPRING } from "../src/plugins/inpageSidebar/constants";
import {
    clampWidth, decideEnsure, decideSwitchNative, decideToggle, type Facts, handleLeft, hiddenOffset, holdWidth, hoverNext, inpageEligible, isVisible, needsBadge,
    linkNeedsNative, onNativeChanged, pageKind, parsePrewarmMode, pingWithRetry, planActivation, planOffClose, planReconcile, planWindowOpen, routeOutcome, ROUTES, shouldCorrectCold, shouldRestoreInpage, shouldSendPrewarm,
    shouldShowHost, triggerWidth,
} from "../src/plugins/inpageSidebar/logic";

const F = (o: Partial<Facts> = {}): Facts => ({ nativeOpen: false, intent: false, defaultMode: "inpage", kind: "ok", hostAlive: true, frameBlocked: false, ...o });

describe("Arc 值（DESIGN 5.2.1）原样保留", () => {
    test("默认宽 228、夹取 164–500、容器 5/5、高 −10、圆角 12、边框 1、触发 50/250/160ms、保持 +80、把手 8", () => {
        expect(ARC).toMatchObject({ defaultWidth: 228, minWidth: 164, maxWidth: 500, inset: 5, vInset: 10, radius: 12, border: 1, triggerNarrow: 50, triggerWide: 250, dwellMs: 160, holdExtra: 80, handleWidth: 8, handleTop: 11, handleVInset: 22 });
    });
    test("几何换算：隐藏位移 = −(宽+15)；保持区 = 宽+80；把手 left = 5+宽−4", () => {
        expect(hiddenOffset(228)).toBe(-243); expect(holdWidth(228)).toBe(308); expect(handleLeft(228)).toBe(229);
    });
    test("弹簧近似：linear() 21 个点、0.25 s", () => {
        expect(SPRING.durationMs).toBe(250); expect(SPRING.easing.startsWith("linear(")).toBe(true); expect(SPRING.easing.slice(7, -1).split(",").length).toBe(21);
    });
});

describe("clampWidth", () => {
    test("夹取到 164–500，取整", () => { expect(clampWidth(100)).toBe(164); expect(clampWidth(164)).toBe(164); expect(clampWidth(300.4)).toBe(300); expect(clampWidth(500)).toBe(500); expect(clampWidth(900)).toBe(500); });
    test("82（CollapseWidth）不是浮出容器的下限", () => { expect(clampWidth(82)).toBe(164); });
    test("非数字 / 空 / NaN / Infinity → 默认 228；数字字符串可用", () => {
        for (const v of [undefined, null, "", "  ", "abc", NaN, {}]) expect(clampWidth(v)).toBe(228);
        expect(clampWidth(Infinity)).toBe(228); expect(clampWidth("320")).toBe(320);
    });
});

describe("pageKind：能不能页内显示", () => {
    test("http / https 普通页 → ok", () => { expect(pageKind("https://example.com/a?b=1")).toBe("ok"); expect(pageKind("http://localhost:3000/")).toBe("ok"); });
    test("受限页一律回落原生", () => {
        expect(pageKind(undefined)).toBe("no-url"); expect(pageKind("not a url")).toBe("no-url");
        for (const u of ["chrome://settings", "chrome-extension://abc/split.html", "file:///tmp/a.html", "about:blank", "view-source:https://a.test/", "devtools://devtools/x", "ftp://a.test/"]) expect(pageKind(u)).toBe("scheme");
        expect(pageKind("https://chromewebstore.google.com/detail/x")).toBe("webstore");
        expect(pageKind("https://chrome.google.com/webstore/detail/x")).toBe("webstore");
        expect(pageKind("https://chrome.google.com/other")).toBe("ok");
        expect(pageKind("https://a.test/doc.PDF")).toBe("pdf"); expect(pageKind("https://a.test/doc.pdf?x=1")).toBe("pdf"); expect(pageKind("https://a.test/pdf/view")).toBe("ok");
    });
});

describe("状态转换 decideToggle（手势里的同步决定）", () => {
    test("看不到 + 页内默认 + 可页内 → 页内显示，意图置位，原生不动", () => {
        expect(decideToggle(F())).toEqual({ intent: true, native: "keep", inpage: "show", why: "show-inpage" });
    });
    test("页内正显示 → 再按 = 收起页内（意图清除），原生不动", () => {
        expect(decideToggle(F({ intent: true }))).toEqual({ intent: false, native: "keep", inpage: "hide", why: "hide-visible" });
    });
    test("原生开着 → 再按 = 关原生（不论默认方式）；意图清除", () => {
        for (const defaultMode of ["inpage", "native"] as const) expect(decideToggle(F({ nativeOpen: true, defaultMode }))).toMatchObject({ intent: false, native: "close", inpage: "hide" });
    });
    test("受限页 / 宿主不存活 / 被拦截 → 回落原生打开", () => {
        for (const o of [{ kind: "scheme" }, { kind: "pdf" }, { kind: "webstore" }, { kind: "no-url" }, { hostAlive: false }, { frameBlocked: true }] as Partial<Facts>[]) expect(decideToggle(F(o))).toEqual({ intent: false, native: "open", inpage: "hide", why: "fallback-native" });
    });
    test("默认方式 = 原生：即使可页内也开原生", () => { expect(decideToggle(F({ defaultMode: "native" }))).toMatchObject({ native: "open", inpage: "hide", why: "native-mode" }); });
    test("意图在但当前页不能页内（角标状态）→ 看不到 → 再按走原生", () => {
        const f = F({ intent: true, kind: "scheme" }); expect(isVisible(f)).toBe(false); expect(decideToggle(f).native).toBe("open");
    });
    test("任何决定都不含「disable 原生」：native 只会是 open / close / keep（E3）", () => {
        const seen = new Set<string>();
        for (const nativeOpen of [true, false]) for (const intent of [true, false]) for (const defaultMode of ["inpage", "native"] as const) for (const kind of ["ok", "scheme"] as const) for (const hostAlive of [true, false]) for (const frameBlocked of [true, false])
            seen.add(decideToggle({ nativeOpen, intent, defaultMode, kind, hostAlive, frameBlocked }).native);
        expect([...seen].toSorted()).toEqual(["close", "keep", "open"]);
    });
});

describe("可见 / 显示 / 角标", () => {
    test("原生优先：原生开着时页内宿主不显示", () => { expect(shouldShowHost(F({ intent: true, nativeOpen: true }))).toBe(false); expect(shouldShowHost(F({ intent: true }))).toBe(true); });
    test("意图 + 可页内 = 显示；没意图不显示", () => { expect(shouldShowHost(F())).toBe(false); expect(inpageEligible(F())).toBe(true); });
    test("角标：想看侧栏、原生没开、当前页不能页内", () => {
        expect(needsBadge(F({ intent: true, kind: "scheme" }))).toBe(true);
        expect(needsBadge(F({ intent: true, frameBlocked: true }))).toBe(true);
        expect(needsBadge(F({ intent: true }))).toBe(false); expect(needsBadge(F({ intent: true, kind: "scheme", nativeOpen: true }))).toBe(false); expect(needsBadge(F({ kind: "scheme" }))).toBe(false);
    });
    test("原生出现 → 意图清除；原生消失 → 意图不恢复", () => {
        expect(onNativeChanged({ intent: true }, true)).toEqual({ intent: false });
        expect(onNativeChanged({ intent: false }, false)).toEqual({ intent: false }); expect(onNativeChanged({ intent: true }, false)).toEqual({ intent: true });
    });
});

describe("「切到 Chrome 侧边栏」按钮（⚠ 待 E8）", () => {
    test("原生没开 → 开原生并收起页内（意图清除）", () => { expect(decideSwitchNative({ nativeOpen: false })).toMatchObject({ openNative: true, intent: false, inpage: "hide", native: "open" }); });
    test("原生已开 → 什么都不做（不 close、不 disable）", () => { expect(decideSwitchNative({ nativeOpen: true })).toMatchObject({ openNative: false, native: "keep" }); });
    test("开关常量：E8 已测 → viaClick 默认开；setOptionsFirst 默认关", () => { expect(NATIVE_SWITCH.viaClick).toBe(true); expect(NATIVE_SWITCH.setOptionsFirst).toBe(false); expect(NATIVE_SWITCH.sources).toEqual(["host"]); });
    test("预热默认值（E8 后仍保守）：off、心跳 25 s、关闭后恢复页内；不会误改默认", () => { expect(PREWARM.defaultMode).toBe("off"); expect(PREWARM.heartbeatMs).toBe(25_000); expect(PREWARM.restoreInpageOnClose).toBe(true); expect(PREWARM.connectWaitMs).toBeGreaterThan(0); });
});

describe("一个窗口只保留一个活动 iframe（planActivation）", () => {
    const hosts = [{ tabId: 1, windowId: 10 }, { tabId: 2, windowId: 10 }, { tabId: 3, windowId: 20 }];
    test("首次：窗口 10 的活动标签 2 → 2 激活，1 停用；窗口 20 的 3 激活", () => {
        expect(planActivation(hosts, { 10: 2, 20: 3 }, new Map())).toEqual([{ tabId: 1, active: false }, { tabId: 2, active: true }, { tabId: 3, active: true }]);
    });
    test("只下发变化：切到标签 1 → 1 激活、2 停用，3 不动", () => {
        const last = new Map([[1, false], [2, true], [3, true]]);
        expect(planActivation(hosts, { 10: 1, 20: 3 }, last)).toEqual([{ tabId: 1, active: true }, { tabId: 2, active: false }]);
    });
    test("没有变化 → 空；窗口未知活动标签 → 全部停用", () => {
        expect(planActivation(hosts, { 10: 2, 20: 3 }, new Map([[1, false], [2, true], [3, true]]))).toEqual([]);
        expect(planActivation(hosts, {}, new Map([[1, true], [2, true], [3, true]])).every(c => !c.active)).toBe(true);
    });
    test("任何时刻每个窗口最多一个 active", () => {
        const plan = planActivation(hosts, { 10: 2, 20: 3 }, new Map()); const act = plan.filter(c => c.active).map(c => hosts.find(h => h.tabId === c.tabId)!.windowId);
        expect(new Set(act).size).toBe(act.length);
    });
});

describe("悬停浮出命中", () => {
    test("触发区宽：未悬停 50；已进入 250", () => { expect(triggerWidth(false)).toBe(50); expect(triggerWidth(true)).toBe(250); });
    test("隐藏：x<50 进入，其它不动；浮出：x<宽+80 保持，否则离开（立即）", () => {
        expect(hoverNext(false, 10, 228)).toBe("enter"); expect(hoverNext(false, 50, 228)).toBe("stay"); expect(hoverNext(false, -1, 228)).toBe("stay");
        expect(hoverNext(true, 300, 228)).toBe("stay"); expect(hoverNext(true, 308, 228)).toBe("leave");
    });
});

describe("L2 探测 pingWithRetry", () => {
    test("第一次成功 → 不重试", async () => { let n = 0; expect(await pingWithRetry(async () => { n++; return { ok: true }; }, { ms: 20, retries: 1 })).toEqual({ ok: true }); expect(n).toBe(1); });
    test("第一次超时、第二次成功", async () => { let n = 0; const r = await pingWithRetry(() => (++n === 1 ? new Promise(() => { }) : Promise.resolve({ ok: true })), { ms: 20, retries: 1 }); expect(r).toEqual({ ok: true }); expect(n).toBe(2); });
    test("抛错 / 全部失败 → undefined（共 1+retries 次）", async () => { let n = 0; expect(await pingWithRetry(async () => { n++; throw new Error("no receiver"); }, { ms: 20, retries: 1 })).toBeUndefined(); expect(n).toBe(2); });
});

describe("冷启动纠偏判定（⚠ 默认关）", () => {
    const cold = { opened: true, tabId: 5, windowId: 1 };
    test("只有：首次手势开了原生、同一标签、页内默认、可页内、原生确实开着才纠偏", () => {
        expect(shouldCorrectCold(F({ nativeOpen: true }), cold, 5, 1)).toBe(true);
        expect(shouldCorrectCold(F({ nativeOpen: true }), undefined, 5, 1)).toBe(false);
        expect(shouldCorrectCold(F({ nativeOpen: true }), cold, 6, 1)).toBe(false);
        expect(shouldCorrectCold(F({ nativeOpen: true, defaultMode: "native" }), cold, 5, 1)).toBe(false);
        expect(shouldCorrectCold(F({ nativeOpen: true, kind: "scheme" }), cold, 5, 1)).toBe(false);
        expect(shouldCorrectCold(F({ nativeOpen: false }), cold, 5, 1)).toBe(false);
        expect(shouldCorrectCold(F({ nativeOpen: true }), { ...cold, opened: false }, 5, 1)).toBe(false);
    });
});

/* ====================== 受限页前切换（Turn 2）：路线表 / ensure 决定 / 预热状态机 ====================== */
describe("路线表 ROUTES（DESIGN 3.7）", () => {
    test("16 条、id 唯一；页内 UI / 网页点击路线都有 ensure 机制；浏览器 UI 路线从不声称 ✓（没有可用手势）", () => {
        expect(ROUTES.length).toBe(16); expect(new Set(ROUTES.map(r => r.id)).size).toBe(16);
        for (const r of ROUTES.filter(x => x.origin === "inpage-ui" || x.origin === "page" && x.id === "page-link-restricted")) expect(r.mechanism).toContain("ensure");
        for (const r of ROUTES.filter(x => x.origin === "browser-ui" && x.id !== "action-click")) { expect(r.switchFirst).not.toBe("✓"); expect(r.switchFirstWarm).not.toBe("✓"); }
    });
    test("没有任何非原生直达路线被标成 ✓（P0 没有手势穿过 iframe / 弹窗的证据，E8 ⚠）；工具栏图标是原生直达 ✓", () => {
        for (const r of ROUTES) if (r.id !== "action-click") { expect(r.switchFirst).not.toBe("✓"); expect(r.switchFirstWarm).not.toBe("✓"); }
        expect(routeOutcome("action-click", false)).toBe("✓");
    });
    test("预热只会让 ⛔ 变 ⚠、不会让 ⚠ 变 ⛔；窗口切换 / 会话恢复预热也救不了；未知路线 = ⛔", () => {
        const rank = { "⛔": 0, "⚠": 1, "✓": 2 } as const;
        for (const r of ROUTES) expect(rank[routeOutcome(r.id, true)]).toBeGreaterThanOrEqual(rank[routeOutcome(r.id, false)]);
        expect(routeOutcome("omnibox", false)).toBe("⛔"); expect(routeOutcome("omnibox", "window")).toBe("⚠"); expect(routeOutcome("omnibox", "off")).toBe("⛔");
        expect(routeOutcome("window-switch", true)).toBe("⛔"); expect(routeOutcome("session-restore", "window")).toBe("⛔");
        expect(routeOutcome("nope" as never, true)).toBe("⛔");
    });
});

describe("decideEnsure：进受限页前 SW 的同步决定", () => {
    test("原生没在眼前 → open；已在眼前 → already（标签级预热移除后没有 enable-target 分支）", () => {
        expect(decideEnsure({ showing: false })).toBe("open");
        expect(decideEnsure({ showing: true })).toBe("already");
    });
});

describe("planWindowOpen：跳过原因", () => {
    test("窗口级预开：mode 必须是 window；原生已开 / 进行中 / 当前是受限页 / 默认原生 → 不做", () => {
        const W = (o: object = {}) => ({ mode: "window" as const, defaultMode: "inpage" as const, nativeOpen: false, pending: false, activeTabId: 1, activeKind: "ok" as const, ...o });
        expect(planWindowOpen(W())).toEqual({ go: true });
        const why = (o: object) => { const r = planWindowOpen(W(o)); return r.go ? "go" : r.why; };
        expect(why({ mode: "off" })).toBe("off"); expect(why({ mode: "tab" as never })).toBe("off"); /* 旧值即使漏到这里也不会开原生 */ expect(why({ defaultMode: "native" })).toBe("native-mode"); expect(why({ nativeOpen: true })).toBe("native-open");
        expect(why({ pending: true })).toBe("pending"); expect(why({ activeTabId: undefined })).toBe("no-tab"); expect(why({ activeKind: "pdf" })).toBe("not-injectable");
    });
    test("parsePrewarmMode：只有 window 保留；已移除的 \"tab\"（迁移的对象）/ 旧布尔 / undefined / 未知值都当 off（不并入 window）", () => {
        expect(parsePrewarmMode("window")).toBe("window"); expect(parsePrewarmMode("off")).toBe("off");
        expect(parsePrewarmMode("tab")).toBe("off"); // 旧版本存下的值：按 off 处理，不悄悄变成「整个窗口只剩原生」
        for (const v of [true, false, undefined, null, "x", 1, "Tab", "WINDOW"]) expect(parsePrewarmMode(v)).toBe("off");
    });
});

describe("planReconcile：启动对账（只挑 getOptions 报 enabled===false 的标签）", () => {
    test("false → 要 enable；true / undefined（getOptions 没给）→ 不碰；顺序保持", () => {
        expect(planReconcile([{ id: 1, enabled: true }, { id: 2, enabled: false }, { id: 3, enabled: undefined }, { id: 4, enabled: false }])).toEqual([2, 4]);
        expect(planReconcile([])).toEqual([]);
    });
});

describe("planOffClose：预热方式改成 off 时是否关掉「预热打开的」原生", () => {
    const O = (o: object = {}) => ({ mode: "off" as const, marked: true, nativeShowing: true, pending: false, ...o });
    test("有预热标记 + off + 原生在显示 / open 还没连上 → close；原生已经没了 → 只清标记", () => {
        expect(planOffClose(O())).toBe("close"); expect(planOffClose(O({ nativeShowing: false, pending: true }))).toBe("close");
        expect(planOffClose(O({ nativeShowing: false }))).toBe("clear");
    });
    test("没有标记（ensure / Alt+S 回落 / 图标 / 用户自己开的）→ 一律 keep，不论原生在不在；方式还是 window → keep", () => {
        for (const showing of [true, false]) for (const pending of [true, false]) expect(planOffClose(O({ marked: false, nativeShowing: showing, pending }))).toBe("keep");
        expect(planOffClose(O({ mode: "window" }))).toBe("keep");
    });
    test("旧的 \"tab\" / 未知值经 parsePrewarmMode 是 off → 同样关预热开的原生", () => {
        expect(planOffClose(O({ mode: parsePrewarmMode("tab") }))).toBe("close"); expect(planOffClose(O({ mode: parsePrewarmMode(undefined) }))).toBe("close");
    });
});

describe("shouldSendPrewarm / linkNeedsNative / shouldRestoreInpage", () => {
    const C = (o: object = {}) => ({ prewarm: true, warm: false, active: true, nativeOpen: false, trusted: true, now: 10_000, lastSent: 0, resendMs: 2000, ...o });
    test("shouldSendPrewarm：只在预热开、窗口冷、页内可显示、原生没开、真实手势、过了冷却时才发", () => {
        expect(shouldSendPrewarm(C())).toBe(true);
        for (const o of [{ prewarm: false }, { warm: true }, { active: false }, { nativeOpen: true }, { trusted: false }, { lastSent: 9000 }]) expect(shouldSendPrewarm(C(o))).toBe(false);
    });
    test("linkNeedsNative：只有进 PDF 查看器 / 商店的链接；同页锚点、download、javascript:/mailto:、chrome:// 都不触发", () => {
        const P = "https://a.test/page";
        expect(linkNeedsNative("https://b.test/file.pdf", P, false)).toBe(true);
        expect(linkNeedsNative("https://chromewebstore.google.com/detail/x", P, false)).toBe(true);
        expect(linkNeedsNative("/doc.pdf", P, false)).toBe(true);
        expect(linkNeedsNative("https://b.test/file.pdf", P, true)).toBe(false);
        expect(linkNeedsNative("https://b.test/", P, false)).toBe(false);
        expect(linkNeedsNative("#top", P, false)).toBe(false); expect(linkNeedsNative("javascript:void(0)", P, false)).toBe(false); expect(linkNeedsNative("mailto:a@b", P, false)).toBe(false);
        expect(linkNeedsNative("chrome://settings", P, false)).toBe(false); expect(linkNeedsNative("http://[bad", P, false)).toBe(false);
    });
    test("shouldRestoreInpage：做过标记 && 原生已不在显示 && 开关开", () => {
        expect(shouldRestoreInpage({ restoreMarked: true, nativeShowing: false, enabled: true })).toBe(true);
        for (const o of [{ restoreMarked: false }, { nativeShowing: true }, { enabled: false }]) expect(shouldRestoreInpage({ restoreMarked: true, nativeShowing: false, enabled: true, ...o })).toBe(false);
    });
});

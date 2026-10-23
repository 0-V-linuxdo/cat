/* 一键自测（隔离浏览器）：构建好的 dist 由本脚本加载；
 *   1) 用 chrome.sidePanel.open 打开【真正的侧边栏】（不是把 sidepanel.html 当标签打开），
 *   2) 第一项：真实点击 ＋（Input.dispatchMouseEvent）→ 侧栏仍在 + 零错误；之后每次点击都断言侧栏仍在，
 *   3) 真实点击侧栏每个按钮、＋ 菜单每一项、右键菜单每一项，
 *   4) 跑 selftest.html 自测页，
 *   全程收集所有扩展上下文的异常 / rejection / console.error，并读 chrome://extensions 错误列表，任何一条都失败。
 * 用法：bun run build:selftest && bun run scripts/harness-cdp.ts   （环境变量：DIST、HEADLESS=1、SELFTEST=0、CHROME） */
import { Harness, sleep, withTimeout, StepTimeout } from "./lib/cdp-harness";
import { LOCATE_SRC } from "../src/selftest/locate";

const ROOT = new URL("..", import.meta.url).pathname;
let DIST = process.env.DIST ?? "";
let ownDist = "";
if (!DIST) {
    const rel = `tmp/harness-dist-${process.pid}-${Date.now()}`;
    const b = Bun.spawnSync(["bun", "run", "build.ts", "--selftest"], { cwd: ROOT, env: { ...process.env, ARC_OUT: rel }, stdout: "ignore", stderr: "pipe" });
    if (b.exitCode !== 0) { console.log("FAIL 构建私有 dist 失败：", b.stderr.toString().slice(-1500)); process.exit(1); }
    DIST = ownDist = ROOT + rel; console.log("私有 dist：", DIST);
}
const SHOTS = process.env.SHOT_DIR ?? "/workspace/arc-acceptance/harness";
(await import("fs")).mkdirSync(SHOTS, { recursive: true });
async function shot(tag: string) { try { const r = await h.send("Page.captureScreenshot", { format: "png" }, S()); const f = `${SHOTS}/${tag}-${Date.now()}.png`; (await import("fs")).writeFileSync(f, Buffer.from(r.data, "base64")); return f; } catch { return "(截图失败)"; } }
const h = new Harness();
type Row = { step: string; ok: boolean; detail: string };
const rows: Row[] = [];
let seenCdp = 0, seenExt = 0;
const fmtErr = (e: any) => `[${e.kind ?? e.type}] ${e.ctx} ${e.text ?? e.msg}${e.url ? " <" + e.url.replace(/^chrome-extension:\/\/[^/]+\//, "") + ">" : ""}${e.stack ? " @ " + e.stack : ""}`;
/** 自测页故意制造的错误（不是产品问题）：UrlTransforms 测试注册一个会抛 "selftest boom" 的变换，验证“抛错跳过” */
/* 另：自测页 fetch("popup.html") 故意验证该文件已不存在 → 404 是预期 */
const EXPECTED = [/selftest boom/, /\[selftest\] .*(重试|跳过不可用命令)/]; /* 自测页的稳定性重试 / 跳过记录走 console.info；万一出现在 chrome://extensions 里也不算错误 */
const expectedUrl = (e: any) => /ERR_FILE_NOT_FOUND/.test(String(e.text)) && /\/popup\.html$/.test(String(e.url ?? ""));
const expected = (e: any) => EXPECTED.some(r => r.test(String(e.text ?? e.msg))) || expectedUrl(e);
const allErrs: any[] = [];

/** 一个步骤：超时 + 步骤名；结束时检查新错误（CDP 各上下文 + chrome://extensions）和侧栏是否还在 */
async function step(name: string, ms: number, fn: () => Promise<unknown>, opts: { needPanel?: boolean } = { needPanel: true }) {
    let fail = "";
    try { const r = await withTimeout(name, ms, fn()); if (r === false) fail = "没点到（元素不存在 / 不可见）"; }
    catch (e) { fail = e instanceof StepTimeout ? e.message : `异常：${(e as Error).message}`; }
    await sleep(500);
    const cdp = h.errors.slice(seenCdp).filter(e => !expected(e)); seenCdp = h.errors.length;
    const ext = await h.extensionErrors().catch(() => []); const extNew = ext.slice(seenExt).filter(e => !expected(e)); seenExt = ext.length;
    allErrs.push(...cdp.map(e => ({ step: name, ...e })), ...extNew.map(e => ({ step: name, ...e, src: "chrome://extensions" })));
    const vio = await violations(); const vioNew = vio.length < seenViol ? vio : vio.slice(seenViol); seenViol = vio.length;
    const panelGone = opts.needPanel && !(await panelAlive());
    const parts = [fail, panelGone ? "侧边栏被关闭了（sidepanel 目标已销毁 / 不可见）" : "", ...cdp.map(fmtErr), ...extNew.map(e => "[chrome://extensions] " + fmtErr(e)), ...vioNew.map(v => "[arc-sidepanel-violations 无手势 sidePanel.open] " + v)].filter(Boolean);
    rows.push({ step: name, ok: !parts.length, detail: parts.join(" ‖ ").slice(0, 2500) });
    console.log(parts.length ? "FAIL" : "PASS", name, parts.length ? "| " + parts.join(" ‖ ").slice(0, 1500) : "");
    if (panelGone) await reopenPanel();
}

const swSession = () => h.extTargets().find(t => t.type === "service_worker")?.sessionId;
/** SidePanelGesture 钩子：没有用户手势的 sidePanel.open 调用栈，必须是 [] */
async function violations(): Promise<string[]> { return opener ? (await h.evalIn(opener.sessionId, `chrome.runtime.sendMessage({ type: "arc-sidepanel-violations" }).catch(e => ["（钩子不可用）" + e.message])`, { ms: 5000 }).catch(() => [])) ?? [] : []; }
async function resetViolations() { const s = swSession(); if (s) await h.evalIn(s, `(globalThis.__arcSidePanelViolations ?? []).length = 0; 1`).catch(() => { }); }
let seenViol = 0;
let panel: { targetId: string; sessionId: string } | undefined;
let opener: { sessionId: string } | undefined; let winId = 0;
const panelTarget = () => h.extTargets().find(t => (t.type === "page" || t.type === "other") && /\/sidepanel\.html(\?|$)/.test(t.url) && t.sessionId);
async function panelAlive() {
    const t = panel && h.targets.get(panel.targetId);
    if (!t?.alive) return false;
    return (await h.evalIn(panel!.sessionId, "document.visibilityState", { ms: 3000 }).catch(() => "dead")) === "visible";
}
async function openPanel() {
    // userGesture:true 的 evaluate = 一次用户手势（sidePanel.open 必须有手势）
    await h.evalIn(opener!.sessionId, `chrome.sidePanel.open({ windowId: ${winId} }).then(() => "ok")`, { userGesture: true });
    const t = await withTimeout("等待真正的侧边栏出现", 10_000, (async () => { for (;;) { const t = panelTarget(); if (t) return t; await sleep(100); } })());
    panel = { targetId: t.targetId, sessionId: t.sessionId! };
    await withTimeout("侧边栏加载完成", 10_000, (async () => { for (;;) { if (await h.evalIn(panel!.sessionId, `document.readyState === "complete" && !!document.querySelector('[data-test="plus-btn"]')`, { ms: 3000 }).catch(() => false)) return; await sleep(150); } })());
    await sleep(800);
}
async function reopenPanel() { try { await openPanel(); console.log("  （已重新打开侧边栏）"); } catch (e) { console.log("  重新打开侧边栏失败：", (e as Error).message); } }

const S = () => panel!.sessionId;
/* 每次页面评估前注入统一定位助手 __hx（data-sel → data-tip → title），见 src/selftest/locate.ts */
/* 强制主题：Adaptive 插件的 observer 会把 data-theme 改回 data-adaptive（半深半浅，真实用户不会出现）→ 先摘掉 data-adaptive（存起来，__hxRestoreAd 恢复） */
const THEME_SRC = `globalThis.__hxTheme ??= (t) => { const R = document.documentElement; if (!("__hxAd" in globalThis)) globalThis.__hxAd = R.dataset.adaptive; delete R.dataset.adaptive; if (t == null) delete R.dataset.theme; else R.dataset.theme = t; return (R.dataset.theme ?? null) === (t ?? null); }; globalThis.__hxRestoreAd ??= () => { const a = globalThis.__hxAd; delete globalThis.__hxAd; if (a != null) document.documentElement.dataset.adaptive = a; return 1; };`;
const ev = (js: string) => h.evalIn(S(), `${LOCATE_SRC}\n${THEME_SRC}\n${js}`);
const rect = (sel: string) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e || !e.isConnected || !(e.offsetParent || e.getClientRects().length)) return null; e.scrollIntoView({ block: "nearest" }); const r = e.getBoundingClientRect(); return r.width && r.height ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null; })()`);
async function mouse(x: number, y: number, button: "left" | "right") {
    await h.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y }, S());
    await h.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button, buttons: button === "left" ? 1 : 2, clickCount: 1 }, S());
    await h.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button, buttons: 0, clickCount: 1 }, S());
}
const realClick = async (sel: string, button: "left" | "right" = "left") => { const p = await rect(sel); if (!p) return false; await mouse(p.x, p.y, button); return true; };
const escape = async () => { for (const type of ["keyDown", "keyUp"]) await h.send("Input.dispatchKeyEvent", { type, key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }, S()); await sleep(150); };
const closeAll = async () => { await escape(); await escape(); };
/* 52024：菜单关闭有 .closing 过渡、菜单打开期间 renderAll 推迟重绘 → 只认非 closing 的可见菜单 */
const LIVE_MENU = `[data-test="plus-menu"]:not(.closing):not([hidden])`;
const menuOpen = () => ev(`(() => { const m = document.querySelector(${JSON.stringify(LIVE_MENU)}); return !!m && m.checkVisibility(); })()`);
const noClosingMenu = () => ev(`!document.querySelector('[data-test="plus-menu"].closing')`);
async function pollUntil(fn: () => Promise<unknown>, ms: number) { const end = Date.now() + ms; for (;;) { if (await fn().catch(() => false)) return true; if (Date.now() > end) return false; await sleep(100); } }
/** 打开 ＋ 菜单并等到指定项在“活”菜单里可见（轮询，不靠固定等待） */
async function openPlusFor(item: string) {
    await pollUntil(noClosingMenu, 3000);
    if (!(await menuOpen())) await realClick('[data-test="plus-btn"]');
    return pollUntil(() => ev(`(() => { const e = document.querySelector(${JSON.stringify(LIVE_MENU + " ")} + '[data-test="${item}"]'); return !!e && e.checkVisibility() && e.getBoundingClientRect().height > 0; })()`), 4000);
}

let code = 1;
try {
    await withTimeout("启动隔离浏览器", 45_000, h.launch());
    await step("加载扩展（Extensions.loadUnpacked）", 30_000, async () => { console.log("  扩展 ID", await h.loadExtension(DIST)); }, { needPanel: false });
    // 有界面 Chrome 里 clipboard 写入可能弹权限提示并一直挂起（headless 自动放行）：预先授权，避免 ⌘⇧C / 复制链接卡住
    await step("授予扩展剪贴板权限（Browser.grantPermissions）", 10_000, () => h.send("Browser.grantPermissions", { origin: `chrome-extension://${h.extId}`, permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"] }), { needPanel: false });
    await step("打开 chrome://extensions 错误收集", 20_000, () => h.enableErrorCollection(), { needPanel: false });
    await step("打开网页标签 + 选项页（options 上下文）", 20_000, async () => {
        await h.open("https://example.com/?arc-harness");
        const o = await h.open(`chrome-extension://${h.extId}/options.html`); opener = { sessionId: o.sessionId! }; await sleep(1500);
        winId = await h.evalIn(o.sessionId!, "chrome.windows.getCurrent().then(w => w.id)");
        // 回到网页标签（侧栏的对象是普通网页）
        await h.evalIn(o.sessionId!, `chrome.tabs.query({ url: "https://example.com/*" }).then(([t]) => t && chrome.tabs.update(t.id, { active: true }))`);
    }, { needPanel: false });
    await step("打开真正的侧边栏（chrome.sidePanel.open）", 25_000, openPanel);
    if (!panel) throw new Error("真正的侧边栏打不开，后续点击无法进行");
    await step("后台 / 离屏上下文都已附着", 10_000, async () => {
        await sleep(1000);
        const kinds = h.extTargets().map(t => `${t.type}:${t.url.split("/").pop()}`);
        console.log("  已附着扩展上下文：", kinds.join(", "));
        if (!kinds.some(k => k.startsWith("service_worker"))) throw new Error("没有附着到 service worker");
    });

    if (process.env.SIDEPANEL !== "0") { // SIDEPANEL=0：跳过真实侧栏点击 / 通用浮层（只跑设置全扫 + 自测页）
    // ===== 框架自检：往 SW 注入一个未处理 rejection，必须被抓到（证明 SW 的 unhandledrejection 会让运行失败）=====
    {
        const sw = h.extTargets().find(t => t.type === "service_worker")!;
        const before = h.errors.length;
        // 两种：普通 rejection；和实机同款（无手势 sidePanel.open 不接 catch）。都放进 setTimeout = 真正的宏任务，而不是 evaluate 自身
        await h.evalIn(sw.sessionId!, `setTimeout(() => { void Promise.reject(new Error("${h.probeMarker}")); void chrome.sidePanel.open({ windowId: ${winId} }); }, 0); 1`);
        await sleep(2000);
        console.log("  探针后 CDP 记录：", JSON.stringify(h.errors.slice(before)).slice(0, 800));
        console.log("  探针后 chrome://extensions：", JSON.stringify(await h.extensionErrors()).slice(0, 800));
        const cdpHit = h.errors.slice(before).some(e => e.text.includes(h.probeMarker));
        const extHit = (await h.extensionErrors().catch(() => [])).some(e => e.msg.includes(h.probeMarker));
        const ok = cdpHit && extHit;
        rows.push({ step: "框架自检：SW 未处理 rejection 能被抓到", ok, detail: ok ? "" : JSON.stringify({ cdpHit, extHit }) });
        console.log(ok ? "PASS" : "FAIL", "框架自检：SW 注入 Promise.reject(new Error('harness-probe')) →", `CDP 抓到=${cdpHit}，chrome://extensions 抓到=${extHit}`);
        // 清掉探针：CDP 记录 + chrome://extensions 列表
        h.errors.splice(before); seenCdp = h.errors.length;
        await h.evalIn(opener!.sessionId, `chrome.storage.local.remove("arc-errlog")`);
        await resetViolations(); seenViol = 0; h.probeOpen = true; // 之后任何残留的探针文字都不计入结论
        await h.clearExtensionErrors(); seenExt = (await h.extensionErrors()).length;
    }

    /* PHASES=core,generic,clicks（默认全部）：可分段跑，每段 < ~100s；POPOVERS=正则 只跑匹配的通用浮层 */
    const PH = new Set((process.env.PHASES ?? "core,generic,theme,wheelx,clicks").split(","));
    if (PH.has("core")) {
    // ===== 第一项：＋ =====
    await step("【首项】真实点击 ＋ → 菜单打开、侧栏仍在、零错误", 10_000, async () => {
        if (!(await realClick('[data-test="plus-btn"]'))) return false; await sleep(600);
        if (!(await panelAlive())) return; // 由 step 报“侧栏被关闭”
        if (!(await menuOpen())) throw new Error("＋ 菜单没有打开");
        console.log("  观察：真实点击后 navigator.userActivation =", JSON.stringify(await ev(`({ isActive: navigator.userActivation.isActive, hasBeenActive: navigator.userActivation.hasBeenActive })`)));
        console.log("  观察：无手势 evaluate 调 sidePanel.open →", await h.evalIn(opener!.sessionId, `chrome.sidePanel.open({ windowId: ${winId} }).then(() => "成功（不需要手势？）", e => "被拒：" + e.message)`));
        console.log("  观察：SW 里 evaluate 调 sidePanel.open（userGesture:false）→", await h.evalIn(h.extTargets().find(t => t.type === "service_worker")!.sessionId!, `chrome.sidePanel.open({ windowId: ${winId} }).then(() => "成功", e => "被拒：" + e.message)`));
        // 上面两次观察是框架自己故意触发的：清掉它们留下的记录（arc-errlog / chrome://extensions / CDP）
        await sleep(500); await h.evalIn(opener!.sessionId, `chrome.storage.local.remove("arc-errlog")`); await h.clearExtensionErrors(); await resetViolations(); seenViol = 0; seenExt = 0; seenCdp = h.errors.length;
    });
    // ===== 51996 实机 #1：点 ＋ 后等 2s，侧栏目标仍活着 + 所有上下文零错误 =====
    await step("【51996-1】真实点击 ＋ → 等 2s → 侧栏目标仍在、所有上下文零错误", 15_000, async () => {
        if (await menuOpen()) { await realClick('[data-test="plus-btn"]'); await sleep(400); }
        if (!(await realClick('[data-test="plus-btn"]'))) return false;
        await sleep(2000);
        const t = h.targets.get(panel!.targetId);
        if (!t?.alive) throw new Error(`侧栏目标已销毁 targetId=${panel!.targetId}`);
        if (!(await panelAlive())) throw new Error(`侧栏不可见 visibilityState=${await ev("document.visibilityState").catch(() => "dead")} 截图 ${await shot("51996-1-plus")}`);
        await realClick('[data-test="plus-btn"]'); await sleep(300);
    });
    await step("再点 ＋ → 菜单关闭", 10_000, async () => { if (!(await menuOpen())) { await realClick('[data-test="plus-btn"]'); await sleep(400); } if (!(await realClick('[data-test="plus-btn"]'))) return false; await sleep(500); if (await menuOpen()) throw new Error("＋ 菜单没关"); });

    // ===== 回归（51979 实机：点 ＋ 后侧栏关闭且再也打不开）：反复 关侧栏 → 开侧栏 → 真实点 ＋ =====
    for (let i = 1; i <= 3; i++) await step(`【回归】第 ${i} 轮：关闭侧栏 → 重新打开 → 真实点 ＋ → 侧栏仍在、零错误`, 30_000, async () => {
        await h.evalIn(opener!.sessionId, `(chrome.sidePanel.close ? chrome.sidePanel.close({ windowId: ${winId} }) : Promise.resolve()).then(() => 1)`, { userGesture: true });
        await withTimeout("等待侧栏关闭", 5000, (async () => { while (await panelAlive()) await sleep(100); })());
        await openPanel();
        if (!(await realClick('[data-test="plus-btn"]'))) return false; await sleep(600);
        if (!(await panelAlive())) return;
        if (!(await menuOpen())) throw new Error("＋ 菜单没有打开");
        await realClick('[data-test="plus-btn"]'); await sleep(300);
    });

    // ===== 回归：没有用户手势的 sidePanel.open 路径（消息转发的 sidebar.toggle）不能留下 “may only be called in response to a user gesture” =====
    for (const how of ["消息转发 sidebar.toggle（无手势）×2", "存储通道 sidebar.toggle（无手势）×2"]) await step(`【回归】${how} → 无 user gesture 报错`, 20_000, async () => {
        for (let i = 0; i < 2; i++) {
            const nonce = `hx-${Date.now()}-${i}`;
            const js = how.startsWith("消息") ? `chrome.runtime.sendMessage({ type: "arc-sidebar:cmd", id: "sidebar.toggle", nonce: "${nonce}", target: "background" }).catch(() => 0)`
                : `chrome.storage.session.set({ "cmd:req": { id: "sidebar.toggle", nonce: "${nonce}", target: "background" } })`;
            await h.evalIn(opener!.sessionId, js); await sleep(1200);
        }
        const bad = [...h.errors.slice(seenCdp).map(e => e.text), ...(await h.extensionErrors()).map(e => e.msg)].filter(t => /user gesture/i.test(t));
        if (bad.length) throw new Error(bad[0]);
        if (!(await panelAlive())) await openPanel(); // toggle 可能把侧栏关了：这是预期行为，重开后继续
    });
    await step("【回归】侧栏里真实按 Ctrl+S（扩展自己的快捷键）×2 → 无 user gesture 报错", 20_000, async () => {
        for (let i = 0; i < 2; i++) {
            for (const type of ["keyDown", "keyUp"]) await h.send("Input.dispatchKeyEvent", { type, key: "s", code: "KeyS", windowsVirtualKeyCode: 83, modifiers: 2 }, S());
            await sleep(1200);
            if (!(await panelAlive())) await openPanel();
        }
    });

    // ===== ＋ 菜单 New Tab 行：平时没有背景，只有真实悬停时才有 =====
    await step("【＋ 菜单】New Tab 行：平时背景透明，真实悬停（mouseMoved）时才有背景", 15_000, async () => {
        await closeAll();
        if (!(await realClick('[data-test="plus-btn"]'))) return false; await sleep(400);
        // 鼠标移到侧栏左上角空白（不在任何菜单项上）
        await h.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 5, y: 300 }, S()); await sleep(250);
        const bg = () => ev(`(() => { const r = document.querySelector('[data-test="plus-tab"]'); return r ? getComputedStyle(r).backgroundColor : null; })()`);
        const transparent = (c: string) => !c || c === "transparent" || /rgba\([^)]*,\s*0\)$/.test(c);
        // 52005 起：鼠标打开不预选；真实 ↓ 高亮第一个可用项
        const sel0 = await ev(`document.querySelector('[data-test="plus-menu"] .sel')?.dataset.test ?? null`);
        if (sel0) throw new Error(`鼠标打开 ＋ 菜单后预选了 ${sel0}（期望无）`);
        for (const type of ["keyDown", "keyUp"]) await h.send("Input.dispatchKeyEvent", { type, key: "ArrowDown", code: "ArrowDown", windowsVirtualKeyCode: 40 }, S());
        await sleep(200);
        const k1 = await ev(`({ sel: document.querySelector('[data-test="plus-menu"] .sel')?.dataset.test ?? null, first: document.querySelector('[data-test="plus-menu"] .arc-plus-item:not(.disabled)')?.dataset.test ?? null })`);
        if (!k1.sel || k1.sel !== k1.first) throw new Error(`真实 ↓ 后高亮 ${k1.sel}，期望第一个可用项 ${k1.first}`);
        await closeAll(); await realClick('[data-test="plus-btn"]'); await sleep(400);
        await h.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 5, y: 300 }, S()); await sleep(250);
        const rest = await bg();
        const p = await rect('[data-test="plus-tab"]'); if (!p) throw new Error("没有 New Tab 行");
        await h.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y }, S()); await sleep(300);
        const hover = await bg();
        await h.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 5, y: 300 }, S()); await sleep(250);
        const after = await bg();
        console.log(`   New Tab 背景：平时 ${rest} → 悬停 ${hover} → 移开 ${after}`);
        if (!transparent(rest) || transparent(hover) || !transparent(after)) throw new Error(`[data-test="plus-tab"] 背景不符：平时=${rest} 悬停=${hover} 移开=${after}（期望 透明 / 不透明 / 透明） 截图 ${await shot("plus-tab-hover")}`);
        await closeAll();
    });

    // ===== Today 标题行（Rea 源码值，52009 起生效）：分隔线 / 对齐 / 间距 / 行高 / Clear 颜色三态；浅色 + 两条深色路径 =====
    await step("【Today 标题行】Rea 源码值（≥52009）：分隔线 0.5 / 对齐 18 / 行高 16 / Clear 三态颜色，浅 + 深（两条路径）", 60_000, async () => {
        const ver = Number(String(await h.evalIn(opener!.sessionId, "chrome.runtime.getManifest().version")).split(".").pop());
        if (ver < 52009) { console.log(`   跳过：当前构建 ${ver} < 52009（规格自 52009 起生效）`); return "skip"; }
        await closeAll();
        // 没有 Today 标签时标题行可能不显示：确保至少一个
        if (!(await rect('[data-test="today-head"]'))) { await h.evalIn(opener!.sessionId, `chrome.tabs.create({ windowId: ${winId}, url: "https://example.com/?arc-today-head", active: false }).then(() => 1)`); await sleep(1500); }
        const GEO = 0.5, A = 0.02;
        const fails: string[] = [], warns: string[] = [];
        const near = (v: number, want: number, tol: number) => Math.abs(v - want) <= tol;
        const rgba = (c: string) => { const m = /rgba?\(([^)]+)\)/.exec(c || ""); if (!m) return null; const v = m[1].split(/[ ,\/]+/).filter(Boolean).map(x => x.endsWith("%") ? Number(x.slice(0, -1)) / 100 : Number(x)); return { r: v[0], g: v[1], b: v[2], a: v[3] ?? 1 }; };
        const colorIs = (got: string, want: [number, number, number, number], label: string) => { const c = rgba(got); if (!c || Math.abs(c.r - want[0]) > 1 || Math.abs(c.g - want[1]) > 1 || Math.abs(c.b - want[2]) > 1 || Math.abs(c.a - want[3]) > A) fails.push(`${label}：实测 ${got}，期望 rgba(${want.join(", ")})`); };
        const transparent = (c: string) => { const x = rgba(c); return !x || x.a <= 0.01; };
        const geo = () => ev(`(() => {
            const head = document.querySelector('[data-test="today-head"]'), sep = head?.querySelector(".arc-today-sep"), clear = head?.querySelector('[data-sel="today-clear"], [data-test="today-clear"]');
            const nt = document.querySelector(".arc-newtab"); if (!head || !sep || !clear) return null;
            const R = e => e.getBoundingClientRect(), hs = R(head), ss = R(sep), cs = R(clear), cst = getComputedStyle(sep);
            const part = sep.closest(".arc-part"); const ntIcon = nt?.querySelector("svg, .arc-svg, img") ?? nt;
            const next = sep.nextElementSibling; const arrow = clear.querySelector("svg");
            const tw = document.createTreeWalker(clear, NodeFilter.SHOW_TEXT); let tn, tl = null; while ((tn = tw.nextNode())) if (tn.textContent.trim()) { const t = tn.textContent; const st = t.length - t.trimStart().length; const rg = document.createRange(); rg.setStart(tn, st); rg.setEnd(tn, st + 1); tl = rg.getBoundingClientRect().left; break; } /* 跳过前导空白，只量第一个字形 */
            const vw = document.documentElement.clientWidth;
            return { thick: ss.height || parseFloat(cst.borderTopWidth) || 0, sepColor: (cst.backgroundColor !== "rgba(0, 0, 0, 0)" ? cst.backgroundColor : cst.borderTopColor),
                sepLeft: ss.left, sepW: ss.width, sepToPart: part ? ss.left - R(part).left : null, ntX: ntIcon ? R(ntIcon).left : null,
                clearRight: vw - cs.right, sepCY: ss.top + ss.height / 2, clearCY: cs.top + cs.height / 2,
                gapNext: next ? R(next).left - ss.right : null, nextSel: next ? (next.dataset.test || next.className) : null,
                arrowGap: arrow && tl != null ? tl - R(arrow).right : null, hasArrow: !!arrow,
                rowH: hs.height, ntTop: nt ? R(nt).top : null, headBottom: hs.bottom, clearW: cs.width };
        })()`);
        const clearColor = () => ev(`(() => { const c = document.querySelector('[data-sel="today-clear"], [data-test="today-clear"]'); const cs = getComputedStyle(c); return { color: cs.color, bg: cs.backgroundColor }; })()`);
        const modes: [string, string, string | null][] = [["浅色", "light", null], ["深色（data-theme=dark，系统浅色）", "light", "dark"], ["深色（系统深色 + 自动）", "dark", null]];
        const origTheme = await ev(`document.documentElement.dataset.theme ?? null`);
        for (const [label, scheme, theme] of modes) {
            await h.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }] }, S());
            const held = await ev(`__hxTheme(${JSON.stringify(theme)})`); await sleep(350);
            if (!held || (await ev(`document.documentElement.dataset.theme ?? null`)) !== theme) { console.log(`   [${label}] Adaptive 覆盖：data-theme 被改回，跳过`); continue; }
            const dark = await ev(`(() => { const t = document.documentElement.dataset.theme; return t === "dark" || (t !== "light" && matchMedia("(prefers-color-scheme: dark)").matches); })()`);
            const g = await geo(); if (!g) { fails.push(`[${label}] 没有 [data-test="today-head"] / .arc-today-sep / [data-test="today-clear"]`); continue; }
            const L = (x: string) => `[${label}] ${x}`;
            if (!near(g.thick, 0.5, 0.25)) fails.push(L(`.arc-today-sep 粗细 ${g.thick}px，期望 0.5px`));
            colorIs(g.sepColor, dark ? [255, 255, 255, 0.15] : [0, 0, 0, 0.15], L(".arc-today-sep 颜色"));
            if (!(g.sepW > 20)) fails.push(L(`.arc-today-sep 宽 ${g.sepW}px，没有自动撑满`));
            if (!near(g.sepCY, g.clearCY, 1)) fails.push(L(`分隔线中心 y=${g.sepCY.toFixed(2)} 与 Clear 中心 y=${g.clearCY.toFixed(2)} 差 > 1px`));
            if (!near(g.sepLeft, 18, GEO)) fails.push(L(`分隔线左缘距侧栏边 ${g.sepLeft.toFixed(2)}px，期望 18`));
            if (g.ntX != null && !near(g.sepLeft, g.ntX, GEO)) fails.push(L(`分隔线左缘 ${g.sepLeft.toFixed(2)} ≠ “+ New Tab” 内容 x ${g.ntX.toFixed(2)}`));
            if (g.sepToPart != null && !near(g.sepToPart, 10, GEO)) fails.push(L(`分隔线相对 .arc-part ${g.sepToPart.toFixed(2)}px，期望 10`));
            if (!near(g.clearRight, 18, GEO)) fails.push(L(`Clear 右缘距侧栏边 ${g.clearRight.toFixed(2)}px，期望 18`));
            if (g.gapNext != null && !near(g.gapNext, 8, GEO)) warns.push(L(`分隔线右端到下一个按钮（${g.nextSel}）${g.gapNext.toFixed(2)}px，候选值 8（只警告）`));
            if (!g.hasArrow) fails.push(L("Clear 前没有 ↓ 箭头"));
            else if (g.arrowGap == null || !near(g.arrowGap, 2, GEO)) fails.push(L(`箭头到 Clear 文字 ${g.arrowGap?.toFixed(2)}px，期望 2`));
            if (!near(g.rowH, 16, GEO)) fails.push(L(`标题行高 ${g.rowH.toFixed(2)}px，期望 16`));
            if (g.ntTop != null && g.ntTop < g.headBottom - GEO) fails.push(L(`“+ New Tab” top ${g.ntTop.toFixed(2)} 不在标题行下一行（标题行 bottom ${g.headBottom.toFixed(2)}）`));
            // Clear 三态：平时 / 真实悬停 / 按住
            await h.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 5, y: 600 }, S()); await sleep(250);
            const rest = await clearColor();
            colorIs(rest.color, dark ? [255, 255, 255, 0.3] : [0, 0, 0, 0.3], L("Clear 平时颜色"));
            const c = await rect('[data-sel="today-clear"], [data-test="today-clear"]');
            if (c) {
                await h.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: c.x, y: c.y }, S()); await sleep(300);
                const hov = await clearColor();
                const hw: [number, number, number, number] = dark ? [255, 255, 255, 0.8] : [14, 15, 16, 0.9];
                colorIs(hov.color, hw, L("Clear 悬停颜色"));
                if (!transparent(hov.bg)) fails.push(L(`Clear 悬停有背景 ${hov.bg}`));
                await h.send("Input.dispatchMouseEvent", { type: "mousePressed", x: c.x, y: c.y, button: "left", buttons: 1, clickCount: 1 }, S()); await sleep(250);
                const prs = await clearColor();
                colorIs(prs.color, [hw[0], hw[1], hw[2], +(hw[3] * 0.66).toFixed(3)], L("Clear 按下颜色（悬停 α × .66）"));
                if (!transparent(prs.bg)) fails.push(L(`Clear 按下有背景 ${prs.bg}`));
                // 移开再松开：不触发 click（不清空 Today）
                await h.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 5, y: 600, buttons: 1 }, S());
                await h.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: 5, y: 600, button: "left", buttons: 0, clickCount: 1 }, S()); await sleep(300);
                // 按下后拖出再松开：按下态应当解除
                const stuck = await ev(`(() => { const c = document.querySelector('[data-sel="today-clear"], [data-test="today-clear"]'); return { pressed: c.classList.contains("pressed"), color: getComputedStyle(c).color }; })()`);
                if (stuck.pressed) { fails.push(L(`按住 Clear 后拖出再松开，按下态没有解除（.pressed 仍在，color=${stuck.color}）`)); await ev(`document.querySelector('[data-sel="today-clear"], [data-test="today-clear"]').classList.remove("pressed")`); }
            }
        }
        await h.send("Emulation.setEmulatedMedia", { features: [] }, S());
        await ev(`(__hxTheme(${JSON.stringify(origTheme)}), __hxRestoreAd())`);
        for (const w of warns) console.log("WARN", "【Today 标题行】" + w);
        if (fails.length) throw new Error(`${fails.join(" ‖ ")} 截图 ${await shot("today-head")}`);
    });

    // ===== 51996 实机 #2：Space 图标选择器真实滚轮能滚动 =====
    await step("【51996-2】Space 图标选择器：真实滚轮（mouseWheel）后 scrollTop 改变", 20_000, async () => {
        await closeAll();
        if (!(await realClick(".arc-space-title", "right"))) throw new Error("没有 .arc-space-title");
        await sleep(300);
        if (!(await realClick('.arc-menu:not([hidden]) [data-test="icon"]'))) throw new Error("右键菜单里没有 icon 项");
        await sleep(500);
        if (!(await rect(".arc-icon-picker"))) throw new Error("没有打开 .arc-icon-picker");
        const out: any[] = [];
        for (const tab of ['[data-test="ip-tab-emoji"]', '[data-test="ip-tab-icon"]']) {
            await realClick(tab); await sleep(300);
            const info = await ev(`(() => { const pk = document.querySelector(".arc-icon-picker"); const all = [pk, ...pk.querySelectorAll("*")];
                const sc = all.find(e => e.scrollHeight > e.clientHeight + 2 && /auto|scroll/.test(getComputedStyle(e).overflowY));
                const cand = all.filter(e => e.scrollHeight > e.clientHeight + 2).map(e => (e.className || e.tagName) + " sh=" + e.scrollHeight + " ch=" + e.clientHeight + " oy=" + getComputedStyle(e).overflowY).slice(0, 5);
                if (!sc) return { tab: ${JSON.stringify(tab)}, scrollable: null, cand };
                document.querySelectorAll("[data-hx-sc]").forEach(e => e.removeAttribute("data-hx-sc")); sc.setAttribute("data-hx-sc", "1"); sc.scrollTop = 0;
                const r = sc.getBoundingClientRect(); return { tab: ${JSON.stringify(tab)}, scrollable: (sc.className || sc.tagName) + "", sh: sc.scrollHeight, ch: sc.clientHeight, x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
            if (!info.scrollable) { out.push(info); continue; }
            await h.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: info.x, y: info.y }, S());
            for (let i = 0; i < 3; i++) { await h.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: info.x, y: info.y, deltaX: 0, deltaY: 120 }, S()); await sleep(120); }
            await sleep(400);
            info.after = await ev(`document.querySelector("[data-hx-sc]")?.scrollTop ?? -1`);
            out.push(info);
        }
        const ok = out.some(o => o.scrollable && o.after > 0);
        console.log("  ", JSON.stringify(out));
        if (!ok) throw new Error(`滚轮后 scrollTop 没变：${JSON.stringify(out)} 截图 ${await shot("51996-2-iconpicker")}`);
        await closeAll();
    });

    // ===== 51996 实机 #3：底栏每个按钮、以及侧栏里所有图标都必须真的看得见 =====
    const VIS = `((el) => {
        const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
        let op = 1; for (let e = el; e && e.nodeType === 1; e = e.parentElement) op *= Number(getComputedStyle(e).opacity);
        const svgs = el.matches("svg") ? [el] : [...el.querySelectorAll("svg")];
        const shapes = svgs.flatMap(s => [...s.querySelectorAll("path,circle,rect,ellipse,polygon,polyline,line,use,image,text")].filter(g => !g.closest("mask,clipPath,defs"))).filter(g => { try { const b = g.getBBox(); return b.width > 0 || b.height > 0; } catch { return false; } });
        const imgs = (el.matches("img") ? [el] : [...el.querySelectorAll("img")]).filter(i => i.complete && i.naturalWidth > 0);
        // 用 CSS 画出来的内容（BoxOfThings 分层 div、空间圆点等）：自身 / 子孙 / ::before ::after 有背景色、背景图、遮罩或边框，且尺寸 > 0
        const alphaOf = c => { const m = /rgba?\\(([^)]+)\\)/.exec(c || ""); if (!m) return 0; const a = m[1].split(/[ ,\\/]+/).filter(Boolean)[3]; return a === undefined ? 1 : Number(a); };
        const painted = (st, w, h) => w > 0 && h > 0 && (alphaOf(st.backgroundColor) > 0.01 || st.backgroundImage !== "none" || (st.maskImage && st.maskImage !== "none") || (st.webkitMaskImage && st.webkitMaskImage !== "none") || (parseFloat(st.borderTopWidth) > 0 && alphaOf(st.borderTopColor) > 0.01));
        const pseudo = e => ["::before", "::after"].some(ps => { const st = getComputedStyle(e, ps); return st.content !== "none" && st.content !== "normal" && painted(st, parseFloat(st.width) || 1, parseFloat(st.height) || 1); });
        const bg = [el, ...el.querySelectorAll("*")].some(e => { const st = getComputedStyle(e); const b = e.getBoundingClientRect(); return (e === el ? false : painted(st, b.width, b.height)) || pseudo(e); }) || (painted(cs, r.width, r.height) && !el.matches("button, [role=button]"));
        const text = (el.textContent || "").trim();
        const color = cs.color; const alpha = /rgba?\\(([^)]+)\\)/.exec(color)?.[1].split(/[ ,\\/]+/).filter(Boolean)[3]; const colorA = alpha === undefined ? 1 : Number(alpha);
        const why = [];
        if (!(r.width > 0 && r.height > 0)) why.push("尺寸为 0");
        if (op <= 0.01) why.push("有效 opacity=" + op.toFixed(3));
        if (cs.visibility === "hidden") why.push("visibility:hidden");
        if (!shapes.length && !imgs.length && !text && !bg) why.push("没有内容（svg 无图形 / img 未加载 / 无文字）");
        if (shapes.length && !imgs.length && !text && colorA <= 0.01) why.push("currentColor 透明 color=" + color);
        return { w: Math.round(r.width), h: Math.round(r.height), op: +op.toFixed(3), vis: cs.visibility, shapes: shapes.length, imgs: imgs.length, text: text.slice(0, 12), color, why };
    })`;
    await step("【51996-3a】底栏每个按钮都看得见（有图标 / 尺寸 > 0 / 有效 opacity > 0 / 非 hidden）", 15_000, async () => {
        await closeAll();
        const res = await ev(`[...document.querySelectorAll(".arc-slot-bottom button, .arc-slot-bottom [role=button]")].filter(b => b.checkVisibility()).map(b => ({ sel: (b.dataset.test ? '[data-test="' + b.dataset.test + '"]' : b.className.split(" ").map(c => "." + c).join("")) + (__hx.tipOf(b) ? " tip=" + __hx.tipOf(b) : ""), ...${VIS}(b) }))`) ?? [];
        const bad = res.filter((r: any) => r.why.length);
        console.log(`   底栏 ${res.length} 个按钮`);
        if (!res.length) throw new Error("底栏没有按钮");
        if (bad.length) throw new Error(`看不见的底栏按钮：${JSON.stringify(bad)} 截图 ${await shot("51996-3a-bottom")}`);
    });
    await step("【51996-3b】侧栏所有图标都看得见（同一规则）", 15_000, async () => {
        const res = await ev(`[...document.querySelectorAll("#app svg, #app img, #app .arc-fav")].filter(e => !e.closest("[hidden], .arc-menu, mask, defs") && e.checkVisibility() && !(e.parentElement && e.parentElement.closest("svg"))).map(e => { const b = e.closest("button, .arc-tab, [role=button]"); return { idx: [...document.querySelectorAll("#app svg, #app img, #app .arc-fav")].indexOf(e), sel: e.tagName.toLowerCase() + "." + [...e.classList].join(".") + (b ? " in " + (b.dataset.test || __hx.tipOf(b) || b.className).slice(0, 40) : ""), ...${VIS}(e) }; })`) ?? [];
        let bad = res.filter((r: any) => r.why.length);
        // 故意隐藏的 svg（visibility:hidden），而按钮本身用别的方式画出了可见内容（如 CSS 遮罩字形）：以按钮为准
        for (const b of bad.slice()) {
            if (!(b.why.length === 1 && b.why[0] === "visibility:hidden")) continue;
            const host = await ev(`(() => { const e = document.querySelectorAll("#app svg, #app img, #app .arc-fav")[${b.idx}]; const btn = e?.closest("button, [role=button]"); return btn ? ${VIS}(btn) : null; })()`);
            if (host && !host.why.length) { console.log(`   ${b.sel}：svg 被隐藏，但按钮有其它可见内容（以按钮为准）`); bad = bad.filter((x: any) => x !== b); }
        }
        const hoverOnly: string[] = [];
        for (const b of bad.slice()) {
            if (!(b.why.length === 1 && /opacity/.test(b.why[0]))) continue;
            const again = await ev(`(() => { const e = document.querySelectorAll("#app svg, #app img, #app .arc-fav")[${b.idx}]; const host = e.closest(".arc-tab, .arc-urlbar, .arc-space-title, .arc-today-head, [class*=head], button"); if (!host) return null; host.setAttribute("data-hx-hover", "1"); const r = host.getBoundingClientRect(); return { x: r.x + Math.min(20, r.width / 2), y: r.y + r.height / 2 }; })()`);
            if (!again) continue;
            await h.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: again.x, y: again.y }, S()); await sleep(350);
            const m = await ev(`${VIS}(document.querySelectorAll("#app svg, #app img, #app .arc-fav")[${b.idx}])`);
            { if (!m.why.length) { hoverOnly.push(b.sel); bad = bad.filter((x: any) => x !== b); } else b.hovered = m; }
        }
        await h.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 1, y: 1 }, S());
        if (hoverOnly.length) console.log(`   悬停才显示（Arc 设计，悬停后可见）${hoverOnly.length} 个：${hoverOnly.join(" | ")}`);
        console.log(`   检查了 ${res.length} 个图标`);
        if (bad.length) throw new Error(`看不见的图标 ${bad.length} 个：${JSON.stringify(bad.slice(0, 15))} 截图 ${await shot("51996-3b-icons")}`);
    });

    } // core
    if (PH.has("generic")) {
    // ===== 通用浮层检查：逐个真实打开侧栏里的每个菜单 / 浮层 / 对话框，对每个都做 (a)(b)(c)(d)；(e) 由每步的错误收集保证 =====
    {
        // 期望图标映射：从 ＋ 菜单源码读出（id → icon），外加底栏固定项
        const src = await Bun.file(ROOT + "src/plugins/command/plusMenu/index.ts").text();
        const EXPECT: Record<string, string> = { "plus-btn": "plus", "library-btn": "boxthings" };
        for (const m of src.matchAll(/\{\s*id:\s*"(\w+)"[^}]*?icon:\s*"(\w+)"/g)) EXPECT["plus-" + m[1]] = m[2];
        await h.evalIn(opener!.sessionId, `chrome.runtime.sendMessage({ type: "arc-sidebar:rpc", method: "spaces:create", args: ["HX2", "🧪"] }).catch(() => 0)`); await sleep(800);
        const spaceId = () => ev(`document.querySelector(".arc-space-dot.active")?.dataset.space ?? document.querySelector(".arc-space-title")?.textContent ?? ""`);
        const FLOAT = `.arc-menu:not([hidden]), [data-test="plus-menu"]:not([hidden]), .arc-overlay, .arc-icon-picker, [role=dialog], [role=menu], [popover]:popover-open, .arc-popover, .arc-dialog`;
        const openers: [string, () => Promise<unknown>][] = [
            ["＋ 菜单", () => realClick('[data-test="plus-btn"]')],
            ["Library", () => realClick('[data-test="library-btn"]')],
            ["地址栏", () => realClick('[data-test="urlbar"]')],
            ["站点控制", () => realClick('[data-test="site-controls-btn"]')],
            ["空间 ⋯ 菜单", () => realClick('[data-test="space-more"]')],
            ["右键 空间标题", () => realClick(".arc-space-title", "right")],
            ["右键 底栏", () => realClick(".arc-slot-bottom", "right")],
            ["右键 标签行", () => realClick(".arc-today .arc-tab, .arc-slot-today .arc-tab", "right")],
            ["空间图标选择器", async () => { await realClick(".arc-space-title", "right"); await sleep(300); return realClick('.arc-menu:not([hidden]) [data-test="icon"]'); }],
            ["空间主题", async () => { await realClick(".arc-space-title", "right"); await sleep(300); return realClick('.arc-menu:not([hidden]) [data-test="theme"]'); }],
            ["重命名空间", async () => { await realClick(".arc-space-title", "right"); await sleep(300); return realClick('.arc-menu:not([hidden]) [data-test="rename"]'); }],
            ["管理空间", async () => { await realClick(".arc-space-title", "right"); await sleep(300); return realClick('.arc-menu:not([hidden]) [data-test="manage"]'); }],
            ["分享空间", async () => { await realClick(".arc-space-title", "right"); await sleep(300); return realClick('.arc-menu:not([hidden]) [data-test="share"]'); }],
            ["命令栏（New Tab）", () => realClick(".arc-newtab")],
        ];
        /** 页面内：可见性 + 对比度 + 错误回退，返回每个图标的问题 */
        const ICONCHK = `((root) => {
            const lum = c => { const m = /rgba?\\(([^)]+)\\)/.exec(c || ""); if (!m) return null; const v = m[1].split(/[ ,\\/]+/).filter(Boolean).map(Number); const f = x => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return { L: 0.2126 * f(v[0]) + 0.7152 * f(v[1]) + 0.0722 * f(v[2]), a: v[3] ?? 1, v }; };
            const bgOf = e => { const layers = []; for (let x = e; x; x = x.parentElement) { const b = lum(getComputedStyle(x).backgroundColor); if (b && b.a > 0) { layers.push(b); if (b.a >= 0.95) break; } } const th = document.documentElement.dataset.theme; const dark = th === "dark" || (th !== "light" && matchMedia("(prefers-color-scheme: dark)").matches); /* 与侧栏 / selftest isDark 同一规则 */ let base = dark ? [30, 30, 30] : [255, 255, 255]; for (const l of layers.reverse()) base = base.map((c, i) => c * (1 - l.a) + l.v[i] * l.a); return lum("rgb(" + base.join(",") + ")"); };
            const out = [], warns = [];
            const icons = [...root.querySelectorAll("svg, img, .arc-boxthings")].filter(e => e.checkVisibility() && !(e.parentElement && e.parentElement.closest("svg")) && !e.closest("mask, defs") && !e.closest(".disabled, [aria-disabled=true], :disabled"));
            for (const e of icons) {
                const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); const why = []; const warn = [];
                let op = 1; for (let x = e; x && x.nodeType === 1; x = x.parentElement) op *= Number(getComputedStyle(x).opacity);
                const shapes = e.matches("svg") ? [...e.querySelectorAll("path,circle,rect,ellipse,polygon,polyline,line,use,image,text")].filter(g => !g.closest("mask,clipPath,defs")).filter(g => { try { const b = g.getBBox(); return b.width > 0 || b.height > 0; } catch { return false; } }).length : 1;
                const imgOk = !e.matches("img") || (e.complete && e.naturalWidth > 0);
                if (!(r.width > 0 && r.height > 0)) why.push("尺寸 0");
                if (op <= 0.01) why.push("有效 opacity=" + op.toFixed(2));
                if (cs.visibility === "hidden") {
                    // svg 故意隐藏、按钮用 ::before/::after（遮罩字形 / 文本）或另一个可见 svg 画内容：以按钮为准，不算问题
                    const btn = e.closest("button, [role=button]");
                    const alt = btn && (["::before", "::after"].some(ps => { const st = getComputedStyle(btn, ps); return st.content !== "none" && st.content !== "normal" && (st.maskImage !== "none" || st.webkitMaskImage !== "none" || st.backgroundImage !== "none" || st.content.length > 2 || ((lum(st.backgroundColor)?.a ?? 0) > 0.01 && parseFloat(st.width) > 0 && parseFloat(st.height) > 0)); }) || [...btn.querySelectorAll("svg")].some(o => o !== e && getComputedStyle(o).visibility !== "hidden" && o.getBoundingClientRect().width > 0));
                    if (!alt) why.push("visibility:hidden"); else continue;
                }
                if (!shapes) why.push("svg 无图形（空图标）");
                if (!imgOk) why.push("img 未加载");
                const fg = lum(cs.color), bg = bgOf(e);
                let contrast = null;
                if (e.matches("svg") && fg && bg && !e.querySelector("[fill]:not([fill=currentColor]):not([fill=none])")) {
                    const fa = fg.a * op; const Lf = fg.L * fa + bg.L * (1 - fa);
                    contrast = +((Math.max(Lf, bg.L) + 0.05) / (Math.min(Lf, bg.L) + 0.05)).toFixed(2);
                    const arcOrig = !!e.closest('[data-sel="today-clear"], [data-test="today-clear"]'); /* Clear 前的 ↓ 箭头：对比度待 Rea 给出原值后再判，现在既不算失败也不算警告 */
                    if (op > 0.01 && contrast < 1.5 && !arcOrig) (op < 0.99 ? warn : why).push("对比度低 " + contrast + "（color=" + cs.color + "，有效 opacity " + op.toFixed(2) + "）");
                }
                const host = e.closest("[data-test]"); const name = [...e.classList].find(c => c.startsWith("arc-svg-") && c !== "arc-svg")?.slice(8) ?? (e.matches(".arc-boxthings") || e.querySelector(".arc-boxthings") ? "boxthings" : "");
                const exp = host && EXPECT_MAP[host.dataset.test];
                if (exp && name && exp !== name) why.push("图标回退错误：期望 " + exp + " 实际 " + name);
                if (name === "folder" && host && !/folder/i.test(host.dataset.test || "")) why.push("疑似通用 folder 回退图标（" + host.dataset.test + "）");
                if (warn.length) warns.push({ sel: e.tagName.toLowerCase() + (name ? ".arc-svg-" + name : "") + (host ? ' in [data-test="' + host.dataset.test + '"]' : ""), warn });
                if (op <= 0.01 && root.id === "app") continue; // 悬停才显示：由 51996-3b 真实悬停验证
                if (why.length) out.push({ sel: e.tagName.toLowerCase() + (name ? ".arc-svg-" + name : "") + (host ? ' in [data-test="' + host.dataset.test + '"]' : ""), w: Math.round(r.width), h: Math.round(r.height), op: +op.toFixed(2), contrast, why });
            }
            return { n: icons.length, bad: out, warns };
        })`.replace("EXPECT_MAP", JSON.stringify(EXPECT));
        /** (d) 同一行的按钮顶边一致；(a) 溢出可滚 + 不出视口 */
        const LAYOUT = `((root) => {
            const bad = [];
            const vw = innerWidth, vh = innerHeight, rr = root.getBoundingClientRect();
            if (rr.left < -1 || rr.top < -1 || rr.right > vw + 1 || rr.bottom > vh + 1) bad.push({ kind: "出视口", rect: [rr.left, rr.top, rr.right, rr.bottom].map(Math.round), viewport: [vw, vh] });
            const scrollers = [];
            for (const e of [root, ...root.querySelectorAll("*")]) {
                if (!e.checkVisibility()) continue;
                const cs = getComputedStyle(e);
                if (e.scrollHeight > e.clientHeight + 2 && e.clientHeight > 20) { if (/auto|scroll/.test(cs.overflowY)) scrollers.push(e); else if (cs.overflowY === "hidden" || cs.overflowY === "clip") bad.push({ kind: "内容被裁掉（溢出但不能滚）", sel: (e.className || e.tagName) + "", sh: e.scrollHeight, ch: e.clientHeight, oy: cs.overflowY }); }
                if (/flex/.test(cs.display) && !/column/.test(cs.flexDirection)) {
                    const kids = [...e.children].filter(k => k.matches("button, [role=button], .arc-menu-item") && k.checkVisibility());
                    if (kids.length >= 2 && cs.flexWrap === "nowrap") { const tops = kids.map(k => Math.round(k.getBoundingClientRect().top)); if (Math.max(...tops) - Math.min(...tops) > 1) bad.push({ kind: "同行按钮顶边不齐", sel: (e.className || e.tagName) + "", tops }); }
                    if (kids.length >= 2 && cs.flexWrap !== "nowrap") { const tops = [...new Set(kids.map(k => Math.round(k.getBoundingClientRect().top)))]; if (tops.length > 1 && kids.length <= 6) bad.push({ kind: "按钮换行", sel: (e.className || e.tagName) + "", tops }); }
                }
            }
            return { bad, scrollers: scrollers.map((e, i) => { e.setAttribute("data-hx-scr", String(i)); const r = e.getBoundingClientRect(); return { i, sel: (e.className || e.tagName) + "", sh: e.scrollHeight, ch: e.clientHeight, x: r.x + r.width / 2, y: r.y + Math.min(r.height / 2, 40) }; }) };
        })`;
        const runIcons = async (_label: string, rootSel: string) => {
            const all: any[] = [];
            for (const scheme of ["dark", "light"]) {
                await h.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }] }, S()); await sleep(350);
                const r = await ev(`(() => { const root = document.querySelector(${JSON.stringify(rootSel)}); return root ? ${ICONCHK}(root) : null; })()`);
                if (r) { all.push(...r.bad.map((b: any) => ({ scheme, ...b }))); for (const w of r.warns) console.log("WARN", `[${scheme}] ${_label}`, JSON.stringify(w)); }
            }
            await h.send("Emulation.setEmulatedMedia", { features: [] }, S());
            return all;
        };
        // 侧栏本体（含底栏）：深浅两种模式下的图标 + 布局
        await step("【通用】侧栏本体：所有图标深浅色都可见 / 对比度 / 无回退错误；同行按钮顶边一致", 30_000, async () => {
            await closeAll();
            const ic = await runIcons("侧栏", "#app");
            const lay = await ev(`${LAYOUT}(document.querySelector(".arc-slot-bottom"))`);
            const bad = [...ic, ...lay.bad];
            if (bad.length) throw new Error(`[归属:底栏/侧栏] ${JSON.stringify(bad).slice(0, 2000)} 截图 ${await shot("generic-sidebar")}`);
        });
        const POP = process.env.POPOVERS ? new RegExp(process.env.POPOVERS) : null;
        for (const [label, open] of openers.filter(([l]) => !POP || POP.test(l))) {
            await step(`【通用浮层】${label}：(a) 溢出可滚 / 不出视口 (b) 横扫不切空间 (c) 图标深浅可见 (d) 同行对齐`, 40_000, async () => {
                await closeAll();
                void await ev(`[...document.querySelectorAll(${JSON.stringify(FLOAT)})].filter(e => e.checkVisibility()).length`);
                if (!(await open())) return "skip";
                await sleep(600);
                const found = await ev(`(() => { document.querySelectorAll("[data-hx-pop]").forEach(e => e.removeAttribute("data-hx-pop")); const l = [...document.querySelectorAll(${JSON.stringify(FLOAT)})].filter(e => e.checkVisibility() && !e.parentElement?.closest(${JSON.stringify(FLOAT)})); const e = l.at(-1); if (!e) return null; e.setAttribute("data-hx-pop", "1"); return (e.className || e.tagName) + ""; })()`);
                if (!found) { console.log(`   ${label}：没有出现浮层（可能是导航 / 动作项）`); await closeAll(); return "skip"; }
                const issues: any[] = [];
                // (a)
                const lay = await ev(`${LAYOUT}(document.querySelector("[data-hx-pop]"))`);
                issues.push(...lay.bad.map((b: any) => ({ check: "a/d", ...b })));
                for (const sc of lay.scrollers) {
                    await ev(`document.querySelector('[data-hx-scr="${sc.i}"]').scrollTop = 0`);
                    await h.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: sc.x, y: sc.y }, S());
                    for (let i = 0; i < 3; i++) { await h.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: sc.x, y: sc.y, deltaX: 0, deltaY: 120 }, S()); await sleep(100); }
                    await sleep(300);
                    const st = await ev(`document.querySelector('[data-hx-scr="${sc.i}"]')?.scrollTop ?? -1`);
                    if (!(st > 0)) issues.push({ check: "a", kind: "溢出但滚轮滚不动", sel: sc.sel, sh: sc.sh, ch: sc.ch, scrollTopAfter: st });
                }
                // (b) 横扫（触控板式 deltaX）不能切换空间
                const sp0 = await spaceId();
                const pr = await rect("[data-hx-pop]");
                if (pr) { for (const dx of [160, -160, 160]) { await h.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: pr.x, y: pr.y, deltaX: dx, deltaY: 0 }, S()); await sleep(120); } await sleep(500); }
                const sp1 = await spaceId();
                if (sp0 !== sp1) issues.push({ check: "b", kind: "浮层打开时横扫切换了空间", before: sp0, after: sp1 });
                // (c)
                if (await rect("[data-hx-pop]")) issues.push(...(await runIcons(label, "[data-hx-pop]")).map(b => ({ check: "c", ...b })));
                if (issues.length) { const f = await shot("generic-" + label.replace(/\W+/g, "_")); throw new Error(`浮层 ${found}：${JSON.stringify(issues).slice(0, 2200)} 截图 ${f}`); }
                console.log(`   ${label} → ${found}：滚动容器 ${lay.scrollers.length} 个，检查通过`);
                await closeAll();
                if (sp0 !== (await spaceId())) await h.evalIn(opener!.sessionId, `0`);
            });
        }
    }

    } // generic
    if (PH.has("theme")) {
    // ===== 主题一致性（浅 / 深 / 自定义空间主题）：每个浮层、菜单、ArcTooltip 的背景与文字颜色跟随当前主题；data-tip 元素不得带 title / svg<title> =====
    {
        const shortPath = `(e => { const p = []; for (let x = e; x && x.nodeType === 1 && x.id !== "app" && p.length < 4; x = x.parentElement) p.unshift(x.tagName.toLowerCase() + (x.classList[0] ? "." + x.classList[0] : "")); return p.join(">"); })`;
        const idOf = `(e => e.dataset.sel ?? e.dataset.test ?? ${shortPath}(e))`;
        /** 页面内：root 的合成背景亮度、所有带文字子元素的颜色亮度与对比度；按 isDark 规则判断极性 */
        const THEMECHK = `((root) => {
            const P = c => { const m = /rgba?\\(([^)]+)\\)/.exec(c || ""); if (!m) return null; const v = m[1].split(/[ ,\\/]+/).filter(Boolean).map(Number); return { v: v.slice(0, 3), a: v[3] ?? 1 }; };
            const L = v => { const f = x => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(v[0]) + 0.7152 * f(v[1]) + 0.0722 * f(v[2]); };
            const th = document.documentElement.dataset.theme; const dark = th === "dark" || (th !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
            const bgOf = e => { const layers = []; for (let x = e; x; x = x.parentElement) { const b = P(getComputedStyle(x).backgroundColor); if (b && b.a > 0) { layers.push(b); if (b.a >= 0.95) break; } } let base = dark ? [0, 0, 0] : [255, 255, 255]; for (const l of layers.reverse()) base = base.map((c, i) => c * (1 - l.a) + l.v[i] * l.a); return base; };
            const bad = []; const rb = bgOf(root); const rL = L(rb);
            if (dark ? rL > 0.35 : rL < 0.35) bad.push({ el: ${idOf}(root), kind: (dark ? "深色主题下浮层背景偏亮" : "浅色主题下浮层背景偏暗"), bg: "rgb(" + rb.map(Math.round).join(",") + ")", L: +rL.toFixed(3) });
            for (const e of [root, ...root.querySelectorAll("*")]) {
                if (!e.checkVisibility() || ![...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
                const fg = P(getComputedStyle(e).color); if (!fg) continue;
                const b = bgOf(e); const fv = fg.v.map((c, i) => c * fg.a + b[i] * (1 - fg.a)); const fL = L(fv), bL = L(b);
                const cr = (Math.max(fL, bL) + 0.05) / (Math.min(fL, bL) + 0.05);
                // 豁免（仅极性判断）：站点控制扩展格的字母头像 .arc-sc-ext-letter 是有意的白字 + 彩色底（command/style.ts:108，background: hsl(var(--h) 35% 45%)），不随主题；对比度照常检查
                const intentional = e.matches(".arc-sc-ext-letter");
                if (!intentional && (dark ? fL < bL : fL > bL)) bad.push({ el: ${idOf}(e), kind: "文字明暗与主题相反（残留另一模式的颜色）", color: getComputedStyle(e).color, bg: "rgb(" + b.map(Math.round).join(",") + ")" });
                else if (cr < 2.5 && !e.closest(".disabled,[aria-disabled=true],:disabled")) bad.push({ warn: true, el: ${idOf}(e), kind: "文字对比度低 " + cr.toFixed(2) + "（无规格值，只警告）", color: getComputedStyle(e).color, bg: "rgb(" + b.map(Math.round).join(",") + ")" });
            }
            return { dark, bad: bad.slice(0, 12) };
        })`;
        const FLOAT2 = `.arc-menu:not([hidden]), [data-test="plus-menu"]:not([hidden]), .arc-overlay, .arc-icon-picker, [role=dialog], .arc-tooltip`;
        const opens: [string, () => Promise<unknown>][] = [
            ["＋ 菜单", () => realClick('[data-test="plus-btn"]')],
            ["Library", () => realClick('[data-test="library-btn"]')],
            ["站点控制", () => realClick('[data-test="site-controls-btn"]')],
            ["空间 ⋯ 菜单", () => realClick('[data-test="space-more"]')],
            ["右键 标签行", () => realClick(".arc-today .arc-tab, .arc-slot-today .arc-tab", "right")],
            ["空间主题选择器", async () => { await realClick(".arc-space-title", "right"); await sleep(300); return realClick('.arc-menu:not([hidden]) [data-test="theme"]'); }],
            ["管理空间", async () => { await realClick(".arc-space-title", "right"); await sleep(300); return realClick('.arc-menu:not([hidden]) [data-test="manage"]'); }],
        ];
        const setTheme = async (name: string) => {
            await h.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: name === "深色" ? "dark" : "light" }] }, S());
            if (name === "浅色") await ev(`delete document.documentElement.dataset.theme`);
            if (name === "深色") await ev(`__hxTheme("dark")`);
            if (name === "自定义空间主题") {
                await ev(`delete document.documentElement.dataset.theme`);
                await closeAll(); await realClick(".arc-space-title", "right"); await sleep(300); await realClick('.arc-menu:not([hidden]) [data-test="theme"]'); await sleep(500);
                // 选第一个非默认色板（真实点击）
                const ok = await ev(`(() => { const b = [...document.querySelectorAll(".arc-theme-picker .arc-tp-swatches button, .arc-theme-picker [data-test^='tp-color']")].find(x => !x.classList.contains("on") && x.checkVisibility()); if (!b) return false; b.setAttribute("data-hx-sw", "1"); return true; })()`);
                if (ok) { await realClick('[data-hx-sw="1"]'); await sleep(600); }
                await closeAll();
                console.log("   自定义空间主题：", ok ? "已真实点击色板" : "没找到色板（用默认）", "data-theme=", await ev("document.documentElement.dataset.theme ?? '(无)'"));
            }
            await sleep(400);
        };
        for (const theme of ["浅色", "深色", "自定义空间主题"]) {
            await step(`【主题一致性 · ${theme}】每个浮层 / 菜单 / ArcTooltip 背景与文字跟随主题`, 60_000, async () => {
                await setTheme(theme);
                const issues: any[] = [];
                for (const [label, open] of opens) {
                    await closeAll(); if (!(await open())) continue; await sleep(500);
                    const r = await ev(`(() => { const l = [...document.querySelectorAll(${JSON.stringify(FLOAT2)})].filter(e => e.checkVisibility() && !e.parentElement?.closest(${JSON.stringify(FLOAT2)})); const e = l.at(-1); return e ? ${THEMECHK}(e) : null; })()`);
                    if (r) issues.push(...r.bad.map((b: any) => ({ where: label, ...b })));
                    await closeAll();
                }
                // ArcTooltip：真实悬停每个可见 data-tip 元素（最多 12 个）
                // ArcTooltip 读完 data-tip 就移除它（ArcTooltip.ts:365），挂过的宿主带 data-arc-tt（HOST_ATTR，:400）——两者都算 data-tip 元素；不取仅有 aria-label 的元素（地址栏按规则无 tooltip）
                const tips: string[] = await ev(`(() => { let i = 0; return [...document.querySelectorAll("#app [data-tip], #app [data-arc-tt]")].filter(e => e.checkVisibility() && !e.closest('[data-sel="today-clear"], [data-test="today-clear"], [data-test=urlbar]')).slice(0, 12).map(e => { const k = "tp" + (i++); e.setAttribute("data-hx-tip", k); return k; }); })()`) ?? [];
                let shown = 0;
                for (const k of tips) {
                    const pt = await rect(`[data-hx-tip="${k}"]`); if (!pt) continue;
                    await h.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: pt.x, y: pt.y }, S()); await sleep(900);
                    const r = await ev(`(() => { const t = [...document.querySelectorAll(".arc-tooltip")].find(e => e.checkVisibility()); return t ? { who: ${idOf}(document.querySelector('[data-hx-tip="${k}"]')), ...${THEMECHK}(t) } : null; })()`);
                    if (r) { shown++; issues.push(...r.bad.map((b: any) => ({ where: "ArcTooltip @ " + r.who, ...b }))); }
                    await h.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 5, y: 600 }, S()); await sleep(200);
                }
                console.log(`   [${theme}] 悬停 ${tips.length} 个 data-tip 元素，出现 tooltip ${shown} 个`);
                for (const w of issues.filter((i: any) => i.warn)) console.log("WARN", `[${theme}]`, JSON.stringify(w));
                const hard = issues.filter((i: any) => !i.warn);
                if (hard.length) throw new Error(`${JSON.stringify(hard).slice(0, 2500)} 截图 ${await shot("theme-" + theme)}`);
            });
            await step(`【data-tip 无原生 title · ${theme}】带 data-tip 的元素及其子孙没有 title 属性 / svg <title>`, 10_000, async () => {
                const bad = await ev(`[...document.querySelectorAll("[data-tip]")].flatMap(e => [e, ...e.querySelectorAll("*")].filter(x => x.hasAttribute("title") || (x.tagName.toLowerCase() === "title" && x.closest("svg"))).map(x => ({ el: ${idOf}(e), node: x === e ? "自身" : ${shortPath}(x), title: x.getAttribute("title") ?? x.textContent }))).slice(0, 30)`) ?? [];
                if (bad.length) throw new Error(JSON.stringify(bad).slice(0, 2500));
            });
        }
        // —— 规格（/workspace/arc-analysis/dark-mode-title-audit.md 末尾）——
        await step("【ArcTooltip 规格】深色：背景 #2B2B2B = rgb(43,43,43)、文字 rgb(255,255,255)（Rea 源码值，逐通道 ±1）、边框 rgba(255,255,255,0.1)；浅色（data-bb-dark=0）背景 > .9", 30_000, async () => {
            await h.send("Emulation.setEmulatedMedia", { features: [] }, S()); await closeAll();
            const orig = await ev(`({ t: document.documentElement.dataset.theme ?? null, bb: document.documentElement.dataset.bbDark ?? null })`);
            // 只取 data-tip 元素（未处理的 [data-tip] 或已挂 ArcTooltip 的 [data-arc-tt]，后者是 data-tip 被读走后的形态，ArcTooltip.ts:365/400）；不再取 aria-label——否则会取到地址栏（按 Rea 无 tooltip）
            const tipEl = await ev(`(() => { const e = [...document.querySelectorAll("#app button[data-tip], #app [role=button][data-tip], #app [data-tip], #app button[data-arc-tt], #app [role=button][data-arc-tt], #app [data-arc-tt]")].find(x => x.checkVisibility() && !x.closest("[data-test=urlbar]")); if (!e) return null; e.setAttribute("data-hx-tt", "1"); return e.dataset.sel ?? e.dataset.test ?? e.className; })()`);
            if (!tipEl) throw new Error("侧栏里没有可见的 data-tip 元素");
            const measure = async () => {
                const pt = await rect('[data-hx-tt="1"]'); if (!pt) return null;
                await h.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 5, y: 600 }, S()); await sleep(150);
                await h.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: pt.x, y: pt.y }, S()); await sleep(600);
                return ev(`(() => { const t = [...document.querySelectorAll(".arc-tooltip")].find(e => e.checkVisibility()); if (!t) return null; const cs = getComputedStyle(t);
                    const P = c => { const m = /rgba?\\(([^)]+)\\)/.exec(c); const v = m[1].split(/[ ,\\/]+/).filter(Boolean).map(Number); return v; };
                    const L = v => { const f = x => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return +(0.2126 * f(v[0]) + 0.7152 * f(v[1]) + 0.0722 * f(v[2])).toFixed(3); };
                    return { bg: cs.backgroundColor, fg: cs.color, border: cs.borderTopColor, bgL: L(P(cs.backgroundColor)), fgL: L(P(cs.color)) }; })()`);
            };
            const fails: string[] = [];
            await ev(`__hxTheme("dark")`); await sleep(300);
            const d = await measure();
            if (!d) fails.push(`深色：悬停 ${tipEl} 后没有出现 .arc-tooltip`);
            else {
                const exact = (c: string, want: number[]) => { const v = (/rgba?\(([^)]+)\)/.exec(c)?.[1] ?? "").split(/[ ,\/]+/).filter(Boolean).map(Number); return v.length >= 3 && want.every((w, i) => Math.abs(v[i] - w) <= 1) && (v[3] ?? 1) >= 0.99; };
                if (!exact(d.bg, [43, 43, 43])) fails.push(`深色 tooltip 背景 ${d.bg}，期望 rgb(43, 43, 43)（#2B2B2B，±1）`);
                if (!exact(d.fg, [255, 255, 255])) fails.push(`深色 tooltip 文字 ${d.fg}，期望 rgb(255, 255, 255)（±1）`);
                if (d.border.replace(/\s/g, "") !== "rgba(255,255,255,0.1)") fails.push(`深色 tooltip 边框 ${d.border}，期望 rgba(255,255,255,0.1)`);
            }
            await ev(`(__hxTheme("light"), document.documentElement.dataset.bbDark = "0")`); await sleep(300);
            const l = await measure();
            if (!l) fails.push(`浅色：悬停 ${tipEl} 后没有出现 .arc-tooltip`);
            else if (!(l.bgL > 0.9)) fails.push(`浅色 tooltip 背景 ${l.bg}（亮度 ${l.bgL}），期望 > .9`);
            await ev(`(() => { const R = document.documentElement, o = ${JSON.stringify(orig)}; if (o.t == null) delete R.dataset.theme; else R.dataset.theme = o.t; if (o.bb == null) delete R.dataset.bbDark; else R.dataset.bbDark = o.bb; return __hxRestoreAd(); })()`);
            await h.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 5, y: 600 }, S());
            console.log(`   tooltip（${tipEl}）深色 ${JSON.stringify(d)} 浅色 ${JSON.stringify(l)}`);
            if (fails.length) throw new Error(`${fails.join(" ‖ ")} 截图 ${await shot("tooltip-spec")}`);
        });
        await step("【data-tip 规格】[data-tip][title] / [data-tip] [title] 为 0；.arc-tab / .arc-lib-row / .arc-today-hbtn 悬停 600ms 后无 title", 40_000, async () => {
            const fails: any[] = [];
            const scan = () => ev(`[...document.querySelectorAll("[data-tip][title], [data-tip] [title]")].map(x => ({ el: (x.closest("[data-tip]")?.dataset.sel ?? x.closest("[data-tip]")?.dataset.test ?? ${shortPath}(x)), node: ${shortPath}(x), title: x.getAttribute("title") })).slice(0, 20)`);
            fails.push(...(await scan()));
            const hoverSel = async (sel: string) => {
                const keys: string[] = await ev(`[...document.querySelectorAll(${JSON.stringify(sel)})].filter(e => e.checkVisibility()).slice(0, 4).map((e, i) => (e.setAttribute("data-hx-h", "h" + i), "h" + i))`) ?? [];
                for (const k of keys) {
                    const pt = await rect(`[data-hx-h="${k}"]`); if (!pt) continue;
                    await h.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: pt.x, y: pt.y }, S()); await sleep(600);
                    const t = await ev(`(() => { const e = document.querySelector('[data-hx-h="${k}"]'); const hit = [e, ...e.querySelectorAll("*")].filter(x => x.hasAttribute("title") || (x.tagName.toLowerCase() === "title" && x.closest("svg"))); return hit.map(x => ({ el: e.dataset.sel ?? e.dataset.test ?? ${shortPath}(e), node: x === e ? "自身" : ${shortPath}(x), title: x.getAttribute("title") ?? x.textContent })); })()`);
                    fails.push(...(t ?? []));
                }
            };
            await closeAll();
            await hoverSel(".arc-tab"); await hoverSel(".arc-today-hbtn");
            if (await realClick('[data-test="library-btn"]')) { await sleep(600); await hoverSel(".arc-lib-row"); await closeAll(); }
            await h.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 5, y: 600 }, S());
            if (fails.length) throw new Error(JSON.stringify(fails).slice(0, 2500));
        });
        await step("【悬停 5s 不回挂 title】每类 tooltip 宿主各抽样 1 个，真实悬停并停留 5s，期间与之后都不得出现 title / svg<title>（含内部 img / favicon）", 75_000, async () => {
            await closeAll();
            const KINDS: [string, string][] = [
                ["标签行 .arc-tab", ".arc-tab"],
                ["Today 标题按钮 .arc-today-hbtn", ".arc-today-hbtn"],
                ["[data-tip]", "#app [data-tip]"],
                ["aria-label 按钮", "#app button[aria-label], #app [role=button][aria-label]"],
                ["资料库行 .arc-lib-row", ".arc-lib-row"],
            ];
            const titled = (sel: string) => ev(`[...document.querySelectorAll(${JSON.stringify(sel)})].flatMap(e => [e, ...e.querySelectorAll("*")].filter(x => x.hasAttribute("title") || (x.tagName.toLowerCase() === "title" && x.closest("svg"))).map(x => ({ el: e.dataset.sel ?? e.dataset.test ?? ${shortPath}(e), node: x === e ? "自身" : ${shortPath}(x), title: x.getAttribute("title") ?? x.textContent })))`);
            const fails: any[] = []; const done: string[] = [];
            for (const [kind, sel] of KINDS) {
                if (kind.startsWith("资料库")) {
                    // 资料库空时没有行：先放一条归档记录（存储键与自测页一致）
                    await h.evalIn(opener!.sessionId, `chrome.storage.local.get("data:archive").then(r => { const d = r["data:archive"] ?? { items: [] }; if (!(d.items ?? []).length) { d.items = [{ id: "hx-arch", url: "https://example.com/?arc-harness-archive", title: "Harness archive row", spaceId: "default", at: Date.now() }]; return chrome.storage.local.set({ "data:archive": d }); } }).then(() => 1)`).catch(() => 0);
                    await sleep(300);
                    if (!(await realClick('[data-test="library-btn"]'))) continue; await sleep(700);
                    await ev(`(document.querySelector('[data-test="lib-tab-archive"], [data-test="library-archive"]')?.click(), 1)`).catch(() => 0); await sleep(500);
                }
                const key = await ev(`(() => { document.querySelectorAll("[data-hx-hold]").forEach(x => x.removeAttribute("data-hx-hold")); const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find(x => x.checkVisibility() && !x.closest('[data-sel="today-clear"]') ); if (!e) return null; e.setAttribute("data-hx-hold", "1"); return e.dataset.sel ?? e.dataset.test ?? ${shortPath}(e); })()`);
                if (!key) { console.log(`   ${kind}：当前没有可见宿主，跳过`); continue; }
                const pt = await rect('[data-hx-hold="1"]'); if (!pt) continue;
                await h.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 5, y: 600 }, S()); await sleep(150);
                await h.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: pt.x, y: pt.y }, S());
                // 停留 5s：每 500ms 扫一次该宿主（期间出现过也算）
                for (let t = 0; t < 10; t++) { await sleep(500); const hit = await titled('[data-hx-hold="1"]'); if (hit?.length) { fails.push(...hit.map((x: any) => ({ kind, at: `${(t + 1) * 0.5}s`, ...x }))); break; } }
                await h.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 5, y: 600 }, S()); await sleep(300);
                done.push(`${kind}（${key}）`);
                if (kind.startsWith("资料库")) await closeAll();
            }
            // 悬停后全侧栏复扫：[data-tip] 及带 aria-label 的 tooltip 宿主
            const after = await titled("#app [data-tip], #app button[aria-label], #app [role=button][aria-label], .arc-tab, .arc-today-hbtn");
            fails.push(...(after ?? []).map((x: any) => ({ kind: "悬停后复扫", ...x })));
            console.log(`   已悬停 5s：${done.join(" | ")}`);
            if (fails.length) throw new Error(JSON.stringify(fails.slice(0, 20)).slice(0, 2500));
        });
        await h.send("Emulation.setEmulatedMedia", { features: [] }, S());
    }
    await ev(`__hxRestoreAd()`).catch(() => { });
    } // theme
    if (PH.has("tooltip") || PH.has("theme")) {
    // ===== 只允许 ArcTooltip 一种提示：无原生 title / 无别的浮动 tooltip / ArcTooltip 样式只来自自身 CSS 变量（浅 / 深，悬停后）=====
    {
        /** 被禁止的提示选择器（可配置：迷你播放器线程后续给出具体项；TIP_BLOCK=逗号分隔 追加） */
        /* 规格（迷你播放器审计终版）：只允许根 .arc-tooltip；以下都可配置 */
        const TITLE_BLOCK = ["button[title]", "a[title]", "[role=button][title]", "[role=tab][title]", "[role=menuitem][title]", "[tabindex][title]", ...(process.env.TITLE_BLOCK ?? "").split(",").map(x => x.trim()).filter(Boolean)];
        const TIP_BLOCKLIST: string[] = ["[class*=tooltip]:not(.arc-tooltip)", "[class*=-tip]", "[class*=hint]", ...(process.env.TIP_BLOCK ?? "").split(",").map(x => x.trim()).filter(Boolean)];
        const TIP_EXCLUDE = [".arc-kbd", ".arc-toast", ".arc-cmd-results .arc-menu-kbd", ".arc-cmd-results kbd", ".arc-cmd-results [class*=shortcut]", ...(process.env.TIP_EXCLUDE ?? "").split(",").map(x => x.trim()).filter(Boolean)];
        const INTERACTIVE = TITLE_BLOCK.join(", ");
        const TT_PROPS = ["backgroundImage", "backgroundColor", "color", "borderTopColor", "borderTopWidth", "borderTopStyle", "fontSize", "fontWeight", "fontFamily", "borderTopLeftRadius", "borderTopRightRadius", "borderBottomLeftRadius", "borderBottomRightRadius", "paddingLeft", "paddingRight", "paddingTop", "paddingBottom", "boxShadow"];
        const TT_INLINE_OK = ["left", "top", "border-radius", "border-top-left-radius", "border-top-right-radius", "border-bottom-left-radius", "border-bottom-right-radius"]; // 产品自己按方向写的圆角 + 定位
        const SCAN = `((blocklist, INTER, PROPS, INLINE_OK, EXCL) => {
            const path = e => { const p = []; for (let x = e; x && x.nodeType === 1 && p.length < 5; x = x.parentElement) { p.unshift(x.tagName.toLowerCase() + (x.dataset?.sel ? "[data-sel=" + x.dataset.sel + "]" : x.dataset?.test ? "[data-test=" + x.dataset.test + "]" : x.classList[0] ? "." + x.classList[0] : "")); if (x.id === "app") break; } return p.join(">"); };
            const out = { titles: [], foreign: [], blocked: [], style: [], tooltips: 0 };
            const roots = [document, ...[...document.querySelectorAll("*")].map(e => e.shadowRoot).filter(Boolean)];
            for (const R of roots) {
                for (const e of R.querySelectorAll(INTER)) if (e.hasAttribute("title") && e.getAttribute("title").trim()) out.titles.push({ path: path(e), title: e.getAttribute("title").slice(0, 80) });
                for (const e of R.querySelectorAll("svg title")) if (e.closest(INTER)) out.titles.push({ path: path(e.closest(INTER)) + " svg>title", title: (e.textContent || "").slice(0, 80) });
                for (const sel of blocklist) for (const e of R.querySelectorAll(sel)) {
                    if (e.closest(".arc-tooltip") || EXCL.some(x => e.closest(x))) continue;
                    if (!e.checkVisibility?.()) continue;
                    const cs = getComputedStyle(e), r = e.getBoundingClientRect(); if (!r.width || !r.height || cs.opacity === "0") continue;
                    const cls = typeof e.className === "string" ? e.className : e.getAttribute("class") || "";
                    if (!/fixed|absolute/.test(cs.position)) continue; /* 规格只管浮动元素：.arc-hint 这类静态空状态占位不算 */
                    out.foreign.push({ sel, path: path(e), cls: cls.slice(0, 80), pos: cs.position, text: (e.textContent || "").trim().slice(0, 60) });
                }
                for (const t of R.querySelectorAll(".arc-tooltip")) {
                    out.tooltips++;
                    const extra = [...t.classList].filter(c => !["arc-tooltip", "out"].includes(c));
                    const inl = /color|background/i.test(t.getAttribute("style") || "") ? [...t.style].filter(p => /color|background/.test(p)) : []; /* 规格：style 里出现 color / background 即违规 */
                    const probe = document.createElement("div"); probe.className = "arc-tooltip"; probe.dataset.v = t.dataset.v ?? "0"; probe.style.cssText = "position:fixed;left:-9999px;top:-9999px;animation:none"; probe.textContent = "x"; (t.parentNode || R).appendChild(probe);
                    const a = getComputedStyle(t), b = getComputedStyle(probe);
                    const diff = PROPS.filter(p => !(t.style.borderRadius && /Radius/.test(p)) && a[p] !== b[p]).map(p => p + ": " + a[p] + " ≠ " + b[p]);
                    probe.remove();
                    if (extra.length || inl.length || diff.length) out.style.push({ text: (t.textContent || "").slice(0, 40), extraClass: extra, inlineOverride: inl.map(p => p + ":" + t.style.getPropertyValue(p)), diff });
                }
            }
            return out;
        })`;
        await step("【唯一提示 = ArcTooltip】浅 / 深 × 侧栏 + ＋ 菜单：无原生 title、无别的浮动提示、ArcTooltip 样式只来自自身变量", 90_000, async () => {
            const bad: string[] = []; let hovered = 0, seen = 0;
            for (const theme of ["light", "dark"]) {
                await closeAll(); await ev(`__hxTheme(${JSON.stringify(theme)})`); await sleep(300);
                for (const ctx of ["侧栏", "＋ 菜单"]) {
                    if (ctx === "＋ 菜单") await openPlusFor("plus-tab").catch(() => false);
                    const scope = ctx === "侧栏" ? "#app" : LIVE_MENU;
                    const hosts: { x: number; y: number }[] = await ev(`[...document.querySelectorAll(${JSON.stringify(scope)} + " [data-arc-tt], " + ${JSON.stringify(scope)} + " .arc-menu-item")].filter(e => e.checkVisibility()).slice(0, 10).map(e => { const r = e.getBoundingClientRect(); return { x: r.x + Math.min(12, r.width / 2), y: r.y + r.height / 2 }; }).filter(p => p.x > 0 && p.y > 0)`) ?? [];
                    for (const p of hosts) {
                        await h.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y }, S()); await sleep(650); hovered++;
                        const r = await ev(`${SCAN}(${JSON.stringify(TIP_BLOCKLIST)}, ${JSON.stringify(INTERACTIVE)}, ${JSON.stringify(TT_PROPS)}, ${JSON.stringify(TT_INLINE_OK)}, ${JSON.stringify(TIP_EXCLUDE)})`);
                        seen += r.tooltips;
                        const L = (k: string, x: any) => bad.push(`[${theme}·${ctx}] ${k} ${JSON.stringify(x)}`);
                        r.titles.forEach((x: any) => L("原生 title", x)); r.foreign.forEach((x: any) => L("非 ArcTooltip 浮动提示", x)); r.blocked.forEach((x: any) => L("禁用选择器", x)); r.style.forEach((x: any) => L("ArcTooltip 样式被覆盖", x));
                    }
                    await h.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 2, y: 2 }, S()); await closeAll();
                }
            }
            await ev(`(__hxTheme(null), __hxRestoreAd())`).catch(() => { });
            /* 封闭 shadow root 里的 data-tip 永远不会显示（页面 JS 看不到 closed root，ArcTooltip 的 observer 也看不到）→ 用 CDP DOM.getDocument pierce 找 */
            const closedTips = async (sid: string, where: string) => {
                const { root } = await h.send("DOM.getDocument", { depth: -1, pierce: true }, sid).catch(() => ({ root: null as any }));
                const walk = (n: any, closed: string | null, path: string[]) => {
                    if (!n) return;
                    const nm = (n.localName || n.nodeName || "").toLowerCase();
                    const attrs: string[] = n.attributes ?? []; const ai = attrs.indexOf("data-tip");
                    const label = nm + (attrs.includes("class") ? "." + String(attrs[attrs.indexOf("class") + 1]).split(" ")[0] : "");
                    if (closed && ai >= 0) bad.push(`[${where}] closed shadow 内的 data-tip（不会显示） ${JSON.stringify({ host: closed, path: [...path, label].slice(-4).join(">"), tip: attrs[ai + 1] })}`);
                    for (const c of n.children ?? []) walk(c, closed, [...path, label]);
                    for (const sr of n.shadowRoots ?? []) walk(sr, sr.shadowRootType === "closed" ? (closed ?? label) : closed, [...path, label, "#shadow(" + sr.shadowRootType + ")"]);
                    if (n.contentDocument) walk(n.contentDocument, closed, [...path, label]);
                };
                walk(root, null, []);
            };
            await closedTips(S(), "侧栏");
            for (const t of h.targets.values()) if (t.alive && t.sessionId && t.type === "page" && /^https?:/.test(t.url)) await closedTips(t.sessionId, "网页 " + t.url.slice(0, 50));
            const uniq = [...new Set(bad)];
            console.log(`   悬停 ${hovered} 次，看到 ArcTooltip ${seen} 次，问题 ${uniq.length} 条；禁用选择器：${JSON.stringify(TIP_BLOCKLIST)}`);
            if (uniq.length) throw new Error(`${uniq.slice(0, 25).join(" ‖ ")} 截图 ${await shot("tooltip-only")}`);
        });
        /* Rea：地址栏本体及内部按钮都没有 tooltip，只留 aria-label；[data-test=urlbar] 内不得出现 .arc-tooltip，悬停它也不得触发 */
        await step("【地址栏无 tooltip】真实悬停地址栏及其每个按钮 ≥1.8s：不出现 .arc-tooltip（含 urlbar 内部），aria-label 不算原生 title", 60_000, async () => {
            await closeAll(); await ev(`__hxTheme(null)`).catch(() => { });
            const has = await ev(`!!document.querySelector('[data-test="urlbar"]')`);
            if (!has) { console.log("   无地址栏（Navigation 未启用），跳过"); return; }
            const bad: string[] = []; let n = 0;
            await h.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 2, y: 2 }, S()); await sleep(300);
            /* 先悬停本体，按钮在悬停时才出现，再取各按钮坐标 */
            const ubP = await ev(`(() => { const r = document.querySelector('[data-test="urlbar"]').getBoundingClientRect(); return { x: r.x + Math.min(30, r.width / 3), y: r.y + r.height / 2 }; })()`);
            const probe = async (who: string, p: { x: number; y: number }) => {
                await h.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y }, S()); await sleep(1800); n++;
                const r = await ev(`(() => { const ub = document.querySelector('[data-test="urlbar"]'); const tts = [...document.querySelectorAll(".arc-tooltip")].filter(e => e.checkVisibility() && !e.classList.contains("out")); const inner = ub ? [...ub.querySelectorAll(".arc-tooltip")].length : 0; const hov = document.elementFromPoint(${p.x}, ${p.y}); return { tips: tts.map(t => (t.textContent || "").slice(0, 60)), inner, hit: hov ? (hov.closest("[data-test]")?.getAttribute("data-test") || hov.className) : null, title: ub ? [ub, ...ub.querySelectorAll("*")].filter(e => e.hasAttribute("title")).map(e => e.getAttribute("data-test") || e.className) : [] }; })()`);
                if (r.tips.length) bad.push(`悬停地址栏「${who}」出现 .arc-tooltip ${JSON.stringify(r.tips)}`);
                if (r.inner) bad.push(`[data-test=urlbar] 内出现 .arc-tooltip ×${r.inner}（${who}）`);
                if (r.title.length) bad.push(`地址栏内有原生 title ${JSON.stringify(r.title)}`);
            };
            await probe("本体", ubP);
            const btns: { id: string; x: number; y: number }[] = await ev(`[...document.querySelectorAll('[data-test="urlbar"] button, [data-test="urlbar"] .arc-urlbar-btn, [data-test="urlbar"] [role=button], [data-test="urlbar"] [tabindex]')].filter(e => e.checkVisibility()).map(e => { const r = e.getBoundingClientRect(); return { id: e.getAttribute("data-test") || e.getAttribute("aria-label") || e.className, x: r.x + r.width / 2, y: r.y + r.height / 2 }; }).filter(p => p.x > 0 && p.y > 0)`) ?? [];
            for (const b of btns) { await h.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 2, y: 2 }, S()); await sleep(200); await h.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: ubP.x, y: ubP.y }, S()); await sleep(200); await probe(b.id, b); }
            await h.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 2, y: 2 }, S());
            const lbl = await ev(`document.querySelector('[data-test="urlbar"]').getAttribute("aria-label")`);
            console.log(`   地址栏悬停 ${n} 处（按钮 ${btns.map(b => b.id).join(", ")}），aria-label=${JSON.stringify(lbl)}`);
            if (bad.length) throw new Error(`${[...new Set(bad)].join(" ‖ ")} 截图 ${await shot("urlbar-notip")}`);
        });
    }
    } // tooltip
    if (PH.has("theme") || PH.has("tooltip")) {
    // ===== 彩色空间主题下 tooltip 保持中性（深蓝 + 红 + 绿，浅 / 深）：深色底 #2B2B2B 白字；浅色底白黑字；键帽 / 副标题无色相 =====
    {
        const TT_DARK_BG = "rgb(43, 43, 43)"; // #2B2B2B（Rea 可能再调，只改这一处）
        const TT_DARK_FG = "rgb(255, 255, 255)", TT_LIGHT_BG = "rgb(255, 255, 255)", TT_LIGHT_FG = "rgb(0, 0, 0)";
        const THEMES: [string, any][] = [["深蓝", { color: "blue", theme: { gradient: "duo", color2: "purple" } }], ["红", { color: "red", theme: { gradient: "soft" } }], ["绿", { color: "green", theme: { gradient: "soft" } }]];
        await step("【tooltip 中性】深蓝 / 红 / 绿空间主题 × 浅 / 深：背景与文字固定，键帽 / 副标题 R=G=B", 90_000, async () => {
            const O = opener!.sessionId; const bad: string[] = []; const seen: string[] = [];
            const rpc = (m: string, ...a: unknown[]) => h.evalIn(O, `chrome.runtime.sendMessage({ type: "arc-sidebar:rpc", method: ${JSON.stringify(m)}, args: ${JSON.stringify(a)} }).then(r => r?.result ?? r)`);
            const sp = await h.evalIn(O, `chrome.storage.local.get("data:spaces").then(r => { const d = r["data:spaces"]; const s = d.spaces.find(x => x.id === d.activeId); return { id: d.activeId, color: s.color, theme: s.theme ?? null }; })`);
            for (const [tn, patch] of THEMES) {
                await rpc("spaces:update", sp.id, patch); await sleep(500);
                for (const mode of ["light", "dark"]) {
                    await h.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: mode }] }, S());
                    await ev(`__hxTheme(${JSON.stringify(mode)})`); await sleep(300);
                    /* 依次悬停带提示的宿主：至少拿到一个 tooltip；顺便找带键帽 / 副标题的 */
                    const hosts: { x: number; y: number }[] = await ev(`[...document.querySelectorAll("#app [data-arc-tt]")].filter(e => e.checkVisibility()).slice(0, 8).map(e => { const r = e.getBoundingClientRect(); return { x: r.x + Math.min(12, r.width / 2), y: r.y + r.height / 2 }; })`) ?? [];
                    let got = 0;
                    for (const p of hosts) {
                        await h.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 2, y: 2 }, S()); await sleep(80);
                        await h.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y }, S()); await sleep(650);
                        const r = await ev(`(() => { const t = document.querySelector(".arc-tooltip:not(.out)"); if (!t) return null; const cs = getComputedStyle(t);
                            const sub = t.querySelector("small"), k = t.querySelector("kbd");
                            const c = e => e ? (s => ({ color: s.color, bg: s.backgroundColor, border: s.borderTopColor, shadow: s.boxShadow }))(getComputedStyle(e)) : null;
                            return { text: t.textContent.slice(0, 30), bg: cs.backgroundColor, fg: cs.color, sub: c(sub), kbd: c(k) }; })()`);
                        if (!r) continue; got++;
                        const L = (x: string) => bad.push(`[${tn}·${mode}] “${r.text}” ${x}`);
                        const wantBg = mode === "dark" ? TT_DARK_BG : TT_LIGHT_BG, wantFg = mode === "dark" ? TT_DARK_FG : TT_LIGHT_FG;
                        if (r.bg !== wantBg) L(`背景 ${r.bg}，期望 ${wantBg}`);
                        if (r.fg !== wantFg) L(`文字 ${r.fg}，期望 ${wantFg}`);
                        const gray = (c: string) => { const m = /rgba?\(([^)]+)\)/.exec(c || ""); if (!m) return true; const v = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number); return Math.max(v[0], v[1], v[2]) - Math.min(v[0], v[1], v[2]) <= 1; };
                        const shadowCols = (s: string) => (s || "").match(/rgba?\([^)]+\)/g) ?? [];
                        if (r.sub && !gray(r.sub.color)) L(`副标题颜色带色相 ${r.sub.color}`);
                        if (r.kbd) { for (const [k, v] of [["颜色", r.kbd.color], ["底色", r.kbd.bg], ["边框", r.kbd.border]] as const) if (!gray(v)) L(`键帽${k}带色相 ${v}`); for (const v of shadowCols(r.kbd.shadow)) if (!gray(v)) L(`键帽描边（box-shadow）带色相 ${v}`); }
                        seen.push(`${tn}·${mode}:${r.text}${r.kbd ? "[kbd]" : ""}${r.sub ? "[sub]" : ""}`);
                        if (got >= 3 && (r.kbd || got >= 6)) break;
                    }
                    if (!got) bad.push(`[${tn}·${mode}] 悬停 ${hosts.length} 个宿主都没出现 ArcTooltip`);
                    await h.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 2, y: 2 }, S());
                }
            }
            await rpc("spaces:update", sp.id, { color: sp.color, theme: sp.theme ?? undefined });
            await h.send("Emulation.setEmulatedMedia", { features: [] }, S()); await ev(`(__hxTheme(null), __hxRestoreAd())`).catch(() => { });
            console.log(`   看到：${[...new Set(seen)].slice(0, 12).join(" | ")}`);
            const u = [...new Set(bad)]; if (u.length) throw new Error(`${u.slice(0, 20).join(" ‖ ")} 截图 ${await shot("tooltip-neutral")}`);
        });
    }
    }
    if (PH.has("theme") || PH.has("tooltip")) {
    // ===== 键帽规格（/workspace/arc-analysis/tooltip-unification-audit.md 末尾「自测框架检查项规格」）=====
    {
        const KC = { gap: "3px", min: 19, baseR: "4px", faceR: "3px", pad: "1px 1px 2.5px 1px", fontPx: "10px", weight: "700",
            light: { base: "rgb(168, 168, 168)", face: "rgb(230, 230, 230)", glyph: "rgb(0, 0, 0)", bubble: "rgb(255, 255, 255)" },
            dark: { base: "rgb(115, 115, 115)", face: "rgb(71, 71, 71)", glyph: "rgb(255, 255, 255)", bubble: "rgb(43, 43, 43)" } };
        /* 蓝色空间主题变量（按模式给前景：ToneProbe 按 --arc-fg 判深浅，浅色模式给浅前景会被正确地判成深色——那不是本项要测的） */
        const BLUE = (mode: string) => mode === "dark" ? { "--arc-pop-solid": "#1b2a4a", "--arc-bg": "#1b2a4a", "--arc-fg": "#dbe6ff", "--arc-accent": "#4c8bf5", "--arc-pop": "rgb(27 42 74 / .9)" } : { "--arc-pop-solid": "#cfe0ff", "--arc-bg": "#dbe8ff", "--arc-fg": "#13213f", "--arc-accent": "#2f6fe0", "--arc-pop": "rgb(207 224 255 / .9)" };
        /* K-02（Cat 定）：space.go1–9 默认不再绑 Alt+1–9，圆点提示默认没有键帽。源码里带键帽的提示只有 Space 圆点（spaceManager/index.ts:411 data-tip-shortcut = keyFor("space.goN")，含用户改键）；
         * 侧边栏开关 / ＋ / 前进后退 / 刷新的提示都不带快捷键。→ 本步像用户在「快捷键」里改键一样临时给 space.go1 绑 Alt+1（data:keymap；已有绑定就沿用），
         * 用 pin.collapse 两次触发一次重绘后悬停圆点；结束时还原 data:keymap。所有键帽规格断言不变。 */
        await step("【键帽规格】悬停底栏第 1 个 Space 圆点（K-02 后临时给 space.go1 绑 Alt+1）：每键一帽 / ≥19×19 / 间距 3 / 圆角 4·3 / inset 1·1·2.5·1 / 颜色（浅 · 深 × 普通 · 蓝色变量）", 60_000, async () => {
            const bad: string[] = []; const log: string[] = [];
            const kmRedraw = `await new Promise(x => setTimeout(x, 300)); await ArcSidebar.runCommand("pin.collapse"); await new Promise(x => setTimeout(x, 150)); await ArcSidebar.runCommand("pin.collapse"); await new Promise(x => setTimeout(x, 400));`;
            const km = await ev(`(async () => { const K = "data:keymap"; const r = (await chrome.storage.local.get(K))[K]; const bound = !!r?.map?.["space.go1"];
                if (!bound) { await chrome.storage.local.set({ [K]: { ...(r ?? {}), map: { ...(r?.map ?? {}), "space.go1": "Alt+1" } } }); ${kmRedraw} } return { had: r ?? null, bound }; })()`);
            log.push(`space.go1：${km?.bound ? "沿用已有绑定" : "临时绑 Alt+1"}`);
            try {
            for (const mode of ["light", "dark"] as const) for (const blue of [false, true]) {
                const tag = `[${mode}${blue ? "·蓝色 --arc-*" : ""}]`;
                await h.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 2, y: 2 }, S()); await closeAll();
                await h.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: mode }] }, S());
                for (let i = 0; i < 3; i++) { /* 主题插件 / Adaptive 可能晚一拍改回：最多重设 3 次 */
                    await ev(`(() => { const R = document.documentElement; for (const [k, v] of Object.entries(${JSON.stringify(BLUE(mode))})) ${blue ? "R.style.setProperty(k, v)" : "R.style.removeProperty(k)"}; const ok = __hxTheme(${JSON.stringify(mode)}); R.dataset.bbDark = ${JSON.stringify(mode === "dark" ? "1" : "0")}; return ok; })()`);
                    await sleep(300); if ((await ev(`document.documentElement.dataset.theme`)) === mode) break;
                }
                const p = await ev(`(() => { const d = [...document.querySelectorAll(".arc-space-dot")].find(e => e.checkVisibility()); if (!d) return null; const r = d.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, theme: document.documentElement.dataset.theme }; })()`);
                if (!p) { bad.push(`${tag} 没有可见的 Space 圆点`); continue; }
                if (p.theme !== mode) { log.push(`${tag} Adaptive 覆盖，跳过（data-theme=${p.theme} data-adaptive=${await ev("document.documentElement.dataset.adaptive ?? null")}）`); continue; }
                await h.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y }, S()); await sleep(700);
                const m = await ev(`(() => { const t = document.querySelector(".arc-tooltip:not(.out)"); if (!t) return null; const keys = t.querySelector(".arc-tt-keys");
                    const px = (s) => s; return { bubble: getComputedStyle(t).backgroundColor, text: t.textContent, gap: keys ? getComputedStyle(keys).gap : null,
                    kbd: [...t.querySelectorAll("kbd")].map(k => { const c = getComputedStyle(k), r = k.getBoundingClientRect(), f = k.querySelector("span"), fc = f ? getComputedStyle(f) : null;
                        return { txt: k.textContent, w: +r.width.toFixed(2), h: +r.height.toFixed(2), r: c.borderRadius, pad: [c.paddingTop, c.paddingRight, c.paddingBottom, c.paddingLeft].join(" "), grad: /linear-gradient/.test(c.backgroundImage), base: c.backgroundColor,
                            face: fc && { r: fc.borderRadius, bg: fc.backgroundColor, fs: fc.fontSize, fw: fc.fontWeight, color: fc.color } }; }) }; })()`);
                if (!m) { bad.push(`${tag} 悬停圆点 700ms 后没有 ArcTooltip`); continue; }
                const W = mode === "dark" ? KC.dark : KC.light; const L = (x: string) => bad.push(`${tag} ${x}`);
                log.push(`${tag} “${m.text}” gap=${m.gap} 气泡=${m.bubble} kbd=${JSON.stringify(m.kbd)}`);
                if (!m.kbd.length) { L("提示里没有键帽（kbd）"); continue; }
                if (m.bubble !== W.bubble) L(`气泡底色 ${m.bubble} ≠ ${W.bubble}`);
                if (m.gap !== KC.gap) L(`.arc-tt-keys gap ${m.gap} ≠ ${KC.gap}`);
                const MODS = "⌃⌥⇧⌘"; const txts = m.kbd.map((k: any) => k.txt);
                const mods = txts.slice(0, -1), main = txts.at(-1);
                if (txts.some((t: string) => /[+\s]/.test(t) || [...t].length !== 1 && !/^(tab|⎵|[A-Z0-9]+|F\d+)$/i.test(t))) L(`键帽不是一键一帽：${JSON.stringify(txts)}`);
                if (mods.some((x: string) => !MODS.includes(x)) || mods.map((x: string) => MODS.indexOf(x)).some((v: number, i: number, a: number[]) => i && v <= a[i - 1])) L(`修饰键不是 ⌃⌥⇧⌘ 子序列：${JSON.stringify(mods)}`);
                if (main && main !== main.toUpperCase()) L(`主键不是大写：${main}`);
                for (const k of m.kbd) {
                    const K = (x: string) => L(`kbd “${k.txt}” ${x}`);
                    if (k.w < KC.min - 0.01 || k.h < KC.min - 0.01) K(`尺寸 ${k.w}×${k.h} < 19×19`);
                    if (k.r !== KC.baseR) K(`底座圆角 ${k.r} ≠ 4px`);
                    if (k.pad !== KC.pad) K(`inset(padding) ${k.pad} ≠ ${KC.pad}`);
                    if (!k.grad) K(`底座没有 linear-gradient`);
                    if (k.base !== W.base) K(`底座色 ${k.base} ≠ ${W.base}`);
                    if (!k.face) { K("没有键面 span"); continue; }
                    if (k.face.r !== KC.faceR) K(`键面圆角 ${k.face.r} ≠ 3px`);
                    if (k.face.bg !== W.face) K(`键面色 ${k.face.bg} ≠ ${W.face}`);
                    if (k.face.fs !== KC.fontPx) K(`字号 ${k.face.fs} ≠ ${KC.fontPx}`);
                    if (k.face.fw !== KC.weight) K(`字重 ${k.face.fw} ≠ 700`);
                    if (k.face.color !== W.glyph) K(`字色 ${k.face.color} ≠ ${W.glyph}`);
                }
            }
            } finally {
                if (!km?.bound) await ev(`(async () => { const K = "data:keymap"; const had = ${JSON.stringify(km?.had ?? null)}; if (had == null) await chrome.storage.local.remove(K); else await chrome.storage.local.set({ [K]: had }); ${kmRedraw} return 1; })()`).catch(e => log.push(`还原 data:keymap 失败：${e}`));
            }
            await h.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 2, y: 2 }, S());
            await ev(`(() => { const R = document.documentElement; for (const k of Object.keys(${JSON.stringify(BLUE("dark"))})) R.style.removeProperty(k); delete R.dataset.bbDark; __hxTheme(null); return __hxRestoreAd(); })()`).catch(() => { });
            await h.send("Emulation.setEmulatedMedia", { features: [] }, S());
            for (const l of log) console.log("   " + l.slice(0, 900));
            if (bad.length) throw new Error(`${[...new Set(bad)].slice(0, 25).join(" ‖ ")} 截图 ${await shot("keycap")}`);
        });
    }
    }
    if (PH.has("hover")) {
    // ===== 悬停保持（52015 实机：鼠标不动，标签行悬停态自己消失）：每类行 real-hover 后不再输入，5s / 15s 检查同一节点 + :hover =====
    {
        const O = opener!.sessionId;
        const HOLD = Number(process.env.HOVER_HOLD ?? 15000), MID = Math.min(5000, HOLD);
        /* 准备数据：收藏 1 个、固定 1 个链接、固定 1 个文件夹（含一个子项），结束后恢复 */
        const saved = await h.evalIn(O, `chrome.storage.local.get(["data:favorites", "data:pinned"])`).catch(() => ({}));
        await step("【悬停保持】准备收藏 / 固定 / 文件夹行", 15_000, async () => {
            await h.evalIn(O, `(async () => {
                const r = await chrome.storage.local.get(["data:favorites", "data:pinned"]);
                const fav = r["data:favorites"] ?? { items: [] }; if (!fav.items.length) fav.items = [{ id: "hxfav", url: "https://example.com/?arc-hover-fav", title: "hover fav" }];
                const pin = r["data:pinned"] ?? { bySpace: {} }; pin.bySpace ??= {};
                const ids = Object.keys(pin.bySpace); if (!ids.length) { const s = (await chrome.storage.local.get("data:spaces"))["data:spaces"]; const id = s?.activeId ?? s?.items?.[0]?.id ?? s?.list?.[0]?.id ?? "default"; pin.bySpace[id] = []; ids.push(id); }
                for (const id of ids) { const l = pin.bySpace[id];
                    if (!l.some(n => n.id === "hxpin")) l.push({ id: "hxpin", kind: "tab", url: "https://example.com/?arc-hover-pin", title: "hover pinned" });
                    if (!l.some(n => n.id === "hxfold")) l.push({ id: "hxfold", kind: "folder", title: "HoverFolder", collapsed: false, children: [{ id: "hxfold-c", kind: "tab", url: "https://example.com/?arc-hover-child", title: "hover child" }] }); }
                await chrome.storage.local.set({ "data:favorites": fav, "data:pinned": pin }); return 1; })()`);
            await sleep(1200); await closeAll();
        });
        /* 每类：页面内找元素的 JS 表达式（检查时重新执行 → 判断“还是不是同一个节点”） */
        const vis = `(e => e && e.checkVisibility())`;
        const KINDS: [string, string, (() => Promise<unknown>)?][] = [
            ["普通标签行", `[...document.querySelectorAll(".arc-today .arc-tab, .arc-slot-today .arc-tab")].find(e => ${vis}(e) && !e.closest(".arc-pinned, .arc-fav-grid, .arc-folder"))`],
            ["Today 标题行", `document.querySelector('[data-test="today-head"]')`],
            ["固定标签行", `[...document.querySelectorAll(".arc-pinned .arc-tab")].find(e => ${vis}(e) && !e.closest(".arc-folder-body"))`],
            ["收藏格", `[...document.querySelectorAll(".arc-fav-grid > *")].find(${vis})`],
            ["文件夹行", `[...document.querySelectorAll(".arc-folder-head")].find(${vis})`],
            ["底栏按钮", `[...document.querySelectorAll(".arc-slot-bottom button, .arc-slot-bottom [role=button]")].find(${vis})`],
            ["菜单项（＋ 菜单）", `[...document.querySelectorAll('[data-test="plus-menu"] [data-test]:not(.disabled)')].find(${vis})`, async () => { await realClick('[data-test="plus-btn"]'); await sleep(500); }],
        ];
        const shortPath = `(e => { const p = []; for (let x = e; x && x.nodeType === 1 && x.id !== "app" && p.length < 4; x = x.parentElement) p.unshift(x.tagName.toLowerCase() + (x.classList[0] ? "." + x.classList[0] : "")); return p.join(">"); })`;
        const evidence: any[] = [];
        for (const [kind, find, prep] of KINDS) await step(`【悬停保持】${kind}：鼠标不动 ${MID / 1000}s / ${HOLD / 1000}s 仍是同一节点且 :hover`, HOLD + 15_000, async () => {
            await closeAll(); await h.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 1, y: 1 }, S()); await sleep(300);
            if (prep) await prep();
            const p = await ev(`(() => {
                const e = ${find}; if (!e) return null; e.scrollIntoView({ block: "nearest" });
                window.__hoverRef = e; window.__hoverFind = () => ${find};
                const log = window.__hoverLog = []; const t0 = window.__hoverT0 = performance.now(); const T = () => Math.round(performance.now() - t0);
                const desc = n => n.nodeType === 1 ? ${shortPath}(n) + (n.dataset?.sel ? "[data-sel=" + n.dataset.sel + "]" : "") : "#" + n.nodeName;
                window.__hoverMO?.disconnect();
                const mo = window.__hoverMO = new MutationObserver(ms => { for (const m of ms) {
                    const hit = m.type === "childList" && [...m.removedNodes].some(n => n === e || n.contains?.(e));
                    if (hit || (m.type === "attributes" && m.target === e)) log.push({ t: T(), type: m.type, attr: m.attributeName, old: m.oldValue, target: desc(m.target), removedRef: hit, removed: [...m.removedNodes].slice(0, 3).map(desc), added: [...m.addedNodes].slice(0, 3).map(desc), stack: hit ? new Error().stack?.split("\\n").slice(1, 4).join(" | ") : undefined });
                } });
                mo.observe(document.getElementById("app") ?? document.body, { subtree: true, childList: true, attributes: true, attributeOldValue: true, attributeFilter: ["class", "style", "data-hover", "hidden"] });
                /* 关联可能的重渲染诱因 */
                window.__hoverCause = [];
                const c = (k, x) => window.__hoverCause.push({ t: Math.round(performance.now() - window.__hoverT0), k, x: String(x).slice(0, 160) });
                if (!window.__hoverHooked) { window.__hoverHooked = 1;
                    chrome.storage.onChanged.addListener((ch, area) => c("storage." + area, Object.keys(ch).join(",")));
                    for (const ev of ["onUpdated", "onActivated", "onCreated", "onRemoved", "onMoved"]) chrome.tabs[ev]?.addListener((...a) => c("tabs." + ev, JSON.stringify(a[1] ?? a[0])));
                    document.addEventListener("visibilitychange", () => c("visibility", document.visibilityState));
                    for (const t of ["mouseleave", "mouseout", "pointerleave", "blur"]) window.addEventListener(t, ev => c("win." + t, ev.target?.className ?? ""), true);
                }
                const r = e.getBoundingClientRect();
                return { x: r.x + Math.min(24, r.width / 2), y: r.y + r.height / 2, sel: e.dataset.sel || e.dataset.test || __hx.tipOf(e) || e.textContent.trim().slice(0, 30) || ${shortPath}(e), path: ${shortPath}(e) };
            })()`);
            if (!p) return "skip";
            await h.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y }, S()); // 之后不再有任何输入
            const check = () => ev(`(() => { const r = window.__hoverRef, cur = window.__hoverFind(); const at = document.elementFromPoint(${p.x}, ${p.y});
                return { t: Math.round(performance.now() - window.__hoverT0), connected: r.isConnected, same: cur === r, hover: r.matches(":hover"), curHover: !!cur?.matches(":hover"), atPoint: at ? (at === r || r.contains(at)) : false, atDesc: at ? at.className?.toString().slice(0, 60) : null }; })()`);
            const res: any[] = [];
            /* 默认在悬停期间制造一次“后台动静”（不碰鼠标）：后台新开一个非活动标签再刷新它，触发 tabs.onCreated/onUpdated + storage 写入，模拟实机里标题 / favicon / 计时更新引起的重渲染。HOVER_STIR=0 关闭 */
            if (process.env.HOVER_STIR !== "0") { await sleep(1500); await h.evalIn(O, `chrome.tabs.create({ url: "https://example.com/?arc-hover-stir-" + Date.now(), active: false }).then(t => new Promise(r => setTimeout(() => chrome.tabs.reload(t.id).then(() => setTimeout(() => chrome.tabs.remove(t.id).then(() => r(1)), 1200)), 1200)))`, { ms: 8000 }).catch(() => { }); }
            await sleep(Math.max(0, MID - (process.env.HOVER_STIR !== "0" ? 4000 : 0))); res.push(await check());
            if (HOLD > MID) { await sleep(HOLD - MID); res.push(await check()); }
            const bad = res.filter(r => !r.connected || !r.same || !r.hover);
            console.log(`   ${kind} ${p.sel}: ` + res.map(r => `${r.t}ms same=${r.same} connected=${r.connected} :hover=${r.hover}`).join(" ; "));
            if (bad.length) {
                const log = await ev(`({ mut: window.__hoverLog.slice(0, 12), cause: window.__hoverCause.slice(0, 20) })`);
                const f = await shot(`hover-${kind.replace(/\W+/g, "") || "row"}`);
                const ev1 = { kind, sel: p.sel, path: p.path, failed: bad.map(r => ({ at: r.t + "ms", why: [!r.connected && "节点已脱离 DOM（被替换）", r.connected && !r.same && "当前元素已不是同一节点", !r.hover && "ref 失去 :hover", r.curHover && "（新节点有 :hover）"].filter(Boolean).join("，"), atPoint: r.atDesc })), mutations: log?.mut, causes: log?.cause, shot: f };
                evidence.push(ev1);
                throw new Error(JSON.stringify(ev1).slice(0, 2400));
            }
        });
        await ev(`window.__hoverMO?.disconnect(); 1`).catch(() => { });
        await closeAll();
        if (evidence.length) (await import("fs")).writeFileSync(`${SHOTS}/hover-evidence-${Date.now()}.json`, JSON.stringify(evidence, null, 2));
        await h.evalIn(O, `chrome.storage.local.set(${JSON.stringify({ "data:favorites": { items: [] }, "data:pinned": { bySpace: {} } })}).then(() => ${JSON.stringify(saved)}).then(s => Object.keys(s).length ? chrome.storage.local.set(s) : 1)`).catch(() => { });
    }
    } // hover
    if (PH.has("wheelx")) {
    // ===== 触控板双指横向拖动（真实 Input.dispatchMouseEvent type=mouseWheel，只有 deltaX + 很小的 deltaY 噪声）：侧栏内容不许抖 =====
    // 回归：用户（13:09）反馈“触控板双指横向拖动时侧栏内容抖动”。逐区域发一串细碎的横向滚轮（两个方向、20 个事件 / ~300ms），断言：
    //  A. 除收藏条外，侧栏文档里没有任何元素的 scrollLeft ≠ 0（含 documentElement / body）；
    //  B. 手势结束（静止 700ms）后所有内容容器的 rect.x 与手势前一致（±0.5px），transform 回到手势前；
    //  C. 手势过程中每个 rAF 帧采样 rect.x / transform：不在 .arc-scroll 里的容器（底栏、地址栏、Space 栏…）全程不动（±0.5px）；
    //     .arc-scroll 及其内部：产品故意“跟手滑动”（spaceManager 的 follow：.arc-scroll 在横滑时 translateX(−0.6·Δ)，松手 / 160ms 无输入回弹），所以只允许
    //     “位移完全由 .arc-scroll 自身的 transform 解释”（内部元素 x 变化 = scroll 的 tx，±0.5）；设 WHEELX_STRICT=1 则任何位移都算失败。
    // 失败信息含：区域、违规元素、数值（scrollLeft / dx / 帧号 / 时间）。
    {
        const O = opener!.sessionId;
        const STRICT = process.env.WHEELX_STRICT === "1";
        const TOL = 0.5;
        const savedWx = await h.evalIn(O, `chrome.storage.local.get(["data:favorites", "data:pinned", "data:spaces"])`).catch(() => ({}));
        await step("【横向滚轮】准备收藏 / 固定链接 / 固定文件夹 / Today 标签（结束后恢复）", 20_000, async () => {
            await h.evalIn(O, `(async () => {
                const r = await chrome.storage.local.get(["data:favorites", "data:pinned"]);
                const fav = r["data:favorites"] ?? { items: [] }; if (!fav.items.length) fav.items = [{ id: "wxfav", url: "https://example.com/?arc-wx-fav", title: "wx fav" }];
                const pin = r["data:pinned"] ?? { bySpace: {} }; pin.bySpace ??= {};
                const ids = Object.keys(pin.bySpace); if (!ids.length) { const s = (await chrome.storage.local.get("data:spaces"))["data:spaces"]; const id = s?.activeId ?? s?.items?.[0]?.id ?? s?.list?.[0]?.id ?? "default"; pin.bySpace[id] = []; ids.push(id); }
                for (const id of ids) { const l = pin.bySpace[id];
                    if (!l.some(n => n.id === "wxpin")) l.push({ id: "wxpin", kind: "tab", url: "https://example.com/?arc-wx-pin", title: "wx pinned" });
                    if (!l.some(n => n.id === "wxfold")) l.push({ id: "wxfold", kind: "folder", title: "WxFolder", collapsed: false, children: [{ id: "wxfold-c", kind: "tab", url: "https://example.com/?arc-wx-child", title: "wx child" }] }); }
                for (const id of ids) { const l = pin.bySpace[id]; for (let i = 1; i <= 30; i++) if (!l.some(n => n.id === "wxfill" + i)) l.push({ id: "wxfill" + i, kind: "tab", url: "https://example.com/?arc-wx-fill" + i, title: "wx fill " + i }); } /* 填充 30 个固定行：保证列表可纵向滚动（验证 scrollTop 不被 dy 噪声带动） */
                const sp = (await chrome.storage.local.get("data:spaces"))["data:spaces"]; if (sp?.spaces?.length === 1) { sp.spaces.push({ ...sp.spaces[0], id: "wxs2", name: "WxSpace2" }); await chrome.storage.local.set({ "data:spaces": sp }); } /* 只有 1 个 Space 时临时加第 2 个（真切换） */
                await chrome.storage.local.set({ "data:favorites": fav, "data:pinned": pin }); return 1; })()`);
            await sleep(2000); await closeAll();
        });
        /* [名称, 选择器]：既是“鼠标放哪个区域”，也是“每帧采样 rect.x 的容器”。undefined 的区域（页面里没有）→ 跳过并说明 */
        const WX: [string, string][] = [
            ["应用根 #app", "#app"], ["主滚动区 .arc-scroll", "#app .arc-scroll"],
            ["Space 标题行", ".arc-space-title"], ["收藏条", ".arc-fav-grid"], ["固定网格", ".arc-pinned"], ["固定标签行", ".arc-pinned .arc-tab"],
            ["文件夹行", ".arc-folder-head"], ["Today 区", ".arc-today"], ["Today 标签行", ".arc-today .arc-tab"],
            ["地址栏", ".arc-urlbar"], ["底栏", ".arc-slot-bottom"], ["Space 圆点栏", ".arc-space-bar"],
        ];
        const REGIONS = WX.slice(2); // 前两个只做采样容器
        await ev(`globalThis.__wxStart = (tg) => { const st = { on: true, t0: performance.now(), frames: [] }; globalThis.__wx = st;
            const num = (m) => { if (!m || m === "none") return 0; const a = m.match(/matrix\\(([^)]+)\\)/); return a ? Number(a[1].split(",")[4]) : NaN; };
            const snap = () => ({ t: Math.round(performance.now() - st.t0), sl: [document.documentElement.scrollLeft, document.body.scrollLeft],
                tg: tg.map(([n, s]) => { const e = document.querySelector(s); if (!e || !e.isConnected) return null; const r = e.getBoundingClientRect(); const tr = getComputedStyle(e).transform; return [r.x, tr, num(tr), !!e.parentElement?.closest("#app .arc-scroll") || (e !== document.querySelector("#app .arc-scroll") && !!e.closest("#app .arc-scroll"))]; }) });
            globalThis.__wxSnap = snap; st.frames.push(snap());
            const loop = () => { if (!st.on) return; st.frames.push(snap()); requestAnimationFrame(loop); }; requestAnimationFrame(loop); return 1; };
            globalThis.__wxStop = () => { globalThis.__wx.on = false; return globalThis.__wx.frames; };
            globalThis.__wxScan = () => [...document.querySelectorAll("*")].filter(e => e.scrollLeft !== 0 && !e.closest(".arc-fav-grid")).map(e => (e.tagName.toLowerCase() + (e.classList[0] ? "." + e.classList[0] : "") + (e.id ? "#" + e.id : "")) + "=" + e.scrollLeft)
                .concat([document.documentElement.scrollLeft && "html=" + document.documentElement.scrollLeft, document.body.scrollLeft && "body=" + document.body.scrollLeft, document.scrollingElement?.scrollLeft && "scrollingElement=" + document.scrollingElement.scrollLeft].filter(Boolean));
            globalThis.__wxFavSl = () => [...document.querySelectorAll(".arc-fav-grid")].map(e => e.scrollLeft);
            1`);
        /* ====== 回归场景（13:25 细化版）：真实 CDP mouseWheel ≈60Hz，断言对象 #app .arc-scroll 的 translateX / scrollTop ====== */
        await ev(`globalThis.__w2Start = () => { const st = { on: true, t0: performance.now(), frames: [], wheels: [] }; globalThis.__w2 = st;
            const num = (m) => { if (!m || m === "none") return 0; const a = m.match(/matrix\\(([^)]+)\\)/); return a ? Number(a[1].split(",")[4]) : NaN; };
            const snap = () => { const s = document.querySelector("#app .arc-scroll"); const cs = s && getComputedStyle(s);
                return { t: performance.now() - st.t0, tx: s ? num(cs.transform) : NaN, op: s ? Number(cs.opacity) : NaN, st: s ? s.scrollTop : NaN, inl: s ? (parseFloat((s.style.transform.match(/translateX\\((-?[\\d.]+)px\\)/) ?? [])[1]) || 0) : NaN, anim: s ? s.getAnimations().some(a => !!a.animationName) : false, sp: document.querySelector(".arc-space-dot.active")?.dataset.space ?? "" }; };
            st.snap = snap; st.h = (e) => st.wheels.push({ t: performance.now() - st.t0, dx: e.deltaX, dy: e.deltaY });
            document.addEventListener("wheel", st.h, { capture: true, passive: true });
            st.frames.push(snap()); const loop = () => { if (!st.on) return; st.frames.push(snap()); requestAnimationFrame(loop); }; requestAnimationFrame(loop); return st.frames[0]; };
            globalThis.__w2Stop = () => { const st = globalThis.__w2; st.on = false; document.removeEventListener("wheel", st.h, { capture: true }); const s = document.querySelector("#app .arc-scroll");
                return { frames: st.frames, wheels: st.wheels, end: { ...st.snap(), style: s ? { transform: s.style.transform, overflowY: s.style.overflowY, opacity: s.style.opacity } : null } }; };
            globalThis.__w2Prep = (top) => { const s = document.querySelector("#app .arc-scroll"); if (!s) return null; s.scrollTop = top; const r = s.getBoundingClientRect();
                return { x: Math.min(innerWidth - 2, r.x + r.width / 2), y: Math.min(innerHeight - 2, r.y + Math.min(r.height, innerHeight - r.y) / 2), sh: s.scrollHeight, ch: s.clientHeight, st: s.scrollTop, sp: document.querySelector(".arc-space-dot.active")?.dataset.space ?? "", dots: document.querySelectorAll(".arc-space-bar .arc-space-dot").length }; };
            1`);
        type Ev = { at: number; dx: number; dy: number };
        const F = 1000 / 60;
        const sgn = (i: number) => (i % 2 ? -1 : 1);
        const SCEN: { name: string; ev: Ev[]; settle: number; sw?: boolean; check?: (R: any, issues: string[]) => void }[] = [];
        /* ① 手势中间停 200ms（旧：160ms 空闲计时到点 → 单帧弹回 0 且累计清零） */
        { const e: Ev[] = []; for (let i = 0; i < 6; i++) e.push({ at: i * F, dx: 6, dy: sgn(i) }); for (let i = 0; i < 6; i++) e.push({ at: 5 * F + 200 + (i + 1) * F, dx: 6, dy: sgn(i) });
          SCEN.push({ name: "① 手势中间停 200ms（6 + 停 200ms + 6 个事件，Σdx=72）", ev: e, settle: 900, check: (R, iss) => {
              const cut = R.wheels[5].t + 100; const p1 = Math.max(...R.frames.filter((f: any) => f.t <= cut).map((f: any) => Math.abs(f.tx))), p2 = Math.max(...R.frames.filter((f: any) => f.t > cut).map((f: any) => Math.abs(f.tx)));
              if (!(p2 >= p1 * 1.5)) iss.push(`停顿后累计丢失：第一段峰值 |tx|=${p1.toFixed(1)}px，第二段峰值 ${p2.toFixed(1)}px（应 ≥ ${(p1 * 1.5).toFixed(1)}，理论 ${(0.6 * 72).toFixed(1)}）`); } }); }
        /* ② 手势中段连续 12 个 |dx|<1.5|dy| 的事件（旧：被忽略的事件不刷新空闲计时 → 事件还在来却弹回 0） */
        { const e: Ev[] = []; let k = 0; for (let i = 0; i < 6; i++) e.push({ at: (k++) * F, dx: 6, dy: sgn(i) * 2 }); for (let i = 0; i < 12; i++) e.push({ at: (k++) * F, dx: sgn(i) * 2, dy: sgn(i) * 8 }); for (let i = 0; i < 6; i++) e.push({ at: (k++) * F, dx: 6, dy: sgn(i) * 2 });
          SCEN.push({ name: "② 中段连续 12 个 |dx|<1.5|dy| 事件（6 + 12 被忽略 + 6，Σ有效dx=72）", ev: e, settle: 900, check: (R, iss) => {
              const t6 = R.wheels[5].t, t18 = R.wheels[17].t; const mid = R.frames.filter((f: any) => f.t > t6 + 40 && f.t < t18 + 30);
              const z = mid.filter((f: any) => Math.abs(f.tx) < 0.5); if (z.length) iss.push(`被忽略事件仍在到达期间（t=${Math.round(t6)}~${Math.round(t18)}ms）tx 被清成 0：${z.length}/${mid.length} 帧，首帧 t=${Math.round(z[0].t)}ms`); } }); }
        /* ③ 切换后惯性尾巴：10×dx16（第 8 个事件越过 120 → 切 Space）+ 衰减尾巴 60 个事件（~1s）。切换后 450ms+150ms 内不许把新 Space 内容又拖出去 */
        { const e: Ev[] = []; for (let i = 0; i < 10; i++) e.push({ at: i * F, dx: 16, dy: sgn(i) }); for (let i = 0; i < 60; i++) e.push({ at: (10 + i) * F, dx: Math.round(14 * Math.pow(0.92, i) * 10) / 10, dy: 0 });
          SCEN.push({ name: "③ 切换后惯性尾巴（10×16 越过阈值切 Space + 60 个衰减事件 ≈1s）", ev: e, settle: 1500, sw: true, check: (R, iss) => {
              let acc = 0, tsw = -1; for (const w of R.wheels) { acc += w.dx; if (acc >= 120) { tsw = w.t; break; } } if (tsw < 0) { iss.push(`没越过阈值（Σdx 不到 120），场景无效`); return; }
              const win = R.frames.filter((f: any) => f.t > tsw + 20 && f.t <= tsw + 600), bad = win.filter((f: any) => Math.abs(f.inl) > 0.5); /* 用 inline transform（follow() 写的）：切换后 .arc-swipe-next 的 CSS 滑入动画也会改 computed transform，不算拖动 */
              if (bad.length) { const m = bad.reduce((a: any, b: any) => Math.abs(b.inl) > Math.abs(a.inl) ? b : a); iss.push(`切换（t=${Math.round(tsw)}ms）后 600ms 内内容又被惯性尾巴拖出去：${bad.length}/${win.length} 帧 inline translateX≠0，首帧 t=${Math.round(bad[0].t)}ms tx=${bad[0].inl.toFixed(2)}px，峰值 t=${Math.round(m.t)}ms tx=${m.inl.toFixed(2)}px`); }
              const late = R.frames.filter((f: any) => f.t > tsw + 600 && Math.abs(f.inl) > 0.5); if (late.length) console.log(`   （信息）切换 600ms 后仍有 ${late.length} 帧被拖出，峰值 ${Math.max(...late.map((f: any) => Math.abs(f.inl))).toFixed(1)}px`); } }); }
        /* ④ 正弦横向拖动 + dy ±3 噪声：scrollTop 不许被 dy 带着抖 */
        { const e: Ev[] = []; for (let i = 1; i <= 40; i++) e.push({ at: (i - 1) * F, dx: Math.round(10 * Math.sin(i * 0.45) * 10) / 10 || 1, dy: sgn(i) * 3 });
          SCEN.push({ name: "④ 正弦横向拖动 40 事件 + dy ±3 噪声（scrollTop 起点 100）", ev: e, settle: 900 }); }
        const rotated: string[] = [];
        for (const sc of [SCEN[3], SCEN[0], SCEN[1], SCEN[2]]) await step(`【横向滚轮·跟手】${sc.name}`, 45_000, async () => {
            await closeAll(); await sleep(1300);
            const p = await ev(`__w2Prep(100)`); if (!p) throw new Error("没有 #app .arc-scroll");
            await sleep(200); const p2 = await ev(`__w2Prep(100)`);
            const issues: string[] = [];
            if (p2.sh - p2.ch < 150) issues.push(`列表不可纵向滚动（scrollHeight ${p2.sh} / clientHeight ${p2.ch}），无法验证 scrollTop`);
            await h.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: p2.x, y: p2.y }, S()); await sleep(250);
            await ev(`__w2Start()`); const top0 = p2.st;
            const t0 = Date.now(); for (const e of sc.ev) { const w = t0 + e.at - Date.now(); if (w > 0) await sleep(w); await h.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: p2.x, y: p2.y, deltaX: e.dx, deltaY: e.dy }, S()); }
            const sendMs = Date.now() - t0; await sleep(sc.settle);
            const R = await ev(`__w2Stop()`); const fr: any[] = R.frames;
            // 通用 1：tx 不许“非零 → 一帧回到 ≈0”（松手回弹必须带 .18s 过渡，不能单帧跳）
            let tswAt = -1; { let acc = 0; for (const w of R.wheels) { acc += w.dx; if (acc >= 120) { tswAt = w.t; break; } } } /* 切换那一刻 follow(0) 无过渡是故意的（接着 .arc-swipe-* 滑入动画） */
            let jump: any = null, maxStep = 0; for (let i = 1; i < fr.length; i++) { const a = Math.abs(fr[i - 1].tx), b = Math.abs(fr[i].tx); maxStep = Math.max(maxStep, Math.abs(fr[i].tx - fr[i - 1].tx));
                if (!jump && a >= 10 && b <= Math.max(0.5, a * 0.2) && !fr[i].anim && !fr[i - 1].anim && !(sc.sw && tswAt >= 0 && fr[i].t >= tswAt - 20 && fr[i].t <= tswAt + 60)) jump = { i, t: fr[i].t, from: fr[i - 1].tx, to: fr[i].tx }; }
            if (jump) issues.push(`translateX 单帧跳变：第 ${jump.i} 帧（t=${Math.round(jump.t)}ms）${jump.from.toFixed(2)}px → ${jump.to.toFixed(2)}px（回弹没有过渡 / 手势中弹回 0）`);
            // 通用 2：scrollTop 不抖（起点 top0）
            const sts: number[] = fr.map(f => f.st).filter(Number.isFinite); const dev = Math.max(...sts.map(s => Math.abs(s - top0)));
            let rev = 0, lastD = 0; for (let i = 1; i < sts.length; i++) { const d = sts[i] - sts[i - 1]; if (Math.abs(d) >= 0.5) { if (lastD && Math.sign(d) !== Math.sign(lastD)) rev++; lastD = d; } }
            if (!sc.sw && (dev > 4 || (rev > 2 && dev >= 2))) issues.push(`scrollTop 被 dy 噪声带着抖：起点 ${top0}，范围 ${Math.min(...sts)}~${Math.max(...sts)}（最大偏离 ${dev.toFixed(1)}px，方向反转 ${rev} 次；允许 ≤4px / ≤2 次）`);
            // 通用 3：结束后复位（inline transform / overflow-y 清掉，opacity 1）
            const en = R.end; if (!(Math.abs(en.tx) < 0.5) || en.style?.transform || en.style?.overflowY || (en.style?.opacity ?? "") !== "") issues.push(`手势结束 ${sc.settle}ms 后没复位：tx=${en.tx} style=${JSON.stringify(en.style)}`);
            sc.check?.(R, issues);
            if (sc.sw) { if (en.sp !== p2.sp) rotated.push(`${p2.sp}→${en.sp}`); }
            const peak = Math.max(...fr.map(f => Math.abs(f.tx)));
            console.log(`   ${sc.name.slice(0, 2)}：${sc.ev.length} 事件/${sendMs}ms，${fr.length} 帧，峰值 |tx|=${peak.toFixed(1)}px，最大帧步 ${maxStep.toFixed(1)}px，scrollTop ${Math.min(...sts)}~${Math.max(...sts)}（反转 ${rev}），空间 ${p2.sp}→${en.sp}，${issues.length ? "FAIL" : "ok"}`);
            if (issues.length) throw new Error(`${issues.join(" ‖ ")} 截图 ${await shot("wheelx-scen")}`);
        });
        if (rotated.length) { // ③ 真切了 Space：横滑回去（先等锁释放），保证后面的区域用例在原 Space
            await sleep(1500); const orig = (await ev(`__w2Prep(0)`))?.sp; const back = rotated[0].split("→")[0];
            if (orig !== back) { const q = await ev(`__w2Prep(0)`); for (let i = 0; i < 10; i++) { await h.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: q.x, y: q.y, deltaX: 16, deltaY: 0 }, S()); await sleep(17); } await sleep(1800); }
            console.log(`   （③ 切 Space 后已横滑回原 Space：${rotated.join(",")}，现在 ${(await ev(`__w2Prep(0)`))?.sp}）`);
        }
        let seed = 12345; const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
        /* 两种手势：osc = 两个方向交替 20 个事件（每个 ±5..40，累计始终 < 阈值 120，不会真切空间）；drag = 单向 8 个事件（+10..14，合计 < 120）后停手 */
        const gesture = (kind: "osc" | "drag") => { const out: { dx: number; dy: number }[] = [];
            if (kind === "osc") { for (let i = 0; i < 10; i++) { const a = 5 + rnd(36); out.push({ dx: a, dy: rnd(7) - 3 }, { dx: -Math.max(1, a + rnd(7) - 3), dy: rnd(7) - 3 }); } }
            else for (let i = 0; i < 8; i++) out.push({ dx: 10 + rnd(5), dy: rnd(5) - 2 });
            return out; };
        const wxSummary: string[] = [];
        for (const [label, sel] of REGIONS) await step(`【横向滚轮】${label}（${sel}）：真实 mouseWheel deltaX 双向 + 单向，内容不抖`, 40_000, async () => {
            await closeAll(); await sleep(200);
            const p = await ev(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find(e => e.isConnected && e.checkVisibility() && e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().height > 0);
                if (!e) return null; e.scrollIntoView?.({ block: "nearest", inline: "nearest" }); const r = e.getBoundingClientRect(); const vw = innerWidth, vh = innerHeight;
                const x = Math.min(vw - 2, Math.max(2, r.x + r.width / 2)), y = Math.min(vh - 2, Math.max(2, r.y + Math.min(r.height, vh) / 2)); return { x, y }; })()`);
            if (!p) { console.log(`   ${label}：页面里没有可见的 ${sel} → 跳过`); wxSummary.push(`${label}: 无元素（跳过）`); return "skip" as any; }
            const issues: string[] = []; const info: string[] = [];
            for (const kind of ["osc", "drag"] as const) {
                await ev(`document.documentElement.scrollLeft = 0; document.body.scrollLeft = 0; 1`);
                await h.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y }, S()); await sleep(250);
                const before = await ev(`(() => { __wxStart(${JSON.stringify(WX)}); return { snap: __wxSnap(), scan: __wxScan(), fav: __wxFavSl() }; })()`);
                const g = gesture(kind); const t0 = Date.now();
                for (const e of g) { await h.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: p.x, y: p.y, deltaX: e.dx, deltaY: e.dy }, S()); await sleep(kind === "osc" ? 12 : 30); }
                const gestureMs = Date.now() - t0;
                const during = await ev(`({ scan: __wxScan(), fav: __wxFavSl() })`);
                await sleep(700); // 静止：product 的 idle 回弹 160ms，之后应完全复位
                const frames: any[] = await ev(`__wxStop()`); const after = await ev(`({ snap: __wxSnap(), scan: __wxScan(), fav: __wxFavSl() })`);
                const tag = `${kind}(${g.length}事件/${gestureMs}ms,Σdx=${g.reduce((s, e) => s + e.dx, 0)})`;
                // A
                if (before.scan.length) issues.push(`${tag} 手势前就有 scrollLeft≠0：${before.scan.join(",")}`);
                if (during.scan.length) issues.push(`${tag} 手势中 scrollLeft≠0：${during.scan.join(",")}`);
                if (after.scan.length) issues.push(`${tag} 手势后 scrollLeft≠0：${after.scan.join(",")}`);
                const slBad = frames.filter(f => f.sl[0] !== 0 || f.sl[1] !== 0); if (slBad.length) issues.push(`${tag} ${slBad.length}/${frames.length} 帧 documentElement/body.scrollLeft≠0（首帧 t=${slBad[0].t}ms：${slBad[0].sl.join("/")}）`);
                // B + C
                const s0 = frames[0], iScroll = WX.findIndex(w => w[0].startsWith("主滚动区"));
                let maxFollow = 0;
                WX.forEach(([name, s], i) => {
                    if (!s0.tg[i]) return;
                    const inScroll = !!s0.tg[i][3];
                    const x0 = s0.tg[i][0], tr0 = s0.tg[i][1];
                    let worst = { dx: 0, t: 0, k: -1 };
                    frames.forEach((f, k) => {
                        if (!f.tg[i]) return;
                        const dx = f.tg[i][0] - x0; const tx = iScroll >= 0 && f.tg[iScroll] ? f.tg[iScroll][2] : 0;
                        if (i === iScroll) maxFollow = Math.max(maxFollow, Math.abs(f.tg[i][2]));
                        const unexplained = (STRICT || !(inScroll || i === iScroll)) ? dx : (i === iScroll ? 0 : dx - tx);
                        if (Math.abs(unexplained) > Math.abs(worst.dx)) worst = { dx: unexplained, t: f.t, k };
                        if (!(i === iScroll || i === 0) && !STRICT && !inScroll && f.tg[i][1] !== tr0) worst = { dx: worst.dx, t: f.t, k: -2 };
                    });
                    const fin = after.snap.tg[i]; const endDx = fin ? fin[0] - x0 : NaN;
                    if (Math.abs(worst.dx) > TOL) issues.push(`${tag} ${name}[${s}] 手势中第 ${worst.k} 帧（t=${worst.t}ms）rect.x 偏移 ${worst.dx.toFixed(2)}px（x0=${x0.toFixed(2)}）${STRICT || !inScroll ? "" : "（扣除 .arc-scroll 跟手 transform 后）"}`);
                    if (worst.k === -2) issues.push(`${tag} ${name}[${s}] 不该有 transform 变化：手势前 ${tr0}`);
                    if (!fin) issues.push(`${tag} ${name}[${s}] 手势后元素消失（被重绘替换？）`);
                    else { if (!(Math.abs(endDx) <= TOL)) issues.push(`${tag} ${name}[${s}] 手势结束 700ms 后 rect.x 没复位：${x0.toFixed(2)} → ${fin[0].toFixed(2)}（Δ${endDx.toFixed(2)}px）`);
                        if (fin[1] !== tr0) issues.push(`${tag} ${name}[${s}] 手势结束后 transform 没复位：${tr0} → ${fin[1]}`); }
                });
                const favB = JSON.stringify(before.fav), favA = JSON.stringify(after.fav);
                info.push(`${tag}: ${frames.length} 帧, .arc-scroll 最大跟手 |tx|=${maxFollow.toFixed(1)}px, 收藏条 scrollLeft ${favB}→${favA}`);
                await sleep(300);
            }
            console.log(`   ${label} @(${Math.round(p.x)},${Math.round(p.y)})：${info.join(" | ")}`);
            wxSummary.push(`${label}: ${issues.length ? "FAIL" : "ok"}`);
            if (issues.length) throw new Error(`${issues.slice(0, 12).join(" ‖ ")}${issues.length > 12 ? ` …共 ${issues.length} 条` : ""} 截图 ${await shot("wheelx-" + label.replace(/\W+/g, ""))}`);
        });
        await closeAll();
        console.log("  【横向滚轮】区域汇总：", wxSummary.join("；"));
        await h.evalIn(O, `chrome.storage.local.set(${JSON.stringify({ "data:favorites": { items: [] }, "data:pinned": { bySpace: {} } })}).then(() => ${JSON.stringify(savedWx)}).then(s => Object.keys(s).length ? chrome.storage.local.set(s) : 1)`).catch(() => { });
    }
    } // wheelx
    if (PH.has("clicks")) {
    // ===== ＋ 菜单每一项 =====
    let items: string[] = [];
    await step("列出 ＋ 菜单项", 10_000, async () => {
        await realClick('[data-test="plus-btn"]'); await sleep(400);
        items = await ev(`[...document.querySelectorAll('[data-test="plus-menu"] [data-test]:not(.disabled)')].map(e => e.dataset.test)`) ?? [];
        await closeAll(); console.log("  ", items.join(" "));
        if (!items.length) throw new Error("＋ 菜单没有项");
    });
    for (const it of items) await step(`＋ 菜单 › ${it}`, 15_000, async () => {
        const ready = await openPlusFor(it);
        if (!ready) { const dg = await ev(`(() => { const b = document.querySelector('[data-test="plus-btn"]'); const r = b?.getBoundingClientRect(); const at = r && document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return { btn: r ? [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] : null, btnCls: b?.className, hit: at ? (at === b || b.contains(at) ? "plus-btn" : at.tagName + "." + String(at.className).slice(0, 60)) : null, menus: [...document.querySelectorAll('[data-test="plus-menu"]')].map(m => m.className + (m.hidden ? " hidden" : "")), overlay: document.querySelector(".arc-overlay")?.dataset.overlay ?? null, active: document.activeElement?.tagName + "." + String(document.activeElement?.className).slice(0, 40), space: document.querySelector(".arc-space-title")?.textContent?.slice(0, 30) }; })()`); throw new Error(`＋ 菜单打开后 4s 内没有可见的 ${it}（closing=${!(await noClosingMenu())} menuOpen=${await menuOpen()}） 诊断 ${JSON.stringify(dg)} 截图 ${await shot("plus-" + it)}`); }
        const did = await realClick(`${LIVE_MENU} [data-test="${it}"]`); await sleep(600); await closeAll(); await pollUntil(noClosingMenu, 3000); return did;
    });

    if (process.env.CLICKS !== "plus") { // CLICKS=plus：只跑 ＋ 菜单项（排查用）
    // ===== 侧栏所有可见按钮 =====
    let btns: string[] = [];
    await step("列出侧栏可见按钮", 10_000, async () => {
        await closeAll();
        btns = await ev(`(() => { let i = 0; return [...document.querySelectorAll("#app button, #app [role=button]")].filter(b => (b.offsetParent || b.getClientRects().length) && !b.disabled && !b.closest(".arc-menu, [data-test=plus-menu]")).slice(0, 80).map(b => { const k = "hx-" + (i++); b.setAttribute("data-hx", k); return k + " " + (b.dataset.test || __hx.tipOf(b) || b.getAttribute("aria-label") || b.className).slice(0, 40); }); })()`) ?? [];
        console.log(`   ${btns.length} 个`);
    });
    for (const b of btns) { const [k, ...rest] = b.split(" "); await step(`按钮 ${rest.join(" ")}`, 15_000, async () => { const did = await realClick(`[data-hx="${k}"]`); await sleep(500); await closeAll(); return did || "skip"; }); }

    // ===== 右键菜单每一项（标签行 / 底栏 / 空白处）=====
    const markRow = () => ev(`(() => { document.querySelectorAll("[data-hx-row]").forEach(e => e.removeAttribute("data-hx-row")); const r = [...document.querySelectorAll(".arc-today .arc-tab, .arc-slot-today .arc-tab")].filter(e => !e.closest(".arc-pinned, .arc-favorites, [class*=fav]")).find(e => /example/i.test(e.textContent + __hx.tipOf(e))); r?.setAttribute("data-hx-row", "1"); return !!r; })()`);
    for (const [label, sel] of [["标签行", '[data-hx-row="1"]'], ["底栏", ".arc-slot-bottom"], ["空间标题", ".arc-space-title"]] as const) {
        const ctx = async () => { if (label === "标签行" && !(await markRow())) { await h.evalIn(opener!.sessionId, `chrome.tabs.create({ windowId: ${winId}, url: "https://example.com/?arc-harness=" + Date.now(), active: false }).then(() => 1)`); for (let i = 0; i < 25 && !(await markRow()); i++) await sleep(200); } return realClick(sel, "right"); };
        let its: string[] = [];
        await step(`右键 ${label} → 列出菜单项`, 10_000, async () => {
            if (!(await ctx())) return "skip"; await sleep(300);
            its = await ev(`[...document.querySelectorAll(".arc-menu:not([hidden]) .arc-menu-item:not(.disabled):not([aria-disabled=true])")].map(e => e.dataset.test).filter(Boolean)`) ?? [];
            await closeAll(); console.log("  ", its.join(" "));
        });
        its.sort((a, b) => Number(/split/.test(a)) - Number(/split/.test(b)));
        for (const it of its.slice(0, 30)) {
            if (/close|delete|remove|archive|others|below|above|moveTo|space/i.test(it)) { console.log("SKIP", `右键 ${label} › ${it}（会改动/删除数据，由自测页覆盖）`); continue; }
            await step(`右键 ${label} › ${it}`, 15_000, async () => { if (!(await ctx())) return false; await sleep(300); if (!(await rect(`.arc-menu:not([hidden]) [data-test="${it}"]`))) { await closeAll(); console.log(`  （这次菜单里没有 ${it}：对象行已变化，跳过）`); return "skip"; }
                const did = await realClick(`.arc-menu:not([hidden]) [data-test="${it}"]`); await sleep(600); await closeAll(); return did; });
        }
    }

    } // clicks
    } // CLICKS
    } // SIDEPANEL
    // ===== 设置全扫：逐个改每个设置（插件开关 + 每个 BOOLEAN / SELECT / NUMBER 选项），每次之后断言 SW 零错误 + arc-errlog 为空；最后恢复 =====
    /* 设置全扫默认放进独立的浏览器实例（自己的随机端口 + 全新 user-data-dir，同一份私有 dist），自测页 / 其它阶段拿到的是干净 profile。
     * 全扫除了存储还会留下非存储状态（标签 / 空间 / 窗口 / 插件运行态 / storage.session…），隔离是唯一干净的办法。SWEEP_ISOLATED=0 = 旧的同实例全扫 + 快照恢复。 */
    if (process.env.SWEEP !== "0" && process.env.SWEEP_ISOLATED !== "0" && !process.env.SWEEP_CHILD) {
        await step("【设置全扫】在独立浏览器实例里跑（隔离 profile）", 900_000, async () => {
            const child = Bun.spawn(["bun", "run", "scripts/harness-cdp.ts"], { cwd: ROOT, env: { ...process.env, DIST, SWEEP_CHILD: "1", SELFTEST: "0", SIDEPANEL: "0", PHASES: "none" }, stdout: "pipe", stderr: "pipe" });
            const out = await new Response(child.stdout).text(); await child.exited;
            const lines = out.split("\n");
            for (const l of lines) if (/^FAIL 【设置全扫】|设置全扫：|全扫结束|^PASS 共|^FAIL 共/.test(l)) console.log("   [隔离全扫] " + l.slice(0, 600));
            const fails = lines.filter(l => /^FAIL 【设置全扫】/.test(l));
            rows.push(...fails.map(l => ({ step: "隔离全扫：" + l.replace(/^FAIL /, "").split(" | ")[0], ok: false, detail: l.slice(0, 1500) })));
            if (child.exitCode !== 0 && !fails.length) throw new Error(`隔离全扫子进程退出码 ${child.exitCode}：${lines.filter(l => /^FAIL/.test(l)).join(" ‖ ").slice(0, 1500) || out.slice(-1500)}`);
        }, { needPanel: false });
    }
    if (process.env.SWEEP !== "0" && (process.env.SWEEP_ISOLATED === "0" || process.env.SWEEP_CHILD)) {
        const sw = () => swSession()!;
        const KEY = "ArcSidebarSettings";
        const orig = await h.evalIn(opener!.sessionId, `chrome.storage.local.get("${KEY}").then(r => JSON.stringify(r["${KEY}"] ?? null))`);
        /* 全扫会通过插件副作用改别的存储（空间 / 固定 / 主题 / 会话…）→ 扫前整份快照 storage.local + sync 和插件启动状态，扫后（及每个插件之后）原样恢复 */
        const SNAP = "__hxSweepSnap";
        /* 快照放在框架（Node）这边：全扫切插件时选项页可能被重载，页面里的全局变量会丢 */
        const snap: string = await h.evalIn(opener!.sessionId, `Promise.all([chrome.storage.local.get(null), chrome.storage.sync.get(null)]).then(([l, s]) => JSON.stringify({ l, s }))`);
        void SNAP;
        const ensureOpener = async () => { if (!(await h.evalIn(opener!.sessionId, "1", { ms: 3000 }).catch(() => 0))) { const o = await h.open(`chrome-extension://${h.extId}/options.html`, true); opener = { sessionId: o.sessionId! }; await sleep(800); } };
        const startedBefore: string[] = await h.evalIn(swSession()!, `Object.values(ArcSidebar.plugins).filter(p => p.started).map(p => p.name).sort()`) ?? [];
        const restoreAll = async () => { await ensureOpener(); return h.evalIn(opener!.sessionId, `(async () => { const { l, s } = ${snap};
            const curL = await chrome.storage.local.get(null), curS = await chrome.storage.sync.get(null);
            const rmL = Object.keys(curL).filter(k => !(k in l)), rmS = Object.keys(curS).filter(k => !(k in s));
            if (rmL.length) await chrome.storage.local.remove(rmL); if (rmS.length) await chrome.storage.sync.remove(rmS);
            const chL = Object.fromEntries(Object.entries(l).filter(([k, v]) => JSON.stringify(curL[k]) !== JSON.stringify(v))), chS = Object.fromEntries(Object.entries(s).filter(([k, v]) => JSON.stringify(curS[k]) !== JSON.stringify(v)));
            if (Object.keys(chL).length) await chrome.storage.local.set(chL); if (Object.keys(chS).length) await chrome.storage.sync.set(chS);
            return { removed: rmL.length + rmS.length, changed: Object.keys(chL).length + Object.keys(chS).length, keys: [...rmL, ...Object.keys(chL), ...rmS.map(k => "sync:" + k), ...Object.keys(chS).map(k => "sync:" + k)].slice(0, 12) }; })()`, { ms: 15_000 }); };
        const startedNow = async (): Promise<string[]> => await h.evalIn(swSession()!, `Object.values(ArcSidebar.plugins).filter(p => p.started).map(p => p.name).sort()`).catch(() => []) ?? [];
        // 定义从 SW 里的插件对象读（与产品同源，不手写清单）
        const defs: { plugin: string; required: boolean; enabled: boolean; opts: { key: string; type: number; values: unknown[] }[] }[] = await h.evalIn(sw(), `Object.values(ArcSidebar.plugins).map(p => { const d = p.settings?.def ?? p.options ?? {}; return { plugin: p.name, required: !!p.required, enabled: !!p.started,
            opts: Object.entries(d).flatMap(([key, o]) => { if (!o || typeof o !== "object") return []; const t = o.type;
                if (t === 3) return [{ key, type: t, values: [!(o.default ?? false)] }];
                if (t === 4) return [{ key, type: t, values: (o.options ?? []).map(x => x.value) }];
                if (t === 1 || t === 5) return [{ key, type: t, values: [o.min ?? 0, o.max ?? (typeof o.default === "number" ? o.default * 2 + 1 : 1)] }];
                return []; }) }; })`) ?? [];
        const total = defs.reduce((n, d) => n + d.opts.reduce((m, o) => m + o.values.length, 0) + (d.required ? 0 : 2), 0);
        console.log(`   设置全扫：${defs.length} 个插件，共 ${total} 次修改`);
        const writeSetting = (plugin: string, key: string, value: unknown) => h.evalIn(opener!.sessionId, `chrome.storage.local.get("${KEY}").then(r => { const s = r["${KEY}"] ?? { plugins: {} }; s.plugins ??= {}; (s.plugins[${JSON.stringify(plugin)}] ??= {})[${JSON.stringify(key)}] = ${JSON.stringify(value)}; return chrome.storage.local.set({ "${KEY}": s }); }).then(() => 1)`);
        const errlog = () => h.evalIn(opener!.sessionId, `chrome.storage.local.get("arc-errlog").then(r => r["arc-errlog"] ?? [])`);
        const triggers: string[] = [];
        const swErrs = () => h.errors.slice(seenCdp).filter(e => e.ctx.startsWith("service_worker"));
        const one = async (label: string, plugin: string, key: string, value: unknown) => {
            const c0 = h.errors.length;
            await step(`【设置全扫】${label}`, 10_000, async () => {
                await writeSetting(plugin, key, value); await sleep(400);
                const sw = h.errors.slice(c0).filter(e => e.ctx.startsWith("service_worker")); const log = await errlog();
                if (sw.length || log.length) { triggers.push(label); throw new Error(`SW 错误：${sw.map(e => e.text.split("\n").slice(0, 3).join(" < ")).join(" ‖ ")}${log.length ? " ‖ arc-errlog：" + JSON.stringify(log).slice(0, 600) : ""}`); }
            }, { needPanel: false });
            if ((await errlog()).length) await h.evalIn(opener!.sessionId, `chrome.storage.local.remove("arc-errlog")`);
        };
        void swErrs;
        for (const d of defs) {
            for (const o of d.opts) for (const v of o.values) await one(`${d.plugin}.${o.key} = ${JSON.stringify(v)}`, d.plugin, o.key, v);
            if (!d.required) { await one(`${d.plugin}.enabled = ${!d.enabled}`, d.plugin, "enabled", !d.enabled); await one(`${d.plugin}.enabled = ${d.enabled}（复原）`, d.plugin, "enabled", d.enabled); }
            const r = await restoreAll().catch(() => null); if (r && (r.removed || r.changed)) console.log(`   （${d.plugin} 之后恢复存储：删 ${r.removed} / 改 ${r.changed}：${r.keys.join(", ")}）`); // 每个插件之后原样恢复
        }
        await step("【设置全扫】恢复原设置（storage.local + sync 整份快照）+ 插件启动状态与扫前一致", 20_000, async () => {
            await h.evalIn(opener!.sessionId, `(${orig} === null ? chrome.storage.local.remove("${KEY}") : chrome.storage.local.set({ "${KEY}": ${orig} })).then(() => 1)`);
            const r = await restoreAll(); console.log(`   全扫结束恢复存储：删 ${r.removed} / 改 ${r.changed} ${r.keys.join(", ")}`);
            let now: string[] = []; const end = Date.now() + 10_000;
            do { now = await startedNow(); if (JSON.stringify(now) === JSON.stringify(startedBefore)) break; await sleep(300); } while (Date.now() < end);
            const lost = startedBefore.filter(x => !now.includes(x)), extra = now.filter(x => !startedBefore.includes(x));
            if (lost.length || extra.length) throw new Error(`插件启动状态没恢复：扫前在跑而现在停了 ${JSON.stringify(lost)}；扫前没跑而现在在跑 ${JSON.stringify(extra)}`);
        }, { needPanel: false });
        console.log(triggers.length ? `   设置全扫：触发 SW 错误的设置 → ${triggers.join(" | ")}` : "   设置全扫：没有设置触发 SW 错误");
        if (!(await panelAlive())) await reopenPanel();
    }

    // ===== 自测页（selftest.html）=====
    /* 前面跑过真实侧栏阶段（core / clicks 会新建空间、标签、改“上一个标签”等运行态）时，自测页放进独立浏览器实例跑，拿干净 profile。
     * SELFTEST_ISOLATED=0 = 同实例跑（旧行为）；只跑自测页（SIDEPANEL=0）时本来就干净，直接同实例跑。 */
    const stIsolated = process.env.SELFTEST !== "0" && process.env.SIDEPANEL !== "0" && process.env.SELFTEST_ISOLATED !== "0" && !process.env.SWEEP_CHILD;
    if (stIsolated) await step("【自测页】在独立浏览器实例里跑（隔离 profile）", 1_300_000, async () => {
        const child = Bun.spawn(["bun", "run", "scripts/harness-cdp.ts"], { cwd: ROOT, env: { ...process.env, DIST, SWEEP_CHILD: "1", SWEEP: "0", SIDEPANEL: "0", PHASES: "none" }, stdout: "pipe", stderr: "pipe" });
        const out = await new Response(child.stdout).text(); await child.exited;
        const lines = out.split("\n");
        for (const l of lines) if (/^FAIL 自测页|^WARN 自测页|^自测页：\d|自测页稳定性重试|非致命 catch|^     · |^FAIL 共|^PASS 共|未处理 Promise|^   \d+× |^FAIL 自测页跑完/.test(l)) console.log("   [隔离自测页] " + l.slice(0, 900));
        const fails = lines.filter(l => /^FAIL /.test(l) && !/^FAIL 共/.test(l));
        rows.push(...fails.map(l => ({ step: "隔离自测页：" + l.replace(/^FAIL /, "").split(" | ")[0], ok: false, detail: l.slice(0, 1500) })));
        if (child.exitCode !== 0 && !fails.length) throw new Error(`隔离自测页子进程退出码 ${child.exitCode}：${out.slice(-1500)}`);
    }, { needPanel: false });
    if (process.env.SELFTEST !== "0" && !stIsolated) {
        let st: any;
        // 自测页自己管标签 / 收藏 / 新标签位置：先关掉真实侧边栏，免得两个侧栏实例互相干扰
        await step("自测前关闭真实侧边栏", 10_000, async () => { await h.evalIn(opener!.sessionId, `(chrome.sidePanel.close ? chrome.sidePanel.close({ windowId: ${winId} }) : Promise.resolve()).then(() => 1, () => 1)`, { userGesture: true }); await sleep(800); }, { needPanel: false });
        await step("打开 selftest.html", 15_000, async () => {
            // 发声测试页（Mute 第 18 / 21 / 23 项）：本机 http 服务（data: URL 的标签 scripting 注入会失败、写进错误日志），自测页用 ?audio= 拿到地址
            const audioSrv = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("<title>ST audible</title><script>var c=new AudioContext(),o=c.createOscillator(),g=c.createGain();g.gain.value=.05;o.connect(g);g.connect(c.destination);o.start();c.resume();setInterval(function(){c.resume()},500)</script>", { headers: { "content-type": "text/html" } }) });
            st = await h.open(`chrome-extension://${h.extId}/selftest.html?audio=${encodeURIComponent(`http://127.0.0.1:${audioSrv.port}/audio.html`)}`);
            // 自测会把别的标签切到前台：自测页进入后台后计时器会被节流（setTimeout 被拖到 1 分钟一次 → 看起来“卡死”）。让它始终按前台 / 有焦点运行
            await h.send("Emulation.setFocusEmulationEnabled", { enabled: true }, st.sessionId).catch(() => { });
            await h.send("Page.setWebLifecycleState", { state: "active" }, st.sessionId).catch(() => { });
        }, { needPanel: false });
        let res: { name: string; status: string; detail: string }[] = [];
        await step("自测页跑完（单步 120s 无进展判卡死，总 20 分钟）", 1_200_000, async () => {
            let lastN = -1, last = Date.now();
            for (;;) {
                await sleep(500);
                if (String(await h.evalIn(st.sessionId, "document.title", { ms: 10_000 }).catch(() => "")).includes("完成")) break;
                if (await h.evalIn(st.sessionId, "globalThis.__shot", { ms: 5000 }).catch(() => null)) await h.evalIn(st.sessionId, "globalThis.__shot = null").catch(() => { });
                const n = Number(await h.evalIn(st.sessionId, "globalThis.__results?.length ?? 0", { ms: 10_000 }).catch(() => lastN));
                if (n !== lastN) { lastN = n; last = Date.now(); }
                else if (Date.now() - last > 120_000) {
                    // 卡死：先把已有结果收回来（原先直接抛错 → res 为空 → 报“0 通过 / 0 失败”，看不出前面跑了什么）
                    res = await h.evalIn(st.sessionId, "globalThis.__results", { ms: 5000 }).catch(() => null) ?? [];
                    throw new Error(`卡住 120s：正在跑「${await h.evalIn(st.sessionId, "globalThis.__current ?? '（不在任何测试内）'", { ms: 5000 }).catch(() => "?（页面无响应：主线程被占住 / 页面已关闭）")}」，上一项「${await h.evalIn(st.sessionId, "globalThis.__results?.at(-1)?.name ?? '（开头）'", { ms: 5000 }).catch(() => "?")}」`);
                }
            }
            res = await h.evalIn(st.sessionId, "globalThis.__results") ?? [];
            const rt = await h.evalIn(st.sessionId, "globalThis.__retried ?? []").catch(() => []); if (rt?.length) console.log("   自测页稳定性重试（各一次）：", rt.join(" | "));
            /* 信息性：自测页里被 stCatch 记下的非致命异常（不计失败） */
            const sc = await h.evalIn(st.sessionId, "JSON.stringify((globalThis.__stCaught ?? []).map(x => ({ ctx: x.ctx, message: x.message })))").then((x: any) => JSON.parse(x || "[]")).catch(() => []);
            const grp = new Map<string, number>(); for (const x of sc) { const k = x.ctx + " → " + String(x.message).slice(0, 120); grp.set(k, (grp.get(k) ?? 0) + 1); }
            console.log(`   自测页非致命 catch（stCatch，仅供参考）：${sc.length} 条` + [...grp].map(([k, n]) => `\n     · ${k}${n > 1 ? " ×" + n : ""}`).join(""));
        }, { needPanel: false });
        for (const r of res) { const ok = r.status !== "fail"; rows.push({ step: "自测页：" + r.name, ok, detail: ok ? "" : r.detail.slice(0, 900) }); if (!ok) console.log("FAIL", "自测页：" + r.name, "|", r.detail.slice(0, 900)); else if (/WARN/.test(r.detail)) console.log("WARN", "自测页：" + r.name, "|", r.detail.slice(0, 900)); else if (/标签行提示/.test(r.name)) console.log("PASS", "自测页：" + r.name, "|", r.detail.slice(0, 400)); }
        console.log(`自测页：${res.filter(r => r.status === "pass").length} 通过 / ${res.filter(r => r.status === "fail").length} 失败 / ${res.filter(r => r.status === "skip").length} 跳过`);
        if (process.env.ST_JSON) { (await import("fs")).writeFileSync(process.env.ST_JSON, JSON.stringify(res, null, 1)); console.log(`自测页逐项结果：${process.env.ST_JSON}`); }
    }
    await step("运行期错误日志 storage.local['arc-errlog'] 为空（@api/ErrorLog）", 10_000, async () => {
        if (!(await h.evalIn(opener!.sessionId, "1", { ms: 3000 }).catch(() => 0))) { const o = await h.open(`chrome-extension://${h.extId}/options.html`, true); opener = { sessionId: o.sessionId! }; await sleep(800); }
        const log = await h.evalIn(opener!.sessionId, `chrome.storage.local.get("arc-errlog").then(r => JSON.stringify(r["arc-errlog"] ?? []))`);
        if (log !== "[]") throw new Error(String(log).slice(0, 1500));
    }, { needPanel: false });
    await step("收尾：arc-sidepanel-violations === []", 10_000, async () => { const v = await violations(); if (v.length) throw new Error(JSON.stringify(v).slice(0, 1500)); }, { needPanel: false });
    await step("收尾：全程无错误（chrome://extensions 完整列表）", 10_000, async () => { const all = (await h.extensionErrors()).filter(e => !expected(e)); if (all.length) throw new Error(all.map(fmtErr).join(" ‖ ")); }, { needPanel: false });
    (await import("fs")).writeFileSync("/tmp/harness-errors.json", JSON.stringify(allErrs, null, 1)); console.log("完整错误明细：/tmp/harness-errors.json");
    const bad = rows.filter(r => !r.ok);
    console.log(bad.length ? `\nFAIL 共 ${rows.length} 步，${bad.length} 步失败：\n` + bad.map(r => " - " + r.step).join("\n") : `\nPASS 共 ${rows.length} 步，全部通过`);
    code = bad.length ? 1 : 0;
} catch (e) { console.log("FAIL 测试框架中止：", (e as Error).message); }
finally {
    /* 未处理的 Promise rejection 汇总（产品里 void p 没 .catch 的会以 "Uncaught (in promise)" 出现在 exceptionThrown / chrome://extensions） */
    try { const rj = [...h.errors, ...allErrs].filter((e: any) => /in promise|unhandledrejection|Unhandled/i.test(String(e.text ?? e.msg))); const by = new Map<string, number>(); for (const e of rj as any[]) { const k = `${e.ctx ?? e.src ?? "?"} · ${String(e.text ?? e.msg).split("\n")[0].slice(0, 160)}`; by.set(k, (by.get(k) ?? 0) + 1); }
        console.log(rj.length ? `未处理 Promise rejection 汇总（${rj.length} 条）：\n` + [...by].map(([k, n]) => `   ${n}× ${k}`).join("\n") : "未处理 Promise rejection：0 条"); } catch { }
    h.close(); if (ownDist) (await import("fs")).rmSync(ownDist, { recursive: true, force: true }); }
process.exit(code);

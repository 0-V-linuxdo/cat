/* 真实点击审计：无头 Chrome 加载 dist，打开开发者模式 + errorCollection，在 sidepanel.html 页里用 CDP Input 真实点击
 * 底栏 / 菜单的每个按钮，之后读 chrome.developerPrivate 的 runtimeErrors（Service Worker / 侧栏 / 离屏 所有上下文），
 * 并检查页面没有崩溃 / 关闭。任何错误都失败。用法：DIST=… CDP_PORT=… bun run scripts/click-audit-cdp.ts */
const PORT = process.env.CDP_PORT ?? "9335";
const v = await (await fetch(`http://localhost:${PORT}/json/version`)).json();
let n = 0; const pend = new Map<number, (r: any) => void>(); const events: any[] = [];
const ws = new WebSocket(v.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
ws.onmessage = e => { const m = JSON.parse(String(e.data)); if (m.id) pend.get(m.id)?.(m); else events.push(m); };
const send = (method: string, params: object = {}, sessionId?: string) => new Promise<any>(r => { const id = ++n; pend.set(id, r); ws.send(JSON.stringify({ id, method, params, sessionId })); setTimeout(() => r({ timeout: true }), 15000); });
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const ld = await send("Extensions.loadUnpacked", { path: process.env.DIST ?? new URL("../dist", import.meta.url).pathname });
if (!ld.result) { console.log("FAIL load", JSON.stringify(ld.error)); process.exit(1); }
const id = ld.result.id;
const attach = async (url: string) => { const { result: { targetId } } = await send("Target.createTarget", { url }); const { result: { sessionId } } = await send("Target.attachToTarget", { targetId, flatten: true }); return { targetId, sessionId }; };
const { LOCATE_SRC } = await import("../src/selftest/locate");
const evalIn = async (s: string, expression: string) => (await send("Runtime.evaluate", { expression: `${LOCATE_SRC}\n${expression}`, awaitPromise: true, returnByValue: true }, s)).result?.result?.value;
const ext = await attach("chrome://extensions"); await sleep(1500);
await evalIn(ext.sessionId, `new Promise(r => chrome.developerPrivate.updateProfileConfiguration({ inDeveloperMode: true }, () => chrome.developerPrivate.updateExtensionConfiguration({ extensionId: ${JSON.stringify(id)}, errorCollection: true }, () => chrome.developerPrivate.reload(${JSON.stringify(id)}, { failQuietly: true }, () => r(1)))))`);
await sleep(2500);
const errors = async () => JSON.parse(await evalIn(ext.sessionId, `new Promise(r => chrome.developerPrivate.getExtensionsInfo({ includeDisabled: true, includeTerminated: true }, l => { const x = l.find(e => e.id === ${JSON.stringify(id)}); r(JSON.stringify((x?.runtimeErrors ?? []).map(e => ({ src: e.source, ctx: e.contextUrl, msg: e.message, stack: (e.stackTrace ?? []).slice(0, 3).map(f => f.functionName + "@" + f.url.split("/").pop() + ":" + f.lineNumber).join(" < ") }))).concat(x?.state !== "ENABLED" ? [{ msg: "扩展状态 " + x?.state }] : [])) }))`) ?? "[]");
// 一个普通网页标签（右键菜单的对象；不要对侧栏页自己所在的标签操作，否则“拆分 / 移到”会把侧栏页本身带走）
await send("Target.createTarget", { url: "https://example.com/?arc-click-audit", background: true });
const panel = await attach(`chrome-extension://${id}/sidepanel.html`);
await send("Runtime.enable", {}, panel.sessionId); await send("Page.enable", {}, panel.sessionId);
await sleep(3000);
const rect = async (sel: string) => evalIn(panel.sessionId, `(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e || !e.offsetParent) return null; e.scrollIntoView({ block: "nearest" }); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
const realClick = async (sel: string) => {
    const p = await rect(sel); if (!p) return false;
    for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: p.x, y: p.y, button: "left", buttons: type === "mousePressed" ? 1 : 0, clickCount: 1 }, panel.sessionId);
    return true;
};
const escape = async () => { for (const type of ["keyDown", "keyUp"]) await send("Input.dispatchKeyEvent", { type, key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }, panel.sessionId); };
const results: { step: string; ok: boolean; detail: string }[] = [];
const alive = async () => (await evalIn(panel.sessionId, "document.readyState")) === "complete";
const check = async (step: string, before: number) => {
    const missed = step.endsWith("（没点到）");
    await sleep(700);
    const errs = await errors(); const fresh = errs.slice(before);
    const crash = events.filter(e => e.method === "Inspector.targetCrashed" || e.method === "Inspector.detached" || (e.method === "Target.detachedFromTarget" && e.params.sessionId === panel.sessionId));
    const exc = events.filter(e => e.method === "Runtime.exceptionThrown").map(e => e.params.exceptionDetails?.exception?.description ?? e.params.exceptionDetails?.text); events.length = 0;
    const ok = !missed && !fresh.length && !crash.length && !exc.length && await alive();
    results.push({ step, ok, detail: ok ? "" : JSON.stringify({ fresh, crash: crash.map(c => c.method), exc }).slice(0, 900) });
    return errs.length;
};
let base = (await errors()).length;
if (base) results.push({ step: "加载后", ok: false, detail: JSON.stringify(await errors()).slice(0, 900) });
// 底栏
for (const [step, sel] of [["点 ＋", '[data-test="plus-btn"]'], ["再点 ＋（关闭）", '[data-test="plus-btn"]']] as const) { await realClick(sel); base = await check(step, base); }
// ＋ 菜单每一项（新建标签 / 分屏会开标签：之后切回）
const items: string[] = await evalIn(panel.sessionId, `((async () => { document.querySelector('[data-test="plus-btn"]').click(); await new Promise(r => setTimeout(r, 300)); const l = [...document.querySelectorAll('[data-test="plus-menu"] .arc-plus-item:not(.disabled)')].map(e => e.dataset.test); document.querySelector('[data-test="plus-btn"]').click(); return l; })())`) ?? [];
for (const it of items) {
    await sleep(200);
    if (!(await evalIn(panel.sessionId, `(() => { const m = document.querySelector('[data-test="plus-menu"]'); return !m.hidden && !m.classList.contains("closing"); })()`))) await realClick('[data-test="plus-btn"]'); await sleep(300);
    const did = await realClick(`[data-test="${it}"]`); await sleep(400); await escape(); await escape();
    base = await check(`＋ 菜单 › ${it}${did ? "" : "（没点到）"}`, base);
    await send("Target.activateTarget", { targetId: panel.targetId });
}
// 其它底栏按钮、顶部按钮
for (const [step, sel] of [["Library", '[data-test="library-btn"]'], ["空间圆点", ".arc-space-dot"], ["地址胶囊", ".arc-urlbar-host"]] as const) {
    const did = await realClick(sel); await sleep(300); await escape(); await escape(); base = await check(`${step}${did ? "" : "（没有该元素）"}`, base);
}
// 侧栏里所有可见按钮（逐个真实点击；每次之后 Esc 关闭浮层、切回侧栏页）
const allBtns: string[] = await evalIn(panel.sessionId, `(() => { let i = 0; return [...document.querySelectorAll("#app button, #app [role=button]")].filter(b => b.offsetParent && !b.disabled && !b.closest(".arc-menu")).slice(0, 60).map(b => { const k = "ca-" + (i++); b.setAttribute("data-ca", k); return k + " " + (b.dataset.test || __hx.tipOf(b) || b.className).slice(0, 40); }); })()`) ?? [];
for (const b of allBtns) {
    const [k, ...rest] = b.split(" ");
    const did = await realClick(`[data-ca="${k}"]`); await sleep(350); await escape(); await escape();
    base = await check(`按钮 ${rest.join(" ")}${did ? "" : "（已不可见）"}`, base);
    await send("Target.activateTarget", { targetId: panel.targetId });
}
// 右键菜单（标签行 / 空白处）：每一项都真实点击一次
const markRow = () => evalIn(panel.sessionId, `(() => { document.querySelectorAll("[data-ca-row]").forEach(e => e.removeAttribute("data-ca-row")); const r = [...document.querySelectorAll(".arc-tab")].filter(e => !e.closest(".arc-pinned, .arc-favorites, [class*=fav]")).find(e => /example/i.test(e.textContent + __hx.tipOf(e))); r?.setAttribute("data-ca-row", "1"); return !!r; })()`);
const ctxAt = async (sel: string) => {
    // 上一项把这一行变走了（固定 / 收藏 / 分屏）：再开一个普通网页标签当对象
    if (sel.includes("data-ca-row") && !(await markRow())) { await send("Target.createTarget", { url: `https://example.com/?arc-click-audit=${Date.now()}`, background: true }); await sleep(1200); await send("Target.activateTarget", { targetId: panel.targetId }); await markRow(); }
    const p = await rect(sel); if (!p) return false; await send("Input.dispatchMouseEvent", { type: "mousePressed", x: p.x, y: p.y, button: "right", buttons: 2, clickCount: 1 }, panel.sessionId); await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: p.x, y: p.y, button: "right", buttons: 0, clickCount: 1 }, panel.sessionId); await sleep(300); return true; };
await evalIn(panel.sessionId, `(() => { const r = [...document.querySelectorAll(".arc-tab")].find(e => /example/i.test(e.textContent + __hx.tipOf(e))); r?.setAttribute("data-ca-row", "1"); return !!r; })()`);
for (const target of ['[data-ca-row="1"]', ".arc-slot-bottom"]) {
    if (!(await ctxAt(target))) continue;
    const its: string[] = await evalIn(panel.sessionId, `[...document.querySelectorAll(".arc-menu:not([hidden]) .arc-menu-item:not(.disabled):not([aria-disabled=true])")].map(e => e.dataset.test).filter(Boolean)`) ?? [];
    await escape();
    // 会把标签变成别的页面（分屏）的项放最后，免得后面的项找不到这一行
    its.sort((a, b) => Number(/split/.test(a)) - Number(/split/.test(b)));
    for (const it of its.slice(0, 25)) {
        if (/close|delete|remove|archive|others|below|above|moveTo|space/i.test(it)) continue; // 会改动标签数据：别的自测覆盖
        await ctxAt(target); const did = await realClick(`.arc-menu:not([hidden]) [data-test="${it}"]`); await sleep(400); await escape(); await escape();
        base = await check(`右键 ${target} › ${it}${did ? "" : "（没点到）"}`, base);
        await send("Target.activateTarget", { targetId: panel.targetId });
    }
}
// 手势外的 sidePanel.open（@api/SidePanelGesture 包装记录）：任何一条都失败
const spv = String(await evalIn(panel.sessionId, `chrome.runtime.sendMessage({ type: "arc-sidepanel-violations" }).then(v => JSON.stringify(v ?? []), e => "ERR " + e)`));
results.push({ step: "没有手势外的 sidePanel.open", ok: spv === "[]", detail: spv === "[]" ? "" : spv.slice(0, 900) });
// 扩展自己的运行期错误日志（@api/ErrorLog：所有上下文的未处理 rejection / 异常）
const errlog = String(await evalIn(panel.sessionId, `chrome.storage.local.get("arc-errlog").then(r => JSON.stringify(r["arc-errlog"] ?? []))`));
results.push({ step: "运行期错误日志（arc-errlog）为空", ok: errlog === "[]", detail: errlog === "[]" ? "" : String(errlog).slice(0, 900) });
const rows = results.filter(r => !r.ok);
for (const r of results) console.log(r.ok ? "PASS" : "FAIL", "真实点击：" + r.step, r.detail ? "| " + r.detail : "");
console.log(rows.length ? `FAIL 真实点击审计：${rows.length} 项出错` : `PASS 真实点击审计：${results.length} 步，无扩展错误 / 无崩溃`);
process.exit(rows.length ? 1 : 0);

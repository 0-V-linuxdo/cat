/* 补丁 rel66-postmessage-origin：真实网页 + 页内侧栏（in-page 模式）下，宿主 → iframe 的 postMessage 不再触发
 * “Failed to execute 'postMessage' on 'DOMWindow': The target origin provided (chrome-extension://…) does not match the recipient window's origin (…)”。
 * 浏览器把这条记成页面上下文里的 security 消息（Chrome 里 level=warning；Helium 扩展错误列表里显示为错误），harness 原有的错误收集只看扩展上下文的 error 级，看不到它 → 单独一个独立实例检查。
 * 用法：DIST=<已构建 dist> bun run scripts/inpage-origin-cdp.ts   （harness-cdp.ts 在独立实例步骤里调用；DISPLAY 继承调用方，调用方必须显式给）
 * 场景：S0 新页面首次出侧栏（常驻推开：iframe 刚建就要发 look —— rel65 及之前每次都报 1 条）；S1 页面删掉宿主 → 重挂（新浏览上下文）+ 常驻切换 + 切走/切回；S2 新标签刚开就切走（握手前停放）。
 * 输出：PASS / FAIL 行（前缀【页内 postMessage】）+ 「页内 postMessage 源不匹配：N 条」；任何 FAIL → 退出码 1 */
import { Harness, sleep } from "./lib/cdp-harness";

const DIST = process.env.DIST;
if (!DIST) { console.log("FAIL 【页内 postMessage】缺 DIST"); process.exit(1); }
const h = new Harness();
const RE = /postMessage/i, RE2 = /target origin|recipient window/i;
const hits: { phase: string; text: string }[] = [];
let phase = "boot";
const rows: { ok: boolean; name: string; detail: string }[] = [];
const ok = (name: string, cond: boolean, detail = "") => { rows.push({ ok: cond, name, detail }); console.log(`${cond ? "PASS" : "FAIL"} 【页内 postMessage】${name}${detail ? " | " + detail : ""}`); };
h.on((m: any) => {
    const p = m.params ?? {}; let text = "";
    if (m.method === "Log.entryAdded") text = `${p.entry?.level} ${p.entry?.source} ${p.entry?.text} @${p.entry?.url ?? ""}:${p.entry?.lineNumber ?? ""}`;
    else if (m.method === "Runtime.exceptionThrown") text = `exception ${p.exceptionDetails?.exception?.description ?? p.exceptionDetails?.text ?? ""}`;
    else if (m.method === "Runtime.consoleAPICalled") text = `console.${p.type} ${(p.args ?? []).map((a: any) => a.value ?? a.description ?? "").join(" ")}`;
    if (text && RE.test(text) && RE2.test(text)) { hits.push({ phase, text: text.slice(0, 600) }); console.log(`   !! [${phase}] ${text.slice(0, 400)}`); }
});
const page = (p: string) => `<!doctype html><meta charset=utf-8><title>inpage-origin ${p}</title><body style="margin:0;min-height:2000px"><h1>${p}</h1></body>`;
const srv = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: r => new URL(r.url).pathname === "/favicon.ico" ? new Response("", { status: 404 }) : new Response(page(new URL(r.url).pathname), { headers: { "content-type": "text/html" } }) });
const U = (p: string) => `http://localhost:${srv.port}${p}`;
let code = 0;
try {
    await h.launch();
    await h.loadExtension(DIST);
    await h.enableErrorCollection().catch(() => { });
    const opener = await h.open(`chrome-extension://${h.extId}/options.html`);
    for (let i = 0; i < 40; i++) { if (await h.evalIn(opener.sessionId!, `!!(globalThis.chrome && chrome.storage && chrome.tabs)`).catch(() => false)) break; await sleep(250); }
    const oe = (js: string) => h.evalIn(opener.sessionId!, js);
    await oe(`chrome.storage.local.get("ArcSidebarSettings").then(g => { const s = g.ArcSidebarSettings ?? {}; s.plugins ??= {}; s.plugins.InpageSidebar = { ...(s.plugins.InpageSidebar ?? {}), enabled: true, displayMode: "push", hoverReveal: false }; return chrome.storage.local.set({ ArcSidebarSettings: s }); }).then(() => 1)`);
    await sleep(1500);
    const mkTab = (u: string) => oe(`chrome.tabs.create({ url: ${JSON.stringify(u)}, active: true }).then(t => t.id)`) as Promise<number>;
    const act = (id: number) => oe(`chrome.tabs.update(${id}, { active: true }).then(() => 1)`);
    const sid = (u: string) => [...h.targets.values()].find(t => t.alive && t.sessionId && t.type === "page" && t.url === u)?.sessionId;
    const hostState = async (u: string) => { const s = sid(u); if (!s) return null; const r = await h.evalIn(s, `(()=>{const h=document.getElementById("arc-inpage-sidebar-host"); const f=h?.shadowRoot?.querySelector("iframe"); return JSON.stringify({ host: !!h, shown: h?.shadowRoot?.querySelector(".box")?.dataset.shown ?? null, push: h?.dataset.push ?? null, frame: !!f, op: f ? f.style.opacity : null })})()`, { ms: 3000 }).catch(() => null); return r ? JSON.parse(r as string) : null; };
    const panelLook = async (tabId: number) => { for (const t of h.targets.values()) { if (!t.alive || !t.sessionId || t.type !== "iframe" || !/host=inpage/.test(t.url)) continue; const r = await h.evalIn(t.sessionId, `chrome.tabs.getCurrent().then(t => JSON.stringify({ tab: t && t.id, look: document.documentElement.dataset.inpageLook ?? null, parked: document.documentElement.dataset.inpageParked ?? null }))`, { ms: 3000 }).catch(() => null); if (r) { const j = JSON.parse(r as string); if (j.tab === tabId) return j; } } return null; };
    const waitReady = async (u: string, ms = 10_000) => { const t0 = Date.now(); let s: any = null; while (Date.now() - t0 < ms) { s = await hostState(u); if (s?.shown === "1" && s.frame && s.op === "") return s; await sleep(200); } return s; };

    phase = "S0 首次出侧栏";
    const u0 = U("/base"); const t0 = await mkTab(u0);
    const s0 = await waitReady(u0);
    ok("S0 真实网页上页内侧栏已显示并完成握手（常驻推开）", s0?.shown === "1" && s0?.op === "" && s0?.push === "1", JSON.stringify(s0));
    const l0 = await panelLook(t0); ok("S0 面板收到外观 flat", l0?.look === "flat", JSON.stringify(l0));
    const uB = U("/other"); const tB = await mkTab(uB); await sleep(1500); await act(t0); await sleep(1500);
    for (let k = 0; k < 2; k++) {
        phase = `S1 宿主被页面删掉后重挂 #${k}`;
        await h.evalIn(sid(u0)!, `document.getElementById("arc-inpage-sidebar-host")?.remove(), 1`);
        await sleep(1100); // TIMING.rebuildMs（1 s）后重挂：iframe 换新浏览上下文，从初始 about:blank 起步
        await act(tB); await sleep(120); await act(t0); // 握手前停放 / 取消停放 → postIdle
        const s1 = await waitReady(u0); const l1 = await panelLook(t0);
        ok(`S1 重挂 #${k} 后侧栏恢复、面板外观 flat、未停放`, s1?.shown === "1" && s1?.op === "" && l1?.look === "flat" && l1?.parked == null, JSON.stringify({ s1, l1 }));
    }
    phase = "S2 新标签刚开就切走";
    for (let k = 0; k < 2; k++) { const u = U(`/s2-${k}`); const t = await mkTab(u); await sleep(100); await act(t0); await sleep(400); await act(t); const s2 = await waitReady(u); ok(`S2 #${k} 切回后侧栏就绪`, s2?.shown === "1" && s2?.op === "", JSON.stringify(s2)); }
    phase = "收尾"; await sleep(1500);
    const ext = (await h.extensionErrors().catch(() => [])).filter(e => RE.test(String(e.msg)));
    console.log(`页内 postMessage 源不匹配：${hits.length} 条（CDP）／chrome://extensions ${ext.length} 条`);
    ok("全程没有 postMessage target origin 不匹配（页面上下文 CDP 日志）", hits.length === 0, hits.map(x => `[${x.phase}] ${x.text}`).join(" ‖ ").slice(0, 1500));
    ok("chrome://extensions 错误列表里没有 postMessage 相关", ext.length === 0, JSON.stringify(ext).slice(0, 1500));
} catch (e) { code = 1; console.log(`FAIL 【页内 postMessage】异常：${String((e as Error).stack ?? e).slice(0, 1500)}`); }
finally {
    srv.stop(true); h.close();
    const fails = rows.filter(r => !r.ok).length;
    console.log(`${fails || code ? "FAIL" : "PASS"} 共 ${rows.length} 项${fails ? `，失败 ${fails}` : "，全部通过"}`);
    process.exit(fails || code ? 1 : 0);
}

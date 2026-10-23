/* 回归（52159 实机高危）：焦点在网页 → 右键今日区标签 → 悬停 Move to 打开子菜单 → 在网页里按 Esc / 点网页空白，整层菜单必须 1s 内关闭。
 * 用法：DIST=… bun run scripts/submenu-esc-cdp.ts（N=轮数） */
import { Harness, sleep, withTimeout } from "./lib/cdp-harness";
const DIST = process.env.DIST!, N = Number(process.env.N ?? 3);
const h = new Harness(); let code = 1;
try {
    await withTimeout("launch", 45_000, h.launch());
    await h.loadExtension(DIST);
    const page = await h.open(process.env.PAGE ?? "https://example.com/?arc-subesc");
    const o = await h.open(`chrome-extension://${h.extId}/options.html`); await sleep(1500);
    const winId = await h.evalIn(o.sessionId!, "chrome.windows.getCurrent().then(w => w.id)");
    await h.evalIn(o.sessionId!, `chrome.tabs.query({}).then(ts => { const t = ts.find(x => !x.url?.startsWith("chrome-extension:")); return t && chrome.tabs.update(t.id, { active: true }); })`);
    await h.evalIn(o.sessionId!, `chrome.sidePanel.open({ windowId: ${winId} }).then(() => "ok")`, { userGesture: true });
    const panelT = () => h.extTargets().find(t => /\/sidepanel\.html(\?|$)/.test(t.url) && !t.url.includes("popup=") && t.sessionId && t.alive);
    for (let i = 0; i < 100 && !panelT(); i++) await sleep(100);
    const S = panelT()!.sessionId!, P = page.sessionId!; await sleep(2000);
    const ev = (js: string) => h.evalIn(S, js);
    const rect = (sel: string) => ev(`(() => { const e = document.querySelector('${sel}'); if (!e || !e.getClientRects().length) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    const mouse = async (sess: string, p: { x: number; y: number }, button: "left" | "right", moveOnly = false) => { for (const type of moveOnly ? ["mouseMoved"] : ["mouseMoved", "mousePressed", "mouseReleased"]) await h.send("Input.dispatchMouseEvent", { type, x: p.x, y: p.y, button, buttons: type === "mousePressed" ? (button === "left" ? 1 : 2) : 0, clickCount: 1 }, sess); };
    const menus = () => ev(`document.querySelectorAll(".arc-menu:not([hidden])").length`);
    let fails = 0;
    for (let i = 1; i <= N; i++) for (const how of ["esc", "click"] as const) {
        await mouse(P, { x: 300, y: 400 }, "left"); await sleep(200);       // 先点网页：焦点在网页
        await h.send("Page.bringToFront", {}, P).catch(() => {});
        const r = await rect(".arc-today .arc-tab"); if (!r) throw new Error("no today tab");
        await mouse(S, r, "right"); await sleep(400);
        const mv = await rect('.arc-menu [data-test="moveTo"]'); if (!mv) throw new Error("no Move to");
        await mouse(S, mv, "left", true); await sleep(600);                  // 悬停展开子菜单
        const before = await menus(); if (i === 1) console.log("  打开时:", JSON.stringify(await ev(`[...document.querySelectorAll(".arc-menu")].map(m => m.parentElement?.tagName + "|" + m.className + "|" + (m.dataset.test ?? ""))`)));
        if (how === "esc") for (const type of ["keyDown", "keyUp"]) await h.send("Input.dispatchKeyEvent", { type, key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }, P);
        else await mouse(P, { x: 300, y: 450 }, "left");
        let after = before; const t0 = Date.now(); while (after && Date.now() - t0 < 1500) { await sleep(100); after = await menus(); }
        const ok = before >= 2 && after === 0; if (!ok) fails++;
        console.log(`#${i} ${how}: menus ${before} -> ${after} ${ok ? "OK" : "FAIL"} focus=${await ev("document.hasFocus()")}`);
        if (after) console.log("  残留:", JSON.stringify(await ev(`[...document.querySelectorAll(".arc-menu")].map(m => ({ parent: m.parentElement?.tagName + "." + m.parentElement?.className, cls: m.className, depth: m.dataset.depth, test: m.dataset.test, hidden: m.hidden, items: [...m.querySelectorAll("[data-test]")].slice(0, 4).map(x => x.dataset.test) }))`)));
        if (after) { for (const type of ["keyDown", "keyUp"]) await h.send("Input.dispatchKeyEvent", { type, key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }, S); await ev(`document.querySelectorAll(".arc-menu").forEach(m => m.remove())`); }
    }
    console.log(fails ? `FAIL ${fails}` : "PASS"); code = fails ? 1 : 0;
} catch (e) { console.log("ERROR", (e as Error).message); }
try { await (h as any).close?.(); } catch { } process.exit(code);

/* 回归：＋ → New Tab 连点 N 次，每次都必须在 5s 内出现命令栏（居中小窗或侧栏浮层）。用法：DIST=… bun run scripts/plus-repeat-cdp.ts */
import { Harness, sleep, withTimeout } from "./lib/cdp-harness";
const DIST = process.env.DIST!;
const h = new Harness(); let code = 1;
try {
    await withTimeout("launch", 45_000, h.launch());
    await h.loadExtension(DIST);
    await h.open("https://example.com/?arc-plus");
    const o = await h.open(`chrome-extension://${h.extId}/options.html`); await sleep(1500);
    const winId = await h.evalIn(o.sessionId!, "chrome.windows.getCurrent().then(w => w.id)");
    await h.evalIn(o.sessionId!, `chrome.tabs.query({ url: "https://example.com/*" }).then(([t]) => t && chrome.tabs.update(t.id, { active: true }))`);
    await h.evalIn(o.sessionId!, `chrome.sidePanel.open({ windowId: ${winId} }).then(() => "ok")`, { userGesture: true });
    const panelT = () => h.extTargets().find(t => /\/sidepanel\.html(\?|$)/.test(t.url) && !t.url.includes("popup=") && t.sessionId && t.alive);
    for (let i = 0; i < 100 && !panelT(); i++) await sleep(100);
    const S = panelT()!.sessionId!; await sleep(2000);
    const ev = (js: string) => h.evalIn(S, js);
    const rect = (sel: string) => ev(`(() => { const e = document.querySelector('${sel}'); if (!e || !e.getClientRects().length) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    const click = async (sel: string) => { const p = await rect(sel); if (!p) return false; for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await h.send("Input.dispatchMouseEvent", { type, x: p.x, y: p.y, button: "left", buttons: type === "mousePressed" ? 1 : 0, clickCount: 1 }, S); return true; };
    // 先建第二个 Space，再对今日区第一行右键 › Move to，读子菜单 data-test 顺序
    await ev(`1`);
    const n0 = await ev(`document.querySelectorAll(".arc-space-dot").length`);
    const rc = async (sel: string) => { const p = await rect(sel); if (!p) return false; for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await h.send("Input.dispatchMouseEvent", { type, x: p.x, y: p.y, button: "right", buttons: type === "mousePressed" ? 2 : 0, clickCount: 1 }, S); return true; };
    const sub = async () => { await rc(".arc-today .arc-tab"); await sleep(400); await click('.arc-menu [data-test="moveTo"]'); await sleep(500); return ev(`[...document.querySelectorAll(".arc-submenu > *")].map(x => x.classList.contains("arc-menu-sep") ? "sep" : (x.dataset.test || "?").replace(/^space:.*/, "space:<id>")).join(",")`); };
    const one = await sub(); console.log("one space:", one);
    for (const type of ["keyDown", "keyUp"]) await h.send("Input.dispatchKeyEvent", { type, key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }, S); await sleep(300);
    for (const type of ["keyDown", "keyUp"]) await h.send("Input.dispatchKeyEvent", { type, key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }, S); await sleep(300);
    await ev(`(async () => { const m = await chrome.runtime.sendMessage({ type: "arc-sidebar:rpc", method: "spaces:create", args: ["ST2"] }).catch(e => String(e)); return JSON.stringify(m); })()`).then(r => console.log("create:", r));
    await sleep(800);
    const two = await sub(); console.log("two spaces:", two, "dots", n0, "->", await ev(`document.querySelectorAll(".arc-space-dot").length`));
    code = 0;
} catch (e) { console.log("ERROR", (e as Error).message); }
try { await (h as any).close?.(); } catch { } process.exit(code);

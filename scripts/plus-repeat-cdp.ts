/* 回归：＋ → New Tab 连点 N 次，每次都必须在 5s 内出现命令栏（居中小窗或侧栏浮层）。用法：DIST=… bun run scripts/plus-repeat-cdp.ts */
import { Harness, sleep, withTimeout } from "./lib/cdp-harness";
const DIST = process.env.DIST!; const N = Number(process.env.N ?? 4); const CLOSE = process.env.CLOSE ?? "esc";
const h = new Harness(); let ok = 0; let code = 1;
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
    const seen = new Set<string>();
    const popup = () => h.extTargets().find(t => t.url.includes("popup=commandBar") && t.alive);
    const freshPopup = () => h.extTargets().find(t => t.url.includes("popup=commandBar") && t.alive && !seen.has(t.targetId));
    const overlay = () => ev(`!!document.querySelector(".arc-cmd-input")`).catch(() => false);
    const rclick = async (sel: string) => { const p = await rect(sel); if (!p) return false; for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await h.send("Input.dispatchMouseEvent", { type, x: p.x, y: p.y, button: "right", buttons: type === "mousePressed" ? 2 : 0, clickCount: 1 }, S); return true; };
    const key = async (k: string, code = k, vk = 13) => { for (const type of ["keyDown", "keyUp"]) await h.send("Input.dispatchKeyEvent", { type, key: k, code, windowsVirtualKeyCode: vk, ...(type === "keyDown" && k.length === 1 ? { text: k } : {}) }, S); };
    async function preRename() {
        const ok1 = await rclick(".arc-today .arc-tab"); await sleep(400);
        const item = await ev(`(() => { const m = [...document.querySelectorAll(".arc-menu-item")].find(x => /Rename|重命名/.test(x.textContent || "")); if (!m) return null; const r = m.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
        if (item) for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await h.send("Input.dispatchMouseEvent", { type, x: item.x, y: item.y, button: "left", buttons: type === "mousePressed" ? 1 : 0, clickCount: 1 }, S);
        await sleep(400); await h.send("Input.insertText", { text: "RT" }, S); await key("Enter"); await sleep(600);
        console.log(`  preRename rclick=${ok1} menuItem=${!!item} menus=${await ev(`document.querySelectorAll(".arc-menu").length`)} input=${await ev(`!!document.querySelector(".arc-rename")`)}`);
    }
    for (let i = 1; i <= N; i++) {
        if (process.env.PRE === "rename") await preRename();
        if (process.env.PRE === "ctxesc") { await rclick(".arc-today .arc-tab"); await sleep(400); for (const type of ["keyDown", "keyUp"]) await h.send("Input.dispatchKeyEvent", { type, key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }, S); await sleep(400); }
        if (process.env.KEY === "1") { // 键盘路径：点 ＋ 打开 → ↑（跳到最后一项 New Tab）→ Enter
            // RACE=1：打开的同一刻触发一次整屏重绘（后台开 / 关标签 → refresh），复现“打开期间被 renderAll 换掉”
            if (process.env.RACE === "1") void h.evalIn(o.sessionId!, `chrome.tabs.create({ url: "https://example.com/?race=${i}", active: false }).then(t => setTimeout(() => chrome.tabs.remove(t.id), 400))`).catch(() => {});
            await click('[data-test="plus-btn"]');
            let open = false; for (let k = 0; k < 30 && !open; k++) { open = !!(await rect('[data-test="plus-menu"]:not(.closing):not([hidden]) [data-test="plus-tab"]')); if (!open) await sleep(50); }
            const kd = async (key: string, code: string, vk: number) => { for (const type of ["keyDown", "keyUp"]) await h.send("Input.dispatchKeyEvent", { type, key, code, windowsVirtualKeyCode: vk }, S); };
            await kd("ArrowUp", "ArrowUp", 38);
            const sel = await ev(`document.querySelector('[data-test="plus-menu"]:not([hidden]) .arc-plus-item.sel')?.dataset.test ?? null`);
            await kd("Enter", "Enter", 13);
            let shown = false; const t0 = Date.now(); while (!shown && Date.now() - t0 < 3000) { const fp = freshPopup(); if (fp) seen.add(fp.targetId); shown = !!fp || !!(await overlay()); if (!shown) await sleep(50); }
            if (!open) console.log("  诊断:", JSON.stringify(await ev(`(() => { const m = document.querySelector('[data-test="plus-menu"]'), b = document.querySelector('[data-test="plus-btn"]'); return { menu: !!m, hidden: m?.hidden, closing: m?.classList.contains("closing"), opening: m?.dataset.opening ?? null, btnOpen: b?.classList.contains("open"), hasFocus: document.hasFocus(), log: (globalThis.__pd ?? []).slice(-3), at: (() => { const r = b?.getBoundingClientRect(); const e = r && document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return e ? e.tagName + "." + e.className : null; })(), ae: document.activeElement?.className }; })()`)));
            console.log(`#${i} KEY open=${open} sel=${sel} commandBar=${shown} (${Date.now() - t0}ms)`);
            if (shown) ok++;
            if (process.env.CLOSE !== "none") await h.evalIn(o.sessionId!, `chrome.windows.getAll().then(ws => Promise.all(ws.filter(w => w.type === "popup").map(w => chrome.windows.remove(w.id))))`).catch(() => {});
            await sleep(Number(process.env.GAP ?? 0));
            continue;
        }
        const ROW = process.env.ROW === "1"; // 1 = 点今日区的「+ New Tab」行（.arc-newtab），否则走 ＋ 菜单
        const c1 = ROW ? true : await click('[data-test="plus-btn"]');
        let item = ROW; for (let k = 0; k < 40 && !item; k++) { item = !!(await rect('[data-test="plus-menu"]:not(.closing):not([hidden]) [data-test="plus-tab"]')); if (!item) await sleep(100); }
        const c2 = item && await click(ROW ? '.arc-newtab' : '[data-test="plus-tab"]');
        let shown = false; const t0 = Date.now(); while (!shown && Date.now() - t0 < 5000) { const fp = freshPopup(); if (fp) seen.add(fp.targetId); shown = !!fp || !!(await overlay()); if (!shown) await sleep(100); }
        console.log(`#${i} plusBtn=${c1} menuItem=${item} clickTab=${!!c2} commandBar=${shown} (${Date.now() - t0}ms) popup=${!!popup()}`);
        if (shown) ok++;
        const p = popup();
        if (p && CLOSE === "type") { await sleep(600); await h.evalIn(p.sessionId!, `(() => { const i = document.querySelector(".arc-cmd-input"); i.value = "example.org/?n=${i}"; i.dispatchEvent(new Event("input", { bubbles: true })); return 1; })()`).catch(e => console.log("  type err", e.message)); await sleep(500); for (const type of ["keyDown", "keyUp"]) await h.send("Input.dispatchKeyEvent", { type, key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 }, p.sessionId!).catch(() => {}); }
        else if (p) { if (CLOSE === "esc") { for (const type of ["keyDown", "keyUp"]) await h.send("Input.dispatchKeyEvent", { type, key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }, p.sessionId!).catch(() => {}); } else await h.evalIn(o.sessionId!, `chrome.windows.getAll({ populate: true }).then(ws => Promise.all(ws.filter(w => w.type === "popup").map(w => chrome.windows.remove(w.id))))`); }
        await ev(`document.querySelector(".arc-cmd-input") && document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`).catch(() => {});
        await sleep(1200);
        console.log(`   after close: popup=${!!popup()} menuState=${await ev(`(() => { const m = document.querySelector('[data-test="plus-menu"]'); return m ? (m.hidden ? "hidden" : m.className) : "none"; })()`)} expanded=${await ev(`document.querySelector('[data-test="plus-btn"]')?.getAttribute("aria-expanded")`)}`);
    }
    console.log(ok === N ? `PASS ${ok}/${N}` : `FAIL ${ok}/${N}`); code = ok === N ? 0 : 1;
} catch (e) { console.log("ERROR", (e as Error).message); }
try { await (h as any).close?.(); } catch { } process.exit(code);

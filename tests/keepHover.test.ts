/* 52016：悬停态过一会儿自己消失（PanelShell 整屏重绘换掉指针下的行）回归测试。真扩展 + headless Chrome；无 Chrome 时跳过。 */
import { test, expect } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const CHROME = ["/usr/bin/google-chrome", "/usr/bin/chromium"].find(existsSync);
const ROOT = resolve(import.meta.dir, "..");
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

test.skipIf(!CHROME)("整屏重绘不换掉悬停中的行：标签标题每 1.5s 变化，悬停行 4s 后仍是同一节点且 :hover，标题已就地更新", async () => {
    const outRel = `tmp/kh-dist-${process.pid}`, out = join(ROOT, outRel), prof = mkdtempSync(join(tmpdir(), "kh-prof-"));
    expect(Bun.spawnSync(["bun", "run", "build.ts"], { cwd: ROOT, env: { ...process.env, ARC_OUT: outRel } }).exitCode).toBe(0);
    const port = 9400 + Math.floor(Math.random() * 400);
    const ch = Bun.spawn([CHROME!, "--headless=new", "--no-sandbox", "--disable-gpu", `--user-data-dir=${prof}`, `--remote-debugging-port=${port}`, "--enable-unsafe-extension-debugging", "--window-size=360,700", "about:blank"], { stdout: "ignore", stderr: "ignore" });
    try {
        let ver: any;
        for (let i = 0; i < 60 && !ver; i++) { await sleep(250); try { ver = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); } catch { } }
        const bws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise(r => bws.onopen = r);
        const ext: string = await new Promise(r => { bws.onmessage = e => { const m = JSON.parse(String(e.data)); if (m.id === 1) r(m.result?.id ?? ""); }; bws.send(JSON.stringify({ id: 1, method: "Extensions.loadUnpacked", params: { path: out } })); });
        bws.close();
        expect(ext).not.toBe("");
        await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent("data:text/html,<script>setInterval(()=>document.title=Date.now(),1500)</script>")}`, { method: "PUT" });
        const tgt = await (await fetch(`http://127.0.0.1:${port}/json/new?chrome-extension://${ext}/sidepanel.html`, { method: "PUT" })).json() as any;
        const ws = new WebSocket(tgt.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
        let id = 0; const pend = new Map<number, (v: any) => void>();
        ws.onmessage = e => { const m = JSON.parse(String(e.data)); pend.get(m.id)?.(m); };
        const cdp = (method: string, params: object = {}) => new Promise<any>(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
        const ev = async (expr: string) => (await cdp("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
        const find = `[...document.querySelectorAll('.arc-tab')].find(x=>/^\\d+$/.test(x.textContent.trim()))`;
        for (let i = 0; i < 40 && !(await ev(`!!${find}`)); i++) await sleep(250);
        const p = await ev(`(()=>{const e=${find};window.__n=e;window.__t0=e.textContent.trim();const r=e.getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]})()`);
        await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: p[0], y: p[1] });
        await sleep(4000);
        const r = await ev(`({same:__n.isConnected&&document.contains(__n),hover:__n.matches(':hover'),updated:__n.textContent.trim()!==__t0})`);
        expect(r).toEqual({ same: true, hover: true, updated: true });
        // 52025 回归：悬停在 + 上时整屏重绘（新建标签触发），再用真实鼠标点 +，菜单必须打开（旧按钮不能配上指向游离新菜单的闭包）
        const click = async (sel: string) => { const q = await ev(`(()=>{const r=document.querySelector('${sel}').getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]})()`); await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: q[0], y: q[1] }); await cdp("Input.dispatchMouseEvent", { type: "mousePressed", x: q[0], y: q[1], button: "left", clickCount: 1 }); await cdp("Input.dispatchMouseEvent", { type: "mouseReleased", x: q[0], y: q[1], button: "left", clickCount: 1 }); };
        for (let k = 0; k < 2; k++) {
            await click("[data-test=plus-btn]"); await sleep(400);
            expect(await ev(`!document.querySelector("[data-test=plus-menu]").hidden`)).toBe(true);
            await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }); await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
            await sleep(200);
            await ev(`chrome.tabs.create({url:"about:blank",active:false}).then(()=>new Promise(r=>setTimeout(r,800)))`);
        }
        // 原报告路径：+ 菜单关闭动画（.closing 70ms）期间指针停在菜单项上、恰好整屏重绘 → 旧菜单被保留、按钮换成新的（闭包指向游离新菜单）
        await click("[data-test=plus-btn]"); await sleep(400); { const q = await ev(`(()=>{const r=document.querySelector("[data-test=plus-tab]").getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]})()`); await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: q[0], y: q[1] }); await sleep(100); }
        await ev(`(()=>{const m=document.querySelector("[data-test=plus-menu]");if(m.hidden)return 0;m.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}));return chrome.storage.local.get("data:spaces").then(s=>chrome.storage.local.set({"data:spaces":{...s["data:spaces"],__t:Date.now()}}))})()`); await sleep(800);
        for (let k = 0; k < 2; k++) { await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }); await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }); await sleep(300); }
        await click("[data-test=plus-btn]"); await sleep(400);
        expect(await ev(`(()=>{const m=document.querySelectorAll("[data-test=plus-menu]");return m.length===1&&!m[0].hidden&&m[0].querySelectorAll("[role=menuitem]").length>0})()`)).toBe(true);
        ws.close();
    } finally { ch.kill(); rmSync(out, { recursive: true, force: true }); rmSync(prof, { recursive: true, force: true }); }
}, 60000);

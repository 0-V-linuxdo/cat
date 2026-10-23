/* 52005：＋菜单行底色只在 :hover / :focus-visible。鼠标打开 → 静止无高亮行；↓ → 一行获得真焦点并 :focus-visible。
 * 真扩展（ARC_OUT 临时构建）+ headless Chrome + CDP 打开 sidepanel.html；没有 Chrome 时跳过。 */
import { test, expect } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const CHROME = ["/usr/bin/google-chrome", "/usr/bin/chromium"].find(existsSync);
const ROOT = resolve(import.meta.dir, "..");
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

test.skipIf(!CHROME)("＋菜单：鼠标打开静止无高亮；ArrowDown 后有一行 :focus-visible", async () => {
    const outRel = `tmp/pm-dist-${process.pid}`, out = join(ROOT, outRel), prof = mkdtempSync(join(tmpdir(), "pm-prof-"));
    expect(Bun.spawnSync(["bun", "run", "build.ts"], { cwd: ROOT, env: { ...process.env, ARC_OUT: outRel } }).exitCode).toBe(0);
    const port = 9400 + Math.floor(Math.random() * 400);
    const ch = Bun.spawn([CHROME!, "--headless=new", "--no-sandbox", "--disable-gpu", `--user-data-dir=${prof}`, `--remote-debugging-port=${port}`, "--enable-unsafe-extension-debugging", "--window-size=360,700", "about:blank"], { stdout: "ignore", stderr: "ignore" });
    try {
        let ver: any;
        for (let i = 0; i < 60 && !ver; i++) { await sleep(250); try { ver = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); } catch { } }
        const bws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise(r => bws.onopen = r);
        const ext: string = await new Promise(r => { bws.onmessage = e => { const m = JSON.parse(String(e.data)); if (m.id === 1) { if (!m.result?.id) console.log("LOADERR", JSON.stringify(m)); r(m.result?.id ?? ""); } }; bws.send(JSON.stringify({ id: 1, method: "Extensions.loadUnpacked", params: { path: out } })); });
        bws.close();
        expect(ext).not.toBe("");
        const tgt = await (await fetch(`http://127.0.0.1:${port}/json/new?chrome-extension://${ext}/sidepanel.html`, { method: "PUT" })).json() as any;
        const ws = new WebSocket(tgt.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
        let id = 0; const pend = new Map<number, (v: any) => void>();
        ws.onmessage = e => { const m = JSON.parse(String(e.data)); pend.get(m.id)?.(m); };
        const cdp = (method: string, params: object = {}) => new Promise<any>(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
        const ev = async (expr: string) => (await cdp("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
        for (let i = 0; i < 40 && !(await ev(`!!document.querySelector('[data-test=plus-btn]')`)); i++) await sleep(250);
        // 等布局稳定：按钮位置连续 3 次（间隔 100ms）不变、字体加载完成后才点击（避免样式/字体晚到导致点偏）
        await ev(`document.fonts ? document.fonts.ready.then(()=>1) : 1`);
        const rect = `(()=>{const r=document.querySelector('[data-test=plus-btn]').getBoundingClientRect();return [Math.round(r.x+r.width/2),Math.round(r.y+r.height/2),r.width>0&&r.height>0]})()`;
        let b: any = await ev(rect), same = 0;
        for (let i = 0; i < 50 && same < 3; i++) { await sleep(100); const n: any = await ev(rect); same = n[2] && n[0] === b[0] && n[1] === b[1] ? same + 1 : 0; b = n; }
        expect(same).toBe(3);
        for (const type of ["mousePressed", "mouseReleased"]) await cdp("Input.dispatchMouseEvent", { type, x: b[0], y: b[1], button: "left", clickCount: 1 });
        // 把鼠标移开菜单，看静止态
        await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: 5, y: 5 });
        await sleep(400);
        const rest = await ev(`(()=>{const m=document.querySelector('[data-test=plus-menu]');const rows=[...m.querySelectorAll('.arc-plus-item')];return {open:!m.hidden,sel:rows.filter(r=>r.classList.contains('sel')).length,fv:rows.filter(r=>r.matches(':focus-visible')).length,bg:rows.filter(r=>{const c=getComputedStyle(r).backgroundColor;return c!=='rgba(0, 0, 0, 0)'&&c!=='transparent'}).length}})()`);
        expect(rest).toEqual({ open: true, sel: 0, fv: 0, bg: 0 });
        await cdp("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "ArrowDown", code: "ArrowDown", windowsVirtualKeyCode: 40 });
        await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "ArrowDown", code: "ArrowDown", windowsVirtualKeyCode: 40 });
        await sleep(200);
        const kb = await ev(`(()=>{const rows=[...document.querySelectorAll('[data-test=plus-menu] .arc-plus-item')];return {fv:rows.filter(r=>r.matches(':focus-visible')).length,bg:rows.filter(r=>{const c=getComputedStyle(r).backgroundColor;return c!=='rgba(0, 0, 0, 0)'&&c!=='transparent'}).length}})()`);
        expect(kb).toEqual({ fv: 1, bg: 1 });
        ws.close();
    } finally { ch.kill(); rmSync(out, { recursive: true, force: true }); }
}, 60000);

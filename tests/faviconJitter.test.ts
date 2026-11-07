/* favicon-jitter：侧栏 tab 行 favicon「不停抖动」回归。
 * 根因：每个标签事件都整屏重绘 → 每行 favicon <img> 都是新节点（重新请求 / 重解码 / 坏图重走 error → 占位）；展开的文件夹每次重绘重播展开动画。
 * 纯逻辑部分直接跑；DOM 部分用 headless Chrome 加载真模块的 bundle（无 Chrome 时跳过）。 */
import { test, expect } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { tabsSig } from "../src/plugins/_core/tabState/sig";
import { folderOpening, _resetFolderAnim } from "../src/components/folderAnim";

const ROOT = resolve(import.meta.dir, "..");
const CHROME = ["/usr/bin/google-chrome", "/usr/bin/chromium"].find(existsSync);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const tab = (o: Partial<chrome.tabs.Tab> = {}): chrome.tabs.Tab => ({ id: 1, index: 0, windowId: 1, active: false, pinned: false, highlighted: false, incognito: false, url: "https://github.com/", title: "GitHub", favIconUrl: "https://github.githubassets.com/favicons/favicon.svg", status: "complete", width: 800, height: 600, ...o } as chrome.tabs.Tab);

test("tabsSig：favIconUrl 反复变同值 / width·height 抖动 → 签名不变（TabState 只刷新 ≤1 次）", () => {
    let refreshes = 0, last = "";
    const feed = (tabs: chrome.tabs.Tab[]) => { const s = tabsSig(tabs, 1); if (s !== last) { last = s; refreshes++; } };
    feed([tab(), tab({ id: 2, title: "B" })]);
    for (let i = 0; i < 50; i++) feed([tab({ width: 800 + (i % 3), height: 600 - (i % 5) }), tab({ id: 2, title: "B" })]); // 同值 favIconUrl 的 onUpdated 重复
    expect(refreshes).toBe(1);
});
test("tabsSig：真实变化仍然触发（标题 / favIconUrl / status / 新增标签）", () => {
    const base = tabsSig([tab()], 1);
    expect(tabsSig([tab({ title: "GitHub (3)" })], 1)).not.toBe(base);
    expect(tabsSig([tab({ favIconUrl: "https://x/y.png" })], 1)).not.toBe(base);
    expect(tabsSig([tab({ status: "loading" })], 1)).not.toBe(base);
    expect(tabsSig([tab(), tab({ id: 2 })], 1)).not.toBe(base);
    expect(tabsSig([tab()], 2)).not.toBe(base);
});
test("tabsSig：status loading↔complete 抖动 N 次 → 刷新次数 = 真实状态翻转数，不会多出来", () => {
    let refreshes = 0, last = "";
    const states = ["loading", "complete", "complete", "loading", "loading", "complete"];
    for (const st of states) { const s = tabsSig([tab({ status: st as chrome.tabs.TabStatus })], 1); if (s !== last) { last = s; refreshes++; } }
    expect(refreshes).toBe(4);
});
test("folderOpening：只在 折叠→展开 那次为 true，重绘 / 一直展开 / 首次渲染都不播", () => {
    _resetFolderAnim();
    expect([false, false, false].map(c => folderOpening("f1", c))).toEqual([false, false, false]); // 首次渲染就展开（打开侧栏 / 切 Space）
    expect(folderOpening("f1", true)).toBe(false);
    expect(folderOpening("f1", false)).toBe(true);
    expect([1, 2, 3, 4].map(() => folderOpening("f1", false))).toEqual([false, false, false, false]);
});
test("sidepanel.css：展开动画只挂在 .arc-folder-opening；.arc-fav 自身没有 animation / transition", () => {
    const css = readFileSync(join(ROOT, "static/sidepanel.css"), "utf8");
    expect(css).toContain('.arc-folder[data-collapsed="false"] > .arc-folder-body.arc-folder-opening { animation: arc-folder-open');
    expect(css).not.toMatch(/\.arc-folder\[data-collapsed="false"\] > \.arc-folder-body \{[^}]*animation/);
    for (const m of css.matchAll(/([^{}]*\.arc-fav(?![-\w])[^{}]*)\{([^}]*)\}/g)) expect(m[2]).not.toMatch(/animation|transition/);
});

test.skipIf(!CHROME)("headless Chrome：同 URL 重绘 30 次（标题变 / status 抖）img 节点不重建、src 变更 ≤1、展开动画不重播；坏图只请求一次", async () => {
    const built = await Bun.build({ entrypoints: [join(ROOT, "tests/fixtures/favjitter/entry.ts")], target: "browser", format: "iife" });
    expect(built.success).toBe(true);
    const js = await built.outputs[0].text();
    const css = readFileSync(join(ROOT, "static/sidepanel.css"), "utf8");
    const prof = mkdtempSync(join(tmpdir(), "fj-prof-")), port = 9800 + Math.floor(Math.random() * 400);
    const ch = Bun.spawn([CHROME!, "--headless=new", "--no-sandbox", "--disable-gpu", `--user-data-dir=${prof}`, `--remote-debugging-port=${port}`, "--window-size=360,700", "about:blank"], { stdout: "ignore", stderr: "ignore" });
    try {
        let tgt: any;
        for (let i = 0; i < 60 && !tgt; i++) { await sleep(250); try { tgt = (await (await fetch(`http://127.0.0.1:${port}/json`)).json() as any[]).find(t => t.type === "page"); } catch { } }
        const ws = new WebSocket(tgt.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
        let id = 0; const pend = new Map<number, (v: any) => void>();
        ws.onmessage = e => { const m = JSON.parse(String(e.data)); pend.get(m.id)?.(m); };
        const cdp = (method: string, params: object = {}) => new Promise<any>(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
        const ev = async (expr: string) => { const r = (await cdp("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result; if (r?.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 400)); return r?.result?.value; };
        await ev(js);
        await ev(`(()=>{const s=document.createElement('style');s.textContent=${JSON.stringify(css)};document.head.append(s);return 1})()`);
        // —— A. 同一 favIconUrl 重绘 30 次：img 节点不换、src 不变 ——
        const A = await ev(`(async()=>{
            const T=window.T, sleep=ms=>new Promise(r=>setTimeout(r,ms));
            const PNG="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
            const root=document.createElement('div');document.body.append(root);
            const render=(title,src)=>{ root.replaceChildren(...[0,1,2].map(k=>{const r=document.createElement('div');r.className='arc-tab arc-row';r.setAttribute('data-sel','tab:'+k);r.append(T.favNode(src+(k?'#'+k:''),'arc-fav'));const s=document.createElement('span');s.textContent=title+k;r.append(s);return r;})); T.reuseFavicons(root); };
            render('t',PNG); const first=[...root.querySelectorAll('img')]; await Promise.all(first.map(i=>i.decode().catch(()=>0))); await sleep(50);
            let srcMut=0,attrMut=0; const mo=new MutationObserver(l=>{for(const m of l){ if(m.type==='attributes'){attrMut++; if(m.attributeName==='src')srcMut++;} }}); mo.observe(root,{subtree:true,attributes:true,attributeFilter:['src','class','style']});
            let created=0; const orig=document.createElement.bind(document); document.createElement=(t,o)=>{ if(String(t).toLowerCase()==='img')created++; return orig(t,o); };
            for(let i=0;i<30;i++){ render('title'+(i%7)+' ('+i+') ',PNG); await sleep(8); }
            document.createElement=orig; await sleep(30); mo.disconnect();
            const now=[...root.querySelectorAll('img')];
            // 真换 URL 一次：只有该行换节点
            render('t',PNG.replace('AAAADUlEQVR42mP8','AAAADUlEQVR42mP9')); await sleep(30);
            const after=[...root.querySelectorAll('img')];
            return {same:now.length===3&&now.every((n,i)=>n===first[i]), srcMut, attrMut, createdPerRender:created/30, changedNodes:after.filter((n,i)=>n!==first[i]).length};
        })()`);
        expect(A.same).toBe(true);
        expect(A.srcMut).toBeLessThanOrEqual(1);
        expect(A.attrMut).toBe(0);
        expect(A.changedNodes).toBeGreaterThanOrEqual(1); // 真换 URL → 对应行换新节点（src 只在 URL 真变时才变）
        // —— B. 坏图：第一次 error 换占位并记住；之后重绘不再生成 <img>（不再请求），占位节点身份不变 ——
        const B = await ev(`(async()=>{
            const T=window.T, sleep=ms=>new Promise(r=>setTimeout(r,ms));
            const root=document.createElement('div');document.body.append(root);
            const bad='http://127.0.0.1:9/never-there.png';
            const render=()=>{ const r=document.createElement('div');r.className='arc-tab arc-row';r.setAttribute('data-sel','bad:1');r.append(T.favNode(bad,'arc-fav'));root.replaceChildren(r);T.reuseFavicons(root); };
            render(); for(let i=0;i<60&&!root.querySelector('svg');i++) await sleep(50);
            render(); const ph=root.querySelector('svg'); let imgs=0; /* 首次 swap 出的占位不在缓存里，先重绘一次让缓存收下占位 */ const orig=document.createElement.bind(document); document.createElement=(t,o)=>{ if(String(t).toLowerCase()==='img')imgs++; return orig(t,o); };
            for(let i=0;i<20;i++){ render(); await sleep(5); }
            document.createElement=orig;
            return {swapped:!!ph, imgsAfter:imgs, noImg:!root.querySelector('img'), sameSvg:root.querySelector('svg')===ph};
        })()`);
        expect(B).toEqual({ swapped: true, imgsAfter: 0, noImg: true, sameSvg: true });
        // —— C. 展开的文件夹：重绘 30 次不重播动画；折叠→展开那次播一次；对照：旧 CSS（无 .arc-folder-opening 门）每次重绘都重播 ——
        const C = await ev(`(async()=>{
            const T=window.T, sleep=ms=>new Promise(r=>setTimeout(r,ms));
            const root=document.createElement('div');document.body.append(root);
            const starts={n:0}; root.addEventListener('animationstart',e=>{ if(e.animationName==='arc-folder-open')starts.n++; });
            const render=(collapsed)=>{ const op=T.folderOpening('F',collapsed); const f=document.createElement('div');f.className='arc-folder';f.setAttribute('data-collapsed',String(collapsed));const hd=document.createElement('div');hd.className='arc-folder-head';f.append(hd); if(!collapsed){const b=document.createElement('div');b.className=op?'arc-folder-body arc-folder-opening':'arc-folder-body';b.textContent='row';f.append(b);} root.replaceChildren(f); };
            render(false); await sleep(30); starts.n=0;
            for(let i=0;i<30;i++){ render(false); await sleep(20); }
            const rerender=starts.n;
            render(true); await sleep(30); render(false); await sleep(250); const opened=starts.n-rerender;
            // 对照：旧规则
            const st=document.createElement('style');st.textContent='.arc-folder[data-collapsed="false"] > .arc-folder-body{animation:arc-folder-open .16s ease-out}.arc-folder[data-collapsed="false"] > .arc-folder-body.arc-folder-opening{animation:none}';document.head.append(st);
            const before=starts.n; for(let i=0;i<10;i++){ render(false); await sleep(30); } const oldRule=starts.n-before;
            return {rerender,opened,oldRule};
        })()`);
        expect(C.rerender).toBe(0);
        expect(C.opened).toBe(1);
        expect(C.oldRule).toBeGreaterThanOrEqual(3);
        ws.close();
    } finally { ch.kill(); rmSync(prof, { recursive: true, force: true }); }
}, 90000);

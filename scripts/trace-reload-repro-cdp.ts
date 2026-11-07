/* 有头复现脚本（⚠ 只写、未运行）：⌘R 重载中途「Cat 📌 ×」面板是原生的还是页内一闪？
 *
 * 做什么：连到「你自己已经开着的、带扩展的有头 Chrome」（--remote-debugging-port），
 *   ① 开追踪开关（storage.local debug:inpageTrace=true，只写这一个键），
 *   ② 在目标标签里等你先按 ⌃S 把页内侧边栏开着（脚本不能替你按：命令快捷键 CDP 合成不出来），
 *   ③ 模拟 ⌘R：先派发 meta+R 的 keydown（页面看到的就是 ⌘R，会触发预热手势），隔 RELOAD_DELAYS 里的每个毫秒数再 Page.reload，
 *   ④ 重载前后每 POLL_MS 轮询 Target.getTargets：记「原生侧边栏页（sidepanel.html，无 host=inpage）」和
 *      「页内 iframe（sidepanel.html?host=inpage）」各自出现 / 消失的时刻 → 同屏重叠区间 = 二者同时存在的区间，
 *   ⑤ 取 SW 的 __arcInpageTraceDump()（含内容脚本经端口转来的 cs:<tabId> 记录）写 JSON + 文本时间线。
 *
 * 用法（脚本不启动 Chrome，也不改设置，只读；需要你先手动：）
 *   a. 用 --remote-debugging-port=9222 起有头 Chrome，加载带本补丁的 dist，打开 chrome://extensions 开着扩展；
 *   b. 设置里「受限页前预热」选「窗口级」，页内侧边栏启用；
 *   c. bun run scripts/trace-reload-repro-cdp.ts            （环境变量：CDP_PORT=9222 TARGET_URL=https://example.com/ RELOAD_DELAYS=0,20,60,150 POLL_MS=15 OUT=/workspace/arc-acceptance）
 * 每个延迟跑一轮；每轮开始前会等你在标签里按 ⌃S 让页内开着（轮询 #arc-inpage-sidebar-host 出现，最长 120s）。
 *
 * ⚠ Target.getTargets 轮询只有毫秒级（受 POLL_MS 和 CDP 往返限制）、看的是「面板页面是否存在」而不是「像素上是否可见」；
 *   可见性以追踪里的 pushRec.show / iframe.visible / hostVisible 为准，二者对照看。⚠ 本脚本未在任何 Chrome 里跑过。 */
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";

const PORT = Number(process.env.CDP_PORT ?? 9222), URL_ = process.env.TARGET_URL ?? "https://example.com/";
const DELAYS = (process.env.RELOAD_DELAYS ?? "0,20,60,150").split(",").map(Number), POLL = Number(process.env.POLL_MS ?? 15);
const OUT = process.env.OUT ?? "/workspace/arc-acceptance", HOST_ID = "arc-inpage-sidebar-host", TRACE_KEY = "debug:inpageTrace";
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const connect = async () => {
    const v = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json() as { webSocketDebuggerUrl: string };
    const ws = new WebSocket(v.webSocketDebuggerUrl); await new Promise((r, j) => { ws.onopen = () => r(0); ws.onerror = () => j(new Error("CDP 连不上")); });
    let n = 0; const pend = new Map<number, (m: any) => void>();
    ws.onmessage = ev => { const m = JSON.parse(String(ev.data)); if (m.id && pend.has(m.id)) { pend.get(m.id)!(m); pend.delete(m.id); } };
    const send = (method: string, params: object = {}, sessionId?: string) => new Promise<any>((res, rej) => {
        const id = ++n; pend.set(id, m => m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result)); ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
    return { ws, send };
};

const main = async () => {
    const { ws, send } = await connect();
    const { targetInfos } = await send("Target.getTargets");
    const swT = targetInfos.find((t: any) => t.type === "service_worker" && /chrome-extension:\/\/[a-p]{32}\//.test(t.url));
    if (!swT) throw new Error("没找到扩展 Service Worker 目标（先唤醒一下扩展：点一下图标或开 chrome://extensions）");
    const extId = /chrome-extension:\/\/([a-p]{32})\//.exec(swT.url)![1]!;
    const sw = (await send("Target.attachToTarget", { targetId: swT.targetId, flatten: true })).sessionId as string;
    const swEval = async (expr: string) => (await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }, sw)).result?.value;
    await swEval(`chrome.storage.local.set({ ${JSON.stringify(TRACE_KEY)}: true })`); await sleep(500);
    console.log(`扩展 ${extId}；追踪开关已打开（只写了 ${TRACE_KEY}；做完请自己关：chrome.storage.local.remove("${TRACE_KEY}")）`);
    mkdirSync(OUT, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-"), summary: unknown[] = [];

    for (const delay of DELAYS) {
        const tg = await send("Target.createTarget", { url: URL_ }); const targetId = tg.targetId as string;
        const page = (await send("Target.attachToTarget", { targetId, flatten: true })).sessionId as string;
        const pe = async (expr: string) => (await send("Runtime.evaluate", { expression: expr, returnByValue: true }, page)).result?.value;
        await send("Page.enable", {}, page); await sleep(1500);
        await swEval(`globalThis.__arcInpageTraceClear?.()`);
        console.log(`\n=== 延迟 ${delay}ms：请在新开的标签里按 ⌃S 让页内侧边栏开着（等 120s）…`);
        let up = false; for (let i = 0; i < 240 && !up; i++) { up = !!(await pe(`(() => { const h = document.getElementById("${HOST_ID}"); return !!h && h.getBoundingClientRect().width > 20; })()`)); if (!up) await sleep(500); }
        if (!up) { console.log("  ⚠ 120s 内页内没开着，跳过这一轮"); await send("Target.closeTarget", { targetId }); continue; }
        await sleep(800);
        // 轮询线程：记录面板类目标的存在区间
        const t0 = performance.now(), seen: { at: number; native: number; inpage: number }[] = []; let stop = false;
        const poller = (async () => {
            while (!stop) {
                const { targetInfos: ti } = await send("Target.getTargets");
                const panels = ti.filter((t: any) => t.url.startsWith(`chrome-extension://${extId}/sidepanel.html`));
                seen.push({ at: Math.round(performance.now() - t0), native: panels.filter((t: any) => !/host=inpage/.test(t.url)).length, inpage: panels.filter((t: any) => /host=inpage/.test(t.url)).length });
                await sleep(POLL);
            }
        })();
        await sleep(300);
        const tKey = Math.round(performance.now() - t0);
        // ⌘R：keydown（页面里的预热手势）→ 延迟 → 重载（真实 ⌘R 二者间隔是毫秒级，所以扫一组延迟）
        await send("Input.dispatchKeyEvent", { type: "rawKeyDown", modifiers: 4, key: "r", code: "KeyR", windowsVirtualKeyCode: 82, nativeVirtualKeyCode: 82 }, page);
        await send("Input.dispatchKeyEvent", { type: "keyUp", modifiers: 4, key: "r", code: "KeyR", windowsVirtualKeyCode: 82, nativeVirtualKeyCode: 82 }, page);
        await sleep(delay); const tReload = Math.round(performance.now() - t0); await send("Page.reload", {}, page);
        await sleep(4000); stop = true; await poller;
        const log = await swEval(`JSON.stringify(globalThis.__arcInpageTraceDump?.() ?? null)`); const recs = log ? JSON.parse(log) : [];
        const both = seen.filter(s => s.native > 0 && s.inpage > 0), natives = seen.filter(s => s.native > 0);
        const row = { delay, tKey, tReload, samples: seen.length, nativeSeenMs: natives.length ? [natives[0]!.at, natives.at(-1)!.at] : null, overlapMs: both.length ? [both[0]!.at, both.at(-1)!.at] : null, traceRecords: recs.length };
        summary.push(row); console.log("  ", JSON.stringify(row));
        const base = join(OUT, `trace-reload-${stamp}-d${delay}`);
        writeFileSync(`${base}.json`, JSON.stringify({ row, seen, recs }, null, 1));
        writeFileSync(`${base}.txt`, recs.map((r: any) => `${String(r.t).padStart(6)}  ${String(r.src).padEnd(10)} ${r.ev.padEnd(22)} ${JSON.stringify(r.d)}`).join("\n"));
        await send("Target.closeTarget", { targetId });
    }
    writeFileSync(join(OUT, `trace-reload-${stamp}-summary.json`), JSON.stringify(summary, null, 1));
    console.log(`\n输出在 ${OUT}/trace-reload-${stamp}-*；overlapMs 非空 = 该轮里原生面板页和页内 iframe 同时存在过（⚠ 页面存在 ≠ 像素可见，结合 .txt 里 pushRec.show / iframe.visible 判断）`);
    ws.close(); process.exit(0);
};
main().catch(e => { console.error(e); process.exit(1); });

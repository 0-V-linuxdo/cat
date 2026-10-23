/* 在 CDP Chrome 中打开 selftest.html，等完成后打印结果（需先 bun run build:selftest 并加载 dist/） */
const PORT = process.env.CDP_PORT ?? "9333";
const extId = process.env.EXT_ID!;
const t = await (await fetch(`http://localhost:${PORT}/json/new?chrome-extension://${extId}/selftest.html`, { method: "PUT" })).json();
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener("open", r, { once: true }));
let id = 0; const pend = new Map<number, (v: any) => void>();
// 浏览器原生打印的错误（如 “Unchecked runtime.lastError: Could not establish connection”）不经过 console.error 钩子，用 CDP Log / Runtime 收集
const LAST_ERR = /Unchecked runtime\.lastError|Could not establish connection|Receiving end does not exist/;
const nativeErrs: string[] = [];
ws.addEventListener("message", e => {
    const m = JSON.parse(String(e.data)); pend.get(m.id)?.(m);
    const text = m.method === "Log.entryAdded" ? m.params.entry.text : m.method === "Runtime.consoleAPICalled" ? m.params.args.map((a: any) => a.value ?? a.description ?? "").join(" ") : m.method === "Runtime.exceptionThrown" ? m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text : "";
    if (text && LAST_ERR.test(text)) nativeErrs.push(String(text).slice(0, 200));
});
// 每次 CDP 调用 10s 超时：页面卡死时不会让整个脚本挂住
const withTimeout = <T,>(p: Promise<T>, ms = 10_000) => Promise.race([p, new Promise<T>(r => setTimeout(() => r(undefined as T), ms))]);
const ev0 = (expression: string) => new Promise<any>(r => { const i = ++id; pend.set(i, m => r(m.result?.result?.value)); ws.send(JSON.stringify({ id: i, method: "Runtime.evaluate", params: { expression, returnByValue: true } })); });
const ev = (expression: string) => withTimeout(ev0(expression));
const call = (method: string, params: object = {}) => new Promise<any>(r => { const i = ++id; pend.set(i, m => r(m.result)); ws.send(JSON.stringify({ id: i, method, params })); });
await call("Log.enable"); await call("Runtime.enable");
const SHOTS = process.env.SHOT_DIR ?? "/workspace/arc-acceptance";
const { mkdirSync, writeFileSync } = await import("fs");
mkdirSync(SHOTS, { recursive: true });
const t0 = Date.now();
let finished = false;
// 看门狗：结果数 200s 没变（一项卡死且单项超时也没生效，例如页面主线程卡住）→ 停下并报告卡在哪一项之后
let lastN = -1, lastChange = Date.now(), stalled = "";
while (Date.now() - t0 < 1_000_000) {
    await new Promise(r => setTimeout(r, 150));
    const want = await ev("globalThis.__shot");
    if (want) {
        const shot = await call("Page.captureScreenshot", { format: "png" });
        const file = `${SHOTS}/selftest-${want}.png`;
        writeFileSync(file, Buffer.from(shot.data, "base64"));
        console.log("SHOT", file);
        await ev("globalThis.__shot = null");
    }
    if (String(await ev("document.title")).includes("完成")) { finished = true; break; }
    const n = Number(await ev("globalThis.__results?.length ?? 0")) || 0;
    if (n !== lastN) { lastN = n; lastChange = Date.now(); }
    else if (Date.now() - lastChange > 200_000) { stalled = String(await ev("globalThis.__results?.at(-1)?.name ?? '（开头）'")); break; }
}
const rows = await ev("globalThis.__results") as { name: string; status: string; detail: string }[];
for (const r of rows ?? []) console.log(r.status === "pass" ? "PASS" : r.status === "fail" ? "FAIL" : "SKIP", r.name, "|", (r.status === "fail" ? r.detail.slice(0, 900) : r.detail.slice(0, 220)));
if (stalled) console.log("FAIL", "自测卡住 200s（页面无响应）", "|", `卡在这一项之后：${stalled}`);
if (!finished) console.log("FAIL", "自测没有跑完（超时）：后面的测试没有执行，结果不完整", "|", `已完成 ${rows?.length ?? 0} 个`);
console.log(nativeErrs.length ? "FAIL" : "PASS", "控制台没有 “Could not establish connection / Unchecked runtime.lastError”（CDP 捕获）", "|", nativeErrs.length ? `${nativeErrs.length} 条：${nativeErrs.slice(0, 3).join(" ‖ ")}` : "无");
console.log(await ev(`document.getElementById("sum").textContent`), nativeErrs.length ? "· 另有 1 失败（控制台）" : "· 控制台检查通过");
process.exit(0);
export {};

/* 自测：在无头 Chrome 里加载 dist/，读 chrome://extensions 的 developerPrivate 信息；有任何清单警告 / 错误就失败 */
const PORT = process.env.CDP_PORT ?? "9334";
const v = await (await fetch(`http://localhost:${PORT}/json/version`)).json();
let n = 0; const pend = new Map<number, (r: any) => void>();
const ws = new WebSocket(v.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
ws.onmessage = e => { const m = JSON.parse(String(e.data)); pend.get(m.id)?.(m); };
const send = (method: string, params: object = {}, sessionId?: string) => new Promise<any>(r => { const id = ++n; pend.set(id, r); ws.send(JSON.stringify({ id, method, params, sessionId })); });
const ld = await send("Extensions.loadUnpacked", { path: process.env.DIST ?? new URL("../dist", import.meta.url).pathname });
if (!ld.result) { console.log("FAIL load", JSON.stringify(ld.error)); process.exit(1); }
const id = ld.result.id;
const { result: { targetId } } = await send("Target.createTarget", { url: "chrome://extensions" });
const { result: { sessionId } } = await send("Target.attachToTarget", { targetId, flatten: true });
await new Promise(r => setTimeout(r, 1500));
// 开发者模式下重新加载，Chrome 才收集清单警告（errorCollection）
await send("Runtime.evaluate", { expression: `new Promise(r => chrome.developerPrivate.updateProfileConfiguration({ inDeveloperMode: true }, () => chrome.developerPrivate.updateExtensionConfiguration({ extensionId: ${JSON.stringify(id)}, errorCollection: true }, () => chrome.developerPrivate.reload(${JSON.stringify(id)}, { failQuietly: true }, () => r(1)))))`, awaitPromise: true }, sessionId);
await new Promise(r => setTimeout(r, 2000));
const ev = await send("Runtime.evaluate", { expression: `new Promise(r => chrome.developerPrivate.getExtensionsInfo({ includeDisabled: true, includeTerminated: true }, l => { const x = l.find(e => e.id === ${JSON.stringify(id)}); r(JSON.stringify({ found: !!x, keys: x ? Object.keys(x).filter(k => /arn|rror/.test(k)) : [], raw: x ? { iw: x.installWarnings, me: x.manifestErrors } : null, install: x?.installWarnings ?? [], rw: (x?.runtimeWarnings ?? []), manifest: (x?.manifestErrors ?? []).map(e => e.message), runtime: (x?.runtimeErrors ?? []).map(e => e.message) })); }))`, awaitPromise: true, returnByValue: true }, sessionId);
if (process.env.MW_DEBUG) console.log("raw", ev.result?.result?.value);
const info = JSON.parse(ev.result?.result?.value ?? '{"install":["no info"],"manifest":[],"runtime":[]}');
// 协调者决定保留 debugger 为可选权限：这一条已知警告单独列出（ALLOWED），其余任何警告都失败
const ALLOWED: RegExp[] = []; // 不允许任何已知警告
const known = [...info.install, ...info.manifest].filter((w: string) => ALLOWED.some(r => r.test(w)));
if (known.length) console.log(`已知（协调者决定）：${JSON.stringify(known)}`);
const all = [...info.install, ...info.manifest].filter((w: string) => !ALLOWED.some(r => r.test(w)));
console.log(all.length ? `FAIL 清单警告：${JSON.stringify(all)}` : `PASS 清单无警告（运行期错误 ${info.runtime.length}）${info.runtime.length ? JSON.stringify(info.runtime) : ""}`);
process.exit(all.length ? 1 : 0);

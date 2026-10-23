/* Chrome 137+ 品牌版忽略 --load-extension；用 CDP Extensions.loadUnpacked 加载 dist/（需 --enable-unsafe-extension-debugging） */
const PORT = process.env.CDP_PORT ?? "9333";
const v = await (await fetch(`http://localhost:${PORT}/json/version`)).json();
const ws = new WebSocket(v.webSocketDebuggerUrl);
ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: "Extensions.loadUnpacked", params: { path: process.env.DIST ?? new URL("../dist", import.meta.url).pathname } }));
ws.onmessage = e => { const m = JSON.parse(String(e.data)); console.log(m.result?.id ?? JSON.stringify(m.error)); process.exit(m.result ? 0 : 1); };
export {};

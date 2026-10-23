/* 自检用：额外加载 tests/fixtures/ext-* 测试扩展（站点控制 · 扩展网格 / 弹窗探测） */
import { readdirSync } from "fs";
const PORT = process.env.CDP_PORT ?? "9333";
const v = await (await fetch(`http://localhost:${PORT}/json/version`)).json();
const ws = new WebSocket(v.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener("open", r, { once: true }));
const dir = new URL("../tests/fixtures/", import.meta.url).pathname;
let id = 0;
for (const d of readdirSync(dir).filter(n => n.startsWith("ext-"))) {
    const my = ++id;
    await new Promise<void>(r => { const on = (e: MessageEvent) => { if (JSON.parse(String(e.data)).id === my) { ws.removeEventListener("message", on); r(); } }; ws.addEventListener("message", on); ws.send(JSON.stringify({ id: my, method: "Extensions.loadUnpacked", params: { path: dir + d } })); });
}
console.log(`fixtures ${id}`);
process.exit(0);

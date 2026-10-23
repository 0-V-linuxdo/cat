import { LOCATE_SRC } from "../src/selftest/locate";
/* 冒烟测试：连接已用 --load-extension 启动的 Chrome（--remote-debugging-port），检查 SW 与侧边栏页面 */
const PORT = process.env.CDP_PORT ?? "9333";
const list = async () => (await (await fetch(`http://localhost:${PORT}/json/list`)).json()) as { type: string; url: string; webSocketDebuggerUrl: string }[];
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function session(wsUrl: string) {
    const ws = new WebSocket(wsUrl);
    await new Promise(r => ws.addEventListener("open", r, { once: true }));
    let id = 0;
    const pending = new Map<number, (v: any) => void>();
    const logs: string[] = [];
    ws.addEventListener("message", e => {
        const m = JSON.parse(String(e.data));
        if (m.id && pending.has(m.id)) { pending.get(m.id)!(m); pending.delete(m.id); }
        if (m.method === "Runtime.exceptionThrown") logs.push("EXCEPTION " + JSON.stringify(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text));
        if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") logs.push("console.error " + m.params.args.map((a: any) => a.value ?? a.description).join(" "));
    });
    const send = (method: string, params: object = {}) => new Promise<any>(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
    const evaluate = async (expression: string) => {
        expression = `${LOCATE_SRC}\n${expression}`; // 统一定位助手 __hx
        const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
        if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception?.description));
        return r.result?.result?.value;
    };
    await send("Runtime.enable");
    return { evaluate, logs, close: () => ws.close() };
}

// SW 空闲时会停止并从目标列表消失：先打开一个扩展页面唤醒它（侧边栏页面会 runtime.connect）
const extId = process.env.EXT_ID!;
if (!extId) throw new Error("需要 EXT_ID 环境变量");
await fetch(`http://localhost:${PORT}/json/new?chrome-extension://${extId}/sidepanel.html`, { method: "PUT" });
let sw: Awaited<ReturnType<typeof list>>[number] | undefined;
for (let i = 0; i < 20 && !sw; i++) { await sleep(300); sw = (await list()).find(t => t.type === "service_worker" && t.url.startsWith(`chrome-extension://${extId}/`)); }
if (!sw) throw new Error("没有找到扩展 service worker");
console.log("扩展 ID:", extId);
const bg = await session(sw.webSocketDebuggerUrl);
const bgInfo = await bg.evaluate(`(() => { const a = globalThis.ArcSidebar; return { ctx: a.context, started: Object.values(a.plugins).filter(p => p.started).map(p => p.name), stopped: Object.values(a.plugins).filter(p => !p.started).map(p => p.name) }; })()`);
console.log("background:", JSON.stringify(bgInfo));

// 打开几个网页 + 侧边栏页面（作为普通标签打开以便检查）
await bg.evaluate(`Promise.all(["https://example.com/?utm_source=x","https://example.org/"].map(url => chrome.tabs.create({ url, active: false })))`);
await sleep(2500);
const panelT = (await list()).find(t => t.type === "page" && t.url.endsWith("sidepanel.html"))!;
const panel = await session(panelT.webSocketDebuggerUrl);
const q = (js: string) => panel.evaluate(js);
const info = await q(`({
  ctx: ArcSidebar.context,
  started: Object.values(ArcSidebar.plugins).filter(p => p.started).length,
  slots: [...document.querySelectorAll(".arc-slot")].map(s => s.dataset.slot + ":" + s.querySelectorAll(".arc-part").length),
  today: [...document.querySelectorAll(".arc-today .arc-tab-title")].map(e => e.textContent),
  space: document.querySelector(".arc-space-title")?.textContent,
  bottomButtons: document.querySelectorAll(".arc-slot-bottom button").length,
})`);
console.log("panel:", JSON.stringify(info));

// 命令栏
await q(`document.querySelector(".arc-newtab").click()`);
await sleep(300);
await q(`(() => { const i = document.querySelector(".arc-cmd-input"); i.value = "space"; i.dispatchEvent(new Event("input")); })()`);
await sleep(500);
console.log("命令栏结果:", JSON.stringify(await q(`[...document.querySelectorAll(".arc-cmd-results .arc-tab-title")].slice(0,5).map(e => e.textContent)`)));
await q(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))`);

// 新建 Space（通过 RPC）、固定一个 Today 标签、收藏一个标签
await q(`chrome.runtime.sendMessage({ type: "arc-sidebar:rpc", method: "spaces:create", args: ["Work", "💼"] })`);
await sleep(800);
console.log("新 Space 后标题:", await q(`document.querySelector(".arc-space-title")?.textContent`), "| 底栏 Spaces:", await q(`document.querySelectorAll(".arc-space-dot").length`));
const groups = await bg.evaluate(`chrome.tabGroups.query({}).then(g => g.map(x => x.title + (x.collapsed ? "(折叠)" : "")))`);
console.log("标签组:", JSON.stringify(groups));
await q(`chrome.runtime.sendMessage({ type: "arc-sidebar:rpc", method: "spaces:switch", args: ["default"] })`);
await sleep(800);
const pinRes = await q(`(async () => {
  const tabs = await chrome.tabs.query({ url: "https://example.org/*" });
  const ev = new MouseEvent("contextmenu", { bubbles: true, clientX: 10, clientY: 10 });
  const row = [...document.querySelectorAll(".arc-today .arc-tab")].find(r => __hx.tipOf(r).startsWith("https://example.org"));
  if (!row) return "no row";
  row.dispatchEvent(ev);
  const items = [...document.querySelectorAll(".arc-menu-item")].map(b => b.textContent);
  [...document.querySelectorAll(".arc-menu-item")].find(b => b.textContent === "固定到当前 Space").click();
  await new Promise(r => setTimeout(r, 600));
  return { items, pinned: [...document.querySelectorAll(".arc-pinned .arc-tab-title")].map(e => e.textContent) };
})()`);
console.log("右键 + 固定:", JSON.stringify(pinRes));

// ---------- Undo：关闭标签后在侧边栏按 Ctrl/⌘+Z 恢复 ----------
const mod = process.platform === "darwin" ? "metaKey" : "ctrlKey";
await bg.evaluate(`chrome.tabs.create({ url: "https://example.net/undo-me", active: false })`);
await sleep(1500);
await bg.evaluate(`chrome.tabs.query({ url: "https://example.net/undo-me" }).then(([t]) => chrome.tabs.remove(t.id))`);
await sleep(600);
const stack1 = await bg.evaluate(`chrome.storage.local.get("data:undo").then(r => (r["data:undo"]?.stack ?? []).map(e => e.label))`);
await q(`document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "z", code: "KeyZ", ${mod}: true, bubbles: true }))`);
await sleep(1500);
const reopened = await bg.evaluate(`chrome.tabs.query({ url: "https://example.net/undo-me" }).then(t => t.length)`);
console.log("Undo 关闭标签:", JSON.stringify({ stackBefore: stack1, reopened, toast: await q(`document.querySelector(".arc-toast")?.textContent ?? null`) }));

// ---------- MultiSelect：Ctrl/⌘ 单击、Shift 单击、批量固定 / 取消固定 / 撤销 / 关闭 ----------
await bg.evaluate(`Promise.all(["https://example.net/a", "https://example.net/b", "https://example.net/c"].map(url => chrome.tabs.create({ url, active: false })))`);
await sleep(2000);
const ms = await q(`(async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const row = s => [...document.querySelectorAll(".arc-tab[data-sel]")].find(r => __hx.tipOf(r).startsWith(s));
  const click = (el, init) => el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ...init }));
  const pinnedCount = () => document.querySelectorAll(".arc-pinned .arc-tab").length;
  const out = {};
  click(row("https://example.net/a"), { ${mod}: true });
  click(row("https://example.net/c"), { shiftKey: true });
  await wait(300);
  out.selectedAfterRange = document.querySelectorAll(".arc-tab.selected").length;
  out.bar = document.querySelector(".arc-multibar b")?.textContent;
  out.barButtons = [...document.querySelectorAll(".arc-multibar button")].map(b => b.textContent);
  const p0 = pinnedCount();
  [...document.querySelectorAll(".arc-multibar button")].find(b => b.textContent === "固定").click();
  await wait(800);
  out.pinnedAdded = pinnedCount() - p0;
  out.selectionCleared = document.querySelectorAll(".arc-tab.selected").length === 0;
  // 选中固定区里的两个新项并取消固定
  click(row("https://example.net/a"), { ${mod}: true });
  click(row("https://example.net/b"), { ${mod}: true });
  await wait(300);
  [...document.querySelectorAll(".arc-multibar button")].find(b => b.textContent === "取消固定").click();
  await wait(800);
  out.pinnedAfterUnpin = pinnedCount() - p0;
  document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "z", code: "KeyZ", ${mod}: true, bubbles: true }));
  await wait(1200);
  out.pinnedAfterUndo = pinnedCount() - p0;
  // 选中 Today 中一项 + 固定区一项，Delete 批量关闭
  const before = (await chrome.tabs.query({ url: "https://example.net/*" })).length;
  click(row("https://example.net/a"), { ${mod}: true });
  click(row("https://example.net/b"), { ${mod}: true });
  await wait(200);
  document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", code: "Delete", bubbles: true }));
  await wait(1000);
  out.closed = before - (await chrome.tabs.query({ url: "https://example.net/*" })).length;
  return out;
})()`);
console.log("MultiSelect:", JSON.stringify(ms));
const stack2 = await bg.evaluate(`chrome.storage.local.get("data:undo").then(r => (r["data:undo"]?.stack ?? []).map(e => e.label))`);
console.log("撤销栈:", JSON.stringify(stack2));

// 设置浮层：Void++ 式扁平插件列表
await q(`[...document.querySelectorAll("[data-tip],[title]")].find(e => __hx.tipOf(e).startsWith("设置 / 插件")).click()`);
await sleep(300);
console.log("设置中插件:", JSON.stringify(await q(`[...document.querySelectorAll(".arc-plugin")].map(p => p.dataset.name)`)));
const toggled = await q(`(async () => { document.querySelector('[data-setting="Views.Peek"]').click(); await new Promise(r => setTimeout(r, 400)); const s = await chrome.storage.local.get("ArcSidebarSettings"); return { panelStarted: ArcSidebar.plugins.Peek.started, saved: s.ArcSidebarSettings.plugins.Views }; })()`);
await sleep(500);
console.log("关闭 视图 › 速览：panel", JSON.stringify(toggled), "background started =", await bg.evaluate(`ArcSidebar.plugins.Peek.started`));
await q(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))`);

// 分屏
await bg.evaluate(`chrome.tabs.query({ url: "https://example.com/*" }).then(([t]) => chrome.tabs.update(t.id, { active: true }))`);
await sleep(300);
await bg.evaluate(`(async () => { const [t] = await chrome.tabs.query({ url: "https://example.com/*" }); await chrome.tabs.update(t.id, { url: chrome.runtime.getURL("split.html") + "?u=" + encodeURIComponent("https://example.com/") + "&u=" + encodeURIComponent("https://example.org/") + "&dir=row" }); })()`);
await sleep(2500);
const splitT = (await list()).find(t => t.type === "page" && t.url.includes("split.html"));
if (splitT) {
    const sp = await session(splitT.webSocketDebuggerUrl);
    console.log("分屏:", JSON.stringify(await sp.evaluate(`({ title: document.title, panes: document.querySelectorAll(".split-pane").length, ctx: ArcSidebar.context })`)));
    const frames = (await list()).filter(t => t.type === "iframe").map(t => t.url);
    console.log("分屏 iframe 目标:", JSON.stringify(frames));
    console.log("分屏页错误:", JSON.stringify(sp.logs));
    sp.close();
}
const dnr = await bg.evaluate(`chrome.declarativeNetRequest.getSessionRules().then(r => r.map(x => x.id))`);
console.log("DNR 会话规则:", JSON.stringify(dnr));
console.log("background 错误:", JSON.stringify(bg.logs));
console.log("panel 错误:", JSON.stringify(panel.logs));
bg.close(); panel.close();
process.exit(0);
export {};

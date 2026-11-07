/* 隔离的 CDP 测试浏览器：随机空闲端口 + 全新临时 user-data-dir，退出必杀；
 * 浏览器级 Target.setAutoAttach（flatten）自动附着所有扩展上下文（SW / 侧边栏 / 离屏 / 选项 / 自测页），
 * 收集 未捕获异常 / 未处理 rejection / console.error / Log error；另读 chrome://extensions 的错误列表（developerPrivate）。 */
import { spawn, type ChildProcess } from "child_process";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createServer } from "net";
import { ClockWatch, describeEvent, raceWithClockTimeout } from "../../src/selftest/clockWatch";

export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
export class StepTimeout extends Error {}
/** rel45：单调时钟（Date.now 在 VM 快照 / 恢复后会跳；超时、等待截止、卡死判定都用它） */
export const mono = () => performance.now();
/** rel45：时钟跳变 / 进程冻结检测（每 250ms 采样 wall 与 mono；超时回调里还会补采）。unref：不拖住进程退出 */
export const clock = new ClockWatch({ wall: () => Date.now(), mono });
clock.onEvent = e => console.log(`[时钟跳变] 检测到${describeEvent(e)}（单调时钟 ${Math.round(e.at)}ms 处）`);
{ const t = setInterval(() => { clock.sample(); }, clock.interval) as any; t.unref?.(); }
/** 超时判定走单调时钟差并扣掉检测到的冻结时间：冻结 / 恢复后到期的定时器不再直接判超时，而是顺延剩余有效时间（最多 2 次，写日志）；真超时照常 reject */
export function withTimeout<T>(name: string, ms: number, p: Promise<T>): Promise<T> {
    return raceWithClockTimeout(p, {
        ms, watch: clock, maxExt: 2,
        mkError: i => new StepTimeout(`步骤超时（${ms}ms）：${name}${i.events.length ? `（期间检测到 ${i.events.length} 次时钟跳变 / 冻结：${i.events.slice(-2).map(describeEvent).join("；")}；顺延 ${i.extensions} 次后仍超时，有效耗时 ${Math.round(i.effective)}ms）` : ""}`),
        onExtend: i => console.log(`[时钟跳变] 「${name}」超时定时器触发时检测到${i.events.slice(-1).map(describeEvent).join("")}：有效耗时仅 ${Math.round(i.effective)}ms < ${ms}ms，不判超时，顺延 ${i.remaining}ms（第 ${i.extension}/2 次）`),
    });
}
export const freePort = () => new Promise<number>((res, rej) => { const s = createServer(); s.unref(); s.on("error", rej); s.listen(0, "127.0.0.1", () => { const p = (s.address() as any).port; s.close(() => res(p)); }); });

export interface CtxError { kind: string; ctx: string; url: string; text: string; at: number }
interface Target { targetId: string; type: string; url: string; sessionId?: string; alive: boolean }

export class Harness {
    proc?: ChildProcess; dir = ""; port = 0; ws!: WebSocket;
    private n = 0; private pend = new Map<number, (m: any) => void>();
    targets = new Map<string, Target>(); errors: CtxError[] = []; extId = "";
    probeMarker = "harness-probe-" + Math.random().toString(36).slice(2); probeOpen = false;
    private ignored = new Set<string>(); private attachedAt = new Map<string, number>();
    private listeners: ((m: any) => void)[] = [];
    log = (...a: unknown[]) => console.log(...a);

    async launch() {
        this.port = await freePort();
        this.dir = mkdtempSync(join(tmpdir(), "arc-harness-"));
        const bin = process.env.CHROME ?? "/usr/bin/google-chrome";
        const headless = process.env.HEADLESS === "1";
        const args = [`--remote-debugging-port=${this.port}`, `--user-data-dir=${this.dir}`, "--enable-unsafe-extension-debugging", "--no-first-run", "--no-default-browser-check",
            "--disable-features=DisableLoadExtensionCommandLineSwitch", "--no-sandbox", "--autoplay-policy=no-user-gesture-required", "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows", "--disable-features=IntensiveWakeUpThrottling,CalculateNativeWinOcclusion", "--disable-ipc-flooding-protection", "--disable-dev-shm-usage", "--window-size=1400,900", ...(headless ? ["--headless=new"] : []), "about:blank"];
        // 有界面（更接近 Helium 实机）：没有 DISPLAY 时用 xvfb-run 包一层
        const useX = !headless && !process.env.DISPLAY;
        this.proc = useX ? spawn("xvfb-run", ["-a", "-s", "-screen 0 1400x900x24", bin, ...args], { stdio: "ignore", detached: true })
            : spawn(bin, args, { stdio: "ignore", detached: true });
        const kill = () => this.close();
        process.once("exit", kill); for (const s of ["SIGINT", "SIGTERM"] as const) process.once(s, () => { kill(); process.exit(130); });
        let ver: any;
        await withTimeout("启动浏览器 / 等待 DevTools 端口", 30_000, (async () => { for (;;) { try { ver = await (await fetch(`http://127.0.0.1:${this.port}/json/version`)).json(); return; } catch { await sleep(200); } } })());
        this.ws = new WebSocket(ver.webSocketDebuggerUrl);
        await withTimeout("连接浏览器 WebSocket", 10_000, new Promise(r => this.ws.addEventListener("open", r, { once: true })));
        this.ws.addEventListener("message", e => this.onMsg(JSON.parse(String(e.data))));
        this.log(`浏览器：${ver.Browser} 端口 ${this.port} 目录 ${this.dir}${headless ? "（headless）" : "（有界面）"}`);
        await this.send("Target.setDiscoverTargets", { discover: true });
        await this.send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
    }
    close() {
        try { this.ws?.close(); } catch { }
        if (this.proc?.pid) { try { process.kill(-this.proc.pid, "SIGKILL"); } catch { } try { this.proc.kill("SIGKILL"); } catch { } }
        if (this.dir) { try { rmSync(this.dir, { recursive: true, force: true }); } catch { } this.dir = ""; }
    }
    send(method: string, params: object = {}, sessionId?: string, ms = 15_000): Promise<any> {
        const id = ++this.n;
        return withTimeout(`CDP ${method}`, ms, new Promise<any>((res, rej) => { this.pend.set(id, m => m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result)); this.ws.send(JSON.stringify({ id, method, params, sessionId })); })).finally(() => this.pend.delete(id));
    }
    on(f: (m: any) => void) { this.listeners.push(f); return () => { this.listeners = this.listeners.filter(x => x !== f); }; }
    private isExt(url: string) { return !!this.extId && url.startsWith(`chrome-extension://${this.extId}/`); }
    private ctxName(t?: Target) { if (!t) return "?"; const p = t.url.replace(/^chrome-extension:\/\/[^/]+\//, ""); return `${t.type}:${p.split("?")[0] || t.url}`; }
    private onMsg(m: any) {
        if (m.id) { this.pend.get(m.id)?.(m); return; }
        for (const f of this.listeners) f(m);
        const p = m.params ?? {};
        if (m.method === "Target.attachedToTarget") {
            const ti = p.targetInfo;
            // 同一目标被多处 auto-attach（浏览器级 + 页面会话递归）：只保留第一个会话，否则 Runtime.enable 会把旧异常重放一遍
            const prev = this.targets.get(ti.targetId);
            if (prev?.alive && prev.sessionId && prev.sessionId !== p.sessionId) { void this.send("Runtime.runIfWaitingForDebugger", {}, p.sessionId, 5000).catch(() => { }).then(() => this.send("Target.detachFromTarget", { sessionId: p.sessionId }).catch(() => { })); this.ignored.add(p.sessionId); return; }
            this.attachedAt.set(p.sessionId, Date.now() - 50);
            const t: Target = { targetId: ti.targetId, type: ti.type, url: ti.url, sessionId: p.sessionId, alive: true };
            this.targets.set(ti.targetId, t);
            const s = p.sessionId;
            void (async () => {
                try {
                    if (["page", "iframe", "service_worker", "worker", "shared_worker", "other"].includes(ti.type)) {
                        await this.send("Runtime.enable", {}, s, 5000).catch(() => { });
                        await this.send("Log.enable", {}, s, 5000).catch(() => { });
                        await this.send("Page.enable", {}, s, 5000).catch(() => { });
                        await this.send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, s, 5000).catch(() => { });
                    }
                } finally { if (p.waitingForDebugger) await this.send("Runtime.runIfWaitingForDebugger", {}, s, 5000).catch(() => { }); }
            })();
            return;
        }
        if (m.method === "Target.targetInfoChanged") { const t = this.targets.get(p.targetInfo.targetId); if (t) t.url = p.targetInfo.url; return; }
        if (m.method === "Target.detachedFromTarget" && this.ignored.has(p.sessionId)) return;
        if (m.method === "Target.targetDestroyed" || m.method === "Target.detachedFromTarget") { const t = this.targets.get(p.targetId ?? [...this.targets.values()].find(x => x.sessionId === p.sessionId)?.targetId); if (t) t.alive = false; return; }
        if (m.method === "Inspector.targetCrashed") { this.push("crash", m.sessionId, "目标崩溃"); return; }
        if (!m.sessionId || this.ignored.has(m.sessionId)) return;
        // Runtime.enable 会重放附着前的旧消息：按时间戳丢掉
        const ts = p.timestamp ?? p.entry?.timestamp; const at = this.attachedAt.get(m.sessionId) ?? 0;
        if (typeof ts === "number" && m.method !== "Runtime.consoleAPICalled" && ts < at) return;
        // 原生对话框（alert / confirm / prompt）会卡住页面主线程：记一条并自动关掉，免得后续 CDP 调用全部超时
        if (m.method === "Page.javascriptDialogOpening") { this.push("dialog", m.sessionId, `弹出了原生 ${p.type} 对话框：${p.message}`); void this.send("Page.handleJavaScriptDialog", { accept: false }, m.sessionId, 5000).catch(() => { }); return; }
        if (m.method === "Runtime.exceptionThrown") { const d = p.exceptionDetails; this.push(/promise/i.test(d.text ?? "") ? "unhandledrejection" : "exception", m.sessionId, `${d.text ?? ""} ${d.exception?.description ?? d.exception?.value ?? ""}`.trim(), d.url); }
        else if (m.method === "Runtime.consoleAPICalled" && (p.type === "error" || p.type === "assert")) this.push("console.error", m.sessionId, p.args.map((a: any) => a.value ?? a.description ?? a.unserializableValue ?? "").join(" "));
        else if (m.method === "Log.entryAdded" && p.entry.level === "error") this.push(`log.${p.entry.source}`, m.sessionId, p.entry.text, p.entry.url);
    }
    private push(kind: string, sessionId: string, text: string, url = "") {
        const t = [...this.targets.values()].find(x => x.sessionId === sessionId);
        if (!t || !this.isExt(t.url)) return;
        if (this.probeMarker && text.includes(this.probeMarker) && this.probeOpen) return; // 框架自检探针：只在自检窗口内计入 probeHits
 // 只算本扩展的上下文（网页自身的错误不算）
        if (/net::ERR_|Failed to load resource/.test(text) && !this.isExt(url)) return;
        this.errors.push({ kind, ctx: this.ctxName(t), url, text: text.slice(0, 1500), at: Date.now() });
    }
    extTargets() { return [...this.targets.values()].filter(t => t.alive && this.isExt(t.url)); }
    async evalIn(sessionId: string, expression: string, opts: { userGesture?: boolean; ms?: number } = {}) {
        const r = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: !!opts.userGesture }, sessionId, opts.ms ?? 15_000);
        if (r.exceptionDetails) throw new Error(`evaluate 失败：${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
        return r.result?.value;
    }
    async open(url: string, background = false) {
        const { targetId } = await this.send("Target.createTarget", { url, background });
        const t = await withTimeout(`附着 ${url}`, 10_000, (async () => { for (;;) { const t = this.targets.get(targetId); if (t?.sessionId) return t; await sleep(50); } })());
        await this.send("Page.enable", {}, t.sessionId).catch(() => { });
        return t;
    }
    async loadExtension(path: string) {
        const r = await this.send("Extensions.loadUnpacked", { path }, undefined, 30_000);
        this.extId = r.id; return r.id as string;
    }
    /* chrome://extensions 的错误列表（与 Helium 卡片上红色“错误”按钮同源） */
    private extPage?: Target;
    async enableErrorCollection() {
        this.extPage = await this.open("chrome://extensions", true); await sleep(1200);
        const id = JSON.stringify(this.extId);
        await this.evalIn(this.extPage.sessionId!, `new Promise(r => chrome.developerPrivate.updateProfileConfiguration({ inDeveloperMode: true }, () => chrome.developerPrivate.updateExtensionConfiguration({ extensionId: ${id}, errorCollection: true }, () => r(1))))`);
    }
    async clearExtensionErrors() {
        if (!this.extPage) return;
        await this.evalIn(this.extPage.sessionId!, `new Promise(r => chrome.developerPrivate.deleteExtensionErrors({ extensionId: ${JSON.stringify(this.extId)} }, () => r(1)))`).catch(() => { });
    }
    async extensionErrors(): Promise<{ type: string; ctx: string; msg: string; src: string; stack: string }[]> {
        if (!this.extPage) return [];
        const id = JSON.stringify(this.extId);
        const s = await this.evalIn(this.extPage.sessionId!, `new Promise(r => chrome.developerPrivate.getExtensionsInfo({ includeDisabled: true, includeTerminated: true }, l => { const x = l.find(e => e.id === ${id});
            const m = e => ({ type: e.type, ctx: (e.contextUrl || "").replace(/^chrome-extension:\\/\\/[^/]+\\//, ""), msg: e.message, src: (e.source || "").split("/").pop(), stack: (e.stackTrace ?? []).slice(0, 4).map(f => (f.functionName || "?") + "@" + f.url.split("/").pop() + ":" + f.lineNumber + ":" + f.columnNumber).join(" < ") });
            r(JSON.stringify([...(x?.runtimeErrors ?? []).map(m), ...(x?.manifestErrors ?? []).map(m), ...(x && x.state !== "ENABLED" ? [{ type: "STATE", msg: "扩展状态 " + x.state }] : [])])) }))`);
        return JSON.parse(s ?? "[]");
    }
}

/*
 * 命令注册表：命令栏（Command Bar）、快捷键、右键菜单都只认“命令”。
 * 每个命令属于某个上下文（background 或 panel），runCommand 会自动路由。
 * 对应 Void++ 的 ChatBarButtons / ContextMenus 这类“插件声明 → 核心挂载”的 API。
 */
import { getContext } from "@api/context";
import { flog } from "@api/FocusLog";
import { isParkedHost } from "@api/HostMode";
import { prettyCombo } from "@api/Keys";
import { Logger } from "@utils/Logger";
import { createRegistry } from "@api/registry";
import type { ExtContext } from "@utils/types";

export interface CommandDef {
    id: string;
    label: string;
    keywords?: string[];
    context: Extract<ExtContext, "background" | "panel">;
    /** 默认快捷键，如 "Alt+Shift+K"；可在 Shortcuts 插件设置里改 */
    defaultKey?: string;
    /** 不在命令栏中显示（仅供快捷键/内部调用） */
    hidden?: boolean;
    order?: number;
    run(arg?: unknown): unknown;
}

export interface RegisteredCommand extends CommandDef { plugin: string }

const CMD = "arc-sidebar:cmd";
const logger = new Logger("Commands");
export const commands = createRegistry<RegisteredCommand>();

/** 命令当前生效的快捷键（格式化后）；由 Shortcuts 插件提供解析（含用户改键） */
let keyResolver: (id: string) => string | undefined = id => { const k = commands.get(id)?.defaultKey; return k ? prettyCombo(k) : undefined; };
export const setKeyResolver = (f: typeof keyResolver) => { keyResolver = f; };
export const keyFor = (id: string) => commands.get(id) ? keyResolver(id) : undefined;

export function addCommand(plugin: string, def: CommandDef) { commands.set(def.id, { ...def, plugin }); }
export function removeCommand(id: string) { commands.delete(id); }

const REQ = "cmd:req";
const seen = new Map<string, Promise<unknown>>();
function runServed(msg: { id: string; arg?: unknown; nonce?: string }, via: string): Promise<unknown> | undefined {
    if (msg.nonce && seen.has(msg.nonce)) return seen.get(msg.nonce);
    const p = runOnce(msg, via);
    if (msg.nonce) { if (seen.size > 200) seen.clear(); seen.set(msg.nonce, p); }
    return p;
}
function runOnce(msg: { id: string; arg?: unknown }, via: string): Promise<unknown> {
    const cmd = commands.get(msg.id);
    flog(getContext() === "background" ? "bg" : "panel", `cmd recv ${msg.id} via ${via}${cmd ? "" : " (UNKNOWN)"}`);
    if (!cmd) return Promise.resolve(null);
    return Promise.resolve().then(() => cmd.run(msg.arg)).catch(e => { flog("bg", `cmd FAILED ${msg.id} ${String(e?.message ?? e)}`); logger.error(msg.id, e); return null; });
}

export async function runCommand(id: string, arg?: unknown): Promise<unknown> {
    const cmd = commands.get(id);
    if (!cmd) { logger.warn(`unknown/disabled command ${id}`); return; }
    if (cmd.context === getContext()) {
        try { return await cmd.run(arg); } catch (e) { logger.error(id, e); return; }
    }
    const nonce = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    flog("panel", `cmd send ${id} -> ${cmd.context}`);
    // 双通道：storage 变更会唤醒/送达休眠的 service worker；sendMessage 带回返回值。目标端按 nonce 去重。
    const viaStorage = cmd.context === "background" ? chrome.storage.session.set({ [REQ]: { id, arg, nonce, target: cmd.context } }).catch(e => flog("panel", `cmd storage FAILED ${String(e?.message ?? e)}`)) : Promise.resolve();
    const r = await chrome.runtime.sendMessage({ type: CMD, id, arg, nonce, target: cmd.context }).catch(e => { flog("panel", `cmd sendMessage FAILED ${id} ${String(e?.message ?? e)}`); return undefined; });
    await viaStorage;
    flog("panel", `cmd ack ${id} ${r === undefined ? "none" : "ok"}`);
    return r;
}

/** 只能在侧边栏里显示的命令（站点控制、主题选择器……）：从居中命令栏小窗（sidepanel.html?popup=…）运行时，转交给该窗口的侧边栏 */
export function sidebarOnly(id: string, run: () => unknown, currentWin: () => number | undefined) {
    return (arg?: unknown) => {
        const q = typeof location !== "undefined" ? new URLSearchParams(location.search) : null;
        if (q?.has("popup")) {
            // 命令栏弹窗：交给侧边栏执行，然后关掉自己（否则留下一个空白小窗）
            void chrome.runtime.sendMessage({ type: CMD, id, arg: { win: Number(q.get("win")) }, target: "panel" }).catch(() => undefined) /* 预期：没有接收端（侧栏未开 / 扩展重载，Receiving end does not exist），忽略 */
                .finally(() => setTimeout(() => window.close(), 50));
            return;
        }
        const win = (arg as { win?: number } | undefined)?.win;
        if (win != null && win !== currentWin()) return;
        return run();
    };
}

export function serveCommands() {
    flog(getContext() === "background" ? "bg" : "panel", "cmd serve start");
    const listener = (msg: any, _s: chrome.runtime.MessageSender, respond: (r: unknown) => void) => {
        if (msg?.type !== CMD || msg.target !== getContext()) return;
        if (isParkedHost()) return; // 补丁 tab-shake：停放的页内侧栏 iframe（后台标签留着备切回）不执行，由前台那一份响应
        const p = runServed(msg, "message");
        if (!p) { respond(null); return; }
        void p.then(r => respond(r ?? null));
        return true;
    };
    chrome.runtime.onMessage.addListener(listener);
    const onStore = (ch: Record<string, chrome.storage.StorageChange>, area: string) => {
        const v = ch[REQ]?.newValue as { id: string; arg?: unknown; nonce: string; target: string } | undefined;
        if (area === "session" && v && v.target === getContext()) void runServed(v, "storage");
    };
    if (getContext() === "background") chrome.storage.onChanged.addListener(onStore);
    return () => { chrome.runtime.onMessage.removeListener(listener); chrome.storage.onChanged.removeListener(onStore); };
}

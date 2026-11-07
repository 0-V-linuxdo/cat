/* 可选插件「Clean URLs」：复制链接（⇧⌘C / ⌥⇧⌘C / ⌃⇧⌘C、右键 Copy Link、Share）时去掉追踪参数。默认开启（enabledByDefault: true；用户设置页里显式开 / 关过的值优先，不被覆盖）。
 * 通过核心的 URL 变换管道（@api/UrlTransforms）生效。默认只用 Arc 的规则；超出 Arc 的规则在「扩展规则」开关里（默认关）。
 *
 * 快捷键 toast：三个快捷键是核心 tabActions 的 background 命令，直接调 applyUrlTransforms + copyText，不经过 copyUrlWithToast。
 * 为了在「确认写入剪贴板成功之后」才提示，本插件在 background 包装 tab.copyUrl / tab.copyMarkdown 两个命令的 run
 * （它们成功时返回复制的文本、失败时返回 false/undefined），只有返回成功且本次变换确有改动才提示。
 * tab.copyQuote 没有返回值，无法确认是否写入成功 → 不提示。
 * 提示位置：该窗口的侧边栏。侧边栏关着时 Arc 的提示显示在哪里源码未找到（toast-spec.md：复制链接 toast 的 location 源码未找到）→ 维持现状，不提示。
 * 需要核心提供（替换掉这里的命令包装）：copy 命令统一返回 { ok, text, changed, toastKey }，或广播事件 "urlCopied" { windowId, tabId, ok, changed, toastKey }。 */
import { safe } from "@api/ErrorLog";
import { currentWindow } from "@api/HostMode";
import { commands } from "@api/Commands";
import { tr } from "@api/i18n";
import { toast } from "@api/PanelShell";
import { registerUrlTransform, type UrlTransformResult } from "@api/UrlTransforms";
import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";

import "./i18n";
import { cleanUrlDetailed, parseList, TOAST_KEY, toTransformResult } from "./clean";
import { createCopyTracker } from "./confirm";

const settings = definePluginSettings({
    extended: { type: OptionType.BOOLEAN, description: "cleanUrls.extended", default: false },
    extraParams: { type: OptionType.STRING, description: "cleanUrls.extraParams", default: "" },
    exceptions: { type: OptionType.BOOLEAN, description: "cleanUrls.exceptions", default: false },
    skipHosts: { type: OptionType.STRING, description: "cleanUrls.skipHosts", default: "" },
});

export const TOAST_MSG = "cat-cleanUrls-toast";
/** 能确认成功的快捷键命令（成功时返回复制的文本） */
export const CONFIRMABLE_COMMANDS = ["tab.copyUrl", "tab.copyMarkdown"] as const;

export const transform = (url: string): UrlTransformResult =>
    toTransformResult(cleanUrlDetailed(url, { extraParams: parseList(settings.store.extraParams), skipHosts: parseList(settings.store.skipHosts), exceptions: !!settings.store.exceptions, extended: !!settings.store.extended }));

const tracker = createCopyTracker();
const bgTransform = (url: string) => { const r = transform(url); if (r.changed) tracker.markChanged(); return r; };

/** 确认成功后提示：交给最后聚焦窗口的侧边栏（没开就不提示） */
async function notify() {
    const w = await safe(chrome.windows.getLastFocused(), "windows.getLastFocused", undefined);
    await chrome.runtime.sendMessage({ type: TOAST_MSG, windowId: w?.id }).catch(() => undefined); /* 预期：没有接收端（侧栏未开 / 扩展重载，Receiving end does not exist），忽略 */
}

const wrapped = new WeakSet<object>();
/** 包装已注册的命令；命令稍后才注册或被核心重新注册时（registry 通知）再包一次。停用时还原 */
function hookCommands(): () => void {
    const originals = new Map<string, (arg?: unknown) => unknown>();
    const apply = () => {
        for (const id of CONFIRMABLE_COMMANDS) {
            const def = commands.get(id);
            if (!def || wrapped.has(def.run)) continue;
            originals.set(id, def.run);
            const run = tracker.wrap(def.run, () => void notify());
            wrapped.add(run);
            commands.set(id, { ...def, run });
        }
    };
    apply();
    const unsub = commands.store.subscribe(apply);
    return () => {
        unsub();
        for (const [id, orig] of originals) { const cur = commands.get(id); if (cur && wrapped.has(cur.run)) commands.set(id, { ...cur, run: orig }); }
    };
}

export default definePlugin({
    name: "CleanUrls",
    label: "plugin.cleanUrls.label",
    enabledByDefault: true, // 默认开：只对从未显式设置过本开关的情况生效（isPluginEnabled：Settings.plugins.CleanUrls.enabled ?? enabledByDefault）；用户手动关闭写入 enabled:false，不被覆盖。Arc 的 Copy URL 按钮 / 复制链接本来就总是清理（clean-urls.md §2 开关 ⛔ 源码未找到，“看起来一直开启”）
    description: "plugin.cleanUrls.desc",
    authors: [Devs.ArcSidebar],
    tags: ["tabs"],
    featureTags: ["cleanUrls.tag.trackers", "cleanUrls.tag.extended", "cleanUrls.tag.skip"],
    settings,
    background: {
        start() { return [registerUrlTransform("copy", bgTransform), hookCommands()]; },
    },
    panel: {
        start() {
            let myWin: number | undefined;
            void safe(currentWindow().then(w => { myWin = w.id; }), "windows.getCurrent");
            const onMsg = (m: { type?: string; windowId?: number }, _s: unknown, respond: (r: unknown) => void) => {
                if (m?.type !== TOAST_MSG || myWin == null || m.windowId !== myWin) return; // 不是本窗口：不响应，交给别人
                toast(tr(TOAST_KEY)); respond(true);
            };
            chrome.runtime.onMessage.addListener(onMsg);
            return [registerUrlTransform("copy", transform), () => chrome.runtime.onMessage.removeListener(onMsg)];
        },
    },
    options: { start() { return [registerUrlTransform("copy", transform)]; } },
    page: { start() { return [registerUrlTransform("copy", transform)]; } },
});

/*
 * Shortcuts（§17）：把命令绑定到快捷键。content 上下文在网页里捕获按键，panel 在侧边栏里捕获，
 * 都转成 runCommand 路由到命令所在上下文。浏览器保留的组合（Ctrl/⌘+T/W/N 等）扩展无法截获，
 * 这些功能用 manifest commands 或 Alt 变体代替。按键映射可在“快捷键”浮层中修改。
 */
import "@components/ArcTooltip";
import { safe } from "@api/ErrorLog";
import { navigateAfterNative, type NativeOpts } from "@api/HostMode";
import { tr } from "@api/i18n";
import { commands, runCommand, setKeyResolver } from "@api/Commands";
import { h } from "@api/dom";
import { eventToCombo, isMac, normalizeCombo, prettyCombo } from "@api/Keys";
import { addOverlay, openOverlay } from "@api/Slots";
import { getContext } from "@api/context";
import { plugins } from "@api/PluginManager";
import { createPluginStore } from "@api/Storage";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";

/** 新建标签打开受限页（chrome:// / 扩展页 / 商店）：页内侧栏里先切到原生侧边栏再开（navigateAfterNative：同步发消息、等 ack 再建；只在页内上下文起作用）。await 之后的调用点用 gestureAt 按 E8 的 3 s 手势预算降级 */
const createTab = (url: string | undefined, o?: NativeOpts) => safe(Promise.resolve(navigateAfterNative(url, "create", undefined, () => chrome.tabs.create({ url }), o)), "tabs.create"); // patch 07：先切原生，等 ack（最多 500 ms）再建；o.gestureAt = await 之后的调用点按手势预算降级

/** commandId → 组合键（"" 表示禁用） */
const keymap = createPluginStore<{ map: Record<string, string> }>("keymap", () => ({ map: {} }));

function resolve(combo: string): string | undefined {
    const over = keymap.get().map;
    for (const [id, c] of commands.sorted()) {
        const key = over[id] ?? (c.defaultKey ? normalizeCombo(c.defaultKey) : "");
        if (key && key === combo) return id;
    }
    return undefined;
}

function onKey(e: KeyboardEvent) {
    const combo = eventToCombo(e);
    if (!combo) return;
    // 分屏面板里的 ⌘L 由 SplitView 处理（只改这个面板的网址）
    if (window.top !== window && getContext() === "content" && (combo === "Meta+L" || combo === "Ctrl+L")) return;
    const t = e.target as HTMLElement | null;
    // 在可编辑区域只响应带 Ctrl/⌘/Alt 的组合
    const editable = !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
    if (editable && !/Ctrl|Meta|Alt/.test(combo)) return;
    // macOS：Option(+Shift)+键在输入框里是打字（œ ™ ¡ …），不拦截（Windows 的 Alt 组合不产生字符）
    if (editable && isMac && !/Ctrl|Meta/.test(combo)) return;
    const id = resolve(combo);
    if (!id) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    void runCommand(id);
}

function render(box: HTMLElement) {
    const list = h("div", { class: "arc-list" });
    const draw = () => {
        const over = keymap.get().map;
        list.replaceChildren(...commands.sorted().map(([id, c]) => {
            const cur = over[id] ?? (c.defaultKey ? normalizeCombo(c.defaultKey) : "");
            const btn = h("button", {
                class: "arc-kbd", "data-tip": tr("shortcuts.recordHint"),
                onclick: () => {
                    btn.textContent = tr("shortcuts.pressKeys");
                    const rec = (e: KeyboardEvent) => {
                        e.preventDefault(); e.stopPropagation();
                        if (e.key === "Escape") return done();
                        if (e.key === "Backspace") return done("");
                        const combo = eventToCombo(e);
                        if (combo) done(combo);
                    };
                    const done = (v?: string) => {
                        window.removeEventListener("keydown", rec, true);
                        if (v !== undefined) void keymap.update(x => { x.map[id] = v; }); else draw();
                    };
                    window.addEventListener("keydown", rec, true);
                },
            }, cur ? prettyCombo(cur) : "—");
            return h("div", { class: "arc-list-row" }, h("span", { class: "arc-tab-title" }, tr(c.label)), h("small", null, tr(plugins[c.plugin]?.label ?? c.plugin)), btn);
        }));
    };
    box.append(h("div", { class: "arc-row" },
        h("button", { class: "arc-btn", onclick: () => keymap.update(x => { x.map = {}; }) }, tr("common.restoreDefault")),
        h("button", { class: "arc-btn", onclick: () => void createTab("chrome://extensions/shortcuts") }, tr("shortcuts.global"))), list);
    draw();
    return [keymap.subscribe(draw), commands.store.subscribe(draw)];
}

export default definePlugin({
    name: "Shortcuts",
    authors: [Devs.ArcSidebar],
    label: "plugin.shortcuts.label",
    description: "plugin.shortcuts.desc",
    tags: ["command"],
    required: true,
    commands: [{ id: "shortcuts.open", label: "shortcuts.cmdEdit", keywords: ["shortcuts", "keyboard"], context: "panel", run: () => openOverlay("shortcuts") }],
    content: {
        start() {
            window.addEventListener("keydown", onKey, true);
            return () => window.removeEventListener("keydown", onKey, true);
        },
    },
    panel: {
        start() {
            setKeyResolver(id => { const c = commands.get(id); const k = keymap.get().map[id] ?? (c?.defaultKey ? normalizeCombo(c.defaultKey) : ""); return k ? prettyCombo(k) : undefined; });
            window.addEventListener("keydown", onKey, true);
            return [() => window.removeEventListener("keydown", onKey, true), addOverlay("shortcuts", "Shortcuts", { title: tr("plugin.shortcuts.label"), render })];
        },
    },
    page: {
        start() {
            if (getContext() !== "page") return;
            window.addEventListener("keydown", onKey, true);
            return () => window.removeEventListener("keydown", onKey, true);
        },
    },
});

/* 插件「自适应配色」：按当前网页给侧边栏着色（类似 Safari 标签栏 / Arc / Firefox Adaptive Tab Bar Colour）。
 * 颜色来源依次：① <meta name="theme-color">（按 media 区分浅 / 深色）② 顶部元素或 body 的背景色 ③ 回落到空间主题色。
 * 切换标签 / 导航时平滑过渡；按亮度自动切换文字与图标的浅 / 深。我们自己的实现。 */
import { safe } from "@api/ErrorLog";
import { call, handle } from "@api/RPC";
import { flog } from "@api/FocusLog";
import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";

const settings = definePluginSettings({
    source: {
        type: OptionType.SELECT, description: "adaptive.source",
        options: [{ label: "adaptive.sourceAll", value: "all", default: true }, { label: "adaptive.sourceMeta", value: "meta" }],
    },
});

type RGBA = [number, number, number, number];
function parse(c: string | null | undefined): RGBA | undefined {
    const m = c?.match(/rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?/);
    if (!m) return;
    const a = m[4] == null ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return [+m[1], +m[2], +m[3], a];
}
/** 任意 CSS 颜色 → rgb()（借浏览器解析） */
function normalize(c: string): RGBA | undefined {
    const el = document.createElement("i");
    el.style.color = ""; el.style.color = c;
    if (!el.style.color) return;
    el.style.display = "none"; document.documentElement.append(el);
    const v = getComputedStyle(el).color; el.remove();
    return parse(v);
}
const hex = ([r, g, b]: RGBA) => `#${[r, g, b].map(x => Math.round(x).toString(16).padStart(2, "0")).join("")}`;

/** 页面颜色（内容脚本里运行） */
export function pageColor(metaOnly = false): { color: string; from: string } | undefined {
    for (const m of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color" i]')) {
        if (m.media && !matchMedia(m.media).matches) continue;
        const c = normalize(m.content);
        if (c && c[3] > .5) return { color: hex(c), from: "meta" };
    }
    if (metaOnly) return;
    let el: Element | null = document.elementFromPoint(innerWidth / 2, 2);
    for (; el; el = el.parentElement) {
        const c = parse(getComputedStyle(el).backgroundColor);
        if (c && c[3] > .5) return { color: hex(c), from: "top" };
    }
    for (const e of [document.body, document.documentElement]) {
        const c = e && parse(getComputedStyle(e).backgroundColor);
        if (c && c[3] > .5) return { color: hex(c), from: "body" };
    }
    // 没有设置背景 = 浏览器默认画布色
    return { color: matchMedia("(prefers-color-scheme: dark)").matches && getComputedStyle(document.documentElement).colorScheme.includes("dark") ? "#121212" : "#ffffff", from: "canvas" };
}

/** 相对亮度（WCAG） */
export function luminance(h: string) {
    const v = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(x => x <= .03928 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4);
    return .2126 * v[0] + .7152 * v[1] + .0722 * v[2];
}
const KEY = (id: number) => `adaptive:${id}`;

function paint(color?: string) {
    const r = document.documentElement;
    if (!color) { delete r.dataset.adaptive; r.style.removeProperty("--arc-adaptive"); document.dispatchEvent(new Event("arc-theme-reapply")); return; }
    // 浅色页面 → 深色文字；深色页面 → 浅色文字（对比度阈值取两者对比度相等处 ≈ 0.18）
    const dark = luminance(color) < .18;
    r.style.setProperty("--arc-adaptive", color);
    r.dataset.adaptive = dark ? "dark" : "light";
    r.dataset.theme = dark ? "dark" : "light";
}

export default definePlugin({
    name: "Adaptive",
    label: "plugin.adaptive.label",
    icon: "sun",
    description: "plugin.adaptive.desc",
    authors: [Devs.ArcSidebar],
    tags: ["adaptive"],
    enabledByDefault: false, // Arc 没有自适应网页配色：额外功能默认关闭（audit-2026-10-16 A1）
    settings,
    background: {
        start: () => [
            handle("adaptive:color", async ([c], sender) => {
                const id = sender.tab?.id;
                if (id == null || sender.frameId) return;
                flog("bg", `adaptive: tab ${id} ${c ?? "none"} ${(sender.tab?.url ?? "").replace(/^https?:\/\//, "").split(/[/?#]/)[0]}`);
                await chrome.storage.session.set({ [KEY(id)]: c ?? null });
            }),
            (chrome.tabs.onRemoved.addListener(rm), () => chrome.tabs.onRemoved.removeListener(rm)),
            () => void safe(chrome.storage.session.get(null).then(all => chrome.storage.session.remove(Object.keys(all).filter(k => k.startsWith("adaptive:")))), "storage.session.get"),
        ],
    },
    content: {
        start() {
            if (window.top !== window) return;
            let last = "";
            const send = () => {
                const c = pageColor(settings.store.source === "meta")?.color ?? "";
                if (c === last) return;
                last = c;
                void safe(call("adaptive:color", c || null), "adaptive:color");
            };
            let t: ReturnType<typeof setTimeout> | undefined;
            const soon = () => { clearTimeout(t); t = setTimeout(send, 120); };
            send();
            const mo = new MutationObserver(soon);
            mo.observe(document.head ?? document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["content", "media"] });
            const mo2 = new MutationObserver(soon);
            mo2.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style", "data-color-mode", "data-theme"] });
            if (document.body) mo2.observe(document.body, { attributes: true, attributeFilter: ["class", "style"] });
            const mq = matchMedia("(prefers-color-scheme: dark)");
            mq.addEventListener("change", soon);
            addEventListener("load", soon); addEventListener("pageshow", soon); addEventListener("popstate", soon);
            const vis = () => { if (document.visibilityState === "visible") { last = ""; soon(); } };
            document.addEventListener("visibilitychange", vis);
            const iv = setInterval(soon, 2500); // SPA 导航（pushState）没有事件
            return () => { mo.disconnect(); mo2.disconnect(); mq.removeEventListener("change", soon); clearInterval(iv); clearTimeout(t); removeEventListener("load", soon); removeEventListener("pageshow", soon); removeEventListener("popstate", soon); document.removeEventListener("visibilitychange", vis); };
        },
    },
    panel: {
        start() {
            let tabId: number | undefined;
            const refreshPaint = async () => {
                if (tabId == null) return paint();
                const v = (await chrome.storage.session.get(KEY(tabId)))[KEY(tabId)] as string | null | undefined;
                paint(v || undefined);
            };
            const onAct = (i: { tabId: number; windowId: number }) => void safe(chrome.windows.getCurrent().then(w => { if (i.windowId === w.id) { tabId = i.tabId; void refreshPaint(); } }), "windows.getCurrent");
            const onSess = (ch: Record<string, chrome.storage.StorageChange>) => { if (tabId != null && KEY(tabId) in ch) void refreshPaint(); };
            void safe(chrome.tabs.query({ active: true, currentWindow: true }).then(([t]) => { tabId = t?.id; void refreshPaint(); }), "tabs.query");
            chrome.tabs.onActivated.addListener(onAct);
            chrome.storage.session.onChanged.addListener(onSess);
            // 空间切换时主题插件会重写 data-theme：之后再盖一次
            const mo = new MutationObserver(() => { const a = document.documentElement.dataset.adaptive; if (a && document.documentElement.dataset.theme !== a) document.documentElement.dataset.theme = a; });
            mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
            const unsub = () => mo.disconnect();
            return () => { chrome.tabs.onActivated.removeListener(onAct); chrome.storage.session.onChanged.removeListener(onSess); unsub(); paint(); };
        },
    },
});

function rm(id: number) { void safe(chrome.storage.session.remove(KEY(id)), "storage.session.remove"); }

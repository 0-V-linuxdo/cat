/* Themes（§5.3）：按当前 Space 着色。每个空间可用“编辑主题颜色…”打开自定义主题选择器
 * （移植自 Zen Browser 的 ZenGradientGenerator，MPL-2.0，见 gradient.ts / picker.ts）：
 * 颜色平面 1–3 个颜色（和声）、自动（跟随系统）/ 浅色 / 深色、颗粒、浓度；自动 = 明暗跟随系统（见 scheme.ts）。
 * 主题存在设置存储（Themes.spaceThemes），所有上下文实时同步。没有自定义主题的空间沿用空间色 + 全局渐变。 */
import { safe } from "@api/ErrorLog";
import { currentWindow } from "@api/HostMode";
import { refresh } from "@api/Slots";
import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { activeSpace, COLOR_HEX, spacesStore, themePickerHook } from "@plugins/spaces/spaceManager/store";
import { DEFAULT_THEME, getGradient, type GradientTheme, hexToRgb, rgbCss, themeColors } from "./gradient";
import { resolveSpaceScheme } from "./scheme";
import { openThemePicker } from "./picker";
import { sidebarOnly } from "@api/Commands";
import { getWindowId } from "@plugins/_core/tabState";
import "./i18n";

const settings = definePluginSettings({
    mode: { type: OptionType.SELECT, description: "themes.mode", options: [{ label: "themes.system", value: "auto", default: true }, { label: "themes.light", value: "light" }, { label: "themes.dark", value: "dark" }] },
    gradient: { type: OptionType.BOOLEAN, default: true, description: "themes.gradient" },
    themeExtraMenu: { type: OptionType.BOOLEAN, default: false, description: "themes.extraMenu" }, // Arc 菜单里没有的项：默认关闭
    intensity: { type: OptionType.NUMBER, default: 22, min: 0, max: 60, description: "themes.intensity" },
    /** H-01：窗口失焦变暗。⛔ Arc 有无此行为没有 Rea 出处 → 作为多出项默认关闭（audit-arc-diff-52193 H-01） */
    blurDim: { type: OptionType.BOOLEAN, default: false, description: "themes.blurDim" },
    /** H-02：深色颗粒层（sidepanel.css:279–282 的 body::after，值取自截图，无出处）→ 默认关闭（audit-arc-diff-52193 H-02） */
    darkGrain: { type: OptionType.BOOLEAN, default: false, description: "themes.darkGrain" },
    /** spaceId → 自定义主题（主题选择器写入） */
    spaceThemes: { type: OptionType.CUSTOM, default: {} as Record<string, GradientTheme> },
});

const BASE_LIGHT = hexToRgb("#ece9f1"), BASE_DARK = hexToRgb("#121227");
const live = new Map<string, GradientTheme>(); // 拖动中的预览（尚未写入存储）
export const spaceTheme = (id: string): GradientTheme | undefined =>
    live.get(id) ?? (settings.store.spaceThemes as Record<string, GradientTheme> | undefined)?.[id];

const systemDark = () => typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;

function apply() {
    const root = document.documentElement;
    const sp = activeSpace();
    const custom = spaceTheme(sp.id);
    const colors = custom ? themeColors(custom) : [];
    // [system-color-scheme/4] 明暗只在这里决定、data-theme 只在这里写一次：自定义 auto 跟全局 mode（mode=auto 即跟系统，不钉死）
    const sc = resolveSpaceScheme(custom?.scheme, settings.store.mode, systemDark());
    root.dataset.theme = sc.theme;
    root.dataset.spaceColor = sp.color;
    // H-02：颗粒层只在开启时显示（隐藏规则在 spaces/style.ts，按 data-dark-grain）
    root.dataset.darkGrain = String(!!settings.store.darkGrain);
    // H-01：关掉开关时立即撤掉变暗
    if (!settings.store.blurDim) delete root.dataset.blurred;
    if (custom && colors.length) {
        // 自定义主题：Zen 的渐变公式；明暗见 scheme.ts（auto 跟系统，显式浅 / 深钉死）
        const dark = sc.dark;
        root.style.setProperty("--arc-space", rgbCss(colors[0]));
        root.style.setProperty("--arc-tint", getGradient(colors, dark ? BASE_DARK : BASE_LIGHT, custom.opacity));
        root.style.setProperty("--arc-k", "0");
    } else {
        const hex = COLOR_HEX[sp.color] ?? COLOR_HEX.blue;
        root.style.setProperty("--arc-space", hex);
        root.style.setProperty("--arc-tint", settings.store.gradient
            ? `linear-gradient(180deg, color-mix(in srgb, ${hex} calc(var(--arc-tint-k) * 1%), var(--arc-base)) 0%, color-mix(in srgb, ${hex} calc(var(--arc-tint-k) * .4%), var(--arc-base)) 100%)`
            : `color-mix(in srgb, ${hex} calc(var(--arc-tint-k) * 1%), var(--arc-base))`);
        root.style.setProperty("--arc-k", String(settings.store.intensity));
    }
    // 颗粒：旧版 per-space noise 开关折算成 0.5
    const grain = custom?.texture ?? (sp.theme?.noise ? 0.5 : 0);
    root.dataset.noise = String(grain > 0);
    root.style.setProperty("--arc-grain", String(+(grain * 0.22).toFixed(3)));
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
function setSpaceTheme(id: string, t: GradientTheme | null, final = true) {
    if (t) live.set(id, t); else live.delete(id);
    apply();
    clearTimeout(saveTimer);
    const save = () => {
        const all = { ...(settings.store.spaceThemes as Record<string, GradientTheme>) };
        if (t) all[id] = t; else delete all[id];
        settings.store.spaceThemes = all;
        live.delete(id);
    };
    if (final) save(); else saveTimer = setTimeout(save, 400);
}

export const openPicker = (id: string, at: { x: number; y: number }) => openThemePicker(at, {
    get: () => spaceTheme(id) ?? { ...DEFAULT_THEME, texture: spacesStore.get().spaces.find(s => s.id === id)?.theme?.noise ? 0.5 : 0 },
    set: (t, final) => setSpaceTheme(id, t, final),
});

function openPickerHere() { const r = document.querySelector(".arc-space-title")?.getBoundingClientRect(); openPicker(activeSpace().id, { x: (r?.left ?? 8), y: (r?.bottom ?? 40) + 4 }); }

export default definePlugin({
    name: "Themes",
    authors: [Devs.ArcSidebar],
    label: "plugin.themes.label",
    description: "plugin.themes.desc",
    tags: ["spaces"],
    dependencies: ["SpaceManager"],
    enabledByDefault: true,
    settings,
    onSettingsChange: apply,
    commands: [{ id: "space.theme", label: "spaces.menu.theme", keywords: ["theme", "color", "gradient"], context: "panel", run: sidebarOnly("space.theme", openPickerHere, getWindowId) }],
    contextMenuItems: {
        sidebar: [{
            id: "spaceTheme", label: "spaces.menu.theme", order: 62,
            run: openPickerHere,
        }, {
            id: "resetSpaceTheme", label: "themes.resetSpace", order: 63,
            disabled: () => !spaceTheme(activeSpace().id),
            run: () => setSpaceTheme(activeSpace().id, null),
        }, {
            id: "appearance", label: "themes.mode", order: 61, visible: () => !!settings.store.themeExtraMenu, run: () => { },
            submenu: () => [
                ...(["auto", "light", "dark"] as const).map(m => ({ id: `mode:${m}`, label: m === "auto" ? "themes.system" : `themes.${m}`, checked: () => settings.store.mode === m, run: () => { settings.store.mode = m; } })),
                { id: "gradient", label: "themes.gradient", checked: () => !!settings.store.gradient, run: () => { settings.store.gradient = !settings.store.gradient; } },
            ],
        }],
    },
    panel: {
        start() {
            apply();
            const mq = matchMedia("(prefers-color-scheme: dark)");
            mq.addEventListener("change", apply);
            document.addEventListener("arc-theme-reapply", apply);
            // H-01：窗口失焦时侧边栏变暗——⛔ 无 Rea 出处，仅在设置 blurDim 开启时生效（默认关）
            const onFocus = (id: number) => {
                if (!settings.store.blurDim) { delete document.documentElement.dataset.blurred; return; }
                void safe(currentWindow().then(w => { if (settings.store.blurDim) document.documentElement.dataset.blurred = String(id !== w.id); }), "windows.getCurrent");
            };
            chrome.windows.onFocusChanged.addListener(onFocus);
            themePickerHook.open = openPicker;
            return [() => { delete themePickerHook.open; mq.removeEventListener("change", apply); document.removeEventListener("arc-theme-reapply", apply); }, () => { chrome.windows.onFocusChanged.removeListener(onFocus); delete document.documentElement.dataset.blurred; }, spacesStore.subscribe(apply), () => {
                const r = document.documentElement;
                delete r.dataset.theme;
                for (const p of ["--arc-space", "--arc-k", "--arc-tint", "--arc-grain"]) r.style.removeProperty(p);
                delete r.dataset.spaceColor;
                delete r.dataset.noise;
                delete r.dataset.darkGrain;
                refresh();
            }];
        },
    },
});

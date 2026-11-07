/*
 * 对应 Void++ src/components/settings/SettingField.tsx：按 OptionType 渲染设置项（Record<OptionType, Field>），
 * 支持 checks.disabled / checks.isValid、restartNeeded、onChange、COMPONENT 自定义控件；CUSTOM 不渲染。
 * 侧边栏设置浮层与完整设置页共用，不为任何插件写专门界面。
 */
import { tr } from "@api/i18n";
import { releasePluginPermissions, requestPluginPermissions } from "@api/PluginManager";
import { h } from "@api/dom";
import { Dropdown } from "@components/Menu";
import { selectShown } from "./selectShown";
import { dispatch } from "@api/Events";
import { OptionType, type Plugin, type PluginSettingDef, type PluginSettingValue } from "@utils/types";

type Field = (p: Plugin, key: string, def: any, cur: any, set: (v: PluginSettingValue) => void, disabled: boolean) => HTMLElement;

const attrs = (p: Plugin, key: string, disabled: boolean) => ({ "data-setting": `${p.name}.${key}`, disabled });
const value = (e: Event) => (e.target as HTMLInputElement).value;

const FIELDS = {
    [OptionType.STRING]: (p, k, d, cur, set, dis) => d.multiline && !d.sensitive
        ? h("textarea", { ...attrs(p, k, dis), class: "arc-field", placeholder: d.placeholder, onchange: (e: Event) => set(value(e)) }, String(cur ?? ""))
        : h("input", { ...attrs(p, k, dis), type: d.sensitive ? "password" : "text", autocomplete: d.sensitive ? "off" : undefined, class: "arc-field", value: String(cur ?? ""), placeholder: d.placeholder, onchange: (e: Event) => set(value(e)) }),
    [OptionType.NUMBER]: (p, k, d, cur, set, dis) => h("input", { ...attrs(p, k, dis), type: "number", class: "arc-field", value: String(cur ?? ""), min: d.min, max: d.max, onchange: (e: Event) => set(Number(value(e))) }),
    [OptionType.BIGINT]: (p, k, _d, cur, set, dis) => h("input", { ...attrs(p, k, dis), type: "text", inputmode: "numeric", class: "arc-field", value: String(cur ?? ""), onchange: (e: Event) => set(BigInt(value(e) || "0")) }),
    [OptionType.BOOLEAN]: (p, k, _d, cur, set, dis) => h("input", { ...attrs(p, k, dis), type: "checkbox", class: "arc-switch", checked: !!cur, onchange: (e: Event) => {
        const el = e.target as HTMLInputElement, on = el.checked;
        // 声明了可选权限的子开关：打开时在同一点击里申请，拒绝则回滚；关闭时移除权限
        if (p.optionalPermissions?.[k]?.length) {
            if (on) { void requestPluginPermissions(p.name, k).then(ok => { if (ok) set(true); else el.checked = false; }); return; }
            set(false); void releasePluginPermissions(p.name, k); return;
        }
        set(on);
    } }),
    [OptionType.SELECT]: (p, k, d, cur, set, dis) => {
        const el = Dropdown({ options: d.options, value: selectShown(d.options, cur), onChange: set, disabled: dis, tipShown: true });
        el.dataset.setting = `${p.name}.${k}`;
        return el;
    },
    [OptionType.SLIDER]: (p, k, d, cur, set, dis) => {
        const out = h("output", { class: "arc-slider-value" }, String(cur));
        return h("span", { class: "arc-slider" }, h("input", { ...attrs(p, k, dis), type: "range", min: d.min, max: d.max, value: String(cur), oninput: (e: Event) => { out.textContent = value(e); }, onchange: (e: Event) => set(Number(value(e))) }), out);
    },
    [OptionType.COMPONENT]: (_p, _k, d, _cur, set) => d.component({ setValue: set, option: d }),
    [OptionType.CUSTOM]: null,
} as const satisfies Record<OptionType, Field | null>;

export const isVisibleSetting = ([, s]: [string, PluginSettingDef]) => s.type !== OptionType.CUSTOM && !s.hidden;
export const hasVisibleSettings = (p: Plugin) => !!p.settings && Object.entries(p.settings.def).some(isVisibleSetting);

export function SettingField(p: Plugin, key: string, def: PluginSettingDef, onError: (msg: string) => void) {
    const ds = p.settings!;
    const check = (ds.checks as Record<string, { disabled?(): boolean; isValid?(v: unknown): boolean | string }>)[key];
    const field = FIELDS[def.type] as Field | null;
    if (!field) return null;
    const set = (v: PluginSettingValue) => {
        const ok = check?.isValid?.call(ds, v) ?? true;
        if (ok !== true) { onError(typeof ok === "string" ? ok : tr("settings.invalid")); return; }
        (ds.store as Record<string, unknown>)[key] = v;
        def.onChange?.(v);
        if (def.restartNeeded) dispatch("reloadNeeded");
    };
    const cur = (ds.store as Record<string, unknown>)[key];
    const disabled = !!check?.disabled?.call(ds);
    const { title, desc } = settingText(def, key);
    const kind = def.type === OptionType.BOOLEAN ? "toggle" : def.type === OptionType.SLIDER ? "slider" : def.type === OptionType.STRING && def.multiline ? "area" : "field";
    const tip = settingTip(def.detail ? tr(def.detail) : "");
    return h("label", { class: `arc-setting${def.parent ? " arc-setting-sub" : ""}${def.featureToggle ? " arc-setting-feature" : ""}${disabled ? " is-disabled" : ""}`, "data-setting-row": `${p.name}.${key}`, "data-kind": kind },
        h("span", { class: "arc-setting-text", "data-tip": tip.title || null, "data-tip-subtitle": tip.subtitle || null },
            h("span", { class: "arc-setting-title" }, title),
            desc ? h("span", { class: "arc-setting-desc" }, desc) : null),
        h("span", { class: "arc-setting-control" }, field(p, key, def, cur, set, disabled)));
}

export function SettingFields(p: Plugin, onError: (msg: string) => void) {
    const build = () => {
        if (!p.settings) return [];
        const store = p.settings.store as Record<string, unknown>;
        const out: HTMLElement[] = [];
        let group: HTMLElement | null = null, groupKey = "";
        for (const [k, d] of Object.entries(p.settings.def).filter(isVisibleSetting)) {
            const row = SettingField(p, k, d, onError);
            if (!row) continue;
            // 分组：同一功能（feature）的开关 + 子设置放进一个分组；子设置缩进，开关关闭时隐藏
            const gk = d.feature ?? "";
            if (!group || gk !== groupKey) {
                group = h("div", { class: "arc-setting-group", "data-feature": gk });
                // 必需功能没有开关：用功能名做小标题（只在有多项时显示）
                out.push(group); groupKey = gk;
            }
            if (d.parent) {
                const tog = group.querySelector<HTMLInputElement>(`input[data-setting="${p.name}.${d.parent}"]`);
                if (tog ? !tog.checked : store[d.parent] === false) row.hidden = true;
            }
            group.append(row);
        }
        for (const g of out) {
            const f = g.dataset.feature;
            if (f && !g.querySelector(".arc-setting-feature") && g.children.length >= 1) g.prepend(h("div", { class: "arc-setting-caption" }, tr(f)));
        }
        return out;
    };
    const rows = build();
    if (!rows.length) return null;
    const box = h("div", { class: "arc-plugin-settings" }, rows) as HTMLElement;
    /* 功能开关是设置项：改动后重绘，使依赖它的设置项（checks.disabled / 子设置）即时显示 / 隐藏 */
    box.addEventListener("change", () => queueMicrotask(() => { if (box.isConnected) box.replaceChildren(...build() as Node[]); }));
    return box;
}

/** 详细说明 → 悬停提示：第一行 = 标题，其余行（空格连接）= 副标题；ArcTooltip 两部分都是单行省略号，不会撑高设置行 */
export function settingTip(detail: string): { title: string; subtitle: string } {
    const lines = detail.split("\n").map(s => s.trim()).filter(s => s !== "");
    return { title: lines.at(0) ?? "", subtitle: lines.slice(1).join(" ") };
}

const SEP = /^(.{1,24}?)(?:：|: )(.+)$/s;
/** 设置项文字 → 标题 + 次要说明。功能开关：标题 = 功能名，说明 = 功能描述；子设置：标题 = 本项描述；“X：说明”拆成两行 */
export function settingText(def: { description?: string; feature?: string; featureToggle?: boolean; parent?: string }, key: string): { title: string; desc: string } {
    let d = tr(def.description ?? key);
    if (def.featureToggle && def.feature) {
        const f = tr(def.feature);
        return { title: f, desc: stripLead(d, f) };
    }
    if (def.feature) d = stripLead(d, tr(def.feature)) || d;
    const m = SEP.exec(d);
    return m ? { title: m[1].trim(), desc: m[2].trim() } : { title: d, desc: "" };
}
/** 去掉与标题重复的前缀（“归档：…” / “归档 · …” / “Archive: …”） */
export function stripLead(text: string, lead: string) {
    for (const sep of ["：", ": ", " · ", "·"]) if (text.startsWith(lead + sep)) return text.slice(lead.length + sep.length).trim();
    return text;
}

/** 单行文字（搜索等用）= 标题 */
export function settingLabel(def: { description?: string; feature?: string; featureToggle?: boolean }, key: string) {
    return settingText(def, key).title;
}

/* 图标选择器 = Arc CustomInfoPicker（/workspace/arc-analysis/space-icon-picker.md）：
 * ✅ 结构：系统分段控件 Emoji / Icon + 垃圾桶（icomoon U+E9F0，15pt，宽 22；canRemoveIcon：仅已设图标时显示；点击 = didSelectIcon(nil) 清空图标；⛔ 没有 tooltip / 无障碍文字，不加 data-tip，aria-label 仅供读屏；宽度：static/sidepanel.css 的 .arc-icon-btn { min-width: 28px } 会盖过 spaces/style.ts .arc-ip-del 的 width: 22px，所以内联 min-width: 22px——内联样式高于任何选择器，不用改共享 CSS）；无标题；NSPopover 带箭头，preferredEdge MinY（锚点下方），点外面关闭。
 * ✅ Icon 页 56 个 Arc 原始字形（/workspace/arc-icons/space-icons/picker56）；Emoji 页：完整列表、8 分类条、搜索、肤色（数据来自 Unicode）。数值见 spaces/style.ts。
 * 源码未找到：清除后的结果（现为清空成默认圆点）、选完是否关闭（现为关闭）、由哪个控件打开（现为右键 Change Icon / 管理空间里的图标）。 */
import "@components/ArcTooltip";
import { h } from "@api/dom";
import { tr } from "@api/i18n";
import { icon as svgIcon } from "@api/icons";
import { isSym, SPACE_SYMBOLS, symIcon } from "@api/spaceIcons";
import { EMOJI_CATS } from "@api/emojiData";
import { closeMenus, openPanel } from "./Menu";

export const PICKER_EMOJI = EMOJI_CATS[0][1].slice(0, 24).map(e => e[0]);
const TONES = ["", "\u{1F3FB}", "\u{1F3FC}", "\u{1F3FD}", "\u{1F3FE}", "\u{1F3FF}"];
const TONE_KEY = "arcEmojiTone";
const withTone = (e: string, t: string) => { if (!t) return e; const cps = [...e.replace(/\uFE0F/g, "")]; return cps[0] + t + cps.slice(1).join(""); };
const CAT_ICON: Record<string, string> = { people: "😀", nature: "🐻", food: "🍔", activity: "⚽", travel: "🚗", objects: "💡", symbols: "🔣", flags: "🏳️" };

export function openIconPicker(at: { x: number; y: number }, cur: string | undefined, set: (icon: string) => void) {
    let tab: "emoji" | "icon" = isSym(cur) || !cur ? "icon" : "emoji";
    let tone = localStorage.getItem(TONE_KEY) ?? "";
    let q = "";
    // 选完即关闭：源码未找到（现值）
    const pick = (v: string) => { set(v); closeMenus(); };
    const body = h("div", { class: "arc-ip-body" });
    const seg = (id: "emoji" | "icon") => h("button", { class: "arc-ip-seg", "data-test": `ip-tab-${id}`, role: "tab", onclick: () => { tab = id; draw(); } }, tr(`picker.${id}`));
    const segs = [seg("emoji"), seg("icon")];
    const cell = (e: string) => h("button", { class: `arc-ip-cell${cur === e ? " on" : ""}`, "data-test": `emoji:${e}`, onclick: () => pick(e) }, e);
    const emojiPage = () => {
        const search = h("input", { class: "arc-ip-search", type: "search", placeholder: tr("picker.search"), "data-test": "ip-search", value: q }) as HTMLInputElement;
        const grid = h("div", { class: "arc-ip-grid arc-ip-emoji", "data-test": "ip-grid" });
        const fill = () => {
            const s = q.trim().toLowerCase();
            grid.replaceChildren(...EMOJI_CATS.flatMap(([cat, list]) => {
                const items = list.filter(([, name]) => !s || name.includes(s)).map(([e, , st]) => cell(st ? withTone(e, tone) : e));
                return items.length ? [h("div", { class: "arc-ip-cat", "data-cat": cat }, tr(`picker.cat.${cat}`)), ...items] : [];
            }));
        };
        search.addEventListener("input", () => { q = search.value; fill(); });
        const toneBtn = h("button", { class: "arc-ip-tone", "data-tip": tr("picker.skinTone"), "data-test": "ip-tone", onclick: (ev: MouseEvent) => {
            ev.stopPropagation(); const pop = toneBtn.nextElementSibling as HTMLElement | null;
            if (pop?.classList.contains("arc-ip-tones")) { pop.remove(); return; }
            toneBtn.after(h("div", { class: "arc-ip-tones" }, TONES.map(t => h("button", { class: `arc-ip-cell${t === tone ? " on" : ""}`, "data-test": `ip-tone-${TONES.indexOf(t)}`, onclick: () => { tone = t; localStorage.setItem(TONE_KEY, t); toneBtn.textContent = withTone("✋", t); toneBtn.nextElementSibling?.remove(); fill(); } }, withTone("✋", t)))));
        } }, withTone("✋", tone));
        const cats = h("div", { class: "arc-ip-cats", "data-test": "ip-cats" }, EMOJI_CATS.map(([cat]) => h("button", { class: "arc-ip-catbtn", "data-tip": tr(`picker.cat.${cat}`), "data-test": `ip-cat-${cat}`, onclick: () => { grid.querySelector<HTMLElement>(`[data-cat="${cat}"]`)?.scrollIntoView({ block: "start" }); } }, CAT_ICON[cat])));
        fill();
        setTimeout(() => search.focus(), 30);
        return [h("div", { class: "arc-ip-searchrow" }, search, toneBtn), grid, cats];
    };
    const iconPage = () => [h("div", { class: "arc-ip-grid arc-ip-icons", "data-test": "ip-grid" }, SPACE_SYMBOLS.map(n => h("button", { class: `arc-ip-cell${cur === `sym:${n}` ? " on" : ""}`, "data-tip": n, "data-test": `sym:${n}`, onclick: () => pick(`sym:${n}`) }, symIcon(n, 18))))];
    const draw = () => {
        segs.forEach((b, i) => b.classList.toggle("on", (i === 0) === (tab === "emoji")));
        body.dataset.kind = tab;
        body.replaceChildren(...(tab === "emoji" ? emojiPage() : iconPage()));
    };
    draw();
    const head = h("div", { class: "arc-ip-head" },
        h("div", { class: "arc-ip-segs", role: "tablist" }, ...segs),
        !cur ? null : h("button", { class: "arc-icon-btn arc-ip-del", style: "min-width: 22px", "aria-label": tr("spaces.iconRemove"), "data-test": "emoji:none", onclick: () => pick("") }, svgIcon("trashIcomoon", 15)));
    const menu = openPanel(at, [head, body], "arc-picker arc-icon-picker");
    if (menu) {
        const r = menu.getBoundingClientRect();
        menu.dataset.arrow = r.top >= at.y ? "top" : "bottom";
        menu.style.setProperty("--ip-ax", `${Math.max(14, Math.min(r.width - 14, at.x - r.left))}px`);
    }
    return menu;
}

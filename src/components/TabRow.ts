/* 通用的标签行组件（对应 Void++ src/components 下的共享组件） */
import { displayUrl } from "@api/displayUrl";
import "@components/ArcTooltip";
import { safe } from "@api/ErrorLog";
import { tr } from "@api/i18n";
import { icon as svgIcon } from "@api/icons";
import { h } from "@api/dom";
import { faviconUrl } from "@utils/misc";
import { emptyFavicon, withEmptyFallback } from "@components/EmptyFavicon";
import { spaceIconNode } from "@api/spaceIcons";

/* 偏离斜杠：Arc SlashView 画出的直线（pinned-drift.md §1）：4×15，(1,1)→(w−1,h−1)（AppKit 坐标 = 视觉左下→右上），线宽 2 圆头；无 tooltip（§3） */
const SVG_NS = "http://www.w3.org/2000/svg";
function driftSlash(): SVGSVGElement {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "arc-drift");
    svg.setAttribute("width", "4"); svg.setAttribute("height", "15"); svg.setAttribute("viewBox", "0 0 4 15");
    svg.setAttribute("aria-hidden", "true");
    const l = document.createElementNS(SVG_NS, "line");
    l.setAttribute("x1", "1"); l.setAttribute("y1", "14"); l.setAttribute("x2", "3"); l.setAttribute("y2", "1");
    l.setAttribute("stroke", "currentColor"); l.setAttribute("stroke-width", "2"); l.setAttribute("stroke-linecap", "round");
    svg.appendChild(l);
    return svg;
}

export interface TabRowProps {
    title: string;
    url?: string;
    favIconUrl?: string;
    active?: boolean;
    open?: boolean;
    audible?: boolean;
    muted?: boolean;
    indent?: number;
    /** 右按钮的动作（pinned-hover.md §F/R3）：close = “−” + “Close this item”（已打开的固定项）；archive = “✕” + “Archive this item”（今日标签 / 未打开的固定项，默认） */
    closeAction?: "close" | "archive";
    /** 右按钮 tooltip 文案覆盖（默认按 closeAction 取 Rea 的文案） */
    closeTitle?: string;
    onClick(e: MouseEvent): void;
    onClose?(): void;
    onContextMenu?(e: MouseEvent): void;
    /** MultiSelect 用的选择键（"tab:<id>" / "pin:<nodeId>"） */
    selectKey?: string;
    drag?: { data: string; onDrop?(data: string, before: boolean, e: DragEvent): void };
    /** 固定标签已偏离固定的网址：标题前显示 “/”，点图标可重置 */
    drifted?: boolean;
    onIconClick?(e: MouseEvent): void;
    /** 打开的标签 id：可点音频图标静音、拖出侧边栏生成新窗口 */
    tabId?: number;
    /** 双击标题就地重命名（空字符串 = 清除自定义名称） */
    onRename?(title: string): void;
    /** 用户设过自定义名称（titleStore / customTitle 有值）：仅此时 tooltip 副标题显示「双击重命名」 */
    renamed?: boolean;
    /** 右键 Change Icon 设的图标（Arc 标签菜单组 3 FUN_102ed7130，menus-spec.md §3.2）：emoji 或 "sym:<名>"，代替 favicon */
    customIcon?: string;
}

/** 就地编辑标题：Enter 保存，Esc / 失焦取消或保存 */
export function inlineRename(span: HTMLElement, current: string, done: (v: string) => void) {
    const input = h("input", { class: "arc-input arc-rename", value: current }) as HTMLInputElement;
    let finished = false;
    const finish = (save: boolean) => { if (finished) return; finished = true; input.replaceWith(span); if (save && input.value !== current) done(input.value.trim()); };
    input.addEventListener("keydown", e => { e.stopPropagation(); if (e.key === "Enter") finish(true); else if (e.key === "Escape") finish(false); });
    input.addEventListener("blur", () => finish(true));
    input.addEventListener("click", e => e.stopPropagation());
    span.replaceWith(input);
    input.focus(); input.select();
}

/** 浮在某元素上方的单行编辑框（用于编辑固定项 / 收藏的网址），Enter / 失焦保存，Esc 取消 */
export function floatingEdit(anchor: Element, current: string, done: (v: string) => void) {
    const r = anchor.getBoundingClientRect();
    const input = h("input", { class: "arc-input arc-rename arc-float-edit", value: current, "data-test": "float-edit",
        style: `position:fixed;left:${Math.max(4, r.left)}px;top:${r.top}px;width:${Math.max(220, r.width)}px;z-index:1000` }) as HTMLInputElement;
    let finished = false;
    const finish = (save: boolean) => { if (finished) return; finished = true; input.remove(); if (save && input.value.trim() && input.value !== current) done(input.value.trim()); };
    input.addEventListener("keydown", e => { e.stopPropagation(); if (e.key === "Enter") finish(true); else if (e.key === "Escape") finish(false); });
    input.addEventListener("blur", () => finish(true));
    document.body.append(input);
    input.focus(); input.select();
}

/** Change Icon 的选择器锚点：行内图标下方（NSPopover 锚点源码未找到 ⛔，用图标位置；行不在时退回左上） */
export function rowIconAnchor(selKey: string): { x: number; y: number } {
    const el = document.querySelector(`.arc-tab[data-sel="${CSS.escape(selKey)}"] .arc-fav`) ?? document.querySelector(`.arc-tab[data-sel="${CSS.escape(selKey)}"]`);
    const r = el?.getBoundingClientRect();
    return r ? { x: r.left, y: r.bottom + 4 } : { x: 40, y: 60 };
}

export function TabRow(p: TabRowProps): HTMLElement {
    // 左图标不再有 tooltip（pinned-hover.md：Arc 没有 “Back to pinned tab” tooltip，那行字是行内 hover 副标题，见 TabRow 下方 hoverSubtitle）
    const iconBtn = (el: SVGSVGElement) => { if (p.onIconClick) el.classList.add("arc-fav-btn"); return el; };
    const icon = p.favIconUrl && !p.favIconUrl.startsWith("chrome://") ? p.favIconUrl : faviconUrl(p.url);
    const row = h("div", {
        class: `arc-tab arc-row${p.active ? " active" : ""}${p.open === false ? " closed" : ""}`,
        style: p.indent ? `padding-left:${10 + p.indent * 16}px` : undefined,
        /* 行悬停提示（tooltip-row.md「副标题定案」）：标题 = 自定义名（改过名）否则页面标题（FUN_10217e178：tidyTabTitles → 页面标题 → savedTitle → URL，
         * rRT/0x10217e178.c L69–73）；副标题 FUN_1002b5cd4（rRT/0x1002b5cd4.c L16–25）只有两支：无自定义名 → "Double-click to rename"，有 → 无。
         * 固定标签偏离固定网址同样只看是否改名（定案表 (c)）。撤销 52034 起的 host 提示（host 只属行内副标题 B.1，开发者模式，不进 tooltip）
         * 以及 chrome-extension:// 短形式例外。门槛 +0x10（推测“可重命名”）⛔ → 用 onRename 是否存在。
         * 下面 data-tip-anchor / delay / max-width 为给 ArcTooltip 的声明（cursor 锚点 8、1.5s、maxWidth 500，tooltip-row.md 构造点表 TabCellView
         * rRT/0x100365538.c L44）；由 ArcTooltip 读取。 */
        "data-tip": (p.title || p.url || "").trim() || null, "data-url": p.url || null,
        "data-tip-subtitle": p.onRename && !p.renamed ? tr("tab.renameHint") : null,
        "data-tip-anchor": "cursor", "data-tip-delay": "1.5", "data-tip-max-width": "500",
        draggable: p.drag ? "true" : undefined,
        "data-sel": p.selectKey,
        // 图标点击走行级委托：withEmptyFallback 会把 <img> 换成 <svg>，直接挂在 img 上的监听会丢（52041 P0 自测连锁失败的根因）
        onclick: (e: MouseEvent) => {
            /* 图标区 = Arc BackgroundRegion 0（行左缘 → 斜杠左缘 = 24 图标槽右缘，pinned-slash.md §3.2；只有 region 0 发 reset，pinned-hover.md §9.2）：偏离行里整个图标区都算点图标，
             * 和 hover 副标题的判定同一条线（图标 → 斜杠之间 4px 的槽留白不是点击区的话，会出现副标题亮着、点下去却是激活标签）。右按钮 / 静音钮除外。 */
            const tgt = e.target as Element | null, sl = p.drifted ? (e.currentTarget as HTMLElement).querySelector(".arc-drift") : null;
            const inIconZone = !!sl && sl.getBoundingClientRect().width > 0 && e.clientX < sl.getBoundingClientRect().left && !tgt?.closest?.(".arc-tab-close, .arc-audio");
            if (p.onIconClick && (tgt?.closest?.(".arc-fav-btn") || inIconZone)) { e.stopPropagation(); p.onIconClick(e); return; } p.onClick(e);
        },
        onauxclick: (e: MouseEvent) => { if (e.button === 1 && p.onClose) { e.preventDefault(); p.onClose(); } },
        oncontextmenu: p.onContextMenu,
    },
    // 无 favicon / 加载失败 / 只是浏览器默认地球 → Arc EmptyFavicon 占位（archive-page.md §9）
    p.customIcon ? h("span", { class: `arc-fav arc-fav-custom${p.onIconClick ? " arc-fav-btn" : ""}`, "data-test": "tab-custom-icon", "aria-hidden": "true" }, spaceIconNode(p.customIcon, 16))
        : icon ? withEmptyFallback(h("img", { class: `arc-fav${p.onIconClick ? " arc-fav-btn" : ""}`, src: icon, alt: "" }) as HTMLImageElement) : iconBtn(emptyFavicon()),
    p.drifted ? driftSlash() : null,
    h("span", { class: "arc-tab-title", ondblclick: p.onRename ? (e: MouseEvent) => { e.stopPropagation(); inlineRename(e.currentTarget as HTMLElement, p.title, p.onRename!); } : undefined }, p.title || displayUrl(p.url) || tr("today.newTab")),
    p.audible || p.muted ? h("button", {
        class: "arc-audio", "data-tip": p.muted ? tr("tab.unmute") : tr("tab.mute"), "data-test": "mute",
        onclick: (e: MouseEvent) => { e.stopPropagation(); if (p.tabId != null) void safe(chrome.tabs.update(p.tabId, { muted: !p.muted }), "tabs.update"); },
    }, svgIcon(p.muted ? "muteSlash" : "volume", 14)) : null,
    p.onClose ? closeButton() : null);
    /* 左图标 hover 副标题（pinned-hover.md §B/O3）：只在「已偏离固定网址（canResetTab）+ 指针在图标区」时出现——Arc 的 BackgroundRegion 0 = 图标区（行左缘 → 斜杠左缘），
     * 1 = 其余。出现时：标题行平移 7（方向 ⛔，取向上，让副标题落在标题下方）、副标题 alpha 0.5 淡入（0.1s easeInEaseOut）、右按钮隐藏。
     * 没有 tooltip、没有箭头图标、没有 ⌥ 的 “Separate From Pinned Tab”（那一支是推定，⛔ 不实现）。点击行为不变（⛔ 未追到）。 */
    if (p.drifted && p.onIconClick) {
        const slash = row.querySelector(".arc-drift") as SVGElement | null;
        const title = row.querySelector(".arc-tab-title") as HTMLElement | null;
        const sub = h("span", { class: "arc-tab-sub", "aria-hidden": "true", "data-test": "tab-hover-sub" }, tr("pinned.backToUrl"));
        row.append(sub);
        let inIcon = false;
        const set = (on: boolean) => {
            if (on === inIcon) return; inIcon = on;
            if (on) {
                // 副标题与标题同左缘同宽（标题行的实际位置，含缩进 / 斜杠）
                if (title) { row.style.setProperty("--arc-sub-left", title.offsetLeft + "px"); row.style.setProperty("--arc-sub-width", title.offsetWidth + "px"); }
                row.setAttribute("data-hz", "icon"); row.setAttribute("data-tip-blocked", "");
            } else { row.removeAttribute("data-hz"); row.removeAttribute("data-tip-blocked"); }
        };
        row.addEventListener("mousemove", e => { const r = slash?.getBoundingClientRect(); set(!!r && r.width > 0 && e.clientX < r.left && !(e.target as Element | null)?.closest?.(".arc-tab-close, .arc-audio")); });
        row.addEventListener("mouseleave", () => set(false));
    }
    if (p.drag) {
        const d = p.drag;
        row.addEventListener("dragstart", e => {
            e.dataTransfer!.setData("text/arc-item", d.data);
            if (p.url) e.dataTransfer!.setData("text/uri-list", p.url);
            e.dataTransfer!.effectAllowed = "copyMove";
        });
        // 拖出侧边栏（没有放到任何目标上）= 把标签移到新窗口
        row.addEventListener("dragend", e => {
            if (p.tabId == null || e.dataTransfer?.dropEffect !== "none") return;
            const outside = e.clientX < 0 || e.clientY < 0 || e.clientX > window.innerWidth || e.clientY > window.innerHeight;
            if (outside) void safe(chrome.windows.create({ tabId: p.tabId, focused: true }), "windows.create");
        });
        row.addEventListener("dragover", e => { if (d.onDrop) { e.preventDefault(); row.classList.add("drop"); } });
        row.addEventListener("dragleave", () => row.classList.remove("drop"));
        row.addEventListener("drop", e => {
            row.classList.remove("drop");
            const data = e.dataTransfer?.getData("text/arc-item");
            if (!data || !d.onDrop) return;
            e.preventDefault();
            e.stopPropagation();
            const r = row.getBoundingClientRect();
            d.onDrop(data, e.clientY < r.top + r.height / 2, e);
        });
    }
    return row;

    /** 右按钮（pinned-hover.md §2.4 SidebarCellButtonCloseContentView）：内容 14×14、点击区 24；两条 CALayer 横条 14×2、圆角 1：
     * ✕ = 两条分别旋转 ±π/4；− = 恒等（单条横线可见，这里只画一条）。颜色沿用现状 ⛔。只用于固定 / Today 行（TabRow 的唯一调用方）；
     * 其它行的 ✕ 仍是 SmallCloseButton（ARC_ICONS.x），不在这里。
     * tooltip：anchor bottomTrailing（edge 7）、延迟 0.45s；悬停在按钮上时行 tooltip 取消（Cat 定案，Rea ⛔）。 */
    function closeButton(): HTMLElement {
        const action = p.closeAction ?? "archive";
        const bar = () => h("i", { class: "arc-cb" });
        const glyph = h("span", { class: `arc-cg arc-cg-${action === "close" ? "minus" : "x"}`, "aria-hidden": "true" }, ...(action === "close" ? [bar()] : [bar(), bar()]));
        return h("button", {
            class: `arc-tab-close arc-tab-close-${action}`, "data-tip": p.closeTitle ?? (action === "close" ? tr("tab.closeThisItem") : tr("tab.archiveThisItem")),
            "data-tip-edge": "7", "data-tip-delay": "0.45", "data-tip-block": "",
            onclick: (e: MouseEvent) => { e.stopPropagation(); row.classList.add("archiving"); p.onClose!(); },
        }, glyph);
    }
}

/** 打开 URL：已有 tabId 则激活，否则新建，并返回 tabId */
export async function focusOrOpen(tabId: number | undefined, url: string): Promise<number | undefined> {
    if (tabId != null) {
        const t = await chrome.tabs.get(tabId).catch((e: unknown) => { if (!/No tab with id/.test(String((e as Error)?.message ?? e))) void safe(Promise.reject(e), "TabRow tabs.get"); return null; }); // 标签已关是预期情形（回退新建），其它失败记日志
        if (t?.id != null) { await chrome.tabs.update(t.id, { active: true }); await chrome.windows.update(t.windowId, { focused: true }); return t.id; }
    }
    const t = await chrome.tabs.create({ url, active: true });
    return t.id;
}

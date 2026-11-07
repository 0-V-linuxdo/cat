/* 通用的标签行组件（对应 Void++ src/components 下的共享组件） */
import { displayUrl } from "@api/displayUrl";
import "@components/ArcTooltip";
import { safe } from "@api/ErrorLog";
import { ensureNativeAck, sidebarSwitchAck } from "@api/HostMode";
import { tr } from "@api/i18n";
import { icon as svgIcon } from "@api/icons";
import { h } from "@api/dom";
import { Z } from "@utils/zLayers";
import { faviconUrl } from "@utils/misc";
import { emptyFavicon, favNode, withEmptyFallback } from "@components/EmptyFavicon";
import { spaceIconNode } from "@api/spaceIcons";
import { REHOVER } from "@api/keepHover";

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
    /** 固定项保存的网址（PinNode.url）：偏离行图标区悬停时图标换成它的 favicon（rel48 ①，推导数据源 ⚠：Arc 的 resetTabIcon = 固定项保存的 favicon / 自定义图标；Cat 没有存 favicon 字段，用 _favicon 现取） */
    savedUrl?: string;
    /** 打开的标签 id：可点音频图标静音、拖出侧边栏生成新窗口 */
    tabId?: number;
    /** 补丁 t903u-tab-switch v2：已打开标签此刻的 tab.url（空串 = 未提交 / 判不出）；有 tabId 时写进 data-pw-tab-url，页内预热按它判目的地类型 */
    tabUrl?: string;
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
        style: `position:fixed;left:${Math.max(4, r.left)}px;top:${r.top}px;width:${Math.max(220, r.width)}px;z-index:${Z.inlineEdit}` }) as HTMLInputElement;
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

/** 最近一次指针位置（视口坐标）：整屏重绘后指针不动时，按它重新判定图标区 */
const pointer = { x: -1, y: -1 };
let tracking = false;
function trackPointer() {
    if (tracking) return; tracking = true;
    document.addEventListener("mousemove", e => { pointer.x = e.clientX; pointer.y = e.clientY; }, true);
}

/* rel47 ⌘ 修饰键（pinned-icon-hover.md 结论 1 / 「Cmd / Option 更正」，Rea ✅；旧稿写 Option 是误判）：hoverSubtitleState = (modifierFlags >> 3) & 1，modifierFlags 是 Arc 自己的 OptionSet（FUN_1009a223c 由 NSEvent.ModifierFlags 转换：command → 8），bit3 = Command。
 * 图标区悬停且按住 ⌘ → 第二行「Separate From Pinned Tab」，否则「Back to Pinned URL」；⌘ 只在图标区有效，标题区悬停 ⌘ 无变化（hoverSubtitleState 仍 nil）。
 * 实时切换 ✅：flagsChanged 本地 monitor（FUN_100368024，mask 0x1000）持续更新 regionHoverState.modifierFlags，悬停中按下 / 松开 ⌘ 即时切文案。
 * 文案切换本身的动画：源码未找到（只有「标题上移 + 第二行淡入」的 0.1s easeInEaseOut）→ 直接换字、不加动画。 */
let metaDown = false, metaTracking = false;
const hoverSubText = () => tr(metaDown ? "pinned.separate" : "pinned.backToUrl");
/* rel48 ① 图标换图（pinned-icon-hover.md 结论 3，Rea ✅：图标区悬停且没按 ⌘ → iconView 换 resetTabIcon，按 ⌘ / 离开 → 当前页图标；直接 setImage，无动画、无缩放）。
 * 数据源是推导 ⚠：Arc 的 resetTabIcon = 固定项保存的 favicon / 自定义图标；Cat 的 PinNode 没有 favicon 字段（不新增存储），所以用保存网址（data-saved-fav = faviconUrl(PinNode.url)，扩展 _favicon 接口，manifest 已有 "favicon" 权限）。
 * 状态全放在行 DOM 上：data-fav-orig 记着「换图前的图标」（"img:<src>" / "svg" 占位），有它 = 正在显示保存图标；重绘（keepHover.morphInto）摘掉属性、图标回到新树的当前页图标后，REHOVER → applyMeta 重新判定补回。
 * 直接换节点（无过渡、无缩放）；保存网址没有 favicon 时 withEmptyFallback 把默认地球换成占位，与行里其它 favicon 一致。 */
function syncIcon(rw: HTMLElement) {
    const saved = rw.getAttribute("data-saved-fav");
    if (!saved) return;
    const el = rw.querySelector<Element>(".arc-fav:not(.arc-fav-custom)");
    if (!el) return;
    const want = rw.hasAttribute("data-hz") && !metaDown, orig = rw.getAttribute("data-fav-orig");
    const make = (src: string | null): Element => {
        const n: Element = src == null ? emptyFavicon() : withEmptyFallback(h("img", { class: "arc-fav", src, alt: "" }) as HTMLImageElement);
        for (const c of Array.from(el.classList)) if (c !== "arc-fav-empty") n.classList.add(c);
        return n;
    };
    if (want && orig == null) { rw.setAttribute("data-fav-orig", el.tagName === "IMG" ? "img:" + (el.getAttribute("src") ?? "") : "svg"); el.replaceWith(make(saved)); }
    else if (!want && orig != null) { rw.removeAttribute("data-fav-orig"); el.replaceWith(make(orig.startsWith("img:") ? orig.slice(4) : null)); }
}
function applyMeta() {
    const t = hoverSubText();
    for (const s of document.querySelectorAll<HTMLElement>('.arc-tab[data-hz="icon"] > .arc-tab-sub')) if (s.textContent !== t) s.textContent = t;
    for (const r of document.querySelectorAll<HTMLElement>(".arc-tab[data-saved-fav]")) syncIcon(r);
}
function trackMeta() {
    if (metaTracking) return; metaTracking = true;
    const sync = (meta: boolean) => { if (meta !== metaDown) { metaDown = meta; applyMeta(); } };
    window.addEventListener("keydown", e => sync(e.metaKey), true);
    window.addEventListener("keyup", e => sync(e.metaKey), true);
    document.addEventListener("mousemove", e => sync(e.metaKey), true);
    window.addEventListener("blur", () => sync(false)); // 失焦后收不到 keyup：按 Arc 的 activeInKeyWindow（离开 key window 即无 hover），回到默认文案
}

const prewarmed = new Set<string>();
export function TabRow(p: TabRowProps): HTMLElement {
    // 左图标不再有 tooltip（pinned-hover.md：Arc 没有 “Back to pinned tab” tooltip，那行字是行内 hover 副标题，见 TabRow 下方 hoverSubtitle）
    const iconBtn = (el: SVGSVGElement) => { if (p.onIconClick) el.classList.add("arc-fav-btn"); return el; };
    const icon = p.favIconUrl && !p.favIconUrl.startsWith("chrome://") ? p.favIconUrl : faviconUrl(p.url);
    /* rel48 ①：只有偏离行（canResetTab）+ 没设自定义图标（customIcon 优先沿用现有逻辑，本来就是行图标，悬停前后一致）+ 有保存网址才换图；预热 _favicon 缓存，换图时直接出图 */
    const savedFav = p.drifted && p.onIconClick && !p.customIcon && p.savedUrl ? faviconUrl(p.savedUrl) : "";
    if (savedFav && !prewarmed.has(savedFav)) { if (prewarmed.size > 300) prewarmed.clear(); prewarmed.add(savedFav); new Image().src = savedFav; } // favicon-jitter：每次重绘都 new Image() 一次太多，同一网址只预热一次
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
        "data-saved-fav": savedFav || null,
        "data-tip-subtitle": p.onRename && !p.renamed ? tr("tab.renameHint") : null,
        "data-tip-anchor": "cursor", "data-tip-delay": "1.5", "data-tip-max-width": "500",
        draggable: p.drag ? "true" : undefined,
        "data-sel": p.selectKey,
        // 补丁 t903u-tab-switch v2：页内侧栏 pointerdown 时同步判「目的地是不是已知普通页」（prewarmTarget.ts）。已开标签按 tab.url；未开的固定项按保存网址；偏离行再看保存网址
        "data-pw-target": "tab", "data-pw-tab": p.tabId != null ? String(p.tabId) : null, "data-pw-tab-url": p.tabId != null ? (p.tabUrl ?? "") : null,
        "data-pw-url": p.tabId == null ? (p.url || null) : null, "data-pw-alt-url": p.drifted && p.onIconClick ? (p.savedUrl ?? "") : null,
        // 图标点击走行级委托：withEmptyFallback 会把 <img> 换成 <svg>，直接挂在 img 上的监听会丢（52041 P0 自测连锁失败的根因）
        onclick: (e: MouseEvent) => {
            /* 图标区 = Arc BackgroundRegion 0（行左缘 → 斜杠左缘 = 24 图标槽右缘，pinned-slash.md §3.2；只有 region 0 发 reset，pinned-hover.md §9.2）：偏离行里整个图标区都算点图标，
             * 和 hover 副标题的判定同一条线（图标 → 斜杠之间 4px 的槽留白不是点击区的话，会出现副标题亮着、点下去却是激活标签）。右按钮 / 静音钮除外。 */
            const tgt = e.target as Element | null;
            const inIconZone = !!p.drifted && inDriftIconZone(e.currentTarget as HTMLElement, e);
            if (p.onIconClick && (tgt?.closest?.(".arc-fav-btn") || inIconZone)) { e.stopPropagation(); p.onIconClick(e); return; } p.onClick(e);
        },
        onauxclick: (e: MouseEvent) => { if (e.button === 1 && p.onClose) { e.preventDefault(); p.onClose(); } },
        oncontextmenu: p.onContextMenu,
    },
    // 无 favicon / 加载失败 / 只是浏览器默认地球 → Arc EmptyFavicon 占位（archive-page.md §9）
    p.customIcon ? h("span", { class: `arc-fav arc-fav-custom${p.onIconClick ? " arc-fav-btn" : ""}`, "data-test": "tab-custom-icon", "aria-hidden": "true" }, spaceIconNode(p.customIcon, 16))
        : icon ? favNode(icon, `arc-fav${p.onIconClick ? " arc-fav-btn" : ""}`) : iconBtn(emptyFavicon()), // favNode：已知坏图 / 默认地球直接占位，不再每次重绘重新请求后再换（favicon-jitter）
    p.drifted ? driftSlash() : null,
    h("span", { class: "arc-tab-title", ondblclick: p.onRename ? (e: MouseEvent) => { e.stopPropagation(); inlineRename(e.currentTarget as HTMLElement, p.title, p.onRename!); } : undefined }, p.title || displayUrl(p.url) || tr("today.newTab")),
    p.audible || p.muted ? h("button", {
        class: "arc-audio", "data-tip": p.muted ? tr("tab.unmute") : tr("tab.mute"), "data-test": "mute",
        onclick: (e: MouseEvent) => { e.stopPropagation(); if (p.tabId != null) void safe(chrome.tabs.update(p.tabId, { muted: !p.muted }), "tabs.update"); },
    }, svgIcon(p.muted ? "muteSlash" : "volume", 14)) : null,
    p.onClose ? closeButton() : null);
    /* 左图标 hover 副标题（pinned-hover.md §B/O3）：只在「已偏离固定网址（canResetTab）+ 指针在图标区」时出现——Arc 的 BackgroundRegion 0 = 图标区（行左缘 → 斜杠左缘），
     * 1 = 其余。出现时：标题行平移 7（方向 ⛔，取向上，让副标题落在标题下方）、副标题 alpha 0.5 淡入（0.1s easeInEaseOut）、右按钮隐藏。
     * 没有 tooltip、没有箭头图标。按住 ⌘ 时第二行换成 “Separate From Pinned Tab”（rel47，见上 trackMeta）。点击行为不变（⛔ 未追到）。 */
    /* 图标换图：rel48 ① 已实现，见上 syncIcon（数据源 ⚠ 推导；customIcon 行不换，保持现有逻辑）。 */
    if (p.drifted && p.onIconClick) {
        const sub = h("span", { class: "arc-tab-sub", "aria-hidden": "true", "data-test": "tab-hover-sub" }, hoverSubText());
        row.append(sub);
        trackPointer(); trackMeta();
        /* 根因（pinned-icon-hover）：PanelShell.renderAll 在每次标签变化时整屏重建，指针下的行由 keepHover.morphInto 就地同步——旧节点留在文档里、
         * 监听换成新树登记的那批，但这批闭包里的 `row` / `title` / `slash` 全是新树里没进文档的游离节点（getBoundingClientRect 恒为空）：
         * mousemove 判区永远落空，指针不动 / 微动都进不了图标区；syncAttrs 还把运行时写的 data-hz / data-tip-blocked / --arc-sub-left 摘了。
         * → 实机表现就是 Cat 的“普通 hover”：标题不动、无第二行、「−」还在、tooltip 还弹。
         * 所以：只用 e.currentTarget（真正挂着监听的那个行），状态放在行的 data-hz 上，斜杠 / 标题现查；keepHover 同步完发 REHOVER，按最近一次指针位置重判。 */
        const set = (rw: HTMLElement, on: boolean) => {
            if (on === rw.hasAttribute("data-hz")) return;
            if (on) {
                // 副标题与标题同左缘（标题行的实际位置，含缩进 / 斜杠）；右界都到行最右
                const title = rw.querySelector(".arc-tab-title") as HTMLElement | null;
                if (title) { rw.style.setProperty("--arc-sub-left", title.offsetLeft + "px"); } // rel47 ⑤：右界由 CSS（right: 6px）定到行最右，不再写 --arc-sub-width
                rw.setAttribute("data-hz", "icon"); rw.setAttribute("data-tip-blocked", ""); applyMeta();
            } else { rw.removeAttribute("data-hz"); rw.removeAttribute("data-tip-blocked"); syncIcon(rw); }
        };
        /* capture：keepHover 换监听后本行的 mousemove 监听会排在 ArcTooltip 的后面；捕获阶段先于目标阶段，保证 data-tip-blocked 先置位再轮到 ArcTooltip 判断 */
        row.addEventListener("mousemove", e => {
            const rw = e.currentTarget as HTMLElement, r = rw.querySelector(".arc-drift")?.getBoundingClientRect();
            set(rw, !!r && r.width > 0 && e.clientX < r.left && !(e.target as Element | null)?.closest?.(".arc-tab-close, .arc-audio"));
        }, true);
        row.addEventListener(REHOVER, e => {
            const rw = e.currentTarget as HTMLElement, r = rw.querySelector(".arc-drift")?.getBoundingClientRect(), el = pointer.x >= 0 ? document.elementFromPoint(pointer.x, pointer.y) : null;
            set(rw, !!r && r.width > 0 && !!el && rw.contains(el) && pointer.x < r.left && !el.closest(".arc-tab-close, .arc-audio"));
            applyMeta(); // morph 会把第二行文案同步回新树的默认值：按当前 ⌘ 状态补回
        });
        row.addEventListener("mouseleave", e => set(e.currentTarget as HTMLElement, false));
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
        /* rel42 hover-rerender：拖放监听一律用 e.currentTarget，不用闭包里的 row——悬停重绘时 keepHover 把这批监听换到留在文档里的旧行上，
         * 闭包 row 是新树里没进文档的游离节点（drop 线加不上、getBoundingClientRect 恒为 0 → 前 / 后判反）。同 pinned-icon-hover ROOTCAUSE。 */
        const self = (e: Event) => e.currentTarget as HTMLElement;
        row.addEventListener("dragover", e => { if (d.onDrop) { e.preventDefault(); self(e).classList.add("drop"); } });
        row.addEventListener("dragleave", e => self(e).classList.remove("drop"));
        row.addEventListener("drop", e => {
            const el = self(e);
            el.classList.remove("drop");
            const data = e.dataTransfer?.getData("text/arc-item");
            if (!data || !d.onDrop) return;
            e.preventDefault();
            e.stopPropagation();
            const r = el.getBoundingClientRect();
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
            // rel42 hover-rerender：按钮在悬停重绘后可能挂在旧行里，闭包 row 是新树的游离行 → archiving（淡出动画 + 锁点击）落空；按实际所在行找
            onclick: (e: MouseEvent) => { e.stopPropagation(); (e.currentTarget as HTMLElement).closest(".arc-tab")?.classList.add("archiving"); p.onClose!(); },
        }, glyph);
    }
}

/** 打开 URL：已有 tabId 则激活，否则新建，并返回 tabId */
/** 偏离行的图标区判定（行左缘 → 斜杠左缘，右按钮 / 静音钮除外）：TabRow 的行点击委托与 multiSelect 的 ⌘ 单击放行共用（rel47 ⑦） */
export function inDriftIconZone(row: HTMLElement, e: MouseEvent): boolean {
    const sl = row.querySelector(".arc-drift");
    return !!sl && sl.getBoundingClientRect().width > 0 && e.clientX < sl.getBoundingClientRect().left && !(e.target as Element | null)?.closest?.(".arc-tab-close, .arc-audio");
}

export async function focusOrOpen(tabId: number | undefined, url: string): Promise<number | undefined> {
    if (tabId != null) { const sw = sidebarSwitchAck(url, "activate", tabId); if (sw && await sw) return tabId; } // 补丁 pinned-first-frame（层 6 同款）：原生侧栏里点已开的标签 → 页内：由 SW 关原生、等目的标签按「已展开」摆好再激活（页面自己 tabs.update 会和 SW 抢跑：激活的第一帧还是旧的全宽状态）；SW 没接管 = 照老路
    const ack = ensureNativeAck(url, tabId != null ? "activate" : "create", tabId); // 页内侧栏：目的地是受限页就先切原生（同步、第一件事；激活时拿传入的 url 当目的地，⚠ 现存标签可能已导航走）
    if (ack) await ack; // patch 07：等 SW 的 ack（最多 500 ms，超时照常导航）再激活 / 新建，保证「先切后进」的顺序；没发消息时没有这一个 await
    if (tabId != null) {
        const t = await chrome.tabs.get(tabId).catch((e: unknown) => { if (!/No tab with id/.test(String((e as Error)?.message ?? e))) void safe(Promise.reject(e), "TabRow tabs.get"); return null; }); // 标签已关是预期情形（回退新建），其它失败记日志
        if (t?.id != null) { await chrome.tabs.update(t.id, { active: true }); await chrome.windows.update(t.windowId, { focused: true }); return t.id; }
    }
    const t = await chrome.tabs.create({ url, active: true });
    return t.id;
}

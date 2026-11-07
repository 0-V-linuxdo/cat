/* rel42：站点控制顶部按钮行对齐 Arc（/workspace/arc-analysis/scc-action-buttons.md，FUN_101388a14 / FUN_101372ed8 / FUN_101372d34）。
 * 读源码 + 字形数据断言；真实点按 / 尺寸 / 菜单 / 复制 / 拖框截取在 selftest「C1 站点控制 · 顶部按钮行」。 */
import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { SF_GLYPHS } from "../src/api/icons";
import { cleanUrlDetailed } from "../src/plugins/cleanUrls/clean";
import en from "../src/i18n/en";
import zh from "../src/i18n/zh";

const r = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const sc = r("src/plugins/views/siteControls/index.ts");
const region = r("src/plugins/views/siteControls/regionCapture.ts");
const css = r("src/plugins/command/style.ts");
const G = SF_GLYPHS as Record<string, { src: string; pt: number; w: number; h: number; vb: string; body: string }>;
const E = en as Record<string, string>, Z = zh as Record<string, string>;
const topRow = sc.slice(sc.indexOf('const top = h("div", { class: "arc-sc-top"'), sc.indexOf('const grid = h("div"'));

test("顺序 = Share | Copy URL | Capture portion | Capture full page（boostsEnabled=false → copyURL；captureEnabled=true；⌥ Portrait 未做）", () => {
    const share = sc.indexOf('"data-test": "sc-share"'), copy = sc.indexOf('"data-test": "sc-copy"'), cap = sc.indexOf('"data-test": "sc-capture"'), full = sc.indexOf('"data-test": "sc-shot"');
    expect(share).toBeGreaterThan(0);
    expect(share < copy && copy < cap && cap < full).toBe(true);
    expect(topRow).toMatch(/^const top = h\("div", \{ class: "arc-sc-top", "data-test": "sc-top" \},\s*share,\s*h\("button"[^\n]*sc-copy[^\n]*\n\s*h\("button"[^\n]*sc-capture[^\n]*\n\s*h\("button"[^\n]*sc-shot/);
});

test("「提取文字」按钮整套删除：sc-text / captureText / site.captureText / site.textCopied / site.textFailed / site.screenshot", () => {
    expect(sc).not.toMatch(/sc-text|captureText|scanText|site\.textCopied|site\.textFailed|site\.screenshot"/);
    for (const k of ["site.captureText", "site.textCopied", "site.textFailed", "site.screenshot"]) { expect(E[k]).toBeUndefined(); expect(Z[k]).toBeUndefined(); }
});

test("提示 = Arc 原文（accessibilityLabel 同 tooltip）", () => {
    expect([E["site.share"], E["site.copyUrl"], E["site.capturePortion"], E["site.captureFullPage"]]).toEqual(["Share", "Copy URL", "Capture a portion of this page", "Capture the full page"]);
    for (const k of ["site.share", "site.copyUrl", "site.capturePortion", "site.captureFullPage"]) expect(Z[k]).toBeTruthy();
    expect(topRow).toContain('"data-tip": tr("site.copyUrl")');
    expect(topRow).toContain('"data-tip": tr("site.capturePortion")');
    expect(topRow).toContain('"data-tip": tr("site.captureFullPage")');
    expect(sc).toContain('"data-test": "sc-share", "data-tip": tr("site.share")');
});

test("图标：share = SF square.and.arrow.up 16pt Regular；copy-url h17；SF camera 16pt Regular（不是 camera.fill）；capture-full-page h19", () => {
    expect(sc).toContain('icon("shareUp", 16)');
    expect(topRow).toContain('icon("link", 17)');
    expect(topRow).toContain('icon("cameraRegular", 16)');
    expect(topRow).toContain('icon("photo", 19)');
    const want = { shareUp: "square.and.arrow.up_16pt_regular.svg", cameraRegular: "camera_16pt_regular.svg" } as const;
    for (const [n, f] of Object.entries(want)) {
        const g = G[n];
        expect(g.src).toBe(`arc-icons/sf/${f}`);
        expect(g.pt).toBe(16);
        const svg = readFileSync(`/workspace/arc-icons/sf/${f}`, "utf8");
        expect(svg).toContain(`viewBox="${g.vb}"`);
        expect(svg).toContain(`width="${g.w}"`);
        expect(svg).toContain(`height="${g.h}"`);
        expect(svg.replace(/\s+/g, " ")).toContain(g.body.replace(/\s+/g, " "));
    }
    expect(G.shareUp.vb).toBe("255 -1939 1775 2246");
    expect(G.cameraRegular.vb).toBe("255 -1707 2456 1907");
});

test("布局：HStack spacing 8，按钮 48×32、圆角 6（continuous 用 6px 近似）；颜色 / hover / 禁用外观沿用（⛔）", () => {
    expect(css).toMatch(/\.arc-sc-top \{ display: flex; justify-content: center; align-items: center; gap: 8px; \}/);
    expect(css).toMatch(/\.arc-sc-top > \.arc-sc-action \{ width: 48px; height: 32px; flex: none; border-radius: 6px; \}/);
    expect(css).toMatch(/\.arc-sc-action \{ all: unset; height: 36px; border-radius: 8px;/); // 基础样式未改（Boosts 分区按钮也用它）
    expect(css).not.toMatch(/居中 ⛔|⛔ 居中/); // rel49：Arc 面板 VStack(alignment: .center) → 行水平居中已有依据
});

test("rel49 面板外框 = Arc 236 / padding 10 / VStack spacing 10（FUN_101387394）：内容区 216 = 4×48 + 3×8", () => {
    expect(css).toMatch(/\.arc-menu\.arc-panel\.arc-site-controls \{ width: min\(236px, calc\(100vw - 16px\)\); padding: 10px; gap: 10px;/);
    expect(236 - 2 * 10).toBe(4 * 48 + 3 * 8);
});

test("rel49 tooltip 延迟：顶部 4 个按钮显式 0.45s（FUN_100ddb078），不改 ArcTooltip 全局默认", () => {
    expect(topRow.match(/"data-tip-delay": "0\.45"/g)?.length).toBe(3); // copy / capture / shot
    expect(sc).toMatch(/"sc-share", "data-tip": tr\("site\.share"\), "data-tip-delay": "0\.45"/);
    expect(r("src/components/ArcTooltip.ts")).toContain("export const TOOLTIP_DELAY_S = 0.45;");
});

test("禁用：只有 share(!canShareURL) / copyURL(!canCopyURL)；两个截图按钮没有禁用条件", () => {
    expect(sc).toContain("const canShareURL = !!url, canCopyURL = !!url;");
    expect(sc).toMatch(/"sc-share"[^\n]*disabled: !canShareURL/);
    expect(topRow).toMatch(/"sc-copy"[^\n]*disabled: !canCopyURL/);
    expect(topRow).not.toMatch(/"sc-capture"[^\n]*disabled/);
    expect(topRow).not.toMatch(/"sc-shot"[^\n]*disabled/);
});

test("Share：在鼠标位置弹菜单（键盘触发退回按钮左下），面板不关；菜单项 = 系统分享 navigator.share（Copy as %@ ⛔ 不做）", () => {
    expect(sc).toContain("e.detail === 0 ? { x: r.left, y: r.bottom } : { x: e.clientX, y: e.clientY }");
    expect(sc).toMatch(/"sc-share"[^\n]*e\.stopPropagation\(\); shareMenu\(atMouse\(e, share\)/);
    expect(sc).not.toMatch(/"sc-share"[^\n]*closeMenus/);
    const menu = sc.slice(sc.indexOf("function shareMenu("), sc.indexOf("/** 点扩展"));
    expect(menu).toContain('test: "sc-share-system"');
    expect(menu).toContain("nav.share?.(data)");
    expect(menu).not.toMatch(/Copy as/);
});

test("Copy URL：先按 Arc 默认规则去跟踪参数（无条件），再叠加 copy 管线，复制后关面板；toast 两种文案", () => {
    expect(topRow).toMatch(/"sc-copy"[^\n]*onclick: \(\) => \{ closeMenus\(\); void copyCleanUrl\(url, t\.id\); \}/);
    const fn = sc.slice(sc.indexOf("export async function copyCleanUrl"), sc.indexOf("/** 「Share」"));
    expect(fn).toContain("cleanUrlDetailed(url)");
    expect(fn).toContain('applyUrlTransformsDetailed("copy", arc.url)');
    expect(fn).toContain("arc.changed ? CLEAN_TOAST_KEY : copyToastKey(r)");
    const a = cleanUrlDetailed("https://example.com/?utm_source=x&a=1");
    expect(a).toEqual({ url: "https://example.com/?a=1", changed: true });
    expect(cleanUrlDetailed("https://example.com/?a=1").changed).toBe(false);
    expect(E["tab.copiedLink"]).toBe("Copied Current URL");
    expect(r("src/plugins/cleanUrls/i18n.ts")).toContain('"cleanUrls.copiedClean": "Copied a clean link without trackers"');
});

test("Capture portion：关面板 → Capture 插件的 capture.start，没开则注入拖框覆盖层 → captureVisibleTab → 裁剪 → 下载 + 剪贴板", () => {
    expect(topRow).toMatch(/"sc-capture"[^\n]*onclick: \(\) => \{ closeMenus\(\); void capturePortion\(t\); \}/);
    const fn = sc.slice(sc.indexOf("async function capturePortion"), sc.indexOf("/** 「Copy URL」"));
    expect(fn).toContain('commands.get("capture.start")');
    expect(fn).toContain("func: pickRegion, args: [pickStyle()]");
    expect(fn).toContain("cropShot(await chrome.tabs.captureVisibleTab(");
    expect(fn).toContain("await saveShot(t, png)");
    // 覆盖层：Esc / 右键 / 小于 CLICK_SLOP 取消；提示 = Arc 气泡原文；光标 = Arc camera-cross-cursor
    expect(region).toContain('if (e.key === "Escape")');
    expect(region).toContain('addEventListener("contextmenu"');
    expect(region).toContain("< st.slop ? null : r");
    expect(region).toContain('hint: tr("capture.hintDrag")');
    expect(region).toContain("cursor: CURSOR");
    expect(r("src/plugins/capture/i18n.ts")).toContain("Drag to capture a portion of this page");
});

test("Capture full page：保留原截图逻辑（captureVisibleTab，只截可视区域）→ 下载 + 剪贴板，关面板", () => {
    expect(topRow).toMatch(/"sc-shot"[^\n]*onclick: \(\) => \{ closeMenus\(\); void screenshot\(t\); \}/);
    const fn = sc.slice(sc.indexOf("async function screenshot"), sc.indexOf("/** 「Capture a portion"));
    expect(fn).toContain('chrome.tabs.captureVisibleTab(t.windowId, { format: "png" })');
    expect(sc).toContain("filename: `Screenshot ${host} ${stamp}.png`");
});

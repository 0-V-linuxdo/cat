import { describe, expect, test } from "bun:test";
import { ACTIONS, captureFilename, captureScale, captureStamp, cropRect, isClick, isDragCombo, MENU, menuItems, moveSelection, portraitLayout, rectFromDrag, zoomPlan, atTop, FULL_PAGE_DELAY_MS, SCROLL_EPSILON } from "../src/plugins/capture/logic";

describe("裁剪计算", () => {
    test("拖框任意方向都规范化", () => {
        expect(rectFromDrag({ x: 50, y: 80 }, { x: 10, y: 20 })).toEqual({ x: 10, y: 20, width: 40, height: 60 });
    });
    test("单击判定", () => { expect(isClick({ x: 0, y: 0 }, { x: 2, y: 2 })).toBe(true); expect(isClick({ x: 0, y: 0 }, { x: 5, y: 0 })).toBe(false); });
    test("按倍率换算并取整（向外扩）", () => {
        expect(cropRect({ x: 10.4, y: 5.6, width: 20.2, height: 10 }, 2, 2000, 1000)).toEqual({ x: 20, y: 11, width: 42, height: 21 });
    });
    test("超出图片范围时裁到边界", () => {
        expect(cropRect({ x: -10, y: -10, width: 30, height: 30 }, 1, 100, 100)).toEqual({ x: 0, y: 0, width: 20, height: 20 });
        expect(cropRect({ x: 90, y: 90, width: 30, height: 30 }, 1, 100, 100)).toEqual({ x: 90, y: 90, width: 10, height: 10 });
    });
    test("无面积 / 完全在外返回 null", () => {
        expect(cropRect({ x: 5, y: 5, width: 0, height: 10 }, 1, 100, 100)).toBeNull();
        expect(cropRect({ x: 200, y: 0, width: 10, height: 10 }, 1, 100, 100)).toBeNull();
    });
    test("倍率由图片宽 / 视口宽算出", () => { expect(captureScale(2560, 1280)).toBe(2); expect(captureScale(100, 0)).toBe(1); });
});

describe("整页：JS 缩放（Arc JavascriptUtils）", () => {
    test("一屏放得下时不缩放", () => expect(zoomPlan(800, 700, 1000, 800)).toEqual({ scale: 1, rect: { x: 0, y: 0, width: 800, height: 700 } }));
    test("长页面按高度缩进一个视口", () => {
        const p = zoomPlan(1000, 4000, 1000, 800);
        expect(p.scale).toBe(0.2);
        expect(p.rect).toEqual({ x: 0, y: 0, width: 200, height: 800 });
    });
    test("宽页面按宽度缩", () => expect(zoomPlan(2000, 500, 1000, 800).scale).toBe(0.5));
    test("非法尺寸不缩放", () => expect(zoomPlan(0, 0, 1000, 800).scale).toBe(1));
    test("滚动到顶判断用 epsilon 3", () => { expect(SCROLL_EPSILON).toBe(3); expect(atTop(3)).toBe(true); expect(atTop(4)).toBe(false); expect(FULL_PAGE_DELAY_MS).toBe(500); });
    test("page.ts 不再滚动拼接", async () => {
        const page = await Bun.file("src/plugins/capture/page.ts").text();
        expect(page).toContain('transformOrigin = "top left"');
        expect(page).toContain('scale(${scale})');
        expect(page).not.toMatch(/scrollPlan|stitchSlice/);
        expect(await Bun.file("src/plugins/capture/index.ts").text()).toContain("降级实现");
    });
    test("Portrait 留白", () => expect(portraitLayout(1000, 500)).toEqual({ canvasW: 1120, canvasH: 620, pad: 60 }));
});

describe("文件名", () => {
    const d = new Date(2026, 0, 5, 7, 8, 9);
    test("yyyy-MM-dd-HHmmss", () => expect(captureStamp(d)).toBe("2026-01-05-070809"));
    test("默认文件名", () => expect(captureFilename(d)).toBe("Capture 2026-01-05-070809.png"));
    test("23 点 / 12 月", () => expect(captureStamp(new Date(2026, 11, 31, 23, 59, 0))).toBe("2026-12-31-235900"));
});

describe("操作菜单", () => {
    test("规格尺寸与配色", () => {
        expect([MENU.width, MENU.radius, MENU.textPadding]).toEqual([273, 7, 20]);
        expect([MENU.light.bg, MENU.dark.bg, MENU.light.selected, MENU.dark.selected]).toEqual(["#FFFFFF", "#120F2E", "#292EC1", "#292EC1"]);
    });
    test("8 个操作，按 Arc 枚举顺序；不支持的不可用", () => {
        const items = menuItems({ savedToLibrary: false });
        expect(items.map(i => i.action)).toEqual([...ACTIONS]);
        expect(items.length).toBe(8);
        expect(items.filter(i => i.enabled).map(i => i.action)).toEqual(["copyImage", "saveAsFile", "toggleSaveToLibrary", "retake"]);
    });
    test("存入资料库是开关，文案随状态变化", () => {
        expect(menuItems({ savedToLibrary: false })[5]).toMatchObject({ label: "capture.saveToLibrary", toggled: false });
        expect(menuItems({ savedToLibrary: true })[5]).toMatchObject({ label: "capture.savedToLibrary", toggled: true });
    });
    test("↑↓ 跳过不可用项并循环", () => {
        const items = menuItems({ savedToLibrary: false });
        expect(moveSelection(items, -1, 1)).toBe(1);
        expect(moveSelection(items, 1, 1)).toBe(3);
        expect(moveSelection(items, 6, 1)).toBe(1);
        expect(moveSelection(items, -1, -1)).toBe(6);
        expect(moveSelection(items, 1, -1)).toBe(6);
        expect(moveSelection(items.map(i => ({ ...i, enabled: false })), 2, 1)).toBe(-1);
    });
    test("⌘⇧ 拖动组合", () => {
        const e = { metaKey: true, ctrlKey: false, shiftKey: true, altKey: false, button: 0 };
        expect(isDragCombo(e, true)).toBe(true);
        expect(isDragCombo(e, false)).toBe(false);
        expect(isDragCombo({ ...e, metaKey: false, ctrlKey: true }, false)).toBe(true);
        expect(isDragCombo({ ...e, altKey: true }, true)).toBe(false);
        expect(isDragCombo({ ...e, button: 2 }, true)).toBe(false);
    });
});

describe("Capture：验收 51946 视觉值", () => {
    test("提示气泡用规格配色 OverlayBubbleBlue / OverlayBubbleText", async () => {
        const { OVERLAY_BUBBLE } = await import("../src/plugins/capture/logic");
        expect(OVERLAY_BUBBLE.background).toBe("#FFFFFF");
        expect(OVERLAY_BUBBLE.radius).toBe(16);
        expect(OVERLAY_BUBBLE.text).toBe("rgba(52,5,148,.8)");
        expect(OVERLAY_BUBBLE.font).toContain("600 14px");
        expect(OVERLAY_BUBBLE.css).toContain("linear-gradient(90deg,#FF9999 70%,#0047FF 110%) border-box");
        expect(OVERLAY_BUBBLE.css).toContain("border:1px solid transparent");
        expect(OVERLAY_BUBBLE.css).not.toContain("background:#0047FF");
    });
    test("自定视觉值集中在常量里并标注「源码未找到，自定值」，page.ts 不再写死", async () => {
        const { CUSTOM_VISUALS, PORTRAIT } = await import("../src/plugins/capture/logic");
        for (const k of ["shadeFilter", "shadeColor", "focusBorder", "focusRadius", "focusTransition", "previewShadow", "menuShadow"] as const) expect(CUSTOM_VISUALS[k]).toBeDefined();
        expect(PORTRAIT.padRatio).toBeGreaterThan(0);
        const logic = await Bun.file("src/plugins/capture/logic.ts").text();
        expect(logic.match(/源码未找到，自定值/g)!.length).toBeGreaterThanOrEqual(6);
        const page = await Bun.file("src/plugins/capture/page.ts").text();
        for (const lit of ["grayscale(1) brightness(0.6)", "2px solid #fff", "cubic-bezier", "0 10px 40px", "color:#fff;font:600"]) expect(page).not.toContain(lit);
        expect(page).toContain("OVERLAY_BUBBLE.css");
    });
});

describe("Capture：整页只用 JS 缩放（无法对齐：需要内核）", () => {
    test("没有 CDP / debugger 分支、开关、可选权限和文案", async () => {
        const files = await Promise.all(["index.ts", "page.ts", "logic.ts", "i18n.ts"].map(f => Bun.file(`src/plugins/capture/${f}`).text()));
        for (const s of files) {
            expect(s).not.toContain("chrome.debugger");
            expect(s).not.toContain("cdpFullPage");
            expect(s).not.toContain("fullPageCdp");
            expect(s).not.toContain("optionalPermissions");
        }
        const logic = await import("../src/plugins/capture/logic");
        expect("cdpScreenshotParams" in logic).toBe(false);
    });
    test("代码与设置说明标注无法对齐，并注明 Arc 用内核 captureFullPage", async () => {
        const page = await Bun.file("src/plugins/capture/page.ts").text();
        expect(page).toContain("无法对齐：需要内核");
        expect(page).toContain("captureFullPage:");
        expect(page).toContain("【降级实现】");
        const { STRINGS } = await import("../src/plugins/capture/i18n");
        expect(STRINGS.zh["plugin.capture.desc"]).toContain("无法对齐：需要内核");
        expect(STRINGS.en["plugin.capture.desc"]).toContain("needs browser engine");
    });
    test("JS 缩放保留 Arc 的 0.5 s 延迟", async () => {
        const { FULL_PAGE_DELAY_MS } = await import("../src/plugins/capture/logic");
        expect(FULL_PAGE_DELAY_MS).toBe(500);
        expect(await Bun.file("src/plugins/capture/page.ts").text()).toContain("await sleep(FULL_PAGE_DELAY_MS)");
    });
    test("缩放倍率：长页面缩到一个视口内，短页面不放大", async () => {
        const { zoomPlan } = await import("../src/plugins/capture/logic");
        expect(zoomPlan(1000, 4000, 1000, 800).scale).toBe(0.2);
        expect(zoomPlan(800, 600, 1000, 800).scale).toBe(1);
    });
});

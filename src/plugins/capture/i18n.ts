/* 本插件文案。英文为 Arc 原文（capture.md）；Arc 未解出的菜单文案为自拟（见回报）。 */
import { registerLocale } from "@api/i18n";

export const STRINGS = {
    en: {
        "plugin.capture.label": "Capture",
        "plugin.capture.desc": "Capture part of a page, an element or the full page. Full page uses page zoom (can't match Arc: needs browser engine)",
        "capture.dragToCapture": "Hold Command and Shift to start a Capture.",
        "capture.start": "Capture…", "capture.fullPage": "Capture Full Page", "capture.portrait": "Capture in Portrait Mode", "capture.image": "Capture Image",
        "capture.hint": "Click or drag to capture a portion of this page", "capture.hintDrag": "Drag to capture a portion of this page",
        "capture.newEasel": "New Easel", "capture.copyImage": "Copy", "capture.sendAsMessage": "Send via iMessage", "capture.saveAsFile": "Save as File…",
        "capture.saveToEasel": "Save to Easel", "capture.saveToLibrary": "Save to Library", "capture.savedToLibrary": "Saved to Library",
        "capture.retake": "Retake", "capture.edit": "Edit", "capture.unavailable": "Not available in Cat",
        "capture.copied": "Screenshot Copied to Clipboard", "capture.saveToFile": "Save to File",
        "capture.saveDialog": "Save Capture Image",
        "capture.failed": "Couldn't capture this page", "capture.copyFailed": "Couldn't copy the screenshot", "capture.saveFailed": "Couldn't save the capture",
    },
    zh: {
        "plugin.capture.label": "截图",
        "plugin.capture.desc": "截取页面区域、元素或整页。整页用页面缩放（无法对齐：需要内核）",
        "capture.dragToCapture": "按住 ⌘⇧ 拖动即可截图",
        "capture.start": "截图…", "capture.fullPage": "截取整页", "capture.portrait": "Portrait 模式截图", "capture.image": "截取图片",
        "capture.hint": "单击或拖动，截取页面的一部分", "capture.hintDrag": "拖动以截取页面的一部分",
        "capture.newEasel": "新建 Easel", "capture.copyImage": "复制", "capture.sendAsMessage": "通过 iMessage 发送", "capture.saveAsFile": "存为文件…",
        "capture.saveToEasel": "存到 Easel", "capture.saveToLibrary": "存入资料库", "capture.savedToLibrary": "已存入资料库",
        "capture.retake": "重新截取", "capture.edit": "编辑", "capture.unavailable": "Cat 暂不支持",
        "capture.copied": "截图已复制到剪贴板", "capture.saveToFile": "存为文件",
        "capture.saveDialog": "保存截图",
        "capture.failed": "无法截取此页面", "capture.copyFailed": "截图复制失败", "capture.saveFailed": "截图保存失败",
    },
};
// 模块加载时注册（设置页在插件关闭时也要显示名称 / 说明）
registerLocale("Capture", STRINGS);

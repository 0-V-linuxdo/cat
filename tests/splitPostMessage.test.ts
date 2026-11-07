import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// 同 rel66：分屏面板内容脚本 → 分屏页的 postMessage 固定扩展源，不用 "*"；只认直接子面板
const src = readFileSync(new URL("../src/plugins/views/splitView/index.ts", import.meta.url), "utf8");
const content = src.slice(src.indexOf("content: {"));

test("面板 → 分屏页：targetOrigin 为扩展源，不用 \"*\"", () => {
    expect(content).toMatch(/postMessage\(\{ arcSplit: "focusUrl" \}, extOrigin\)/);
    expect(content).toMatch(/arcSplit: "muteState"[^\n]*\}, extOrigin\)/);
    expect(content.match(/window\.parent\.postMessage\([^\n]*"\*"\)/)).toBeNull();
});

test("inPane 只认父窗口源 = 扩展源（嵌套 iframe 不算面板）", () => {
    expect(content).toMatch(/location\.ancestorOrigins\?\.\[0\] === extOrigin/);
});

test("分屏页收消息核对 e.source 是自己的面板 iframe", () => {
    const page = src.slice(0, src.indexOf("content: {"));
    const listeners = page.match(/addEventListener\("message"[\s\S]*?\}\);/g) ?? [];
    expect(listeners.length).toBeGreaterThan(0);
    for (const l of listeners) expect(l).toMatch(/contentWindow === e\.source/);
});

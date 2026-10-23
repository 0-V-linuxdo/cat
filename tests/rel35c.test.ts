/*
 * rel35c：固定项 Duplicate（打开 / 没打开都复制成固定项，不再新开今日标签）；固定 / Today 标签 Rename = 行内就地编辑（不是对话框，只有收藏用 arcRename）。
 * Rea：urlbar-menus-followup.md L661「H1」；tab-rename.md 结论 1–4（rename(9) = editingItem；初始文本；trim / 空 → nil；双击只对 tab）。
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dupPinFields, duplicatePinNode } from "../src/plugins/tabs/pinnedTabs/dupNode";
import type { PinNode } from "../src/plugins/tabs/pinnedTabs/model";

const rd = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const pin = strip(rd("src/plugins/tabs/pinnedTabs/index.ts"));
const today = strip(rd("src/plugins/tabs/todayTabs/index.ts"));
const multi = strip(rd("src/plugins/tabs/multiSelect/index.ts"));
const en = rd("src/i18n/en.ts"), zh = rd("src/i18n/zh.ts");

const mk = (o: Partial<PinNode> = {}): PinNode => ({ id: "a", kind: "tab", url: "https://old.com/", title: "Old", ...o });

describe("固定项 Duplicate（纯逻辑）", () => {
    test("没打开：复制 url / title / customTitle / customIcon；不带 tabId", () => {
        const c = dupPinFields(mk({ customTitle: "Mine", customIcon: "😀", tabId: 9 }), undefined);
        expect(c).toEqual({ url: "https://old.com/", title: "Old", customTitle: "Mine", customIcon: "😀" });
    });
    test("打开且在固定网址：网址取当前页、保留 customTitle；偏离固定网址：不带 customTitle（#片段不算偏离）", () => {
        expect(dupPinFields(mk({ customTitle: "Mine" }), { url: "https://old.com/#x" }).customTitle).toBe("Mine");
        const d = dupPinFields(mk({ customTitle: "Mine" }), { url: "https://new.com/" });
        expect(d.url).toBe("https://new.com/");
        expect(d.customTitle).toBeUndefined();
    });
    test("落点 = 原项之后（同一文件夹内）；文件夹不能复制；新项没有 tabId", () => {
        const folder: PinNode = { id: "f", kind: "folder", title: "F", children: [mk({ id: "x" }), mk({ id: "y" })] };
        const list: PinNode[] = [mk({ id: "a" }), folder, mk({ id: "z" })];
        expect(duplicatePinNode(list, "x", "n1")?.id).toBe("n1");
        expect(folder.children!.map(n => n.id)).toEqual(["x", "n1", "y"]);
        expect(duplicatePinNode(list, "a", "n2")).toBeDefined();
        expect(list.map(n => n.id)).toEqual(["a", "n2", "f", "z"]);
        expect(list[1].tabId).toBeUndefined();
        expect(duplicatePinNode(list, "f", "n3")).toBeUndefined();
        expect(duplicatePinNode(list, "nope", "n4")).toBeUndefined();
        expect(list.length).toBe(4);
    });
});

describe("固定项 Duplicate（接线）", () => {
    test("duplicatePin：mutateSpace 复制 → openNode 打开；没有 chrome.tabs.duplicate / 今日标签", () => {
        const at = pin.indexOf("export async function duplicatePin");
        const body = pin.slice(at, pin.indexOf("\n}\n", at));
        expect(body).toContain("duplicatePinNode(list, src.id, newId, getTab(src.tabId))");
        expect(body).toContain("await openNode(n)");
        expect(body).not.toContain("chrome.tabs.duplicate");
    });
    test("多选 Duplicate：今日标签 chrome.tabs.duplicate；固定项（打开 / 没打开）duplicatePin，前 5 个打开；菜单项不再要求有打开的标签", () => {
        expect(multi).toContain("for (const id of tabIds) await chrome.tabs.duplicate(id);");
        expect(multi).toContain("await duplicatePin(p.id, i < 5)");
        expect(multi).toMatch(/\{ label: tr\("tab\.duplicate"\), run: actions\.duplicate, test: "multi:dup" \}/);
        expect(multi).not.toMatch(/openIds\.length \? \{ label: tr\("tab\.duplicate"\)/);
    });
});

const tr = rd("src/components/TabRow.ts");
const fold = strip(rd("src/plugins/tabs/folders/index.ts"));

describe("Rename：行内就地编辑（tab-rename.md）", () => {
    test("1) 固定 / Today 菜单 rename 走行内编辑，不调 arcRename / 对话框", () => {
        const pi = pin.slice(pin.indexOf('{ id: "rename"'), pin.indexOf('{ id: "rename"') + 380);
        expect(pi).toContain("inlineRename(span, pinTitle(n, getTab(n.tabId)), v => void renameNode(n.id, v))");
        const ti = today.slice(today.indexOf('{ id: "rename"'), today.indexOf('{ id: "rename"') + 160);
        expect(ti).toContain("startRename(`tab:${t.tabId}`)");
        for (const src of [pin, today, multi]) expect(src).not.toContain("arcRename");
        expect(pin).not.toContain("components/Dialog");
        expect(today).not.toContain("components/Dialog");
    });
    test("1) 双击标题进入同一个编辑框（只在 TabRow 的 onRename 存在时，即 tab）；文件夹头没有双击重命名", () => {
        expect(tr).toMatch(/ondblclick: p\.onRename \? \(e: MouseEvent\) => \{ e\.stopPropagation\(\); inlineRename\(e\.currentTarget as HTMLElement, p\.title, p\.onRename!\); \} : undefined/);
        expect(pin).toContain("onRename: v => void renameNode(n.id, v)");
        expect(today).toContain("onRename: v => void titleStore.update(x => { if (v) x.byTab[t.id!] = v; else delete x.byTab[t.id!]; })");
        expect(fold).not.toMatch(/dblclick|ondblclick/);
    });
    test("2) 初始文本 = 显示标题（customTitle 非空 → 页面标题 → 保存的标题 → 网址）：固定行标题与菜单共用 pinTitle；Today 行标题 自定义名 → 页面标题 → 网址", () => {
        expect(pin).toContain("export const pinTitle = (n: PinNode, tab?: chrome.tabs.Tab) => n.customTitle || tab?.title || n.title || displayUrl(n.url);");
        expect(pin).toContain("title: pinTitle(n, tab),");
        expect(today).toContain('title: titleStore.get().byTab[t.id!] || t.title || t.url || "",');
    });
    test("2)/3) inlineRename：Enter 提交、Esc 取消还原、失焦提交；提交前 trim（含换行）；与 current 相同不回调", () => {
        const i = tr.indexOf("export function inlineRename");
        const body = tr.slice(i, tr.indexOf("\n}\n", i));
        expect(body).toContain('if (e.key === "Enter") finish(true); else if (e.key === "Escape") finish(false);');
        expect(body).toContain("if (save && input.value !== current) done(input.value.trim());");
        expect("  Foo \n\t".trim()).toBe("Foo");
    });
    test("3) 空串：固定 customTitle → undefined、Today 删除 byTab（回退页面标题）；文件夹清空保持原名", () => {
        expect(pin).toContain("n.customTitle = title || undefined");
        expect(today).toContain("if (v) x.byTab[t.id!] = v; else delete x.byTab[t.id!];");
        expect(fold).toContain("v => { if (v) void mutateSpace(");
    });
    test("4) 菜单文案不变：tab.renameTab 仍是 Rename Tab / 重命名标签（省略号 ⛔ 无结论），i18n 未改", () => {
        expect(en).toContain('"tab.renameTab": "Rename Tab"');
        expect(zh).toContain('"tab.renameTab": "重命名标签"');
        expect(pin).toContain('{ id: "rename", label: "tab.renameTab"');
        expect(today).toContain('{ id: "rename", label: "tab.renameTab"');
    });
});

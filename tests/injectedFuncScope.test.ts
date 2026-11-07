/* chrome.scripting.executeScript({ func }) 注入的函数：Chrome 只序列化函数文本，页面里没有本模块的作用域。
 * 函数体若引用模块级标识符（DL 层引入的 PAGE_Z_MAX / Z.* / L.* 等），页面里是 ReferenceError，功能静默失效
 * （rel52 实例：pickRegion 里的 z-index 改成 PAGE_Z_MAX → 「截取页面的一部分」覆盖层从不出现，只有 headed 自测页 C1 抓得到）。
 * 这里：① 静态：注入函数 toString() 不含已知 DL 常量标识符；② 动态：在「无模块作用域」的 new Function 里用最小 DOM stub 执行 pickRegion，不抛 ReferenceError。 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { pageHasBeforeUnload, pageHasUnsavedInput } from "../src/plugins/tabSleep/logic";
import { pickRegion, pickStyle } from "../src/plugins/views/siteControls/regionCapture";

const root = new URL("..", import.meta.url).pathname;
/** DL 层（utils/zLayers.ts）导出的、不可出现在注入函数体里的标识符 */
const DL_NAMES = /\bPAGE_Z_MAX\b|\bINPAGE_LAYERS\b|\bzLayers\b|\bZ\.[a-zA-Z]|\bL\.[a-zA-Z]|\bimport_[A-Za-z_$]*zLayers/;

const injected: Record<string, Function> = { pickRegion, pageHasUnsavedInput, pageHasBeforeUnload };

describe("注入函数不引用模块作用域（executeScript func）", () => {
    for (const [name, fn] of Object.entries(injected))
        test(`${name}：函数体不含 DL 常量标识符`, () => {
            const src = fn.toString();
            expect(src.length).toBeGreaterThan(50);
            expect(DL_NAMES.test(src), `${name} 的函数体里引用了 DL 常量，注入页面后会是 ReferenceError：${src.match(DL_NAMES)?.[0]}`).toBe(false);
        });

    test("peek 的 trackMedia（MAIN 世界注入）函数体不含 DL 常量标识符（读源码：该文件 import 了 PAGE_Z_MAX）", () => {
        const s = readFileSync(join(root, "src/plugins/views/peek/index.ts"), "utf8");
        const i = s.indexOf("export function trackMedia");
        expect(i).toBeGreaterThan(-1);
        // 取到下一个顶层 export / function（顶层以行首无缩进的 `}` 结束）
        const body = s.slice(i, s.indexOf("\n}\n", i) + 3);
        expect(body.length).toBeGreaterThan(50);
        expect(DL_NAMES.test(body), body.match(DL_NAMES)?.[0]).toBe(false);
    });

    test("全树：引用 zLayers 且用 executeScript({func}) 的文件只有已审计的两个（新增须逐个检查注入函数体）", () => {
        const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]);
        const hits = walk(join(root, "src")).filter(f => f.endsWith(".ts") && !f.includes("/selftest/")).filter(f => {
            const s = readFileSync(f, "utf8");
            return /@utils\/zLayers/.test(s) && /executeScript\(/.test(s) && /\bfunc\s*[:,]/.test(s);
        }).map(f => f.replace(root, "")).sort();
        expect(hits).toEqual(["src/plugins/views/peek/index.ts"]);
    });

    test("pickRegion 在无模块作用域的 new Function 里能执行：z-index 来自参数，Esc 取消 → null，不抛 ReferenceError", async () => {
        const handlers: Record<string, (e: unknown) => void> = {};
        const el = (): Record<string, unknown> => {
            const o: Record<string, unknown> = {
                style: {}, id: "", textContent: "",
                attachShadow: () => ({ append() { } }), append() { }, remove() { }, setPointerCapture() { },
                addEventListener: (t: string, h: (e: unknown) => void) => { o[`on:${t}`] = h; },
            };
            return o;
        };
        let host: Record<string, unknown> | undefined;
        const doc = {
            getElementById: () => null,
            createElement: () => { const e = el(); host ??= e; return e; },
            documentElement: { append() { } },
        };
        // 只给 DOM 相关全局；其余标识符走真实全局（Math / Promise / Object），模块级标识符（PAGE_Z_MAX 等）解析不到 → ReferenceError
        const stubs: Record<string, unknown> = {
            document: doc, innerWidth: 1000, innerHeight: 800, requestAnimationFrame: (f: () => void) => f(),
            addEventListener: (t: string, h: (e: unknown) => void) => { handlers[t] = h; }, removeEventListener() { },
        };
        const scope = new Proxy({}, { has: (_, k) => typeof k === "string" && k in stubs, get: (_, k) => stubs[k as string] });
        const run = new Function("scope", `with (scope) { return (${pickRegion.toString()}); }`)(scope) as typeof pickRegion;
        const st = pickStyle();
        expect(st.z).toBe(2147483647);
        const p = run(st);
        expect((host!.style as { cssText: string }).cssText).toContain("z-index:2147483647;");
        handlers.keydown!({ key: "Escape", preventDefault() { }, stopImmediatePropagation() { } });
        expect(await p).toBeNull();
    });
});

/* 补丁 heartbeat-guard：心跳定时器读预热方式时设置不可用（插件未初始化 / 已卸载）不再抛未处理错误（此前在整套 check 里偶发 1 fail，
   报 "Cannot access settings before plugin is initialized"，归在后面某个无关测试名下）。源码扫描。 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const src = readFileSync("src/plugins/inpageSidebar/background.ts", "utf8");
const i = src.indexOf("const heartbeat = setInterval(");
const body = src.slice(i, src.indexOf("}, PREWARM.heartbeatMs)", i));

describe("心跳定时器不会因设置不可用抛错", () => {
    test("定时器回调里的 prewarmMode() 包在 try / catch 里（先 catch 再看 off）", () => {
        expect(i).toBeGreaterThan(0);
        expect(body).toMatch(/try \{ mode = prewarmMode\(\); \} catch \{ return; \}/);
        expect(body).not.toMatch(/prewarmMode\(\) === "off"/);
    });
    test("行为不变：off 仍跳过；非 off 仍对每个面板端口 postMessage heartbeat，死端口仍走 nativeChanged 对账", () => {
        expect(body).toMatch(/if \(mode === "off"\) return;/);
        expect(body).toContain('p.postMessage({ type: "heartbeat" })');
        expect(body).toContain("setTimeout(() => nativeChanged(w), 0)");
    });
});

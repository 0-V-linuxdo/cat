/* 补丁 inpage-mac-shortcut-copy（Cat 真机验收：Mac 上 Alt+S 无效）：
 * 结论（静态）：manifest 里 toggle-sidebar 的 Mac 键本来就是 MacCtrl+S（= 物理 Control+S，⌃S），Mac 上 Alt+S 根本没绑定，「Alt+S 无效」是预期；
 * 真正的错在设置文案：prewarm.detail / prewarm.window 在所有平台都写「Ctrl+S 可切回页内」「⌘R」——Mac 上 Ctrl+S 会被读成 ⌘S（Chrome 的「保存」），Win / Linux 上真键是 Alt+S、重载是 Ctrl+R。
 * 这里锁定：A) manifest 的键位（Mac 必须是 MacCtrl+S，绝不能是 Ctrl+S / Command+S；非 Mac 默认 Alt+S）；B) 文案按平台选（buildStrings(mac)）：Mac = ⌃S / ⌘R，其它 = Alt+S / Ctrl+R，Mac 文案里不出现 Alt+S；
 * C) STRINGS 就是 buildStrings(isMac)（平台由 @api/Keys 的 isMac 决定）；D) en / zh 键集合在两种平台下一致；E) README 的说明写明 ⌃S。 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { isMac } from "../src/api/Keys";
import { buildStrings, STRINGS } from "../src/plugins/inpageSidebar/i18n";

const ROOT = resolve(import.meta.dir, "..");
const manifest = JSON.parse(readFileSync(resolve(ROOT, "static/manifest.json"), "utf8")) as { commands: Record<string, { suggested_key?: Record<string, string> }> };
const COPY = ["inpageSidebar.prewarm", "inpageSidebar.prewarm.detail", "inpageSidebar.prewarm.off", "inpageSidebar.prewarm.window"] as const;
const text = (mac: boolean, L: "en" | "zh", k: string) => (buildStrings(mac)[L] as Record<string, string>)[k]!;
const all = (mac: boolean) => [...Object.values(buildStrings(mac).en), ...Object.values(buildStrings(mac).zh)].join("\n");

describe("A) manifest 键位（Chrome 规则：manifest 里 Ctrl 在 Mac 上自动变 Command；物理 Control 要写 MacCtrl；有 mac 键时它覆盖 default）", () => {
    test("toggle-sidebar：default = Alt+S，mac = MacCtrl+S（⌃S）；Mac 不会绑 Alt+S，所以 Mac 上按 ⌥S 本来就无效", () => {
        const k = manifest.commands["toggle-sidebar"]!.suggested_key!;
        expect(k.default).toBe("Alt+S"); expect(k.mac).toBe("MacCtrl+S");
    });
    test("Mac 键绝不能写成 Ctrl+S（= ⌘S，浏览器「保存」）或 Command+S；所有命令的 Mac 键都不含 Alt（Alt 在 Mac 上是 ⌥，⌥+字母产生特殊字符）", () => {
        for (const [name, c] of Object.entries(manifest.commands)) {
            const mac = c.suggested_key?.mac; if (!mac) continue;
            expect(mac, name).toMatch(/^MacCtrl\+/); expect(mac, name).not.toMatch(/(^|\+)(Ctrl|Command|Alt)\+/);
        }
    });
    test("open-command-bar：default = Alt+T，mac = MacCtrl+T（同一规则）", () => {
        const k = manifest.commands["open-command-bar"]!.suggested_key!; expect(k.default).toBe("Alt+T"); expect(k.mac).toBe("MacCtrl+T");
    });
});

describe("B) 设置文案按平台选", () => {
    test("Mac：⌃S 切回页内、⌘R 重载；不出现 Alt+S，也不写会被读成 ⌘S 的 Ctrl+S（zh / en、detail / window 选项）", () => {
        for (const L of ["en", "zh"] as const) for (const k of ["inpageSidebar.prewarm.detail", "inpageSidebar.prewarm.window"]) {
            const s = text(true, L, k); expect(s, `${L} ${k}`).toMatch(/⌃S/); expect(s, `${L} ${k}`).toMatch(/⌘R/);
            expect(s, `${L} ${k}`).not.toMatch(/Alt\+S/); expect(s, `${L} ${k}`).not.toMatch(/Ctrl\+[SR]/);
        }
        expect(text(true, "en", "inpageSidebar.prewarm.window")).toMatch(/⌃S switches back to in-page/); expect(text(true, "zh", "inpageSidebar.prewarm.window")).toMatch(/⌃S 可切回页内/);
    });
    test("Windows / Linux：Alt+S 切回页内、Ctrl+R 重载；不出现 Mac 专用符号 ⌘ ⌃，也不写 Ctrl+S（浏览器「保存」）", () => {
        for (const L of ["en", "zh"] as const) for (const k of ["inpageSidebar.prewarm.detail", "inpageSidebar.prewarm.window"]) {
            const s = text(false, L, k); expect(s, `${L} ${k}`).toMatch(/Alt\+S/); expect(s, `${L} ${k}`).toMatch(/Ctrl\+R/);
            expect(s, `${L} ${k}`).not.toMatch(/[⌘⌃]/); expect(s, `${L} ${k}`).not.toMatch(/Ctrl\+S/);
        }
        expect(text(false, "en", "inpageSidebar.prewarm.window")).toMatch(/Alt\+S switches back to in-page/); expect(text(false, "zh", "inpageSidebar.prewarm.window")).toMatch(/Alt\+S 可切回页内/);
    });
    test("Mac 用户能看到的全部 inpageSidebar 文案里没有 Alt+S / Ctrl+S；非 Mac 里没有 ⌘ / ⌃ / Ctrl+S", () => {
        expect(all(true)).not.toMatch(/Alt\+S|Ctrl\+S/); expect(all(false)).not.toMatch(/[⌘⌃]|Ctrl\+S/);
    });
    test("除了快捷键，两种平台的文案完全一样（没有别的键被误改）", () => {
        const norm = (mac: boolean, L: "en" | "zh") => Object.entries(buildStrings(mac)[L]).map(([k, v]) => [k, (v as string).replace(mac ? /⌃S/g : /Alt\+S/g, "<SW>").replace(mac ? /⌘R/g : /Ctrl\+R/g, "<RL>")]);
        for (const L of ["en", "zh"] as const) expect(norm(true, L)).toEqual(norm(false, L));
    });
    test("设置里的四个键齐全非空；两种平台下 en / zh 键集合一致", () => {
        for (const mac of [true, false]) {
            for (const L of ["en", "zh"] as const) for (const k of COPY) expect(text(mac, L, k)).toBeTruthy();
            expect(Object.keys(buildStrings(mac).en).toSorted()).toEqual(Object.keys(buildStrings(mac).zh).toSorted());
        }
    });
});

describe("C) 平台判定", () => {
    test("导出的 STRINGS = buildStrings(@api/Keys 的 isMac)（模块加载时按当前平台选一次；设置页 / SW 都有 navigator）", () => {
        expect(STRINGS).toEqual(buildStrings(isMac));
    });
    test("源码：i18n.ts 复用 @api/Keys 的 isMac，没有另写一份平台检测", () => {
        const src = readFileSync(resolve(ROOT, "src/plugins/inpageSidebar/i18n.ts"), "utf8");
        expect(src).toMatch(/import \{ isMac \} from "@api\/Keys";/); expect(src).not.toMatch(/navigator\./);
    });
});

describe("E) README", () => {
    test("README 的显示 / 隐藏侧边栏一行：Mac = ⌃S（Control+S，不是 ⌘S），其它平台 = Alt+S", () => {
        const readme = readFileSync(resolve(ROOT, "README.md"), "utf8");
        const line = readme.split("\n").find(l => l.includes("显示 / 隐藏侧边栏"))!;
        expect(line).toMatch(/⌃S/); expect(line).toMatch(/Control\+S/); expect(line).toMatch(/不是 ⌘S/); expect(line).toMatch(/Alt\+S/);
    });
});

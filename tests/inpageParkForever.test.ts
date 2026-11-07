/* 补丁 inpage-park-forever（rel55 第 16 层）：已打开标签的页内侧栏 iframe 持续保留（失活只停放、不销毁），没有时限（原 FRAME.parkMs = 60 s）也没有数量上限；
 * 只在标签真实关闭 / 页面导航 / Chrome 丢弃（整页没了）/ blocked / stale / teardown 时销毁。
 * 本文件：① 决策表与时间无关（含「额外塞一个 parkMs」也照样停放）；② 常量 / 到期函数 / 计时器已删干净；③ 销毁路径只剩白名单；
 *         ④ tab-shake（rel53 失活抖动修复）逐条在长保留下仍成立的回归；⑤ 长期停放不累积（计时器 / 监听 / 重复查询）。真实长时间停放行为 = headed（REL55-TABSWITCH-PLAN.md C 节）。 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import * as FL from "../src/plugins/inpageSidebar/frameLife";
import { FRAME_IDLE_MSG, frameDecision, type FrameLifeIn } from "../src/plugins/inpageSidebar/frameLife";

const SRC = resolve(import.meta.dir, "../src");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const code = (f: string) => strip(readFileSync(resolve(SRC, f), "utf8"));
const base: FrameLifeIn = { teardown: false, active: true, shown: true, blocked: false, hasFrame: false, stale: false, canBuild: true, parked: false };
const d = (o: Partial<FrameLifeIn>) => frameDecision({ ...base, ...o });
const NONE = { destroy: false, build: false, park: false, unpark: false };
/** 旧调用方 / 旧测试仍会带 parkMs：新决策必须无视它 */
const withParkMs = (o: Partial<FrameLifeIn>, parkMs: unknown) => frameDecision({ ...base, ...o, parkMs } as FrameLifeIn);

describe("① 决策与时间无关：停放没有时限", () => {
    test("失活 + 有 iframe → park（不销毁）；即使调用方塞 parkMs = 0 / 1 / 60_000 也一样（旧版 parkMs=0 会销毁）", () => {
        for (const parkMs of [undefined, 0, 1, 60_000, 600_000]) expect(withParkMs({ active: false, hasFrame: true }, parkMs)).toEqual({ ...NONE, park: true });
    });
    test("全组合（2^8）：结果与 parkMs 无关；destroy 只会因 teardown / stale / （失活 + blocked）而发生，失活本身绝不销毁", () => {
        const bools = [false, true];
        for (const teardown of bools) for (const active of bools) for (const shown of bools) for (const blocked of bools) for (const hasFrame of bools)
            for (const stale of bools) for (const canBuild of bools) for (const parked of bools) {
                const c = { teardown, active, shown, blocked, hasFrame, stale, canBuild, parked };
                const o = frameDecision(c);
                for (const parkMs of [0, 60_000, 10 ** 9]) expect(withParkMs(c, parkMs)).toEqual(o);
                if (o.destroy) expect(hasFrame && (teardown || stale || (!active && blocked))).toBe(true);
                if (!active && hasFrame && !stale && !teardown && !blocked) expect(o).toEqual({ ...NONE, park: !parked });
            }
    });
    test("模拟 4 个标签、窗口里轮流切 12 小时：每个标签只建 1 次、0 次销毁（决策层）；之后 stale 才销毁重建", () => {
        const mk = () => { const s = { frame: false, parked: false, built: 0, destroyed: 0 }; return { s, render(active: boolean, o2: Partial<FrameLifeIn> = {}) {
            const o = d({ active, hasFrame: s.frame, parked: s.parked, ...o2 });
            if (o.destroy) { s.frame = false; s.parked = false; s.destroyed++; } if (o.park) s.parked = true; if (o.unpark) s.parked = false; if (o.build) { s.frame = true; s.built++; }
        } }; };
        const T = [mk(), mk(), mk(), mk()]; let cur = -1;
        for (let i = 0; i < 12 * 60; i++) { const n = (i * 7) % 4; if (n === cur) continue; if (cur >= 0) T[cur]!.render(false); T[n]!.render(true); cur = n; }
        for (const t of T) { expect(t.s.built).toBe(1); expect(t.s.destroyed).toBe(0); }
        T[0]!.render(false); T[0]!.render(true, { stale: true }); expect(T[0]!.s.built).toBe(2); expect(T[0]!.s.destroyed).toBe(1);
    });
});

describe("② 到期销毁已删干净（无死代码 / 未用导出）", () => {
    test("frameLife 不再导出 FRAME / parkExpired；FrameLifeIn 没有 parkMs", () => {
        expect("FRAME" in FL).toBe(false); expect("parkExpired" in FL).toBe(false);
        expect(Object.keys(FL).toSorted()).toEqual(["FRAME_IDLE_MSG", "frameDecision", "parseLookParam", "shouldFollowScroll"]);
        expect(code("plugins/inpageSidebar/frameLife.ts")).not.toMatch(/parkMs|parkExpired|FRAME\b(?!_)/);
    });
    test("content.ts：没有 parkTimer / FRAME.parkMs / parkExpired；parkFrame 里没有任何计时器", () => {
        const c = code("plugins/inpageSidebar/content.ts");
        expect(c).not.toMatch(/parkTimer|FRAME\.parkMs|parkExpired|parkMs/);
        expect(c).toMatch(/import \{ FRAME_IDLE_MSG, frameDecision \} from "\.\/frameLife"/);
        const body = /const parkFrame = \(\) => \{([\s\S]*?)\n    \};/.exec(c)?.[1] ?? ""; expect(body.length).toBeGreaterThan(20);
        expect(body).not.toMatch(/setTimeout|setInterval|requestIdleCallback/); expect(body).toMatch(/parked = true; postIdle\(true\);/);
        expect(c).toMatch(/const clearPark = \(\) => \{ parked = false; \};/);
    });
    test("全仓库没有别处引用 parkMs / parkExpired / FRAME（frameLife 的）", () => {
        for (const f of ["plugins/inpageSidebar/background.ts", "plugins/inpageSidebar/panel.ts", "plugins/inpageSidebar/constants.ts", "api/HostMode.ts", "api/Commands.ts", "plugins/_core/tabState/index.ts"]) expect(code(f)).not.toMatch(/parkMs|parkExpired|FRAME\.parkMs/);
    });
});

describe("③ 销毁路径只剩白名单（content.ts 里 destroyFrame() 的调用点）", () => {
    const c = code("plugins/inpageSidebar/content.ts");
    test("调用点 = stale / 握手超时 / 决策 destroy 三处；teardown 靠 host.remove()（iframe 随宿主走）", () => {
        const calls = [...c.matchAll(/destroyFrame\(\)/g)].length; expect(calls).toBe(3); // 下面逐条点名（定义本身是 `destroyFrame = () =>`，不带 `()` 调用形式）
        expect(c).toMatch(/if \(iframe && frameStale\(frameIds, st\)\) destroyFrame\(\);/);
        expect(c).toMatch(/blocked = true; destroyFrame\(\); send\(\{ type: "frame", state: "blocked" \}\)/);
        expect(c).toMatch(/if \(fd\.destroy\) destroyFrame\(\);/);
        expect(c).toMatch(/const teardown = \(\) => \{[\s\S]*?host\.remove\(\);/);
    });
    test("没有「失活 / 窗口收起 / 标签数量 / 空闲时间」触发的销毁：render 里 destroy 只来自 frameDecision", () => {
        expect(c).toMatch(/const fd = frameDecision\(\{ teardown: false, active, shown, blocked, hasFrame: !!iframe, stale: !!iframe && frameStale\(frameIds, st\), canBuild: !!st && canBuildFrame\(st\), parked \}\);/);
        expect(c).not.toMatch(/visibilitychange[^\n]*destroyFrame|idle[^\n]*destroyFrame/);
    });
});

describe("④ rel53 tab-shake（失活后抖动）修复：长保留下逐条仍成立", () => {
    const c = code("plugins/inpageSidebar/content.ts"), p = code("plugins/inpageSidebar/panel.ts");
    test("a) 失活 = park、激活 = unpark（零重建）；停放期 stale 仍销毁并在激活时重建", () => {
        expect(d({ active: false, hasFrame: true })).toEqual({ ...NONE, park: true }); expect(d({ active: true, hasFrame: true, parked: true })).toEqual({ ...NONE, unpark: true });
        expect(d({ active: false, hasFrame: true, parked: true })).toEqual(NONE); // 已停放：什么都不做（没有计时器要续）
        expect(d({ active: false, hasFrame: true, stale: true })).toEqual({ ...NONE, destroy: true }); expect(d({ active: true, hasFrame: true, stale: true, parked: true })).toEqual({ ...NONE, destroy: true, build: true });
    });
    test("b) 重建路径的「不抖」：URL 带 look、opacity:0 直到 ready、ready 时补发 look 与停放状态", () => {
        expect(c).toMatch(/&look=\$\{look\}`/); expect(c).toMatch(/f\.style\.opacity = "0"/); expect(c).toMatch(/if \(!frameChan\.isReady\(\)\) \{ postLook\(\); if \(parked\) postIdle\(true\); frameChan\.ready\(e\.source\); \}/); expect(c).toMatch(/ready = true; iframe\.style\.opacity = "";/); // rel66：补发经 frameChannel（握手后按队列补发）
    });
    test("c) idle 通知：park 时发 idle:true、unpark 时发 idle:false；面板只认 window.parent + 布尔", () => {
        expect(c).toMatch(/parked = true; postIdle\(true\);/); expect(c).toMatch(/clearPark\(\); postIdle\(false\);/);
        expect(p).toMatch(/d\?\.type !== FRAME_IDLE_MSG \|\| typeof d\.idle !== "boolean"/); expect(p).toMatch(/e\.source !== window\.parent/); expect(FRAME_IDLE_MSG).toBe("arc-inpage-idle");
    });
    test("d) 停放时不回写滚动位置、跟随同窗口键的滚动位置（长停放后切回仍是窗口当前位置）", () => {
        expect(p).toMatch(/if \(idle\) return;/); expect(p).toMatch(/area !== "session"/); expect(p).toMatch(/shouldFollowScroll\(\{ idle, current: e\.scrollTop, next: v \}\)/);
        expect(p).toMatch(/chrome\.storage\.onChanged\.addListener\(onStore\); offs\.push\(\(\) => chrome\.storage\.onChanged\.removeListener\(onStore\)\)/);
    });
    test("e) 停放的 iframe 不执行 CMD（命令只在前台那份响应）", () => { expect(code("api/Commands.ts")).toMatch(/if \(isParkedHost\(\)\) return;/); });
    test("f) 切回可见：tabState 立即 reload（长停放后列表 / 高亮不陈旧）；停放期间不随标签事件重查", () => {
        const t = code("plugins/_core/tabState/index.ts");
        expect(t).toMatch(/const onVisible = \(\) => \{ if \(document\.visibilityState === "visible"\) void reload\(\); \};/); // 不经过 schedule 的守卫
        expect(t).toMatch(/document\.addEventListener\("visibilitychange", onVisible\)/); expect(t).toMatch(/document\.removeEventListener\("visibilitychange", onVisible\)/);
        expect(t).toMatch(/const schedule = debounce\(\(\) => \{ if \(isParkedHost\(\)\) return; void reload\(\); \}, 40\);/);
        expect(t).toMatch(/import \{ isInpageHost, isParkedHost \} from "@api\/HostMode"/);
    });
    test("g) 切回标签：onVisibility 用手里的状态同步 render(true)（unpark 不等后台往返）；bfcache 恢复同理", () => {
        expect(c).toMatch(/const onVisibility = \(\) => \{[^\n]*\n\s*if \(document\.visibilityState !== "visible" \|\| stopped\) return;\n\s*if \(st\) render\(true\); else loadHint\(\);/);
        expect(c).toMatch(/if \(!e\.persisted\) return;\n\s*t0 = performance\.now\(\); activated = false; if \(st\) render\(true\);/);
    });
});

describe("⑤ 长期停放不累积", () => {
    const c = code("plugins/inpageSidebar/content.ts"), b = code("plugins/inpageSidebar/background.ts");
    test("内容脚本：停放 / 取消停放不创建计时器或监听（每次 render 的 park / unpark 路径只改一个布尔 + postMessage）", () => {
        const lines = c.split("\n");
        for (const name of ["parkFrame", "unparkFrame"]) {
            const i = lines.findIndex(l => l.startsWith(`    const ${name} = () => {`)); expect(i).toBeGreaterThan(0);
            let j = i; while (!/^    \};|\};\s*$/.test(lines[j]!)) j++; // 单行函数在同一行结束；多行函数到 4 空格缩进的 `};`
            const t = lines.slice(i, j + 1).join("\n"); expect(t.length).toBeGreaterThan(40); expect(t).not.toMatch(/setTimeout|setInterval|addEventListener|new MutationObserver|new ResizeObserver/);
        }
    });
    test("后台：不保存「哪些标签停放着」之类的每标签状态（停放 = 纯内容脚本本地事；无登记表 / 无 LRU / 无 TTL）", () => {
        expect(b).not.toMatch(/park|lru|purge/i);
    });
    test("面板：停放不新增监听（onStore / onIdle / visibilitychange 各一个，随 offs 清理）", () => {
        const p = code("plugins/inpageSidebar/panel.ts"); expect(p.match(/window\.addEventListener\("message", onIdle\)/g)?.length).toBe(1); expect(p).toMatch(/window\.removeEventListener\("message", onIdle\)/);
    });
});

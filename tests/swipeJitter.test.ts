import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/* 触摸板双指横拖抖动（53138 用户报告，复现数据 /workspace/arc-ui/jitter/report.md）：
   A 手势中途 160ms idle / 被忽略事件不刷新 idle → follow(0) 一帧回弹再跳；B 切换后惯性尾巴把新 Space 又拖出去；C 纵向抖动原生滚动列表。 */
const src = readFileSync(join(import.meta.dir, "../src/plugins/spaces/spaceManager/index.ts"), "utf-8");
describe("横滑切 Space：手势抖动回归", () => {
    test("空闲判定 ≥250ms，并由 armIdle 统一刷新", () => {
        expect(src).toMatch(/GESTURE_IDLE\s*=\s*250/);
        expect(src).toContain("const armIdle");
        expect(src).not.toMatch(/setTimeout\(\(\) => \{ wheelAcc = 0; follow\(0\); dockProgress\(0\); \}, 160\)/);
    });
    test("被忽略（横向占比不足）的事件在手势进行中刷新空闲计时、不累加", () => {
        expect(src).toMatch(/Math\.abs\(e\.deltaX\) < Math\.abs\(e\.deltaY\) \* 1\.5\) \{ if \(wheelAcc\) armIdle\(\); return; \}/);
    });
    test("切换后的锁要等惯性尾巴静下来（≥150ms 无横向事件）才解锁", () => {
        expect(src).toContain("lockUntil");
        expect(src).toMatch(/if \(wheelLock\) \{ if \(e\.deltaX\)/);
        expect(src).toMatch(/Math\.max\(150, lockUntil - Date\.now\(\)\)/);
    });
    test("横滑进行中锁住纵向滚动；松手回零带过渡；监听保持 passive", () => {
        expect(src).toMatch(/style\.overflowY = x \? "hidden" : ""/);
        expect(src).toMatch(/animate \? "transform \.18s/);
        expect(src).toContain('document.addEventListener("wheel", onWheel, { passive: true })');
    });
});

/* rel59：隔离自测页逐项结果带 Asia/Shanghai 完成墙钟，便于 [时钟] 冻结假阳性对照 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";

const st = readFileSync("src/selftest/selftest.ts", "utf8");
const html = readFileSync("src/selftest/selftest.html", "utf8");
const harness = readFileSync("scripts/harness-cdp.ts", "utf8");

describe("selftest result timestamps", () => {
    test("Row 含 at；wallStamp 用 Asia/Shanghai；YYYY-MM-DD HH:mm:ss.SSS", () => {
        expect(st).toMatch(/type Row = \{[^}]*\bat:\s*string/);
        expect(st).toContain('timeZone: "Asia/Shanghai"');
        expect(st).toContain("function wallStamp");
        expect(st).toContain('padStart(3, "0")');
        expect(st).toContain("function pushRow");
    });
    test("UI 渲染 at 列；所有结果入口走 pushRow", () => {
        expect(st).toContain('<td class="at">${r.at}</td>');
        expect(html).toContain("td.at{");
        // 不再有「裸」结果 rows.push({ name, status: ... })（pushRow 内部那一处除外）
        const naked = [...st.matchAll(/rows\.push\(\s*\{\s*name\s*,/g)];
        expect(naked.length).toBe(1); // 仅 pushRow 内
        expect(st).toContain('pushRow(name, "pass"');
        expect(st).toContain('pushRow("加载侧边栏 iframe"');
        expect(st).toContain("pushRow(`自测页中断");
    });
    test("ST_JSON 仍写整份 __results；harness FAIL 日志带 at", () => {
        expect(harness).toContain('writeFileSync(process.env.ST_JSON, JSON.stringify(res, null, 1))');
        expect(harness).toContain("const at = r.at ? `[${r.at}] ` : \"\"");
        expect(harness).toContain("at + r.detail.slice(0, 900)");
    });
    test("wallStamp 格式抽样（与自测页同一套 Intl 规则）", () => {
        const wallStamp = (ms: number) => {
            const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
                timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
                hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
            }).formatToParts(new Date(ms)).filter(p => p.type !== "literal").map(p => [p.type, p.value]));
            return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}.${String(ms % 1000).padStart(3, "0")}`;
        };
        // 2026-10-29 14:21:23.456 CST = 2026-10-29 06:21:23.456Z
        expect(wallStamp(Date.UTC(2026, 9, 29, 6, 21, 23, 456))).toBe("2026-10-29 14:21:23.456");
        expect(wallStamp(Date.UTC(2026, 9, 29, 16, 0, 0, 7))).toBe("2026-10-30 00:00:00.007");
    });
});

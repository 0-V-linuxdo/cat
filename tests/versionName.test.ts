import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

/* 构建脚本在每次出包时自动生成 version_name（Asia/Shanghai 构建时间 `YYYY-MM-DD｜HH:MM:SS`，全角竖线 U+FF5C）；
   manifest.version 仍是合法点分数字（≤4 段，每段 ≤65535）。Chrome 在扩展管理页显示 version_name。 */
describe("version_name", () => {
    const rel = "dist-vn-test", out = join(import.meta.dir, "..", rel); // ARC_OUT 相对仓库根
    rmSync(out, { recursive: true, force: true });
    const r = Bun.spawnSync(["bun", "run", "build.ts"], { cwd: join(import.meta.dir, ".."), env: { ...process.env, ARC_OUT: rel } });
    const m = JSON.parse(readFileSync(join(out, "manifest.json"), "utf-8"));
    test("构建成功", () => { expect(r.exitCode).toBe(0); expect(existsSync(join(out, "manifest.json"))).toBe(true); });
    test("version_name 格式", () => { expect(m.version_name).toMatch(/^\d{4}-\d{2}-\d{2}｜\d{2}:\d{2}:\d{2}$/); expect(m.version_name.includes("\uFF5C")).toBe(true); });
    test("version_name 是 Asia/Shanghai 当前时间（±5 分钟内）", () => {
        const [d, t] = m.version_name.split("｜");
        const ms = Date.parse(`${d}T${t}+08:00`);
        expect(Math.abs(Date.now() - ms)).toBeLessThan(5 * 60_000);
    });
    test("version 仍是合法点分数字", () => {
        expect(m.version).toMatch(/^\d+(\.\d+){0,3}$/);
        const parts = m.version.split(".");
        expect(parts.length).toBeLessThanOrEqual(4);
        for (const p of parts) expect(Number(p)).toBeLessThanOrEqual(65535);
    });
    test("插件内显示版本处用 VERSION（= version_name）", () => {
        expect(readFileSync(join(import.meta.dir, "../src/entries/options.ts"), "utf-8")).toContain('tr("settings.footer", VERSION');
        expect(readFileSync(join(import.meta.dir, "../static/manifest.json"), "utf-8")).not.toContain("version_name");
    });
    test("清理", () => { rmSync(out, { recursive: true, force: true }); });
});

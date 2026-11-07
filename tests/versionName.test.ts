import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

/* 构建脚本用 build.ts 里的 buildNow 生成 version_name（Asia/Shanghai `YYYY-MM-DD｜HH:MM:SS`，全角竖线 U+FF5C）；
   rel67 把 buildNow 冻成发布输入，所以这里核对的是发布身份，不是跑测试时的墙钟。
   manifest.version 仍是合法点分数字（≤4 段，每段 ≤65535）。Chrome 在扩展管理页显示 version_name。 */
describe("version_name", () => {
    const rel = "dist-vn-test", out = join(import.meta.dir, "..", rel); // ARC_OUT 相对仓库根
    const root = join(import.meta.dir, "..");
    rmSync(out, { recursive: true, force: true });
    const r = Bun.spawnSync(["bun", "run", "build.ts"], { cwd: root, env: { ...process.env, ARC_OUT: rel } });
    const m = JSON.parse(readFileSync(join(out, "manifest.json"), "utf-8"));
    test("构建成功", () => { expect(r.exitCode).toBe(0); expect(existsSync(join(out, "manifest.json"))).toBe(true); });
    test("version_name 格式", () => { expect(m.version_name).toMatch(/^\d{4}-\d{2}-\d{2}｜\d{2}:\d{2}:\d{2}$/); expect(m.version_name.includes("\uFF5C")).toBe(true); });
    test("version / version_name 等于冻结的 rel67 发布身份", () => {
        const buildSrc = readFileSync(join(root, "build.ts"), "utf-8");
        const literal = buildSrc.match(/const buildNow = (\d+);/);
        expect(literal?.[1]).toBe("1794047116063");
        const buildNow = Number(literal![1]);
        const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf-8")) as { version: string };
        expect(pkg.version).toBe("0.2.0");
        const manifestVersion = `${pkg.version}.${Math.floor((buildNow - Date.UTC(2026, 0, 1)) / 480000) % 65535}`;
        const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(buildNow)).map(x => [x.type, x.value]));
        const versionName = `${p.year}-${p.month}-${p.day}｜${p.hour === "24" ? "00" : p.hour}:${p.minute}:${p.second}`;
        expect(manifestVersion).toBe("0.2.0.55878");
        expect(versionName).toBe("2026-11-07｜18:25:16");
        expect(m.version).toBe(manifestVersion);
        expect(m.version_name).toBe(versionName);
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

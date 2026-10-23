/*
 * 构建脚本：与 Void++ build.ts 相同思路——扫描 src/plugins 生成虚拟模块 ~plugins，
 * --dev 时包含 *.dev 插件并输出 sourcemap。输出 dist/ 可直接“加载已解压的扩展程序”。
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "fs";
import { join, relative, resolve } from "path";

const isDev = process.argv.includes("--dev");
/** --selftest：额外打包 selftest.html（验收用的自检页，不进正式包） */
const withSelftest = process.argv.includes("--selftest");
const pkg = JSON.parse(readFileSync("package.json", "utf-8"));
const SRC = resolve("src");
const PLUGINS = join(SRC, "plugins");
const OUT = process.env.ARC_OUT ? join(import.meta.dir, process.env.ARC_OUT) : resolve("dist"); // check 用 ARC_OUT=dist-check，避免自测运行中覆盖 dist

interface FolderConvention {
    suffix: string;
    skip?: () => boolean;
    mutations(varName: string): string;
}

/* 与 Void++ build.ts 的 FOLDER_CONVENTIONS 相同：文件夹后缀决定插件的构建期属性 */
const FOLDER_CONVENTIONS: FolderConvention[] = [
    { suffix: ".dev", skip: () => !isDev, mutations: v => `${v}.dev=true;` },
    { suffix: ".chrome", mutations: v => `${v}.chrome=true;` },
];

/* Void++ 用 git log 给插件打 updatedAt；本项目不是 git 仓库，取插件目录内最新的文件修改时间 */
function pluginUpdatedAt(dir: string): number {
    let max = 0;
    for (const e of readdirSync(dir, { withFileTypes: true, recursive: true })) {
        if (e.isFile()) max = Math.max(max, statSync(join(e.parentPath, e.name)).mtimeMs);
    }
    return Math.round(max);
}

/* 扫描顺序同 Void++：plugins/_core → plugins/_api → plugins/*（跳过 _ / . 开头的目录） */
function scanPluginDir(baseDir: string, imports: string[], exports: string[], mutations: string[], found: string[]) {
    if (!existsSync(baseDir)) return;
    for (const entry of readdirSync(baseDir, { withFileTypes: true }).toSorted((a, b) => a.name.localeCompare(b.name))) {
        if (!entry.isDirectory() || entry.name.startsWith("_") || entry.name.startsWith(".")) continue;
        const convention = FOLDER_CONVENTIONS.find(c => entry.name.endsWith(c.suffix));
        if (convention?.skip?.()) continue;
        const dir = join(baseDir, entry.name);
        if (!existsSync(join(dir, "index.ts"))) continue;
        const v = `p${found.length}`;
        found.push(dir);
        imports.push(`import ${v} from ${JSON.stringify(join(dir, "index.ts"))};`);
        exports.push(`[${v}.name]: ${v}`);
        mutations.push(`${v}.updatedAt=${pluginUpdatedAt(dir)};`);
        if (convention) mutations.push(convention.mutations(v));
    }
}

const pluginDirs: string[] = [];
function generatePluginModule(): string {
    const imports: string[] = [];
    const exports: string[] = [];
    const mutations: string[] = [];
    pluginDirs.length = 0;
    for (const d of [join(PLUGINS, "_core"), join(PLUGINS, "_api"), PLUGINS]) scanPluginDir(d, imports, exports, mutations, pluginDirs);
    return `${imports.join("\n")}\n${mutations.join("\n")}\nexport default { ${exports.join(", ")} };\n`;
}

const virtualPlugins: import("bun").BunPlugin = {
    name: "virtual-plugins",
    setup(build) {
        build.onResolve({ filter: /^~plugins$/ }, () => ({ path: "~plugins", namespace: "virtual" }));
        build.onLoad({ filter: /^~plugins$/, namespace: "virtual" }, () => ({ contents: generatePluginModule(), loader: "ts", resolveDir: SRC }));
    },
};

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

// 构建时刻（只取一次）：数字 version 第 4 段 = 构建序号；version_name = Asia/Shanghai 构建时间 `YYYY-MM-DD｜HH:MM:SS`（全角竖线 U+FF5C，扩展管理页显示它）
const buildNow = Date.now();
const manifestVersion = `${pkg.version}.${Math.floor((buildNow - Date.UTC(2026, 0, 1)) / 480000) % 65535}`;
const versionName = (() => {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(buildNow)).map(x => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day}\uFF5C${p.hour === "24" ? "00" : p.hour}:${p.minute}:${p.second}`;
})();
const result = await Bun.build({
    entrypoints: [...["background", "sidepanel", "content", "page", "options", "offscreen"].map(n => join(SRC, "entries", `${n}.ts`)), ...(withSelftest ? [join(SRC, "selftest", "selftest.ts")] : [])],
    outdir: OUT,
    naming: "[name].[ext]",
    target: "browser",
    format: "iife",
    minify: !isDev,
    sourcemap: isDev ? "linked" : "none",
    define: { IS_DEV: String(isDev), VERSION: JSON.stringify(versionName), VERSION_NUM: JSON.stringify(manifestVersion) },
    plugins: [virtualPlugins],
});
if (!result.success) {
    for (const l of result.logs) console.error(l);
    process.exit(1);
}

cpSync("static", OUT, { recursive: true });
if (withSelftest) cpSync(join(SRC, "selftest", "selftest.html"), join(OUT, "selftest.html"));
const manifest = JSON.parse(readFileSync("static/manifest.json", "utf-8"));
// 第 4 段 = 构建序号（距 2026-01-01 的分钟数 / 8，< 65535）：版本变了浏览器才会换掉缓存的 service worker 脚本（Helium 实测“更新”/重启都不换）
manifest.version = manifestVersion;
manifest.version_name = versionName;
if (isDev) manifest.name += " (dev)";
writeFileSync(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));
console.log(`built ${new Set(pluginDirs).size} plugins → ${relative(process.cwd(), OUT)}/ (${isDev ? "dev" : "prod"})`);
for (const d of pluginDirs) console.log("  •", relative(PLUGINS, d));

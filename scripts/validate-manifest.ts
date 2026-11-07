/* 静态校验 dist/manifest.json：MV3 必填字段、引用的文件存在、权限名合法、命令数量限制 */
import { existsSync, readFileSync } from "fs";
import { join } from "path";

const DIST = process.env.ARC_OUT ?? "dist";
const m = JSON.parse(readFileSync(join(DIST, "manifest.json"), "utf-8"));
const errors: string[] = [];
const need = (cond: unknown, msg: string) => { if (!cond) errors.push(msg); };

need(m.manifest_version === 3, "manifest_version 必须为 3");
/* _locales：default_locale = en；en 与 zh_CN 键相同；manifest 里的 __MSG_x__ 都有对应条目 */
need(m.default_locale === "en", "default_locale 应为 en");
const loc = (l: string) => JSON.parse(readFileSync(join(DIST, "_locales", l, "messages.json"), "utf-8")) as Record<string, { message: string }>;
const en = loc("en"), zhCN = loc("zh_CN");
need(Object.keys(en).toSorted().join() === Object.keys(zhCN).toSorted().join(), "_locales/en 与 zh_CN 的键不一致");
const msg = (v: unknown, l = en) => typeof v === "string" ? v.replace(/__MSG_(\w+)__/g, (_, k) => { need(l[k], `_locales 缺少 ${k}`); return l[k]?.message ?? ""; }) : v;
for (const l of [en, zhCN]) {
    need(String(msg(m.description, l)).length <= 132, "description 超过 132 字符");
    need(String(msg(m.name, l)).length <= 75, "name 过长");
    for (const c of Object.values(m.commands ?? {}) as { description?: string }[]) msg(c.description, l);
    msg(m.action?.default_title, l);
}
need(!/[\u4e00-\u9fff]/.test(readFileSync(join(DIST, "manifest.json"), "utf-8")), "manifest 里不应有硬编码中文（用 __MSG__）");
need(typeof m.name === "string" && m.name.length <= 75, "name 缺失或过长");
need(/^\d+(\.\d+){0,3}$/.test(m.version) && m.version.split(".").every((x: string) => Number(x) <= 65535), "version 必须是点分数字（≤4 段，每段 ≤65535）");
need(/^\d{4}-\d{2}-\d{2}\uFF5C\d{2}:\d{2}:\d{2}$/.test(m.version_name), "version_name 必须是 YYYY-MM-DD｜HH:MM:SS（全角竖线）");
need(m.background?.service_worker, "缺少 background.service_worker");
need(!m.background?.scripts, "MV3 不允许 background.scripts");

const files = [
    m.background?.service_worker, m.side_panel?.default_path,
    ...Object.values(m.icons ?? {}), ...Object.values(m.action?.default_icon ?? {}),
    ...(m.content_scripts ?? []).flatMap((c: { js?: string[]; css?: string[] }) => [...(c.js ?? []), ...(c.css ?? [])]),
    "split.html", "page.js", "sidepanel.js", "sidepanel.css", m.options_ui?.page, "options.js", "options.css",
];
for (const f of files) need(existsSync(join(DIST, String(f))), `文件不存在：${f}`);

const VALID = new Set(["sidePanel", "tabs", "tabGroups", "storage", "alarms", "history", "bookmarks", "downloads", "scripting",
    "sessions", "search", "contextMenus", "favicon", "declarativeNetRequest", "declarativeNetRequestWithHostAccess", "activeTab", "offscreen",
    // 视图 · 站点控制：扩展网格（management）、按站点权限（contentSettings）、按 origin 清除缓存 / Cookie（browsingData）
    "management", "contentSettings", "browsingData",
    // 站点控制 · 扩展弹窗：判断探测的弹窗页是否加载成功
    "webNavigation"]);
for (const p of m.permissions ?? []) need(VALID.has(p), `未知 / 非预期权限：${p}`);

const cmds = Object.entries(m.commands ?? {}) as [string, { suggested_key?: Record<string, string> }][];
need(cmds.filter(([, c]) => c.suggested_key).length <= 4, "带 suggested_key 的命令最多 4 个");
for (const [name, c] of cmds) for (const [plat, k] of Object.entries(c.suggested_key ?? {})) {
    need(/^((Ctrl|Alt|Shift|Command|MacCtrl|Search)\+)+([A-Z0-9]|Comma|Period|Home|End|PageUp|PageDown|Space|Insert|Delete|Up|Down|Left|Right)$/.test(k), `命令 ${name}.${plat} 快捷键不合法：${k}`);
    need(/Ctrl|Alt|Command|MacCtrl/.test(k), `命令 ${name}.${plat} 需要 Ctrl/Alt/Command`);
}

// web_accessible_resources（页内侧边栏补丁 01 引入）：必须恰好是这一条受限形态——只暴露 sidepanel.html（页内侧边栏的 iframe 要加载它），matches 只许 http:// 与 https:// 的 /* 通配。
// 每多暴露一个资源 / 多放开一个来源，所有匹配网站都能探测到「装了本扩展」，所以：<all_urls>、其它资源、extension_ids、use_dynamic_url（P0 未证明安全 / 必要）、多条目一律报错；
// 需要改动时先改这里并说明理由（共享文件，走集成线）。
const WAR_RESOURCES = ["sidepanel.html"], WAR_MATCHES = ["http://*/*", "https://*/*"];
const war = m.web_accessible_resources as { resources?: unknown; matches?: unknown; extension_ids?: unknown; use_dynamic_url?: unknown }[] | undefined;
need(Array.isArray(war) && war.length === 1, "web_accessible_resources 必须恰好 1 条（页内侧边栏：只暴露 sidepanel.html）");
if (Array.isArray(war)) for (const [i, e] of war.entries()) {
    const res = Array.isArray(e.resources) ? e.resources : [], mt = Array.isArray(e.matches) ? e.matches : [];
    need(res.length > 0 && res.every(r => typeof r === "string"), `web_accessible_resources[${i}].resources 必须是非空字符串数组`);
    for (const r of res) need(WAR_RESOURCES.includes(r as string), `web_accessible_resources[${i}] 暴露了不允许的资源：${String(r)}（只允许 ${WAR_RESOURCES.join(", ")}）`);
    need(res.length === WAR_RESOURCES.length && WAR_RESOURCES.every(r => res.includes(r)), `web_accessible_resources[${i}].resources 必须恰好是 ${JSON.stringify(WAR_RESOURCES)}`);
    for (const x of mt) need(WAR_MATCHES.includes(x as string), `web_accessible_resources[${i}].matches 只允许 ${WAR_MATCHES.join(" / ")}：${String(x)}`);
    need(mt.length === WAR_MATCHES.length && WAR_MATCHES.every(x => mt.includes(x)), `web_accessible_resources[${i}].matches 必须恰好是 ${JSON.stringify(WAR_MATCHES)}`);
    need(e.extension_ids === undefined, `web_accessible_resources[${i}] 不应有 extension_ids`);
    need(e.use_dynamic_url === undefined, `web_accessible_resources[${i}] 不应有 use_dynamic_url（P0 未证明安全 / 必要）`);
    for (const r of res) need(existsSync(join(DIST, String(r))), `web_accessible_resources[${i}] 引用的文件不存在：${String(r)}`);
}

// 引用的 html 中的脚本存在
for (const html of ["sidepanel.html", "split.html", "options.html"]) {
    const src = readFileSync(join(DIST, html), "utf-8");
    for (const [, f] of src.matchAll(/(?:src|href)="([^"]+)"/g)) need(existsSync(join(DIST, f)), `${html} 引用的 ${f} 不存在`);
    need(!/<script>[^<]/.test(src), `${html} 含内联脚本（MV3 CSP 禁止）`);
}

if (errors.length) { console.error("manifest 校验失败：\n- " + errors.join("\n- ")); process.exit(1); }
console.log(`manifest OK：${msg(m.name)} ${m.version}，locales en / zh_CN ${Object.keys(en).length} 键，${(m.permissions ?? []).length} 个权限，${cmds.length} 个命令`);
export {};

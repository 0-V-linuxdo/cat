/* 插件设置对话框 / 下拉层级验证（dialog-layering 补丁）。
 * 真实加载扩展 → 打开 options.html → 点插件卡片的「配置」→ 点对话框里的下拉 → 读 elementFromPoint / 层级 → 截图。
 * 用法：
 *   headless（不弹窗口，可随时跑）：HEADLESS=1 DIST=dist-before OUT=shots bun run scripts/dialog-layering-cdp.ts
 *   headed（真实屏幕，需父线程放行「可以跑」后才能运行；本补丁交付时 未运行）：DIST=dist bun run scripts/dialog-layering-cdp.ts
 * 环境变量：DIST（构建目录，默认 dist-check）、OUT（截图目录）、TAG（文件名前缀 before / after）、PLUGIN（默认 InpageSidebar）、
 *   SETTING（默认 prewarm；要点开的下拉的 data-setting 键）。
 * 每个场景 = 主题（light / dark）× 窗口（宽 × 高）× 对话框滚动（0 / 到底）。每个场景断言：
 *   ① 菜单 .arc-menu 的几何中心 elementFromPoint 命中菜单自己（没被对话框 / 遮罩盖住）；② 菜单完全在视口内；③ 菜单 z-index > 遮罩 z-index。
 * 有界面时截图用 Page.captureScreenshot（合成层）；若装了 import（ImageMagick）且有 DISPLAY，再多存一张整屏像素 *-screen.png。 */
import { mkdirSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { Harness, sleep } from "./lib/cdp-harness";

const DIST = resolve(process.env.DIST ?? "dist-check");
const OUT = resolve(process.env.OUT ?? "dialog-layering-shots");
const TAG = process.env.TAG ?? "run";
const PLUGIN = process.env.PLUGIN ?? "InpageSidebar";
const SETTING = process.env.SETTING ?? "prewarm";
const headless = process.env.HEADLESS === "1";
mkdirSync(OUT, { recursive: true });

const SCENES = [
    { theme: "light", w: 1000, h: 900, scroll: 0 },
    { theme: "dark", w: 1000, h: 900, scroll: 0 },
    { theme: "dark", w: 1000, h: 900, scroll: 1 },
    { theme: "light", w: 760, h: 600, scroll: 1 },
    { theme: "dark", w: 520, h: 420, scroll: 1 },
] as const;

const h = new Harness();
const fails: string[] = [];
const rows: unknown[] = [];
try {
    await h.launch();
    await h.loadExtension(DIST);
    const t = await h.open(`chrome-extension://${h.extId}/options.html`);
    const sid = t.sessionId!;
    const ev = (e: string) => h.evalIn(sid, e, { userGesture: true });
    const click = async (x: number, y: number) => {
        await h.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y }, sid);
        await h.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 }, sid);
        await h.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 }, sid);
    };
    const center = async (sel: string) => { const r = await ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: "center" }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`); if (!r) throw new Error(`找不到 ${sel}`); return r as { x: number; y: number }; };
    await sleep(1500);
    for (const sc of SCENES) {
        const name = `${TAG}-${sc.theme}-${sc.w}x${sc.h}-${sc.scroll ? "scrolled" : "top"}`;
        await h.send("Emulation.setDeviceMetricsOverride", { width: sc.w, height: sc.h, deviceScaleFactor: 1, mobile: false }, sid);
        await h.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: sc.theme }] }, sid);
        await ev(`document.documentElement.dataset.theme = ${JSON.stringify(sc.theme)}; document.querySelector(".arc-vdialog-scrim")?.remove(); void 0`);
        await sleep(200);
        // 打开对话框（真实点击卡片的配置按钮）
        const cfg = await center(`[data-config="${PLUGIN}"]`);
        await click(cfg.x, cfg.y); await sleep(300);
        if (sc.scroll) await ev(`document.querySelector(".arc-vdialog-settings").scrollTop = 1e6`);
        await ev(`void 0`); await sleep(100);
        // 打开下拉（真实点击）
        const dd = await center(`.arc-vdialog [data-setting="${PLUGIN}.${SETTING}"]`);
        await click(dd.x, dd.y); await sleep(350);
        const info = await ev(`(() => {
            const m = document.querySelector(".arc-menu"), s = document.querySelector(".arc-vdialog-scrim"), d = document.querySelector(".arc-vdialog");
            if (!m || !s) return { error: "菜单或遮罩不存在", menu: !!m, scrim: !!s };
            const r = m.getBoundingClientRect(), dr = d.getBoundingClientRect(), W = innerWidth, H = innerHeight;
            const pts = [[.5, .5], [.2, .2], [.8, .8]].map(([a, b]) => document.elementFromPoint(r.left + r.width * a, r.top + r.height * b));
            return { menuRect: [r.left, r.top, r.right, r.bottom].map(Math.round), dialogRect: [dr.left, dr.top, dr.right, dr.bottom].map(Math.round), viewport: [W, H],
                menuZ: getComputedStyle(m).zIndex, scrimZ: getComputedStyle(s).zIndex, menuParent: m.parentElement.tagName,
                hit: pts.map(e => e ? (e.closest(".arc-menu") ? "menu" : e.closest(".arc-vdialog") ? "dialog" : e.closest(".arc-vdialog-scrim") ? "scrim" : e.tagName) : "null"),
                inViewport: r.left >= 0 && r.top >= 0 && r.right <= W && r.bottom <= H, items: [...m.querySelectorAll(".arc-menu-item")].map(x => x.textContent.trim()) };
        })()`);
        rows.push({ name, ...info });
        const i = info as any;
        if (i.error) fails.push(`${name}：${i.error}`);
        else {
            if (i.hit.some((x: string) => x !== "menu")) fails.push(`${name}：下拉菜单被盖住（elementFromPoint = ${i.hit.join("/")}；menu z=${i.menuZ} < scrim z=${i.scrimZ}）`);
            if (!i.inViewport) fails.push(`${name}：下拉菜单超出视口 ${JSON.stringify(i.menuRect)} / ${JSON.stringify(i.viewport)}`);
            if (!(Number(i.menuZ) > Number(i.scrimZ))) fails.push(`${name}：菜单 z-index(${i.menuZ}) 不大于对话框遮罩(${i.scrimZ})`);
        }
        const shot = await h.send("Page.captureScreenshot", { format: "png" }, sid);
        writeFileSync(join(OUT, `${name}.png`), Buffer.from(shot.data, "base64"));
        if (!headless && process.env.DISPLAY) { try { Bun.spawnSync(["import", "-window", "root", join(OUT, `${name}-screen.png`)]); } catch { /* 没装 ImageMagick：只留合成层截图 */ } }
        await click(5, 5).catch(() => { }); // 点遮罩外面收起菜单（吞掉）
        await ev(`document.querySelector(".arc-vdialog-scrim")?.remove(); document.querySelectorAll(".arc-menu").forEach(m => m.remove()); void 0`);
    }
} finally { h.close(); }
writeFileSync(join(OUT, `${TAG}-result.json`), JSON.stringify(rows, null, 1));
for (const r of rows as any[]) console.log(r.error ? "FAIL" : (r.hit as string[]).every(x => x === "menu") ? "PASS" : "FAIL", r.name, "|", r.error ?? `menu z=${r.menuZ} scrim z=${r.scrimZ} hit=${r.hit.join("/")} inViewport=${r.inViewport}`);
console.log(fails.length ? `FAIL ${fails.length}\n${fails.join("\n")}` : "ALL PASS");
process.exit(fails.length ? 1 : 0);

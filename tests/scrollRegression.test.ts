/* 51997 回归：「无法向下滚动」——① 侧边栏主滚动容器 .arc-scroll 标签多时可滚；② ＋ 按钮路径里没有任何关闭侧边栏的调用。用 headless Chrome 渲染真实 CSS；没有 Chrome 时跳过 ①。 */
import { test, expect } from "bun:test";
import { existsSync, mkdtempSync, writeFileSync, symlinkSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import spacesCss from "../src/plugins/spaces/style";
import tabsCss from "../src/plugins/tabs/style";

const CHROME = ["/usr/bin/google-chrome", "/usr/bin/chromium"].find(existsSync);
const STATIC = resolve(import.meta.dir, "../static");

function run(body: string, script: string, h = 600) {
    const dir = mkdtempSync(join(tmpdir(), "sc-"));
    symlinkSync(join(STATIC, "sidepanel.css"), join(dir, "sidepanel.css"));
    writeFileSync(join(dir, "t.html"), `<html data-theme="dark"><link rel=stylesheet href=sidepanel.css><style>${spacesCss}${tabsCss}</style><body>${body}
<script>onload=()=>{const q=s=>document.querySelector(s);document.title=JSON.stringify((()=>{${script}})())}</script>`);
    const r = Bun.spawnSync([CHROME!, "--headless=new", "--no-sandbox", "--disable-gpu", `--window-size=320,${h}`, "--dump-dom", `file://${dir}/t.html`]);
    const m = r.stdout.toString().match(/<title>(.*?)<\/title>/);
    return JSON.parse((m?.[1] ?? "{}").replace(/&quot;/g, '"'));
}

test.skipIf(!CHROME)("主滚动容器：80 个标签时 scrollHeight>clientHeight，scrollTop 能变", () => {
    const rows = Array.from({ length: 80 }, (_, i) => `<div class=arc-tab style="height:32px">t${i}</div>`).join("");
    const f = run(`<main id=app><section class="arc-slot arc-slot-header"></section><div class=arc-scroll><section class="arc-slot arc-slot-today">${rows}</section></div><section class="arc-slot arc-slot-bottom">b</section></main>`,
        `const s=q('.arc-scroll');const a=s.scrollTop;s.scrollTop=400;return {sh:s.scrollHeight,ch:s.clientHeight,a,b:s.scrollTop}`);
    expect(f.sh).toBeGreaterThan(f.ch);
    expect(f.b).toBeGreaterThan(f.a);
});

test("＋ 按钮路径不含关闭侧边栏的调用", () => {
    const src = readFileSync(resolve(import.meta.dir, "../src/plugins/command/plusMenu/index.ts"), "utf8");
    for (const bad of ["window.close", "sidePanel", "sidebar.toggle", "setOptions"]) expect(src.includes(bad)).toBe(false);
});

test("sidePanel.open 调用都带 .catch（不会出现 Uncaught (in promise)）", () => {
    const src = readFileSync(resolve(import.meta.dir, "../src/api/SidePanelGesture.ts"), "utf8");
    for (const m of src.matchAll(/chrome\.sidePanel\.open\([^)]*\)([^;]*);/g)) expect(m[1]).toContain(".catch(");
});

test.skipIf(!CHROME)("Today 分隔线行：分隔线与 ↓Clear 同一行、线垂直居中、左右距侧栏边 18（#app 8 + 10）；+ New Tab 在下一行；固定区分隔线隐藏", () => {
    const f = run(`<main id=app><div class=arc-scroll><section class="arc-slot arc-slot-pinned"><div class=arc-part><div class=arc-pinned></div><div class=arc-divider></div></div></section><section class="arc-slot arc-slot-today"><div class=arc-part><div class=arc-today-head><span class=arc-today-sep></span><button class="arc-today-hbtn arc-today-clear"><svg class=arc-svg viewBox="0 0 16 16"></svg><span class=arc-today-clear-label>Clear</span></button></div><button class=arc-newtab><svg class=arc-svg width=16 height=16></svg><span>New Tab</span></button></div></section></div></main>`,
        `const R=s=>q(s).getBoundingClientRect(),n=R('.arc-newtab'),c=R('.arc-today-clear'),l=R('.arc-today-sep'),p=R('.arc-part'),i=R('.arc-today-clear .arc-svg');return {nt:n.top,cb:c.bottom,cy:(c.top+c.bottom)/2,ly:(l.top+l.bottom)/2,lh:l.height,ll:l.left-p.left,gap:Math.round(i.left-l.right),cr:p.right-c.right,div:getComputedStyle(q('.arc-slot-pinned .arc-divider')).display,col:getComputedStyle(q('.arc-today-sep')).backgroundColor}`);
    expect(f.nt).toBeGreaterThanOrEqual(f.cb);
    expect(Math.abs(f.cy - f.ly)).toBeLessThanOrEqual(1);
    expect(f.lh).toBe(0.5);
    expect(f.ll).toBe(10); // 距 .arc-part 10 + #app 左右 8 = 距侧栏边 18
    expect(f.gap).toBe(8);
    expect(f.cr).toBe(10); // 同上：距侧栏边 18
    expect(f.div).toBe("none");
    expect(f.col).toBe("rgba(255, 255, 255, 0.15)");
});

test.skipIf(!CHROME)("短侧栏（高 500 / 300）：图标选择器整块在视口内，.arc-ip-body 或网格可滚到最后一行", () => {
    for (const vh of [500, 300]) {
        const cells = Array.from({ length: 56 }, () => `<button class=arc-ip-cell>x</button>`).join("");
        const f = run(`<div class="arc-menu arc-panel arc-picker arc-icon-picker" style="position:fixed;top:4px;left:4px"><div class=arc-ip-head><div class=arc-ip-segs><button class=arc-ip-seg>E</button></div></div><div class=arc-ip-body><div class="arc-ip-grid arc-ip-icons">${cells}</div></div></div>`,
            `const p=q('.arc-icon-picker').getBoundingClientRect(),last=q('.arc-ip-cell:last-child');last.scrollIntoView({block:'nearest'});const l=last.getBoundingClientRect();return {bottom:p.bottom,vh:innerHeight,lb:l.bottom}`, vh);
        expect(f.bottom).toBeLessThanOrEqual(f.vh);
        expect(f.lb).toBeLessThanOrEqual(f.vh);
    }
});

test("Menu.place：比视口高的菜单被限高并自身滚动", () => {
    const src = readFileSync(resolve(import.meta.dir, "../src/components/Menu.ts"), "utf8");
    expect(src).toMatch(/offsetHeight > H - 8\)[\s\S]{0,200}maxHeight[\s\S]{0,80}overflowY = "auto"[\s\S]{0,80}overscrollBehavior = "contain"/);
});

test("横滑切 Space 忽略菜单 / 弹层 / 选择器里的滚轮", () => {
    const src = readFileSync(resolve(import.meta.dir, "../src/plugins/spaces/spaceManager/index.ts"), "utf8");
    const sel = /SWIPE_IGNORE = "([^"]+)"/.exec(src)?.[1] ?? "";
    for (const c of [".arc-menu", ".arc-panel", ".arc-overlay", ".arc-icon-picker"]) expect(sel).toContain(c);
    expect(src).toMatch(/onWheel = \(e: WheelEvent\) => \{[\s\S]{0,200}closest\?\.\(SWIPE_IGNORE\) \|\| document\.querySelector\(SWIPE_BLOCKERS\)\) return;/);
    expect(/SWIPE_BLOCKERS = "([^"]+)"/.exec(src)?.[1]).toContain(".arc-menu:not([hidden])");
});

test.skipIf(!CHROME)("+ New Tab：静止透明，悬停才有底（深色 α.075 / 浅色 α.06）", () => {
    const f = run(`<main id=app><button class=arc-newtab><svg class=arc-svg width=16 height=16></svg><span>New Tab</span></button></main>`,
        `const rest=getComputedStyle(q('.arc-newtab')).backgroundColor;const hv=[];for(const sh of document.styleSheets){let rs=[];try{rs=[...sh.cssRules]}catch{}for(const r of rs){const walk=x=>{if(x.selectorText&&/\\.arc-newtab:hover/.test(x.selectorText)&&x.style.backgroundColor)hv.push(x.selectorText+'|'+x.style.backgroundColor);if(x.cssRules)for(const y of x.cssRules)walk(y)};walk(r)}}return {rest,hv}`);
    expect(f.rest).toBe("rgba(0, 0, 0, 0)");
    expect(f.hv.some((x: string) => /data-theme="dark"/.test(x) && /0\.075/.test(x))).toBe(true);
    expect(f.hv.some((x: string) => !/dark/.test(x) && /0\.06/.test(x))).toBe(true);
});

/* rel35：底栏（图标行）任何情况下都不出现滚动条、不被裁切。
 * 实机 53120 的“底部滚动条”= todayTabs overflowHint 的 .arc-overflow（fixed 贴窗口底边 bottom:2px、3px 高的通栏线，当前标签在视区外时出现），不是原生滚动条，也不是高度溢出；
 * 这里用 headless Chrome 渲染真实 static/sidepanel.css + spaces / tabs 样式，量：整页不溢出、底栏高 50 且整块在视口内、底栏 / 空间条 / 主滚动区没有原生滚动条（Linux headless 是经典 15px 滚动条，能量到）、
 * 当前标签滚出视区后页面里没有任何 position:fixed 的可见元素贴在底边。没有 Chrome 时只跑源码断言。 */
import { test, expect } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync, symlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import spacesCss from "../src/plugins/spaces/style";
import tabsCss from "../src/plugins/tabs/style";

const CHROME = ["/usr/bin/google-chrome", "/usr/bin/chromium"].find(existsSync);
const ROOT = resolve(import.meta.dir, "..");
const STATIC = join(ROOT, "static");

function run(vh: number, dots: number, rows: number) {
    const dir = mkdtempSync(join(tmpdir(), "bbns-"));
    symlinkSync(join(STATIC, "sidepanel.css"), join(dir, "sidepanel.css"));
    const tabs = Array.from({ length: rows }, (_, i) => `<div class="arc-tab${i === rows - 1 ? " active" : ""}" style="height:32px">t${i}</div>`).join("");
    const ds = Array.from({ length: dots }, (_, i) => `<button class="arc-space-dot${i === 0 ? " active" : ""}">${i}</button>`).join("");
    writeFileSync(join(dir, "t.html"), `<html data-theme="dark"><link rel=stylesheet href=sidepanel.css><style>${spacesCss}${tabsCss}</style><body>
<main id=app><section class="arc-slot arc-slot-header">h</section><div class=arc-scroll><section class="arc-slot arc-slot-today">${tabs}</section></div>
<section class="arc-slot arc-slot-bottom" data-slot=bottom><div class=arc-part data-plugin=LibraryView><button class="arc-icon-btn arc-lib-btn">L</button></div><div class=arc-part data-plugin=Spaces><div class=arc-space-bar>${ds}</div></div><div class=arc-part data-plugin=PlusMenu><div class=arc-plus><button class="arc-icon-btn arc-plus-btn">+</button></div></div></section></main>
<div id=ctl style="position:absolute;left:-999px;top:0;width:50px;height:50px;overflow:auto"><div style="height:200px"></div></div>
<script>onload=()=>{const q=s=>document.querySelector(s);q('.arc-tab.active').scrollIntoView({block:'end'});q('.arc-scroll').scrollTop=0;
const sb=e=>({w:e.offsetWidth-e.clientWidth,h:e.offsetHeight-e.clientHeight}),de=document.documentElement;
const fixedVisible=[...document.body.querySelectorAll('*')].filter(e=>getComputedStyle(e).position==='fixed'&&e.offsetParent===null&&getComputedStyle(e).display!=='none'&&getComputedStyle(e).visibility!=='hidden'&&e.getBoundingClientRect().width>0).map(e=>e.className);
const bar=q('.arc-slot-bottom').getBoundingClientRect(),ctl=sb(q('#ctl'));
document.title=JSON.stringify({vh:innerHeight,htmlSH:de.scrollHeight,htmlCH:de.clientHeight,bodySH:document.body.scrollHeight,barH:bar.height,barBottom:bar.bottom,barTop:bar.top,
 bottomSb:sb(q('.arc-slot-bottom')),spaceSb:sb(q('.arc-space-bar')),scrollSb:sb(q('.arc-scroll')),ctl,barSH:q('.arc-slot-bottom').scrollHeight,barCH:q('.arc-slot-bottom').clientHeight,spSH:q('.arc-space-bar').scrollHeight,spCH:q('.arc-space-bar').clientHeight,
 spSW:q('.arc-space-bar').scrollWidth,spCW:q('.arc-space-bar').clientWidth,mainOverflows:q('.arc-scroll').scrollHeight>q('.arc-scroll').clientHeight,fixedVisible})}</script>`);
    const r = Bun.spawnSync([CHROME!, "--headless=new", "--no-sandbox", "--disable-gpu", `--window-size=300,${vh}`, "--dump-dom", `file://${dir}/t.html`]);
    const m = r.stdout.toString().match(/<title>(.*?)<\/title>/);
    return JSON.parse((m?.[1] ?? "{}").replace(/&quot;/g, '"'));
}

test.skipIf(!CHROME)("底栏无滚动条、不裁切：窗口高 600–900 × 多个空间 × 标签很多（当前标签在视区外）", () => {
    for (const vh of [600, 700, 800, 900]) for (const dots of [3, 30]) {
        const f = run(vh, dots, 60);
        expect(f.mainOverflows).toBe(true); // 夹具有效：主滚动区确实溢出（标签很多），当前标签被滚出视区
        expect(f.ctl.w).toBeGreaterThan(0); // 对照：不隐藏的 overflow:auto 在 headless 里量得到经典滚动条（证明下面的 0 是真的 0）
        expect(f.htmlSH).toBeLessThanOrEqual(f.htmlCH); // 整页不溢出（html / body overflow:hidden，#app 高 100%）
        expect(f.barH).toBe(50); // bottom-bar.md §7.4
        expect(f.barBottom).toBeLessThanOrEqual(f.vh); // 底栏整块在视口内：没被窗口底边裁掉
        expect(f.bottomSb).toEqual({ w: 0, h: 0 });
        expect(f.spaceSb).toEqual({ w: 0, h: 0 }); // .arc-space-bar overflow-x:auto：原生滚动条必须被隐藏
        expect(f.scrollSb).toEqual({ w: 0, h: 0 }); // 主滚动区同理
        expect(f.barSH).toBeLessThanOrEqual(f.barCH); // 底栏没有垂直溢出
        expect(f.spSH).toBeLessThanOrEqual(f.spCH); // 空间条没有垂直溢出（横向可滚，但不出现纵向）
        expect(f.fixedVisible).toEqual([]); // 静态夹具里没有 position:fixed 的可见元素（旧 .arc-overflow 由 JS 创建，由下面的源码用例拦截）
    }
});

test("源码：没有贴窗口边缘的 .arc-overflow 指示条；底栏 / 空间条不允许纵向滚动", () => {
    const css = readFileSync(join(STATIC, "sidepanel.css"), "utf8");
    const today = readFileSync(join(ROOT, "src/plugins/tabs/todayTabs/index.ts"), "utf8");
    expect(css).not.toMatch(/\.arc-overflow\s*[{[]/);
    expect(today).not.toContain("arc-overflow");
    expect(today).not.toContain("overflowHint");
    // 空间条的原生滚动条必须隐藏（spaces/style.ts）
    expect(spacesCss).toMatch(/\.arc-space-bar\s*\{[^}]*scrollbar-width:\s*none/);
    expect(spacesCss).toMatch(/\.arc-space-bar::-webkit-scrollbar\s*\{\s*display:\s*none/);
    // 底栏 / 空间条不出现纵向滚动（overflow / overflow-y 不能是 auto | scroll）
    for (const m of css.matchAll(/([^{}]*\.arc-(?:slot-bottom|space-bar)[^{}]*)\{([^}]*)\}/g)) {
        expect(m[2]).not.toMatch(/overflow(?:-y)?:\s*(?:auto|scroll)/);
        if (/overflow:/.test(m[2])) throw new Error(`底栏规则不应使用 overflow 简写（会带出纵向滚动）：${m[1].trim()}`);
    }
    // 窗口层：html / body 不滚动
    expect(css).toMatch(/html,\s*body\s*\{[^}]*height:\s*100%/);
    expect(css).toMatch(/body\s*\{[^}]*overflow:\s*hidden/);
});

/* 底栏边距 / 着色回归（验收 51979 P1、P3）。用 headless Chrome 渲染真实 static/sidepanel.css 读 computed style；没有 Chrome 时跳过。 */
import { test, expect } from "bun:test";
import { existsSync, mkdtempSync, writeFileSync, symlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const CHROME = ["/usr/bin/google-chrome", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find(existsSync);
const STATIC = resolve(import.meta.dir, "../static");

function measure(attrs: string) {
    const dir = mkdtempSync(join(tmpdir(), "bb-"));
    symlinkSync(join(STATIC, "sidepanel.css"), join(dir, "sidepanel.css"));
    symlinkSync(join(STATIC, "icons"), join(dir, "icons"));
    writeFileSync(join(dir, "t.html"), `<html ${attrs}><link rel=stylesheet href=sidepanel.css><body><main id=app><div class=arc-scroll></div>
<section class="arc-slot arc-slot-bottom" data-slot=bottom><div class=arc-part data-plugin=LibraryView><button class="arc-icon-btn arc-lib-btn"><span class=arc-boxthings><i class=b><b></b></i></span></button></div>
<div class=arc-part data-plugin=Spaces><div class=arc-space-bar></div></div><div class=arc-part data-plugin=PlusMenu><div class=arc-plus><button class="arc-icon-btn arc-plus-btn"><svg class=arc-svg width=16 height=16></svg></button></div></div></section></main>
<script>onload=()=>{const W=document.documentElement.clientWidth,q=s=>document.querySelector(s),l=q('.arc-lib-btn').getBoundingClientRect(),p=q('.arc-plus-btn').getBoundingClientRect(),bar=q('.arc-slot-bottom').getBoundingClientRect();
document.title=JSON.stringify({left:l.left,right:W-p.right,lw:l.width,pw:p.width,h:bar.height,lib:getComputedStyle(q('.arc-boxthings .b > b')).backgroundColor,plus:getComputedStyle(q('.arc-plus-btn')).color})}</script>`);
    const r = Bun.spawnSync([CHROME!, "--headless=new", "--no-sandbox", "--disable-gpu", "--window-size=320,600", "--dump-dom", `file://${dir}/t.html`]);
    const m = r.stdout.toString().match(/<title>(.*?)<\/title>/);
    return JSON.parse((m?.[1] ?? "{}").replace(/&quot;/g, '"'));
}

test.skipIf(!CHROME)("底栏：Library 距左 8、＋ 距右 8、按钮 32、高 50（bottom-bar.md §5/§7.4）", () => {
    const f = measure('data-theme="dark" data-bb-dark="1"');
    expect(f).toMatchObject({ left: 8, right: 8, lw: 32, pw: 32, h: 50 });
});
test.skipIf(!CHROME)("图标着色：深色 59.2% 白、浅色 56.5% 黑（GrayA11）", () => {
    const d = measure('data-theme="dark" data-bb-dark="1"'), l = measure('data-theme="light" data-bb-dark="0"');
    expect([d.lib, d.plus]).toEqual(["rgba(255, 255, 255, 0.592)", "rgba(255, 255, 255, 0.592)"]);
    expect([l.lib, l.plus]).toEqual(["rgba(0, 0, 0, 0.565)", "rgba(0, 0, 0, 0.565)"]);
});

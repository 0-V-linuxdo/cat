/* Today 标题行（Rea 源码规格）：从源文件断言数值 */
import { test, expect } from "bun:test";
const css = await Bun.file(new URL("../src/plugins/tabs/style.ts", import.meta.url)).text();
const ts = await Bun.file(new URL("../src/plugins/tabs/todayTabs/index.ts", import.meta.url)).text();
const en = await Bun.file(new URL("../src/i18n/en.ts", import.meta.url)).text();
const app = await Bun.file(new URL("../static/sidepanel.css", import.meta.url)).text();
const rule = (sel: string) => { const i = css.indexOf(`${sel} {`); expect(i).toBeGreaterThanOrEqual(0); return css.slice(i, css.indexOf("}", i)); };

test("行：高 16、左右内缩合计 18（#app 8 + 10）、间距 8", () => {
    const r = rule(".arc-today-head");
    expect(r).toContain("height: 16px"); expect(r).toContain("padding: 0 calc(18px - 8px)"); expect(r).toContain("gap: 8px");
    expect(app).toMatch(/#app \{[^}]*padding: 10px 8px 6px/);
    expect(rule(".arc-today-tidy")).toContain("margin-right: 0");
});
test("顺序：分隔线 → Tidy → Clear", () => {
    const a = ts.indexOf('"arc-today-sep"'), b = ts.indexOf("arc-today-tidy"), c = ts.indexOf("arc-today-clear");
    expect(a).toBeGreaterThan(0); expect(b).toBeGreaterThan(a); expect(c).toBeGreaterThan(b);
});
test("分隔线：0.5 粗、伸展、浅 .15 黑 / 深 .15 白（两种深色条件）", () => {
    const r = rule(".arc-today-sep");
    expect(r).toContain("flex: 1"); expect(r).toContain("height: .5px"); expect(r).toContain("rgb(0 0 0/.15)");
    expect(css).toContain(':root[data-theme="dark"] .arc-today-sep { background: rgb(255 255 255/.15); }');
    expect(css).toContain(':root:not([data-theme="light"]) .arc-today-sep { background: rgb(255 255 255/.15); }');
});
test("Clear：10pt Bold、宽 27.5、无内边距；箭头 arrowDownBold 自身比例、间距 2", () => {
    expect(css).toContain(".arc-today-hbtn.arc-today-clear { font-size: 10px; font-weight: 700; }");
    expect(css.slice(css.indexOf("\n.arc-today-clear-label {"))).toContain("width: 27.5px");
    const h = rule(".arc-today-hbtn"); expect(h).toContain("padding: 0"); expect(h).toContain("gap: 2px"); expect(h).toContain("border-radius: 0");
    expect(ts).toContain('icon("arrowDownBold", 10)');
    expect(rule(".arc-today-clear > .arc-svg")).toContain("width: 7.837px; height: 9.351px");
});
test("颜色：静止 Tertiary .30；悬停 Primary 浅 .90 / 深 .80；按下 ×.66", () => {
    expect(rule(".arc-today-hbtn")).toContain("color: rgb(0 0 0/.30)");
    expect(css).toContain(".arc-today-hbtn:hover { color: rgb(14 15 16/.90); }");
    expect(css).toContain(':root:not([data-theme="light"]) .arc-today-hbtn:hover { color: rgb(255 255 255/.80); }');
    expect(css).toContain(".arc-today-hbtn.pressed { color: rgb(14 15 16/.594); }");
    expect(css).toContain(':root[data-theme="dark"] .arc-today-hbtn.pressed { color: rgb(255 255 255/.528); }');
    expect(css).toContain(':root:not([data-theme="light"]) .arc-today-hbtn.pressed { color: rgb(255 255 255/.528); }');
});
test("按下箭头下移 3、0.175s；淡入淡出 0.1 easeOut；抬起在内才触发；tooltip", () => {
    expect(css).toContain(".arc-today-clear.pressed > .arc-svg { transform: translateY(3px); }");
    expect(rule(".arc-today-clear > .arc-svg")).toContain("transition: transform .175s");
    expect(rule(".arc-today-hbtn")).toContain("opacity .1s ease-out");
    expect(ts).toContain("if (down && inside)");
    expect(ts).toContain('"data-tip": tr("today.cmdClear")');
    expect(en).toContain('"today.cmdClear": "Clear Today tabs"');
    const hb = ts.slice(ts.indexOf("function headButton")); expect(hb).not.toContain("b.title"); expect(hb).not.toContain("\"title\""); // 原生 title 已去掉，只用 ArcTooltip（data-tip）
});

test("箭头到 Clear 字形间距 2：标签 27.5 左对齐（余量落在右侧），无字距", () => {
    const r = css.slice(css.indexOf("\n.arc-today-clear-label {")); const l = r.slice(0, r.indexOf("}"));
    expect(l).toContain("width: 27.5px"); expect(l).toContain("text-align: left"); expect(l).toContain("letter-spacing: 0");
    expect(ts).toMatch(/icon\("arrowDownBold", 10\), h\("span", \{ class: "arc-today-clear-label" \}/); // 箭头与标签之间无空白文本节点
});
test("headButton：拖出 / 取消 / 失去捕获 / 任意处抬起都解除 .pressed；点击仍只在内部抬起", () => {
    const hb = ts.slice(ts.indexOf("function headButton"));
    for (const ev of ["pointercancel", "lostpointercapture", "pointerleave"]) expect(hb).toMatch(new RegExp(`addEventListener\\("${ev}", [^\\n]*(release|remove\\("pressed"\\))`));
    expect(hb).toContain('document.addEventListener("pointerup", docUp, true)');
    expect(hb).toContain("if (down && inside)");
});

test("强制深色设 color-scheme: dark", () => {
    expect(app).toMatch(/:root\[data-theme="dark"\] \{\n  color-scheme: dark;/);
});

test("Clear / 分隔线按实际色调（data-bb-dark）取色，排在 data-theme 规则之后", () => {
    const at = (s: string) => { const i = css.indexOf(s); expect(i).toBeGreaterThan(0); return i; };
    const dark = at(':root[data-bb-dark="1"] .arc-today-hbtn { color: rgb(255 255 255/.30); }');
    expect(dark).toBeGreaterThan(at(':root:not([data-theme="light"]) .arc-today-hbtn.pressed'));
    at(':root[data-bb-dark="1"] .arc-today-hbtn:hover { color: rgb(255 255 255/.80); }');
    at(':root[data-bb-dark="1"] .arc-today-hbtn.pressed { color: rgb(255 255 255/.528); }');
    at(':root[data-bb-dark="0"] .arc-today-hbtn { color: rgb(0 0 0/.30); }');
    at(':root[data-bb-dark="0"] .arc-today-hbtn.pressed { color: rgb(14 15 16/.594); }');
    at(':root[data-bb-dark="1"] .arc-today-sep { background: rgb(255 255 255/.15); }');
});

test("插件按钮无 icon：只画标签（no-icon 类、无图标 / 竖线 / 间距、按下不位移）", () => {
    expect(ts).toContain('const ic = (d as { icon?: string }).icon || ""');
    expect(ts).toContain('${ic ? "" : " no-icon"}');
    expect(ts).toContain('...(ic ? [icon(ic as IconName, 12), h("span", { class: "arc-today-vrule" })] : []), h("span", null, d.label)');
    expect(css).toContain(".arc-today-hbtn.no-icon { gap: 0; }");
    expect(css).toContain(".arc-today-hbtn.no-icon.pressed > * { transform: none; }");
});

test("Tidy 扫帚：12px、只在按下时旋转 -25°（审计 52193 N-01，sidebar-features.md:326），linear() 弹簧，只作用于 broom 图标", () => {
    expect(css).toMatch(/\.arc-today-hbtn:has\(> \.arc-svg-broom\) > \.arc-svg-broom \{ width: 12px; height: 12px;[^}]*transition: transform \.45s linear\(/);
    expect(css).toContain(".arc-today-hbtn:has(> .arc-svg-broom).pressed > .arc-svg-broom { transform: rotate(-25deg); }");
    expect(css).not.toContain(":is(:hover, .pressed) > .arc-svg-broom");
});

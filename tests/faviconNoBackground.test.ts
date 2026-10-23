import { test, expect } from "bun:test";
import { readFileSync } from "fs";
const css = readFileSync(new URL("../src/plugins/library/style.ts", import.meta.url), "utf8") + "\n" + readFileSync(new URL("../static/sidepanel.css", import.meta.url), "utf8");
const lib = readFileSync(new URL("../src/plugins/library/style.ts", import.meta.url), "utf8");
const side = readFileSync(new URL("../static/sidepanel.css", import.meta.url), "utf8");
test("library favbox has no background block", () => {
  const rule = css.match(/\.arc-lib-favbox\s*\{[^}]*\}/)![0];
  expect(rule).not.toMatch(/background:(?!\s*none)/);
  expect(rule).not.toContain("color-mix");
});
test("favbox inner favicon has no background", () => {
  const rule = css.match(/\.arc-lib-favbox > \.arc-fav\s*\{[^}]*\}/)![0];
  expect(rule).not.toContain("background");
});
test("favicon is 16px", () => {
  expect(css).toMatch(/\.arc-lib-favbox > \.arc-fav\s*\{[^}]*width: 16px; height: 16px/);
});
test("archive accessory: row, gap 2, 66/0 wide, 32 high, opacity 1/0, no display toggle", () => {
  const base = css.match(/\.arc-lib-acts\s*\{[^}]*\}/)![0];
  for (const s of ["flex-direction: row", "gap: 2px", "width: 0", "height: 32px", "opacity: 0"]) expect(base).toContain(s);
  const shown = css.match(/\.arc-lib-row:hover \.arc-lib-acts[^{]*\{[^}]*\}/)![0];
  expect(shown).toContain("width: 66px"); expect(shown).toContain("opacity: 1");
  expect(css).not.toMatch(/\.arc-lib-act\s*\{\s*display:\s*none/);
});
const rule = (re: RegExp) => css.match(re)![0];
test("§8 row: padding 0 12, h56, r12, transparent; hover/selected primary 10%", () => {
  const r = rule(/\.arc-lib-row\s*\{[^}]*\}/);
  for (const s of ["flex-direction: row", "align-items: center", "padding: 0 12px", "min-height: 56px", "border-radius: 12px", "background: transparent"]) expect(r).toContain(s);
  const h = rule(/\.arc-lib-row:hover, \.arc-lib-row:focus-visible, \.arc-lib-row\.current\s*\{[^}]*\}/);
  expect(h).toContain("var(--arc-fg) 10%");
  expect(css).not.toContain("var(--arc-fg) 8%");
  expect(css).not.toMatch(/\.arc-lib-row\.current\s*\{[^}]*arc-tile/);
});
test("§8 text column / title / url", () => {
  const t = rule(/\.arc-lib-text\s*\{[^}]*\}/); expect(t).toContain("gap: 2px"); expect(t).toContain("align-items: flex-start");
  const ti = rule(/\.arc-lib-title\s*\{[^}]*\}/);
  for (const s of ["font-size: 14px", "font-weight: 400", "opacity: .85"]) expect(ti).toContain(s);
  expect(css).toMatch(/\.arc-lib-row\.current \.arc-lib-title\s*\{\s*opacity: 1/);
  expect(rule(/^\.arc-lib-url\s*\{[^}]*}/m)).toContain("font-size: 12px");
  expect(css).toMatch(/\.arc-lib-url:empty\s*\{\s*display: none/);
  expect(rule(/\.arc-lib-title, \.arc-lib-url\s*\{[^}]*\}/)).toContain("white-space: nowrap");
});
test("§8 accessory shows on selected, hides while scrolling; act specificity beats .arc-icon-btn", () => {
  expect(css).toMatch(/\.arc-lib-row\.current \.arc-lib-acts\s*\{\s*width: 66px; opacity: 1/);
  expect(css).toMatch(/\.arc-lib-list\.scrolling \.arc-lib-acts\s*\{\s*width: 0; opacity: 0/);
  expect(css).toMatch(/\.arc-lib-row \.arc-lib-act\s*\{\s*width: 0;/);
  expect(css).not.toMatch(/^\.arc-lib-act\s*\{/m);
});
test("no-favicon placeholder has bg block; with-favicon box stays bare", () => {
  expect(rule(/^\.arc-lib-favbox\s*\{[^}]*}/m)).toContain("background: none");
  const ph = rule(/\.arc-lib-favbox\.no-fav\s*\{[^}]*}/);
  expect(ph).toContain("var(--arc-fg) 5%"); expect(ph).toContain("border-radius: 8px");
});
test("common list rules live in sidepanel.css (Boosts), not duplicated in library/style.ts", () => {
  for (const s of [/^\.arc-lib-list \{/m, /^\.arc-lib-text \{/m, /^\.arc-lib-title \{/m, /^\.arc-lib-url \{/m, /^\.arc-lib-favbox \{/m, /^\.arc-lib-favbox > \.arc-fav \{/m, /^\.arc-lib-favbox\.no-fav \{/m]) {
    expect(side).toMatch(s); expect(lib).not.toMatch(s);
  }
});
test("sidepanel.css: selected row keeps buttons; hidden collapses to width 0", () => {
  expect(side).toMatch(/:root \.arc-lib-row \.arc-lib-act \{ width: 0; min-width: 0; padding: 0; opacity: 0/);
  expect(side).toMatch(/:root \.arc-lib-row\.current \.arc-lib-act \{[^}]*width: 28px; opacity: 1/);
  expect(side).toMatch(/:root \.arc-lib-row\.current \.arc-lib-acts \{ width: 66px; opacity: 1/);
  expect(side).not.toMatch(/\.arc-lib-act \{ display: none/);
});
test("fixed 4-col favorites grid removed from sidepanel.css", () => {
  expect(side).not.toMatch(/:root \.arc-fav-grid \{ grid-template-columns: repeat\(4/);
});
test("archive search placeholder ellipsis", () => {
  expect(lib).toMatch(/\.arc-input\.arc-lib-search \{[^}]*text-overflow: ellipsis/);
  expect(lib).toMatch(/\.arc-input\.arc-lib-search::placeholder \{[^}]*text-overflow: ellipsis/);
});
test("search bar does not shrink over first group title", () => {
  expect(lib).toMatch(/^\.arc-lib-top \{[^}]*flex: none/m);
  expect(side).toMatch(/^\.arc-lib-pills \{ flex: none/m);
});
test("archive search: Rea SwiftUI 常量（icon x 14.5、文字起点 44、右 10），narrow rule after base rules", () => {
  expect(lib).toMatch(/\.arc-input\.arc-lib-search \{[^}]*padding-left: 44px; padding-right: 10px/);
  // Rea folder-icon-search-padding.md §C：iconX = hPad(10) + leadPad(4.5)；textX = hPad(10) + 4.5 + 15 + 4.5 + spacing(10) = 44
  const left = Number(lib.match(/\.arc-lib-searchwrap > \.arc-svg \{[^}]*left: ([\d.]+)px/)![1]);
  const w = Number(lib.match(/\.arc-lib-searchwrap > \.arc-svg-search \{ width: (\d+)px; height: (\d+)px/)![1]);
  const pad = Number(lib.match(/\.arc-input\.arc-lib-search \{[^}]*padding-left: (\d+)px/)![1]);
  expect(w).toBe(15);
  expect(left).toBe(10 + 4.5);
  expect(pad).toBe(10 + 4.5 + w + 4.5 + 10);
  expect(pad).toBe(44);
  const cq = lib.indexOf("@container (max-width: 260px)");
  expect(cq).toBeGreaterThan(lib.indexOf(".arc-lib-filter { all: unset"));
  expect(cq).toBeGreaterThan(lib.search(/^\.arc-lib-top \{/m));
  expect(lib.slice(cq, lib.indexOf("\n", cq))).toContain(".arc-lib-top { gap: 4px; }");
});
test("rail item: hover 5% / selected 10% of --lib-primary, single layer each", () => {
  for (const src of [lib, side]) {
    expect(src).toMatch(/\.arc-lib-item:hover \{ background: color-mix\(in srgb, var\(--lib-primary[^)]*\)?\) 5%, transparent\)/);
    expect(src).toMatch(/\.arc-lib-item\.active \{ background: color-mix\(in srgb, var\(--lib-primary[^)]*\)?\) 10%, transparent\)/);
  }
  expect(side).toMatch(/--bb-hover: rgb\(255 255 255\/\.077\)/); // 底栏 Library 按钮 hover = GrayA4，不是 rail 5%
});

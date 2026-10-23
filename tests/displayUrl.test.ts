import { expect, test } from "bun:test";
import { arcHost, browserScheme, displayUrl } from "../src/api/displayUrl";

test("品牌识别", () => {
    expect(browserScheme([{ brand: "Helium" }, { brand: "Chromium" }], "")).toBe("helium");
    expect(browserScheme([{ brand: "Microsoft Edge" }], "")).toBe("edge");
    expect(browserScheme([{ brand: "Google Chrome" }, { brand: "Chromium" }], "")).toBe("chrome");
    expect(browserScheme([], "Mozilla/5.0 ... Chrome/140")).toBe("chrome");
});
test("内部页换协议名、裸 / 去掉、有路径保留", () => {
    expect(displayUrl("chrome://extensions/", "full", "helium")).toBe("helium://extensions");
    expect(displayUrl("chrome://settings/privacy", "full", "helium")).toBe("helium://settings/privacy");
    expect(displayUrl("chrome://flags/?x=1", "full", "helium")).toBe("helium://flags/?x=1");
    expect(displayUrl("chrome://extensions/", "full", "chrome")).toBe("chrome://extensions");
    expect(displayUrl("helium://flags/", "full", "helium")).toBe("helium://flags");
});
test("普通网址 / 扩展页 / 空值原样", () => {
    expect(displayUrl("https://example.com/", "full", "helium")).toBe("https://example.com/");
    expect(displayUrl("chrome-extension://abc/x.html", "full", "helium")).toBe("chrome-extension://abc/x.html");
    expect(displayUrl("about:blank", "full", "helium")).toBe("");
    expect(displayUrl(undefined)).toBe("");
});
test("arcHost：去 scheme / www / path（url-format.md）", () => {
    expect(arcHost("https://www.Example.com/a?b#c", "helium")).toBe("example.com");
    expect(arcHost("chrome://extensions/", "helium")).toBe("helium://extensions");
});

test("domain 模式（url-format.md）：去 scheme / www、截掉 / 与 ? 之后、转小写", () => {
    expect(displayUrl("https://www.Example.com/a/b?c=1#d", "domain", "helium")).toBe("example.com");
    expect(displayUrl("http://example.com?q=1", "domain", "helium")).toBe("example.com");
    expect(displayUrl("https://user:pw@www.a.com:8080/x", "domain", "helium")).toBe("a.com:8080");
    expect(displayUrl("chrome://extensions/", "domain", "helium")).toBe("helium://extensions");
    expect(displayUrl("chrome://settings/privacy", "domain", "helium")).toBe("helium://settings");
    expect(displayUrl("chrome-extension://abc/x.html", "domain", "helium")).toBe("chrome-extension://abc");
});

import { readFileSync } from "fs";
test("胶囊（Top Bar = domain，url-format.md）", () => {
    const pill = (url: string) => displayUrl(url, "domain", "helium");
    expect(pill("https://www.GitHub.com/a/b?c")).toBe("github.com");
    expect(pill("http://user:pw@example.com:8080/x")).toBe("example.com:8080");
    expect(pill("chrome://extensions/?id=x")).toBe("helium://extensions");
    expect(pill("chrome://settings/privacy/")).toBe("helium://settings");
});
test("接入点源码守护：navigation / pinnedTabs / liveFolders", () => {
    const nav = readFileSync("src/plugins/command/navigation/index.ts", "utf8");
    expect(nav).toContain('return displayUrl(url, "domain")');
    expect(nav).toContain('if (!url || isBlankPage(url)) return "";');
    expect(nav).toContain('displayHost(t?.url || t?.pendingUrl, t?.title) || tr("cmdbar.placeholder")');
    expect(readFileSync("src/i18n/en.ts", "utf8")).toContain('"cmdbar.placeholder": "Search or Enter URL…"');
    // tooltip-urlbar.md：地址栏及其图标无 tooltip，只留 aria-label
    expect(nav).not.toContain("\"data-tip\"");
    expect(nav).toContain('class: "arc-urlbar-icon arc-insecure", "data-test": "urlbar-icon", "aria-label": tr("nav.insecure"), onclick: openSite');
    expect(nav).toContain('"aria-label": tr("tab.copyLink")');
    expect(nav).toContain('"aria-label": tr("site.open")');
    expect(nav).toContain('"aria-label": displayUrl(t?.url)');
    expect(readFileSync("src/plugins/tabs/pinnedTabs/index.ts", "utf8")).toContain("n.title || displayUrl(n.url)");
    const lf = readFileSync("src/plugins/tabs/liveFolders/index.ts", "utf8");
    expect(lf).not.toContain("displayUrl("); expect(lf).toContain('i.title, { delay: 1.5, anchor: "cursor" })'); // tooltip-row.md：仅标题
});

/* 52024 实机：Helium 155 的 UA / brands 与 Google Chrome 完全相同（Helium DevTools 只读读取） */
const HELIUM_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36";
const HELIUM_BRANDS = [{ brand: "Google Chrome", version: "155" }, { brand: "Chromium", version: "155" }, { brand: "Not(A:Brand", version: "24" }];
test("Helium 真实 UA/brands：品牌识别只能得到 chrome（复现 52024）", () => {
    expect(browserScheme(HELIUM_BRANDS, HELIUM_UA)).toBe("chrome");
});
test("Helium：内置 uBO 组件 id 存在 → helium，并写入 storage；胶囊显示 helium://extensions", async () => {
    const { detectBrowserScheme, HELIUM_UBLOCK_ID, setBrowserSchemeForTest } = await import("../src/api/displayUrl");
    const saved: Record<string, unknown> = {};
    const s = await detectBrowserScheme({
        management: { get: async (id: string) => { if (id !== HELIUM_UBLOCK_ID) throw new Error("not installed"); return { id }; } },
        storage: { get: async () => saved, set: async v => { Object.assign(saved, v); } },
    });
    expect(s).toBe("helium");
    expect(saved["arc-browser-scheme"]).toBe("helium");
    expect(displayUrl("chrome://extensions/", "domain")).toBe("helium://extensions");   // 使用缓存的协议名
    setBrowserSchemeForTest(undefined);
});
test("Chrome：没有内置 uBO（management.get 抛错）→ chrome", async () => {
    const { detectBrowserScheme, setBrowserSchemeForTest } = await import("../src/api/displayUrl");
    const s = await detectBrowserScheme({ management: { get: async () => { throw new Error("No extension with id"); } } });
    expect(s).toBe("chrome");
    setBrowserSchemeForTest(undefined);
});
test("loadCachedBrowserScheme：读上次识别结果", async () => {
    const { loadCachedBrowserScheme, setBrowserSchemeForTest } = await import("../src/api/displayUrl");
    expect(await loadCachedBrowserScheme({ get: async () => ({ "arc-browser-scheme": "helium" }), set: async () => { } })).toBe("helium");
    expect(displayUrl("chrome://flags/", "domain")).toBe("helium://flags");
    setBrowserSchemeForTest(undefined);
});
test("navigation 启动时识别并重绘", () => {
    const nav = readFileSync("src/plugins/command/navigation/index.ts", "utf8");
    expect(nav).toContain("loadCachedBrowserScheme().then(() => detectBrowserScheme()).then(() => refresh())");
});

test("domain 短形式：非 http 协议（⛔ Rea 未覆盖，实现值）", () => {
    const d = (u: string) => displayUrl(u, "domain", "helium");
    expect(d("chrome-extension://abcdefghijklmnopabcdefghijklmnop/sidepanel.html?x=1#y")).toBe("chrome-extension://abcdefghijklmnopabcdefghijklmnop");
    expect(d("chrome://extensions/?id=x")).toBe("helium://extensions");
    expect(d("ftp://user:pw@FTP.Example.org/pub/file.txt")).toBe("ftp://ftp.example.org");
    expect(d("about:blank")).toBe("");
    expect(d("about:blank#frag")).toBe("");
    expect(d("file:///Users/me/My%20Docs/report.pdf")).toBe("report.pdf");
    expect(d("file:///")).toBe("file://");
    expect(d("data:text/html;base64,PGgxPmhpPC9oMT4=")).toBe("data:");
    expect(d("blob:https://example.com/550e8400-e29b-41d4-a716-446655440000")).toBe("blob:");
    expect(d("javascript:alert(1)")).toBe("javascript:");
    expect(d("mailto:a@b.com?subject=hi")).toBe("mailto:a@b.com");
    expect(d("https://www.example.com/a")).toBe("example.com");
});
test("full 模式不受影响", () => {
    expect(displayUrl("chrome-extension://abc/x.html", "full", "helium")).toBe("chrome-extension://abc/x.html");
    expect(displayUrl("file:///a/b.pdf", "full", "helium")).toBe("file:///a/b.pdf");
    expect(displayUrl("chrome://extensions/", "full", "helium")).toBe("helium://extensions");
});
test("胶囊：扩展页 / file: 仍走 navigation 自己的分支（在 displayUrl 之前 return）", () => {
    const nav = readFileSync("src/plugins/command/navigation/index.ts", "utf8");
    const i = nav.indexOf('u.protocol === "chrome-extension:"'), j = nav.indexOf('u.protocol === "file:"'), k = nav.indexOf('return displayUrl(url, "domain")');
    expect(i).toBeGreaterThan(0); expect(j).toBeGreaterThan(i); expect(k).toBeGreaterThan(j);
});

import { isBlankPage } from "../src/api/displayUrl";
test("新标签 / 空白页显示为空（地址栏回落占位符）", () => {
    for (const u of ["about:blank", "about:newtab", "chrome://newtab/", "helium://newtab", "chrome://new-tab-page/", "chrome-search://local-ntp/local-ntp.html".replace("/local-ntp.html", "")]) {
        expect(isBlankPage(u)).toBe(true);
        expect(displayUrl(u, "domain")).toBe("");
        expect(displayUrl(u)).toBe("");
    }
    expect(isBlankPage("chrome://extensions")).toBe(false);
    expect(isBlankPage("https://newtab.com")).toBe(false);
});

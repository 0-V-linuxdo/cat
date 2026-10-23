import { expect, test } from "bun:test";
import { readFileSync } from "fs";
// archive-page.md §9：无 favicon 时用 EmptyFavicon（14×14）
test("最近标签 / Live Folder 行的 favicon 走 withEmptyFallback", () => {
    for (const f of ["src/plugins/tabs/tabActions/index.ts", "src/plugins/tabs/liveFolders/index.ts"]) {
        const s = readFileSync(f, "utf8");
        expect(s).toContain('from "@components/EmptyFavicon"');
        expect(s).toMatch(/withEmptyFallback\(h\("img", \{ class: "arc-fav"/);
        expect(s).not.toMatch(/[^(]h\("img", \{ class: "arc-fav", src: (t\.favIconUrl|faviconUrl\(i\.url\))/);
    }
});

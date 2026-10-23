import { beforeEach, describe, expect, test } from "bun:test";
import { boostFavBox, favDecision, resetDefaultFav, type FavEl } from "../src/plugins/boosts/favicon";

class El implements FavEl { cls = new Set<string>(); kids: El[] = []; parent?: El; err?: () => void;
    classList = { add: (c: string) => { this.cls.add(c); } };
    append(n: unknown) { const e = n as El; e.parent = this; this.kids.push(e); }
    remove() { if (this.parent) this.parent.kids = this.parent.kids.filter(k => k !== this); } }
const deps = (sigs: Record<string, string>) => ({
    url: (u: string) => `fav:${u}`, sig: async (s: string) => sigs[s] ?? "",
    box: () => { const b = new El(); b.cls.add("arc-lib-favbox"); return b; },
    img: (_s: string, onerror: () => void) => { const i = new El(); i.err = onerror; return i; },
});
const DEF = "fav:https://arc-no-favicon.invalid/";

beforeEach(resetDefaultFav);
describe("favDecision", () => {
    test("无地址 → none", () => expect(favDecision("")).toBe("none"));
    test("加载中 → loading", () => expect(favDecision("x")).toBe("loading"));
    test("加载失败 → none", () => expect(favDecision("x", "", "g")).toBe("none"));
    test("默认地球 → none", () => expect(favDecision("x", "g", "g")).toBe("none"));
    test("真图 → img", () => expect(favDecision("x", "a", "g")).toBe("img"));
});
describe("boostFavBox", () => {
    test("加载中不加 no-fav；真图插入 img", async () => {
        const { box, ready } = boostFavBox("a.com", deps({ [DEF]: "g", "fav:https://a.com": "a" }));
        expect(box.cls.has("arc-lib-favbox")).toBe(true); expect(box.cls.has("no-fav")).toBe(false);
        expect(await ready).toBe("img"); expect(box.kids.length).toBe(1); expect(box.cls.has("no-fav")).toBe(false);
    });
    test("默认地球 → no-fav 且无 img", async () => {
        const { box, ready } = boostFavBox("b.com", deps({ [DEF]: "g", "fav:https://b.com": "g" }));
        expect(await ready).toBe("none"); expect(box.cls.has("no-fav")).toBe(true); expect(box.kids.length).toBe(0);
    });
    test("签名失败 → no-fav", async () => {
        const { box, ready } = boostFavBox("c.com", deps({ [DEF]: "g" }));
        expect(await ready).toBe("none"); expect(box.cls.has("no-fav")).toBe(true);
    });
    test("无 host → 立即 no-fav", async () => {
        const { box, ready } = boostFavBox("", deps({}));
        expect(box.cls.has("no-fav")).toBe(true); expect(await ready).toBe("none");
    });
    test("img onerror → no-fav 并移除 img", async () => {
        const { box, ready } = boostFavBox("d.com", deps({ [DEF]: "g", "fav:https://d.com": "d" }));
        await ready; box.kids[0].err!();
        expect(box.cls.has("no-fav")).toBe(true); expect(box.kids.length).toBe(0);
    });
});

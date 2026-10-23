/* Boosts 列表图标：与 Archive 相同的占位（archive-page.md §9 ImageOrPlaceholder）。
 * 逻辑照搬 library/libraryView/index.ts favBox（不跨插件 import，避免依赖 library 模块）：
 * 加载中不加类；确认没有 favicon（无地址 / 加载失败 / 只是浏览器默认地球）才加 .no-fav 并去掉 img。样式在 library/style.ts .arc-lib-favbox。 */
import { faviconUrl } from "@utils/misc";

export type FavState = "loading" | "img" | "none";
/** sig = 该站 favicon 的 16×16 签名（""=加载失败），def = 浏览器默认地球的签名 */
export function favDecision(src: string, sig?: string, def?: string): FavState {
    if (!src) return "none";
    if (sig === undefined || def === undefined) return "loading";
    return sig && sig !== def ? "img" : "none";
}

export interface FavEl { classList: { add(c: string): void }; append(n: unknown): void; remove?(): void }
export interface FavDeps {
    url: (pageUrl: string) => string;
    sig: (src: string) => Promise<string>;
    box: () => FavEl;
    img: (src: string, onerror: () => void) => FavEl;
}

const favSig = (src: string) => new Promise<string>(res => { const im = new Image(); im.onload = () => { try { const c = document.createElement("canvas"); c.width = c.height = 16; const x = c.getContext("2d")!; x.drawImage(im, 0, 0, 16, 16); res(c.toDataURL()); } catch { res(""); } }; im.onerror = () => res(""); im.src = src; });

let defaultFav: Promise<string> | undefined;
/** 测试用：清掉缓存的默认地球签名 */
export function resetDefaultFav() { defaultFav = undefined; }

export function boostFavBox<E extends FavEl>(host: string, deps: Omit<FavDeps, "box"> & { box: () => E }): { box: E; ready: Promise<FavState> } {
    const box = deps.box();
    const src = host ? deps.url(`https://${host}`) : "";
    if (favDecision(src) === "none") { box.classList.add("no-fav"); return { box, ready: Promise.resolve("none") }; }
    defaultFav ??= deps.sig(deps.url("https://arc-no-favicon.invalid/"));
    const ready = Promise.all([defaultFav, deps.sig(src)]).then(([def, sig]) => {
        const st = favDecision(src, sig, def);
        if (st === "img") {
            const img = deps.img(src, () => { box.classList.add("no-fav"); img.remove?.(); });
            box.append(img);
        } else box.classList.add("no-fav");
        return st;
    });
    return { box, ready };
}

export const domFavDeps = (h: (tag: string, props: Record<string, unknown>) => HTMLElement): FavDeps & { box: () => HTMLElement } => ({
    url: u => faviconUrl(u),
    sig: favSig,
    box: () => h("span", { class: "arc-lib-favbox", "data-test": "boost-favbox" }),
    img: (src, onerror) => h("img", { class: "arc-fav", src, alt: "", onerror }),
});

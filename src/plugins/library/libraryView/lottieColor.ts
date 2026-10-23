/* Library Lottie 按图层名着色的数据准备（无 DOM 依赖，可单测）；见 libIcons.ts */
export const PRIMARY_CLASS = "lib-lp", SECONDARY_CLASS = "lib-ls";
type Json = Record<string, any>;

/** 深拷贝并按图层名打 class；纯色 fl / st 的颜色改为白（不让写死的颜色漏出来） */
export function prepareLottie(src: unknown): Json {
    const d: Json = structuredClone(src as Json);
    const neutral = (o: any): void => {
        if (Array.isArray(o)) { o.forEach(neutral); return; }
        if (!o || typeof o !== "object") return;
        if ((o.ty === "fl" || o.ty === "st") && o.c) o.c = { a: 0, k: [1, 1, 1, 1] };
        for (const v of Object.values(o)) neutral(v);
    };
    for (const l of d.layers ?? []) {
        if (l.nm === "primaryColor") l.cl = PRIMARY_CLASS;
        else if (l.nm === "secondaryColor") l.cl = SECONDARY_CLASS;
        neutral(l.shapes);
    }
    return d;
}


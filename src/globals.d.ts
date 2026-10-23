/* 构建期由 build.ts 注入的虚拟模块与常量（对应 Void++ 的 ~plugins / IS_DEV） */
declare module "~plugins" {
    import type { Plugin } from "@utils/types";
    const plugins: Record<string, Plugin>;
    export default plugins;
}
declare const IS_DEV: boolean;
declare const VERSION: string; // = manifest.version_name（构建时间 YYYY-MM-DD｜HH:MM:SS）
declare const VERSION_NUM: string; // = manifest.version（0.1.0.NNNNN）

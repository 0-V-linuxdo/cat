/* 必须是 content.ts 的第一个 import：在任何插件模块求值 / 挂监听之前装好失效守卫（见 @api/contentGuard） */
import { installContentGuard } from "@api/contentGuard";
export const contentGuard = installContentGuard();

/* 扩展内页面（如分屏页）的入口：插件在 page 上下文里按 location.pathname 自行判断是否接管 */
import { bootstrap } from "@src/ArcSidebar";

void bootstrap("page");

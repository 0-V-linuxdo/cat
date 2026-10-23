/* 链接路由（Arc Air Traffic Control 的扩展点，arc-analysis/air-traffic-control.md）。
 * 触发点：新标签（创建后 20 秒内首次导航，spaceManager 后台）。路由器按注册顺序询问，第一个返回目标的生效；
 * 都没返回 → 默认行为（内置的“总在此空间打开”规则等）。核心负责把标签搬到目标；做不到的目标（profile；未提供 Little Arc 时的 littleArc）记警告并回到默认。 */
import { Logger } from "@utils/Logger";

export type LinkSource = "external" | "newTab" | "sidebar" | "page";
export interface LinkContext { url: string; source: LinkSource; openerTabId?: number }
export type RouteTarget = { kind: "space"; spaceId: string } | { kind: "littleArc" } | { kind: "profile"; profileId: string } | { kind: "mostRecent" };
export type LinkRouter = (ctx: LinkContext) => RouteTarget | undefined;
export type Cleanup = () => void;

const logger = new Logger("LinkRouting");
const routers: LinkRouter[] = [];
export function registerLinkRouter(fn: LinkRouter): Cleanup {
    routers.push(fn);
    return () => { const i = routers.indexOf(fn); if (i >= 0) routers.splice(i, 1); };
}
/** 内部：依次询问路由器（抛错跳过） */
export function resolveLinkRoute(ctx: LinkContext): RouteTarget | undefined {
    for (const fn of routers.slice()) {
        try { const r = fn(ctx); if (r) return r; } catch (e) { logger.warn("router threw, skipped", e); }
    }
    return undefined;
}
/** Little Arc 由 Peek 提供；未注册时 littleArc 目标不可用 */
let littleArcHandler: ((url: string, tabId: number) => Promise<unknown>) | undefined;
export function setLittleArcHandler(fn: typeof littleArcHandler): Cleanup { littleArcHandler = fn; return () => { if (littleArcHandler === fn) littleArcHandler = undefined; }; }
export const getLittleArcHandler = () => littleArcHandler;
export const warnUnsupported = (t: RouteTarget) => logger.warn(`route target "${t.kind}" not supported by Cat, falling back to default`);

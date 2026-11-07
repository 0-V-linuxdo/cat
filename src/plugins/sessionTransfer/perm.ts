/* 权限守卫（DESIGN §6.1 / G2）：核心只在设置页点击里申请 cookies；备份恢复 / 直接 togglePlugin 等路径不申请，
 * 所以插件内每次操作前都重新问浏览器（不缓存「已授权」）：contains → 缺失则在当前点击手势内 request → 仍被拒就不碰 chrome.cookies。
 * 不用 safe()（它会把错误文本写进 arc-errlog），也不写 console。 */
import { SessionError } from "./container";

export const COOKIES_PERM = { permissions: ["cookies"] } as chrome.permissions.Permissions;

export async function hasCookies(): Promise<boolean> {
    try { return !!await chrome.permissions.contains(COOKIES_PERM); } catch { return false; }
}

/** 返回时保证 chrome.cookies 可用，否则抛 SessionError("perm-denied" | "no-cookies-api")。必须由用户点击直接触发。 */
export async function ensureCookies(): Promise<void> {
    if (typeof chrome === "undefined" || !chrome.permissions) throw new SessionError("no-cookies-api");
    if (!await hasCookies()) {
        let ok = false;
        try { ok = !!await chrome.permissions.request(COOKIES_PERM); } catch { ok = false; }
        if (!ok) throw new SessionError("perm-denied");
    }
    if (!chrome.cookies) throw new SessionError("no-cookies-api");
}

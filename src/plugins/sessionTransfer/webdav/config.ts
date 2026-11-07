import { idbArea, type Area } from "../../_shared/llm";
import type { DavAuth, DavConn } from "./client";
import { DavError } from "./errors";
import { normalizeDir } from "./url";

/* WebDAV 连接配置：只存在 IndexedDB 秘密库（idbArea，库 cat-secrets）的 secret:sessionTransferDav 一条记录里。
 * `secret:*` 键由数据插件的导出 / 备份 / 快照 / 恢复统一排除；storage.sync 只同步白名单；设置项里只有布尔开关，没有 URL / 用户名 / 密码。
 * 密码默认不存（每次导出 / 导入时输入），仅在用户勾选「记住在本机」时以明文存进该记录（与 API 密钥同等对待）。 */
export const DAV_KEY = "secret:sessionTransferDav";

export interface DavConfig { url: string; kind: DavAuth["kind"]; user: string; secret?: string }

let store: Area = idbArea;
/** 仅测试用：替换存储区 */
export const setConfigStore = (a: Area | undefined) => { store = a ?? idbArea; };

export async function loadConfig(): Promise<DavConfig | undefined> {
    const v = (await store.get(DAV_KEY))[DAV_KEY] as Partial<DavConfig> | undefined;
    if (!v || typeof v.url !== "string" || (v.kind !== "basic" && v.kind !== "bearer")) return undefined;
    return { url: v.url, kind: v.kind, user: typeof v.user === "string" ? v.user : "", ...(typeof v.secret === "string" && v.secret ? { secret: v.secret } : {}) };
}

/** 保存；remember 为假时不写密码。URL 先校验（https / loopback），不合格直接抛错、什么都不写 */
export async function saveConfig(c: DavConfig, remember: boolean): Promise<DavConfig> {
    const url = normalizeDir(c.url);
    const rec: DavConfig = { url, kind: c.kind, user: c.kind === "basic" ? c.user : "", ...(remember && c.secret ? { secret: c.secret } : {}) };
    await store.set({ [DAV_KEY]: rec });
    return rec;
}

export async function clearConfig(): Promise<void> { await store.remove(DAV_KEY); }

/** 配置 + 本次输入的密码 → 连接；没有可用密码 → dav-not-configured */
export function toConn(c: DavConfig | undefined, secret?: string): DavConn {
    const s = secret ?? c?.secret;
    if (!c || !s) throw new DavError("dav-not-configured");
    return { dir: normalizeDir(c.url), auth: { kind: c.kind, user: c.user, secret: s } };
}

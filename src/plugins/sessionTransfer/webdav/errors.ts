/* WebDAV 通道的错误：只携带枚举码，不带 URL / 用户名 / 响应体 / Cookie 名（DESIGN §5A「无日志」）。 */
export type DavCode =
    | "dav-disabled" | "dav-not-configured" | "dav-bad-config"
    | "dav-https-required" | "dav-bad-url"
    | "dav-auth" | "dav-forbidden" | "dav-not-found" | "dav-dir-absent" | "dav-dir-missing" | "dav-too-large" | "dav-quota" | "dav-server"
    | "dav-network" | "dav-timeout" | "dav-redirect" | "dav-bad-xml" | "dav-bad-format" | "dav-expired"
    | "dav-plaintext-refused" | "dav-pass-short" | "dav-pass-same";

export class DavError extends Error {
    readonly code: DavCode;
    constructor(code: DavCode) { super(code); this.name = "DavError"; this.code = code; }
}

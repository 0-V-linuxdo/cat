import { registerChannel } from "../channels";
import { settings } from "../settings";
import "./i18n";

export { DAV_STYLE } from "./style";

/* 注册 WebDAV 通道的三个按钮（导出 / 导入 / 设置）。子开关 webdavEnabled 关闭时 enabled() 为 false：面板不画按钮；
 * 重代码（client / format / ui）只在点击后 import()。子开关只是功能开关：不调用任何 permissions.* （<all_urls> 已在 manifest 里常驻）。 */
const on = () => !!settings.store.webdavEnabled;
const ui = () => import("./ui");

export function registerDav(): Array<() => void> {
    return [
        registerChannel({ id: "webdav-export", label: "st.dav.export", test: "st-dav-export", enabled: on, run: tab => ui().then(m => m.actDavExport(tab)) }),
        registerChannel({ id: "webdav-import", label: "st.dav.import", test: "st-dav-import", enabled: on, run: () => ui().then(m => m.actDavImport()) }),
        registerChannel({ id: "webdav-config", label: "st.dav.config", test: "st-dav-config", enabled: on, run: () => ui().then(m => m.actDavConfig()) }),
    ];
}

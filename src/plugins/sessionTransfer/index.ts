/* 可选插件「会话传递」（Session Transfer）：把当前站点的登录会话（cookie + localStorage + sessionStorage）复制成加密令牌 / .session 文件，
 * 在另一个浏览器里恢复；默认格式与 Session Copy 扩展双向互通（见 container.ts）。默认关闭。设计：/workspace/patches/session-transfer/DESIGN.md。
 * 权限：manifest optional_permissions 的 "cookies"。设置页开启时由核心在点击手势里申请（拒绝则开关回退），关闭时释放；
 *   通过备份恢复等绕过申请的路径启用时，perm.ts 在每次操作前 contains → 手势内重新申请，仍被拒就什么也不做。
 * 零常驻：没有 background / content 钩子、没有常驻监听和定时器；重模块都在点击后才 import()（⚠ 打包是单 IIFE，「不加载」＝在包里但不执行）。
 * 入口：站点控制中心分区 + 命令栏四条命令（复制 / 导入会话 + WebDAV 导出 / 导入），无默认快捷键。 */
import { addSiteControlSection } from "@api/Slots";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";

import "./i18n";
import { renderSection, STYLE } from "./section";
import { settings } from "./settings";
import { dropSnapshot } from "./state";
import { DAV_STYLE, registerDav } from "./webdav/register";

const ui = () => import("./ui");
const davUi = () => import("./webdav/ui");

export default definePlugin({
    name: "SessionTransfer",
    label: "plugin.sessionTransfer.label",
    description: "plugin.sessionTransfer.desc",
    authors: [Devs.ArcSidebar],
    tags: ["data"],
    featureTags: ["sessionTransfer.tag.copy", "sessionTransfer.tag.file", "sessionTransfer.tag.clear"],
    settings,
    /** 插件本身启用时申请 cookies（manifest optional_permissions 里必须有）；停用时由核心释放 */
    optionalPermissions: { "*": ["cookies"] },
    commands: [
        { id: "sessionTransfer.export", label: "sessionTransfer.cmd.export", keywords: ["session", "cookie", "login", "copy", "export", "会话"], context: "panel", run: () => ui().then(m => m.actCopy()) },
        { id: "sessionTransfer.import", label: "sessionTransfer.cmd.import", keywords: ["session", "cookie", "login", "paste", "import", "会话"], context: "panel", run: () => ui().then(m => m.actPaste()) },
        { id: "sessionTransfer.davExport", label: "sessionTransfer.cmd.davExport", keywords: ["session", "webdav", "upload", "export", "会话"], context: "panel", run: () => davUi().then(m => m.cmdDavExport()) },
        { id: "sessionTransfer.davImport", label: "sessionTransfer.cmd.davImport", keywords: ["session", "webdav", "download", "import", "会话"], context: "panel", run: () => davUi().then(m => m.cmdDavImport()) },
    ],
    panel: {
        managedStyle: STYLE + DAV_STYLE,
        start() {
            return [
                // WebDAV 通道（子开关 webdavEnabled 默认关闭；见 webdav/register.ts）
                ...registerDav(),
                addSiteControlSection("SessionTransfer", { id: "sessionTransfer", order: 50, render: (box, tab, close) => renderSection(box, tab, close) }),
                dropSnapshot,
            ];
        },
    },
});

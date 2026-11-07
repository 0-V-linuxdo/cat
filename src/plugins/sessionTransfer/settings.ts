import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";

/* 插件设置。cookies 权限属于插件整体（optionalPermissions["*"]），不在这里；这些开关都不申请 / 释放任何权限。 */
export const settings = definePluginSettings({
    confirmBeforeImport: { type: OptionType.BOOLEAN, description: "sessionTransfer.confirmBeforeImport", default: true },
    reloadAfterImport: { type: OptionType.BOOLEAN, description: "sessionTransfer.reloadAfterImport", default: true },
    usePassphrase: { type: OptionType.BOOLEAN, description: "sessionTransfer.usePassphrase", default: false },
    saveAs: { type: OptionType.BOOLEAN, description: "sessionTransfer.saveAs", default: false },
    // ↓ 扩展点：新通道的子开关加在这里（例如 webdavEnabled，default:false；子开关只影响本通道，不申请 / 释放任何权限；见 channels.ts）
    webdavEnabled: {
        type: OptionType.BOOLEAN, description: "sessionTransfer.webdavEnabled", default: false,
        /** 关闭子开关 = 清除已保存的 WebDAV 配置（含记住的密码）；纯功能开关，不申请 / 释放任何权限 */
        onChange(v) { if (!v) void import("./webdav/config").then(m => m.clearConfig()).catch(() => undefined); },
    },
    deleteAfterImport: { type: OptionType.BOOLEAN, description: "sessionTransfer.deleteAfterImport", default: true },
    cleanupExpired: { type: OptionType.BOOLEAN, description: "sessionTransfer.cleanupExpired", default: true },
    hideFromDownloads: { type: OptionType.BOOLEAN, description: "sessionTransfer.hideFromDownloads", default: false },
});

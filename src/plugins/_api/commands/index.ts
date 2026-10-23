/* 对应 Void++ plugins/_api/*：为声明了 commands 的插件提供跨上下文命令路由；有插件需要时由 PluginManager 自动作为依赖启用 */
import { serveCommands } from "@api/Commands";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";

export default definePlugin({
    name: "CommandsAPI",
    label: "plugin.commandsApi.label",
    description: "plugin.commandsApi.desc",
    authors: [Devs.ArcSidebar],
    hidden: true,
    required: true,
    background: { start: serveCommands },
    panel: { start: serveCommands },
});

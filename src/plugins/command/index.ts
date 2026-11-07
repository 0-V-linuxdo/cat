/* 插件「命令」：命令栏与快捷键（必需）；可选底栏 ＋ 菜单。
 * 里面的功能不是插件，而是本插件的设置项（featureSettings）；必需功能没有开关。 */
import { featureSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";

import CommandBar from "./commandBar";
import Shortcuts from "./shortcuts";
import PlusMenu from "./plusMenu";
import Navigation from "./navigation";
import style from "./style";

const features = [CommandBar, Shortcuts, PlusMenu, Navigation];

export default definePlugin({
    name: "Command",
    label: "plugin.command.label",
    description: "plugin.command.desc",
    authors: [Devs.ArcSidebar],
    tags: ["command"],
    required: true,
    settings: featureSettings(features),
    features,
    panel: { managedStyle: style },
});

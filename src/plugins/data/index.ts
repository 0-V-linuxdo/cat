/* 插件「数据」：每日自动备份，导出 / 导入全部数据。
 * 里面的功能不是插件，而是本插件的设置项（featureSettings）；必需功能没有开关。 */
import { featureSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";

import Backup from "./backup";
import style from "./style";

const features = [Backup];

export default definePlugin({
    name: "Data",
    label: "plugin.data.label",
    icon: "data",
    description: "plugin.data.desc",
    authors: [Devs.ArcSidebar],
    tags: ["data"],
    enabledByDefault: true,
    settings: featureSettings(features),
    features,
    panel: { managedStyle: style },
});

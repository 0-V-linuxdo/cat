/* 插件「空间」：空间：新建 / 切换空间（必需）；可选主题配色、收藏。
 * 里面的功能不是插件，而是本插件的设置项（featureSettings）；必需功能没有开关。 */
import { featureSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";

import SpaceManager from "./spaceManager";
import Themes from "./themes";
import Favorites from "./favorites";
import style from "./style";

const features = [SpaceManager, Themes, Favorites];

export default definePlugin({
    name: "Spaces",
    label: "plugin.spaces.label",
    description: "plugin.spaces.desc",
    authors: [Devs.ArcSidebar],
    tags: ["spaces"],
    required: true,
    settings: featureSettings(features),
    features,
    panel: { managedStyle: style },
});

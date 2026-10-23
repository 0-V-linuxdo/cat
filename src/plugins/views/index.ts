/* 插件「视图」：分屏、速览小窗、站点控制（地址胶囊左侧图标）。
 * 里面的功能不是插件，而是本插件的设置项（featureSettings）；必需功能没有开关。 */
import { featureSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";

import SplitView from "./splitView";
import Peek from "./peek";
import SiteControls from "./siteControls";


const features = [SplitView, Peek, SiteControls];

export default definePlugin({
    name: "Views",
    label: "plugin.views.label",
    icon: "splitCols", // I-01 / S-04：不用手绘 views（Arc split-add-right.svg）
    description: "plugin.views.desc",
    authors: [Devs.ArcSidebar],
    tags: ["views"],
    enabledByDefault: true,
    settings: featureSettings(features),
    features,
    
});

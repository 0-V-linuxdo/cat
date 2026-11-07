/* 插件「资料库」：资料库（归档 / 下载 / 空间一览）与媒体托盘。
 * 里面的功能不是插件，而是本插件的设置项（featureSettings）；必需功能没有开关。 */
import { featureSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";

import LibraryView from "./libraryView";
import Media from "./media";
import LiveCalendar from "./liveCalendar";
import style from "./style";

const features = [LibraryView, Media, LiveCalendar];

export default definePlugin({
    name: "Library",
    label: "plugin.library.label",
    description: "plugin.library.desc",
    authors: [Devs.ArcSidebar],
    tags: ["library"],
    enabledByDefault: true,
    settings: featureSettings(features),
    features,
    panel: { managedStyle: style },
});

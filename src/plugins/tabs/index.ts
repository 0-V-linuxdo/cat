/* 插件「标签」：标签：固定区、今日、标签操作（必需）；可选归档、自动归档、文件夹、撤销、多选。
 * 里面的功能不是插件，而是本插件的设置项（featureSettings）；必需功能没有开关。 */
import { featureSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";

import PinnedTabs from "./pinnedTabs";
import TodayTabs from "./todayTabs";
import TabActions from "./tabActions";
import Archive from "./archive";
import AutoArchive from "./autoArchive";
import Folders from "./folders";
import Undo from "./undo";
import MultiSelect from "./multiSelect";
import LiveFolders from "./liveFolders";
import style from "./style";

const features = [PinnedTabs, TodayTabs, TabActions, Archive, AutoArchive, Folders, Undo, MultiSelect, LiveFolders];

export default definePlugin({
    name: "Tabs",
    label: "plugin.tabs.label",
    description: "plugin.tabs.desc",
    authors: [Devs.ArcSidebar],
    tags: ["tabs"],
    required: true,
    settings: featureSettings(features),
    features,
    panel: { managedStyle: style },
});

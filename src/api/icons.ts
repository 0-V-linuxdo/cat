/* 图标：有 Arc 原始资源的用 /workspace/arc-icons 导出的原图（arcIcons.ts，映射表 ARC_ICON_SOURCE）；SF Symbols 没有导出资源的仍用下面的路径。
 * 共享线性图标（16px、1.75 描边，风格接近 Arc / SF Symbols）。插件按名称取用，避免各自塞 emoji / 全角符号。 */
import { ARC_ICONS } from "./arcIcons";
import { ION_GLYPHS, ION_VARIANT_OF } from "./ionGlyphs";
/* PATHS：值为 "" 的名字由 Arc 资源（arcIcons.ts / SF_GLYPHS / ionGlyphs.ts / ICON_ALIAS）提供，无手写路径。
 * 审计 52193 I-01：cards（无引用）已删；command / views → ICON_ALIAS；popup / data 改为 ionGlyphs.ts 里的独立 SF 条目（ionicons-to-arc.md L30 / L41）。
 * 唯一仍手写的是 sparkles（主题选择器 “自动”、tidyTabTitles）：⛔ 源码未找到（SF sparkles 未导出）。
 * Cat 裁定只允许 Arc 原生资源或 SF Symbols：原 ionicons 已全部换成 SF 字形（ionGlyphs.ts，对照 /workspace/arc-analysis/ionicons-to-arc.md）。 */
const PATHS = {
    // “+” 菜单（ARC_SidebarPlusButton 同形自绘）
    addSpace: "",
    addTab: "",
    boost: "",
    splitAdd: "",
    x: "",
    sparkles: "M7 2.5l1.1 3.4 3.4 1.1-3.4 1.1L7 11.5 5.9 8.1 2.5 7l3.4-1.1zM12 9.5l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z",
    sun: "",
    moon: "",
    photo: "",
    share: "",
    star: "",
    plugin: "",
    library: "",
    settings: "",
    folder: "",
    tabs: "",
    spaces: "",
    command: "",
    views: "",
    back: "",
    forward: "",
    reload: "",
    trash: "",
    more: "",
    archive: "",
    splitRows: "",
    splitSeparate: "", // 分屏“在标签中打开”：Arc icon-separate-from-split（arcIcons.ts）
    dragHandle: "", // Manage Spaces 拖动把手：Arc icomoon U+E9A7（arcIcons.ts，16×16，currentColor）
    splitCols: "",
    link: "",
    sliders: "",
    clean: "",
} as const;
export type IconName = keyof typeof PATHS | keyof typeof ION_GLYPHS | keyof typeof SF_GLYPHS | "easel"; // easel：映射留空（⛔ scribble 字形未提取）
/** 审计 52193 I-01：原手写占位改为别名（与设置页分组图标 components/settings/utils.ts 一致）。
 * ⛔ Rea 没有给出这些名字对应哪个 Arc 图标（arc-icons/sf/MAPPING.md：command / views 为 ⛔）。
 * - views → splitCols：Arc 原生 vector/ARC_SidebarPlusButton.bundle/split-add-right.svg（arcIcons.ts ARC_ICON_SOURCE），保留。
 * - command → search（SF magnifyingglass）：设置分类 ⛔ 源码未找到（suggestion，ionicons-to-arc.md L22）。
 * - data、popup 不再是别名：ionGlyphs.ts 独立条目 externaldrive.fill（L41）/ macwindow.on.rectangle（L30），均 ⛔ suggestion。 */
const ICON_ALIAS: Partial<Record<string, IconName>> = { command: "search", views: "splitCols" };
/** 实心图标（Arc 的 Library 四点、⋯、太阳 / 月亮是实心） */
const FILLED = new Set<string>(["library","more","sun","moon"]);

/** “+”菜单图标（plusMenu ITEMS 与 Boosts 插件插入项用到的名字）：按 bottom-bar.md §3 L91 一律单色 currentColor。
 * 其它地方的彩色插画（trash 等）保留原色，见 isChromatic。 */
export const PLUS_MENU_ICONS = new Set<string>(["addSpace", "folder", "easel", "splitAdd", "splitRows", "splitCols", "addTab", "boost"]);
/** easel 规格是 SF `scribble`（bottom-bar.md §2.3 L52）。⛔ scribble 字形未提取（arc-icons 只有名称，sf-symbols.txt:128）。
 * 不用 Arc 彩色插画、不手绘近似：映射留空，返回空 svg（New Easel 在 Cat 中隐藏）。待从 Arc 资源提取，见 arc-ui/unconfirmed-values.md §4。 */
const EMPTY_ICONS = new Set<string>(["easel"]);
/** 是否含有彩色（非灰阶）填充：rgb(r%, g%, b%) 三分量不相等 */
export function isChromatic(body: string): boolean {
    for (const m of body.matchAll(/rgb\(([\d.]+)%, *([\d.]+)%, *([\d.]+)%\)/g)) { const [r, g, b] = [m[1], m[2], m[3]].map(Number) as [number, number, number]; if (Math.max(r, g, b) - Math.min(r, g, b) > 2) return true; }
    return false;
}

/** SF Symbols 真实字形（Rea 从 Apple SF Symbols 7.2 的 SFSymbolsFallback.otf 导出，/workspace/arc-icons/sf/，见 README.md / MAPPING.md）。
 * 原样拷贝 viewBox 与 path（fill=currentColor）；w/h 为该字号下的字形包围盒（pt），按 size/pt 等比缩放。
 * more = SF `ellipsis` 13pt Semibold：Space 标题行 editButton @0x1001c39a0（more-button-icon.md §1a）；Site Controls “…” 同符号（字号 ⛔，frame 32×32，§2）；文件夹行 “…” ⛔ 源码未找到（§1b），沿用。
 * trash = SF `trash` 14pt Medium：Library 删除 AccessoryButton @0x10270a764 / body @0x1026ce544（§5）。同名也用于 Manage Spaces 行删除、图标选择器移除按钮。
 * undo = SF `arrow.uturn.left` 14pt Medium：Library 恢复按钮（§5）。
 * pip = SF `pip` 12pt Medium：MiniPlayerView @0x102492888，AssetButton.body @0x1024963e4（font(size, .medium)，frame 16×16）。
 * 迷你播放器（MiniPlayerView @0x1024938f4 一带，14pt Medium）：play/pause = play.fill/pause.fill；skip = forward.end.fill；micFill/micSlashFill = mic(.slash).fill；
 *   videoFill/videoSlashFill = video(.slash).fill；xmark = 关闭迷你播放器；speaker*Fill = 音量按钮 12pt（静音 slash；0 → speaker.fill；<1/3 wave.1；<2/3 wave.2；≥2/3 wave.3）。
 * filter = line.3.horizontal.decrease.circle，resizable，frame 15×15，未设字重（导出 Regular）：HomeButton.PageHeaderView @0x1026ea3d4。
 * xmarkCircleFill = Library 清除筛选，frame 14×14（@0x1026eb1ec；扩展暂无对应按钮）。
 * 出处均见 /workspace/arc-icons/sf/MAPPING.md。原 ionicons 名字（mic / camera / volume / mute / plus / chevron* 等）的 SF 字形在 ionGlyphs.ts（ION_GLYPHS，同格式），icon() 先查 SF_GLYPHS 再查 ION_GLYPHS。 */
export const SF_GLYPHS = {
    /* 图标选择器头部删除按钮：icomoon U+E9F0（垃圾桶，ARCClients_Icons.bundle/icomoon.ttf），15pt（urlbar-menus-followup.md L418–466，FUN_102244694）；em 方框 1024，w = h = pt */
    trashIcomoon: { src: "arc-icons/iconfonts/icomoon/uniE9F0_UE9F0.svg", pt: 15, w: 15, h: 15, vb: "0 -960 1024 1024", body: "<path transform=\"scale(1,-1)\" fill=\"currentColor\" d=\"M768 640V85Q768 77 764.5 69.0Q761 61 755 55Q750 49 742.0 46.0Q734 43 725 43H299Q290 43 282.0 46.0Q274 49 269 55Q263 61 259.5 69.0Q256 77 256 85V640ZM725 725V768Q725 794 715.0 817.5Q705 841 688 858Q670 876 647.0 886.0Q624 896 597 896H427Q400 896 376.5 886.0Q353 876 336 858Q319 841 309.0 817.5Q299 794 299 768V725H128Q110 725 97.5 712.5Q85 700 85 683Q85 665 97.5 652.5Q110 640 128 640H171V85Q171 59 181.0 35.5Q191 12 208 -5Q226 -22 249.0 -32.5Q272 -43 299 -43H725Q752 -43 775.5 -33.0Q799 -23 816 -5Q833 12 843.0 35.5Q853 59 853 85V640H896Q914 640 926.5 652.5Q939 665 939 683Q939 700 926.5 712.5Q914 725 896 725ZM384 725V768Q384 777 387.5 784.5Q391 792 397 798Q402 804 410.0 807.5Q418 811 427 811H597Q606 811 614.0 807.5Q622 804 627 798Q633 792 636.5 784.5Q640 777 640 768V725Z\"/>" },
    broom: { src: "arc-icons/tidy/broom.svg", pt: 12, w: 12, h: 12, vb: "0 0 28 28", body: "<path d=\"M19.9132 21.3765C19.8875 21.0162 19.6455 20.7069 19.3007 20.5993L7.21755 16.8291C6.87269 16.7215 6.49768 16.8384 6.27165 17.1202C5.73893 17.7845 4.72031 19.025 3.78544 19.9965C2.4425 21.392 3.01177 22.4772 4.66526 22.9931C4.82548 23.0431 5.78822 21.7398 6.20045 21.7398C6.51906 21.8392 6.8758 23.6828 7.26122 23.8031C7.87402 23.9943 8.55929 24.2081 9.27891 24.4326C9.59033 24.5298 10.2101 23.0557 10.5313 23.1559C10.7774 23.2327 10.7236 24.8834 10.9723 24.961C11.8322 25.2293 12.699 25.4997 13.5152 25.7544C13.868 25.8645 14.8344 24.3299 15.1637 24.4326C15.496 24.5363 15.191 26.2773 15.4898 26.3705C16.7587 26.7664 17.6824 27.0546 17.895 27.1209C19.5487 27.6369 20.6333 27.068 20.3226 25.1563C20.1063 23.8255 19.9737 22.2258 19.9132 21.3765Z\" fill=\"currentColor\"/><path d=\"M16.719 1.7134C17.4929 -0.767192 20.7999 0.264626 20.026 2.74523C19.2521 5.22583 18.1514 8.75696 17.9629 9.36C17.7045 10.1867 16.1569 15.1482 15.899 15.9749L19.2063 17.0068C20.8597 17.5227 20.205 19.974 18.4514 19.4268L8.52918 16.331C6.87208 15.8139 7.62682 13.3938 9.28426 13.911L12.5916 14.9429C12.8495 14.1163 14.3976 9.15491 14.6555 8.32807C14.9135 7.50122 15.9451 4.19399 16.719 1.7134Z\" fill=\"currentColor\"/>" }, // 非 SF：Arc 资源目录模板图 “broom-stick”（Rea，arc-icons/tidy/；配置 12.0 Semibold、12pt 绘制、代码着色）。原 clip-path 是整幅 28×28 矩形，无作用，已去掉；两段路径填 currentColor（模板图 = 单色）
    arrowDownBold: { src: "arc-icons/sf/arrow.down_10pt_bold.svg", pt: 10, w: 7.837, h: 9.351, vb: "255 -1679 1605 1915", body: "<path transform=\"scale(1,-1)\" fill=\"currentColor\" d=\"M1057 -236C1096 -236 1137 -220 1164 -192L1815 460C1845 490 1860 525 1860 563C1860 645 1801 703 1723 703C1679 703 1645 685 1619 659L1393 435L1056 43L720 435L496 659C470 685 436 703 392 703C314 703 255 645 255 563C255 525 270 490 299 460L950 -192C977 -220 1018 -236 1057 -236ZM1057 -91C1134 -91 1186 -37 1186 44L1202 420V1529C1202 1619 1144 1679 1058 1679C972 1679 913 1619 913 1529V420L929 44C929 -37 981 -91 1058 -91Z\"/>" }, // SF arrow.down Bold，默认 10pt（= 标签字体 pointSize）
    folder: { src: "arc-icons/sf/folder_20pt_medium.svg", pt: 20, w: 22.373, h: 18.193, vb: "256 -1661 2291 1863", body: "<path transform=\"scale(1,-1)\" fill=\"currentColor\" d=\"M583 -200H2244C2435 -200 2547 -89 2547 124V1152C2547 1365 2434 1476 2219 1476H1289C1218 1476 1175 1493 1120 1538L1063 1584C993 1642 941 1661 836 1661H553C367 1661 256 1552 256 1342V123C256 -91 368 -202 584 -202ZM595 -6C502 -6 451 42 451 139V1325C451 1417 501 1466 591 1466H784C854 1466 896 1449 952 1403L1009 1356C1078 1300 1131 1281 1236 1281H2206C2298 1281 2350 1232 2350 1135V139C2350 42 2298 -6 2206 -6ZM573 966H2227V1037C2227 1100 2196 1129 2131 1129H669C604 1129 573 1100 573 1037Z\"/>" }, // “+”菜单 New Folder：SF folder 20pt Medium（ghidra/rSF/1027c9ab0.c L158–170），替换不透明 PNG
    more: { src: "arc-icons/sf/ellipsis_13pt_semibold.svg", pt: 13, w: 12.226, h: 2.685, vb: "179 -934 1926 423", body: "<path transform=\"scale(1,-1)\" fill=\"currentColor\" d=\"M391 511C508 511 602 605 602 722C602 839 508 934 391 934C274 934 179 839 179 722C179 605 274 511 391 511ZM1142 511C1259 511 1353 605 1353 722C1353 839 1259 934 1142 934C1025 934 930 839 930 722C930 605 1025 511 1142 511ZM1893 511C2010 511 2105 605 2105 722C2105 839 2010 934 1893 934C1776 934 1681 839 1681 722C1681 605 1776 511 1893 511Z\"/>" },
    trash: { src: "arc-icons/sf/trash_14pt_medium.svg", pt: 14, w: 13.467, h: 15.429, vb: "153 -1941 1970 2257", body: "<path transform=\"scale(1,-1)\" fill=\"currentColor\" d=\"M844 24C886 24 913 51 912 90L881 1138C880 1177 852 1203 812 1203C770 1203 743 1176 744 1137L774 89C775 49 803 23 843 23ZM1138 23C1179 23 1208 49 1208 88V1136C1208 1175 1179 1202 1138 1202C1096 1202 1068 1175 1068 1136V88C1068 49 1096 23 1138 23ZM1433 23C1473 23 1501 49 1502 89L1532 1137C1533 1176 1506 1203 1464 1203C1424 1203 1396 1177 1395 1137L1365 89C1364 50 1391 23 1433 23ZM684 1481H869V1689C869 1741 905 1774 961 1774H1315C1371 1774 1407 1741 1407 1689V1481H1592V1698C1592 1851 1494 1941 1328 1941H948C782 1941 684 1851 684 1698ZM241 1372H2036C2085 1372 2123 1411 2123 1460C2123 1509 2085 1547 2036 1547H241C193 1547 153 1509 153 1460C153 1410 193 1372 241 1372ZM679 -316H1598C1751 -316 1850 -222 1857 -69L1926 1391H1741L1675 -39C1673 -99 1633 -139 1576 -139H698C643 -139 603 -98 600 -39L531 1391H349L419 -70C426 -223 524 -316 679 -316Z\"/>" },
    undo: { src: "arc-icons/sf/arrow.uturn.left_14pt_medium.svg", pt: 14, w: 13.091, h: 13.009, vb: "255 -1674 1915 1903", body: "<path transform=\"scale(1,-1)\" fill=\"currentColor\" d=\"M255 992C255 963 267 934 290 912L865 347C886 325 916 313 943 313C1008 313 1051 357 1051 419C1051 452 1038 475 1019 495L761 745L467 993L761 1241L1019 1492C1038 1512 1051 1535 1051 1568C1051 1630 1008 1674 943 1674C916 1674 886 1662 865 1640L290 1074C267 1052 255 1023 255 993ZM1110 -120C1110 -180 1156 -229 1222 -229H1462C1908 -229 2170 34 2170 433C2170 829 1902 1103 1448 1103H817L460 1087C409 1084 368 1045 368 993C368 942 409 903 460 900L817 884H1454C1776 884 1953 701 1953 441C1953 180 1776 -11 1454 -11H1221C1155 -11 1109 -60 1109 -120Z\"/>" },
    pip: { src: "arc-icons/sf/pip_12pt_medium.svg", pt: 12, w: 15.434, h: 12.562, vb: "256 -1793 2634 2144", body: "<path transform=\"scale(1,-1)\" fill=\"currentColor\" d=\"M583 124H1318V320H595C502 320 451 369 451 466V1451C451 1548 502 1597 595 1597H2037C2129 1597 2180 1548 2180 1451V882H2376V1468C2376 1682 2264 1793 2049 1793H584C367 1793 256 1682 256 1468V449C256 236 367 125 584 125ZM1557 -350H2563C2778 -350 2890 -239 2890 -26V639C2890 852 2778 963 2563 963H1557C1341 963 1229 852 1229 638V-27C1229 -240 1341 -351 1557 -351ZM656 1019C660 983 704 948 745 989L852 1095L1005 941C1031 915 1074 915 1100 941C1126 967 1126 1010 1100 1036L946 1190L1052 1297C1093 1337 1059 1381 1022 1385L672 1435C652 1438 635 1432 622 1420C610 1408 604 1390 607 1371Z\"/>" },
    play: { src: "arc-icons/sf/play.fill_14pt_medium.svg", pt: 14, w: 10.562, h: 11.881, vb: "255 -1592 1545 1738", body: "<path transform=\"scale(1,-1)\" fill=\"currentColor\" d=\"M255 16C255 -93 320 -146 397 -146C430 -146 465 -135 499 -117L1680 573C1766 623 1800 662 1800 723C1800 785 1766 823 1680 873L499 1563C465 1582 430 1592 397 1592C320 1592 255 1539 255 1430Z\"/>" },
    pause: { src: "arc-icons/sf/pause.fill_14pt_medium.svg", pt: 14, w: 8.729, h: 11.676, vb: "255 -1576 1277 1708", body: "<path transform=\"scale(1,-1)\" fill=\"currentColor\" d=\"M398 -132H633C727 -132 776 -83 776 12V1433C776 1530 727 1576 633 1576H398C304 1576 255 1528 255 1433V12C255 -83 303 -132 398 -132ZM1155 -132H1389C1484 -132 1532 -83 1532 12V1433C1532 1530 1484 1576 1389 1576H1155C1060 1576 1011 1528 1011 1433V12C1011 -83 1060 -132 1155 -132Z\"/>" },
    skip: { src: "arc-icons/sf/forward.end.fill_14pt_medium.svg", pt: 14, w: 13.180, h: 10.828, vb: "255 -1514 1928 1584", body: "<path transform=\"scale(1,-1)\" fill=\"currentColor\" d=\"M255 86C255 -18 317 -70 391 -70C423 -70 457 -60 490 -42L1554 578C1633 624 1668 663 1668 722C1668 781 1633 820 1554 866L490 1486C457 1505 423 1514 391 1514C317 1514 255 1463 255 1358ZM1805 -65H2039C2134 -65 2183 -16 2183 79V1366C2183 1463 2134 1509 2039 1509H1805C1710 1509 1662 1460 1662 1365V78C1662 -17 1710 -66 1805 -66Z\"/>" },
    filter: { src: "arc-icons/sf/line.3.horizontal.decrease.circle_15x15frame_regular.svg", pt: 15, w: 15.000, h: 15.000, vb: "179 -1742 2040 2040", body: "<path transform=\"scale(1,-1)\" fill=\"currentColor\" d=\"M1199 -298C1762 -298 2219 159 2219 722C2219 1285 1762 1742 1199 1742C636 1742 179 1285 179 722C179 159 636 -298 1199 -298ZM1199 -128C729 -128 349 252 349 722C349 1192 729 1572 1199 1572C1669 1572 2049 1192 2049 722C2049 252 1669 -128 1199 -128ZM655 919H1745C1789 919 1821 947 1821 990C1821 1032 1789 1060 1745 1060H655C610 1060 579 1032 579 990C579 947 610 919 655 919ZM803 588H1597C1641 588 1672 616 1672 659C1672 701 1641 729 1597 729H803C758 729 727 701 727 659C727 616 758 588 803 588ZM957 256H1442C1486 256 1518 285 1518 327C1518 369 1486 397 1442 397H957C913 397 882 369 882 327C882 285 913 256 957 256Z\"/>" },
    micFill: { src: "arc-icons/sf/mic.fill_14pt_medium.svg", pt: 14, w: 10.391, h: 14.978, vb: "298 -1879 1520 2191", body: "<path transform=\"scale(1,-1)\" fill=\"currentColor\" d=\"M1059 459C1261 459 1409 611 1409 832V1505C1409 1727 1261 1879 1059 1879C856 1879 708 1728 708 1506V833C708 612 856 460 1059 460ZM1059 76C1503 76 1818 369 1818 810V1008C1818 1060 1776 1100 1724 1100C1672 1100 1629 1060 1629 1008V817C1629 476 1399 252 1058 252C716 252 486 476 486 817V1008C486 1060 444 1100 391 1100C339 1100 298 1060 298 1008V810C298 369 613 76 1058 76ZM599 -312H1516C1568 -312 1611 -271 1611 -220C1611 -168 1568 -126 1516 -126H599C547 -126 504 -168 504 -220C504 -271 547 -312 599 -312ZM1058 -269C1109 -269 1149 -227 1149 -176V126C1149 177 1109 219 1058 219C1007 219 966 177 966 126V-176C966 -227 1007 -269 1058 -269Z\"/>" },
    micSlashFill: { src: "arc-icons/sf/mic.slash.fill_14pt_medium.svg", pt: 14, w: 12.013, h: 14.950, vb: "203.5 -1875 1757.3765366787932 2187", body: "<path transform=\"scale(1,-1)\" fill=\"currentColor\" d=\"M299 810C299 399 573 117 967 80V-126H600C548 -126 505 -168 505 -220C505 -271 548 -312 600 -312H1517C1569 -312 1612 -271 1612 -220C1612 -168 1569 -126 1517 -126H1150V80C1270 91 1378 124 1471 178L1337 313C1257 274 1164 252 1059 252C717 252 487 476 487 817V1008C487 1060 445 1100 392 1100C340 1100 299 1060 299 1008ZM1600 629 1749 480C1794 576 1818 687 1818 810V1008C1818 1060 1776 1100 1724 1100C1672 1100 1629 1060 1629 1008V817C1629 749 1619 686 1599 629ZM1058 459C1097 459 1135 466 1169 480L706 943V833C706 612 854 460 1057 460ZM1057 1875C1259 1875 1407 1723 1407 1501V844C1407 836 1406 828 1404 821L714 1511V1544C731 1741 867 1874 1057 1874ZM1825 -1C1856 -32 1907 -32 1938 -1C1968 31 1969 81 1938 112L340 1709C309 1739 257 1740 226 1709C196 1678 196 1626 226 1596Z\"/>" },
    videoFill: { src: "arc-icons/sf/video.fill_14pt_medium.svg", pt: 14, w: 16.946, h: 11.259, vb: "302 -1546 2479 1647", body: "<path transform=\"scale(1,-1)\" fill=\"currentColor\" d=\"M641 -101H1695C1909 -101 2033 20 2033 231V1215C2033 1425 1917 1546 1703 1546H641C434 1546 302 1425 302 1215V226C302 15 426 -100 640 -100ZM2177 404 2521 107C2561 72 2604 49 2645 49C2726 49 2781 107 2781 194V1246C2781 1333 2726 1391 2645 1391C2603 1391 2560 1368 2520 1333L2176 1037Z\"/>" },
    videoSlashFill: { src: "arc-icons/sf/video.slash.fill_14pt_medium.svg", pt: 14, w: 17.961, h: 14.526, vb: "155.5 -1780.6264879078265 2627.5 2124.8764879078262", body: "<path transform=\"scale(1,-1)\" fill=\"currentColor\" d=\"M641 -101H1748L321 1326C311 1299 304 1254 304 1211V227C304 16 427 -101 641 -101ZM1703 1545H680L2024 201C2030 230 2033 269 2033 305V1214C2033 1424 1917 1545 1703 1545ZM2178 403 2522 106C2562 71 2606 48 2647 48C2728 48 2783 106 2783 193V1245C2783 1332 2728 1390 2647 1390C2605 1390 2562 1367 2522 1332L2178 1036ZM2144 -321C2175 -352 2227 -352 2257 -321C2287 -289 2288 -239 2257 -208L292 1757C261 1788 209 1789 178 1757C148 1727 148 1674 178 1644Z\"/>" },
    speakerFill: { src: "arc-icons/sf/speaker.fill_12pt_medium.svg", pt: 12, w: 7.160, h: 10.482, vb: "312 -1616 1222 1789", body: "<path transform=\"scale(1,-1)\" fill=\"currentColor\" d=\"M1406 -173C1480 -173 1534 -119 1534 -45V1483C1534 1557 1480 1616 1404 1616C1354 1616 1318 1595 1263 1543L845 1151C838 1145 831 1142 822 1142H538C392 1142 312 1060 312 906V535C312 380 392 299 538 299H822C831 299 838 297 845 291L1263 -105C1313 -153 1355 -173 1406 -173Z\"/>" },
    speakerSlashFill: { src: "arc-icons/sf/speaker.slash.fill_12pt_medium.svg", pt: 12, w: 11.183, h: 11.181, vb: "110.75 -1615 1908.5 1908.25", body: "<path transform=\"scale(1,-1)\" fill=\"currentColor\" d=\"M533 298H815C824 298 831 296 838 290L1261 -106C1312 -154 1353 -174 1404 -174C1461 -174 1505 -145 1524 -86L362 1075C329 1038 311 983 311 909V529C311 374 386 298 533 298ZM1534 476V1482C1534 1556 1480 1615 1404 1615C1353 1615 1317 1593 1261 1542L873 1182C869 1179 864 1175 859 1175H834ZM1883 -270C1914 -301 1966 -301 1996 -270C2027 -238 2027 -188 1996 -157L248 1591C217 1622 165 1622 134 1591C103 1561 103 1509 134 1479Z\"/>" },
    speakerWave1Fill: { src: "arc-icons/sf/speaker.wave.1.fill_12pt_medium.svg", pt: 12, w: 10.752, h: 10.482, vb: "313 -1616 1835 1789", body: "<path transform=\"scale(1,-1)\" fill=\"currentColor\" d=\"M1406 -173C1481 -173 1535 -119 1535 -45V1483C1535 1557 1481 1616 1405 1616C1354 1616 1318 1595 1264 1543L845 1151C839 1145 831 1142 822 1142H539C392 1142 313 1060 313 906V535C313 380 392 299 539 299H822C831 299 839 297 845 291L1264 -105C1313 -153 1355 -173 1407 -173ZM1892 279C1933 252 1989 261 2020 305C2100 412 2148 565 2148 723C2148 881 2100 1033 2020 1141C1989 1184 1933 1194 1892 1166C1843 1134 1834 1075 1872 1019C1927 940 1958 833 1958 721C1958 609 1926 503 1872 423C1835 366 1843 309 1892 276Z\"/>" },
    speakerWave2Fill: { src: "arc-icons/sf/speaker.wave.2.fill_12pt_medium.svg", pt: 12, w: 13.570, h: 10.482, vb: "313 -1616 2316 1789", body: "<path transform=\"scale(1,-1)\" fill=\"currentColor\" d=\"M1406 -173C1481 -173 1535 -119 1535 -45V1483C1535 1557 1481 1616 1405 1616C1354 1616 1319 1594 1264 1543L845 1151C839 1145 831 1142 822 1142H539C392 1142 313 1060 313 906V535C313 380 392 299 539 299H822C831 299 839 297 845 291L1264 -105C1313 -153 1355 -173 1407 -173ZM1893 279C1934 252 1990 261 2021 305C2102 412 2150 565 2150 723C2150 881 2102 1033 2021 1141C1990 1184 1934 1194 1893 1166C1844 1134 1835 1075 1873 1019C1928 940 1959 833 1959 721C1959 609 1927 503 1873 423C1836 366 1844 309 1893 276ZM2292 9C2337 -20 2392 -9 2423 36C2553 220 2629 466 2629 719C2629 972 2554 1220 2423 1402C2392 1447 2337 1458 2292 1429C2245 1399 2238 1340 2273 1288C2379 1133 2440 929 2440 718C2440 507 2377 304 2272 147C2238 95 2244 36 2291 6Z\"/>" },
    speakerWave3Fill: { src: "arc-icons/sf/speaker.wave.3.fill_12pt_medium.svg", pt: 12, w: 16.365, h: 11.689, vb: "313 -1714.5658240485338 2793 1994.8849195490284", body: "<path transform=\"scale(1,-1)\" fill=\"currentColor\" d=\"M1406 -173C1481 -173 1535 -119 1535 -45V1483C1535 1557 1481 1616 1405 1616C1354 1616 1318 1595 1264 1543L845 1151C839 1145 831 1142 822 1142H539C392 1142 313 1060 313 906V535C313 380 392 299 539 299H822C831 299 839 297 845 291L1264 -105C1313 -153 1355 -173 1407 -173ZM1892 279C1933 252 1989 261 2020 305C2100 412 2148 565 2148 723C2148 881 2100 1033 2020 1141C1989 1184 1933 1194 1892 1166C1843 1134 1834 1075 1872 1019C1927 940 1958 833 1958 721C1958 609 1926 503 1872 423C1835 366 1843 309 1892 276ZM2292 9C2337 -20 2392 -9 2423 36C2553 220 2629 466 2629 719C2629 972 2554 1220 2423 1402C2392 1447 2337 1458 2292 1429C2245 1399 2238 1340 2273 1288C2379 1133 2440 929 2440 718C2440 507 2377 304 2272 147C2238 95 2244 36 2291 6ZM2693 -265C2736 -294 2794 -281 2825 -233C3001 30 3106 358 3106 717C3106 1077 2998 1403 2824 1667C2793 1716 2735 1728 2692 1699C2645 1669 2638 1611 2671 1560C2824 1327 2919 1038 2919 719C2919 400 2824 109 2671 -123C2638 -174 2645 -232 2692 -262Z\"/>" },
    xmark: { src: "arc-icons/sf/xmark_14pt_medium.svg", pt: 14, w: 11.028, h: 11.008, vb: "254.12389713513977 -1528.2543592866916 1613.2522058314808 1610.3804887227975", body: "<path transform=\"scale(1,-1)\" fill=\"currentColor\" d=\"M1675 1494 286 105C244 64 243 -9 286 -51C329 -93 403 -92 444 -51L1833 1338C1875 1380 1876 1452 1833 1495C1790 1538 1719 1539 1676 1495ZM1835 107 446 1496C405 1538 331 1540 288 1496C246 1453 247 1381 288 1340L1677 -49C1719 -91 1792 -92 1835 -49C1878 -6 1878 66 1836 108Z\"/>" },
    xmarkCircleFill: { src: "arc-icons/sf/xmark.circle.fill_14x14frame_regular.svg", pt: 14, w: 14.000, h: 14.000, vb: "179 -1742 2040 2040", body: "<path transform=\"scale(1,-1)\" fill=\"currentColor\" d=\"M1199 -298C1762 -298 2219 160 2219 722C2219 1285 1762 1742 1199 1742C637 1742 179 1285 179 722C179 160 637 -298 1199 -298ZM863 302C817 302 781 339 781 385C781 407 789 428 805 443L1082 721L805 998C789 1014 781 1034 781 1056C781 1103 817 1138 863 1138C886 1138 904 1130 920 1115L1199 837L1480 1116C1497 1133 1515 1140 1537 1140C1583 1140 1620 1104 1620 1058C1620 1035 1613 1017 1595 999L1317 721L1594 444C1611 429 1619 408 1619 385C1619 339 1582 302 1535 302C1512 302 1491 310 1476 326L1199 604L923 326C907 310 886 302 863 302Z\"/>" },
    // 地址栏不安全 = IconType.insecureLock → SF lock.slash.fill 13pt Semibold，min(14/w,14/h,1) 等比重绘为 ≤14×14 模板图（setTemplate:YES → currentColor）：urlbar-menus-followup.md §1（rUB2/1002a2b54.c L30–35 / L61–62）。原样拷贝 arc-icons/urlbar 的 14×14 导出（13pt 字形不缩放、居中；NSImage 精确留白 ⛔）
    lockSlashFill: { src: "arc-icons/urlbar/lock.slash.fill_14x14.svg", pt: 14, w: 14, h: 14, vb: "0 0 14 14", body: "<path transform=\"translate(0.5083,11.4656) scale(0.006348,-0.006348)\" fill=\"currentColor\" d=\"M994 1554C1166 1554 1311 1431 1311 1210L1310 963H986L1707 244V714C1707 863 1642 945 1518 960V1195C1519 1559 1276 1756 994 1756C783 1756 595 1644 516 1435L683 1267C704 1451 835 1555 993 1555ZM517 -259H1470C1518 -259 1559 -249 1590 -231L413 945H407C325 914 280 836 280 715V-8C280 -176 361 -259 517 -259ZM1865 -325C1897 -357 1950 -357 1981 -325C2012 -293 2013 -241 1981 -209L181 1590C149 1622 96 1622 64 1590C33 1558 33 1505 64 1474Z\"/>" },
} as const;
export const ICON_NAMES = [...new Set([...Object.keys(PATHS), ...Object.keys(ION_GLYPHS), ...Object.keys(SF_GLYPHS)])] as IconName[]; // 不含 easel（空图标）

/** sq 字形（折叠箭头 chevronRight / chevronDown）：viewBox 扩成以字形中心为心、边长 = pt 的正方形 → 渲染成 size×size 方框、字形居中、比例不变。
 * 只给折叠箭头用：其他 SF 字形仍是 w×h 包围盒（不改它们的布局）。 */
export function squareVb(g: { pt: number; w: number; vb: string }): string {
    const [x, y, vw, vh] = g.vb.split(/\s+/).map(Number) as [number, number, number, number];
    const side = g.pt * vw / g.w, r = (n: number) => String(+n.toFixed(2));
    return [x + vw / 2 - side / 2, y + vh / 2 - side / 2, side, side].map(r).join(" ");
}

export function icon(name: IconName, size = 16): SVGSVGElement {
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    if (EMPTY_ICONS.has(name)) { svg.setAttribute("width", String(size)); svg.setAttribute("height", String(size)); svg.setAttribute("aria-hidden", "true"); svg.classList.add("arc-svg", `arc-svg-${name}`); return svg; }
    const alias = ICON_ALIAS[name];
    if (alias) { const a = icon(alias, size); a.classList.add(`arc-svg-${name}`); return a; }
    type Sf = Record<string, { pt: number; w: number; h: number; vb: string; body: string; sq?: boolean }>;
    const sf = (SF_GLYPHS as Sf)[name] ?? (ION_GLYPHS as Sf)[name]; // ION_GLYPHS = 原 ionicons 名字对应的 SF 字形（ionGlyphs.ts）
    if (sf) { const k = size / sf.pt; svg.setAttribute("viewBox", sf.sq ? squareVb(sf) : sf.vb); svg.setAttribute("width", String(sf.sq ? size : +(sf.w * k).toFixed(3))); svg.setAttribute("height", String(sf.sq ? size : +(sf.h * k).toFixed(3))); svg.setAttribute("aria-hidden", "true"); const base = (ION_VARIANT_OF as Record<string, string | undefined>)[name]; svg.classList.add("arc-svg", ...(base ? [`arc-svg-${base}`] : []), `arc-svg-${name}`, "arc-src", "arc-sf"); svg.innerHTML = sf.body; return svg; }
    const src = ARC_ICONS[name];
    // 生成器把 <use href> / url() 里的 id 前缀重复加了一次（#splitAdd-splitAdd-source-7，实际 id 是 splitAdd-source-7）：
    // 引用落空 → 遮罩为空 → 图标空白或缺块（splitAdd / splitRows / splitCols / trash / easel）。这里修正引用。
    const arc = src && { vb: src.vb, body: src.body.replaceAll(`#${name}-${name}-`, `#${name}-`) };
    if (arc) {
        svg.setAttribute("viewBox", arc.vb); svg.setAttribute("width", String(size)); svg.setAttribute("height", String(size));
        svg.setAttribute("fill", "currentColor"); svg.setAttribute("aria-hidden", "true");
        svg.classList.add("arc-svg", `arc-svg-${name}`, "arc-src");
        svg.innerHTML = arc.body;
        // 源 PDF 转出的 SVG 带写死的颜色（近黑 rgb(8%,8%,8%)）：改成 currentColor 才能随深浅色 / 状态变色（<mask> 里的白色保留）。
        // “+”菜单图标一律单色（bottom-bar.md §3 L91）；其它彩色插画（trash 等）不压色，否则会变成实心剪影。
        if (PLUS_MENU_ICONS.has(name) || !isChromatic(arc.body)) for (const el of svg.querySelectorAll<SVGElement>("[fill],[stroke],[style]")) {
            if (el.closest("mask")) continue;
            for (const attr of ["fill", "stroke"]) { const v = el.getAttribute(attr); if (v && v !== "none" && !v.startsWith("url(")) el.setAttribute(attr, "currentColor"); }
            if (el.style?.fill && el.style.fill !== "none") el.style.fill = "currentColor";
            if (el.style?.stroke && el.style.stroke !== "none") el.style.stroke = "currentColor";
        }
        return svg;
    }
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("width", String(size));
    svg.setAttribute("height", String(size));
    svg.setAttribute("fill", FILLED.has(name) ? "currentColor" : "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", FILLED.has(name) && name !== "sun" ? "0" : "1.6");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    svg.classList.add("arc-svg", `arc-svg-${name}`);
    const p = document.createElementNS(NS, "path");
    p.setAttribute("d", PATHS[name as keyof typeof PATHS]);
    svg.appendChild(p);
    return svg;
}

/** 文件夹行图标（审计 52193 D-01，Rea：arc-analysis/folder-icon-search-padding.md §B）：Arc 不用资源 / SF Symbol，而是 FolderIcon.FolderIconView（FolderIconView.swift）
 * 用 CAShapeLayer + CAGradientLayer 实时画出。这里按它 layout 函数（FUN_101664d8c）的几何逐项复刻，用两张 SVG 当图层（back / front），CSS 3D 做开合：
 * - 方框：W = H = size（默认 17：ListHeaderCellView._iconView 宽高约束 17×17，rFB/1003ede28.c L18；Library Archive 行显式传 16，archive-page.md:46）；
 * - r = round(W/7)；描边 = px(1.25)；frontTop = px(round(H·0.25))；tabDrop = floor(frontTop/1.5)；x42 = px(W·0.42)；x58 = px(W·0.58)；px(v) = round(v·s)/s，s = 屏幕缩放（@2x：17 → r2、线宽 1.5、frontTop 4、tabDrop 2、x42 7、x58 10）；
 * - 后板路径 M(r,0) L(x42,0) L(x58,tabDrop) L(W−r,tabDrop) 弧 L(W,H−r) 弧 L(r,H) 弧 L(0,r) 弧 Z；前板 = 顶部内缩 frontTop 的圆角矩形（半径 r）；两者用同一线宽；
 * - 渐变阴影：前板 黑 α0→0.15，(0.1,0)→(0.9,1)，opacity 展开 1 / 折叠 0；后板 黑 α0→0.36，(0,0)→(0.6,1)，opacity 展开 1 / 折叠 0.2；后板阴影的遮罩形状（backShadingMaskLayer）⛔ 源码未找到 → 用后板路径；
 * - 开合 = 对同一组图层做 3D 变换（不换图）：m34 = −1/350；展开 translateX 3、绕 Y 32°、后板绕 X 28°（锚点 (0,1) 左下）、前板容器绕 X −30°（style.ts .arc-folder-glyph[data-open]）。
 * ⛔ 源码未找到 / 不做：三色的实际 RGB（SemanticColorPalette 的 maxContrastColor / foregroundSecondary / cutoutColor，随 Space 主题动态变化）——
 *   按字段语义映射到现有变量（stroke → --arc-fg，后板 → --arc-muted，前板 → --arc-base，见 tabs/style.ts），非 Arc 取值；开合动画时长 / 缓动；前板容器锚点；
 *   CALayer 与 CSS 的旋转方向 / y 轴约定（按 CSS 字面应用）；peeked（拖放悬停）两态、右下角挖洞 + 圆点角标、省略号、customIcon 层（自定义图标另走 spaceIconNode）；
 *   行驱动状态的参数语义（rLH/1003e9480.c p1–p5）→ 这里只有 collapsed（open=false）/ expanded（open=true）。 */
export const FOLDER_ICON_SIZE = 17;
const px = (v: number, s: number) => Math.round(v * s) / s;
const num = (v: number) => String(+v.toFixed(3));
/** FolderIconView.layout 的几何（W = H = size，s = backingScale）。导出供测试。 */
export function folderGeometry(size = FOLDER_ICON_SIZE, scale = 2) {
    const W = size, H = size;
    const r = Math.round(W / 7), stroke = px(1.25, scale);
    const frontTop = px(Math.round(H * 0.25), scale), tabDrop = Math.floor(frontTop / 1.5);
    const x42 = px(W * 0.42, scale), x58 = px(W * 0.58, scale);
    const back = `M${num(r)},0 L${num(x42)},0 L${num(x58)},${num(tabDrop)} L${num(W - r)},${num(tabDrop)} A${r},${r} 0 0 1 ${num(W)},${num(r + tabDrop)} L${num(W)},${num(H - r)} A${r},${r} 0 0 1 ${num(W - r)},${num(H)} L${num(r)},${num(H)} A${r},${r} 0 0 1 0,${num(H - r)} L0,${num(r)} A${r},${r} 0 0 1 ${num(r)},0 Z`;
    return { W, H, r, stroke, frontTop, tabDrop, x42, x58, back };
}
let folderSeq = 0;
export function folderGlyph(open: boolean, size = FOLDER_ICON_SIZE, scale = (globalThis as { devicePixelRatio?: number }).devicePixelRatio || 2): HTMLElement {
    const g = folderGeometry(size, scale), id = `arc-fg${++folderSeq}`, fh = g.H - g.frontTop;
    const el = document.createElement("span");
    el.classList.add("arc-folder-glyph");
    el.dataset.open = String(open);
    el.setAttribute("aria-hidden", "true");
    el.setAttribute("style", `width:${num(g.W)}px;height:${num(g.H)}px;--fg-top:${num(g.frontTop)}px`);
    const gradient = (gid: string, x2: number, x1 = 0) => `<linearGradient id="${gid}" x1="${x1}" y1="0" x2="${x2}" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="${gid.endsWith("b") ? .36 : .15}"/></linearGradient>`;
    const sw = num(g.stroke);
    el.innerHTML =
        `<svg class="arc-fg-back" width="${num(g.W)}" height="${num(g.H)}" viewBox="0 0 ${num(g.W)} ${num(g.H)}"><defs>${gradient(id + "b", 0.6)}</defs>` +
        `<path class="arc-fg-back-fill" d="${g.back}" stroke-width="${sw}"/><path class="arc-fg-shade arc-fg-bshade" d="${g.back}" fill="url(#${id}b)"/></svg>` +
        `<svg class="arc-fg-front" width="${num(g.W)}" height="${num(fh)}" viewBox="0 0 ${num(g.W)} ${num(fh)}"><defs>${gradient(id + "f", 0.9, 0.1)}</defs>` +
        `<rect class="arc-fg-front-fill" x="0" y="0" width="${num(g.W)}" height="${num(fh)}" rx="${g.r}" ry="${g.r}" stroke-width="${sw}"/><rect class="arc-fg-shade arc-fg-fshade" x="0" y="0" width="${num(g.W)}" height="${num(fh)}" rx="${g.r}" ry="${g.r}" fill="url(#${id}f)"/></svg>`;
    return el;
}

/* faviconJitter.test.ts 的页内入口：只拿真模块（不依赖 chrome.*），挂到 window.T */
import { favNode } from "@components/EmptyFavicon";
import { reuseFavicons } from "@api/iconReuse";
import { folderOpening } from "@components/folderAnim";
(window as unknown as { T: unknown }).T = { favNode, reuseFavicons, folderOpening };

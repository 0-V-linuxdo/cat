/* 可降级接入：资料库 Media 写入接口（提案见 core-api-proposal.md §6）。核心没有时返回 null，插件改为下载到 Captures/ 子目录。 */
import * as Slots from "@api/Slots";

export interface LibraryCaptureItem { id: string; dataUrl: string; sourceURL: string; title: string; faviconURL?: string; dateCreated: number; captureType: "partialPage" | "fullWindow" }
type Store = (plugin: string, item: LibraryCaptureItem) => Promise<string>;
type Del = (plugin: string, id: string) => Promise<void>;
const get = <T>(n: string) => { const f = (Slots as unknown as Record<string, unknown>)[n]; return typeof f === "function" ? f as T : null; };

export const storeLibraryCapture = (item: LibraryCaptureItem) => get<Store>("storeLibraryCapture")?.("Capture", item) ?? null;
export const deleteLibraryCapture = (id: string) => get<Del>("deleteLibraryCapture")?.("Capture", id) ?? null;

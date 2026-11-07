/* rel61 补丁 downloadrename-own-filename：本扩展自己发起的下载，在 DownloadRename 开启时保住扩展指定的文件名（含子目录）。
 *
 * 背景（H10c，Chrome 156 有头实测）：只要存在 onDeterminingFilename 监听器，扩展 chrome.downloads.download({ filename }) 指定的
 * filename 就不再生效——监听器 return false / 无参 suggest() 都会落到浏览器生成名（blob → uuid，data: → "download.png"，
 * "Captures/" 子目录也丢）。onCreated / onDeterminingFilename 里的 byExtensionId 在 156 上是空串，data: 下载也认不出来源。
 * 唯一可靠的办法：发起下载前把「意图」{ filename, conflictAction } 记到 storage.session，DownloadRename 的监听器按 url 取出并
 * suggest({ filename, conflictAction })。DownloadRename 关闭时没有监听器，浏览器直接用 download() 的 filename（行为不变），
 * 意图条目由下面的清理机制删掉。
 *
 * 键：ownDl:<sha256(url) 十六进制>:<nonce>，值 OwnIntent。
 *  - 为什么用 SHA-256 全文哈希而不是前缀 / 长度+首尾：data:image/png 截图的头（"data:image/png;base64,iVBORw0KGgo…"）和尾
 *    （IEND 块 "…AAAAAElFTkSuQmCC"）对所有 PNG 都一样，前缀 / 首尾 + 长度在同尺寸截图之间会撞键；把整段 data: 当键又会占满
 *    storage.session 配额（10 MB）。SHA-256 覆盖整段 url，键长固定 64 位十六进制，几 MB 的 data: 也只要几毫秒，
 *    扩展页和服务进程用同一个函数，算出来一定相同。blob:chrome-extension://<id>/<uuid> 本身就唯一，统一走哈希只是为了一套代码。
 *  - 为什么键里再带 nonce：同一 url 可能并发下载（同一张截图先 capture.download 再 saveToLibrary，data: 完全相同）。
 *    每次下载一个独立键，写入不需要读-改-写（扩展页和服务进程同时写也不会互相覆盖）；取用时按 at（同毫秒再按 seq）先进先出。
 *
 * 清理（storage.session 在服务进程重启后仍保留，必须自己清）：
 *  1. 用完即删：takeOwnIntent 取到即 remove。
 *  2. 发起失败：download() 抛错 → 立刻删。
 *  3. 下载结束 / 中断：downloadOwn 拿到 id 后监听 downloads.onChanged，filename 已定、complete、interrupted 任一出现即删
 *     （DownloadRename 关闭时靠这一条删）；最多等 OWN_DL_TTL_MS。
 *  4. 超时：超过 OWN_DL_TTL_MS（60 s）的条目视为过期，不再匹配；每次登记 / 取用 / 服务进程启动 / 闹钟 都会 gcOwnIntents() 删掉过期条目。
 *     登记时建一次性闹钟 OWN_DL_GC_ALARM（TTL + 5 s 后），服务进程在 entries/background.ts 顶层监听，扩展页被关掉、
 *     服务进程被回收重启也能删干净；还有未过期条目时闹钟会再排一次。 */

export const OWN_DL_PREFIX = "ownDl:";
export const OWN_DL_TTL_MS = 60_000;
export const OWN_DL_GC_ALARM = "arc-ownDl-gc";
const TAKE_TIMEOUT_MS = 2_000;

export type OwnConflict = "uniquify" | "overwrite" | "prompt";
export interface OwnIntent { h: string; filename: string; conflictAction: OwnConflict; at: number; seq: number }
export interface OwnDownloadOptions { url: string; filename: string; saveAs?: boolean; conflictAction?: OwnConflict }

const area = (): chrome.storage.StorageArea | undefined => (globalThis as { chrome?: typeof chrome }).chrome?.storage?.session;

/** url → SHA-256 十六进制（理由见文件头） */
export async function ownDlHash(url: string): Promise<string> {
    const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(url));
    return Array.from(new Uint8Array(d), b => b.toString(16).padStart(2, "0")).join("");
}

let seq = 0;
const nonce = () => `${Date.now().toString(36)}.${(seq++).toString(36)}.${Math.random().toString(36).slice(2, 8)}`;
const isIntent = (v: unknown): v is OwnIntent => !!v && typeof (v as OwnIntent).h === "string" && typeof (v as OwnIntent).filename === "string" && typeof (v as OwnIntent).at === "number";
const fresh = (v: OwnIntent, now: number) => now - v.at >= 0 && now - v.at <= OWN_DL_TTL_MS;

function scheduleGc() {
    try { void chrome.alarms?.create(OWN_DL_GC_ALARM, { delayInMinutes: (OWN_DL_TTL_MS + 5_000) / 60_000 })?.catch?.(() => undefined); }
    catch { /* 预期：没有 alarms（测试环境）时只靠其余清理路径 */ }
}

async function entries(): Promise<[string, OwnIntent][]> {
    const s = area(); if (!s) return [];
    const all = await s.get(null) as Record<string, unknown>;
    return Object.entries(all).filter((e): e is [string, OwnIntent] => e[0].startsWith(OWN_DL_PREFIX)).map(([k, v]) => [k, v as OwnIntent]);
}

/** 删掉过期 / 损坏的 ownDl: 条目；返回删掉的个数。还有未过期条目时再排一次闹钟 */
export async function gcOwnIntents(now = Date.now()): Promise<number> {
    const s = area(); if (!s) return 0;
    const all = await entries();
    const dead = all.filter(([, v]) => !isIntent(v) || !fresh(v, now)).map(([k]) => k);
    if (dead.length) await s.remove(dead);
    if (all.length > dead.length) scheduleGc();
    return dead.length;
}

export interface OwnIntentHandle { key: string; release(): Promise<void> }
const NOOP: OwnIntentHandle = { key: "", release: async () => undefined };

/** 登记一次下载意图（发起下载之前调用并 await） */
export async function registerOwnIntent(url: string, filename: string, conflictAction: OwnConflict = "uniquify"): Promise<OwnIntentHandle> {
    const s = area(); if (!s || !url || !filename) return NOOP;
    try {
        const h = await ownDlHash(url);
        const key = `${OWN_DL_PREFIX}${h}:${nonce()}`;
        const v: OwnIntent = { h, filename, conflictAction, at: Date.now(), seq };
        await s.set({ [key]: v });
        scheduleGc();
        void gcOwnIntents().catch(() => 0); /* 预期：清理失败下次再清 */
        return { key, release: () => s.remove(key).catch(() => undefined) /* 预期：已被取走 / 已删 */ };
    } catch { return NOOP; } /* 预期：storage.session 不可用 → 不登记，下载照常（DownloadRename 开启时文件名会退回浏览器名） */
}

let chain: Promise<unknown> = Promise.resolve();
/** DownloadRename 监听器：按 item.url / finalUrl 取出（并删除）最早登记的未过期意图。同一服务进程内串行，防止并发两次取到同一条 */
export function takeOwnIntent(urls: (string | undefined)[]): Promise<OwnIntent | null> {
    const run = chain.then(async () => {
        const s = area(); if (!s) return null;
        const now = Date.now();
        const all = await entries();
        if (!all.length) return null; // 快路径：没有登记，不算哈希
        const dead = all.filter(([, v]) => !isIntent(v) || !fresh(v, now)).map(([k]) => k);
        if (dead.length) await s.remove(dead);
        const live = all.filter(([k]) => !dead.includes(k));
        const us = [...new Set(urls.filter((u): u is string => !!u))];
        if (!live.length || !us.length) return null;
        const hs = new Set(await Promise.all(us.map(ownDlHash)));
        const older = (a: [string, OwnIntent], b: [string, OwnIntent]) => (a[1].at - b[1].at || (a[1].seq ?? 0) - (b[1].seq ?? 0) || (a[0] < b[0] ? -1 : 1)) < 0;
        const hit = live.filter(([, v]) => hs.has(v.h)).reduce<[string, OwnIntent] | undefined>((m, e) => (!m || older(e, m) ? e : m), undefined); // 先进先出：最早登记的
        if (!hit) return null;
        await s.remove(hit[0]);
        return hit[1];
    });
    chain = run.catch(() => null);
    return Promise.race([run, new Promise<null>(r => setTimeout(() => r(null), TAKE_TIMEOUT_MS))]);
}

/** 下载 id 已知后：filename 已定 / complete / interrupted 任一出现即 release；最多等 TTL。返回 stop */
export function releaseWhenSettled(id: number, release: () => Promise<void>, ttl = OWN_DL_TTL_MS): () => void {
    const dl = chrome.downloads;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = () => {
        if (stopped) return; stopped = true;
        if (timer !== undefined) clearTimeout(timer);
        dl.onChanged?.removeListener(onChanged);
        void release();
    };
    const onChanged = (d: chrome.downloads.DownloadDelta) => {
        if (d.id !== id) return;
        if (d.filename?.current || d.error || (d.state && d.state.current !== "in_progress")) stop();
    };
    dl.onChanged?.addListener(onChanged);
    timer = setTimeout(stop, ttl);
    // download() 返回前可能已经定名 / 结束（小 data: 文件），事件已错过：查一次现状
    void Promise.resolve(dl.search?.({ id })).then(r => { const it = r?.[0]; if (!it || it.filename || it.state !== "in_progress") stop(); }, stop);
    return stop;
}

/** 代替 chrome.downloads.download：先登记意图再下载；失败立刻删条目；成功后等定名 / 结束删条目 */
export async function downloadOwn(o: OwnDownloadOptions): Promise<number> {
    const conflictAction = o.conflictAction ?? "uniquify";
    const reg = await registerOwnIntent(o.url, o.filename, conflictAction);
    let id: number;
    try { id = await chrome.downloads.download({ url: o.url, filename: o.filename, saveAs: !!o.saveAs, conflictAction }); }
    catch (e) { await reg.release(); throw e; }
    if (reg !== NOOP) releaseWhenSettled(id, reg.release);
    return id;
}

/* Download Rename 规则模式（不接模型）：按 Arc 提示词的意图做确定性清理。纯函数，可单测。 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec"];
/** 无信息量的文件名（需要从标签标题补信息） */
const GENERIC = /^(image|img|photo|picture|pic|download|downloads|file|untitled|document|doc|unnamed|unknown|blob|export|output|attachment|screenshot|video|audio|data)\d*$/i;
/** 机器生成的前缀 */
const CRUFT_PREFIX = /^(?:AdobeStock|shutterstock|iStock|GettyImages|depositphotos|pexels-photo|unsplash)[-_ ]?\d*[-_ ]?/i;

/** 拆出扩展名：支持 .tar.gz 这类双扩展；没有扩展名时返回 "" */
export function splitExt(name: string): [string, string] {
    const m = name.match(/^(.+?)((?:\.tar)?\.[A-Za-z0-9]{1,8})$/);
    return m ? [m[1], m[2]] : [name, ""];
}

/** 保证新名字带原扩展名（大小写也保留原样） */
export function keepExt(original: string, proposed: string): string {
    const [, ext] = splitExt(original);
    if (!ext) return proposed;
    const [stem, pext] = splitExt(proposed);
    return pext.toLowerCase() === ext.toLowerCase() ? `${stem}${ext}` : `${proposed}${ext}`;
}

/** 文件名非法字符与首尾修整 */
export function sanitize(stem: string): string {
// eslint-disable-next-line no-control-regex
    return stem.replace(/[\\/:*?"<>|]/g, " ").replace(/\p{Cc}/gu, " ").replace(/\s+/g, " ").replace(/^[\s.]+|[\s.,-]+$/g, "").trim();
}

function prettyDate(y: string, mo: string, d: string): string {
    const m = MONTHS[Number(mo) - 1];
    return m ? `${m} ${Number(d)} ${y}` : `${y}-${mo}-${d}`;
}

/** 标签标题里提炼出 2-4 个词（去掉站点后缀） */
export function titleWords(title: string | undefined, max = 4): string {
    if (!title) return "";
    const t = title.split(/\s+[-–—|·•]\s+/)[0].replace(/[^\p{L}\p{N}\s&'.]/gu, " ");
    return sanitize(t.split(/\s+/).filter(Boolean).slice(0, max).join(" "));
}

export interface RuleInput { filename: string; title?: string; domain?: string }

/** 规则清理；返回新文件名（含扩展名）。没有可改的返回原名 */
export function ruleRename({ filename, title }: RuleInput): string {
    const base = filename.split(/[\\/]/).pop() ?? filename;
    let [stem] = splitExt(base);
    const orig = stem;

    // 重复下载 / 副本标记
    stem = stem.replace(/\s*\((?:\d+|copy|copy \d+|副本)\)\s*$/i, "").replace(/\s*-\s*Copy(?:\s*\(\d+\))?$/i, "").replace(/^Copy of\s+/i, "");
    // @2x 等倍率
    stem = stem.replace(/@\dx$/i, "");
    // 图库前缀
    stem = stem.replace(CRUFT_PREFIX, "");
    // 日期时间：2023-08-17 at 19.51.05 [PM] / 2023-08-17_19-51-05 / 20230817
    stem = stem.replace(/(\d{4})[-_.](\d{2})[-_.](\d{2})(?:(?:\s*at\s*|[ _T-])(\d{1,2})[.:\-_](\d{2})(?:[.:\-_]\d{2})?(?:[\s\u202f]*([AP]M))?)?/gi,
        (_, y, mo, d, hh, mm, ap) => prettyDate(y, mo, d) + (hh ? ` ${Number(hh)}.${mm}${ap ? ` ${ap.toUpperCase()}` : ""}` : ""));
    stem = stem.replace(/(?<!\d)(20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])(?!\d)/g, (_, y, mo, d) => prettyDate(y, mo, d));
    // UUID / 长十六进制 / 长数字 ID（≥6 位，且不是版本号的一部分）
    stem = stem.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, " ");
    stem = stem.replace(/(?<![\w.])(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{16,}(?![\w.])/gi, " ");
    stem = stem.replace(/(^|[-_\s])\d{6,}(?=$|[-_\s])/g, "$1");
    // 末尾零填充序号 _008
    stem = stem.replace(/[-_\s]0\d{1,3}$/, "");
    // 分隔符：下划线 → 空格；连字符两侧有数字（版本）→ 空格
    stem = stem.replace(/_+/g, " ").replace(/(?<=\d)-|-(?=\d)/g, " ");
    stem = sanitize(stem);

    // 无信息量：用标签标题补
    if (!stem || GENERIC.test(stem.replace(/\s+/g, ""))) {
        const t0 = titleWords(title);
        const tw = t0.charAt(0).toUpperCase() + t0.slice(1);
        if (tw) stem = /screenshot/i.test(orig) ? `Screenshot from ${tw}` : tw;
    }
    if (!stem) stem = orig;
    return keepExt(base, stem);
}

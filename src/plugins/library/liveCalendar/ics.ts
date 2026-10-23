/* 极简 iCalendar 解析：只取 VEVENT 的开始 / 结束 / 标题 / 地点 / 描述，并找出会议链接 */
export interface CalEvent { start: number; end: number; title: string; join?: string }

const unfold = (s: string) => s.replace(/\r?\n[ \t]/g, "");
const unescape = (s: string) => s.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1");

/** 20261016T090000Z / 20261016T090000（按本地时间）/ 20261016（全天） */
export function parseIcsDate(v: string): number {
    const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(v.trim());
    if (!m) return NaN;
    const [, y, mo, d, h = "0", mi = "0", s = "0", z] = m;
    return z ? Date.UTC(+y, +mo - 1, +d, +h, +mi, +s) : new Date(+y, +mo - 1, +d, +h, +mi, +s).getTime();
}

const JOIN = /https:\/\/(?:meet\.google\.com\/[a-z-]+|[\w.-]*zoom\.us\/j\/[\w?=&.-]+|teams\.microsoft\.com\/l\/meetup-join\/[^\s"<>]+)/i;

export function parseIcs(text: string): CalEvent[] {
    const out: CalEvent[] = [];
    for (const block of unfold(text).split("BEGIN:VEVENT").slice(1)) {
        const body = block.split("END:VEVENT")[0];
        const get = (k: string) => { const m = new RegExp(`^${k}(?:;[^:\\n]*)?:(.*)$`, "m").exec(body); return m ? unescape(m[1].trim()) : ""; };
        const start = parseIcsDate(get("DTSTART"));
        if (Number.isNaN(start)) continue;
        const endRaw = parseIcsDate(get("DTEND"));
        const all = `${get("LOCATION")}\n${get("DESCRIPTION")}\n${get("URL")}\n${get("X-GOOGLE-CONFERENCE")}`;
        out.push({ start, end: Number.isNaN(endRaw) ? start + 36e5 : endRaw, title: get("SUMMARY") || "(untitled)", join: JOIN.exec(all)?.[0] });
    }
    return out.toSorted((a, b) => a.start - b.start);
}

/** 下一个（或正在进行的）事件：今天之内 */
export function nextEvent(events: CalEvent[], now = Date.now()): CalEvent | undefined {
    const endOfDay = new Date(now); endOfDay.setHours(23, 59, 59, 999);
    return events.find(e => e.end > now && e.start <= endOfDay.getTime());
}

import { DavError } from "./errors";
import { dirSegments } from "./url";

/* 最小的命名空间感知 XML 解析 + PROPFIND(207) 解析。
 * 不用 DOMParser：扩展页与单测（bun 没有 DOM）行为一致，也不存在实体展开 / 外部实体；出现 DOCTYPE / ENTITY 一律拒绝。 */
export const MAX_XML_BYTES = 2 * 1024 * 1024;
const MAX_DEPTH = 64, MAX_NODES = 20_000;
const DAV = "DAV:";

interface El { ns: string; name: string; text: string; kids: El[] }

const ENT: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };
function decodeEnt(s: string): string {
    return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (_m, g: string) => {
        if (g[0] === "#") {
            const n = g[1] === "x" ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10);
            if (!Number.isFinite(n) || n < 0 || n > 0x10ffff || (n >= 0xd800 && n < 0xe000)) throw new DavError("dav-bad-xml");
            return String.fromCodePoint(n);
        }
        const v = ENT[g];
        if (v === undefined) throw new DavError("dav-bad-xml");
        return v;
    });
}

function parseXml(xml: string): El {
    if (xml.length > MAX_XML_BYTES) throw new DavError("dav-bad-xml");
    if (/<!\s*(doctype|entity)/i.test(xml)) throw new DavError("dav-bad-xml");
    let i = 0, nodes = 0;
    const stack: { el: El; scope: Record<string, string>; raw: string }[] = [];
    let root: El | undefined;
    const bad = (): never => { throw new DavError("dav-bad-xml"); };
    while (i < xml.length) {
        const lt = xml.indexOf("<", i);
        const text = xml.slice(i, lt < 0 ? xml.length : lt);
        if (text.trim() && stack.length) stack[stack.length - 1]!.el.text += decodeEnt(text);
        else if (text.trim() && !stack.length) bad();
        if (lt < 0) break;
        if (xml.startsWith("<!--", lt)) { const e = xml.indexOf("-->", lt + 4); if (e < 0) bad(); i = e + 3; continue; }
        if (xml.startsWith("<![CDATA[", lt)) { const e = xml.indexOf("]]>", lt + 9); if (e < 0 || !stack.length) bad(); stack[stack.length - 1]!.el.text += xml.slice(lt + 9, e); i = e + 3; continue; }
        if (xml.startsWith("<?", lt)) { const e = xml.indexOf("?>", lt + 2); if (e < 0) bad(); i = e + 2; continue; }
        if (xml.startsWith("<!", lt)) bad();
        const gt = findTagEnd(xml, lt);
        if (gt < 0) bad();
        const inner = xml.slice(lt + 1, gt);
        i = gt + 1;
        if (inner.startsWith("/")) {
            const top = stack.pop();
            if (!top || inner.slice(1).trim() !== top.raw) bad();
            continue;
        }
        const selfClose = inner.endsWith("/");
        const body = selfClose ? inner.slice(0, -1) : inner;
        const m = /^([^\s/>=]+)([\s\S]*)$/.exec(body);
        if (!m) return bad();
        const raw = m[1]!;
        const scope = { ...(stack.length ? stack[stack.length - 1]!.scope : { "": "" }) };
        for (const a of m[2]!.matchAll(/([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) {
            const k = a[1]!, v = decodeEnt(a[3] ?? a[4] ?? "");
            if (k === "xmlns") scope[""] = v; else if (k.startsWith("xmlns:")) scope[k.slice(6)] = v;
        }
        const c = raw.indexOf(":");
        const prefix = c < 0 ? "" : raw.slice(0, c), local = c < 0 ? raw : raw.slice(c + 1);
        if (c >= 0 && !(prefix in scope)) bad();
        const el: El = { ns: scope[prefix] ?? "", name: local, text: "", kids: [] };
        if (++nodes > MAX_NODES || stack.length >= MAX_DEPTH) bad();
        if (stack.length) stack[stack.length - 1]!.el.kids.push(el); else if (root) bad(); else root = el;
        if (!selfClose) stack.push({ el, scope, raw });
    }
    if (stack.length || !root) bad();
    return root!;
}
function findTagEnd(xml: string, from: number): number {
    let q = "";
    for (let j = from + 1; j < xml.length; j++) {
        const ch = xml[j]!;
        if (q) { if (ch === q) q = ""; } else if (ch === '"' || ch === "'") q = ch; else if (ch === ">") return j;
    }
    return -1;
}

const kid = (e: El, name: string): El | undefined => e.kids.find(k => k.ns === DAV && k.name.toLowerCase() === name);

export interface DavEntry { name: string; isDir: boolean; size?: number; mtime?: number }

/** 207 Multi-Status → 目录的直接子项（目录自身、目录之外的 href、含 .. / 多级的 href 都丢弃） */
export function parseMultistatus(xml: string, dir: string): DavEntry[] {
    const root = parseXml(xml);
    if (root.ns !== DAV || root.name.toLowerCase() !== "multistatus") throw new DavError("dav-bad-xml");
    const base = dirSegments(dir).map(s => s.toLowerCase());
    const out: DavEntry[] = [];
    for (const r of root.kids) {
        if (r.ns !== DAV || r.name.toLowerCase() !== "response") continue;
        const href = kid(r, "href")?.text.trim();
        if (!href) continue;
        let path: string;
        try { path = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(href) ? new URL(href).pathname : href.split(/[?#]/)[0]!; } catch { continue; }
        let segs: string[];
        try { segs = path.split("/").filter(Boolean).map(s => decodeURIComponent(s)); } catch { continue; }
        if (segs.length <= base.length) continue; // 目录自身（尾斜杠 / 大小写 / 编码差异已归一）或更上层
        if (!base.every((b, k) => segs[k]!.toLowerCase() === b) || segs.length !== base.length + 1) continue;
        const name = segs[base.length]!;
        if (name === "." || name === ".." || name.includes("\\") || name.includes("/") || name.includes("\0")) continue;
        const e: DavEntry = { name, isDir: href.replace(/[?#].*$/, "").endsWith("/") };
        for (const ps of r.kids) {
            if (ps.ns !== DAV || ps.name.toLowerCase() !== "propstat") continue;
            if (!/\s200(\s|$)/.test(kid(ps, "status")?.text ?? "")) continue;
            const prop = kid(ps, "prop");
            if (!prop) continue;
            const len = kid(prop, "getcontentlength")?.text.trim();
            if (len !== undefined && /^\d{1,15}$/.test(len)) e.size = Number(len);
            const lm = kid(prop, "getlastmodified")?.text.trim();
            if (lm) { const t = Date.parse(lm); if (Number.isFinite(t)) e.mtime = t; }
            const rt = kid(prop, "resourcetype");
            if (rt?.kids.some(k => k.ns === DAV && k.name.toLowerCase() === "collection")) e.isDir = true;
        }
        out.push(e);
    }
    return out;
}

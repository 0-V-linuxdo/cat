export type Snap = { at: number; data: Record<string, unknown> };

/** 分层保留（同 Arc）：最近 10 份 + 之前 10 天每天 1 份 + 每周 1 份（8 周）+ 每月 1 份（12 个月） */
export function tier(list: Snap[], now = Date.now()): Snap[] {
    const D = 864e5; const seen = new Set<string>(); const out: Snap[] = [];
    for (const [i, s] of list.toSorted((a, b) => b.at - a.at).entries()) {
        const age = now - s.at;
        const bucket = i < 10 ? `r${i}` : age < 10 * D ? `d${Math.floor(age / D)}` : age < 66 * D ? `w${Math.floor(age / (7 * D))}` : age < 400 * D ? `m${Math.floor(age / (30 * D))}` : null;
        if (bucket && !seen.has(bucket)) { seen.add(bucket); out.push(s); }
    }
    return out;
}


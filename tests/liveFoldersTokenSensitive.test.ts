/* 补丁 livefolders-token-sensitive：LiveFolders 的 GitHub 令牌标 sensitive。
 * 存储位置不变（Settings.plugins.Tabs.token），升级不搬家、不丢值；导出 / 新快照跳过；已存的旧快照清洗一次（幂等）；
 * 导入 / 恢复沿用现有 sensitive 机制：文件里的令牌忽略，保留当前值。测试里全是假令牌。 */
import { describe, expect, test } from "bun:test";

const mem: Record<string, unknown> = {};
const ev = () => ({ addListener() { }, removeListener() { } });
(globalThis as any).IS_DEV = false;
(globalThis as any).VERSION = "test";
(globalThis as any).chrome ??= {};
const c = (globalThis as any).chrome;
const prevStorage = c.storage;

const { default: Tabs } = await import("../src/plugins/tabs/index");
const { default: LiveFolders } = await import("../src/plugins/tabs/liveFolders/index");
const B = await import("../src/plugins/data/backup/index");

const K = "ArcSidebarSettings";
const FAKE = "FAKE-TOKEN-not-a-real-credential";
/* 只用本文件里的插件定义求 sensitive 键，不碰全局插件表（core.test 也注册了名为 Tabs 的假插件） */
const keys = B.sensitiveKeysOf([Tabs, ...((Tabs as any).features ?? [])]);
const withMem = async <T>(fn: () => Promise<T>) => {
    c.storage = { local: { get: async (k: string | null) => k == null ? structuredClone(mem) : (k in mem ? { [k]: structuredClone(mem[k]) } : {}), set: async (o: Record<string, unknown>) => { Object.assign(mem, structuredClone(o)); } }, onChanged: ev() };
    try { return await fn(); } finally { c.storage = prevStorage; }
};
const settingsWith = (tabs: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ [K]: { plugins: { Tabs: { LiveFolders: true, query: "is:pr author:@me", ...tabs }, Boosts: { enabled: true }, ...extra } }, "data:spaces": { spaces: [] } });

describe("LiveFolders 令牌 sensitive", () => {
    test("定义：token 标 sensitive，合并进 Tabs 后仍带 sensitive；query 不是", () => {
        expect((LiveFolders.settings!.def as any).token.sensitive).toBe(true);
        expect((Tabs.settings!.def as any).token).toMatchObject({ sensitive: true, parent: "LiveFolders" });
        expect((Tabs.settings!.def as any).query.sensitive).toBeFalsy();
    });
    test("sensitive 键：当前位置 Tabs.token + 合并前的旧位置 LiveFolders.token", () => {
        expect(keys).toContainEqual(["Tabs", "token"]);
        expect(keys).toContainEqual(["LiveFolders", "token"]);
        expect(keys).not.toContainEqual(["Tabs", "query"]);
    });
    test("导出 / 新快照（stripSensitive）去掉令牌，其它设置保留", () => {
        const out = B.stripSensitive(settingsWith({ token: FAKE }), keys) as any;
        expect(out[K].plugins.Tabs.token).toBeUndefined();
        expect(out[K].plugins.Tabs.query).toBe("is:pr author:@me");
        expect(out[K].plugins.Tabs.LiveFolders).toBe(true);
        expect(out[K].plugins.Boosts).toEqual({ enabled: true });
        expect(JSON.stringify(out)).not.toContain(FAKE);
    });
    test("dump()：读的是同一个存储，导出数据去掉令牌后，实际存储里的令牌不受影响（升级不搬家、不丢）", async () => {
        for (const k of Object.keys(mem)) delete mem[k];
        Object.assign(mem, structuredClone(settingsWith({ token: FAKE })));
        const out = await withMem(() => B.dump()) as any;
        // ⚠ dump() 默认键来自全局插件表（本文件不注册真实 Tabs，避免和 core.test 的假 Tabs 冲突），所以导出侧用显式键再验
        expect((mem[K] as any).plugins.Tabs.token).toBe(FAKE);
        expect(JSON.stringify(B.stripSensitive(out, keys))).not.toContain(FAKE);
    });
    test("升级：令牌存储位置不变，不需要搬家；导入 / 恢复保留当前令牌，文件里的旧令牌忽略", () => {
        const cur = settingsWith({ token: "FAKE-CURRENT" });
        const out = B.keepSensitive(settingsWith({ token: "FAKE-OLD-FILE", query: "is:issue" }), cur, keys) as any;
        expect(out[K].plugins.Tabs.token).toBe("FAKE-CURRENT");
        expect(out[K].plugins.Tabs.query).toBe("is:issue");
    });
    test("导入文件有令牌、当前没填 → 不写入（同现有 sensitive 机制）", () => {
        const out = B.keepSensitive(settingsWith({ token: FAKE }), settingsWith({}), keys) as any;
        expect("token" in out[K].plugins.Tabs).toBe(false);
    });
    test("合并前的旧数据（plugins.LiveFolders.token）导入时也被去掉，不会被迁移搬回 Tabs.token", () => {
        const old = { [K]: { plugins: { LiveFolders: { enabled: true, query: "q", token: FAKE } } } };
        const out = B.keepSensitive(old, settingsWith({}), keys) as any;
        expect(out[K].plugins.LiveFolders).toEqual({ enabled: true, query: "q" });
        expect(JSON.stringify(out)).not.toContain(FAKE);
    });
    test("旧快照清洗：去掉令牌（含旧位置）和 secret:*，其它内容与时间不变", () => {
        const snaps = [
            { at: 3, data: settingsWith({ token: FAKE }) },
            { at: 2, data: { ...settingsWith({}), "secret:x": "FAKE-SECRET" } },
            { at: 1, data: { [K]: { plugins: { LiveFolders: { token: FAKE, query: "q" } } } } },
        ];
        const out = B.scrubSnaps(snaps, keys) as any[];
        expect(out.map(s => s.at)).toEqual([3, 2, 1]);
        expect(JSON.stringify(out)).not.toContain(FAKE);
        expect(JSON.stringify(out)).not.toContain("FAKE-SECRET");
        expect(out[0].data[K].plugins.Tabs.query).toBe("is:pr author:@me");
        expect(out[2].data[K].plugins.LiveFolders).toEqual({ query: "q" });
        expect(out[0].data["data:spaces"]).toEqual({ spaces: [] });
    });
    test("scrubStoredSnapshots：第一次改写，第二次不写（幂等）；当前令牌不动；空 / 无快照不写", async () => {
        for (const k of Object.keys(mem)) delete mem[k];
        Object.assign(mem, structuredClone(settingsWith({ token: FAKE })));
        mem.backups = [{ at: 2, data: settingsWith({ token: FAKE }) }, { at: 1, data: settingsWith({}) }];
        let writes = 0;
        const r = await withMem(async () => {
            const set = c.storage.local.set; c.storage.local.set = async (o: any) => { writes++; return set(o); };
            return [await B.scrubStoredSnapshots(keys), await B.scrubStoredSnapshots(keys)];
        });
        expect(r).toEqual([true, false]);
        expect(writes).toBe(1);
        expect(JSON.stringify(mem.backups)).not.toContain(FAKE);
        expect((mem.backups as any[]).length).toBe(2);
        expect((mem[K] as any).plugins.Tabs.token).toBe(FAKE);
        delete mem.backups;
        expect(await withMem(() => B.scrubStoredSnapshots(keys))).toBe(false);
    });
});

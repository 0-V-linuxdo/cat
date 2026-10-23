import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import * as C from "../src/plugins/tidyTabs/constants";
import { coreReady } from "../src/plugins/tidyTabs/coreHooks";
import { STRINGS } from "../src/plugins/tidyTabs/i18n";
import { assignIds, buildPrompt, extractCodeBlock, buttonEnabled, buttonVisible, parseAssignments, planGroups, shouldShowButton, tabLines } from "../src/plugins/tidyTabs/logic";

/** 从 Arc 分析文档里取提示词正文，逐字比对（文档缺失时退回只校验长度） */
function bodyFromDoc(): string | null {
    try {
        const s = readFileSync("/workspace/arc-analysis/tidy-tabs.md", "utf8");
        let a = s.indexOf("### 1. 提示词全文"); a = s.indexOf("```\n", a) + 4;
        return s.slice(a, s.indexOf("程序随后", a)).replace(/\n+$/, "").replace(/```$/, "").replace(/\n+$/, "");
    } catch { return null; }
}

const tabs = [
    { id: 11, title: "nitehawk cinema - Google Search", url: "https://www.google.com/search?q=n" },
    { id: 12, title: "Amazon: Amazing Deals", url: "https://amazon.com/" },
    { id: 13, title: "toaster reviews wirecutter", url: "https://google.com/search?q=t" },
    { id: 14, title: "What you should look for in buying a toaster", url: "https://toasttech.com/a", openerTabId: 13 },
    { id: 15, title: "June 25 | Weekly View", url: "https://calendar.google.com/", openerTabId: 999 },
    { id: 16, title: "Barbie Movie | Pavilion Theater", url: "https://pavilion.com/x" },
    { id: 17, title: "Blank", url: "chrome://newtab/" },
];

describe("Arc 原文", () => {
    test("提示词正文 1089 字节，与文档逐字一致", () => {
        expect(new TextEncoder().encode(C.PROMPT_BODY).length).toBe(1089);
        expect(C.PROMPT_BODY.startsWith("You are a meticulous expert organizer who follows instructions concisely.\nI have some tabs! Please help me sort them into groups.")).toBe(true);
        expect(C.PROMPT_BODY.endsWith("pavilion.com/0: Barbie Movie | Pavilion Theater\n```\n\nYou would output:")).toBe(true);
        const doc = bodyFromDoc();
        if (doc) expect(C.PROMPT_BODY).toBe(doc);
    });
    test("按钮 / tooltip / Other / 撤销 / 阈值", () => {
        expect(C.BUTTON_TEXT).toBe("Tidy");
        expect(C.ARC_TOOLTIP).toBe("Organize Today Tabs");
        expect(C.MISC_GROUP_NAME).toBe("Other");
        expect(C.UNDO_LABEL).toBe("Tidy Tabs");
        expect(C.MIN_TABS).toBe(7);
        expect(STRINGS.en["tidyTabs.button"]).toBe("Tidy");
        expect(STRINGS.en["tidyTabs.tooltip"]).toBe("Organize Today Tabs");
        expect(STRINGS.en["tidyTabs.undoLabel"]).toBe("Tidy Tabs");
        expect(STRINGS.en["tidyTabs.other"]).toBe("Other");
    });
});

describe("标签 id 与列表", () => {
    test("域名/序号，去 www，同域按顺序计数", () => {
        expect([...assignIds(tabs).values()]).toEqual(["google.com/0", "amazon.com/0", "google.com/1", "toasttech.com/0", "calendar.google.com/0", "pavilion.com/0", "newtab/0"]);
    });
    test("来源在列表中才附 ↳", () => {
        const lines = tabLines(tabs).split("\n");
        expect(lines[3]).toBe("toasttech.com/0: What you should look for in buying a toaster ↳ google.com/1");
        expect(lines[4]).toBe("calendar.google.com/0: June 25 | Weekly View");
    });
});

describe("提示词拼接", () => {
    test("正文 → 示例输出代码块 → 标签头 → 列表 → 结尾句", () => {
        const p = buildPrompt(C.PROMPT_BODY, tabs.slice(0, 2));
        expect(p).toBe(`${C.PROMPT_BODY}\n\`\`\`\n[["google.com/0","Movies"],["amazon.com/0","Toaster Shopping"],["google.com/1","Toaster Shopping"],["toasttech.com/0","Toaster Shopping"],["calendar.google.com/0","Calendar"],["pavilion.com/0","Movies"]]\n\`\`\`\nHere are my tabs, in the format 'id: title':\ngoogle.com/0: nitehawk cinema - Google Search\namazon.com/0: Amazon: Amazing Deals\nYour array of group assignments, as valid JSON within a \`\`\`code block\`\`\`:`);
    });
});

describe("解析二维数组", () => {
    test("代码块里的 [[tabID, groupName]]", () => {
        expect(extractCodeBlock("x\n```json\n[[\"a/0\",\"A\"]]\n```")).toBe('[["a/0","A"]]');
        expect(parseAssignments('Sure:\n```\n[["google.com/0","Movies"],["amazon.com/0"," Toaster Shopping "]]\n```')).toEqual([["google.com/0", "Movies"], ["amazon.com/0", "Toaster Shopping"]]);
    });
    test("跳过坏行；旧的对象写法不再兼容", () => {
        expect(parseAssignments('[["a/0","A"],["b/0"],[1,"B"],["c/0",""]]')).toEqual([["a/0", "A"]]);
        for (const v of ['[{"name":"A","ids":[1]}]', '{"A":["a/0"]}', "nope", "[]"]) expect(parseAssignments(v)).toBeNull();
    });
});

describe("分组计划", () => {
    test("按 id 映射回标签，未分配的补进 Other（我们的推断）", () => {
        const a = parseAssignments(`\`\`\`\n${JSON.stringify(C.PROMPT_EXAMPLE_OUTPUT)}\n\`\`\``)!;
        expect(planGroups(tabs, a, "Other")).toEqual([
            { name: "Movies", tabIds: [11, 16] }, { name: "Toaster Shopping", tabIds: [12, 13, 14] }, { name: "Calendar", tabIds: [15] },
            { name: "Other", tabIds: [17], misc: true },
        ]);
    });
    test("未知 id、重复分配忽略；模型自己给了 Other 时合并", () => {
        expect(planGroups(tabs.slice(0, 3), [["google.com/0", "A"], ["google.com/0", "B"], ["x.com/0", "C"], ["amazon.com/0", "Other"]], "Other"))
            .toEqual([{ name: "A", tabIds: [11] }, { name: "Other", tabIds: [12, 13], misc: true }]);
    });
    test("全部分完时没有 Other", () => {
        expect(planGroups(tabs.slice(0, 1), [["google.com/0", "A"]], "Other")).toEqual([{ name: "A", tabIds: [11] }]);
    });
    test("至少 7 个才显示按钮", () => {
        expect(shouldShowButton(6, C.MIN_TABS)).toBe(false);
        expect(shouldShowButton(7, C.MIN_TABS)).toBe(true);
    });
});

describe("核心接口与文案", () => {
    test("核心还没有 Today 分组接口时降级", () => expect(coreReady()).toBe(false));
    test("中英键一致", () => expect(Object.keys(STRINGS.en).toSorted()).toEqual(Object.keys(STRINGS.zh).toSorted()));
});

describe("Today 头部按钮", () => {
    test("visible 按 ctx.todayCount ≥ 7", () => {
        expect(buttonVisible({ todayCount: 6 }, C.MIN_TABS)).toBe(false);
        expect(buttonVisible({ todayCount: 7 }, C.MIN_TABS)).toBe(true);
        expect(buttonVisible({ todayCount: 0 }, C.MIN_TABS)).toBe(false);
    });
    test("分组进行中置灰", () => {
        expect(buttonEnabled(true)).toBe(false);
        expect(buttonEnabled(false)).toBe(true);
    });
    test("index.ts 用 ctx.todayCount 且有 enabled", () => {
        const src = readFileSync(new URL("../src/plugins/tidyTabs/index.ts", import.meta.url), "utf8");
        expect(src).toContain("buttonVisible(ctx, MIN_TABS)");
        expect(src).toContain("enabled:");
        expect(src).not.toContain("getTodayTabs()?.length");
    });
});

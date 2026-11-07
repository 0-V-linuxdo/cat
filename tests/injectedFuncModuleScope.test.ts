/* chrome.scripting.executeScript({ func }) 注入的函数只被序列化成文本，页面里没有本模块的作用域：函数体里引用模块级标识符
 * （本文件 import 的、或顶层声明的：Z / PAGE_Z_MAX / INPAGE_LAYERS / 任何 helper）→ 页面里 ReferenceError，功能静默失效
 * （rel52 实例：pickRegion 里的 z-index 改成 PAGE_Z_MAX → 「截取页面的一部分」覆盖层从不出现）。
 * 与 injectedFuncScope.test.ts 互补：那边是点名函数 + toString() 正则；这里用 TypeScript AST 扫 src/ 全部（含 selftest）的每个 executeScript({ func }) 调用点，
 * 解析 func（内联箭头 / 本文件顶层函数 / import 来的函数 / 包装函数 exec(func) 的调用处实参），断言函数体不引用其定义文件的任何 import 绑定或顶层标识符。
 * 能力边界（README 有说明）：func 来自其它动态表达式（条件 / 数组下标 / 跨文件包装器）时解析不到，会列入「未解析」且断言该列表为空，新增写法须先扩展这里；
 * 只查标识符引用，不查 `globalThis.xxx` 之类动态取值；string 形式注入（userScripts / insertCSS 的 code 字符串）无函数体可分析，src/ 里目前没有用常量拼进去的此类注入（见 README 排查表）。 */
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import ts from "typescript";

const root = resolve(new URL("..", import.meta.url).pathname);
const ALIAS: [string, string][] = [["@utils/", "src/utils/"], ["@src/", "src/"], ["@components/", "src/components/"], ["@api/", "src/api/"], ["@plugins/", "src/plugins/"]];

interface Host { read(file: string): string | null; resolve(from: string, spec: string): string | null }
interface Site { file: string; line: number; label: string; defFile?: string; refs: string[]; unresolved: boolean }

const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]);
const diskHost: Host = {
    read: f => existsSync(f) ? readFileSync(f, "utf8") : null,
    resolve(from, spec) {
        let base: string | null = null;
        if (spec.startsWith(".")) base = resolve(dirname(from), spec);
        else for (const [a, b] of ALIAS) if (spec.startsWith(a)) base = join(root, b, spec.slice(a.length));
        if (!base) return null;
        return [`${base}.ts`, join(base, "index.ts"), base].find(c => c.endsWith(".ts") && existsSync(c)) ?? null;
    },
};

const FN = (n: ts.Node): n is ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration => ts.isArrowFunction(n) || ts.isFunctionExpression(n) || ts.isFunctionDeclaration(n);
const importsOf = (s: ts.SourceFile) => {
    const m = new Map<string, { spec: string; imported: string }>();
    for (const st of s.statements) {
        if (!ts.isImportDeclaration(st) || !st.importClause || st.importClause.isTypeOnly) continue;
        const spec = (st.moduleSpecifier as ts.StringLiteral).text, nb = st.importClause.namedBindings;
        if (st.importClause.name) m.set(st.importClause.name.text, { spec, imported: "default" });
        if (nb && ts.isNamedImports(nb)) for (const e of nb.elements) if (!e.isTypeOnly) m.set(e.name.text, { spec, imported: (e.propertyName ?? e.name).text });
        if (nb && ts.isNamespaceImport(nb)) m.set(nb.name.text, { spec, imported: "*" });
    }
    return m;
};
const topLevelNames = (s: ts.SourceFile) => {
    const n = new Set<string>();
    for (const st of s.statements) {
        if ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st) || ts.isEnumDeclaration(st)) && st.name) n.add(st.name.text);
        if (ts.isVariableStatement(st)) for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name)) n.add(d.name.text);
    }
    return n;
};
const topFn = (s: ts.SourceFile, name: string): ts.Node | null => {
    for (const st of s.statements) {
        if (ts.isFunctionDeclaration(st) && st.name?.text === name) return st;
        if (ts.isVariableStatement(st)) for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name) && d.name.text === name && d.initializer && FN(d.initializer)) return d.initializer;
    }
    return null;
};
/** 值位置的标识符引用（排除属性名 / 声明名 / 类型位置） */
const valueRefs = (fn: ts.Node): Set<string> => {
    const out = new Set<string>(), declared = new Set<string>();
    const decl = (x: ts.Node) => {
        if ((ts.isVariableDeclaration(x) || ts.isParameter(x) || ts.isBindingElement(x) || ts.isFunctionDeclaration(x)) && x.name && ts.isIdentifier(x.name)) declared.add(x.name.text);
        x.forEachChild(decl);
    };
    decl(fn);
    const visit = (x: ts.Node) => {
        if (ts.isIdentifier(x)) {
            const p = x.parent;
            const skip = (ts.isPropertyAccessExpression(p) && p.name === x) || (ts.isPropertyAssignment(p) && p.name === x) || ts.isTypeReferenceNode(p) || ts.isTypeQueryNode(p) || ts.isQualifiedName(p)
                || ts.isPropertySignature(p) || ts.isPropertyDeclaration(p) || ts.isParameter(p) || ts.isVariableDeclaration(p) && p.name === x || ts.isBindingElement(p) || ts.isFunctionDeclaration(p) && p.name === x || ts.isLabeledStatement(p) || ts.isBreakOrContinueStatement(p);
            if (!skip) out.add(x.text);
        }
        x.forEachChild(visit);
    };
    visit(fn);
    for (const d of declared) out.delete(d);
    return out;
};

/** 扫一个文件里所有 executeScript({ func }) 注入点。 */
function scanInjected(file: string, host: Host): Site[] {
    const text = host.read(file);
    if (text == null) return [];
    const parsed = new Map<string, ts.SourceFile>();
    const sf = (f: string) => { let s = parsed.get(f); if (!s) { s = ts.createSourceFile(f, host.read(f) ?? "", ts.ScriptTarget.ES2022, true); parsed.set(f, s); } return s; };
    const s = sf(file), sites: Site[] = [];
    const analyse = (fnNode: ts.Node, defFile: string, label: string, line: number) => {
        const ds = sf(defFile), imp = importsOf(ds), tops = topLevelNames(ds), selfName = (fnNode as ts.FunctionDeclaration).name?.getText();
        const refs = [...valueRefs(fnNode)].filter(r => r !== selfName && (imp.has(r) || tops.has(r))).toSorted();
        sites.push({ file, line, label, defFile, refs, unresolved: false });
    };
    /** 把一个 func 表达式（内联 / 标识符）解析成函数节点并分析 */
    const handle = (expr: ts.Expression, label: string, line: number) => {
        if (FN(expr)) return analyse(expr, file, label, line);
        if (ts.isIdentifier(expr)) {
            const t = topFn(s, expr.text);
            if (t) return analyse(t, file, expr.text, line);
            const im = importsOf(s).get(expr.text), r = im && host.resolve(file, im.spec), t2 = r && topFn(sf(r), im!.imported);
            if (t2 && r) return analyse(t2, r, expr.text, line);
        }
        sites.push({ file, line, label: `${label}:${expr.getText(s).slice(0, 40)}`, refs: [], unresolved: true });
    };
    const lineOf = (n: ts.Node) => s.getLineAndCharacterOfPosition(n.getStart()).line + 1;
    const visit = (n: ts.Node) => {
        if (ts.isCallExpression(n) && /(^|\.)executeScript$/.test(n.expression.getText(s)) && n.arguments[0] && ts.isObjectLiteralExpression(n.arguments[0])) {
            for (const p of n.arguments[0].properties) {
                const isFunc = (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) && p.name.getText(s) === "func";
                if (!isFunc) continue;
                const expr = ts.isPropertyAssignment(p) ? p.initializer : p.name;
                // func 是外层包装函数的形参（exec(func) / inPage(func)）：分析包装函数各调用处的实参
                if (ts.isIdentifier(expr)) {
                    let w: ts.Node | undefined = p.parent;
                    while (w && !(FN(w) && w.parameters.some(q => q.name.getText(s) === expr.text))) w = w.parent;
                    if (w && FN(w)) {
                        const wrapper = ts.isVariableDeclaration(w.parent) ? w.parent.name.getText(s) : (w as ts.FunctionDeclaration).name?.text;
                        const idx = w.parameters.findIndex(q => q.name.getText(s) === expr.text);
                        let calls = 0;
                        const find = (c: ts.Node) => {
                            if (ts.isCallExpression(c) && ts.isIdentifier(c.expression) && c.expression.text === wrapper && c.arguments[idx]) { calls++; handle(c.arguments[idx]!, `${wrapper}(…)`, lineOf(c)); }
                            c.forEachChild(find);
                        };
                        find(s);
                        if (!calls) sites.push({ file, line: lineOf(n), label: `包装 ${wrapper} 无调用处`, refs: [], unresolved: true });
                        continue;
                    }
                }
                handle(expr, "inline", lineOf(n));
            }
        }
        n.forEachChild(visit);
    };
    visit(s);
    return sites;
}

describe("executeScript({ func }) 注入函数不得引用模块级标识符（AST 全树扫描）", () => {
    const all = walk(join(root, "src")).filter(f => f.endsWith(".ts")).flatMap(f => scanInjected(f, diskHost));
    const rel = (x: Site) => `${x.file.replace(`${root}/`, "")}:${x.line} func=${x.label}`;

    test("扫描有效：已知注入点都被解析到（防止解析器失效后空通过）", () => {
        const labels = all.map(x => x.label);
        for (const must of ["pickRegion", "pageHasUnsavedInput", "pageHasBeforeUnload", "trackMedia"]) expect(labels, must).toContain(must);
        expect(all.length).toBeGreaterThanOrEqual(25);
    });
    test("没有解析不到的注入点（新写法先扩展本测试）", () => {
        expect(all.filter(x => x.unresolved).map(rel)).toEqual([]);
    });
    test("注入函数体不引用其所在文件的 import / 顶层标识符（含 Z / PAGE_Z_MAX / INPAGE_LAYERS）", () => {
        expect(all.filter(x => x.refs.length).map(x => `${rel(x)} → ${x.refs.join(", ")}`)).toEqual([]);
    });
    test("尤其：zLayers 常量（Z / PAGE_Z_MAX / INPAGE_LAYERS 及其别名）不出现在任何注入函数体里", () => {
        const bad: string[] = [];
        for (const x of all) {
            const ds = ts.createSourceFile(x.defFile ?? x.file, readFileSync(x.defFile ?? x.file, "utf8"), ts.ScriptTarget.ES2022, true);
            const names = new Set([...importsOf(ds)].filter(([, v]) => v.spec.endsWith("zLayers")).map(([k]) => k));
            for (const r of x.refs) if (names.has(r) || ["Z", "PAGE_Z_MAX", "INPAGE_LAYERS"].includes(r)) bad.push(`${rel(x)} → ${r}`);
        }
        expect(bad).toEqual([]);
    });
});

describe("扫描器自检（合成源码：必须报得出，也不能乱报）", () => {
    const mem = (files: Record<string, string>): Host => ({ read: f => files[f] ?? null, resolve: (from, spec) => spec.startsWith(".") ? `${resolve(dirname(from), spec)}.ts` : null });
    const scan = (files: Record<string, string>) => scanInjected("/m/a.ts", mem(files));
    const head = `import { PAGE_Z_MAX, Z as ZZ } from "@utils/zLayers";\nconst helper = () => 1;\n`;
    test("内联箭头引用 PAGE_Z_MAX / 别名 / 顶层 helper → 报", () => {
        const r = scan({ "/m/a.ts": `${head}chrome.scripting.executeScript({ target: { tabId: 1 }, func: () => { document.body.style.zIndex = String(PAGE_Z_MAX); return ZZ.menu + helper(); } });` });
        expect(r.map(x => x.refs)).toEqual([["PAGE_Z_MAX", "ZZ", "helper"]]);
    });
    test("z 经 args 传入、函数体只用形参 / 局部 / 全局 → 不报", () => {
        const r = scan({ "/m/a.ts": `${head}chrome.scripting.executeScript({ target: { tabId: 1 }, args: [PAGE_Z_MAX], func: (z: number) => { const el = document.createElement("div"); el.style.zIndex = String(z); return Math.max(1, z); } });` });
        expect(r.map(x => x.refs)).toEqual([[]]);
    });
    test("顶层函数 / import 来的函数 / 包装器实参都能追到", () => {
        const a = `${head}import { far } from "./b";\nfunction near() { return PAGE_Z_MAX; }\nconst exec = (tabId: number, func: () => void) => chrome.scripting.executeScript({ target: { tabId }, func });\n`
            + `chrome.scripting.executeScript({ target: { tabId: 1 }, func: near });\nchrome.scripting.executeScript({ target: { tabId: 1 }, func: far });\nexec(1, () => ZZ.toast);\nexec(2, () => 2);`;
        const b = `import { Z } from "@utils/zLayers";\nexport function far() { return Z.menu; }`;
        const r = scan({ "/m/a.ts": a, "/m/b.ts": b });
        expect(r.map(x => `${x.label}:${x.refs.join("+")}`).toSorted()).toEqual(["exec(…):", "exec(…):ZZ", "far:Z", "near:PAGE_Z_MAX"]);
    });
    test("解析不了的 func（条件表达式）→ 标 unresolved，不静默放过", () => {
        const r = scan({ "/m/a.ts": `${head}chrome.scripting.executeScript({ target: { tabId: 1 }, func: Math.random() > 1 ? () => 1 : () => PAGE_Z_MAX });` });
        expect(r.map(x => x.unresolved)).toEqual([true]);
    });
});

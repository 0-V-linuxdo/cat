/* 页内侧边栏：render 的「无动画」决定（补丁 inpage-prepare-render，修「切 tab 又重新展开」的残留；纯逻辑 + 极小的 DOM 接口，单测见 tests/inpagePrepareRender.test.ts）。
 * 根因（content.ts render，补丁 tab-switch 之后）：先按入参 instant 写 data-noanim + 内联 transition:none，**之后**才用 !visible 把 instant 抬成 true。
 *   → 隐藏标签里收到状态变化（例如侧栏是在别的标签里展开的，本标签 show 0→1）时，pager 因 instant=true 不播推开，
 *     但 .box 的 transform 过渡没被压住：过渡在隐藏文档里起跑，切回来那一刻补播 = 「重新展开」（实测 headed：切 tab 滑入 1/4，样本 left=-238、anim=19、noanim 空）。
 * 做法：先算出有效 instant（入参 || 页面不可见），再据此压过渡。隐藏页的 rAF 不会跑 → 压制一直保持到可见后两帧才撤，正好覆盖「可见那一刻」。
 * 代际号：连续多次 render 各排一对 rAF 时只有最后一对负责撤销（否则前一对会提前撤掉后一次 render 刚压上的过渡）。 */

export interface InstantHost { dataset: Record<string, string | undefined> }
export interface InstantBox { style: { setProperty(name: string, value: string): void; removeProperty(name: string): unknown } }

const gens = new WeakMap<object, number>();

/** 返回有效 instant。needs 压过渡时：data-noanim=1 + 内联 transition:none，两帧 rAF 后撤（只有最后一次调用的那一对生效） */
export function prepareRender(c: { instant: boolean; visible: boolean; host: InstantHost; box: InstantBox; raf: (f: () => void) => unknown }): boolean {
    const instant = c.instant || !c.visible;
    if (!instant) return false;
    const g = (gens.get(c.box) ?? 0) + 1; gens.set(c.box, g);
    c.host.dataset.noanim = "1"; c.box.style.setProperty("transition", "none");
    c.raf(() => c.raf(() => { if (gens.get(c.box) !== g) return; delete c.host.dataset.noanim; c.box.style.removeProperty("transition"); }));
    return true;
}

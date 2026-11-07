/* SELECT 设置项下拉「显示哪一项」：存储里的值不在选项里（旧版本留下的值、手写的值，如 prewarm 的已移除值 "tab"）时，
 * 显示默认项（没有标 default 的选项时显示第一项），而不是空白无选中。只影响显示：不写存储（用户重新选择才写），读取该设置的插件代码自己负责归一化（如 parsePrewarmMode 对未知值按 off）。 */
export function selectShown<V>(options: readonly { value: V; default?: boolean }[], cur: V | undefined): V | undefined {
    if (options.some(o => o.value === cur)) return cur;
    return options.find(o => o.default)?.value ?? options[0]?.value;
}

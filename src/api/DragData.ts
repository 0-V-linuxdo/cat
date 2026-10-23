/* 拖放数据：单项 "tab:<id>" / "pin:<nodeId>" / "fav:<id>"；多选时为 "multi:<key>,<key>…"（MultiSelect 写入） */
export const MULTI_PREFIX = "multi:";
export const encodeMulti = (keys: string[]) => MULTI_PREFIX + keys.join(",");
export function expandDragData(data: string): string[] {
    return data.startsWith(MULTI_PREFIX) ? data.slice(MULTI_PREFIX.length).split(",").filter(Boolean) : [data];
}

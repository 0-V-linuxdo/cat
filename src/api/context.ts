import type { ExtContext } from "@utils/types";

let current: ExtContext = "background";
export const setContext = (c: ExtContext) => { current = c; };
export const getContext = () => current;

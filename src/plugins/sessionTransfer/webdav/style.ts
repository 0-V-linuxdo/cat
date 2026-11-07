/* WebDAV 对话框补充样式（并入插件的 managedStyle；仅面板里生效） */
export const DAV_STYLE = `
.st-card input[type=text], .st-card select { all: unset; box-sizing: border-box; width: 100%; min-height: 28px; padding: 6px 8px; border-radius: 6px; font-size: 12px; background: color-mix(in srgb, currentColor 8%, transparent); box-shadow: inset 0 0 0 1px color-mix(in srgb, currentColor 15%, transparent); }
.st-card .st-field { display: grid; gap: 3px; font-size: 12px; }
.st-card .st-field > span { opacity: .7; }
.st-card .st-warn { font-size: 11px; line-height: 1.35; color: #e5484d; overflow-wrap: anywhere; }
.st-card .st-status { font-size: 12px; min-height: 16px; text-align: center; overflow-wrap: anywhere; }
.st-dav-list { display: grid; gap: 4px; max-height: 240px; overflow-y: auto; }
.st-dav-row { display: grid; grid-template-columns: 1fr auto; gap: 6px; align-items: center; }
.st-dav-row > button { all: unset; box-sizing: border-box; padding: 6px 8px; border-radius: 6px; font-size: 12px; line-height: 1.3; cursor: pointer; background: color-mix(in srgb, currentColor 8%, transparent); overflow-wrap: anywhere; }
.st-dav-row > button.del { padding: 6px; text-align: center; }
.st-dav-row.expired > button:first-child { opacity: .45; cursor: default; }
`;

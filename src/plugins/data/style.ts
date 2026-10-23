/* 插件组 Data 的样式：设置里的备份快照列表（时间等宽、恢复按钮悬停才显眼） */
export default /* css */ `
.arc-backup-list .arc-list-row { cursor: default; font-variant-numeric: tabular-nums; }
.arc-backup-list .arc-btn { opacity: .6; transition: opacity var(--arc-t-fast); }
.arc-backup-list .arc-list-row:hover .arc-btn { opacity: 1; }
`;

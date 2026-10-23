/* 侧边栏横幅（Arc SidebarBanner）：沿用现有配色变量，极简 */
export default /* css */ `
.arc-dlrename-banner { margin: 6px 8px; padding: 10px 12px; border-radius: 12px; background: var(--arc-tile-hover); color: var(--arc-fg); font-size: 12px; display: flex; flex-direction: column; gap: 4px; }
.arc-dlrename-banner .arc-banner-title { opacity: .7; }
.arc-dlrename-banner .arc-banner-text { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.arc-dlrename-banner .arc-banner-actions { display: flex; justify-content: space-between; gap: 6px; margin-top: 2px; }
.arc-dlrename-banner .arc-btn-quiet { opacity: .6; }
`;

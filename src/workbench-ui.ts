/** Small, authored engineering symbols. They communicate component type rather
 * than repeating a generic cube for every assembly. All SVG content is static. */
const symbols: Record<string, string> = {
  '轮毂总成': '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2.5"/><path d="M12 4v3m7 9-3-2M5 16l3-2"/>',
  '叶片': '<circle cx="12" cy="11" r="2"/><path d="m12 9 1-7c5 0 5 4 1 7m-4 3-6 4c-3-4 0-6 5-5m5 2 6 4c-2 4-6 2-7-3"/>',
  '主轴组件': '<ellipse cx="5" cy="12" rx="2" ry="6"/><path d="M5 6h14c3 0 3 12 0 12H5m0-9h15M5 15h15"/>',
  '主轴承': '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="M12 3v3m0 12v3M3 12h3m12 0h3M6 6l2 2m8 8 2 2m0-12-2 2M6 18l2-2"/>',
  '齿轮箱': '<path d="m9 3-1 3-3-1-2 4 2 3-2 3 2 4 3-1 1 3h6l1-3 3 1 2-4-2-3 2-3-2-4-3 1-1-3Z"/><circle cx="12" cy="12" r="3.5"/>',
  '高速轴制动器': '<circle cx="11" cy="12" r="8"/><circle cx="11" cy="12" r="3"/><path d="M17 6h4v12h-4M7 6l1 2m-4 5h3m8 4-2-2"/>',
  '高速轴联轴器': '<path d="M2 12h4m12 0h4M6 6h4v12H6Zm8 0h4v12h-4ZM10 9h4m-4 6h4"/>',
  '发电机': '<path d="M5 5h13l3 3v9H5Z M2 10h3m-3 4h3M8 5v12m3-12v12m3-12v12m3-12v12M7 17v3m11-3v3M5 20h15"/>',
  '主机架': '<path d="M3 6h18v4H3Zm0 8h18v4H3ZM6 10v4m12-4v4M3 18v3m18-3v3"/>',
  '液压系统': '<path d="M4 10h16v11H4ZM8 10V5h8v5M12 5V2m-5 13h10"/><path d="M12 11c0 0-3 3-3 5a3 3 0 0 0 6 0c0-2-3-5-3-5"/>',
  '辅助变压器': '<path d="M2 5h3v14H2m20-14h-3v14h3M8 5c5 0 5 4 0 4 5 0 5 4 0 4 5 0 5 4 0 4m8-12c-5 0-5 4 0 4-5 0-5 4 0 4-5 0-5 4 0 4"/>',
  '偏航系统': '<ellipse cx="12" cy="13" rx="9" ry="5"/><path d="M3 13v4c0 6 18 6 18 0v-4M7 5a9 4 0 0 1 12 1m-1-4 1 4-4 1M8 13h8"/>',
  '机舱外壳': '<path d="M3 7h14l4 5v7H3Zm0 0 4-3h10l4 8M3 12h18M7 4v3"/>',
};

export function partIcon(label: string): string {
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${symbols[label] ?? '<path d="m12 3 9 5v9l-9 5-9-5V8Zm-9 5 9 5 9-5m-9 5v9"/>'}</svg>`;
}

/** Follow native tab/tree keyboard conventions without capturing canvas keys. */
export function wireWorkbenchKeyboard(tabs: HTMLButtonElement[], tree: HTMLElement): void {
  tabs.forEach((tab, index) => tab.addEventListener('keydown', event => {
    const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length
      : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length
      : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault(); event.stopPropagation(); tabs[next].click(); tabs[next].focus();
  }));
  tree.addEventListener('focusin', event => {
    const item = (event.target as HTMLElement).closest<HTMLElement>('[role="treeitem"]');
    if (!item) return;
    tree.querySelectorAll<HTMLElement>('[role="treeitem"]').forEach(row => { row.tabIndex = row === item ? 0 : -1; });
  });
  tree.addEventListener('keydown', event => {
    const item = (event.target as HTMLElement).closest<HTMLElement>('[role="treeitem"]');
    if (!item) return;
    const items = [...tree.querySelectorAll<HTMLElement>('[role="treeitem"]')].filter(row => row.getClientRects().length);
    const index = items.indexOf(item); let next: HTMLElement | undefined;
    if (event.key === 'ArrowDown') next = items[Math.min(index + 1, items.length - 1)];
    else if (event.key === 'ArrowUp') next = items[Math.max(index - 1, 0)];
    else if (event.key === 'Home') next = items[0];
    else if (event.key === 'End') next = items.at(-1);
    else if (event.key === 'ArrowRight') {
      if (item.getAttribute('aria-expanded') === 'false') item.click();
      else if (item.getAttribute('aria-expanded') === 'true') next = items[index + 1];
    } else if (event.key === 'ArrowLeft') {
      if (item.getAttribute('aria-expanded') === 'true') item.click();
      else next = item.closest('.tree-group')?.querySelector<HTMLElement>('.tree-group-toggle') ?? undefined;
    } else return;
    event.preventDefault(); event.stopPropagation(); next?.focus();
  });
}

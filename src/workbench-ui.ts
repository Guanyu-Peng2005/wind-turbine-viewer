import { createElement, createIcons, Wind, Fan, CircleDot, Cylinder, Cog, Disc, Link2, Zap, PanelsTopLeft, Droplets, Package, Orbit, Move, RotateCcw, MapPin, PencilLine, ListTree, Activity, ChevronRight, PanelRightClose, Layers, MessageSquareText, type IconNode } from 'lucide';

const symbols: Record<string, IconNode> = {
  '轮毂总成': CircleDot, '叶片': Fan, '主轴组件': Cylinder, '主轴承': CircleDot,
  '齿轮箱': Cog, '高速轴制动器': Disc, '高速轴联轴器': Link2, '发电机': Zap,
  '主机架': PanelsTopLeft, '液压系统': Droplets, '辅助变压器': Zap, '偏航系统': Orbit, '机舱外壳': Package,
};
const iconCache=new Map<string,string>();
export function partIcon(label:string):string {
  let svg=iconCache.get(label);
  if(!svg){svg=createElement(symbols[label]??Package,{'aria-hidden':'true','stroke-width':1.5}).outerHTML;iconCache.set(label,svg);}
  return svg;
}
export function treeChevron():string { return createElement(ChevronRight,{'aria-hidden':'true','class':'tree-chevron','stroke-width':1.5}).outerHTML; }
export function initializeWorkbenchIcons():void {
  createIcons({icons:{Wind,Orbit,Move,RotateCcw,MapPin,PencilLine,ListTree,Activity,PanelRightClose,Layers,MessageSquareText},nameAttr:'data-ui-icon',attrs:{'aria-hidden':'true','stroke-width':1.6}});
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

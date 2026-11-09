// Scrollbar visibility and internal displacement maps do not change the scene
// seen through glass. Ignore them before either engine scans or samples it.
const LENS_MAP = 'svg[data-glass-lens-map]';
const withoutScrollbar = value => (value || '').split(/\s+/)
  .filter(token => token && token !== 'public-scrollbar-auto-hide--visible').join(' ');
const isLensMap = node => node.nodeType === 1 && Boolean(node.matches?.(LENS_MAP) || node.closest?.(LENS_MAP));

export function affectsGlass(record) {
  if (isLensMap(record.target)) return false;
  if (record.type === 'attributes') {
    const value = record.target.getAttribute(record.attributeName);
    if (record.oldValue === value) return false;
    if (record.attributeName === 'class' && withoutScrollbar(record.oldValue) === withoutScrollbar(value)) return false;
  } else if (record.type === 'childList') {
    return [...record.addedNodes, ...record.removedNodes].some(node => !isLensMap(node));
  }
  return true;
}

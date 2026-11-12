import type { CanvasElement } from './model';

const offsets = new Map<string, number>();
/** Measure an actual CSS baseline so mixed font sizes can share a row. */
export function baselineOffset(e: CanvasElement): number {
  if (e.type !== 'text') return e.h;
  if (typeof document === 'undefined') return ((e.fontSize * 96) / 72) * 0.9;
  const key = [e.fontFamily, e.fontSize, e.lineHeight, e.bold].join('|');
  let offset = offsets.get(key);
  if (offset === undefined) {
    const probe = document.createElement('div');
    Object.assign(probe.style, {
      position: 'fixed',
      left: '-20000px',
      top: '0',
      fontFamily: e.fontFamily,
      fontSize: (e.fontSize * 96) / 72 + 'px',
      lineHeight: String(e.lineHeight),
      fontWeight: e.bold ? '700' : '400',
      whiteSpace: 'nowrap',
    });
    probe.textContent = '文字Ag';
    const marker = document.createElement('span');
    Object.assign(marker.style, {
      display: 'inline-block',
      width: '0',
      height: '0',
      verticalAlign: 'baseline',
    });
    probe.append(marker);
    document.body.append(probe);
    offset = marker.getBoundingClientRect().top - probe.getBoundingClientRect().top;
    probe.remove();
    offsets.set(key, offset);
  }
  return offset + (e.strokeWidth || 0);
}
export function guideY(anchor: CanvasElement): number {
  return anchor.y + baselineOffset(anchor);
}
export function boundMoveMembers(selected: CanvasElement[], all: CanvasElement[]): CanvasElement[] {
  const ids = new Set(selected.map((e) => e.id));
  const owners = new Set(selected.filter((e) => e.rowGuide).map((e) => e.id));
  for (const e of all) if (e.rowAnchorId && owners.has(e.rowAnchorId) && !e.locked) ids.add(e.id);
  return all.filter((e) => ids.has(e.id) && !e.locked);
}
export function synchronizeRows(all: CanvasElement[], previous: CanvasElement[] = []): void {
  const before = new Map(previous.map((e) => [e.id, e])),
    byId = new Map(all.map((e) => [e.id, e]));
  for (const anchor of all) if (anchor.rowGuide) delete anchor.rowAnchorId;
  for (const child of all) {
    if (!child.rowAnchorId) continue;
    const anchor = byId.get(child.rowAnchorId);
    if (!anchor?.rowGuide || anchor.id === child.id) {
      delete child.rowAnchorId;
      continue;
    }
    if (child.locked) continue;
    const oldAnchor = before.get(anchor.id),
      oldChild = before.get(child.id);
    if (oldAnchor && oldChild && child.x === oldChild.x) child.x += anchor.x - oldAnchor.x;
    child.y = guideY(anchor) - baselineOffset(child);
  }
}
export function bindRow(anchor: CanvasElement, children: CanvasElement[]): void {
  anchor.rowGuide = true;
  delete anchor.rowAnchorId;
  for (const child of children) {
    if (child.id === anchor.id || child.locked || child.rowGuide) continue;
    child.rowAnchorId = anchor.id;
    child.y = guideY(anchor) - baselineOffset(child);
  }
}
export function detachGuide(anchor: CanvasElement, all: CanvasElement[]): void {
  delete anchor.rowGuide;
  for (const child of all) if (child.rowAnchorId === anchor.id) delete child.rowAnchorId;
}
export function remapRowReferences(copies: CanvasElement[], originals: CanvasElement[]): void {
  const mapping = new Map(originals.map((original, index) => [original.id, copies[index].id]));
  for (const copy of copies)
    if (copy.rowAnchorId) {
      const next = mapping.get(copy.rowAnchorId);
      if (next) copy.rowAnchorId = next;
      else delete copy.rowAnchorId;
    }
}

import {
  clone,
  PAGE_HEIGHT,
  plainText,
  type CanvasElement,
  type ContentBlock,
  type EditorPage,
} from '../core/model';
import { baselineOffset, guideY, synchronizeRows } from '../core/guides';
import { isSectionHeading } from '../importers/structure';
import { elementNode } from '../exporters/scene';

export const beautyThemes = {
  blue: { name: '专业蓝', accent: '#2863aa', text: '#283744', muted: '#697985' },
  green: { name: '清爽绿', accent: '#246b53', text: '#263b30', muted: '#6c7d73' },
  ink: { name: '简约黑', accent: '#242b32', text: '#30373d', muted: '#6e767d' },
};
export type BeautyTheme = keyof typeof beautyThemes;
type Role = 'title' | 'heading' | 'body' | 'meta';
interface Row {
  elements: CanvasElement[];
  originalTop: number;
  originalBottom: number;
  heading: boolean;
}

function textOf(e: CanvasElement): string {
  return typeof document === 'undefined' ? e.html.replace(/<[^>]*>/g, '') : plainText(e.html);
}
function median(values: number[], fallback: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] || fallback;
}
function roleOf(e: CanvasElement, blocks: Map<string, ContentBlock>, bodySize: number): Role {
  const text = textOf(e).trim(),
    block = blocks.get(e.blockId || '');
  if (block?.type === 'heading') return block.level === 1 ? 'title' : 'heading';
  if (isSectionHeading(text)) return 'heading';
  if (text.length < 60 && e.y < 220 && e.fontSize >= bodySize * 1.55) return 'title';
  if (text.length < 40 && e.bold && e.fontSize >= bodySize + 1.5) return 'heading';
  if (block?.role === 'contact' || /^(?:19|20)\d{2}.*(?:[-—–~至]|现在|今)/.test(text))
    return 'meta';
  return 'body';
}
function cleanInlineStyle(html: string): string {
  if (typeof document === 'undefined') return html;
  const node = document.createElement('div');
  node.innerHTML = html;
  for (const child of node.querySelectorAll<HTMLElement>('[style]')) {
    child.style.removeProperty('font-family');
    child.style.removeProperty('color');
    // Relative sizing carries meaningful emphasis in imported paragraphs.
    if (!/(?:em|%)$/.test(child.style.fontSize)) child.style.removeProperty('font-size');
  }
  return node.innerHTML;
}
function textHeight(e: CanvasElement): number {
  if (typeof document === 'undefined') {
    const pixels = (e.fontSize * 96) / 72;
    const lines = textOf(e)
      .split('\n')
      .reduce(
        (count, line) =>
          count + Math.max(1, Math.ceil((line.length * pixels * 0.7) / Math.max(1, e.w))),
        0,
      );
    return lines * pixels * e.lineHeight;
  }
  const node = elementNode(e);
  Object.assign(node.style, {
    left: '-20000px',
    top: '0',
    height: 'auto',
    transform: 'none',
    visibility: 'hidden',
  });
  document.body.append(node);
  const height = node.getBoundingClientRect().height;
  node.remove();
  return Math.max(1, height);
}
function overlapsX(a: CanvasElement, b: CanvasElement): boolean {
  return Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 4;
}
function overlaps(a: CanvasElement, b: CanvasElement): boolean {
  return overlapsX(a, b) && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 2;
}
function alignColumns(elements: CanvasElement[]): void {
  const columns: CanvasElement[][] = [];
  for (const e of [...elements].sort((a, b) => a.x - b.x)) {
    const column = columns.find(
      (items) => items[0].textAlign === e.textAlign && Math.abs(items[0].x - e.x) <= 5,
    );
    if (column) column.push(e);
    else columns.push([e]);
  }
  for (const column of columns) {
    if (column.length < 2) continue;
    const x = median(
      column.map((e) => e.x),
      column[0].x,
    );
    for (const e of column) {
      if (e.textAlign === 'center') continue;
      e.x = x;
    }
  }
}
function arrangeRows(
  elements: CanvasElement[],
  originals: Map<string, CanvasElement>,
  roles: Map<string, Role>,
): void {
  const rows: Row[] = [];
  for (const e of [...elements].sort((a, b) => originals.get(a.id)!.y - originals.get(b.id)!.y)) {
    const old = originals.get(e.id)!;
    const row = rows.find(
      (candidate) => Math.abs(guideY(originals.get(candidate.elements[0].id)!) - guideY(old)) <= 3,
    );
    if (row) {
      row.elements.push(e);
      row.originalTop = Math.min(row.originalTop, old.y);
      row.originalBottom = Math.max(row.originalBottom, old.y + old.h);
    } else
      rows.push({
        elements: [e],
        originalTop: old.y,
        originalBottom: old.y + old.h,
        heading: roles.get(e.id) === 'heading',
      });
  }
  alignColumns(elements);
  const placed: Row[] = [];
  for (const row of rows) {
    const baseline = Math.max(...row.elements.map(guideY));
    row.elements.forEach((e) => (e.y = baseline - baselineOffset(e)));
    const previous = [...placed]
      .reverse()
      .find((candidate) =>
        candidate.elements.some((a) => row.elements.some((b) => overlapsX(a, b))),
      );
    if (previous) {
      const oldGap = row.originalTop - previous.originalBottom;
      // Keep deliberate large whitespace and overlapping free-form compositions.
      if (oldGap >= -8 && oldGap <= 28) {
        const gap = row.heading ? 12 : previous.heading ? 7 : 5;
        const top = Math.min(...row.elements.map((e) => e.y));
        const bottom = Math.max(...previous.elements.map((e) => e.y + e.h));
        row.elements.forEach((e) => (e.y += bottom + gap - top));
      }
    }
    placed.push(row);
  }
}
function createsCollision(
  elements: CanvasElement[],
  originals: Map<string, CanvasElement>,
  ids: Set<string>,
): boolean {
  const obstacles = elements.filter(
    (e) => (e.type === 'text' || e.type === 'image') && e.rotation === 0,
  );
  for (const e of obstacles.filter((item) => ids.has(item.id))) {
    const old = originals.get(e.id)!;
    if (e.y < 0 || e.y + e.h > Math.max(PAGE_HEIGHT - 18, old.y + old.h)) return true;
    for (const other of obstacles) {
      if (other.id === e.id) continue;
      if (overlaps(e, other) && !overlaps(old, originals.get(other.id)!)) return true;
    }
  }
  return false;
}

/** Restyle the existing scene, retaining identities, content, assets and row bindings. */
export function beautifyPages(
  pages: EditorPage[],
  blocks: ContentBlock[],
  theme: BeautyTheme,
  selection?: Set<string>,
  fontFamily = 'Noto Sans SC',
): { pages: EditorPage[]; changed: number; fittedPages: number } {
  const result = clone(pages),
    palette = beautyThemes[theme];
  const byBlock = new Map(blocks.map((block) => [block.id, block]));
  let changed = 0,
    fittedPages = 0;
  for (const page of result) {
    const originals = new Map(clone(page.elements).map((e) => [e.id, e]));
    const protectedIds = new Set(page.elements.filter((e) => e.locked).map((e) => e.id));
    for (const e of page.elements) {
      if (e.rowAnchorId && (e.locked || protectedIds.has(e.rowAnchorId))) {
        protectedIds.add(e.rowAnchorId);
        page.elements
          .filter((child) => child.rowAnchorId === e.rowAnchorId)
          .forEach((child) => protectedIds.add(child.id));
      }
    }
    const texts = page.elements.filter(
      (e) =>
        e.type === 'text' &&
        !protectedIds.has(e.id) &&
        e.rotation === 0 &&
        (!selection || selection.has(e.id)) &&
        textOf(e).trim(),
    );
    if (!texts.length) continue;
    const bodySize = Math.max(
      9,
      Math.min(
        11,
        median(
          texts.filter((e) => textOf(e).length > 40).map((e) => e.fontSize),
          median(
            texts.map((e) => e.fontSize),
            10.5,
          ),
        ),
      ),
    );
    const lineHeight = Math.max(
      1.25,
      Math.min(
        1.5,
        median(
          texts.filter((e) => textOf(e).length > 40).map((e) => e.lineHeight),
          1.35,
        ),
      ),
    );
    const roles = new Map(texts.map((e) => [e.id, roleOf(e, byBlock, bodySize)]));
    for (const e of texts) {
      const role = roles.get(e.id)!;
      e.html = cleanInlineStyle(e.html);
      e.fontFamily = fontFamily;
      e.fontSize =
        role === 'title'
          ? Math.max(20, bodySize + 11)
          : role === 'heading'
            ? bodySize + 2
            : role === 'meta'
              ? Math.max(9, bodySize - 0.5)
              : bodySize;
      e.lineHeight = role === 'title' ? 1.2 : role === 'heading' ? 1.3 : lineHeight;
      e.color =
        role === 'title' || role === 'heading'
          ? palette.accent
          : role === 'meta'
            ? palette.muted
            : palette.text;
      if (role === 'title' || role === 'heading') e.bold = true;
      e.h = Math.max(4, textHeight(e) + 1);
    }
    const movable = texts.filter((e) => !e.groupId && !e.rowAnchorId && !e.rowGuide);
    arrangeRows(movable, originals, roles);
    // Bound rows keep their existing anchor position and follow its new font baseline.
    synchronizeRows(page.elements);
    const ids = new Set(texts.map((e) => e.id));
    if (createsCollision(page.elements, originals, ids)) {
      fittedPages++;
      for (const e of texts) {
        const old = originals.get(e.id)!;
        Object.assign(e, { x: old.x, y: old.y, w: old.w, h: old.h });
        const minimum = Math.min(old.fontSize, 9);
        while (e.fontSize > minimum && textHeight(e) > old.h + 1)
          e.fontSize = Math.max(minimum, e.fontSize - 0.25);
        if (textHeight(e) > old.h + 1)
          Object.assign(e, {
            fontSize: old.fontSize,
            fontFamily: old.fontFamily,
            lineHeight: old.lineHeight,
            html: old.html,
          });
      }
      synchronizeRows(page.elements);
    }
    if (!selection)
      for (const e of page.elements) {
        if (e.name === '模板页顶装饰') e.fill = palette.accent;
        if (
          e.type === 'line' &&
          !e.locked &&
          e.blockId &&
          byBlock.get(e.blockId)?.type === 'heading'
        ) {
          e.color = palette.accent;
          const heading = texts.find((text) => text.blockId === e.blockId);
          if (heading) e.y += heading.y - originals.get(heading.id)!.y;
        }
      }
    changed += texts.length;
  }
  return { pages: result, changed, fittedPages };
}

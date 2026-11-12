import { clone, escapeHtml, plainText, type Project } from '../core/model';
import { elementNode } from '../exporters/scene';
export type AIAction = 'optimize' | 'rewrite' | 'bold' | 'interview';
export interface TextRangeTarget {
  elementId: string;
  start: number;
  end: number;
  text: string;
}
export interface AITarget {
  ids: string[];
  range?: TextRangeTarget;
}
export interface SourceText {
  id: string;
  text: string;
  html: string;
  range?: TextRangeTarget;
}
export interface TextEdit {
  id: string;
  text?: string;
  phrases?: string[];
  enabled: boolean;
}

export function sourcesFor(project: Project, target?: AITarget): SourceText[] {
  return project.pages
    .flatMap((page) => page.elements)
    .filter(
      (e) =>
        e.type === 'text' &&
        !e.locked &&
        e.name !== '页码' &&
        (!target?.ids.length || target.ids.includes(e.id)),
    )
    .map((e) => ({
      id: e.id,
      text: target?.range?.elementId === e.id ? target.range.text : plainText(e.html),
      html: e.html,
      range: target?.range?.elementId === e.id ? target.range : undefined,
    }))
    .filter((source) => source.text.trim());
}
export function parseEdits(value: unknown, sources: SourceText[], action: AIAction): TextEdit[] {
  const edits = (value as { edits?: unknown })?.edits;
  if (!Array.isArray(edits)) throw Error('模型返回缺少 edits 数组，请重试');
  const seen = new Set<string>();
  const result: TextEdit[] = [];
  for (const item of edits) {
    const source = sources.find((s) => s.id === item?.id);
    if (!source || seen.has(source.id)) continue;
    seen.add(source.id);
    if (action === 'bold') {
      const phrases = Array.isArray(item.phrases)
        ? [
            ...new Set<string>(
              item.phrases.filter(
                (p: unknown): p is string =>
                  typeof p === 'string' && p.length > 0 && source.text.includes(p),
              ),
            ),
          ]
        : [];
      if (phrases.length) result.push({ id: source.id, phrases, enabled: true });
    } else if (typeof item.text === 'string' && item.text.trim() && item.text !== source.text)
      result.push({ id: source.id, text: item.text, enabled: true });
  }
  if (!result.length) throw Error('模型未提供可应用的修改，可调整要求后重试');
  return result;
}
function rangeAt(node: HTMLElement, start: number, end: number): Range {
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let offset = 0,
    first = false,
    textNode: Node | null;
  while ((textNode = walker.nextNode())) {
    const length = textNode.textContent?.length || 0;
    if (!first && start <= offset + length) {
      range.setStart(textNode, Math.max(0, start - offset));
      first = true;
    }
    if (first && end <= offset + length) {
      range.setEnd(textNode, Math.max(0, end - offset));
      return range;
    }
    offset += length;
  }
  throw Error('划选位置已变化，请重新选择文字');
}
export function editedHtml(source: SourceText, edit: TextEdit): string {
  const node = document.createElement('div');
  node.innerHTML = source.html;
  if (edit.phrases) {
    const text = source.range?.text || node.textContent || '';
    const ranges: { start: number; end: number }[] = [];
    for (const phrase of [...edit.phrases].sort((a, b) => b.length - a.length)) {
      let start = text.indexOf(phrase);
      while (start !== -1) {
        const end = start + phrase.length;
        if (!ranges.some((r) => start < r.end && end > r.start)) ranges.push({ start, end });
        start = text.indexOf(phrase, end);
      }
    }
    for (const item of ranges.sort((a, b) => b.start - a.start)) {
      const offset = source.range?.start || 0,
        range = rangeAt(node, offset + item.start, offset + item.end);
      const bold = document.createElement('b');
      bold.append(range.extractContents());
      range.insertNode(bold);
    }
  } else if (source.range) {
    const range = rangeAt(node, source.range.start, source.range.end);
    if (range.toString() !== source.range.text) throw Error('划选内容已变化，请重新选择');
    range.deleteContents();
    range.insertNode(document.createTextNode(edit.text || ''));
  } else node.innerHTML = escapeHtml(edit.text || '');
  return node.innerHTML;
}
export function applyEdits(project: Project, sources: SourceText[], edits: TextEdit[]): Project {
  const next = clone(project);
  const elements = next.pages.flatMap((p) => p.elements);
  for (const edit of edits.filter((e) => e.enabled)) {
    const source = sources.find((s) => s.id === edit.id),
      e = elements.find((e) => e.id === edit.id);
    if (!source || !e || e.locked || e.html !== source.html)
      throw Error('画布内容已变化，请重新生成建议后应用');
    e.html = editedHtml(source, edit);
    const measured = elementNode(e);
    Object.assign(measured.style, {
      left: '-20000px',
      top: '0',
      height: 'auto',
      transform: 'none',
    });
    document.body.append(measured);
    e.h = Math.max(e.h, measured.getBoundingClientRect().height + 1);
    measured.remove();
    // Stored block text is refreshed from the canvas before future template operations.
    next.blocks = next.blocks.filter((block) => block.id !== e.blockId);
  }
  return next;
}

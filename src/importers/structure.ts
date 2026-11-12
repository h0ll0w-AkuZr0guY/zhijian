import {
  element,
  escapeHtml,
  id,
  type CanvasElement,
  type ContentBlock,
  type EditorPage,
} from '../core/model';

export interface TextFragment {
  id: string;
  text: string;
  html?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  baseline?: number;
  fontSize: number;
  bold?: boolean;
  color?: string;
  blockId?: string;
  confidence?: number;
}
interface TextLine {
  fragments: TextFragment[];
  baseline: number;
  fontSize: number;
}
interface Segment {
  fragments: TextFragment[];
  text: string;
  html: string;
  x: number;
  y: number;
  w: number;
  h: number;
  fontSize: number;
  baseline: number;
  lines: number;
  lastX: number;
  lastBaseline: number;
  startsList: boolean;
}
const sections =
  /^(教育经历|教育背景|教育信息|工作经历|实习经历|研究经历|科研经历|科研成果|学术成果|论文发表|发表论文|项目经历|项目经验|专业技能|个人技能|技能特长|技术技能|个人简介|自我评价|个人优势|荣誉奖项|荣誉与其他|获奖经历|竞赛获奖|证书|联系方式|社会实践|校园经历|志愿经历|其他|education|experience|work experience|projects|skills|publications|awards|profile|summary)$/i;
const listStart = /^(?:[•●▪◦·]|\d{1,2}[.、)）])\s*/;
export const compactHeading = (text: string) =>
  text.trim().replace(/([\u3400-\u9fff])\s+(?=[\u3400-\u9fff])/g, '$1');
export const isSectionHeading = (text: string) => sections.test(compactHeading(text));
const isDate = (text: string) =>
  /^(?:19|20)\d{2}(?:[./年]\d{1,2})?.*(?:[-—–~至]|现在|今)/.test(text.trim());
const isContact = (text: string) =>
  /(?:\b1[3-9]\d{9}\b|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|github\.com|https?:\/\/|\.(?:com|cn|org|space|io)(?:\/|$))/i.test(
    text,
  );

function bounds(fragments: TextFragment[]) {
  const x = Math.min(...fragments.map((item) => item.x)),
    y = Math.min(...fragments.map((item) => item.y));
  return {
    x,
    y,
    w: Math.max(...fragments.map((item) => item.x + item.w)) - x,
    h: Math.max(...fragments.map((item) => item.y + item.h)) - y,
  };
}
function joinInline(fragments: TextFragment[]): { text: string; html: string } {
  let text = '',
    html = '';
  let previous: TextFragment | undefined;
  const baseSize = Math.max(...fragments.map((fragment) => fragment.fontSize));
  for (const fragment of fragments) {
    const gap = previous ? fragment.x - previous.x - previous.w : 0;
    const separator =
      previous &&
      !/\s$/.test(text) &&
      !/^\s/.test(fragment.text) &&
      !(/[\u3400-\u9fff]$/.test(text) && /^[\u3400-\u9fff]/.test(fragment.text)) &&
      gap > ((fragment.fontSize * 96) / 72) * 0.13
        ? ' '
        : '';
    text += separator + fragment.text;
    let content = fragment.html || escapeHtml(fragment.text);
    if (fragment.fontSize < baseSize * 0.98)
      content = `<span style="font-size:${fragment.fontSize / baseSize}em">${content}</span>`;
    html += separator + (fragment.bold ? `<b>${content}</b>` : content);
    previous = fragment;
  }
  return { text: text.trim(), html: html.trim() };
}
function segment(fragments: TextFragment[], baseline: number): Segment {
  const content = joinInline(fragments),
    box = bounds(fragments);
  return {
    ...box,
    ...content,
    fragments,
    fontSize: Math.max(...fragments.map((item) => item.fontSize)),
    baseline,
    lines: 1,
    lastX: box.x,
    lastBaseline: baseline,
    startsList: listStart.test(content.text) && !!content.text.replace(listStart, '').trim(),
  };
}
function groupLines(fragments: TextFragment[]): TextLine[] {
  const lines: TextLine[] = [];
  for (const fragment of [...fragments].sort(
    (a, b) => (a.baseline ?? a.y + a.fontSize) - (b.baseline ?? b.y + b.fontSize) || a.x - b.x,
  )) {
    const baseline = fragment.baseline ?? fragment.y + ((fragment.fontSize * 96) / 72) * 0.9;
    const tolerance = Math.max(2.2, ((fragment.fontSize * 96) / 72) * 0.24);
    const line = lines
      .filter((item) => Math.abs(item.baseline - baseline) <= tolerance)
      .sort((a, b) => Math.abs(a.baseline - baseline) - Math.abs(b.baseline - baseline))[0];
    if (line) {
      line.fragments.push(fragment);
      line.fontSize = Math.max(line.fontSize, fragment.fontSize);
    } else lines.push({ fragments: [fragment], baseline, fontSize: fragment.fontSize });
  }
  return lines.sort((a, b) => a.baseline - b.baseline);
}
function fieldsInLine(line: TextLine): Segment[] {
  const parts: TextFragment[][] = [];
  for (const fragment of [...line.fragments].sort((a, b) => a.x - b.x)) {
    const previous = parts.at(-1)?.at(-1);
    const gap = previous ? fragment.x - previous.x - previous.w : 0;
    const marker = parts
      .at(-1)
      ?.map((item) => item.text)
      .join('')
      .trim();
    const threshold = Math.max(7, ((fragment.fontSize * 96) / 72) * 0.6);
    if (
      !previous ||
      (gap > threshold &&
        !(marker && listStart.test(marker) && marker.length < 5 && gap < threshold * 3))
    )
      parts.push([fragment]);
    else parts.at(-1)!.push(fragment);
  }
  return parts.map((part) => segment(part, line.baseline));
}
function canContinue(previous: Segment, current: Segment): boolean {
  const pixels = (Math.max(previous.fontSize, current.fontSize) * 96) / 72;
  const step = current.baseline - previous.lastBaseline;
  const xTolerance = previous.startsList ? pixels * 2.2 : pixels * 0.7;
  return (
    !current.startsList &&
    !isSectionHeading(current.text) &&
    !isContact(current.text) &&
    !isDate(current.text) &&
    !/^(技术栈|技术环境|工作内容|项目名称)[：:]/.test(current.text) &&
    (previous.startsList || previous.text.length > 35) &&
    !/[。！？!?；;]$/.test(previous.text) &&
    Math.abs(current.x - previous.lastX) <= xTolerance &&
    current.x < previous.x + previous.w * 0.65 &&
    step > pixels * 0.62 &&
    step < pixels * 1.62 &&
    Math.min(previous.fontSize, current.fontSize) / Math.max(previous.fontSize, current.fontSize) >
      0.86
  );
}
function appendContinuation(previous: Segment, current: Segment): void {
  const space = /[A-Za-z0-9]$/.test(previous.text) && /^[A-Za-z0-9]/.test(current.text) ? ' ' : '';
  previous.text += space + current.text;
  previous.html += space + current.html;
  previous.fragments.push(...current.fragments);
  Object.assign(previous, bounds(previous.fragments));
  previous.lastX = current.x;
  previous.lastBaseline = current.baseline;
  previous.lines++;
}
function plain(html: string): string {
  if (typeof document === 'undefined') return html.replace(/<[^>]*>/g, '');
  const node = document.createElement('div');
  node.innerHTML = html.replace(/<br\s*\/?\s*>/gi, '\n').replace(/<\/div>/gi, '\n');
  return node.textContent || '';
}

/** Recover editable paragraph boxes, while retaining independent fields in aligned rows. */
export function reconstructText(
  fragments: TextFragment[],
  pageNumber: number,
): { elements: CanvasElement[]; blocks: ContentBlock[] } {
  if (!fragments.length) return { elements: [], blocks: [] };
  const lines = groupLines(fragments.filter((item) => item.text.trim()));
  const sizes = fragments.map((item) => item.fontSize).sort((a, b) => a - b),
    bodySize = sizes[Math.floor(sizes.length / 2)] || 10.5;
  const paragraphs: Segment[] = [],
    rows: Segment[][] = [];
  for (const line of lines) {
    const fields = fieldsInLine(line);
    const contactRow = line.baseline < 260 && fields.some((field) => isContact(field.text));
    // A same-baseline row of short fields represents metadata, not a vertical list.
    if (
      fields.length > 1 &&
      (contactRow || !fields.some((field) => field.startsList)) &&
      fields.every((field) => field.text.length < 160) &&
      (fields.every((field) => field.text.length < 90) || fields[0].w < 180)
    ) {
      rows.push(fields);
      continue;
    }
    for (const field of fields) {
      const previous = [...paragraphs].reverse().find((candidate) => canContinue(candidate, field));
      if (previous) appendContinuation(previous, field);
      else paragraphs.push(field);
    }
  }
  const entries = [...paragraphs.map((part) => [part]), ...rows].sort(
    (a, b) => a[0].y - b[0].y || a[0].x - b[0].x,
  );
  const result: CanvasElement[] = [],
    blocks: ContentBlock[] = [];
  let section = '基本信息',
    hasTitle = false;
  for (const fields of entries) {
    const isHeader = section === '基本信息';
    const text = fields
        .filter((field) => !isHeader || !/^[·|｜]$/.test(field.text))
        .map((field) => (isHeader ? field.text.replace(/^[·|｜]\s*/, '') : field.text))
        .join(isHeader ? ' · ' : ' ｜ '),
      compact = compactHeading(text);
    const heading = fields.length === 1 && isSectionHeading(compact);
    const title =
      !hasTitle &&
      fields.length === 1 &&
      fields[0].fontSize >= bodySize * 1.3 &&
      text.length < 60 &&
      fields[0].y < 260;
    if (title) hasTitle = true;
    if (heading) section = compact;
    const blockId =
      fields[0].fragments[0].blockId &&
      fields.every((field) =>
        field.fragments.every((fragment) => fragment.blockId === fields[0].fragments[0].blockId),
      )
        ? fields[0].fragments[0].blockId!
        : id();
    const dateField = fields.find((field) => isDate(field.text));
    const role =
      dateField && fields.length > 1
        ? 'entry'
        : !heading && !title && section === '基本信息'
          ? 'contact'
          : undefined;
    const confidence = fields
      .flatMap((field) => field.fragments)
      .map((fragment) => fragment.confidence)
      .filter((value): value is number => value !== undefined);
    const block: ContentBlock = {
      id: blockId,
      type: title || heading ? 'heading' : fields[0].startsList ? 'list' : 'paragraph',
      level: title ? 1 : 2,
      text: title || heading ? compact : text,
      html: fields.map((field) => field.html).join(' ｜ '),
      sourcePage: pageNumber,
      section,
      role,
      fields: role === 'entry' ? fields.map((field) => field.text) : undefined,
      sourceBounds: bounds(fields.flatMap((field) => field.fragments)),
      confidence: confidence.length
        ? confidence.reduce((sum, value) => sum + value, 0) / confidence.length
        : undefined,
    };
    for (const part of fields) {
      const pixels = (part.fontSize * 96) / 72;
      const lineHeight =
        part.lines > 1
          ? Math.max(1.1, (part.lastBaseline - part.baseline) / (part.lines - 1) / pixels)
          : 1.22;
      const width = part.w + Math.max(2, pixels * 0.18);
      const e = element('text', {
        id: part.fragments[0].id,
        x: part.x,
        y: part.y,
        w: width,
        h: Math.max(part.h, part.lines * pixels * lineHeight),
        fontSize: part.fontSize,
        lineHeight,
        html: title || heading ? escapeHtml(compact) : part.html,
        bold: title || heading,
        color: part.fragments[0].color || '#263b30',
        whiteSpace: 'pre-wrap',
        blockId,
        name: part.text.slice(0, 35),
        hangingIndent:
          part.startsList && part.lines > 1 ? Math.max(0, part.lastX - part.x) : undefined,
      });
      result.push(e);
    }
    block.sourceElementIds = result.filter((e) => e.blockId === blockId).map((e) => e.id);
    blocks.push(block);
  }
  return { elements: result, blocks };
}
export function reconstructPages(
  pages: EditorPage[],
  previous: ContentBlock[] = [],
): { pages: EditorPage[]; blocks: ContentBlock[] } {
  const result: EditorPage[] = [],
    blocks: ContentBlock[] = [];
  const original = new Map(previous.map((block) => [block.id, block]));
  pages.forEach((page, index) => {
    const fragments = page.elements
      .filter((e) => e.type === 'text' && e.name !== '页码' && e.rotation === 0)
      .map((e) => ({
        id: e.id,
        text: plain(e.html),
        html: e.html,
        x: e.x,
        y: e.y,
        w: e.w,
        h: e.h,
        fontSize: e.fontSize,
        bold: e.bold,
        color: e.color,
        blockId: e.blockId,
      }));
    const reconstructed = reconstructText(fragments, index + 1);
    const existing = new Map(page.elements.map((e) => [e.id, e]));
    reconstructed.elements = reconstructed.elements.map((e) => {
      const old = existing.get(e.id);
      if (!old) return e;
      if (plain(old.html).trim() === plain(e.html).trim()) return { ...old, blockId: e.blockId };
      return {
        ...e,
        fontFamily: old.fontFamily,
        groupId: old.groupId,
        locked: old.locked,
        rowGuide: old.rowGuide,
        rowAnchorId: old.rowAnchorId,
      };
    });
    const retained = page.elements.filter(
      (e) => e.type !== 'text' || e.name === '页码' || e.rotation !== 0,
    );
    for (const e of retained.filter((e) => e.type === 'image')) {
      const portrait = e.x > 470 && e.y < 250 && e.h < 230 && e.w / e.h > 0.4 && e.w / e.h < 1.3;
      const blockId = e.blockId || id();
      e.blockId = blockId;
      reconstructed.blocks.push({
        id: blockId,
        type: 'image',
        text: portrait ? '证件照' : '图片',
        src: e.src,
        sourcePage: index + 1,
        role: portrait ? 'portrait' : undefined,
        sourceBounds: { x: e.x, y: e.y, w: e.w, h: e.h },
      });
    }
    for (const block of reconstructed.blocks) {
      const old = original.get(block.id);
      if (old?.type === 'list' && block.text.replace(/^[•●▪◦·]\s*/, '') === old.text)
        block.text = old.text;
      if (old && old.text === block.text) {
        block.markdown = old.markdown;
        block.type = old.type;
        block.level = old.level;
        block.confidence = old.confidence;
      }
    }
    result.push({ ...page, elements: [...retained, ...reconstructed.elements] });
    blocks.push(...reconstructed.blocks);
  });
  return { pages: result, blocks: normalizeContent(readingOrder(blocks)) };
}
export function readingOrder(blocks: ContentBlock[]): ContentBlock[] {
  return [...blocks].sort((a, b) => {
    if (a.sourceBounds && b.sourceBounds && a.sourcePage === b.sourcePage)
      return a.sourceBounds.y - b.sourceBounds.y || a.sourceBounds.x - b.sourceBounds.x;
    return (a.sourcePage || 1) - (b.sourcePage || 1);
  });
}
export function normalizeContent(blocks: ContentBlock[]): ContentBlock[] {
  let section = '基本信息';
  return blocks.map((block) => {
    const text = compactHeading(block.text);
    if (isSectionHeading(text)) {
      section = text;
      return {
        ...block,
        type: 'heading' as const,
        level: 2,
        text,
        html: escapeHtml(text),
        section,
      };
    }
    if (block.type === 'heading' && (block.level || 2) > 1) section = block.text;
    return {
      ...block,
      fields: block.role === 'entry' ? block.text.split(/\s*｜\s*/) : block.fields,
      section: block.section || section,
    };
  });
}
export function mergeTextElements(elements: CanvasElement[]): CanvasElement {
  const sorted = [...elements].sort((a, b) => a.y - b.y || a.x - b.x),
    first = sorted[0];
  const fragments = sorted.map((e) => ({
    id: e.id,
    text: plain(e.html),
    html: e.html,
    x: e.x,
    y: e.y,
    w: e.w,
    h: e.h,
    fontSize: e.fontSize,
    bold: e.bold,
  }));
  const lines = groupLines(fragments).map((line) =>
    joinInline(line.fragments.sort((a, b) => a.x - b.x)),
  );
  return {
    ...first,
    ...bounds(fragments),
    html: lines.map((line) => line.html).join('<br>'),
    whiteSpace: 'pre-wrap',
    blockId: id(),
    name: lines
      .map((line) => line.text)
      .join(' ')
      .slice(0, 35),
  };
}

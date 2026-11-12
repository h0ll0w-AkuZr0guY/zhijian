import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { id, escapeHtml, type ContentBlock } from '../core/model';

interface Node {
  type: string;
  value?: string;
  depth?: number;
  url?: string;
  children?: Node[];
  position?: { start: { offset: number }; end: { offset: number } };
}
function textOf(node: Node): string {
  return (
    node.value ||
    (node.children || [])
      .map(textOf)
      .join(node.type === 'tableRow' ? ' | ' : node.type === 'list' ? '\n' : '')
  );
}
function inline(node: Node): string {
  const body = node.value ? escapeHtml(node.value) : (node.children || []).map(inline).join('');
  if (node.type === 'strong') return `<b>${body}</b>`;
  if (node.type === 'emphasis') return `<i>${body}</i>`;
  if (node.type === 'delete') return `<span style="text-decoration:line-through">${body}</span>`;
  return body;
}
export function parseMarkdown(markdown: string): ContentBlock[] {
  const root = unified().use(remarkParse).use(remarkGfm).parse(markdown) as Node;
  const blocks: ContentBlock[] = [];
  const original = (node: Node) =>
    node.position
      ? markdown.slice(node.position.start.offset, node.position.end.offset)
      : undefined;
  for (const node of root.children || []) {
    if (node.type === 'list') {
      for (const child of node.children || [])
        blocks.push({
          id: id(),
          type: 'list',
          text: textOf(child),
          html: inline(child),
          markdown: original(child),
        });
    } else if (node.type === 'table') {
      blocks.push({
        id: id(),
        type: 'table',
        text: (node.children || []).map(textOf).join('\n'),
        markdown: original(node),
      });
    } else if (node.type === 'image' && node.url?.startsWith('data:image/')) {
      blocks.push({ id: id(), type: 'image', text: node.value || '图片', src: node.url });
    } else if (
      node.type !== 'html' &&
      node.type !== 'thematicBreak' &&
      node.type !== 'definition'
    ) {
      const text = textOf(node).trim();
      if (text)
        blocks.push({
          id: id(),
          type: node.type === 'heading' ? 'heading' : 'paragraph',
          level: node.depth,
          text,
          html: inline(node),
          markdown: original(node),
        });
    }
  }
  return blocks;
}
export function toMarkdown(blocks: ContentBlock[]): string {
  return (
    blocks
      .map((block) => {
        if (block.markdown) return block.markdown;
        if (block.type === 'heading')
          return `${'#'.repeat(Math.min(6, Math.max(1, block.level || 2)))} ${block.text}`;
        if (block.type === 'list') return `- ${block.text}`;
        if (block.type === 'image') return block.src ? `![${block.text}](${block.src})` : '';
        return block.text;
      })
      .join('\n\n') + '\n'
  );
}

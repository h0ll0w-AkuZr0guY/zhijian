import { PAGE_HEIGHT, PAGE_WIDTH, type CanvasElement, type EditorPage } from '../core/model';

import { shapeNode } from '../core/shapes';

export function elementNode(e: CanvasElement): HTMLDivElement {
  const node = document.createElement('div');
  node.dataset.elementId = e.id;
  Object.assign(node.style, {
    position: 'absolute',
    boxSizing: 'border-box',
    left: e.x + 'px',
    top: e.y + 'px',
    width: e.w + 'px',
    height: e.h + 'px',
    transform: `rotate(${e.rotation}deg)`,
    opacity: String(e.opacity / 100),
    color: e.color,
    background: e.fill,
    border: `${e.strokeWidth}px ${e.dash || 'solid'} ${e.color}`,
    borderRadius: e.type === 'ellipse' ? '50%' : e.radius + 'px',
    fontFamily: e.fontFamily,
    fontSize: (e.fontSize * 96) / 72 + 'px',
    lineHeight: String(e.lineHeight),
    fontWeight: e.bold ? '700' : '400',
    fontStyle: e.italic ? 'italic' : 'normal',
    textDecoration: e.underline ? 'underline' : 'none',
    textAlign: e.textAlign,
    whiteSpace: e.whiteSpace || 'pre-wrap',
    overflowWrap: 'break-word',
    letterSpacing: (e.letterSpacing || 0) + 'px',
  });
  if (e.type === 'text') node.innerHTML = e.html;
  if (e.type === 'text' && e.hangingIndent) {
    node.style.paddingLeft = e.hangingIndent + 'px';
    node.style.textIndent = -e.hangingIndent + 'px';
  }
  if (e.type === 'image' && e.src) {
    const image = new Image();
    image.src = e.src;
    Object.assign(image.style, {
      width: '100%',
      height: '100%',
      display: 'block',
      objectFit: e.objectFit || 'cover',
      objectPosition: e.objectPosition || 'center',
    });
    node.append(image);
  }
  if (
    e.type === 'line' ||
    e.type === 'shape' ||
    (e.type === 'rect' && (e.radius || e.cornerRadii))
  ) {
    node.style.background = 'transparent';
    node.style.border = 'none';
    node.append(shapeNode(e));
  }
  return node;
}
export function pageNode(page: EditorPage): HTMLDivElement {
  const node = document.createElement('div');
  node.className = 'export-page';
  Object.assign(node.style, {
    position: 'relative',
    width: PAGE_WIDTH + 'px',
    height: PAGE_HEIGHT + 'px',
    background: page.background,
    overflow: 'hidden',
    flexShrink: '0',
  });
  for (const e of page.elements) node.append(elementNode(e));
  return node;
}
export function download(data: BlobPart, filename: string, type: string): void {
  const a = document.createElement('a'),
    url = URL.createObjectURL(new Blob([data], { type }));
  a.href = url;
  a.download = filename.replace(/[\\/:*?"<>|]/g, '_');
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 15000);
}
export async function pagePng(page: EditorPage): Promise<Blob> {
  const { toBlob } = await import('html-to-image');
  const node = pageNode(page);
  const host = document.createElement('div');
  Object.assign(host.style, { position: 'fixed', left: '-20000px', top: '0' });
  host.append(node);
  document.body.append(host);
  try {
    await document.fonts.ready;
    await Promise.all([...node.querySelectorAll('img')].map((image) => image.decode()));
    const blob = await toBlob(node, {
      pixelRatio: 2,
      cacheBust: false,
      style: { position: 'relative', left: '0', top: '0' },
    });
    if (!blob) throw Error('图片生成失败');
    return blob;
  } finally {
    host.remove();
  }
}

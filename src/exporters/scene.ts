import { PAGE_HEIGHT, PAGE_WIDTH, type CanvasElement, type EditorPage } from '../core/model';

export const shapePaths: Record<string, string> = {
  triangle: 'M50 2 L98 98 H2 Z',
  diamond: 'M50 2 L98 50 L50 98 L2 50 Z',
  pentagon: 'M50 2 L98 38 L80 98 H20 L2 38 Z',
  hexagon: 'M26 2 H74 L98 50 L74 98 H26 L2 50 Z',
  star: 'M50 2 L62 36 L98 37 L70 59 L80 96 L50 75 L20 96 L30 59 L2 37 L38 36 Z',
  arrow: 'M2 28 H60 V2 L98 50 L60 98 V72 H2 Z',
  chevron: 'M2 2 H55 L98 50 L55 98 H2 L45 50 Z',
  parallelogram: 'M26 2 H98 L74 98 H2 Z',
};
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
  if (e.type === 'line') {
    node.style.background = 'transparent';
    node.style.border = 'none';
    node.style.borderTop = `${e.h}px ${e.dash || 'solid'} ${e.color}`;
  }
  if (e.type === 'shape' && e.shape && shapePaths[e.shape]) {
    node.style.background = 'transparent';
    node.style.border = 'none';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.style.width = '100%';
    svg.style.height = '100%';
    const path = document.createElementNS(svg.namespaceURI, 'path');
    path.setAttribute('d', shapePaths[e.shape]);
    path.setAttribute('fill', e.fill);
    path.setAttribute('stroke', e.color);
    path.setAttribute('stroke-width', String(e.strokeWidth));
    path.setAttribute('vector-effect', 'non-scaling-stroke');
    if (e.dash === 'dashed') path.setAttribute('stroke-dasharray', '8 5');
    if (e.dash === 'dotted') path.setAttribute('stroke-dasharray', '2 4');
    svg.append(path);
    node.append(svg);
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

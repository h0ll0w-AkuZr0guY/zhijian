import type { CanvasElement } from './model';

export function applyTextStyle(node: HTMLElement, e: CanvasElement): void {
  Object.assign(node.style, {
    color: e.color,
    fontFamily: e.fontFamily,
    fontSize: `${(e.fontSize * 96) / 72}px`,
    lineHeight: String(e.lineHeight),
    fontWeight: e.bold ? '700' : '400',
    fontStyle: e.italic ? 'italic' : 'normal',
    textDecoration: e.underline ? 'underline' : 'none',
    textAlign: e.textAlign,
    whiteSpace: e.whiteSpace || 'pre-wrap',
    overflowWrap: 'break-word',
    letterSpacing: `${e.letterSpacing || 0}px`,
  });
}

export function textContentNode(e: CanvasElement): HTMLDivElement {
  const content = document.createElement('div');
  content.className = 'content';
  content.innerHTML = e.html;
  content.style.minHeight = '1em';
  if (e.hangingIndent) {
    content.style.paddingLeft = `${e.hangingIndent}px`;
    content.style.textIndent = `${-e.hangingIndent}px`;
  }
  return content;
}

export function fitTextHeights(elements: CanvasElement[]): void {
  if (!elements.length) return;
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-25000px;top:0;visibility:hidden;pointer-events:none';
  const boxes = elements.map((e) => {
    const box = document.createElement('div');
    applyTextStyle(box, e);
    Object.assign(box.style, {
      boxSizing: 'border-box',
      width: `${e.w}px`,
      border: `${e.strokeWidth}px ${e.dash || 'solid'} ${e.color}`,
    });
    box.append(textContentNode(e));
    host.append(box);
    return box;
  });
  document.body.append(host);
  try {
    elements.forEach((e, index) => {
      const box = boxes[index];
      const style = getComputedStyle(box);
      const borders = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
      e.h = Math.max(10, box.getBoundingClientRect().height, box.scrollHeight + borders);
    });
  } finally {
    host.remove();
  }
}

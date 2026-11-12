import {
  clone,
  id,
  MM,
  PAGE_HEIGHT,
  PAGE_WIDTH,
  type CanvasElement,
  type EditorPage,
} from '../core/model';

function bounds(e: CanvasElement): { left: number; right: number; top: number; bottom: number } {
  const angle = (e.rotation * Math.PI) / 180;
  const width = Math.abs(e.w * Math.cos(angle)) + Math.abs(e.h * Math.sin(angle));
  const height = Math.abs(e.h * Math.cos(angle)) + Math.abs(e.w * Math.sin(angle));
  return {
    left: e.x + (e.w - width) / 2,
    right: e.x + (e.w + width) / 2,
    top: e.y + (e.h - height) / 2,
    bottom: e.y + (e.h + height) / 2,
  };
}

/** Stack occupied page areas and fit the complete scene onto one physical A4 sheet. */
export function fitOnePage(
  pages: EditorPage[],
  marginMm = 10,
): { page: EditorPage; scale: number; minimumFont: number } {
  const all: CanvasElement[] = [];
  let cursor = 0;
  const decorationNames = new Set(['模板页顶装饰', '模板侧栏背景', '页码']);
  for (const page of clone(pages)) {
    const elements = page.elements.filter((e) => !decorationNames.has(e.name || ''));
    if (!elements.length) continue;
    const top = Math.min(...elements.map((e) => bounds(e).top));
    const bottom = Math.max(...elements.map((e) => bounds(e).bottom));
    elements.forEach((e) => (e.y += cursor - top));
    all.push(...elements);
    cursor += bottom - top + 12;
  }
  const margin = marginMm * MM;
  const left = Math.min(...all.map((e) => bounds(e).left), margin);
  const right = Math.max(...all.map((e) => bounds(e).right), left + 1);
  const height = Math.max(1, cursor - 12);
  const scale = Math.min(
    1,
    (PAGE_WIDTH - 2 * margin) / (right - left),
    (PAGE_HEIGHT - 2 * margin) / height,
  );
  for (const e of all) {
    e.x = margin + (e.x - left) * scale;
    e.y = margin + e.y * scale;
    e.w *= scale;
    e.h *= scale;
    e.fontSize *= scale;
    e.strokeWidth *= scale;
    e.radius *= scale;
    if (e.hangingIndent) e.hangingIndent *= scale;
    if (e.letterSpacing) e.letterSpacing *= scale;
    e.html = e.html.replace(
      /(font-size\s*:\s*)([\d.]+)(px|pt)/gi,
      (_, prefix, size, unit) => prefix + Number(size) * scale + unit,
    );
  }
  const fonts = all.filter((e) => e.type === 'text').map((e) => e.fontSize);
  const decoration = clone(
    pages[0]?.elements.filter((e) => ['模板页顶装饰', '模板侧栏背景'].includes(e.name || '')) || [],
  );
  return {
    page: {
      id: pages[0]?.id || id(),
      background: pages[0]?.background || '#ffffff',
      elements: [...decoration, ...all],
    },
    scale,
    minimumFont: fonts.length ? Math.min(...fonts) : 0,
  };
}

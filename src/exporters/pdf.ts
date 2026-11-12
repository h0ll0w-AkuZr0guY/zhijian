import {
  PDFDocument,
  rgb,
  pushGraphicsState,
  popGraphicsState,
  concatTransformationMatrix,
  type PDFPage,
  type PDFFont,
} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { PAGE_HEIGHT, type CanvasElement, type EditorPage } from '../core/model';
import { elementNode, shapePaths } from './scene';

let regularBytes: Promise<ArrayBuffer> | undefined, boldBytes: Promise<ArrayBuffer> | undefined;
async function fontBytes(bold = false): Promise<ArrayBuffer> {
  const path = new URL(
    `fonts/NotoSansSC-${bold ? 'Bold' : 'Regular'}.ttf`,
    new URL(import.meta.env.BASE_URL, location.href),
  ).href;
  const load = () =>
    fetch(path).then((response) => {
      if (!response.ok) throw Error('中文字体下载失败，请重试');
      return response.arrayBuffer();
    });
  if (bold) return (boldBytes ||= load());
  return (regularBytes ||= load());
}
function color(css: string) {
  const canvas = document.createElement('canvas'),
    ctx = canvas.getContext('2d')!;
  ctx.fillStyle = css;
  ctx.fillRect(0, 0, 1, 1);
  const values = ctx.getImageData(0, 0, 1, 1).data;
  return rgb(values[0] / 255, values[1] / 255, values[2] / 255);
}
function startElement(page: PDFPage, e: CanvasElement) {
  const radians = (e.rotation * Math.PI) / 180,
    c = Math.cos(radians),
    s = Math.sin(radians);
  const x = e.x + e.w / 2 - (c * e.w) / 2 + (s * e.h) / 2,
    y = e.y + e.h / 2 - (s * e.w) / 2 - (c * e.h) / 2;
  page.pushOperators(
    pushGraphicsState(),
    concatTransformationMatrix(
      0.75 * c,
      -0.75 * s,
      -0.75 * s,
      -0.75 * c,
      0.75 * x,
      0.75 * (PAGE_HEIGHT - y),
    ),
  );
}
async function drawText(page: PDFPage, e: CanvasElement, regular: PDFFont, bold: PDFFont) {
  const node = elementNode(e);
  Object.assign(node.style, { left: '0px', top: '0px', position: 'relative', transform: 'none' });
  const host = document.createElement('div');
  Object.assign(host.style, { position: 'fixed', left: '-20000px', top: '0', width: e.w + 'px' });
  host.append(node);
  document.body.append(host);
  try {
    const origin = node.getBoundingClientRect(),
      walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    let textNode: Node | null;
    while ((textNode = walker.nextNode())) {
      const style = getComputedStyle(textNode.parentElement!),
        font = Number(style.fontWeight) >= 600 ? bold : regular;
      const size = parseFloat(style.fontSize),
        fill = color(style.color);
      let offset = 0;
      for (const char of Array.from(textNode.textContent || '')) {
        const range = document.createRange();
        range.setStart(textNode, offset);
        offset += char.length;
        range.setEnd(textNode, offset);
        if (char === '\n' || char === '\r') continue;
        const rect = range.getBoundingClientRect();
        if (!rect.width || !rect.height) continue;
        const x = rect.x - origin.x,
          y = rect.y - origin.y + size * 0.9;
        page.pushOperators(pushGraphicsState(), concatTransformationMatrix(1, 0, 0, -1, x, y));
        page.drawText(char, { x: 0, y: 0, size, font, color: fill, opacity: e.opacity / 100 });
        page.pushOperators(popGraphicsState());
        if (e.underline || style.textDecorationLine.includes('underline'))
          page.drawLine({
            start: { x, y: y + 2 },
            end: { x: x + rect.width, y: y + 2 },
            thickness: 0.6,
            color: fill,
            opacity: e.opacity / 100,
          });
      }
    }
  } finally {
    host.remove();
  }
}
async function rasterImage(e: CanvasElement): Promise<string> {
  const image = new Image();
  image.src = e.src!;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(e.w * 2));
  canvas.height = Math.max(1, Math.ceil(e.h * 2));
  const ctx = canvas.getContext('2d')!;
  const cover = e.objectFit !== 'contain' && e.objectFit !== 'fill';
  const ratio =
    e.objectFit === 'fill'
      ? 0
      : cover
        ? Math.max(canvas.width / image.width, canvas.height / image.height)
        : Math.min(canvas.width / image.width, canvas.height / image.height);
  const w = ratio ? image.width * ratio : canvas.width,
    h = ratio ? image.height * ratio : canvas.height;
  ctx.drawImage(image, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
  return canvas.toDataURL('image/png');
}
export async function exportPdf(
  pages: EditorPage[],
  progress: (message: string) => void,
): Promise<Uint8Array> {
  progress('正在准备中文字体');
  await document.fonts.ready;
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  pdf.setCreator('纸间');
  pdf.setProducer('纸间 · 浏览器本地导出');
  const regular = await pdf.embedFont(await fontBytes(), { subset: true });
  const hasBold = pages.some((p) =>
    p.elements.some(
      (e) => e.type === 'text' && (e.bold || /<b|font-weight:\s*(bold|[6-9]00)/.test(e.html)),
    ),
  );
  const bold = hasBold ? await pdf.embedFont(await fontBytes(true), { subset: true }) : regular;
  for (let index = 0; index < pages.length; index++) {
    progress(`正在生成 PDF 第 ${index + 1} / ${pages.length} 页`);
    const source = pages[index],
      page = pdf.addPage([(210 * 72) / 25.4, (297 * 72) / 25.4]);
    page.drawRectangle({
      x: 0,
      y: 0,
      width: page.getWidth(),
      height: page.getHeight(),
      color: color(source.background),
    });
    // Clip the output to the same physical A4 boundary as the editor.
    for (const e of source.elements) {
      startElement(page, e);
      const border = {
        borderColor: color(e.color),
        borderWidth: e.strokeWidth,
        borderOpacity: e.opacity / 100,
        borderDashArray: e.dash === 'dashed' ? [8, 5] : e.dash === 'dotted' ? [2, 4] : undefined,
      };
      if (e.type === 'text') {
        if (e.fill !== 'transparent' || e.strokeWidth)
          page.drawRectangle({
            x: 0,
            y: 0,
            width: e.w,
            height: e.h,
            color: e.fill === 'transparent' ? undefined : color(e.fill),
            opacity: e.opacity / 100,
            ...border,
          });
        await drawText(page, e, regular, bold);
      } else if (e.type === 'image' && e.src) {
        const image = await pdf.embedPng(await rasterImage(e));
        page.pushOperators(pushGraphicsState(), concatTransformationMatrix(1, 0, 0, -1, 0, e.h));
        page.drawImage(image, { x: 0, y: 0, width: e.w, height: e.h, opacity: e.opacity / 100 });
        page.pushOperators(popGraphicsState());
        if (e.strokeWidth) page.drawRectangle({ x: 0, y: 0, width: e.w, height: e.h, ...border });
      } else if (e.type === 'line')
        page.drawLine({
          start: { x: 0, y: e.h / 2 },
          end: { x: e.w, y: e.h / 2 },
          color: color(e.color),
          thickness: e.h,
          opacity: e.opacity / 100,
          dashArray: border.borderDashArray,
        });
      else if (e.type === 'ellipse')
        page.drawEllipse({
          x: e.w / 2,
          y: e.h / 2,
          xScale: e.w / 2,
          yScale: e.h / 2,
          color: e.fill === 'transparent' ? undefined : color(e.fill),
          opacity: e.opacity / 100,
          ...border,
        });
      else if (e.type === 'shape' && e.shape && shapePaths[e.shape]) {
        page.pushOperators(
          pushGraphicsState(),
          concatTransformationMatrix(e.w / 100, 0, 0, -e.h / 100, 0, 0),
        );
        page.drawSvgPath(shapePaths[e.shape], {
          x: 0,
          y: 0,
          color: e.fill === 'transparent' ? undefined : color(e.fill),
          opacity: e.opacity / 100,
          ...border,
          borderWidth: (e.strokeWidth * 100) / Math.max(e.w, e.h),
        });
        page.pushOperators(popGraphicsState());
      } else if (e.type === 'rect') {
        if (e.radius) {
          const r = Math.min(e.radius, e.w / 2, e.h / 2),
            path = `M${r} 0 H${e.w - r} Q${e.w} 0 ${e.w} ${r} V${e.h - r} Q${e.w} ${e.h} ${e.w - r} ${e.h} H${r} Q0 ${e.h} 0 ${e.h - r} V${r} Q0 0 ${r} 0 Z`;
          page.pushOperators(pushGraphicsState(), concatTransformationMatrix(1, 0, 0, -1, 0, 0));
          page.drawSvgPath(path, {
            x: 0,
            y: 0,
            color: e.fill === 'transparent' ? undefined : color(e.fill),
            opacity: e.opacity / 100,
            ...border,
          });
          page.pushOperators(popGraphicsState());
        } else
          page.drawRectangle({
            x: 0,
            y: 0,
            width: e.w,
            height: e.h,
            color: e.fill === 'transparent' ? undefined : color(e.fill),
            opacity: e.opacity / 100,
            ...border,
          });
      }
      page.pushOperators(popGraphicsState());
    }
  }
  return pdf.save();
}

import {
  PDFDocument,
  rgb,
  pushGraphicsState,
  popGraphicsState,
  concatTransformationMatrix,
  beginMarkedContent,
  endMarkedContent,
  type PDFPage,
  type PDFFont,
} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { subsetFont } from './fonts';
import {
  PAGE_HEIGHT,
  PAGE_WIDTH,
  plainText,
  type CanvasElement,
  type EditorPage,
} from '../core/model';
import { elementNode } from './scene';
import { shapeDash, shapePath } from '../core/shapes';
import { getFontEmbedCSS, toPng } from 'html-to-image';
import { TEXT_APPEARANCE_MARK } from '../core/pdf-marks';

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
async function documentFont(pages: EditorPage[], bold = false): Promise<ArrayBuffer> {
  const text = pages
    .flatMap((page) => page.elements.filter((e) => e.type === 'text').map((e) => plainText(e.html)))
    .join('');
  return subsetFont(await fontBytes(bold), text);
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
function drawSearchText(page: PDFPage, e: CanvasElement, regular: PDFFont, bold: PDFFont) {
  const node = elementNode(e);
  Object.assign(node.style, { left: '0px', top: '0px', position: 'relative', transform: 'none' });
  const host = document.createElement('div');
  Object.assign(host.style, { position: 'fixed', left: '-20000px', top: '0', width: e.w + 'px' });
  host.append(node);
  document.body.append(host);
  try {
    const origin = node.getBoundingClientRect(),
      walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    interface Run {
      text: string;
      x: number;
      y: number;
      width: number;
      size: number;
      font: PDFFont;
    }
    const runs: Run[] = [];
    let textNode: Node | null;
    while ((textNode = walker.nextNode())) {
      const style = getComputedStyle(textNode.parentElement!),
        font = Number(style.fontWeight) >= 600 ? bold : regular;
      const size = parseFloat(style.fontSize);
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
          y = rect.y - origin.y + size * 0.9,
          previous = runs.at(-1);
        if (
          previous &&
          previous.font === font &&
          previous.size === size &&
          Math.abs(previous.y - y) < 0.5 &&
          Math.abs(previous.x + previous.width - x) < 1
        ) {
          previous.text += char;
          previous.width = x + rect.width - previous.x;
        } else
          runs.push({
            text: char,
            x,
            y,
            width: rect.width,
            size,
            font,
          });
      }
    }
    for (const run of runs) {
      page.pushOperators(
        pushGraphicsState(),
        concatTransformationMatrix(1, 0, 0, -1, run.x, run.y),
      );
      page.drawText(run.text, {
        x: 0,
        y: 0,
        size: run.size,
        font: run.font,
        opacity: 0,
      });
      page.pushOperators(popGraphicsState());
    }
  } finally {
    host.remove();
  }
}
async function drawTextLayer(
  pdf: PDFDocument,
  page: PDFPage,
  elements: CanvasElement[],
  fontEmbedCSS: string,
): Promise<void> {
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-20000px;top:0;pointer-events:none';
  const clip = document.createElement('div');
  clip.style.cssText = 'position:relative;overflow:hidden';
  const layer = document.createElement('div');
  layer.style.cssText = 'position:absolute;left:0;top:0';
  layer.append(...elements.map(elementNode));
  clip.append(layer);
  host.append(clip);
  document.body.append(host);
  try {
    const origin = layer.getBoundingClientRect();
    let left = PAGE_WIDTH,
      right = 0,
      top = PAGE_HEIGHT,
      bottom = 0;
    function include(rect: DOMRect): void {
      left = Math.min(left, rect.left - origin.left);
      right = Math.max(right, rect.right - origin.left);
      top = Math.min(top, rect.top - origin.top);
      bottom = Math.max(bottom, rect.bottom - origin.top);
    }
    for (const node of layer.children) {
      include(node.getBoundingClientRect());
      const range = document.createRange();
      range.selectNodeContents(node.firstChild!);
      for (const rect of range.getClientRects()) include(rect);
    }
    // Round outwards and allow for overhanging glyphs before clipping to the sheet.
    const pad = Math.max(...elements.map((e) => e.fontSize));
    left = Math.max(0, Math.floor(left - pad));
    top = Math.max(0, Math.floor(top - pad));
    right = Math.min(Math.ceil(PAGE_WIDTH), Math.ceil(right + pad));
    bottom = Math.min(Math.ceil(PAGE_HEIGHT), Math.ceil(bottom + pad));
    const width = right - left,
      height = bottom - top;
    if (width <= 0 || height <= 0) return;
    Object.assign(clip.style, { width: width + 'px', height: height + 'px' });
    Object.assign(layer.style, { left: -left + 'px', top: -top + 'px' });
    const data = await toPng(clip, { pixelRatio: 3, fontEmbedCSS });
    const image = await pdf.embedPng(data);
    page.pushOperators(beginMarkedContent(TEXT_APPEARANCE_MARK));
    page.drawImage(image, {
      x: left * 0.75,
      y: (PAGE_HEIGHT - bottom) * 0.75,
      width: width * 0.75,
      height: height * 0.75,
    });
    page.pushOperators(endMarkedContent());
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
  const regular = await pdf.embedFont(await documentFont(pages), { subset: false });
  const hasBold = pages.some((p) =>
    p.elements.some(
      (e) => e.type === 'text' && (e.bold || /<b|font-weight:\s*(bold|[6-9]00)/.test(e.html)),
    ),
  );
  const bold = hasBold
    ? await pdf.embedFont(await documentFont(pages, true), { subset: false })
    : regular;
  const fontEmbedCSS = await getFontEmbedCSS(document.body, { preferredFontFormat: 'woff2' });
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
    const textLayer: CanvasElement[] = [];
    const flushTextLayer = async () => {
      if (!textLayer.length) return;
      await drawTextLayer(pdf, page, textLayer, fontEmbedCSS);
      for (const text of textLayer) {
        startElement(page, text);
        drawSearchText(page, text, regular, bold);
        page.pushOperators(popGraphicsState());
      }
      textLayer.length = 0;
    };
    for (const e of source.elements) {
      if (e.type === 'text') {
        textLayer.push(e);
        continue;
      }
      if (textLayer.length) await flushTextLayer();
      startElement(page, e);
      const border = {
        borderColor: color(e.color),
        borderWidth: e.strokeWidth,
        borderOpacity: e.opacity / 100,
        borderDashArray: shapeDash(e.dash),
      };
      if (e.type === 'image' && e.src) {
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
      else if (e.type === 'shape' || (e.type === 'rect' && (e.radius || e.cornerRadii))) {
        page.pushOperators(pushGraphicsState(), concatTransformationMatrix(1, 0, 0, -1, 0, 0));
        page.drawSvgPath(shapePath(e), {
          x: 0,
          y: 0,
          color: e.fill === 'transparent' ? undefined : color(e.fill),
          opacity: e.opacity / 100,
          ...border,
        });
        page.pushOperators(popGraphicsState());
      } else if (e.type === 'rect')
        page.drawRectangle({
          x: 0,
          y: 0,
          width: e.w,
          height: e.h,
          color: e.fill === 'transparent' ? undefined : color(e.fill),
          opacity: e.opacity / 100,
          ...border,
        });
      page.pushOperators(popGraphicsState());
    }
    await flushTextLayer();
  }
  return pdf.save();
}

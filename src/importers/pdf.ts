import { getDocument, GlobalWorkerOptions, OPS, Util, type PDFPageProxy } from 'pdfjs-dist';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {
  element,
  escapeHtml,
  id,
  newPage,
  PAGE_HEIGHT,
  PAGE_WIDTH,
  type ContentBlock,
  type EditorPage,
} from '../core/model';
import { OcrSession, recognizedBlocks, type Progress } from './ocr';

GlobalWorkerOptions.workerSrc = workerUrl;
export interface ImportResult {
  pages: EditorPage[];
  blocks: ContentBlock[];
  previews: string[];
  name: string;
}
const asset = (path: string) =>
  new URL(path, new URL(import.meta.env.BASE_URL, location.href)).href;

function textBlocks(
  items: { text: string; x: number; y: number; height: number; elementId: string }[],
  page: number,
): ContentBlock[] {
  const lines: { text: string; x: number; y: number; height: number; elementIds: string[] }[] = [];
  for (const item of [...items].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const previous = lines.at(-1);
    if (
      previous &&
      Math.abs(item.y - previous.y) < Math.max(3, item.height * 0.3) &&
      item.x >= previous.x &&
      item.x - previous.x < 650
    ) {
      previous.text += ' ' + item.text;
      previous.elementIds.push(item.elementId);
    } else lines.push({ ...item, elementIds: [item.elementId] });
  }
  return lines.map((line, index) => ({
    id: id(),
    type:
      index === 0 && line.height >= 17
        ? 'heading'
        : /^(教育|工作|实习|项目|研究|技能|专业|荣誉|获奖|个人|科研|联系).{0,10}$/.test(
              line.text.trim(),
            )
          ? 'heading'
          : 'paragraph',
    level: index === 0 ? 1 : 2,
    text: line.text,
    html: escapeHtml(line.text),
    sourcePage: page,
    sourceElementIds: line.elementIds,
  }));
}

async function extractImages(
  page: PDFPageProxy,
  target: EditorPage,
  scale: number,
  offsetX: number,
  offsetY: number,
): Promise<number> {
  const operators = await page.getOperatorList();
  const viewport = page.getViewport({ scale: 1 });
  let matrix = [1, 0, 0, 1, 0, 0];
  const stack: number[][] = [];
  let coverage = 0;
  for (let i = 0; i < operators.fnArray.length; i++) {
    const op = operators.fnArray[i],
      args = operators.argsArray[i] as unknown[];
    if (op === OPS.save) stack.push([...matrix]);
    else if (op === OPS.restore) matrix = stack.pop() || [1, 0, 0, 1, 0, 0];
    else if (op === OPS.transform) matrix = Util.transform(matrix, args as number[]);
    else if (op === OPS.paintImageXObject || op === OPS.paintInlineImageXObject) {
      try {
        const image =
          op === OPS.paintInlineImageXObject
            ? args[0]
            : await new Promise((resolve) => page.objs.get(String(args[0]), resolve));
        const bitmap = image as {
          width: number;
          height: number;
          bitmap?: ImageBitmap;
          data?: Uint8ClampedArray;
          kind?: number;
        };
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        if (canvas.width * canvas.height > 32_000_000) continue;
        const ctx = canvas.getContext('2d')!;
        if (bitmap.bitmap) ctx.drawImage(bitmap.bitmap, 0, 0);
        else if (bitmap.data) {
          const rgba = new Uint8ClampedArray(bitmap.width * bitmap.height * 4);
          if (bitmap.data.length === rgba.length) rgba.set(bitmap.data);
          else if (bitmap.data.length === bitmap.width * bitmap.height * 3)
            for (let p = 0, j = 0; p < bitmap.data.length; p += 3, j += 4) {
              rgba[j] = bitmap.data[p];
              rgba[j + 1] = bitmap.data[p + 1];
              rgba[j + 2] = bitmap.data[p + 2];
              rgba[j + 3] = 255;
            }
          else continue;
          ctx.putImageData(new ImageData(rgba, bitmap.width, bitmap.height), 0, 0);
        } else continue;
        const m = Util.transform(viewport.transform, matrix);
        const points = [
          [0, 0],
          [1, 0],
          [0, 1],
          [1, 1],
        ].map(([x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]);
        const xs = points.map((p) => p[0]),
          ys = points.map((p) => p[1]);
        const x = Math.min(...xs),
          y = Math.min(...ys),
          w = Math.max(...xs) - x,
          h = Math.max(...ys) - y;
        coverage += (w * h) / (viewport.width * viewport.height);
        if (w > 2 && h > 2)
          target.elements.push(
            element('image', {
              x: offsetX + x * scale,
              y: offsetY + y * scale,
              w: w * scale,
              h: h * scale,
              src: canvas.toDataURL('image/png'),
              objectFit: 'fill',
              name: 'PDF 图片',
            }),
          );
      } catch {
        /* A malformed image must not discard other editable page content. */
      }
    }
  }
  return coverage;
}

export async function importPdf(
  file: File,
  signal: AbortSignal,
  progress: Progress,
  forceOcr: boolean,
): Promise<ImportResult> {
  const loading = getDocument({
    data: await file.arrayBuffer(),
    cMapUrl: asset('pdf/cmaps/'),
    cMapPacked: true,
    standardFontDataUrl: asset('pdf/standard_fonts/'),
  });
  const onAbort = () => {
    void loading.destroy();
  };
  signal.addEventListener('abort', onAbort, { once: true });
  const ocr = new OcrSession(signal, progress);
  try {
    const pdf = await loading.promise;
    if (pdf.numPages > 50) throw Error('请将 PDF 拆分为每份 50 页以内后导入');
    const pages: EditorPage[] = [],
      blocks: ContentBlock[] = [],
      previews: string[] = [];
    for (let index = 1; index <= pdf.numPages; index++) {
      signal.throwIfAborted();
      progress(`读取 PDF 第 ${index} / ${pdf.numPages} 页`, (index - 1) / pdf.numPages);
      const source = await pdf.getPage(index),
        viewport = source.getViewport({ scale: 1 });
      const scale = Math.min(PAGE_WIDTH / viewport.width, PAGE_HEIGHT / viewport.height);
      const offsetX = (PAGE_WIDTH - viewport.width * scale) / 2,
        offsetY = (PAGE_HEIGHT - viewport.height * scale) / 2;
      const page = newPage();
      const raster = document.createElement('canvas');
      const rasterViewport = source.getViewport({
        scale: Math.min(2, 2200 / Math.max(viewport.width, viewport.height)),
      });
      raster.width = Math.ceil(rasterViewport.width);
      raster.height = Math.ceil(rasterViewport.height);
      await source.render({ canvasContext: raster.getContext('2d')!, viewport: rasterViewport })
        .promise;
      const preview = document.createElement('canvas');
      preview.width = 600;
      preview.height = Math.round((600 * raster.height) / raster.width);
      preview.getContext('2d')!.drawImage(raster, 0, 0, preview.width, preview.height);
      previews.push(preview.toDataURL('image/jpeg', 0.72));
      const content = await source.getTextContent();
      const texts = content.items.filter(
        (item): item is TextItem => 'str' in item && !!item.str.trim(),
      );
      const characterCount = texts.reduce((sum, item) => sum + item.str.trim().length, 0);
      const coverage = await extractImages(source, page, scale, offsetX, offsetY);
      if (forceOcr || characterCount < 12 || (coverage > 0.7 && characterCount < 120)) {
        const lines = await ocr.recognize(raster);
        const factor = scale / rasterViewport.scale;
        page.elements = [];
        const recognized = recognizedBlocks(lines, index);
        blocks.push(...recognized);
        lines.forEach((line, i) =>
          page.elements.push(
            element('text', {
              x: offsetX + line.x * factor,
              y: offsetY + line.y * factor,
              w: Math.max(30, line.w * factor + 5),
              h: Math.max(15, line.h * factor * 1.35),
              fontSize: Math.max(7, line.h * factor * 0.72),
              lineHeight: 1.25,
              html: escapeHtml(line.text),
              blockId: recognized[i]?.id,
              name: line.confidence < 80 ? '待校对 OCR 文字' : 'OCR 文字',
            }),
          ),
        );
      } else {
        const semantic: {
          text: string;
          x: number;
          y: number;
          height: number;
          elementId: string;
        }[] = [];
        for (const item of texts) {
          const transform = Util.transform(viewport.transform, item.transform);
          const height = Math.hypot(transform[2], transform[3]);
          const x = offsetX + transform[4] * scale,
            y = offsetY + (transform[5] - height * 0.86) * scale;
          const bold = /bold|black|heavy/i.test(
            item.fontName + ' ' + (content.styles[item.fontName]?.fontFamily || ''),
          );
          page.elements.push(
            element('text', {
              x,
              y,
              w: Math.max(3, item.width * scale + 2),
              h: Math.max(10, height * scale * 1.35),
              fontSize: Math.max(3, height * scale * 0.75),
              lineHeight: 1.15,
              bold,
              html: escapeHtml(item.str),
              whiteSpace: 'pre',
              name: item.str.slice(0, 35),
            }),
          );
          semantic.push({
            text: item.str,
            x,
            y,
            height: height * scale,
            elementId: page.elements.at(-1)!.id,
          });
        }
        const extracted = textBlocks(semantic, index);
        for (const block of extracted)
          for (const e of page.elements)
            if (block.sourceElementIds?.includes(e.id)) e.blockId = block.id;
        blocks.push(...extracted);
        for (const e of page.elements.filter((e) => e.type === 'image')) {
          e.blockId = id();
          blocks.push({
            id: e.blockId,
            type: 'image',
            text: 'PDF 图片',
            src: e.src,
            sourcePage: index,
          });
        }
      }
      pages.push(page);
      source.cleanup();
    }
    progress('PDF 识别完成，可校对文字和排版', 1);
    return { pages, blocks, previews, name: file.name.replace(/\.pdf$/i, '') };
  } finally {
    signal.removeEventListener('abort', onAbort);
    await ocr.close();
    await loading.destroy();
  }
}

export async function importImage(
  file: File,
  signal: AbortSignal,
  progress: Progress,
): Promise<ImportResult> {
  const image = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  const factor = Math.min(1, 2400 / Math.max(image.width, image.height));
  canvas.width = Math.round(image.width * factor);
  canvas.height = Math.round(image.height * factor);
  canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height);
  image.close();
  const session = new OcrSession(signal, progress);
  try {
    const lines = await session.recognize(canvas),
      page = newPage(),
      blocks = recognizedBlocks(lines, 1);
    const scale = Math.min(PAGE_WIDTH / canvas.width, PAGE_HEIGHT / canvas.height);
    lines.forEach((line, index) =>
      page.elements.push(
        element('text', {
          x: line.x * scale,
          y: line.y * scale,
          w: Math.max(30, line.w * scale + 5),
          h: Math.max(15, line.h * scale * 1.35),
          fontSize: Math.max(7, line.h * scale * 0.72),
          lineHeight: 1.25,
          html: escapeHtml(line.text),
          blockId: blocks[index]?.id,
        }),
      ),
    );
    return {
      pages: [page],
      blocks,
      previews: [canvas.toDataURL('image/jpeg', 0.8)],
      name: file.name.replace(/\.[^.]+$/, ''),
    };
  } finally {
    await session.close();
  }
}

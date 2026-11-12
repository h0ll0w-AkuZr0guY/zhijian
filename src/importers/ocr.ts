import { createWorker, type Worker } from 'tesseract.js';
import { escapeHtml, id, type ContentBlock } from '../core/model';

export interface RecognitionLine {
  text: string;
  confidence: number;
  x: number;
  y: number;
  w: number;
  h: number;
}
export type Progress = (message: string, value: number) => void;
export function normalizeRecognizedText(text: string): string {
  return text.trim().replace(/([\u3400-\u9fff]) +(?=[\u3400-\u9fff])/g, '$1');
}
const asset = (path: string) =>
  new URL(path, new URL(import.meta.env.BASE_URL, location.href)).href;

export class OcrSession {
  private worker?: Worker;
  constructor(
    private signal: AbortSignal,
    private progress: Progress,
  ) {}
  async recognize(image: HTMLCanvasElement | File): Promise<RecognitionLine[]> {
    this.signal.throwIfAborted();
    if (!this.worker) {
      const worker = await createWorker('chi_sim+eng', 1, {
        workerPath: asset('ocr/worker.min.js'),
        corePath: asset('ocr/'),
        langPath: asset('ocr/'),
        logger: (status) =>
          this.progress(
            status.status === 'recognizing text' ? '正在识别中英文文字' : '正在准备本地 OCR 模型',
            status.progress || 0,
          ),
      });
      this.worker = worker;
      if (this.signal.aborted) {
        await this.close();
        this.signal.throwIfAborted();
      }
      this.signal.addEventListener(
        'abort',
        () => {
          void this.close();
        },
        { once: true },
      );
    }
    const { data } = await this.worker.recognize(image, {}, { blocks: true, text: true });
    this.signal.throwIfAborted();
    const lines: RecognitionLine[] = [];
    for (const block of data.blocks || [])
      for (const paragraph of block.paragraphs)
        for (const line of paragraph.lines) {
          if (line.text.trim())
            lines.push({
              text: normalizeRecognizedText(line.text),
              confidence: line.confidence,
              x: line.bbox.x0,
              y: line.bbox.y0,
              w: line.bbox.x1 - line.bbox.x0,
              h: line.bbox.y1 - line.bbox.y0,
            });
        }
    if (!lines.length && data.text.trim())
      lines.push({
        text: data.text.trim(),
        confidence: data.confidence,
        x: 0,
        y: 0,
        w: 600,
        h: 100,
      });
    return lines;
  }
  async close(): Promise<void> {
    const worker = this.worker;
    this.worker = undefined;
    if (worker) await worker.terminate();
  }
}
export function recognizedBlocks(lines: RecognitionLine[], page: number): ContentBlock[] {
  return lines.map((line) => ({
    id: id(),
    type: /^(教育|工作|实习|项目|研究|技能|专业|荣誉|获奖|个人|科研|联系).{0,10}$/.test(line.text)
      ? 'heading'
      : 'paragraph',
    level: 2,
    text: line.text,
    html: escapeHtml(line.text),
    confidence: line.confidence,
    sourcePage: page,
  }));
}

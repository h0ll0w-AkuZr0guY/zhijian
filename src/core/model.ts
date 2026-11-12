export const MM = 96 / 25.4;
export const PAGE_WIDTH = 210 * MM;
export const PAGE_HEIGHT = 297 * MM;

export type ElementType = 'text' | 'rect' | 'ellipse' | 'line' | 'image' | 'shape';
export interface CanvasElement {
  id: string;
  type: ElementType;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  opacity: number;
  color: string;
  fill: string;
  strokeWidth: number;
  radius: number;
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  textAlign: string;
  html: string;
  src?: string;
  assetId?: string;
  shape?: string;
  groupId?: string;
  locked?: boolean;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  letterSpacing?: number;
  whiteSpace?: string;
  objectFit?: string;
  objectPosition?: string;
  dash?: string;
  blockId?: string;
  name?: string;
  hangingIndent?: number;
  rowGuide?: boolean;
  rowAnchorId?: string;
}
export interface EditorPage {
  id: string;
  background: string;
  elements: CanvasElement[];
}
export type BlockType = 'heading' | 'paragraph' | 'list' | 'table' | 'image';
export interface ContentBlock {
  id: string;
  type: BlockType;
  text: string;
  level?: number;
  html?: string;
  src?: string;
  confidence?: number;
  sourcePage?: number;
  sourceElementIds?: string[];
  section?: string;
  markdown?: string;
  role?: 'entry' | 'contact' | 'portrait';
  fields?: string[];
  sourceBounds?: { x: number; y: number; w: number; h: number };
}
export interface Project {
  version: 2;
  id: string;
  name: string;
  pages: EditorPage[];
  activePage: number;
  blocks: ContentBlock[];
  template: string;
  fontFamily?: string;
  updatedAt: number;
  source?: { name: string; previews: string[] };
  assets?: Record<string, string>;
}
export interface EditorDocument {
  version: 1;
  name: string;
  background: string;
  elements: CanvasElement[];
}
export interface EditorBridge {
  getDocument(): EditorDocument;
  setDocument(document: EditorDocument): void;
  validate(document: EditorDocument): EditorDocument;
  render(): void;
  finishEditing(): void;
  fit(): void;
  toast(message: string): void;
  getSelectedIds(): string[];
  setDefaultFont(family: string): void;
}
declare global {
  interface Window {
    paperEditor: EditorBridge;
    paperChanged?: () => void;
    paperHistory?: {
      capture(): void;
      undo(redo?: boolean): void;
      canUndo(): boolean;
      canRedo(): boolean;
    };
    __TAURI_INTERNALS__?: unknown;
  }
}
export const id = () => crypto.randomUUID();
export const clone = <T>(value: T): T => structuredClone(value);
export function element(type: ElementType, values: Partial<CanvasElement> = {}): CanvasElement {
  return {
    id: id(),
    type,
    x: 48,
    y: 48,
    w: 300,
    h: 40,
    rotation: 0,
    opacity: 100,
    color: '#263b30',
    fill: 'transparent',
    strokeWidth: 0,
    radius: 0,
    fontFamily: 'Noto Sans SC',
    fontSize: 10.5,
    lineHeight: 1.5,
    textAlign: 'left',
    html: '',
    ...values,
  };
}
export function newPage(): EditorPage {
  return { id: id(), background: '#ffffff', elements: [] };
}
export function newProject(name = '未命名文档'): Project {
  return {
    version: 2,
    id: id(),
    name,
    pages: [newPage()],
    activePage: 0,
    blocks: [],
    template: 'clean',
    updatedAt: Date.now(),
  };
}
export function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
  );
}
export function plainText(html: string): string {
  const node = document.createElement('div');
  node.innerHTML = html.replace(/<br\s*\/?\s*>/gi, '\n').replace(/<\/div>/gi, '\n');
  return node.textContent || '';
}
export function blocksFromPages(pages: EditorPage[]): ContentBlock[] {
  return pages.flatMap((page, index) =>
    [...page.elements]
      .filter((e) => e.type === 'text' || e.type === 'image')
      .sort((a, b) => a.y - b.y || a.x - b.x)
      .map((e) => ({
        id: e.blockId || id(),
        type:
          e.type === 'image'
            ? ('image' as const)
            : e.bold && e.fontSize >= 13
              ? ('heading' as const)
              : ('paragraph' as const),
        text: e.type === 'text' ? plainText(e.html) : '图片',
        html: e.html,
        level: e.fontSize >= 20 ? 1 : 2,
        src: e.src,
        sourcePage: index + 1,
      })),
  );
}
export function packProject(project: Project): Project {
  const result = clone(project);
  const assets: Record<string, string> = {};
  const ids = new Map<string, string>();
  for (const page of result.pages)
    for (const e of page.elements) {
      if (!e.src) continue;
      if (!ids.has(e.src)) ids.set(e.src, `asset-${ids.size + 1}`);
      e.assetId = ids.get(e.src)!;
      assets[e.assetId] = e.src;
      delete e.src;
    }
  result.assets = assets;
  return result;
}
export function unpackProject(input: unknown, validate: EditorBridge['validate']): Project {
  if (!input || typeof input !== 'object') throw Error('工程格式无效');
  const value = input as Record<string, unknown>;
  if (value.version === 1) {
    const old = validate(value as unknown as EditorDocument);
    const project = newProject(old.name);
    project.pages[0] = { id: id(), background: old.background, elements: old.elements };
    project.blocks = blocksFromPages(project.pages);
    return project;
  }
  const project = clone(input as Project);
  if (
    project.version !== 2 ||
    !Array.isArray(project.pages) ||
    !project.pages.length ||
    project.pages.length > 100 ||
    typeof project.name !== 'string'
  )
    throw Error('工程页数或格式无效');
  for (const page of project.pages) {
    if (!Array.isArray(page.elements)) throw Error('页面元素格式无效');
    for (const e of page.elements)
      if (e.assetId) {
        e.src = project.assets?.[e.assetId];
        if (!e.src) throw Error('工程缺少图片资源');
      }
    const valid = validate({
      version: 1,
      name: project.name,
      background: page.background,
      elements: page.elements,
    });
    page.elements = valid.elements;
    page.id ||= id();
  }
  if (!Array.isArray(project.blocks)) project.blocks = [];
  project.id ||= id();
  project.activePage = Math.max(
    0,
    Math.min(project.pages.length - 1, Number(project.activePage) || 0),
  );
  delete project.assets;
  return project;
}

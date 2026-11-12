import './editor/editor.css';
import './app.css';
import './editor/editor.js';
import {
  blocksFromPages,
  clone,
  element,
  escapeHtml,
  id,
  newPage,
  newProject,
  packProject,
  unpackProject,
  type ContentBlock,
  type EditorPage,
  type Project,
} from './core/model';
import { deleteDocument, lastDocument, listDocuments, saveDocument } from './storage/documents';
import { parseMarkdown, toMarkdown } from './importers/markdown';
import {
  defaultLayout,
  demoNotice,
  demoResume,
  inferSections,
  layoutContent,
  templates,
  type LayoutOptions,
} from './layout/templates';
import { download, pageNode, pagePng } from './exporters/scene';
import type { ImportResult } from './importers/pdf';

const $ = <T extends HTMLElement = HTMLElement>(key: string) => document.getElementById(key) as T;
const editor = window.paperEditor;
let project = newProject();
let initialized = false,
  restoring = false,
  saveTimer: ReturnType<typeof setTimeout>;
let pendingSave: Promise<void> = Promise.resolve();
const past: string[] = [],
  future: string[] = [];
let draft: ContentBlock[] = [],
  draftName = '',
  draftSource: Project['source'];
let imported: ImportResult | undefined;
let selectedTemplate = 'clean',
  previewPages: EditorPage[] = [];
let task: AbortController | undefined;
let revision = 0;

function syncPage(): void {
  if (!initialized) return;
  const document = editor.getDocument();
  project.name = document.name;
  project.pages[project.activePage] = {
    ...project.pages[project.activePage],
    background: document.background,
    elements: document.elements,
  };
}
function snapshot(): Project {
  syncPage();
  return clone(project);
}
function capture(): void {
  if (restoring || !initialized) return;
  const value = JSON.stringify({ ...snapshot(), updatedAt: 0 });
  if (past.at(-1) === value) return;
  past.push(value);
  future.length = 0;
  while (
    past.length > 1 &&
    (past.length > 50 || past.reduce((size, item) => size + item.length, 0) > 32_000_000)
  )
    past.shift();
}
async function persist(): Promise<void> {
  if (!initialized) return;
  const current = snapshot();
  current.updatedAt = Date.now();
  project.updatedAt = current.updatedAt;
  const token = ++revision;
  $('saveStatus').textContent = '正在保存到本机';
  pendingSave = saveDocument(current)
    .then(() => {
      if (token === revision) $('saveStatus').textContent = '已保存到本机';
    })
    .catch((error) => {
      if (token === revision) $('saveStatus').textContent = '请下载工程备份';
      editor.toast('本机存储失败，请保存工程文件 ' + String(error));
    });
  await pendingSave;
}
function changed(): void {
  if (!initialized || restoring) return;
  syncPage();
  renderPages();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void persist();
  }, 450);
}
function showPage(index: number): void {
  project.activePage = Math.max(0, Math.min(project.pages.length - 1, index));
  const page = project.pages[project.activePage];
  editor.setDocument({
    version: 1,
    name: project.name,
    background: page.background,
    elements: page.elements,
  });
  renderPages();
}
function renderPages(): void {
  const select = $<HTMLSelectElement>('pageSelect');
  select.replaceChildren();
  project.pages.forEach((_, index) =>
    select.add(new Option(`${index + 1} / ${project.pages.length}`, String(index))),
  );
  select.value = String(project.activePage);
  $<HTMLButtonElement>('previousPage').disabled = project.activePage === 0;
  $<HTMLButtonElement>('nextPage').disabled = project.activePage === project.pages.length - 1;
  $<HTMLButtonElement>('removePage').disabled = project.pages.length === 1;
  $('pageLabel').textContent = `${project.name} · 第 ${project.activePage + 1} 页`;
}
function applyProject(next: Project, record = true): void {
  editor.finishEditing();
  if (record) capture();
  restoring = true;
  project = clone(next);
  initialized = true;
  showPage(project.activePage);
  restoring = false;
  void persist();
}
window.paperChanged = changed;
window.paperHistory = {
  capture,
  canUndo: () => !!past.length,
  canRedo: () => !!future.length,
  undo(redo = false) {
    const from = redo ? future : past,
      to = redo ? past : future;
    if (!from.length) return;
    to.push(JSON.stringify(snapshot()));
    applyProject(JSON.parse(from.pop()!) as Project, false);
  },
};

function pageChange(index: number): void {
  editor.finishEditing();
  syncPage();
  showPage(index);
  changed();
}
$<HTMLSelectElement>('pageSelect').onchange = (event) =>
  pageChange(Number((event.target as HTMLSelectElement).value));
$('previousPage').onclick = () => pageChange(project.activePage - 1);
$('nextPage').onclick = () => pageChange(project.activePage + 1);
$('addPage').onclick = () => {
  capture();
  syncPage();
  project.pages.splice(project.activePage + 1, 0, newPage());
  showPage(project.activePage + 1);
  changed();
};
$('duplicatePage').onclick = () => {
  capture();
  syncPage();
  const page = clone(project.pages[project.activePage]);
  page.id = id();
  const groups = new Map<string, string>();
  for (const e of page.elements) {
    e.id = id();
    if (e.groupId) {
      if (!groups.has(e.groupId)) groups.set(e.groupId, id());
      e.groupId = groups.get(e.groupId);
    }
  }
  project.pages.splice(project.activePage + 1, 0, page);
  showPage(project.activePage + 1);
  changed();
};
$('removePage').onclick = () => {
  if (project.pages.length < 2) return;
  capture();
  syncPage();
  project.pages.splice(project.activePage, 1);
  showPage(Math.min(project.activePage, project.pages.length - 1));
  changed();
};
$('blank').onclick = () => {
  $<HTMLDialogElement>('nameDialog').showModal();
  $<HTMLInputElement>('newDocumentName').select();
};
$('cancelNew').onclick = () => $<HTMLDialogElement>('nameDialog').close();
$('confirmNew').onclick = async () => {
  await persist();
  applyProject(newProject($<HTMLInputElement>('newDocumentName').value.trim() || '未命名文档'));
  $<HTMLDialogElement>('nameDialog').close();
  editor.fit();
};
function saveProject(): void {
  editor.finishEditing();
  download(
    JSON.stringify(packProject(snapshot()), null, 2),
    project.name + '.zhijian',
    'application/json',
  );
  void persist();
  editor.toast('已下载可编辑工程，图片与组合信息已包含');
}
$('save').onclick = saveProject;
document.addEventListener('paper-save-project', saveProject);
$('open').onclick = () => $<HTMLInputElement>('projectFile').click();
$<HTMLInputElement>('projectFile').onchange = async (event) => {
  const input = event.target as HTMLInputElement,
    file = input.files?.[0];
  if (!file) return;
  try {
    const next = unpackProject(JSON.parse(await file.text()), editor.validate);
    await persist();
    applyProject(next);
    editor.toast('工程已打开');
  } catch (error) {
    editor.toast('打开失败 ' + String(error));
  }
  input.value = '';
};
async function openLibrary(): Promise<void> {
  await persist();
  const entries = await listDocuments(),
    container = $('documentList');
  container.replaceChildren();
  for (const entry of entries) {
    const row = document.createElement('div');
    row.className = 'document-row';
    const title = document.createElement('div'),
      name = document.createElement('strong'),
      meta = document.createElement('small');
    name.textContent = entry.name;
    meta.textContent = `${entry.pages.length} 页 · ${new Date(entry.updatedAt).toLocaleString('zh-CN')}`;
    title.append(name, meta);
    const open = document.createElement('button');
    open.textContent = '打开';
    open.onclick = async () => {
      await persist();
      applyProject(unpackProject(entry, editor.validate));
      $<HTMLDialogElement>('libraryDialog').close();
    };
    const remove = document.createElement('button');
    remove.textContent = '删除';
    remove.onclick = async () => {
      if (remove.dataset.confirm !== 'true') {
        remove.dataset.confirm = 'true';
        remove.textContent = '确认删除';
        return;
      }
      if (entry.id === project.id) {
        applyProject(newProject());
        await persist();
      }
      await deleteDocument(entry.id);
      row.remove();
    };
    row.append(title, open, remove);
    container.append(row);
  }
  $<HTMLDialogElement>('libraryDialog').showModal();
}
$('libraryOpen').onclick = () => {
  void openLibrary();
};
$('closeLibrary').onclick = () => $<HTMLDialogElement>('libraryDialog').close();

function currentBlocks(): ContentBlock[] {
  syncPage();
  const previous = new Map(project.blocks.map((block) => [block.id, block]));
  const result: ContentBlock[] = [],
    seen = new Map<string, ContentBlock>();
  for (const block of blocksFromPages(project.pages)) {
    if (block.text.match(/^\d+ \/ \d+$/)) continue;
    const original = previous.get(block.id);
    const value = {
      ...block,
      type: original?.type || block.type,
      level: original?.level || block.level,
      section: original?.section,
      markdown: original?.text === block.text ? original.markdown : undefined,
    };
    if (value.type === 'list') value.text = value.text.replace(/^•\s*/, '');
    const earlier = seen.get(value.id);
    if (earlier) {
      earlier.text += '\n' + value.text;
      earlier.html = (earlier.html || '') + '<br>' + value.html;
    } else {
      result.push(value);
      seen.set(value.id, value);
    }
  }
  return inferSections(result);
}
function openContent(): void {
  editor.finishEditing();
  draft = currentBlocks();
  draftName = project.name;
  draftSource = project.source;
  imported = undefined;
  selectedTemplate = project.template || 'clean';
  $<HTMLSelectElement>('pdfMode').value = 'reflow';
  renderBlocks();
  renderTemplates();
  renderSource();
  schedulePreview();
  $<HTMLDialogElement>('contentDialog').showModal();
}
$('resume').onclick = openContent;
$('importOpen').onclick = () => {
  openContent();
  $<HTMLInputElement>('importFile').click();
};
$('chooseImport').onclick = () => $<HTMLInputElement>('importFile').click();
$('closeContent').onclick = () => {
  task?.abort();
  $<HTMLDialogElement>('contentDialog').close();
};
$<HTMLDialogElement>('contentDialog').addEventListener('cancel', () => task?.abort());
$('cancelTask').onclick = () => {
  task?.abort();
  $('taskMessage').textContent = '正在取消任务';
};
$('pasteMarkdown').onclick = () => {
  $('markdownInput').hidden = false;
  $('parseMarkdown').hidden = false;
  $('markdownInput').focus();
};
$('parseMarkdown').onclick = () => {
  draft = inferSections(parseMarkdown($<HTMLTextAreaElement>('markdownInput').value));
  imported = undefined;
  if (draft[0]?.type === 'heading') draftName = draft[0].text;
  $<HTMLSelectElement>('pdfMode').value = 'reflow';
  renderBlocks();
  schedulePreview();
};
$('sampleContent').onclick = () => {
  draft = inferSections(parseMarkdown(selectedTemplate === 'notice' ? demoNotice : demoResume));
  draftName = draft[0].text;
  imported = undefined;
  draftSource = undefined;
  renderSource();
  renderBlocks();
  schedulePreview();
};
$('addBlock').onclick = () => {
  draft.push({ id: id(), type: 'paragraph', text: '新的内容' });
  renderBlocks();
  schedulePreview();
};

function renderBlocks(): void {
  const container = $('blockList');
  container.replaceChildren();
  draft.forEach((block, index) => {
    const row = document.createElement('div');
    row.className = 'content-block';
    row.dataset.blockId = block.id;
    const controls = document.createElement('div');
    controls.className = 'block-controls';
    const type = document.createElement('select');
    type.setAttribute('aria-label', '内容类型');
    for (const [value, label] of [
      ['title', '文档标题'],
      ['heading', '栏目标题'],
      ['paragraph', '段落'],
      ['list', '列表项'],
      ['table', '表格'],
      ['image', '图片'],
    ])
      type.add(new Option(label, value));
    type.value = block.type === 'heading' && block.level === 1 ? 'title' : block.type;
    type.onchange = () => {
      block.type = type.value === 'title' ? 'heading' : (type.value as ContentBlock['type']);
      block.level = type.value === 'title' ? 1 : 2;
      schedulePreview();
    };
    controls.append(type);
    if (block.confidence !== undefined) {
      const confidence = document.createElement('small');
      confidence.className = block.confidence < 80 ? 'low-confidence' : '';
      confidence.textContent = `OCR ${Math.round(block.confidence)}%`;
      controls.append(confidence);
    }
    const action = (label: string, title: string, fn: () => void) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.title = title;
      b.onclick = () => {
        fn();
        renderBlocks();
        schedulePreview();
      };
      controls.append(b);
    };
    action('↑', '上移', () => {
      if (index > 0) [draft[index - 1], draft[index]] = [draft[index], draft[index - 1]];
    });
    action('↓', '下移', () => {
      if (index < draft.length - 1)
        [draft[index + 1], draft[index]] = [draft[index], draft[index + 1]];
    });
    action('合并', '与下一段合并', () => {
      if (draft[index + 1] && block.type !== 'image') {
        block.text += '\n' + draft[index + 1].text;
        delete block.html;
        draft.splice(index + 1, 1);
      }
    });
    action('拆分', '按换行拆分', () => {
      const lines = block.text.split(/\n+/).filter(Boolean);
      if (lines.length > 1)
        draft.splice(
          index,
          1,
          ...lines.map((text) => ({ ...block, id: id(), text, html: undefined })),
        );
    });
    action('×', '删除此段', () => draft.splice(index, 1));
    const text = document.createElement('textarea');
    text.value = block.text;
    text.setAttribute('aria-label', `内容 ${index + 1}`);
    text.rows = Math.min(6, Math.max(2, Math.ceil(block.text.length / 36)));
    text.oninput = () => {
      block.text = text.value;
      delete block.html;
      delete block.markdown;
      schedulePreview();
    };
    row.append(controls, text);
    if (block.src) {
      const image = new Image();
      image.src = block.src;
      image.alt = block.text;
      image.className = 'block-image';
      row.append(image);
    }
    container.append(row);
  });
  if (!draft.length) container.textContent = '导入文件或粘贴 Markdown，然后校对内容。';
  $('contentSummary').textContent = `${draft.length} 个内容区块 · 文件在本机处理`;
}
function renderTemplates(): void {
  const container = $('templateList');
  container.replaceChildren();
  for (const template of templates) {
    const button = document.createElement('button');
    button.className = 'template-option' + (selectedTemplate === template.id ? ' selected' : '');
    const name = document.createElement('strong'),
      description = document.createElement('small');
    name.textContent = template.name;
    description.textContent = template.description;
    button.style.setProperty('--template-color', template.accent);
    button.append(name, description);
    button.onclick = () => {
      selectedTemplate = template.id;
      $<HTMLSelectElement>('pdfMode').value = 'reflow';
      renderTemplates();
      schedulePreview();
    };
    container.append(button);
  }
}
function options(): LayoutOptions {
  const number = (key: string, min: number, max: number, fallback: number) =>
    Math.min(max, Math.max(min, Number($<HTMLInputElement>(key).value) || fallback));
  const fontSize = number('layoutFont', 8, 24, 10.5);
  return {
    margin: number('layoutMargin', 5, 35, 12),
    fontSize,
    minFontSize: Math.min(fontSize, number('layoutMinFont', 7, 20, 9)),
    onePage: $<HTMLInputElement>('layoutOnePage').checked,
  };
}
let previewTimer: ReturnType<typeof setTimeout>;
function schedulePreview(): void {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(renderPreview, 150);
}
function originalPages(): EditorPage[] {
  const pages = clone(imported?.pages || project.pages);
  const original = new Map((imported?.blocks || project.blocks).map((block) => [block.id, block]));
  const ids = new Set(draft.map((block) => block.id));
  for (const page of pages)
    page.elements = page.elements.filter((e) => !e.blockId || ids.has(e.blockId));
  for (const block of draft) {
    const matches = pages.flatMap((page) => page.elements).filter((e) => e.blockId === block.id);
    if (matches.length && block.text !== original.get(block.id)?.text) {
      const first = matches[0];
      first.html = escapeHtml(block.text);
      first.whiteSpace = 'pre-wrap';
      first.w = Math.max(first.w, Math.max(...matches.map((e) => e.x + e.w)) - first.x);
      const removed = new Set(matches.slice(1).map((e) => e.id));
      for (const page of pages) page.elements = page.elements.filter((e) => !removed.has(e.id));
    } else if (!matches.length && !original.has(block.id)) {
      const page = pages[Math.min(pages.length - 1, (block.sourcePage || 1) - 1)];
      page.elements.push(
        element(block.type === 'image' && block.src ? 'image' : 'text', {
          x: 48,
          y: 70 + page.elements.length * 4,
          w: block.type === 'image' ? 180 : 650,
          h: block.type === 'image' ? 120 : 50,
          src: block.src,
          html: escapeHtml(block.text),
          blockId: block.id,
        }),
      );
    }
  }
  return pages;
}
function renderPreview(): void {
  const original = !!imported && $<HTMLSelectElement>('pdfMode').value === 'layout';
  previewPages = original
    ? originalPages()
    : layoutContent(inferSections(draft), selectedTemplate, options());
  if ($<HTMLInputElement>('keepLocked').checked && !original) {
    project.pages.forEach((page, index) => {
      const locked = page.elements.filter(
        (e) => e.locked && !['页码', '模板页顶装饰', '模板侧栏背景'].includes(e.name || ''),
      );
      if (locked.length) {
        while (previewPages.length <= index) previewPages.push(newPage());
        previewPages[index].elements.push(...clone(locked));
      }
    });
  }
  const container = $('layoutPreview');
  container.replaceChildren();
  for (const page of previewPages) {
    const wrapper = document.createElement('div');
    wrapper.className = 'preview-page';
    wrapper.append(pageNode(page));
    container.append(wrapper);
  }
  $('previewCount').textContent = `${previewPages.length} 页 A4`;
}
for (const key of [
  'layoutMargin',
  'layoutFont',
  'layoutMinFont',
  'layoutOnePage',
  'keepLocked',
  'pdfMode',
])
  $(key).addEventListener('change', schedulePreview);
$('applyContent').onclick = () => {
  if (task) return;
  renderPreview();
  if (!draft.length) {
    editor.toast('请先添加或导入内容');
    return;
  }
  capture();
  syncPage();
  project.name = draftName || project.name;
  project.pages = clone(previewPages);
  project.activePage = 0;
  project.blocks = inferSections(clone(draft));
  project.source = draftSource;
  project.template = selectedTemplate;
  showPage(0);
  changed();
  $<HTMLDialogElement>('contentDialog').close();
  editor.fit();
  editor.toast(`已整理为 ${project.pages.length} 页，Ctrl+Z 可撤销本次整理`);
};
function taskProgress(message: string, value: number): void {
  $('taskMessage').textContent = message;
  $<HTMLProgressElement>('taskProgress').value = value;
}
$<HTMLInputElement>('importFile').onchange = async (event) => {
  const input = event.target as HTMLInputElement,
    file = input.files?.[0];
  input.value = '';
  if (!file) return;
  if (file.size > 80 * 1024 * 1024) {
    editor.toast('请选择 80 MB 以内的文件');
    return;
  }
  task?.abort();
  const controller = new AbortController();
  task = controller;
  $('taskStatus').hidden = false;
  $<HTMLButtonElement>('applyContent').disabled = true;
  taskProgress('正在读取文件', 0);
  try {
    if (/\.(md|markdown|txt)$/i.test(file.name)) {
      draft = inferSections(parseMarkdown(await file.text()));
      draftName = file.name.replace(/\.[^.]+$/, '');
      draftSource = undefined;
      imported = undefined;
      $<HTMLSelectElement>('pdfMode').value = 'reflow';
    } else {
      const { importPdf, importImage } = await import('./importers/pdf');
      const result = /\.pdf$/i.test(file.name)
        ? await importPdf(
            file,
            controller.signal,
            taskProgress,
            $<HTMLInputElement>('forceOcr').checked,
          )
        : await importImage(file, controller.signal, taskProgress);
      controller.signal.throwIfAborted();
      imported = result;
      draft = inferSections(result.blocks);
      draftName = result.name;
      draftSource = { name: file.name, previews: result.previews };
      $<HTMLSelectElement>('pdfMode').value = 'layout';
    }
    renderSource();
    renderBlocks();
    schedulePreview();
    if (!draft.length) editor.toast('没有识别到文字，可尝试强制 OCR 或手动添加内容');
  } catch (error) {
    editor.toast(controller.signal.aborted ? '识别任务已取消' : '导入失败 ' + String(error));
  } finally {
    if (task === controller) {
      task = undefined;
      $('taskStatus').hidden = true;
      $<HTMLButtonElement>('applyContent').disabled = false;
    }
  }
};
function renderSource(): void {
  const container = $('sourcePreview');
  container.replaceChildren();
  container.hidden = !draftSource?.previews.length;
  draftSource?.previews.forEach((src, index) => {
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = `原稿对照 · 第 ${index + 1} 页（展开后拖框截取图片）`;
    const wrapper = document.createElement('div');
    wrapper.className = 'source-image';
    const image = new Image();
    image.src = src;
    image.alt = `原稿第 ${index + 1} 页`;
    wrapper.append(image);
    details.append(summary, wrapper);
    container.append(details);
    wrapper.onpointerdown = (event) => {
      event.preventDefault();
      wrapper.setPointerCapture(event.pointerId);
      const bounds = wrapper.getBoundingClientRect();
      const start = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
      const box = document.createElement('div');
      box.className = 'source-crop';
      wrapper.append(box);
      let end = { ...start };
      wrapper.onpointermove = (move) => {
        end = {
          x: Math.max(0, Math.min(bounds.width, move.clientX - bounds.left)),
          y: Math.max(0, Math.min(bounds.height, move.clientY - bounds.top)),
        };
        Object.assign(box.style, {
          left: Math.min(start.x, end.x) + 'px',
          top: Math.min(start.y, end.y) + 'px',
          width: Math.abs(start.x - end.x) + 'px',
          height: Math.abs(start.y - end.y) + 'px',
        });
      };
      wrapper.onpointerup = () => {
        wrapper.onpointermove = null;
        wrapper.onpointerup = null;
        box.remove();
        const width = Math.abs(start.x - end.x),
          height = Math.abs(start.y - end.y);
        if (width < 8 || height < 8) return;
        const ratio = image.naturalWidth / bounds.width,
          canvas = document.createElement('canvas');
        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round(height * ratio);
        canvas
          .getContext('2d')!
          .drawImage(
            image,
            Math.min(start.x, end.x) * ratio,
            Math.min(start.y, end.y) * ratio,
            canvas.width,
            canvas.height,
            0,
            0,
            canvas.width,
            canvas.height,
          );
        draft.push({
          id: id(),
          type: 'image',
          text: '原稿图片截取',
          src: canvas.toDataURL('image/png'),
          sourcePage: index + 1,
        });
        renderBlocks();
        schedulePreview();
      };
    };
  });
}

let exporting = false;
$('print').onclick = async () => {
  if (exporting) return;
  exporting = true;
  editor.finishEditing();
  $<HTMLButtonElement>('print').disabled = true;
  try {
    const { exportPdf } = await import('./exporters/pdf');
    const bytes = await exportPdf(snapshot().pages, (message) => {
      $('saveStatus').textContent = message;
    });
    download(bytes.buffer as ArrayBuffer, project.name + '.pdf', 'application/pdf');
    editor.toast('PDF 已下载，文字可选择与复制');
  } catch (error) {
    editor.toast('PDF 导出失败 ' + String(error));
  } finally {
    exporting = false;
    $<HTMLButtonElement>('print').disabled = false;
    $('saveStatus').textContent = '已保存到本机';
  }
};
$<HTMLSelectElement>('exportFormat').onchange = async (event) => {
  const input = event.target as HTMLSelectElement,
    value = input.value;
  input.value = '';
  editor.finishEditing();
  syncPage();
  try {
    if (value === 'png')
      download(
        await pagePng(project.pages[project.activePage]),
        `${project.name}-${project.activePage + 1}.png`,
        'image/png',
      );
    if (value === 'markdown')
      download(toMarkdown(currentBlocks()), project.name + '.md', 'text/markdown;charset=utf-8');
    if (value === 'print') {
      const host = document.createElement('div');
      host.id = 'printDocument';
      for (const page of project.pages) host.append(pageNode(page));
      document.body.append(host);
      try {
        await document.fonts.ready;
        window.print();
      } finally {
        host.remove();
      }
    }
  } catch (error) {
    editor.toast('导出失败 ' + String(error));
  }
};
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') void persist();
});
window.addEventListener('tauri-cancel-recognition', () => task?.abort());
window.addEventListener('error', (event) => {
  if (event.message.includes('ResizeObserver')) event.preventDefault();
});

async function initialize(): Promise<void> {
  await document.fonts.load('14px "Noto Sans SC"');
  let initial: Project | undefined;
  try {
    const saved = await lastDocument();
    if (saved) initial = unpackProject(saved, editor.validate);
  } catch (error) {
    editor.toast('本机草稿读取失败，可通过工程文件恢复 ' + String(error));
  }
  if (!initial) {
    initial = newProject('林知远 · 示例简历');
    initial.blocks = inferSections(parseMarkdown(demoResume));
    initial.pages = layoutContent(initial.blocks, 'clean', defaultLayout);
  }
  applyProject(initial, false);
  if ('serviceWorker' in navigator && !window.__TAURI_INTERNALS__)
    void navigator.serviceWorker
      .register(new URL('sw.js', new URL(import.meta.env.BASE_URL, location.href)).href)
      .catch(() => {});
  document.documentElement.dataset.ready = 'true';
  const desktopLink = document.createElement('a');
  desktopLink.id = 'desktopDownload';
  desktopLink.textContent = '下载 Windows 托盘版 ↗';
  desktopLink.href = 'https://github.com/h0ll0w-AkuZr0guY/zhijian/releases/latest';
  desktopLink.target = '_blank';
  desktopLink.rel = 'noopener';
  document.querySelector('.left-footer')!.append(document.createElement('br'), desktopLink);
  if (!window.__TAURI_INTERNALS__)
    void fetch(new URL('downloads/desktop.json', new URL(import.meta.env.BASE_URL, location.href)))
      .then((response) => (response.ok ? response.json() : undefined))
      .then((release: { file: string; version: string } | undefined) => {
        if (release && /^zhijian_[\d.]+_x64-setup\.exe$/.test(release.file)) {
          desktopLink.href = new URL(
            'downloads/' + release.file,
            new URL(import.meta.env.BASE_URL, location.href),
          ).href;
          desktopLink.title = 'Windows 托盘版 ' + release.version;
        }
      })
      .catch(() => {});
}
void initialize();

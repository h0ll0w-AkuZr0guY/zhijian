import {
  clone,
  escapeHtml,
  id,
  newPage,
  type CanvasElement,
  type ContentBlock,
  type EditorPage,
  type Project,
} from '../core/model';
import { layoutContent, defaultLayout } from '../layout/templates';
import { reconstructPages } from '../importers/structure';
import { fitOnePage } from '../layout/one-page';

export type ModuleKind =
  'education' | 'experience' | 'research' | 'project' | 'skills' | 'awards' | 'custom';
export interface ResumeEntry {
  id: string;
  fields: Record<string, string>;
}
export interface ResumeModule {
  id: string;
  kind: ModuleKind;
  title: string;
  entries: ResumeEntry[];
}
export interface ResumeDraft {
  profile: Record<string, string>;
  modules: ResumeModule[];
  extras: EditorPage[];
  sceneSignature: string;
  onePage?: boolean;
  extraSceneSignature?: string;
  extraFrames?: Record<string, { x: number; y: number; w: number; h: number }>;
}
export const moduleNames: Record<ModuleKind, string> = {
  education: '教育经历',
  experience: '工作 / 实习经历',
  research: '研究经历',
  project: '项目经历',
  skills: '专业技能',
  awards: '荣誉与成果',
  custom: '自定义模块',
};
export function richText(html: string): string {
  const source = html.replace(/<br\s*\/?\s*>/gi, '\n').replace(/<\/(p|div|li)>/gi, '\n');
  if (typeof document === 'undefined') return source.replace(/<[^>]*>/g, '').trim();
  const node = document.createElement('div');
  node.innerHTML = source;
  return (node.textContent || '').trim();
}
export function cleanRich(html: string): string {
  if (typeof document === 'undefined') return html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '');
  const template = document.createElement('template');
  template.innerHTML = html;
  template.content
    .querySelectorAll('script,style,iframe,object,embed,img,svg,input,button,form,link,meta')
    .forEach((e) => e.remove());
  const allowed = new Set([
    'P',
    'DIV',
    'BR',
    'B',
    'STRONG',
    'I',
    'EM',
    'U',
    'S',
    'UL',
    'OL',
    'LI',
    'SPAN',
    'SUB',
    'SUP',
  ]);
  for (const e of [...template.content.querySelectorAll<HTMLElement>('*')]) {
    if (!allowed.has(e.tagName)) {
      e.replaceWith(...e.childNodes);
      continue;
    }
    const bold = Number(e.style.fontWeight) >= 600 || e.style.fontWeight === 'bold';
    for (const attr of [...e.attributes]) e.removeAttribute(attr.name);
    if (bold) e.style.fontWeight = '700';
  }
  return template.innerHTML;
}
export function sceneSignature(pages: EditorPage[], geometry = false): string {
  let hash = 2166136261;
  for (const page of pages)
    for (const e of page.elements) {
      if (e.name === '页码') continue;
      const value =
        e.id +
        e.type +
        (e.type === 'text' ? cleanRich(e.html) : e.html) +
        (e.src || '') +
        (geometry
          ? JSON.stringify([e.x, e.y, e.w, e.h, e.rotation, e.fill, e.color, e.strokeWidth])
          : '');
      for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
    }
  return (hash >>> 0).toString(36);
}
export function extrasSignature(resume: ResumeDraft, pages: EditorPage[]): string {
  const ids = new Set(resume.extras.flatMap((page) => page.elements).map((e) => e.id));
  return sceneSignature(
    pages.map((page) => ({ ...page, elements: page.elements.filter((e) => ids.has(e.id)) })),
    true,
  );
}
export function captureExtraFrames(
  resume: ResumeDraft,
  pages: EditorPage[],
): ResumeDraft['extraFrames'] {
  const ids = new Set(resume.extras.flatMap((page) => page.elements).map((e) => e.id));
  return Object.fromEntries(
    pages
      .flatMap((page) => page.elements)
      .filter((e) => ids.has(e.id))
      .map((e) => [e.id, { x: e.x, y: e.y, w: e.w, h: e.h }]),
  );
}
function sceneExtras(pages: EditorPage[], photoId?: string): EditorPage[] {
  return pages.map((page) => ({
    ...page,
    elements: clone(
      page.elements.filter(
        (e) =>
          e.id !== photoId &&
          e.formField !== 'profile:photo' &&
          (e.type === 'image' ||
            (e.type === 'text' && e.rotation !== 0) ||
            (!['text', 'image'].includes(e.type) &&
              !e.blockId &&
              !['模板页顶装饰', '模板侧栏背景'].includes(e.name || ''))),
      ),
    ),
  }));
}
export function syncSceneExtras(resume: ResumeDraft, pages: EditorPage[]): void {
  const current = sceneExtras(pages),
    previous = new Map(
      resume.extras.flatMap((page, index) =>
        page.elements.map((e) => [e.id, { element: e, index }] as const),
      ),
    );
  const result = resume.extras.map((page) => ({ ...page, elements: [] as CanvasElement[] }));
  current.forEach((page, index) =>
    page.elements.forEach((e) => {
      const old = previous.get(e.id),
        frame = resume.extraFrames?.[e.id];
      const target = old?.index ?? index;
      while (result.length <= target) result.push(newPage());
      const next = clone(e);
      if (old && frame) {
        const scale = frame.w / old.element.w;
        next.x = old.element.x + (e.x - frame.x) / scale;
        next.y = old.element.y + (e.y - frame.y) / scale;
        next.w /= scale;
        next.h /= scale;
        next.fontSize /= scale;
        next.strokeWidth /= scale;
        next.radius /= scale;
        if (next.hangingIndent) next.hangingIndent /= scale;
        if (next.letterSpacing) next.letterSpacing /= scale;
        next.html = next.html.replace(
          /(font-size\s*:\s*)([\d.]+)(px|pt)/gi,
          (_, prefix, size, unit) => prefix + Number(size) / scale + unit,
        );
      }
      result[target].elements.push(next);
    }),
  );
  resume.extras = result;
  resume.extraSceneSignature = extrasSignature(resume, pages);
  resume.extraFrames = captureExtraFrames(resume, pages);
}
export function newEntry(): ResumeEntry {
  return { id: id(), fields: {} };
}
export function newModule(kind: ModuleKind): ResumeModule {
  return { id: id(), kind, title: moduleNames[kind], entries: [newEntry()] };
}
function moduleKind(title: string): ModuleKind {
  if (/教育|education/i.test(title)) return 'education';
  if (/实习|工作|experience/i.test(title)) return 'experience';
  if (/研究|科研经历|research/i.test(title)) return 'research';
  if (/项目|project/i.test(title)) return 'project';
  if (/技能|skills/i.test(title)) return 'skills';
  if (/成果|论文|荣誉|获奖|奖项|publications|awards/i.test(title)) return 'awards';
  return 'custom';
}
function parseDates(text: string): { start: string; end: string } {
  const match = text.match(
    /((?:19|20)\d{2}(?:[./年-]\d{1,2})?)\s*[-—–~至]\s*((?:(?:19|20)\d{2}(?:[./年-]\d{1,2})?)|至今|现在|今)/,
  );
  return { start: match?.[1] || text, end: match?.[2] || '' };
}
function appendBody(entry: ResumeEntry, html: string): void {
  entry.fields.detailsHtml = (entry.fields.detailsHtml || '') + `<p>${cleanRich(html)}</p>`;
}
function headerKeys(kind: ModuleKind, fields: Record<string, string>): string[] {
  return [
    'organization',
    kind === 'education' ? 'major' : 'role',
    ...(kind === 'education' ? ['degree'] : []),
    'department',
    'city',
  ].filter((key) => fields[key]);
}
function fillContacts(profile: Record<string, string>, text: string): void {
  profile.phone = text.match(/1[3-9](?:[ -]?\d){9}/)?.[0].replace(/[ -]/g, '') || '';
  profile.email = text.match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/)?.[0] || '';
  const parts = text
    .split(/\s*[·｜|]\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
  profile.website =
    parts.find(
      (part) => /https?:\/\/|\.(com|cn|org|space|io)(?:\/|$)/i.test(part) && !part.includes('@'),
    ) || '';
  profile.location =
    parts.find(
      (part) =>
        part === profile.location ||
        /^(北京|上海|广州|深圳|杭州|成都|武汉|长沙|南京|苏州|天津|重庆|西安|合肥|厦门)(市|[ /·]|$)/.test(
          part,
        ),
    ) || '';
  profile.extra = parts
    .filter(
      (part) =>
        part.replace(/[ -]/g, '') !== profile.phone &&
        ![profile.email, profile.website, profile.location].includes(part),
    )
    .join(' · ');
}
export function inferResume(project: Project): ResumeDraft {
  const blocks = reconstructPages(clone(project.pages), project.blocks).blocks;
  const resume: ResumeDraft = {
    profile: {},
    modules: [],
    extras: [],
    sceneSignature: sceneSignature(project.pages),
  };
  let profileSection = false;
  let current: ResumeModule | undefined,
    entry: ResumeEntry | undefined,
    photoId: string | undefined;
  const headerExtras: string[] = [];
  for (const block of blocks) {
    if (block.type === 'image') {
      if (!resume.profile.photo && block.role === 'portrait' && block.src) {
        resume.profile.photo = block.src;
        photoId =
          project.pages
            .flatMap((p) => p.elements)
            .find((e) => e.blockId === block.id && e.type === 'image')?.id ||
          project.pages
            .flatMap((p) => p.elements)
            .find((e) => e.type === 'image' && e.src === block.src)?.id;
      }
      continue;
    }
    if (block.type === 'heading' && block.level === 1 && !resume.profile.name) {
      resume.profile.name = block.text;
      continue;
    }
    if (block.type === 'heading' && (block.level || 2) > 1) {
      profileSection = /^(个人简介|自我评价|个人优势|profile|summary)$/i.test(block.text);
      if (profileSection) {
        current = undefined;
        entry = undefined;
        continue;
      }
      current = { id: id(), kind: moduleKind(block.text), title: block.text, entries: [] };
      resume.modules.push(current);
      entry = undefined;
      continue;
    }
    if (profileSection) {
      resume.profile.detailsHtml =
        (resume.profile.detailsHtml || '') +
        `<p>${cleanRich(block.html || escapeHtml(block.text))}</p>`;
      continue;
    }
    if (!current) {
      headerExtras.push(block.text);
      continue;
    }
    const fields = block.fields || block.text.split(/\s*[｜|]\s*/);
    const dated = block.role === 'entry';
    const header =
      ['education', 'experience', 'project', 'research'].includes(current.kind) &&
      (dated || (!entry && fields.length > 1));
    if (header) {
      entry = newEntry();
      current.entries.push(entry);
      const date = fields.find((part) => /^(19|20)\d{2}.*[-—–~至]/.test(part));
      const labels = fields.filter((part) => part !== date);
      entry.fields.organization = labels[0] || '';
      if (current.kind === 'education') {
        entry.fields.major = labels[1] || '';
        entry.fields.degree = labels[2] || '';
      } else entry.fields.role = labels.slice(1).join(' ｜ ');
      if (date) Object.assign(entry.fields, parseDates(date));
      if (current.kind === 'education' && labels.length > 3)
        appendBody(entry, escapeHtml(labels.slice(3).join(' ｜ ')));
      continue;
    }
    if (!entry) {
      entry = newEntry();
      current.entries.push(entry);
    }
    appendBody(entry, block.html || escapeHtml(block.text));
  }
  const headline = headerExtras.find(
    (line) => line.length < 80 && !/[\d@]|https?:|\.(com|cn|org|space|io)/i.test(line),
  );
  if (headline) resume.profile.headline = headline;
  fillContacts(resume.profile, headerExtras.filter((line) => line !== headline).join(' · '));
  if (!resume.modules.length)
    resume.modules = [
      newModule('education'),
      newModule('experience'),
      newModule('project'),
      newModule('skills'),
    ];
  resume.extras = sceneExtras(project.pages, photoId);
  resume.extraSceneSignature = extrasSignature(resume, project.pages);
  resume.extraFrames = captureExtraFrames(resume, project.pages);
  return resume;
}
export function validResume(value: ResumeDraft | undefined): boolean {
  return (
    !!value &&
    typeof value.profile === 'object' &&
    !!value.profile &&
    !Array.isArray(value.profile) &&
    Object.values(value.profile).every((v) => typeof v === 'string') &&
    Array.isArray(value.modules) &&
    value.modules.length <= 100 &&
    value.modules.every(
      (m) =>
        !!m &&
        typeof m.id === 'string' &&
        Object.hasOwn(moduleNames, m.kind) &&
        typeof m.title === 'string' &&
        Array.isArray(m.entries) &&
        m.entries.length <= 500 &&
        m.entries.every(
          (e) =>
            !!e &&
            typeof e.id === 'string' &&
            e.fields &&
            Object.values(e.fields).every((v) => typeof v === 'string'),
        ),
    ) &&
    Array.isArray(value.extras) &&
    value.extras.every(
      (page) =>
        page &&
        Array.isArray(page.elements) &&
        page.elements.every((e) => e && typeof e.id === 'string'),
    ) &&
    typeof value.sceneSignature === 'string'
  );
}
export function getField(resume: ResumeDraft, entryId: string, field: string): string {
  if (entryId === 'profile') return resume.profile[field] || '';
  return (
    resume.modules.flatMap((m) => m.entries).find((e) => e.id === entryId)?.fields[field] || ''
  );
}
export function setField(resume: ResumeDraft, entryId: string, field: string, value: string): void {
  if (entryId === 'profile') resume.profile[field] = value;
  else {
    const entry = resume.modules.flatMap((m) => m.entries).find((e) => e.id === entryId);
    if (entry) entry.fields[field] = value;
  }
}
function bodyBlocks(entryId: string, html: string): ContentBlock[] {
  const clean = cleanRich(html);
  if (!richText(clean)) return [];
  if (typeof document === 'undefined')
    return [
      { id: `${entryId}:detailsHtml:0`, type: 'paragraph', text: richText(clean), html: clean },
    ];
  const node = document.createElement('div');
  node.innerHTML = clean;
  const blocks: ContentBlock[] = [];
  const add = (content: string, list = false) => {
    const text = richText(content);
    if (!text) return;
    blocks.push({
      id: `${entryId}:detailsHtml:${blocks.length}`,
      type: list ? 'list' : 'paragraph',
      text,
      html: content,
    });
  };
  let inline = '';
  const flush = () => {
    if (inline) add(inline);
    inline = '';
  };
  for (const child of [...node.childNodes]) {
    if (child instanceof HTMLElement && ['UL', 'OL'].includes(child.tagName)) {
      flush();
      for (const li of [...child.children]) add(li.innerHTML, true);
    } else if (child instanceof HTMLElement && ['DIV', 'P', 'LI'].includes(child.tagName)) {
      flush();
      add(child.innerHTML, child.tagName === 'LI');
    } else
      inline +=
        child instanceof HTMLElement ? child.outerHTML : escapeHtml(child.textContent || '');
  }
  flush();
  return blocks;
}
export function resumeBlocks(resume: ResumeDraft): ContentBlock[] {
  const p = resume.profile;
  const blocks: ContentBlock[] = [];
  if (p.photo && /^data:image\/(png|jpeg|webp|gif);base64,/i.test(p.photo))
    blocks.push({
      id: 'profile:photo',
      type: 'image',
      text: '证件照',
      src: p.photo,
      role: 'portrait',
    });
  if (p.name) blocks.push({ id: 'profile:name', type: 'heading', level: 1, text: p.name });
  if (p.headline)
    blocks.push({ id: 'profile:headline', type: 'paragraph', text: p.headline, role: 'contact' });
  const contacts = [p.phone, p.email, p.location, p.website, p.extra].filter(Boolean).join(' · ');
  if (contacts)
    blocks.push({ id: 'profile:contacts', type: 'paragraph', text: contacts, role: 'contact' });
  blocks.push(...bodyBlocks('profile', p.detailsHtml || ''));
  for (const module of resume.modules) {
    const content: ContentBlock[] = [];
    for (const entry of module.entries) {
      const f = entry.fields;
      const labels = [
        f.organization,
        module.kind === 'education' ? f.major : f.role,
        module.kind === 'education' ? f.degree : '',
        f.department,
        f.city,
      ].filter(Boolean);
      if (f.start || f.end) labels.push([f.start, f.end].filter(Boolean).join(' - '));
      if (labels.length)
        content.push({
          id: `${entry.id}:header`,
          type: 'paragraph',
          text: labels.join(' ｜ '),
          fields: labels,
          role: 'entry',
        });
      if (f.tech)
        content.push({ id: `${entry.id}:tech`, type: 'paragraph', text: `技术栈：${f.tech}` });
      if (f.link) content.push({ id: `${entry.id}:link`, type: 'paragraph', text: f.link });
      content.push(...bodyBlocks(entry.id, f.detailsHtml || ''));
    }
    if (content.length)
      blocks.push(
        { id: `${module.id}:heading`, type: 'heading', level: 2, text: module.title },
        ...content.map((b) => ({ ...b, section: module.title })),
      );
  }
  return blocks;
}
export function buildResume(
  resume: ResumeDraft,
  project: Project,
): { pages: EditorPage[]; blocks: ContentBlock[] } {
  const blocks = resumeBlocks(resume);
  const pages = blocks.length
    ? layoutContent(blocks, project.template, { ...defaultLayout, fontFamily: project.fontFamily })
    : [newPage()];
  for (const [index, page] of pages.entries()) {
    page.id = project.pages[index]?.id || page.id;
    for (const e of page.elements) {
      if (!e.blockId) continue;
      if (e.blockId.includes(':detailsHtml:'))
        e.formField = e.blockId.split(':detailsHtml:')[0] + ':detailsHtml';
      else if (e.blockId.startsWith('profile:')) e.formField = e.blockId;
      else if (e.blockId.endsWith(':heading'))
        e.formField = e.blockId.slice(0, -8) + ':moduleTitle';
      else e.formField = e.blockId;
      e.formList = blocks.find((block) => block.id === e.blockId)?.type === 'list';
      if (e.type === 'text' && e.blockId.endsWith(':header')) {
        const entryId = e.blockId.slice(0, -7),
          module = resume.modules.find((m) => m.entries.some((item) => item.id === entryId)),
          entry = module?.entries.find((item) => item.id === entryId);
        if (entry) {
          const text = richText(e.html);
          const keys = headerKeys(module!.kind, entry.fields);
          if (entry.fields.start || entry.fields.end)
            keys.push(
              entry.fields.start && entry.fields.end
                ? 'dates'
                : entry.fields.start
                  ? 'start'
                  : 'end',
            );
          const row = page.elements
            .filter((item) => item.type === 'text' && item.blockId === e.blockId)
            .sort((a, b) => a.x - b.x);
          if (row.length === keys.length) e.formField = entryId + ':' + keys[row.indexOf(e)];
          else if (
            entry.fields.start &&
            entry.fields.end &&
            text === `${entry.fields.start} - ${entry.fields.end}`
          )
            e.formField = entryId + ':dates';
        }
      }
    }
  }
  for (const [index, extra] of resume.extras.entries())
    if (extra.elements.length) {
      while (pages.length <= index) pages.push(newPage());
      const present = new Set(project.pages.flatMap((page) => page.elements).map((e) => e.id));
      const validExtras = clone(extra.elements.filter((e) => present.has(e.id)));
      const backgrounds = validExtras.filter(
        (e) => /背景/.test(e.name || '') && (e.type === 'image' || e.type === 'rect'),
      );
      pages[index].elements.unshift(...backgrounds);
      pages[index].elements.push(...validExtras.filter((e) => !backgrounds.includes(e)));
    }
  return { pages: resume.onePage ? [fitOnePage(pages).page] : pages, blocks };
}
export function resumeFromScene(resume: ResumeDraft, pages: EditorPage[]): ResumeDraft {
  const result = clone(resume),
    fields = new Map<string, CanvasElement[]>();
  for (const page of pages)
    for (const e of [...page.elements].sort((a, b) => a.y - b.y || a.x - b.x))
      if (e.type === 'text' && e.formField) {
        const list = fields.get(e.formField) || [];
        list.push(e);
        fields.set(e.formField, list);
      }
  if (!fields.has('profile:name')) result.profile.name = '';
  if (!fields.has('profile:headline')) result.profile.headline = '';
  if (!fields.has('profile:detailsHtml')) result.profile.detailsHtml = '';
  if (!fields.has('profile:contacts'))
    for (const key of ['phone', 'email', 'website', 'location', 'extra']) result.profile[key] = '';
  for (const module of result.modules)
    for (const entry of module.entries) {
      for (const key of ['detailsHtml', 'tech', 'link'])
        if (!fields.has(`${entry.id}:${key}`)) entry.fields[key] = '';
      if (!fields.has(`${entry.id}:header`))
        for (const key of ['organization', 'role', 'major', 'degree', 'department', 'city'])
          if (!fields.has(`${entry.id}:${key}`)) entry.fields[key] = '';
      if (!fields.has(`${entry.id}:dates`) && !fields.has(`${entry.id}:header`))
        for (const key of ['start', 'end'])
          if (!fields.has(`${entry.id}:${key}`)) entry.fields[key] = '';
    }
  const photo = pages
    .flatMap((page) => page.elements)
    .find((e) => e.type === 'image' && e.formField === 'profile:photo');
  if (photo?.src) result.profile.photo = photo.src;
  else delete result.profile.photo;
  for (const [key, elements] of fields) {
    const split = key.lastIndexOf(':'),
      entryId = key.slice(0, split),
      field = key.slice(split + 1);
    if (field === 'moduleTitle') {
      const module = result.modules.find((m) => m.id === entryId);
      if (module) module.title = elements.map((e) => richText(e.html)).join(' ');
    } else if (field === 'detailsHtml')
      setField(result, entryId, field, richFromElements(elements));
    else if (field === 'dates') {
      const date = parseDates(elements.map((e) => richText(e.html)).join(' '));
      setField(result, entryId, 'start', date.start);
      setField(result, entryId, 'end', date.end);
    } else if (field === 'header') {
      const entry = result.modules.flatMap((m) => m.entries).find((e) => e.id === entryId);
      if (entry) {
        const text = elements.map((e) => richText(e.html)).join(' ｜ ');
        const module = result.modules.find((m) => m.entries.some((e) => e.id === entryId))!;
        const keys = headerKeys(module.kind, entry.fields),
          parts = text.split(/\s*｜\s*/);
        if (!fields.has(`${entryId}:dates`)) {
          if (entry.fields.start) keys.push('start');
          if (entry.fields.end) keys.push('end');
        }
        keys.forEach((key, index) => (entry.fields[key] = parts[index] || ''));
      }
    } else if (entryId === 'profile' && field === 'contacts') {
      const text = elements.map((e) => richText(e.html)).join(' · ');
      fillContacts(result.profile, text);
    } else
      setField(
        result,
        entryId,
        field,
        elements
          .map((e) => richText(e.html))
          .join(' ')
          .replace(/^技术栈[：:]\s*/, ''),
      );
  }
  return result;
}
function richFromElements(elements: CanvasElement[]): string {
  const groups: { blockId?: string; list: boolean; html: string }[] = [];
  for (const e of elements) {
    const html = cleanRich(e.html.replace(/^•\s*/, '')),
      previous = groups.at(-1);
    if (previous && e.blockId && previous.blockId === e.blockId) previous.html += ' ' + html;
    else groups.push({ blockId: e.blockId, list: !!e.formList, html });
  }
  let result = '',
    list = '';
  const flush = () => {
    if (list) result += '<ul>' + list + '</ul>';
    list = '';
  };
  for (const group of groups) {
    if (group.list) list += `<li>${group.html}</li>`;
    else {
      flush();
      result += `<p>${group.html}</p>`;
    }
  }
  flush();
  return result;
}

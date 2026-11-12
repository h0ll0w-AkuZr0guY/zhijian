import {
  element,
  escapeHtml,
  id,
  MM,
  newPage,
  PAGE_HEIGHT,
  PAGE_WIDTH,
  type ContentBlock,
  type EditorPage,
} from '../core/model';
import { normalizeContent } from '../importers/structure';

export interface Template {
  id: string;
  name: string;
  description: string;
  accent: string;
  kind: 'resume' | 'document';
  sidebar?: boolean;
  serif?: boolean;
}
export const templates: Template[] = [
  {
    id: 'clean',
    name: '简洁单栏',
    description: '清晰克制，适合通用求职与网申',
    accent: '#246b53',
    kind: 'resume',
  },
  {
    id: 'tech',
    name: '技术项目',
    description: '强调项目、技能与工程经历',
    accent: '#2863aa',
    kind: 'resume',
  },
  {
    id: 'academic',
    name: '学术科研',
    description: '适合研究经历、论文与学术成果',
    accent: '#5c496f',
    kind: 'resume',
    serif: true,
  },
  {
    id: 'sidebar',
    name: '双栏信息',
    description: '侧栏展示联系方式与技能',
    accent: '#315b64',
    kind: 'resume',
    sidebar: true,
  },
  {
    id: 'notice',
    name: '通知公告',
    description: '醒目标题与清楚的分段层级',
    accent: '#a13c36',
    kind: 'document',
  },
  {
    id: 'letter',
    name: '求职信 / 正文',
    description: '适合书信、说明与简短报告',
    accent: '#605542',
    kind: 'document',
    serif: true,
  },
  {
    id: 'project',
    name: '项目介绍',
    description: '适合项目概览、方案和报告封面',
    accent: '#287b86',
    kind: 'document',
  },
];
export const demoResume = `# 林知远

软件工程师 · 示例人物

杭州 · 138 0000 0000 · hello@example.com · github.com/example

## 个人简介

关注用户体验与工程质量，擅长将复杂需求拆解为清晰、可靠的产品功能。此文档使用虚构内容，可直接修改为自己的资料。

## 教育经历

**示例大学** ｜ 软件工程 · 本科 ｜ 2020.09—2024.06

主修数据结构、操作系统、数据库与软件工程，参与校内开源项目维护。

## 工作经历

**星禾科技（示例）** ｜ 前端开发工程师 ｜ 2024.07—至今

- 参与企业协作平台建设，完成文档编辑、数据可视化和权限管理等功能。
- 梳理组件规范与交互流程，通过性能分析和可用性测试持续改善使用体验。
- 建立自动化检查与回归测试，将问题定位、修复与发布流程纳入团队协作规范。

## 项目经历

**纸间 · 自由文档工作台** ｜ TypeScript / PDF / OCR

- 实现 A4 画布、图层、多选、组合和可撤销的排版操作。
- 支持 Markdown、PDF 与图片导入，校对内容后一键套用模板。
- 在浏览器内处理文档，通过工程文件与 PDF 导出分享成果。

## 专业技能

TypeScript、JavaScript、HTML / CSS、Git、自动化测试、产品交互与团队协作。

## 荣誉与其他

示例开源项目贡献者 · 校级创新项目优秀团队成员
`;
export const demoNotice = `# 关于开展工作坊的通知

## 活动安排

欢迎参加本次文档设计与信息整理工作坊，共同实践从内容到版式的完整流程。

- 时间：2026 年 12 月 1 日 14:00—16:00
- 地点：示例会议室 / 线上会议
- 对象：对文档设计感兴趣的参与者

## 参与方式

请提前准备一份需要整理的文档，在活动中完成识别、校对、排版与导出。

## 联系方式

活动协调组 · hello@example.com
`;
export interface LayoutOptions {
  margin: number;
  fontSize: number;
  onePage: boolean;
  minFontSize: number;
  fontFamily?: string;
}
export const defaultLayout: LayoutOptions = {
  margin: 12,
  fontSize: 10.5,
  onePage: true,
  minFontSize: 9,
};

function linesFor(
  text: string,
  width: number,
  fontSize: number,
  bold = false,
  family = 'Noto Sans SC',
): string[] {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d')!;
  context.font = `${bold ? '700' : '400'} ${(fontSize * 96) / 72}px "${family}", sans-serif`;
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const char of Array.from(paragraph)) {
      if (line && context.measureText(line + char).width > width) {
        lines.push(line);
        line = '';
      }
      line += char;
    }
    lines.push(line);
  }
  return lines;
}

function arrange(blocks: ContentBlock[], template: Template, options: LayoutOptions): EditorPage[] {
  const pages: EditorPage[] = [];
  const margin = options.margin * MM;
  const fullWidth = PAGE_WIDTH - margin * 2;
  const sidebar = template.sidebar ? 180 : 0;
  const mainX = margin + (sidebar ? sidebar + 22 : 0);
  const mainWidth = fullWidth - (sidebar ? sidebar + 22 : 0);
  let page: EditorPage,
    y = margin + 14,
    sideY = margin + 125;
  const addPage = () => {
    page = newPage();
    pages.push(page);
    y = margin + 14;
    sideY = margin + 125;
    page.elements.push(
      element('rect', {
        x: 0,
        y: 0,
        w: PAGE_WIDTH,
        h: 8,
        fill: template.accent,
        locked: true,
        name: '模板页顶装饰',
      }),
    );
    if (sidebar)
      page.elements.push(
        element('rect', {
          x: margin - 12,
          y: margin,
          w: sidebar + 14,
          h: PAGE_HEIGHT - margin * 2,
          fill: '#edf3f1',
          locked: true,
          name: '模板侧栏背景',
        }),
      );
  };
  addPage();
  const portrait =
    template.kind === 'resume'
      ? blocks.find((block) => block.type === 'image' && block.role === 'portrait' && block.src)
      : undefined;
  const firstSection = blocks.findIndex(
    (block) => block.type === 'heading' && (block.level || 2) > 1,
  );
  const headerIds = new Set(
    blocks
      .slice(0, firstSection < 0 ? blocks.length : firstSection)
      .filter((block) => block.type !== 'image')
      .map((block) => block.id),
  );
  if (portrait)
    page!.elements.push(
      element('image', {
        x: PAGE_WIDTH - margin - 82,
        y: margin + 14,
        w: 82,
        h: 104,
        src: portrait.src,
        objectFit: 'cover',
        blockId: portrait.id,
        name: '证件照',
      }),
    );
  for (const block of blocks) {
    if (block === portrait) continue;
    const firstTitle = block.type === 'heading' && block.level === 1;
    const heading = block.type === 'heading';
    if (template.kind === 'resume' && heading && !firstTitle && portrait && pages.length === 1)
      y = Math.max(y, margin + 126);
    const isSide =
      !!sidebar &&
      !firstTitle &&
      (/基本信息|联系方式|专业技能|个人技能/.test(block.section || '') ||
        (pages.length === 1 && y < margin + 120 && !heading));
    const x = firstTitle ? margin : isSide ? margin : mainX;
    const headerWidth =
      portrait && pages.length === 1 && headerIds.has(block.id) ? fullWidth - 104 : fullWidth;
    const width = firstTitle
      ? headerWidth
      : isSide
        ? sidebar - 10
        : headerIds.has(block.id) && portrait
          ? headerWidth
          : mainWidth;
    const fontSize = firstTitle
      ? template.kind === 'document'
        ? 25
        : 23
      : heading
        ? options.fontSize + 2
        : options.fontSize;
    const lineHeight = heading ? 1.3 : template.kind === 'resume' ? 1.32 : 1.55;
    const prefix =
      block.type === 'list' && !/^(?:[•●▪◦·]|\d{1,2}[.、)）])\s*/.test(block.text) ? '• ' : '';
    const text = prefix + block.text;
    if (block.role === 'entry' && block.fields?.length) {
      const date = block.fields.find((field) => /^(?:19|20)\d{2}.*[-—–~至]/.test(field));
      const fields = block.fields.filter((field) => field !== date);
      const dateWidth = date ? Math.min(148, width * 0.27) : 0;
      const bodyWidth = width - (date ? dateWidth + 16 : 0);
      const joined = fields.join(' ｜ '),
        entryLines = linesFor(joined, bodyWidth, fontSize, false, options.fontFamily);
      const height = ((entryLines.length * fontSize * 96) / 72) * lineHeight + 2;
      if (y + height > PAGE_HEIGHT - margin) addPage();
      const measure = document.createElement('canvas').getContext('2d')!;
      measure.font = `${(fontSize * 96) / 72}px "${options.fontFamily || 'Noto Sans SC'}"`;
      const widths = fields.map((field) => measure.measureText(field).width + 4);
      if (
        widths.reduce((sum, value) => sum + value, 0) + Math.max(0, fields.length - 1) * 14 <=
        bodyWidth
      ) {
        let fieldX = x;
        fields.forEach((field, index) => {
          page!.elements.push(
            element('text', {
              x: fieldX,
              y,
              w: widths[index],
              h: height,
              fontSize,
              lineHeight,
              html: escapeHtml(field),
              bold: index === 0,
              blockId: block.id,
              name: field.slice(0, 35),
            }),
          );
          fieldX += widths[index] + 14;
        });
      } else
        page!.elements.push(
          element('text', {
            x,
            y,
            w: bodyWidth,
            h: height,
            fontSize,
            lineHeight,
            html: escapeHtml(joined),
            blockId: block.id,
            name: joined.slice(0, 35),
          }),
        );
      if (date)
        page!.elements.push(
          element('text', {
            x: x + width - dateWidth,
            y,
            w: dateWidth,
            h: height,
            fontSize: fontSize - 0.5,
            lineHeight,
            textAlign: 'right',
            html: escapeHtml(date),
            color: '#748078',
            blockId: block.id,
            name: date,
          }),
        );
      y += height + 5;
      continue;
    }
    if (block.type === 'image' && block.src) {
      const height = 130;
      if (y + height > PAGE_HEIGHT - margin) addPage();
      page!.elements.push(
        element('image', {
          x: mainX,
          y,
          w: Math.min(180, mainWidth),
          h: height,
          src: block.src,
          objectFit: 'contain',
          blockId: block.id,
          name: block.text,
        }),
      );
      y += height + 12;
      continue;
    }
    const lines = linesFor(text, width, fontSize, heading, options.fontFamily);
    const linePixels = ((fontSize * 96) / 72) * lineHeight;
    const reserve = heading ? linePixels + 45 : linePixels;
    if (!isSide && y + reserve > PAGE_HEIGHT - margin) addPage();
    if (isSide && sideY + lines.length * linePixels > PAGE_HEIGHT - margin) {
      sideY = margin + 30;
      addPage();
    }
    let cursor = 0;
    while (cursor < lines.length) {
      const currentY = isSide ? sideY : y;
      const available = Math.max(1, Math.floor((PAGE_HEIGHT - margin - currentY - 8) / linePixels));
      const take = Math.min(available, lines.length - cursor);
      const slice = lines.slice(cursor, cursor + take);
      const complete = cursor === 0 && take === lines.length;
      const html =
        complete && block.html ? escapeHtml(prefix) + block.html : escapeHtml(slice.join('\n'));
      const height = Math.max(linePixels, take * linePixels + 2);
      if (heading && !firstTitle)
        page!.elements.push(
          element('line', {
            x,
            y: currentY - 6,
            w: width,
            h: 1,
            color: template.accent,
            blockId: block.id,
          }),
        );
      page!.elements.push(
        element('text', {
          x,
          y: currentY,
          w: width,
          h: height,
          html,
          fontSize,
          lineHeight,
          bold: heading,
          color: heading ? template.accent : '#28372f',
          fontFamily:
            template.serif && /[A-Za-z]/.test(block.text) && !/[\u4e00-\u9fff]/.test(block.text)
              ? 'Georgia'
              : 'Noto Sans SC',
          blockId: block.id,
          name: block.text.slice(0, 35),
          whiteSpace: 'pre-wrap',
        }),
      );
      const gap = template.kind === 'resume' ? (block.role === 'contact' ? 2 : 4) : 9;
      if (isSide) sideY += height + (heading ? 10 : gap);
      else y += height + (firstTitle ? 10 : heading ? 8 : gap);
      cursor += take;
      if (cursor < lines.length) addPage();
    }
  }
  pages.forEach((current, index) => {
    if (pages.length > 1)
      current.elements.push(
        element('text', {
          x: PAGE_WIDTH - margin - 70,
          y: PAGE_HEIGHT - margin + 8,
          w: 70,
          h: 18,
          fontSize: 8,
          color: '#8c978f',
          textAlign: 'right',
          html: `${index + 1} / ${pages.length}`,
          locked: true,
          name: '页码',
        }),
      );
    current.id ||= id();
  });
  if (options.fontFamily)
    for (const current of pages)
      for (const e of current.elements) if (e.type === 'text') e.fontFamily = options.fontFamily;
  return pages;
}
export function layoutContent(
  blocks: ContentBlock[],
  templateId: string,
  options = defaultLayout,
): EditorPage[] {
  blocks = normalizeContent(blocks);
  const template = templates.find((item) => item.id === templateId) || templates[0];
  let size = options.fontSize;
  let pages = arrange(blocks, template, { ...options, fontSize: size });
  while (options.onePage && pages.length > 1 && size > options.minFontSize) {
    size = Math.max(options.minFontSize, size - 0.5);
    pages = arrange(blocks, template, { ...options, fontSize: size });
  }
  return pages;
}
export function inferSections(blocks: ContentBlock[]): ContentBlock[] {
  let section = '基本信息';
  return blocks.map((block) => {
    if (block.type === 'heading' && (block.level || 2) > 1) section = block.text;
    return { ...block, section: block.section || section };
  });
}

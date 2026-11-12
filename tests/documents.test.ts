import { describe, expect, it } from 'vitest';
import { element, escapeHtml, newPage, newProject, packProject } from '../src/core/model';
import { parseMarkdown, toMarkdown } from '../src/importers/markdown';
import { inferSections, templates } from '../src/layout/templates';
import { readFileSync } from 'node:fs';
import { createFont } from 'fonteditor-core';
import { subsetFont } from '../src/exporters/fonts';

describe('Markdown content import', () => {
  it('preserves headings, emphasis and list entries', () => {
    const blocks = parseMarkdown('# 林同学\n\n## 工作经历\n\n**示例公司**\n\n- 项目 A\n- 项目 B');
    expect(blocks.map((block) => block.type)).toEqual([
      'heading',
      'heading',
      'paragraph',
      'list',
      'list',
    ]);
    expect(blocks[2].html).toBe('<b>示例公司</b>');
    expect(blocks[0].level).toBe(1);
  });
  it('retains links and GFM tables for roundtrip export', () => {
    const source =
      '[作品](https://example.com)\n\n| 技能 | 水平 |\n| --- | --- |\n| TypeScript | 熟练 |';
    const result = toMarkdown(parseMarkdown(source));
    expect(result).toContain('[作品](https://example.com)');
    expect(result).toContain('| --- | --- |');
    expect(result).toContain('TypeScript');
  });
  it('excludes raw HTML from imported content', () => {
    expect(parseMarkdown('<script>alert(1)</script>\n\n正文').map((block) => block.text)).toEqual([
      '正文',
    ]);
  });
  it('assigns resume section context without discarding text', () => {
    const blocks = inferSections(parseMarkdown('# 示例\n\n## 教育经历\n\n某大学'));
    expect(blocks.at(-1)?.section).toBe('教育经历');
    expect(blocks.at(-1)?.text).toBe('某大学');
  });
});
describe('Portable project data', () => {
  it('creates separate identities for new projects and pages', () => {
    const a = newProject(),
      b = newProject();
    expect(a.id).not.toBe(b.id);
    expect(a.pages[0].id).not.toBe(b.pages[0].id);
  });
  it('deduplicates embedded images while preserving the live project', () => {
    const project = newProject();
    project.pages.push(newPage());
    const image = 'data:image/png;base64,example';
    project.pages[0].elements.push(element('image', { src: image }));
    project.pages[1].elements.push(element('image', { src: image }));
    const packed = packProject(project);
    expect(Object.keys(packed.assets || {})).toHaveLength(1);
    expect(packed.pages[0].elements[0].src).toBeUndefined();
    expect(packed.pages[0].elements[0].assetId).toBe(packed.pages[1].elements[0].assetId);
    expect(project.pages[0].elements[0].src).toBe(image);
  });
  it('preserves grouping metadata during packing', () => {
    const project = newProject();
    project.pages[0].elements.push(element('rect', { groupId: 'example-group' }));
    expect(packProject(project).pages[0].elements[0].groupId).toBe('example-group');
  });
  it('escapes source text before HTML rendering', () => {
    expect(escapeHtml('<img src="x">')).toBe('&lt;img src=&quot;x&quot;&gt;');
  });
  it('includes resume and general document templates with stable identifiers', () => {
    expect(new Set(templates.map((template) => template.id)).size).toBe(templates.length);
    expect(templates.filter((template) => template.kind === 'resume')).toHaveLength(4);
    expect(templates.some((template) => template.id === 'notice')).toBe(true);
  });
});
describe('Chinese PDF font embedding', () => {
  it('retains requested CJK and Latin glyphs in a compact complete TTF', () => {
    const source = Uint8Array.from(readFileSync('public/fonts/NotoSansSC-Regular.ttf')).buffer;
    const result = subsetFont(source, '纸间 中文简历 TypeScript');
    const font = createFont(result, { type: 'ttf' }).get();
    expect(result.byteLength).toBeLessThan(source.byteLength / 50);
    for (const char of Array.from('纸间中文简历TypeScript'))
      expect(font.cmap[char.codePointAt(0)!]).toBeGreaterThan(0);
  });
});

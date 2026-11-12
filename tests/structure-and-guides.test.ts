import { describe, expect, it } from 'vitest';
import {
  reconstructText,
  reconstructPages,
  normalizeContent,
  mergeTextElements,
  type TextFragment,
} from '../src/importers/structure';
import {
  baselineOffset,
  bindRow,
  boundMoveMembers,
  detachGuide,
  guideY,
  remapRowReferences,
  synchronizeRows,
} from '../src/core/guides';
import { clone, element, newProject, packProject } from '../src/core/model';

const fragment = (
  text: string,
  x: number,
  y: number,
  w: number,
  values: Partial<TextFragment> = {},
): TextFragment => ({
  id: crypto.randomUUID(),
  text,
  x,
  y,
  w,
  h: 16,
  fontSize: 10.5,
  baseline: y + 13,
  ...values,
});
describe('PDF paragraph recovery', () => {
  it('merges mixed-style inline fragments and wrapped continuation into a whole editable item', () => {
    const input = [
      fragment('1.', 40, 100, 12),
      fragment('Build a reliable document pipeline with ', 62, 100, 260, { bold: true }),
      fragment('search and validation', 325, 100, 180),
      fragment('and preserve all original content.', 62, 118, 300),
    ];
    const result = reconstructText(input, 1);
    expect(result.elements).toHaveLength(1);
    expect(result.blocks).toHaveLength(1);
    expect(result.elements[0].html).toContain('preserve all original content');
    expect(result.elements[0].html).toContain('<b>');
    expect(result.blocks[0].type).toBe('list');
  });
  it('keeps school, subject and date independently editable while creating one semantic entry', () => {
    const result = reconstructText(
      [
        fragment('示例大学', 45, 100, 86),
        fragment('计算机科学', 148, 100, 120),
        fragment('2024.09 - 2027.06', 550, 100, 145),
      ],
      1,
    );
    expect(result.elements).toHaveLength(3);
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0].role).toBe('entry');
    expect(result.blocks[0].fields).toHaveLength(3);
    expect(new Set(result.elements.map((e) => e.blockId)).size).toBe(1);
  });
  it('does not turn contact separators into independent list paragraphs', () => {
    const result = reconstructText(
      [
        fragment('13800000000', 80, 70, 95),
        fragment('·', 190, 70, 3),
        fragment('hello@example.com', 215, 70, 160),
        fragment('· 联系方式', 395, 70, 80),
      ],
      1,
    );
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0].role).toBe('contact');
    expect(result.blocks[0].text).toContain('hello@example.com');
    expect(result.blocks[0].type).toBe('paragraph');
  });
  it('orders section titles by coordinates even if they occur last in the PDF stream', () => {
    const result = reconstructText(
      [
        fragment('Some content with a substantial sentence.', 45, 140, 450),
        fragment('教 育 经 历', 45, 110, 100),
        fragment('示例姓名', 45, 40, 160, { fontSize: 20 }),
      ],
      1,
    );
    expect(result.blocks.map((e) => e.text)).toEqual([
      '示例姓名',
      '教育经历',
      'Some content with a substantial sentence.',
    ]);
    expect(result.blocks[0].level).toBe(1);
    expect(result.blocks[1].type).toBe('heading');
  });
  it('keeps adjacent column paragraphs separate', () => {
    const result = reconstructText(
      [
        fragment('First column contains a complete long paragraph with details.', 40, 100, 280),
        fragment('Second column contains another independent paragraph of details.', 450, 100, 280),
      ],
      1,
    );
    expect(result.elements).toHaveLength(2);
  });
  it('does not insert spaces between letter-spaced Chinese name glyphs', () => {
    const result = reconstructText(
      [
        fragment('林', 100, 30, 24, { fontSize: 18 }),
        fragment('同', 128, 30, 24, { fontSize: 18 }),
        fragment('学', 156, 30, 24, { fontSize: 18 }),
      ],
      1,
    );
    expect(result.blocks[0].text).toBe('林同学');
  });
  it('can merge a user selection into a single text box', () => {
    const merged = mergeTextElements([
      element('text', { x: 40, y: 40, w: 100, h: 20, html: 'School' }),
      element('text', { x: 160, y: 40, w: 100, h: 20, html: 'Subject' }),
    ]);
    expect(merged.html).toContain('School');
    expect(merged.html).toContain('Subject');
    expect(merged.w).toBe(220);
  });
  it('retains styles and guide relationships when repairing an already editable row', () => {
    const school = element('text', { id: 'school', html: '示例大学', x: 40, y: 100, w: 90 });
    const date = element('text', { html: '2022.09 - 2026.06', x: 550, y: 100, w: 180 });
    bindRow(school, [date]);
    const result = reconstructPages([{ id: 'page', background: '#fff', elements: [school, date] }]);
    expect(result.pages[0].elements.find((e) => e.id === school.id)?.rowGuide).toBe(true);
    expect(result.pages[0].elements.find((e) => e.id === date.id)?.rowAnchorId).toBe(school.id);
    expect(result.pages[0].elements[0].lineHeight).toBe(school.lineHeight);
  });
  it('updates metadata fields after editing a row in the correction dialog', () => {
    const [block] = normalizeContent([
      {
        id: 'entry',
        type: 'paragraph',
        role: 'entry',
        text: '更正大学 ｜ 软件工程 ｜ 2023.09 - 2027.06',
        fields: ['旧名称', '旧专业', '2020.09 - 2024.06'],
      },
    ]);
    expect(block.fields).toEqual(['更正大学', '软件工程', '2023.09 - 2027.06']);
  });
  it('preserves original Markdown list formatting when recovering an existing canvas', () => {
    const result = reconstructPages(
      [
        {
          id: 'page',
          background: '#fff',
          elements: [element('text', { html: '• 项目内容', blockId: 'item' })],
        },
      ],
      [{ id: 'item', type: 'list', text: '项目内容', markdown: '- **项目内容**' }],
    );
    expect(result.blocks[0].markdown).toBe('- **项目内容**');
    expect(result.blocks[0].text).toBe('项目内容');
  });
});
describe('Persistent virtual row binding', () => {
  it('aligns different font sizes on one baseline and moves followers with the anchor', () => {
    const anchor = element('text', { id: 'school', x: 50, y: 100, fontSize: 14 });
    const child = element('text', { id: 'date', x: 550, y: 130, fontSize: 10 });
    bindRow(anchor, [child]);
    expect(guideY(child)).toBeCloseTo(guideY(anchor));
    const before = clone([anchor, child]);
    anchor.x += 20;
    anchor.y += 35;
    synchronizeRows([anchor, child], before);
    expect(child.x).toBe(570);
    expect(guideY(child)).toBeCloseTo(guideY(anchor));
  });
  it('does not apply a translation twice when both fields were moved', () => {
    const anchor = element('text', { id: 'school' }),
      child = element('text', { id: 'date', x: 500 });
    bindRow(anchor, [child]);
    const before = clone([anchor, child]);
    anchor.x += 20;
    child.x += 20;
    synchronizeRows([anchor, child], before);
    expect(child.x).toBe(520);
  });
  it('respects locked followers and expands the movement set only from an anchor', () => {
    const anchor = element('text', { id: 'school' }),
      child = element('text', { id: 'date' }),
      locked = element('text', { id: 'locked', locked: true });
    bindRow(anchor, [child]);
    locked.rowAnchorId = anchor.id;
    expect(boundMoveMembers([anchor], [anchor, child, locked]).map((e) => e.id)).toEqual([
      'school',
      'date',
    ]);
    expect(boundMoveMembers([child], [anchor, child]).map((e) => e.id)).toEqual(['date']);
  });
  it('removes dangling bindings and can explicitly detach a row', () => {
    const anchor = element('text', { id: 'school' }),
      child = element('text', { id: 'date' });
    bindRow(anchor, [child]);
    synchronizeRows([child]);
    expect(child.rowAnchorId).toBeUndefined();
    bindRow(anchor, [child]);
    detachGuide(anchor, [anchor, child]);
    expect(child.rowAnchorId).toBeUndefined();
    expect(anchor.rowGuide).toBeUndefined();
  });
  it('copies row references to the new anchor and detaches a child copied alone', () => {
    const anchor = element('text', { id: 'school' }),
      child = element('text', { id: 'date' });
    bindRow(anchor, [child]);
    const copies = [
      { ...anchor, id: 'school-copy' },
      { ...child, id: 'date-copy' },
    ];
    remapRowReferences(copies, [anchor, child]);
    expect(copies[1].rowAnchorId).toBe('school-copy');
    const childOnly = [{ ...child, id: 'date-alone' }];
    remapRowReferences(childOnly, [child]);
    expect(childOnly[0].rowAnchorId).toBeUndefined();
  });
  it('includes binding metadata in saved project data', () => {
    const project = newProject(),
      anchor = element('text'),
      child = element('text');
    bindRow(anchor, [child]);
    project.pages[0].elements.push(anchor, child);
    expect(packProject(project).pages[0].elements[1].rowAnchorId).toBe(anchor.id);
    expect(baselineOffset(child)).toBeGreaterThan(0);
  });
});

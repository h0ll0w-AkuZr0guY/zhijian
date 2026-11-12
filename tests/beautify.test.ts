import { describe, expect, it } from 'vitest';
import { clone, element, newPage, PAGE_HEIGHT } from '../src/core/model';
import { bindRow, guideY } from '../src/core/guides';
import { beautifyPages, beautyThemes } from '../src/layout/beautify';

describe('One-click scene beautification', () => {
  it('preserves text, identities, images and page structure while applying typography', () => {
    const page = newPage();
    page.elements = [
      element('text', { html: '示例姓名', fontSize: 22, x: 40, y: 40, w: 300, h: 40 }),
      element('text', { html: '教育经历', fontSize: 12, x: 43, y: 100, w: 300, h: 24 }),
      element('text', { html: '示例大学 软件工程', x: 41, y: 130, w: 400, h: 30 }),
      element('image', { src: 'data:image/png;base64,example', x: 600, y: 40, w: 90, h: 110 }),
    ];
    const original = clone(page);
    const result = beautifyPages([page], [], 'blue');
    expect(page).toEqual(original);
    expect(result.pages).toHaveLength(1);
    expect(result.changed).toBe(3);
    expect(result.pages[0].elements.map((e) => [e.id, e.html, e.src])).toEqual(
      page.elements.map((e) => [e.id, e.html, e.src]),
    );
    expect(result.pages[0].elements[0].color).toBe(beautyThemes.blue.accent);
    expect(result.pages[0].elements[1].bold).toBe(true);
    expect(result.pages[0].elements[3]).toEqual(page.elements[3]);
  });
  it('aligns nearby columns and normalizes the gap between paragraphs', () => {
    const page = newPage();
    page.elements = [
      element('text', { html: '第一段内容', x: 40, y: 40, w: 400, h: 25 }),
      element('text', { html: '第二段内容', x: 43, y: 80, w: 400, h: 25 }),
    ];
    const [first, second] = beautifyPages([page], [], 'green').pages[0].elements;
    expect(first.x).toBe(second.x);
    expect(second.y - first.y - first.h).toBeCloseTo(5);
  });
  it('keeps locked content and locked bound rows intact', () => {
    const page = newPage();
    const anchor = element('text', { html: '学校', x: 40, y: 200 });
    const date = element('text', { html: '2022 - 2026', x: 500, y: 200 });
    bindRow(anchor, [date]);
    date.locked = true;
    page.elements = [
      anchor,
      date,
      element('text', { html: '锁定内容', locked: true, y: 400 }),
      element('text', { html: '自由内容', y: 500 }),
    ];
    const result = beautifyPages([page], [], 'ink');
    expect(result.changed).toBe(1);
    expect(result.pages[0].elements.slice(0, 3)).toEqual(page.elements.slice(0, 3));
  });
  it('preserves bindings and aligns the row after font changes', () => {
    const page = newPage();
    const anchor = element('text', { html: '学校', x: 40, y: 200 });
    const date = element('text', { html: '2022.09 - 2026.06', x: 500, y: 200, fontSize: 9 });
    bindRow(anchor, [date]);
    page.elements = [anchor, date];
    const [nextAnchor, nextDate] = beautifyPages([page], [], 'green').pages[0].elements;
    expect(nextAnchor.id).toBe(anchor.id);
    expect(nextDate.rowAnchorId).toBe(anchor.id);
    expect(guideY(nextDate)).toBeCloseTo(guideY(nextAnchor));
  });
  it('restricts a selected-element operation to the selection', () => {
    const page = newPage();
    page.elements = [
      element('text', { html: '所选文字', y: 100 }),
      element('text', { html: '其他文字', y: 300 }),
    ];
    const result = beautifyPages([page], [], 'green', new Set([page.elements[0].id]));
    expect(result.changed).toBe(1);
    expect(result.pages[0].elements[1]).toEqual(page.elements[1]);
  });
  it('fits a dense page to its existing boxes instead of introducing overflow', () => {
    const page = newPage();
    page.elements = [element('text', { html: '底部内容', y: PAGE_HEIGHT - 30, h: 25, w: 400 })];
    const result = beautifyPages([page], [], 'blue');
    expect(result.pages[0].elements[0].y + result.pages[0].elements[0].h).toBeLessThanOrEqual(
      PAGE_HEIGHT,
    );
    expect(result.pages[0].elements[0].html).toBe(page.elements[0].html);
  });
  it('keeps a heading decoration attached to the heading when spacing changes', () => {
    const page = newPage();
    page.elements = [
      element('text', { html: '上段内容', y: 40, w: 400, h: 25 }),
      element('text', { html: '教育经历', y: 80, w: 400, h: 25, blockId: 'heading' }),
      element('line', { y: 74, w: 400, h: 1, blockId: 'heading' }),
    ];
    const result = beautifyPages(
      [page],
      [{ id: 'heading', type: 'heading', level: 2, text: '教育经历' }],
      'green',
    );
    const [, heading, line] = result.pages[0].elements;
    expect(heading.y - line.y).toBe(6);
    expect(line.color).toBe(beautyThemes.green.accent);
  });
});

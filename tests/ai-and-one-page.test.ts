import { afterEach, describe, expect, it, vi } from 'vitest';
import { element, newPage, clone, PAGE_HEIGHT, PAGE_WIDTH } from '../src/core/model';
import { fitOnePage } from '../src/layout/one-page';
import { chatEndpoint, complete, readJson } from '../src/ai/client';
import { parseEdits } from '../src/ai/edits';

afterEach(() => vi.unstubAllGlobals());
describe('Smart one-page layout', () => {
  it('packs occupied page areas without losing editable content or bindings', () => {
    const first = newPage(),
      second = newPage();
    first.elements = [
      element('text', { id: 'school', html: '示例学校', x: 40, y: 100, h: 30, rowGuide: true }),
      element('text', {
        id: 'date',
        html: '2022 - 2026',
        x: 500,
        y: 100,
        w: 200,
        h: 30,
        rowAnchorId: 'school',
      }),
    ];
    second.elements = [
      element('text', { html: '后续内容', x: 40, y: 700, h: 30 }),
      element('text', { html: '2 / 2', name: '页码' }),
    ];
    const original = clone([first, second]);
    const result = fitOnePage([first, second]);
    expect([first, second]).toEqual(original);
    expect(result.page.elements).toHaveLength(3);
    expect(result.page.elements[1].rowAnchorId).toBe('school');
    expect(result.page.elements[2].y - result.page.elements[0].y).toBeCloseTo(42);
    expect(result.scale).toBe(1);
  });
  it('scales all geometry and fonts consistently when content exceeds one page', () => {
    const pages = [newPage(), newPage()];
    pages.forEach((page) =>
      page.elements.push(
        element('text', {
          x: 40,
          y: 40,
          w: 700,
          h: 1000,
          fontSize: 12,
          strokeWidth: 2,
          hangingIndent: 18,
          html: '<span style="font-size:14pt">完整内容</span>',
        }),
      ),
    );
    const result = fitOnePage(pages);
    expect(result.scale).toBeLessThan(1);
    expect(result.page.elements[0].fontSize).toBeCloseTo(12 * result.scale);
    expect(result.page.elements[0].hangingIndent).toBeCloseTo(18 * result.scale);
    expect(result.page.elements[0].html).toContain(String(14 * result.scale));
    for (const e of result.page.elements) expect(e.y + e.h).toBeLessThanOrEqual(PAGE_HEIGHT);
  });
  it('accounts for rotated shapes and handles empty pages', () => {
    const page = newPage();
    page.elements = [element('rect', { x: 500, y: 900, w: 300, h: 250, rotation: 45 })];
    const result = fitOnePage([page]);
    const e = result.page.elements[0],
      extent = (e.w + e.h) / Math.sqrt(2);
    expect(e.x + e.w / 2 + extent / 2).toBeLessThanOrEqual(PAGE_WIDTH);
    expect(e.y + e.h / 2 + extent / 2).toBeLessThanOrEqual(PAGE_HEIGHT);
    expect(fitOnePage([newPage()]).page.elements).toEqual([]);
  });
});
describe('Configurable model client', () => {
  it('accepts base URLs and complete compatible endpoints', () => {
    expect(chatEndpoint('https://example.com/v1/')).toBe('https://example.com/v1/chat/completions');
    expect(chatEndpoint('https://example.com/v1/chat/completions')).toBe(
      'https://example.com/v1/chat/completions',
    );
    expect(chatEndpoint('http://localhost:11434/v1')).toContain('localhost:11434');
  });
  it('keeps credentials out of endpoint URLs and rejects unencrypted remote URLs', () => {
    expect(() => chatEndpoint('https://example.com/v1?key=secret')).toThrow();
    expect(() => chatEndpoint('https://user:secret@example.com/v1')).toThrow();
    expect(() => chatEndpoint('http://example.com/v1')).toThrow();
  });
  it('sends the selected model, conversation and header credential only to its endpoint', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '连接成功' }, finish_reason: 'stop' }],
        }),
      ),
    );
    vi.stubGlobal('fetch', fetcher);
    const result = await complete(
      { baseUrl: 'https://example.com/v1', model: 'test-model', apiKey: 'fake-test-key' },
      [{ role: 'user', content: '测试内容' }],
      new AbortController().signal,
    );
    expect(result).toBe('连接成功');
    const [url, options] = fetcher.mock.calls[0];
    expect(url).toBe('https://example.com/v1/chat/completions');
    expect(options.headers.Authorization).toBe('Bearer fake-test-key');
    expect(options.body).not.toContain('fake-test-key');
    expect(JSON.parse(options.body).model).toBe('test-model');
    expect(options.redirect).toBe('error');
    expect(options.credentials).toBe('omit');
  });
  it('redacts credentials from provider errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { message: 'invalid fake-test-key' } }), {
          status: 401,
        }),
      ),
    );
    await expect(
      complete(
        { baseUrl: 'https://example.com', model: 'test', apiKey: 'fake-test-key' },
        [],
        new AbortController().signal,
      ),
    ).rejects.toThrow('401，invalid [已隐藏]');
  });
  it('rejects truncated or malformed structured responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: 'partial' }, finish_reason: 'length' }],
          }),
        ),
      ),
    );
    await expect(
      complete(
        { baseUrl: 'https://example.com', model: 'test', apiKey: '' },
        [],
        new AbortController().signal,
      ),
    ).rejects.toThrow('截断');
    expect(readJson('```json\n{"edits":[]}\n```')).toEqual({ edits: [] });
    expect(() => readJson('incomplete')).toThrow('格式');
  });
});
describe('AI suggestion validation', () => {
  const sources = [
    { id: 'body', text: '负责检索增强生成流程开发', html: '负责检索增强生成流程开发' },
  ];
  it('restricts suggestions to known element IDs and deduplicates changes', () => {
    const result = parseEdits(
      {
        edits: [
          { id: 'unknown', text: '无效' },
          { id: 'body', text: '优化后的表达' },
          { id: 'body', text: '重复建议' },
        ],
      },
      sources,
      'optimize',
    );
    expect(result).toEqual([{ id: 'body', text: '优化后的表达', enabled: true }]);
  });
  it('accepts only exact source phrases for keyword emphasis', () => {
    const result = parseEdits(
      { edits: [{ id: 'body', phrases: ['检索增强生成', '不存在的成果', '检索增强生成'] }] },
      sources,
      'bold',
    );
    expect(result[0].phrases).toEqual(['检索增强生成']);
    expect(() => parseEdits({ edits: [{ id: 'body', text: '' }] }, sources, 'rewrite')).toThrow();
  });
});

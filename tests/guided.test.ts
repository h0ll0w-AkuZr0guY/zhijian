import { describe, expect, it } from 'vitest';
import { clone, element, newPage, newProject, packProject, unpackProject } from '../src/core/model';
import {
  captureExtraFrames,
  inferResume,
  newModule,
  resumeBlocks,
  resumeFromScene,
  sceneSignature,
  syncSceneExtras,
  validResume,
  type ResumeDraft,
} from '../src/guided/model';

function draft(): ResumeDraft {
  return {
    profile: { name: '林同学', email: 'lin@example.com' },
    modules: [newModule('education'), newModule('experience')],
    extras: [],
    sceneSignature: '',
  };
}

describe('Structured document editing', () => {
  it('prefills school fields and contacts from an existing canvas', () => {
    const project = newProject();
    project.pages[0].elements = [
      element('text', { html: '林同学', fontSize: 24, bold: true, y: 40 }),
      element('text', { html: 'lin@example.com', y: 80 }),
      element('text', { html: '教育经历', fontSize: 15, bold: true, y: 130 }),
      element('text', {
        html: '示例大学 ｜ 软件工程 ｜ 本科 ｜ 2020.09 - 2024.06',
        y: 170,
        w: 700,
      }),
      element('text', { html: '主修操作系统与数据库', y: 220 }),
    ];
    const result = inferResume(project);
    expect(result.profile.name).toBe('林同学');
    expect(result.profile.email).toBe('lin@example.com');
    expect(result.modules[0].kind).toBe('education');
    expect(result.modules[0].entries[0].fields).toMatchObject({
      organization: '示例大学',
      major: '软件工程',
      degree: '本科',
      start: '2020.09',
      end: '2024.06',
    });
    expect(result.modules[0].entries[0].fields.detailsHtml).toContain('主修操作系统与数据库');
  });

  it('keeps structured fields and rich content in template input', () => {
    const resume = draft();
    resume.modules[0].entries[0].fields = {
      organization: '示例大学',
      major: '软件工程',
      degree: '本科',
      start: '2020.09',
      end: '2024.06',
      detailsHtml: '<p>研究<b>文档编辑</b></p>',
    };
    const blocks = resumeBlocks(resume);
    expect(blocks.find((b) => b.role === 'entry')?.fields).toEqual([
      '示例大学',
      '软件工程',
      '本科',
      '2020.09 - 2024.06',
    ]);
    expect(blocks.find((b) => b.html?.includes('<b>'))?.html).toContain('<b>文档编辑</b>');
    expect(blocks.filter((b) => b.type === 'heading').map((b) => b.text)).toEqual([
      '林同学',
      '教育经历',
    ]);
  });

  it('maps free canvas edits back to the same fields and preserves lists', () => {
    const resume = draft(),
      entry = resume.modules[1].entries[0];
    entry.fields = { organization: '旧公司', role: '旧岗位', detailsHtml: '旧描述' };
    const page = newPage();
    page.elements = [
      element('text', { html: '新公司', formField: `${entry.id}:organization`, y: 100 }),
      element('text', { html: '2024.01 - 至今', formField: `${entry.id}:dates`, y: 100 }),
      element('text', {
        html: '• 实现<b>编辑器</b>',
        formField: `${entry.id}:detailsHtml`,
        formList: true,
        blockId: 'list-a',
        y: 140,
      }),
      element('text', {
        html: '• 验证导出',
        formField: `${entry.id}:detailsHtml`,
        formList: true,
        blockId: 'list-b',
        y: 170,
      }),
    ];
    const updated = resumeFromScene(resume, [page]).modules[1].entries[0];
    expect(updated.id).toBe(entry.id);
    expect(updated.fields).toMatchObject({
      organization: '新公司',
      role: '',
      start: '2024.01',
      end: '至今',
      detailsHtml: '<ul><li>实现<b>编辑器</b></li><li>验证导出</li></ul>',
    });
    expect(entry.fields.organization).toBe('旧公司');
  });

  it('clears removed scene text so future template edits do not restore it', () => {
    const resume = draft();
    resume.modules[0].entries[0].fields = { organization: '已删除学校', detailsHtml: '已删除正文' };
    const result = resumeFromScene(resume, [newPage()]);
    expect(result.profile.name).toBe('');
    expect(result.modules[0].entries[0].fields.organization).toBe('');
    expect(result.modules[0].entries[0].fields.detailsHtml).toBe('');
  });

  it('distinguishes content changes from geometry changes', () => {
    const pages = [newPage()];
    pages[0].elements = [element('text', { html: '正文' })];
    const moved = clone(pages);
    moved[0].elements[0].y += 50;
    expect(sceneSignature(moved)).toBe(sceneSignature(pages));
    expect(sceneSignature(moved, true)).not.toBe(sceneSignature(pages, true));
    moved[0].elements[0].html = '更新正文';
    expect(sceneSignature(moved)).not.toBe(sceneSignature(pages));
  });

  it('keeps canonical extra geometry through repeated one-page scale and free edits', () => {
    const resume = draft(),
      canonical = newPage(),
      rendered = newPage();
    canonical.elements = [element('rect', { x: 100, y: 200, w: 120, h: 60, strokeWidth: 2 })];
    resume.extras = [canonical];
    rendered.elements = [
      { ...canonical.elements[0], x: 70, y: 120, w: 60, h: 30, strokeWidth: 1, fontSize: 5.25 },
    ];
    resume.extraFrames = captureExtraFrames(resume, [rendered]);
    syncSceneExtras(resume, [rendered]);
    expect(resume.extras[0].elements).toEqual(canonical.elements);
    rendered.elements[0].y += 15;
    rendered.elements[0].w += 10;
    syncSceneExtras(resume, [rendered]);
    expect(resume.extras[0].elements[0]).toMatchObject({ y: 230, w: 140, h: 60, strokeWidth: 2 });
    const saved = clone(resume.extras);
    syncSceneExtras(resume, [rendered]);
    expect(resume.extras).toEqual(saved);
    syncSceneExtras(resume, [newPage()]);
    expect(resume.extras[0].elements).toEqual([]);
  });

  it('deduplicates profile and extra images in portable projects and restores them', () => {
    const project = newProject(),
      resume = draft(),
      photo = 'data:image/png;base64,example';
    const image = element('image', { src: photo });
    project.pages[0].elements = [image];
    resume.profile.photo = photo;
    resume.extras = [clone(project.pages[0])];
    project.resume = resume;
    project.editorMode = 'guided';
    const packed = packProject(project);
    expect(Object.keys(packed.assets || {})).toHaveLength(1);
    expect(packed.resume?.profile.photo).toBeUndefined();
    const restored = unpackProject(packed, (document) => document);
    expect(restored.resume?.profile.photo).toBe(photo);
    expect(restored.resume?.extras[0].elements[0].src).toBe(photo);
    expect(restored.pages[0].elements[0].src).toBe(photo);
    expect(validResume(restored.resume)).toBe(true);
    expect(project.resume.profile.photo).toBe(photo);
  });

  it('rejects incompatible form metadata while accepting older projects without it', () => {
    expect(validResume(undefined)).toBe(false);
    expect(validResume(draft())).toBe(true);
    const malformed = draft();
    malformed.modules[0].kind = 'unknown' as (typeof malformed.modules)[0]['kind'];
    expect(validResume(malformed)).toBe(false);
    expect(unpackProject(packProject(newProject()), (document) => document).resume).toBeUndefined();
  });
});

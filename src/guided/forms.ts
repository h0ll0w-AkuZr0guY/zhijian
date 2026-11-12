import { clone, type Project } from '../core/model';
import {
  cleanRich,
  richText,
  newEntry,
  newModule,
  moduleNames,
  type ModuleKind,
  type ResumeDraft,
  type ResumeEntry,
  type ResumeModule,
} from './model';
import type { AIAction, AITarget } from '../ai/edits';

export function guidedForms(context: {
  commit(resume: ResumeDraft): void;
  ai(action: AIAction, target: AITarget, slot: HTMLElement): void;
  beforeRender(): void;
  notify(message: string): void;
}): { update(project: Project, force?: boolean): void; flush(): void } {
  const container = document.getElementById('resumeForms')!;
  let draft: ResumeDraft | undefined,
    dirty = false,
    flushing = false,
    projectId = '';
  let timer: ReturnType<typeof setTimeout>;
  const expanded = new Set<string>();
  function flush(): void {
    clearTimeout(timer);
    if (!dirty || !draft || flushing) return;
    flushing = true;
    dirty = false;
    try {
      context.commit(clone(draft));
    } finally {
      flushing = false;
    }
  }
  function schedule(): void {
    dirty = true;
    clearTimeout(timer);
    timer = setTimeout(flush, 280);
  }
  function action(text: string, onClick: () => void, title = text): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = text;
    button.title = title;
    button.onclick = onClick;
    return button;
  }
  function rerender(change: () => void): void {
    flush();
    change();
    dirty = true;
    flush();
    render();
  }
  function field(
    parent: HTMLElement,
    fields: Record<string, string>,
    key: string,
    label: string,
    placeholder = '',
    entryId = 'profile',
  ): void {
    const wrapper = document.createElement('label');
    wrapper.textContent = label;
    const input = document.createElement('input');
    input.value = fields[key] || '';
    input.placeholder = placeholder;
    input.dataset.field = key;
    input.dataset.entry = entryId;
    if (key === 'name' && entryId === 'profile') input.id = 'resumeName';
    input.oninput = () => {
      fields[key] = input.value;
      schedule();
    };
    wrapper.append(input);
    parent.append(wrapper);
  }
  function richEditor(
    parent: HTMLElement,
    fields: Record<string, string>,
    entryId: string,
    label: string,
  ): void {
    const group = document.createElement('div');
    group.className = 'resume-rich-group';
    const title = document.createElement('div');
    title.className = 'resume-field-label';
    title.textContent = label;
    const toolbar = document.createElement('div');
    toolbar.className = 'resume-rich-toolbar';
    const content = document.createElement('div');
    content.className = 'resume-rich';
    content.contentEditable = 'true';
    content.setAttribute('role', 'textbox');
    content.setAttribute('aria-label', label);
    content.setAttribute('aria-multiline', 'true');
    content.dataset.entry = entryId;
    content.dataset.field = 'detailsHtml';
    content.dataset.placeholder = '写清背景、自己的行动和真实结果，也可先插入填写提纲';
    content.innerHTML = cleanRich(fields.detailsHtml || '');
    for (const [text, command, hint] of [
      ['B', 'bold', '加粗'],
      ['I', 'italic', '斜体'],
      ['• 列表', 'insertUnorderedList', '项目符号'],
      ['清除格式', 'removeFormat', '清除格式'],
    ]) {
      const button = action(
        text,
        () => {
          content.focus();
          document.execCommand(command);
          fields.detailsHtml = cleanRich(content.innerHTML);
          schedule();
        },
        hint,
      );
      button.onpointerdown = (event) => event.preventDefault();
      toolbar.append(button);
    }
    content.oninput = () => {
      fields.detailsHtml = cleanRich(content.innerHTML);
      schedule();
    };
    content.onpaste = (event) => {
      event.preventDefault();
      document.execCommand('insertText', false, event.clipboardData?.getData('text/plain') || '');
    };
    const tools = document.createElement('div');
    tools.className = 'resume-ai-tools';
    const slot = document.createElement('div');
    slot.className = 'entry-ai-slot';
    const openAI = (mode: AIAction, selection = false) => {
      const selected = window.getSelection();
      let rangeTarget: { start: number; end: number; text: string } | undefined;
      if (selection && selected?.rangeCount && !selected.isCollapsed) {
        const range = selected.getRangeAt(0);
        if (content.contains(range.startContainer) && content.contains(range.endContainer)) {
          const prefix = range.cloneRange();
          prefix.selectNodeContents(content);
          prefix.setEnd(range.startContainer, range.startOffset);
          rangeTarget = {
            start: prefix.toString().length,
            end: prefix.toString().length + range.toString().length,
            text: range.toString(),
          };
        }
      }
      if (selection && !rangeTarget) {
        context.notify('请先在描述中划选需要处理的文字');
        return;
      }
      flush();
      context.ai(
        mode,
        { ids: [], form: { entryId, field: 'detailsHtml', range: rangeTarget } },
        slot,
      );
    };
    const optimize = action(richText(content.innerHTML) ? 'AI 润色' : 'AI 起草', () =>
      openAI('optimize'),
    );
    content.addEventListener(
      'input',
      () => (optimize.textContent = richText(content.innerHTML) ? 'AI 润色' : 'AI 起草'),
    );
    tools.append(
      optimize,
      action('AI 加粗', () => openAI('bold')),
    );
    const rewrite = action('改写划选', () => openAI('rewrite', true));
    rewrite.onpointerdown = (event) => event.preventDefault();
    tools.append(rewrite);
    tools.append(
      action('填写提纲', () => {
        if (richText(content.innerHTML)) {
          const tip = group.querySelector<HTMLElement>('.writing-tip')!;
          tip.hidden = !tip.hidden;
          return;
        }
        content.innerHTML =
          '<ul><li>背景与目标：[需要解决的问题]</li><li>我的行动：[负责的工作、工具与方法]</li><li>实际结果：[真实交付、验证方式或效果]</li></ul>';
        fields.detailsHtml = content.innerHTML;
        schedule();
        content.focus();
      }),
    );
    const tip = document.createElement('p');
    tip.className = 'writing-tip';
    tip.hidden = true;
    tip.textContent =
      '可按“背景与目标 → 我的行动 → 实际结果”组织内容。写出亲自负责的工作，结果可以是交付物、验证结论或有依据的指标。';
    content.oncontextmenu = (event) => {
      const selection = window.getSelection();
      if (
        selection?.rangeCount &&
        !selection.isCollapsed &&
        content.contains(selection.getRangeAt(0).commonAncestorContainer)
      ) {
        event.preventDefault();
        const range = selection.getRangeAt(0).cloneRange(),
          text = selection.toString();
        const menu = document.getElementById('contextMenu')!;
        menu.replaceChildren();
        const item = (label: string, callback: () => void) => {
          const button = document.createElement('button');
          button.textContent = label;
          button.setAttribute('role', 'menuitem');
          button.onpointerdown = (pointer) => pointer.preventDefault();
          button.onclick = () => {
            menu.hidden = true;
            const current = window.getSelection();
            current?.removeAllRanges();
            current?.addRange(range);
            callback();
          };
          menu.append(button);
        };
        item('AI 改写划选文字', () => openAI('rewrite', true));
        item('AI 加粗划选重点', () => openAI('bold', true));
        item('复制文字 · Ctrl+C', async () => {
          try {
            await navigator.clipboard.writeText(text);
          } catch {
            context.notify('复制未完成，可按 Ctrl+C');
          }
        });
        menu.hidden = false;
        const box = menu.getBoundingClientRect();
        const source = range.getBoundingClientRect();
        menu.style.left =
          Math.max(8, Math.min(event.clientX || source.left, innerWidth - box.width - 8)) + 'px';
        menu.style.top =
          Math.max(8, Math.min(event.clientY || source.bottom, innerHeight - box.height - 8)) +
          'px';
      }
    };
    group.append(title, toolbar, content, tools, tip, slot);
    parent.append(group);
  }
  function renderEntry(module: ResumeModule, entry: ResumeEntry, index: number): HTMLElement {
    const card = document.createElement('details');
    card.className = 'resume-entry';
    card.dataset.entryId = entry.id;
    card.open = expanded.has(entry.id) || !Object.values(entry.fields).some(Boolean);
    const summary = document.createElement('summary');
    const name = document.createElement('strong');
    name.textContent =
      entry.fields.organization ||
      richText(entry.fields.detailsHtml || '').slice(0, 32) ||
      `填写${module.title}`;
    const time = document.createElement('span');
    time.textContent = [entry.fields.start, entry.fields.end].filter(Boolean).join(' — ');
    card.ontoggle = () => {
      if (card.open) expanded.add(entry.id);
      else expanded.delete(entry.id);
      name.textContent =
        entry.fields.organization ||
        richText(entry.fields.detailsHtml || '').slice(0, 32) ||
        `填写${module.title}`;
      time.textContent = [entry.fields.start, entry.fields.end].filter(Boolean).join(' — ');
    };
    summary.append(name, time);
    card.append(summary);
    const body = document.createElement('div');
    body.className = 'resume-entry-body';
    const fields = document.createElement('div');
    fields.className = 'resume-field-grid';
    const f = entry.fields;
    if (module.kind === 'education') {
      field(fields, f, 'organization', '学校', '例如：某某大学', entry.id);
      field(fields, f, 'major', '专业', '例如：计算机科学与技术', entry.id);
      field(fields, f, 'degree', '学历 / 学位', '例如：本科、硕士', entry.id);
    } else if (['experience', 'research', 'project'].includes(module.kind)) {
      field(
        fields,
        f,
        'organization',
        module.kind === 'experience' ? '公司 / 组织' : '项目 / 研究名称',
        module.kind === 'experience' ? '填写组织名称' : '填写名称与研究主题',
        entry.id,
      );
      field(fields, f, 'role', '你的角色', '例如：研发实习生、项目负责人', entry.id);
      field(fields, f, 'department', '部门 / 团队', '选填', entry.id);
      field(fields, f, 'city', '所在城市', '选填', entry.id);
    } else field(fields, f, 'organization', '条目标题', '选填，可直接填写下方内容', entry.id);
    if (['education', 'experience', 'project', 'research'].includes(module.kind)) {
      field(fields, f, 'start', '开始时间', '2024.09', entry.id);
      field(fields, f, 'end', '结束时间', '2026.06 或 至今', entry.id);
    }
    if (['project', 'research', 'experience'].includes(module.kind)) {
      field(fields, f, 'tech', '技术栈 / 方法', '使用过的技术与方法', entry.id);
      field(fields, f, 'link', '项目 / 作品链接', '选填', entry.id);
    }
    body.append(fields);
    richEditor(body, f, entry.id, module.kind === 'education' ? '补充信息' : '内容描述');
    const actions = document.createElement('div');
    actions.className = 'entry-actions';
    actions.append(
      action(
        '↑',
        () =>
          rerender(() => {
            if (index > 0)
              [module.entries[index - 1], module.entries[index]] = [
                module.entries[index],
                module.entries[index - 1],
              ];
          }),
        '上移条目',
      ),
      action(
        '↓',
        () =>
          rerender(() => {
            if (index < module.entries.length - 1)
              [module.entries[index + 1], module.entries[index]] = [
                module.entries[index],
                module.entries[index + 1],
              ];
          }),
        '下移条目',
      ),
      action('删除此条', () => rerender(() => module.entries.splice(index, 1))),
    );
    body.append(actions);
    card.append(body);
    return card;
  }
  function check(): void {
    if (!draft) return;
    const issues: string[] = [];
    if (!draft.profile.name) issues.push('基本信息可以补充姓名或文档标题');
    if (!draft.profile.phone && !draft.profile.email) issues.push('建议填写一种联系方式');
    if (draft.profile.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.profile.email))
      issues.push('请检查邮箱格式');
    for (const module of draft.modules)
      for (const entry of module.entries) {
        if (!Object.values(entry.fields).some(Boolean)) continue;
        if (entry.fields.start && !entry.fields.end)
          issues.push(`${module.title}可补充结束时间，持续中的经历可填“至今”`);
        if (/\[[^\]]+\]/.test(richText(entry.fields.detailsHtml || '')))
          issues.push(`${module.title}还有提纲占位内容待替换`);
      }
    const area = document.getElementById('resumeChecks')!;
    area.replaceChildren();
    if (!issues.length) area.textContent = '已填字段通过格式检查';
    for (const issue of issues) {
      const line = document.createElement('p');
      line.textContent = issue;
      area.append(line);
    }
    area.hidden = false;
  }
  function render(): void {
    if (!draft) return;
    context.beforeRender();
    container.replaceChildren();
    const intro = document.createElement('div');
    intro.className = 'resume-intro';
    const title = document.createElement('h2');
    title.textContent = '填写内容';
    const note = document.createElement('p');
    note.textContent = '填写后自动排版，右侧实时预览';
    intro.append(title, note, action('检查填写', check));
    container.append(intro);
    const checks = document.createElement('div');
    checks.id = 'resumeChecks';
    checks.className = 'resume-checks';
    checks.hidden = true;
    container.append(checks);
    const profile = document.createElement('details');
    profile.className = 'resume-profile';
    profile.open = expanded.has('profile') || !draft.profile.name;
    profile.ontoggle = () => {
      if (profile.open) expanded.add('profile');
      else expanded.delete('profile');
    };
    const summary = document.createElement('summary');
    summary.textContent = '基本信息' + (draft.profile.name ? ' · ' + draft.profile.name : '');
    profile.append(summary);
    const grid = document.createElement('div');
    grid.className = 'resume-field-grid';
    field(grid, draft.profile, 'name', '姓名 / 文档标题', '填写姓名或标题');
    field(grid, draft.profile, 'headline', '求职意向 / 副标题', '例如：大模型应用开发');
    field(grid, draft.profile, 'phone', '电话', '填写联系电话');
    field(grid, draft.profile, 'email', '邮箱', 'name@example.com');
    field(grid, draft.profile, 'location', '所在城市', '选填');
    field(grid, draft.profile, 'website', '个人网站 / 作品集', '选填');
    field(grid, draft.profile, 'extra', '其他信息', 'GitHub、资质等，按需填写');
    profile.append(grid);
    const photo = document.createElement('div');
    photo.className = 'profile-photo';
    if (
      draft.profile.photo &&
      /^data:image\/(png|jpeg|webp|gif);base64,/i.test(draft.profile.photo)
    ) {
      const img = new Image();
      img.src = draft.profile.photo;
      img.alt = '证件照';
      photo.append(img);
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/webp';
    input.hidden = true;
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const currentId = projectId,
        reader = new FileReader();
      reader.onload = () => {
        if (currentId === projectId) rerender(() => (draft!.profile.photo = String(reader.result)));
      };
      reader.readAsDataURL(file);
    };
    photo.append(
      action('上传照片', () => input.click()),
      input,
      action('移除照片', () => rerender(() => delete draft!.profile.photo)),
    );
    profile.append(photo);
    richEditor(profile, draft.profile, 'profile', '个人简介 / 文档导语');
    container.append(profile);
    draft.modules.forEach((module, index) => {
      const section = document.createElement('section');
      section.className = 'resume-module';
      section.dataset.moduleId = module.id;
      const header = document.createElement('header');
      const name = document.createElement('input');
      name.value = module.title;
      name.className = 'resume-module-title';
      name.setAttribute('aria-label', '模块名称');
      name.oninput = () => {
        module.title = name.value;
        schedule();
      };
      header.append(
        name,
        action(
          '↑',
          () =>
            rerender(() => {
              if (index > 0)
                [draft!.modules[index - 1], draft!.modules[index]] = [
                  draft!.modules[index],
                  draft!.modules[index - 1],
                ];
            }),
          '上移模块',
        ),
        action(
          '↓',
          () =>
            rerender(() => {
              if (index < draft!.modules.length - 1)
                [draft!.modules[index + 1], draft!.modules[index]] = [
                  draft!.modules[index],
                  draft!.modules[index + 1],
                ];
            }),
          '下移模块',
        ),
        action('×', () => rerender(() => draft!.modules.splice(index, 1)), '删除模块'),
      );
      section.append(header);
      module.entries.forEach((entry, i) => section.append(renderEntry(module, entry, i)));
      section.append(
        action(`＋ 添加${module.title}`, () =>
          rerender(() => {
            const entry = newEntry();
            expanded.add(entry.id);
            module.entries.push(entry);
          }),
        ),
      );
      container.append(section);
    });
    const add = document.createElement('select');
    add.id = 'addResumeModule';
    add.setAttribute('aria-label', '添加模块');
    add.add(new Option('＋ 添加模块…', ''));
    Object.entries(moduleNames).forEach(([kind, name]) => add.add(new Option(name, kind)));
    add.onchange = () => {
      const kind = add.value as ModuleKind;
      if (kind) rerender(() => draft!.modules.push(newModule(kind)));
    };
    container.append(add);
  }
  return {
    flush,
    update(project, force = false) {
      if (!project.resume) return;
      projectId = project.id;
      if (flushing && draft) {
        draft.sceneSignature = project.resume.sceneSignature;
        return;
      }
      draft = clone(project.resume);
      if (force || (!flushing && !container.contains(document.activeElement))) {
        dirty = false;
        clearTimeout(timer);
        render();
      }
    },
  };
}

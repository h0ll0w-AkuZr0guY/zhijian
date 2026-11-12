import { PAGE_WIDTH, PAGE_HEIGHT, type Project, type EditorPage } from '../core/model';
import { pageNode } from '../exporters/scene';

export function continuousPages(context: { activate(index: number): void }): {
  render(project: Project, zoom: number): void;
  visiblePage(): number;
} {
  const viewport = document.getElementById('viewport')!;
  const paper = document.getElementById('paperWrap')!;
  const heading = document.getElementById('pageLabel')!.parentElement!;
  const stack = document.createElement('div');
  stack.id = 'pageStack';
  viewport.insertBefore(stack, heading);
  let current: Project | undefined;
  const previews = new Map<string, string>();
  function preview(page: EditorPage, shell: HTMLElement, zoom: number): void {
    let frame = shell.querySelector<HTMLElement>('.page-preview');
    if (!frame) {
      frame = document.createElement('div');
      frame.className = 'page-preview';
      shell.append(frame);
    }
    const signature = JSON.stringify(page);
    if (previews.get(page.id) !== signature || !frame.firstChild) {
      const node = pageNode(page);
      node.classList.add('continuous-preview');
      for (const child of node.children) {
        const e = page.elements.find(
          (item) => item.id === (child as HTMLElement).dataset.elementId,
        )!;
        child.className = 'element ' + e.type;
        (child as HTMLElement).dataset.id = e.id;
      }
      frame.replaceChildren(node);
      previews.set(page.id, signature);
    }
    frame.style.width = PAGE_WIDTH * zoom + 'px';
    frame.style.height = PAGE_HEIGHT * zoom + 'px';
    (frame.firstChild as HTMLElement).style.transform = `scale(${zoom})`;
    (frame.firstChild as HTMLElement).style.transformOrigin = 'top left';
  }
  document.addEventListener(
    'pointerdown',
    (event) => {
      if (!current || current.editorMode === 'guided') return;
      const shell = (event.target as Element).closest<HTMLElement>('.page-shell');
      if (!shell) return;
      const index = current.pages.findIndex((page) => page.id === shell.dataset.pageId);
      if (index >= 0 && index !== current.activePage) context.activate(index);
    },
    true,
  );
  return {
    render(project, zoom) {
      current = project;
      const valid = new Set(project.pages.map((page) => page.id));
      for (const shell of [...stack.children])
        if (!valid.has((shell as HTMLElement).dataset.pageId!)) {
          if (shell.contains(paper)) {
            viewport.append(paper, heading);
          }
          previews.delete((shell as HTMLElement).dataset.pageId!);
          shell.remove();
        }
      project.pages.forEach((page, index) => {
        let shell = [...stack.children].find(
          (node) => (node as HTMLElement).dataset.pageId === page.id,
        ) as HTMLElement | undefined;
        if (!shell) {
          shell = document.createElement('section');
          shell.className = 'page-shell';
          shell.dataset.pageId = page.id;
        }
        if (stack.children[index] !== shell)
          stack.insertBefore(shell, stack.children[index] || null);
        shell.style.width = PAGE_WIDTH * zoom + 'px';
        shell.classList.toggle('active', index === project.activePage);
        const active = index === project.activePage;
        if (active) {
          shell.querySelector('.page-preview')?.remove();
          shell.querySelector('.page-caption')?.remove();
          if (heading.parentElement !== shell) shell.prepend(heading);
          if (paper.parentElement !== shell) shell.append(paper);
        } else {
          if (shell.contains(paper)) viewport.append(paper, heading);
          let caption = shell.querySelector<HTMLElement>('.page-caption');
          if (!caption) {
            caption = document.createElement('div');
            caption.className = 'page-caption';
            shell.prepend(caption);
          }
          caption.textContent = `第 ${index + 1} 页 · A4`;
          preview(page, shell, zoom);
        }
      });
      heading.style.width = PAGE_WIDTH * zoom + 'px';
    },
    visiblePage() {
      const center = viewport.getBoundingClientRect().top + viewport.clientHeight / 2;
      const shells = [...stack.children];
      return shells.reduce((best, shell, index) => {
        const rect = shell.getBoundingClientRect(),
          previous = shells[best].getBoundingClientRect();
        return Math.abs((rect.top + rect.bottom) / 2 - center) <
          Math.abs((previous.top + previous.bottom) / 2 - center)
          ? index
          : best;
      }, 0);
    },
  };
}

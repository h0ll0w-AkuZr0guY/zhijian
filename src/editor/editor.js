import {
  baselineOffset,
  guideY,
  bindRow,
  detachGuide,
  boundMoveMembers,
  synchronizeRows,
  remapRowReferences,
} from '../core/guides';
import { mergeTextElements } from '../importers/structure';
const $ = (id) => document.getElementById(id);
const MM = 96 / 25.4,
  W = 210 * MM,
  H = 297 * MM;
const VIEW_STORAGE = 'zhijian-a4-view-v1';
const SHAPE_PATHS = {
  triangle: 'M50 2 L98 98 H2 Z',
  diamond: 'M50 2 L98 50 L50 98 L2 50 Z',
  pentagon: 'M50 2 L98 38 L80 98 H20 L2 38 Z',
  hexagon: 'M26 2 H74 L98 50 L74 98 H26 L2 50 Z',
  star: 'M50 2 L62 36 L98 37 L70 59 L80 96 L50 75 L20 96 L30 59 L2 37 L38 36 Z',
  arrow: 'M2 28 H60 V2 L98 50 L60 98 V72 H2 Z',
  chevron: 'M2 2 H55 L98 50 L55 98 H2 L45 50 Z',
  parallelogram: 'M26 2 H98 L74 98 H2 Z',
};
const SHAPE_NAMES = {
  triangle: '三角形',
  diamond: '菱形',
  pentagon: '五边形',
  hexagon: '六边形',
  star: '五角星',
  arrow: '箭头',
  chevron: '燕尾箭头',
  parallelogram: '平行四边形',
};
let doc = { version: 1, name: '未命名文档', background: '#ffffff', elements: [] };
let selected = new Set(),
  zoom = 0.75,
  editing = null,
  history = [],
  future = [],
  saveTimer,
  replaceImage = false;
let canvasClipboard = [],
  imageAsBackground = false,
  panMode = false,
  panGesture = null;
let selectionTool = 'select',
  marquee = null,
  alignReference = 'selection';
const clone = (value) => JSON.parse(JSON.stringify(value));
const uid = () =>
  crypto.randomUUID ? crypto.randomUUID() : 'e' + Date.now() + Math.random().toString(36).slice(2);
const elements = () => doc.elements.filter((e) => selected.has(e.id));
const round = (n) => Math.round(n * 100) / 100;
const editableElements = () => elements().filter((e) => !e.locked);
const TEXT_PROPERTIES = new Set([
  'fontFamily',
  'fontSize',
  'lineHeight',
  'textAlign',
  'bold',
  'italic',
  'underline',
]);
function propertyTargets(key) {
  const list = editableElements();
  if (TEXT_PROPERTIES.has(key)) return list.filter((e) => e.type === 'text');
  if (key === 'objectFit') return list.filter((e) => e.type === 'image');
  return list;
}
function visualBounds(e) {
  const radians = (e.rotation * Math.PI) / 180;
  const width = Math.abs(e.w * Math.cos(radians)) + Math.abs(e.h * Math.sin(radians));
  const height = Math.abs(e.w * Math.sin(radians)) + Math.abs(e.h * Math.cos(radians));
  return { x: e.x + (e.w - width) / 2, y: e.y + (e.h - height) / 2, w: width, h: height };
}
function boundsOf(list) {
  const boxes = list.map(visualBounds);
  const x = Math.min(...boxes.map((e) => e.x)),
    y = Math.min(...boxes.map((e) => e.y));
  return {
    x,
    y,
    w: Math.max(...boxes.map((e) => e.x + e.w)) - x,
    h: Math.max(...boxes.map((e) => e.y + e.h)) - y,
  };
}
function membersOf(id, individual = false) {
  const e = doc.elements.find((e) => e.id === id);
  if (!e) return [];
  return e.groupId && !individual ? doc.elements.filter((item) => item.groupId === e.groupId) : [e];
}
function selectionUnits(list = editableElements()) {
  const units = new Map();
  for (const e of list) {
    const key = e.groupId || e.id;
    if (!units.has(key)) units.set(key, []);
    units.get(key).push(e);
  }
  return [...units.values()].map((members) => ({ members, ...boundsOf(members) }));
}
function scaleElements(originals, bounds, factor, x = bounds.x, y = bounds.y) {
  for (const original of originals) {
    const e = doc.elements.find((item) => item.id === original.id);
    Object.assign(e, {
      x: x + (original.x - bounds.x) * factor,
      y: y + (original.y - bounds.y) * factor,
      w: original.w * factor,
      h: original.h * factor,
      fontSize: original.fontSize * factor,
      strokeWidth: original.strokeWidth * factor,
      radius: original.radius * factor,
      letterSpacing: (original.letterSpacing || 0) * factor,
    });
  }
}
function toast(message) {
  $('toast').textContent = message;
  $('toast').classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => $('toast').classList.remove('show'), 3000);
}
function checkpoint() {
  if (window.paperHistory) {
    window.paperHistory.capture();
    return;
  }
  history.push(JSON.stringify(doc));
  if (history.length > 80) history.shift();
  future = [];
}
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => window.paperChanged?.(), 220);
}
function changed() {
  render();
  persist();
}
function base(type, extra = {}) {
  return {
    id: uid(),
    type,
    x: 60,
    y: 60,
    w: 240,
    h: 48,
    rotation: 0,
    opacity: 100,
    color: '#263b30',
    fill: 'transparent',
    strokeWidth: 0,
    radius: 0,
    dash: 'solid',
    fontFamily: 'Microsoft YaHei',
    fontSize: 12,
    lineHeight: 1.5,
    textAlign: 'left',
    html: '双击编辑文字',
    ...extra,
  };
}
function escapeHtml(s) {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}
function sanitize(html) {
  const t = document.createElement('template');
  t.innerHTML = html;
  t.content
    .querySelectorAll('script,style,iframe,object,embed,link,meta,img,svg')
    .forEach((e) => e.remove());
  t.content.querySelectorAll('*').forEach((e) => {
    for (const a of [...e.attributes]) if (a.name !== 'style') e.removeAttribute(a.name);
    if (e.hasAttribute('style')) {
      const allowed = [
        'font-weight',
        'font-style',
        'text-decoration',
        'color',
        'font-family',
        'font-size',
        'letter-spacing',
      ];
      const styles = allowed
        .map((k) => (e.style[k] ? `${k}:${e.style[k]}` : ''))
        .filter(Boolean)
        .join(';');
      e.setAttribute('style', styles);
    }
  });
  return t.innerHTML;
}
function render() {
  $('docName').value = doc.name;
  $('pageColor').value = doc.background;
  $('paper').style.backgroundColor = doc.background;
  const paper = $('paper');
  for (const child of [...paper.children])
    if (!doc.elements.some((e) => e.id === child.dataset.id)) child.remove();
  doc.elements.forEach((e, index) => {
    let el = [...paper.children].find((n) => n.dataset.id === e.id);
    if (!el) {
      el = document.createElement('div');
      el.dataset.id = e.id;
      paper.append(el);
    }
    el.className = `element ${e.type}${e.locked ? ' locked' : ''}${editing === e.id ? ' editing' : ''}`;
    Object.assign(el.style, {
      left: e.x + 'px',
      top: e.y + 'px',
      width: e.w + 'px',
      height: e.h + 'px',
      transform: `rotate(${e.rotation}deg)`,
      opacity: e.opacity / 100,
      zIndex: index + 1,
      color: e.color,
      background: e.fill,
      borderRadius: e.type === 'ellipse' ? '50%' : e.radius + 'px',
      border: e.type === 'line' ? 'none' : `${e.strokeWidth}px solid ${e.color}`,
      fontFamily: e.fontFamily,
      fontSize: (e.fontSize * 96) / 72 + 'px',
      lineHeight: e.lineHeight,
      textAlign: e.textAlign,
      whiteSpace: e.whiteSpace || 'pre-wrap',
      letterSpacing: (e.letterSpacing || 0) + 'px',
      fontWeight: e.bold ? '700' : '400',
      fontStyle: e.italic ? 'italic' : 'normal',
      textDecoration: e.underline ? 'underline' : 'none',
    });
    el.style.borderStyle = e.dash || 'solid';
    if (e.type === 'line') {
      el.style.background = 'transparent';
      el.style.border = 'none';
      el.style.borderTop = `${e.h}px ${e.dash || 'solid'} ${e.color}`;
    }
    if (e.type === 'shape') {
      el.style.background = 'transparent';
      el.style.border = 'none';
      el.innerHTML = shapeSvg(e.shape, e.fill, e.color, e.strokeWidth, e.dash);
    }
    if (e.type === 'text' && editing !== e.id) {
      el.innerHTML = '<div class="content">' + e.html + '</div>';
    }
    if (e.type === 'text') {
      const content = el.querySelector('.content');
      if (content) {
        content.style.paddingLeft = (e.hangingIndent || 0) + 'px';
        content.style.textIndent = -(e.hangingIndent || 0) + 'px';
      }
    }
    if (e.type === 'image') {
      if (!el.firstChild) el.append(document.createElement('img'));
      el.firstChild.src = e.src;
      el.firstChild.style.objectFit = e.objectFit || 'cover';
      el.firstChild.style.objectPosition = e.objectPosition || 'center';
    }
  });
  renderSelection();
  renderLayers();
  properties();
  $('undo').disabled = window.paperHistory ? !window.paperHistory.canUndo() : history.length === 0;
  $('redo').disabled = window.paperHistory ? !window.paperHistory.canRedo() : future.length === 0;
}
function renderSelection() {
  $('selectionOverlay').innerHTML = '';
  renderRowGuides();
  const movable = editableElements();
  const drawBox = (e, aggregate = false) => {
    const box = document.createElement('div');
    box.className = 'selection-box' + (aggregate ? ' aggregate-selection' : '');
    Object.assign(box.style, {
      left: e.x + 'px',
      top: e.y + 'px',
      width: e.w + 'px',
      height: e.h + 'px',
      transform: `rotate(${e.rotation || 0}deg)`,
      borderWidth: 1 / zoom + 'px',
    });
    const handles = !e.locked && (aggregate || movable.length < 2);
    if (handles)
      for (const corner of ['nw', 'ne', 'sw', 'se']) {
        const handle = document.createElement('div');
        handle.className = 'handle ' + corner;
        handle.dataset.id = aggregate ? 'selection' : e.id;
        handle.dataset.corner = corner;
        box.append(handle);
      }
    $('selectionOverlay').append(box);
  };
  for (const e of elements()) {
    if (editing === e.id) continue;
    drawBox(e);
  }
  if (movable.length > 1 && !editing) drawBox(boundsOf(movable), true);
  if (marquee) {
    const box = document.createElement('div');
    box.className = 'marquee-box';
    Object.assign(box.style, {
      left: marquee.box.x + 'px',
      top: marquee.box.y + 'px',
      width: marquee.box.w + 'px',
      height: marquee.box.h + 'px',
      borderWidth: 1 / zoom + 'px',
    });
    $('selectionOverlay').append(box);
  }
  $('selectionStatus').textContent = selected.size
    ? `已选择 ${selected.size} 个元素${elements().some((e) => e.locked) ? ' · 含锁定元素' : ''}`
    : '未选择元素';
  $('interactionHint').textContent =
    selected.size > 1
      ? `已选 ${selected.size} 项 · 拖动任一选中元素整体移动，右侧批量修改`
      : selectionTool === 'marquee'
        ? '拖框完整包围元素，Shift 追加，Alt 减选'
        : '拖动空白处框选，Shift 点选追加';
}
function renderRowGuides() {
  if (!$('showGuides')?.checked) return;
  const overlay = $('selectionOverlay');
  for (const anchor of doc.elements.filter((e) => e.rowGuide)) {
    const line = document.createElement('div');
    line.className = 'row-guide' + (activeGuideId === anchor.id ? ' active' : '');
    line.dataset.anchorId = anchor.id;
    Object.assign(line.style, {
      left: '0px',
      top: guideY(anchor) + 'px',
      width: W + 'px',
      borderTopWidth: 1 / zoom + 'px',
    });
    const label = document.createElement('span');
    label.className = 'row-guide-label';
    const count = doc.elements.filter((e) => e.rowAnchorId === anchor.id).length;
    const name = anchor.type === 'text' ? anchor.html.replace(/<[^>]*>/g, '').slice(0, 14) : '元素';
    label.textContent = `绑定 ${count}`;
    label.title = name + ' · 移动锚点带动同行';
    Object.assign(label.style, {
      left: '0px',
      fontSize: 11 / zoom + 'px',
      top: -19 / zoom + 'px',
      padding: `${2 / zoom}px ${5 / zoom}px`,
    });
    line.append(label);
    overlay.append(line);
  }
}
function selectedRowAnchor() {
  return [...selected]
    .map((id) => doc.elements.find((e) => e.id === id))
    .find((e) => e?.type === 'text' && !e.locked);
}
function createRowGuide() {
  const anchor = selectedRowAnchor();
  if (!anchor) return;
  mutate(() =>
    bindRow(
      anchor,
      editableElements().filter((e) => e.type === 'text'),
    ),
  );
  $('showGuides').checked = true;
  renderSelection();
  toast('已创建绑定基线，拖动其他文字靠近虚线可吸附绑定');
}
function mergeSelectedText() {
  const list = editableElements().filter((e) => e.type === 'text');
  if (list.length < 2) return;
  mutate(() => {
    const merged = mergeTextElements(list),
      ids = new Set(list.map((e) => e.id));
    const index = Math.min(...list.map((e) => doc.elements.indexOf(e)));
    doc.elements = doc.elements.filter((e) => !ids.has(e.id));
    doc.elements.splice(index, 0, merged);
    selected = new Set([merged.id]);
  });
  toast('文字已合并，可双击整体编辑');
}
$('showGuides').onchange = renderSelection;
function renderLayers() {
  $('layerCount').textContent = doc.elements.length;
  $('layers').innerHTML = '';
  [...doc.elements].reverse().forEach((e) => {
    const button = document.createElement('button');
    button.className = 'layer' + (selected.has(e.id) ? ' active' : '');
    const text = document.createElement('div');
    text.innerHTML = e.html || '';
    const name =
      e.name ||
      (e.type === 'text'
        ? text.textContent.slice(0, 32) || '空文字'
        : SHAPE_NAMES[e.shape] ||
          { image: '图片', rect: '矩形', ellipse: '圆形', line: '线条' }[e.type]);
    const icon = document.createElement('span');
    icon.textContent = { text: 'T', image: '▧', rect: '▭', ellipse: '○', line: '╱', shape: '◇' }[
      e.type
    ];
    const label = document.createElement('span');
    label.className = 'layer-name';
    label.textContent = name;
    button.append(icon, label);
    if (e.locked) {
      const mark = document.createElement('small');
      mark.textContent = '锁';
      button.append(mark);
    }
    if (e.groupId) {
      const mark = document.createElement('small');
      mark.textContent = '组';
      button.append(mark);
    }
    button.onclick = (ev) => select(e.id, ev.shiftKey || ev.ctrlKey || ev.metaKey, ev.altKey);
    $('layers').append(button);
  });
}
function properties() {
  const list = elements(),
    e = list[0],
    movable = editableElements();
  $('emptyProperties').hidden = !!e;
  $('properties').hidden = !e;
  if (!e) return;
  const geometryList = movable.length ? movable : list;
  const bounds = boundsOf(geometryList);
  const units = selectionUnits(movable);
  $('elementType').textContent = list.length > 1 ? '选区整体位置与尺寸' : '位置与尺寸';
  $('selectionSummary').textContent =
    `已选 ${list.length} 项 · 可修改 ${movable.length} 项` +
    (movable.length < list.length ? ' · 锁定项跳过' : '');
  if (list.length === 1 && e.rowGuide)
    $('selectionSummary').textContent +=
      ' · 基线锚点，同行 ' +
      doc.elements.filter((item) => item.rowAnchorId === e.id).length +
      ' 项';
  if (list.length === 1 && e.rowAnchorId) $('selectionSummary').textContent += ' · 已绑定行基线';
  $('multiActions').hidden = list.length < 2;
  $('distributionActions').hidden = list.length < 2;
  $('group').disabled = movable.length < 2;
  $('ungroup').disabled = !movable.some((e) => e.groupId);
  $('distributeX').disabled = units.length < 3;
  $('distributeY').disabled = units.length < 3;
  $('alignReference').value = units.length > 1 ? alignReference : 'page';
  document.querySelectorAll('[data-prop]').forEach((input) => {
    const key = input.dataset.prop;
    const targets = propertyTargets(key);
    const source = targets.length ? targets : list;
    const values = source.map((item) =>
      key === 'strokeWidth' && item.type === 'line' ? item.h : item[key],
    );
    const mixed = values.some((value) => value !== values[0]);
    const geometry = ['x', 'y', 'w', 'h'].includes(key);
    let value = geometry && list.length > 1 ? bounds[key] : values[0];
    if (['x', 'y', 'w', 'h'].includes(key)) value = round(value / MM);
    input.disabled = !targets.length;
    input.classList.toggle('mixed-value', mixed && !geometry);
    input.dataset.mixed = String(mixed && !geometry);
    input.placeholder = mixed && !geometry ? '多个值' : '';
    input.title = mixed && !geometry ? '所选元素的值不同，修改后将统一应用' : '';
    if (mixed && !geometry && input.type === 'number') value = '';
    if (input.type === 'color' && !/^#[0-9a-f]{6}$/i.test(value)) value = '#ffffff';
    if (input.tagName === 'SELECT') {
      input.querySelector('[data-mixed-option]')?.remove();
      if (mixed) {
        const option = new Option('多个值', '');
        option.dataset.mixedOption = 'true';
        input.add(option);
        value = '';
      }
    }
    if (input.tagName === 'SELECT' && ![...input.options].some((o) => o.value === String(value)))
      input.add(new Option(value, value));
    input.value = value ?? '';
  });
  $('textProperties').hidden = !list.some((e) => e.type === 'text');
  $('imageProperties').hidden = !list.some((e) => e.type === 'image');
  $('properties').insertBefore(
    $('textProperties'),
    list.length > 1 && list.some((e) => e.type === 'text')
      ? $('elementType')
      : $('appearanceHeading'),
  );
  document.querySelector('[data-prop=rotation]').parentNode.firstChild.textContent =
    list.length > 1 ? '各元素旋转 / °' : '旋转 / °';
  $('editText').disabled = list.length !== 1 || e.type !== 'text' || e.locked;
  $('lock').textContent = list.every((e) => e.locked) ? '解锁元素' : '锁定元素';
  for (const key of ['bold', 'italic', 'underline']) {
    const targets = propertyTargets(key),
      active = targets.length && targets.every((item) => item[key]);
    $(key).disabled = !targets.length;
    $(key).classList.toggle('primary', !!active);
    $(key).classList.toggle('mixed-value', targets.some((item) => item[key]) && !active);
    $(key).setAttribute(
      'aria-pressed',
      active ? 'true' : targets.some((item) => item[key]) ? 'mixed' : 'false',
    );
  }
}
function select(id, additive = false, individual = false) {
  finishEditing();
  const members = membersOf(id, individual);
  const remove = additive && members.every((e) => selected.has(e.id));
  if (!additive) selected.clear();
  for (const e of members) {
    if (remove) selected.delete(e.id);
    else selected.add(e.id);
  }
  render();
}
function startEditing(id) {
  const e = doc.elements.find((e) => e.id === id);
  if (!e || e.locked || e.type !== 'text') return;
  finishEditing();
  selected = new Set([id]);
  checkpoint();
  editing = id;
  render();
  const el = [...$('paper').children].find((n) => n.dataset.id === id);
  const content = el.querySelector('.content');
  content.contentEditable = 'true';
  content.focus();
  const range = document.createRange();
  range.selectNodeContents(content);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  content.oninput = () => {
    e.html = sanitize(content.innerHTML);
    persist();
  };
  content.onpaste = (ev) => {
    ev.preventDefault();
    document.execCommand('insertText', false, ev.clipboardData.getData('text/plain'));
  };
}
function finishEditing() {
  if (!editing) return;
  const el = [...$('paper').children].find((n) => n.dataset.id === editing),
    e = doc.elements.find((e) => e.id === editing);
  if (el && e) e.html = sanitize(el.querySelector('.content').innerHTML);
  editing = null;
  render();
  persist();
}
function setZoom(value, anchor) {
  if (!Number.isFinite(value)) return;
  const viewport = $('viewport');
  const viewportRect = viewport.getBoundingClientRect();
  const focus = anchor || {
    x: viewportRect.left + viewport.clientWidth / 2,
    y: viewportRect.top + viewport.clientHeight / 2,
  };
  const before = $('paperWrap').getBoundingClientRect();
  const paperX = (focus.x - before.left) / zoom;
  const paperY = (focus.y - before.top) / zoom;
  zoom = Math.round(Math.max(0.2, Math.min(4, value)) * 1000) / 1000;
  $('paper').style.transform = `scale(${zoom})`;
  $('selectionOverlay').style.transform = `scale(${zoom})`;
  $('paperWrap').style.width = W * zoom + 'px';
  $('paperWrap').style.height = H * zoom + 'px';
  $('selectionOverlay').style.setProperty('--handle-size', 10 / zoom + 'px');
  $('selectionOverlay').style.setProperty('--handle-offset', -5 / zoom + 'px');
  document.querySelector('.paper-heading').style.width = W * zoom + 'px';
  $('zoom').querySelector('[data-custom]')?.remove();
  if (![...$('zoom').options].some((o) => Number(o.value) === zoom)) {
    const option = new Option(Math.round(zoom * 100) + '%', zoom);
    option.dataset.custom = 'true';
    $('zoom').add(option);
  }
  $('zoom').value = zoom;
  const after = $('paperWrap').getBoundingClientRect();
  viewport.scrollLeft += after.left + paperX * zoom - focus.x;
  viewport.scrollTop += after.top + paperY * zoom - focus.y;
  try {
    localStorage.setItem(VIEW_STORAGE, JSON.stringify({ zoom }));
  } catch {}
  $('zoomOut').disabled = zoom <= 0.2;
  $('zoomIn').disabled = zoom >= 4;
  renderSelection();
}
function fit() {
  setZoom(
    Math.min(1, ($('viewport').clientWidth - 96) / W, ($('viewport').clientHeight - 110) / H),
  );
  $('viewport').scrollTop = 0;
  $('viewport').scrollLeft = 0;
}
function mutate(fn) {
  $('contextMenu').hidden = true;
  finishEditing();
  checkpoint();
  const previous = clone(doc.elements);
  fn();
  synchronizeRows(doc.elements, previous);
  changed();
}
function add(type, extra = {}) {
  mutate(() => {
    const defaults = { w: 150, h: 100, fill: '#dfebe1' };
    const shapeDefaults = ['rect', 'ellipse', 'shape'].includes(type) ? defaults : {};
    const lineDefaults = type === 'line' ? { w: 230, h: 2, color: '#246b53' } : {};
    const viewportRect = $('viewport').getBoundingClientRect();
    const paperRect = $('paperWrap').getBoundingClientRect();
    const e = base(type, { ...shapeDefaults, ...lineDefaults, ...extra });
    if (extra.x === undefined)
      e.x = Math.max(
        12,
        Math.min(
          W - e.w - 12,
          (viewportRect.left + $('viewport').clientWidth / 2 - paperRect.left) / zoom - e.w / 2,
        ),
      );
    if (extra.y === undefined)
      e.y = Math.max(
        12,
        Math.min(
          H - e.h - 12,
          (viewportRect.top + $('viewport').clientHeight / 2 - paperRect.top) / zoom - e.h / 2,
        ),
      );
    doc.elements.push(e);
    selected = new Set([e.id]);
  });
}
let gesture = null;
let activeGuideId = null;
$('paper').addEventListener('pointerdown', (ev) => {
  if (ev.button !== 0) return;
  const target = ev.target.closest('.element');
  if (editing && target?.dataset.id === editing) return;
  finishEditing();
  if (!target) return;
  const id = target.dataset.id;
  const additive = ev.shiftKey || ev.ctrlKey || ev.metaKey;
  if (additive || ev.altKey || !selected.has(id)) select(id, additive, ev.altKey);
  if (additive) return;
  const movable = boundMoveMembers(editableElements(), doc.elements);
  if (!movable.length) return;
  ev.preventDefault();
  gesture = { kind: 'move', startX: ev.clientX, startY: ev.clientY, original: clone(movable) };
});
$('paper').addEventListener('dblclick', (ev) => {
  const el = ev.target.closest('.element');
  if (el) startEditing(el.dataset.id);
});
$('selectionOverlay').addEventListener('pointerdown', (ev) => {
  const h = ev.target.closest('.handle');
  if (!h) return;
  ev.preventDefault();
  finishEditing();
  const originals =
    h.dataset.id === 'selection'
      ? clone(editableElements())
      : [clone(doc.elements.find((e) => e.id === h.dataset.id))];
  gesture = {
    kind: h.dataset.id === 'selection' ? 'resize-selection' : 'resize',
    startX: ev.clientX,
    startY: ev.clientY,
    corner: h.dataset.corner,
    original: originals,
    bounds: boundsOf(originals),
  };
});
window.addEventListener('pointermove', (ev) => {
  if (panGesture) {
    $('viewport').scrollLeft = panGesture.left - ev.clientX + panGesture.x;
    $('viewport').scrollTop = panGesture.top - ev.clientY + panGesture.y;
    return;
  }
  if (marquee) {
    const point = paperPoint(ev);
    marquee.box = {
      x: Math.min(marquee.start.x, point.x),
      y: Math.min(marquee.start.y, point.y),
      w: Math.abs(point.x - marquee.start.x),
      h: Math.abs(point.y - marquee.start.y),
    };
    const box = marquee.box;
    const hits = selectionUnits(doc.elements.filter((e) => !e.locked)).filter(
      (bounds) =>
        bounds.x >= box.x &&
        bounds.y >= box.y &&
        bounds.x + bounds.w <= box.x + box.w &&
        bounds.y + bounds.h <= box.y + box.h,
    );
    selected = new Set(marquee.seed);
    const hitIds = new Set(hits.flatMap((unit) => unit.members.map((e) => e.id)));
    for (const id of hitIds) {
      if (marquee.subtract) selected.delete(id);
      else selected.add(id);
    }
    render();
    return;
  }
  if (!gesture) return;
  if (!gesture.committed) {
    if (Math.hypot(ev.clientX - gesture.startX, ev.clientY - gesture.startY) < 2) return;
    checkpoint();
    gesture.committed = true;
  }
  const beforeFrame = clone(doc.elements);
  const dx = (ev.clientX - gesture.startX) / zoom,
    dy = (ev.clientY - gesture.startY) / zoom;
  if (gesture.kind === 'move') {
    let moveX = dx,
      moveY = dy;
    if ($('snap').checked && !ev.altKey) {
      const movingIds = new Set(gesture.original.map((e) => e.id));
      const first = gesture.original.find((e) => selected.has(e.id)) || gesture.original[0],
        others = doc.elements.filter((e) => !movingIds.has(e.id));
      const snapDelta = (v, size, targets) => {
        let result = 0,
          best = 5;
        for (const edge of [v, v + size / 2, v + size])
          for (const t of targets)
            if (Math.abs(t - edge) < best) {
              best = Math.abs(t - edge);
              result = t - edge;
            }
        return result;
      };
      moveX += snapDelta(first.x + dx, first.w, [
        0,
        W / 2,
        W,
        ...others.flatMap((e) => [e.x, e.x + e.w, e.x + e.w / 2]),
      ]);
      moveY += snapDelta(first.y + dy, first.h, [
        0,
        H / 2,
        H,
        ...others.flatMap((e) => [e.y, e.y + e.h, e.y + e.h / 2]),
      ]);
    }
    const lead = gesture.original.find((e) => selected.has(e.id)) || gesture.original[0];
    const movingIds = new Set(gesture.original.map((e) => e.id));
    gesture.rowCandidate = null;
    activeGuideId = null;
    if ($('snap').checked && !ev.altKey && lead.type === 'text' && !lead.rowGuide) {
      const candidate = doc.elements
        .filter((e) => e.rowGuide && !movingIds.has(e.id))
        .map((anchor) => ({
          anchor,
          distance: Math.abs(guideY(anchor) - (lead.y + dy + baselineOffset(lead))),
        }))
        .sort((a, b) => a.distance - b.distance)[0];
      if (candidate && candidate.distance <= 8 / zoom) {
        moveY = guideY(candidate.anchor) - lead.y - baselineOffset(lead);
        gesture.rowCandidate = candidate.anchor.id;
        activeGuideId = candidate.anchor.id;
      }
    }
    const minX = Math.min(...gesture.original.map((e) => e.x)),
      maxX = Math.max(...gesture.original.map((e) => e.x + e.w));
    const minY = Math.min(...gesture.original.map((e) => e.y)),
      maxY = Math.max(...gesture.original.map((e) => e.y + e.h));
    moveX = Math.max(-minX, Math.min(W - maxX, moveX));
    moveY = Math.max(-minY, Math.min(H - maxY, moveY));
    gesture.original.forEach((o) =>
      Object.assign(
        doc.elements.find((e) => e.id === o.id),
        { x: o.x + moveX, y: o.y + moveY },
      ),
    );
  } else if (gesture.kind === 'resize-selection') {
    const bounds = gesture.bounds;
    const sx = gesture.corner.includes('w') ? -1 : 1;
    const sy = gesture.corner.includes('n') ? -1 : 1;
    const factorX = (bounds.w + sx * dx) / bounds.w;
    const factorY = (bounds.h + sy * dy) / bounds.h;
    const factor = Math.max(
      0.02,
      Math.abs(factorX - 1) > Math.abs(factorY - 1) ? factorX : factorY,
    );
    const x = sx < 0 ? bounds.x + bounds.w - bounds.w * factor : bounds.x;
    const y = sy < 0 ? bounds.y + bounds.h - bounds.h * factor : bounds.y;
    scaleElements(gesture.original, bounds, factor, x, y);
  } else {
    const o = gesture.original[0],
      e = doc.elements.find((e) => e.id === o.id),
      radians = (o.rotation * Math.PI) / 180;
    const localX = dx * Math.cos(radians) + dy * Math.sin(radians),
      localY = -dx * Math.sin(radians) + dy * Math.cos(radians);
    const sx = gesture.corner.includes('w') ? -1 : 1,
      sy = gesture.corner.includes('n') ? -1 : 1;
    let w = Math.max(8, o.w + sx * localX),
      h = Math.max(2, o.h + sy * localY);
    if (ev.shiftKey) {
      const ratio = o.w / o.h;
      h = w / ratio;
    }
    const cx = (sx * (w - o.w)) / 2,
      cy = (sy * (h - o.h)) / 2;
    Object.assign(e, {
      w,
      h,
      x: o.x + (o.w - w) / 2 + cx * Math.cos(radians) - cy * Math.sin(radians),
      y: o.y + (o.h - h) / 2 + cx * Math.sin(radians) + cy * Math.cos(radians),
    });
  }
  if (gesture.kind !== 'move') synchronizeRows(doc.elements, beforeFrame);
  render();
});
window.addEventListener('pointerup', () => {
  if (gesture?.kind === 'move' && gesture.committed) {
    const movedIds = new Set(gesture.original.map((e) => e.id));
    const anchor = doc.elements.find((e) => e.id === gesture.rowCandidate);
    if (anchor) {
      bindRow(
        anchor,
        doc.elements.filter((e) => movedIds.has(e.id) && e.type === 'text'),
      );
      toast('已吸附并绑定到该行基线');
    } else
      for (const child of doc.elements.filter(
        (e) => movedIds.has(e.id) && e.rowAnchorId && !movedIds.has(e.rowAnchorId),
      )) {
        const owner = doc.elements.find((e) => e.id === child.rowAnchorId);
        if (!owner || Math.abs(guideY(owner) - guideY(child)) > 8 / zoom) delete child.rowAnchorId;
      }
    synchronizeRows(doc.elements);
  }
  activeGuideId = null;
  if (gesture?.committed) render();
  else renderSelection();
  panGesture = null;
  if (marquee) {
    marquee = null;
    render();
  }
  if (gesture) {
    gesture = null;
    persist();
  }
});
window.addEventListener('blur', () => {
  panGesture = null;
  panMode = false;
  $('viewport').classList.remove('pan-mode');
  if (marquee) {
    marquee = null;
    render();
  }
  if (gesture) {
    gesture = null;
    persist();
  }
});
$('viewport').addEventListener(
  'pointerdown',
  (ev) => {
    if (ev.button === 0 && !ev.target.closest('[contenteditable=true]'))
      $('viewport').focus({ preventScroll: true });
    if (ev.button === 1 || (panMode && ev.button === 0)) {
      ev.preventDefault();
      ev.stopPropagation();
      panGesture = {
        x: ev.clientX,
        y: ev.clientY,
        left: $('viewport').scrollLeft,
        top: $('viewport').scrollTop,
      };
      return;
    }
    if (ev.button !== 0 || ev.target.closest('[contenteditable=true]')) return;
    const blank = !ev.target.closest('.element,.handle');
    if (selectionTool !== 'marquee' && !blank) return;
    ev.preventDefault();
    ev.stopPropagation();
    finishEditing();
    const start = paperPoint(ev);
    marquee = {
      start,
      box: { ...start, w: 0, h: 0 },
      previous: [...selected],
      seed: ev.shiftKey || ev.ctrlKey || ev.metaKey || ev.altKey ? [...selected] : [],
      subtract: ev.altKey,
    };
    selected = new Set(marquee.seed);
    render();
  },
  true,
);
function paperPoint(ev) {
  const rect = $('paper').getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(W, (ev.clientX - rect.left) / zoom)),
    y: Math.max(0, Math.min(H, (ev.clientY - rect.top) / zoom)),
  };
}
function setSelectionTool(tool) {
  selectionTool = tool;
  $('selectTool').setAttribute('aria-pressed', String(tool === 'select'));
  $('marqueeTool').setAttribute('aria-pressed', String(tool === 'marquee'));
  $('viewport').classList.toggle('marquee-mode', tool === 'marquee');
  renderSelection();
}
$('selectTool').onclick = () => setSelectionTool('select');
$('marqueeTool').onclick = () => setSelectionTool('marquee');
$('selectScope').onchange = () => {
  const kind = $('selectScope').value;
  if (!kind) return;
  finishEditing();
  selected = new Set(
    doc.elements
      .filter((e) => {
        if (kind === 'all') return true;
        if (kind === 'invert') return !e.locked && !selected.has(e.id);
        if (kind === 'shape') return ['rect', 'ellipse', 'line', 'shape'].includes(e.type);
        return e.type === kind;
      })
      .map((e) => e.id),
  );
  $('selectScope').value = '';
  render();
};
$('shortcutHelp').onclick = () => $('shortcutsDialog').showModal();
$('closeShortcuts').onclick = () => $('shortcutsDialog').close();
document.querySelectorAll('[data-add]').forEach((b) => (b.onclick = () => add(b.dataset.add)));
document.querySelectorAll('[data-prop]').forEach(
  (input) =>
    (input.onchange = () => {
      if (input.value === '') return;
      const key = input.dataset.prop;
      let value = input.type === 'number' ? Number(input.value) : input.value;
      if (input.type === 'number' && !Number.isFinite(value)) return;
      if (input.min !== '' && input.type === 'number') value = Math.max(Number(input.min), value);
      if (input.max !== '' && input.type === 'number') value = Math.min(Number(input.max), value);
      if (['x', 'y', 'w', 'h'].includes(key)) value *= MM;
      mutate(() => {
        const targets = propertyTargets(key);
        if (elements().length > 1 && ['x', 'y', 'w', 'h'].includes(key) && targets.length) {
          const bounds = boundsOf(targets);
          if (key === 'x' || key === 'y') targets.forEach((e) => (e[key] += value - bounds[key]));
          else scaleElements(clone(targets), bounds, value / bounds[key]);
          return;
        }
        targets.forEach((e) => {
          e[key] = value;
          if (key === 'strokeWidth' && e.type === 'line') e.h = Math.max(0.5, value);
          const cssKey = { fontFamily: 'font-family', fontSize: 'font-size', color: 'color' }[key];
          if (cssKey && e.type === 'text') e.html = clearInlineStyle(e.html, cssKey);
        });
      });
    }),
);
document
  .querySelectorAll('[data-align]')
  .forEach((button) => (button.onclick = () => alignSelection(button.dataset.align)));
$('alignReference').onchange = () => {
  alignReference = $('alignReference').value;
};
document
  .querySelectorAll('[data-text-align]')
  .forEach(
    (button) =>
      (button.onclick = () =>
        mutate(() =>
          propertyTargets('textAlign').forEach((e) => (e.textAlign = button.dataset.textAlign)),
        )),
  );
for (const key of ['bold', 'italic', 'underline']) {
  $(key).onpointerdown = (ev) => {
    if (editing) ev.preventDefault();
  };
  $(key).onclick = () => {
    if (editing) {
      document.execCommand(key, false);
      const el = [...$('paper').children].find((n) => n.dataset.id === editing);
      doc.elements.find((e) => e.id === editing).html = sanitize(
        el.querySelector('.content').innerHTML,
      );
      persist();
    } else
      mutate(() => {
        const targets = propertyTargets(key),
          value = !targets.every((e) => e[key]);
        targets.forEach((e) => {
          e[key] = value;
          if (key === 'bold') e.html = clearInlineStyle(e.html, 'font-weight');
        });
      });
  };
}
function clearInlineStyle(html, property) {
  const t = document.createElement('template');
  t.innerHTML = html;
  t.content.querySelectorAll('*').forEach((el) => el.style.removeProperty(property));
  return t.innerHTML;
}
$('editText').onclick = () => startEditing([...selected][0]);
$('fitText').onclick = () =>
  mutate(() =>
    elements()
      .filter((e) => e.type === 'text' && !e.locked)
      .forEach((e) => {
        const el = [...$('paper').children].find((n) => n.dataset.id === e.id);
        const c = el.querySelector('.content');
        c.style.height = 'auto';
        e.h = Math.max(10, c.scrollHeight);
      }),
  );
$('noFill').onclick = () =>
  mutate(() =>
    elements()
      .filter((e) => !e.locked)
      .forEach((e) => (e.fill = 'transparent')),
  );
$('lock').onclick = () =>
  mutate(() => {
    const lock = !elements().every((e) => e.locked);
    elements().forEach((e) => (e.locked = lock));
  });
$('delete').onclick = () =>
  mutate(() => {
    doc.elements = doc.elements.filter((e) => !selected.has(e.id) || e.locked);
    selected.clear();
  });
$('duplicate').onclick = () => {
  if (!selected.size) return;
  mutate(() => {
    const source = elements(),
      bounds = boundsOf(source);
    const copies = copyElements(
      source,
      Math.min(12, W - bounds.x - bounds.w),
      Math.min(12, H - bounds.y - bounds.h),
    );
    doc.elements.push(...copies);
    selected = new Set(copies.map((e) => e.id));
  });
};
function copyElements(source, dx, dy) {
  const groups = new Map(),
    groupCounts = new Map();
  for (const e of source)
    if (e.groupId) groupCounts.set(e.groupId, (groupCounts.get(e.groupId) || 0) + 1);
  const copies = source.map((original) => {
    const e = {
      ...clone(original),
      id: uid(),
      x: original.x + dx,
      y: original.y + dy,
      locked: false,
    };
    if (e.groupId && groupCounts.get(e.groupId) > 1) {
      if (!groups.has(e.groupId)) groups.set(e.groupId, uid());
      e.groupId = groups.get(e.groupId);
    } else delete e.groupId;
    return e;
  });
  remapRowReferences(copies, source);
  return copies;
}
function groupSelection() {
  const list = editableElements();
  if (list.length < 2) return;
  mutate(() => {
    const groupId = uid();
    for (const e of list) e.groupId = groupId;
  });
  toast(`已组合 ${list.length} 个元素，Alt 点选可单独编辑`);
}
function ungroupSelection() {
  const groups = new Set(
    editableElements()
      .map((e) => e.groupId)
      .filter(Boolean),
  );
  if (!groups.size) return;
  mutate(() =>
    doc.elements.filter((e) => groups.has(e.groupId) && !e.locked).forEach((e) => delete e.groupId),
  );
  toast('已取消组合');
}
$('group').onclick = groupSelection;
$('ungroup').onclick = ungroupSelection;
function alignSelection(direction) {
  const units = selectionUnits();
  if (!units.length) return;
  const target =
    units.length > 1 && alignReference === 'selection'
      ? boundsOf(editableElements())
      : { x: 0, y: 0, w: W, h: H };
  mutate(() => {
    for (const unit of units) {
      let dx = 0,
        dy = 0;
      if (direction === 'left') dx = target.x - unit.x;
      if (direction === 'center') dx = target.x + target.w / 2 - unit.x - unit.w / 2;
      if (direction === 'right') dx = target.x + target.w - unit.x - unit.w;
      if (direction === 'top') dy = target.y - unit.y;
      if (direction === 'middle') dy = target.y + target.h / 2 - unit.y - unit.h / 2;
      if (direction === 'bottom') dy = target.y + target.h - unit.y - unit.h;
      for (const e of unit.members) {
        e.x += dx;
        e.y += dy;
      }
    }
  });
}
function distributeSelection(axis) {
  const units = selectionUnits();
  if (units.length < 3) return;
  const position = axis === 'x' ? 'x' : 'y',
    size = axis === 'x' ? 'w' : 'h';
  units.sort((a, b) => a[position] - b[position]);
  const start = units[0][position],
    last = units.at(-1);
  const space =
    (last[position] + last[size] - start - units.reduce((sum, e) => sum + e[size], 0)) /
    (units.length - 1);
  mutate(() => {
    let cursor = start;
    for (const unit of units) {
      const delta = cursor - unit[position];
      for (const e of unit.members) e[position] += delta;
      cursor += unit[size] + space;
    }
  });
}
$('distributeX').onclick = () => distributeSelection('x');
$('distributeY').onclick = () => distributeSelection('y');
document.querySelectorAll('[data-same-size]').forEach(
  (button) =>
    (button.onclick = () => {
      const list = editableElements();
      if (list.length < 2) return;
      const anchor = [...selected].map((id) => list.find((e) => e.id === id)).find(Boolean);
      const width = anchor.w,
        height = anchor.h;
      mutate(() =>
        list.forEach((e) => {
          if (button.dataset.sameSize !== 'h') e.w = width;
          if (button.dataset.sameSize !== 'w') e.h = height;
        }),
      );
    }),
);
function reorder(mode) {
  mutate(() => {
    if (mode === 'front' || mode === 'back') {
      const chosen = doc.elements.filter((e) => selected.has(e.id) && !e.locked),
        rest = doc.elements.filter((e) => !chosen.includes(e));
      doc.elements = mode === 'front' ? [...rest, ...chosen] : [...chosen, ...rest];
      return;
    }
    const indices = doc.elements.map((_, i) => i);
    if (mode === 'forward') indices.reverse();
    for (const i of indices) {
      const j = i + (mode === 'forward' ? 1 : -1);
      if (j < 0 || j >= doc.elements.length) continue;
      const a = doc.elements[i],
        b = doc.elements[j];
      if (selected.has(a.id) && !a.locked && !selected.has(b.id))
        [doc.elements[i], doc.elements[j]] = [b, a];
    }
  });
}
for (const mode of ['front', 'back', 'forward', 'backward']) $(mode).onclick = () => reorder(mode);
function undo(redo = false) {
  if (window.paperHistory) {
    finishEditing();
    window.paperHistory.undo(redo);
    return;
  }
  $('contextMenu').hidden = true;
  finishEditing();
  const from = redo ? future : history,
    to = redo ? history : future;
  if (!from.length) return;
  to.push(JSON.stringify(doc));
  doc = JSON.parse(from.pop());
  selected = new Set([...selected].filter((id) => doc.elements.some((e) => e.id === id)));
  changed();
}
$('undo').onclick = () => undo();
$('redo').onclick = () => undo(true);
$('grid').onchange = () => $('paper').classList.toggle('grid', $('grid').checked);
$('zoom').onchange = () => setZoom(Number($('zoom').value));
$('fit').onclick = fit;
$('docName').onchange = () => {
  const name = $('docName').value.trim() || '未命名文档';
  mutate(() => (doc.name = name));
};
$('pageColor').onchange = () => {
  const color = $('pageColor').value;
  mutate(() => (doc.background = color));
};
function saveProject() {
  document.dispatchEvent(new CustomEvent('paper-save-project'));
}
$('save').onclick = saveProject;
$('open').onclick = () => $('projectFile').click();
function validateProject(data) {
  if (
    data.version !== 1 ||
    !Array.isArray(data.elements) ||
    data.elements.length > 5000 ||
    typeof data.name !== 'string' ||
    !/^#[0-9a-f]{6}$/i.test(data.background)
  )
    throw Error('不支持的工程格式');
  const ids = new Set();
  data.elements = data.elements.map((item) => {
    if (!['text', 'rect', 'ellipse', 'line', 'image', 'shape'].includes(item.type))
      throw Error('未知元素类型');
    if (item.type === 'shape' && !Object.hasOwn(SHAPE_PATHS, item.shape)) throw Error('未知图形');
    const e = base(item.type, item);
    if (typeof e.id !== 'string' || ids.has(e.id)) e.id = uid();
    ids.add(e.id);
    for (const k of [
      'x',
      'y',
      'w',
      'h',
      'rotation',
      'opacity',
      'fontSize',
      'lineHeight',
      'strokeWidth',
      'radius',
    ])
      if (!Number.isFinite(e[k])) throw Error('元素尺寸无效');
    if (e.w <= 0 || e.h <= 0 || e.w > 20000 || e.h > 20000) throw Error('元素尺寸超出范围');
    if (e.type === 'image' && !/^data:image\/(png|jpeg|webp|gif);base64,/i.test(e.src))
      throw Error('图片格式无效');
    if (
      typeof e.fill !== 'string' ||
      typeof e.color !== 'string' ||
      !CSS.supports('color', e.fill) ||
      !CSS.supports('color', e.color)
    )
      throw Error('元素颜色无效');
    if (e.groupId !== undefined && (typeof e.groupId !== 'string' || e.groupId.length > 128))
      throw Error('组合信息无效');
    e.html = sanitize(String(e.html || ''));
    return e;
  });
  return data;
}
$('projectFile').onchange = async (ev) => {
  const file = ev.target.files[0];
  if (!file) return;
  try {
    const next = validateProject(JSON.parse(await file.text()));
    await confirmReplace('打开工程', () =>
      mutate(() => {
        doc = next;
        selected.clear();
      }),
    );
  } catch (err) {
    toast('无法打开工程文件 ' + err.message);
  }
  ev.target.value = '';
};
$('image').onclick = () => {
  replaceImage = false;
  imageAsBackground = false;
  $('imageFile').click();
};
$('replaceImage').onclick = () => {
  replaceImage = true;
  imageAsBackground = false;
  $('imageFile').click();
};
$('imageFile').onchange = async (ev) => {
  const file = ev.target.files[0];
  if (!file) return;
  const background = imageAsBackground,
    replacing = replaceImage;
  const targetIds = new Set(selected);
  try {
    if (file.size > 25 * 1024 * 1024) throw Error('请选择小于 25 MB 的图片');
    const src = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(Error('读取图片失败'));
      r.readAsDataURL(file);
    });
    const img = new Image();
    img.src = src;
    await img.decode();
    if (background)
      mutate(() => {
        const e = base('image', {
          src,
          x: 0,
          y: 0,
          w: W,
          h: H,
          objectFit: 'cover',
          name: '纸张背景图片',
        });
        doc.elements.unshift(e);
        selected = new Set([e.id]);
      });
    else if (replacing)
      mutate(() =>
        doc.elements
          .filter((e) => targetIds.has(e.id) && e.type === 'image' && !e.locked)
          .forEach((e) => (e.src = src)),
      );
    else {
      const w = Math.min(280, img.naturalWidth),
        h = Math.min(600, (w * img.naturalHeight) / img.naturalWidth);
      add('image', { src, w: (h * img.naturalWidth) / img.naturalHeight, h, objectFit: 'cover' });
    }
  } catch (err) {
    toast(err.message);
  }
  ev.target.value = '';
};
$('print').onclick = () => {
  finishEditing();
  document.title = doc.name + ' · A4';
  window.print();
};
window.addEventListener('beforeprint', finishEditing);
async function confirmReplace(title, action) {
  if (!doc.elements.length) {
    await action();
    return;
  }
  $('confirmTitle').textContent = title;
  $('confirmDialog').showModal();
  return new Promise((resolve, reject) => {
    const close = () => {
      $('confirmDialog').close();
      resolve();
    };
    $('confirmCancel').onclick = close;
    $('confirmDialog').oncancel = () => resolve();
    $('confirmContinue').onclick = async () => {
      close();
      try {
        await action();
      } catch (e) {
        toast(e.message);
        reject(e);
      }
    };
    $('confirmSave').onclick = async () => {
      saveProject();
      close();
      try {
        await action();
      } catch (e) {
        toast(e.message);
        reject(e);
      }
    };
  });
}
$('blank').onclick = () =>
  confirmReplace('新建空白文档', () =>
    mutate(() => {
      doc = { version: 1, name: '未命名文档', background: '#ffffff', elements: [] };
      selected.clear();
    }),
  );
window.addEventListener('keydown', (ev) => {
  if (document.querySelector('dialog[open]')) return;
  const typing = ev.target.closest('input,textarea,select,[contenteditable=true]');
  const mod = ev.ctrlKey || ev.metaKey,
    key = ev.key.toLowerCase();
  if (mod && ['+', '=', '-', '_', '0', '1'].includes(key)) {
    ev.preventDefault();
    if (key === '0') setZoom(1);
    else if (key === '1') fit();
    else setZoom(zoom * (key === '-' || key === '_' ? 1 / 1.15 : 1.15));
    return;
  }
  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 's') {
    ev.preventDefault();
    document.dispatchEvent(new CustomEvent('paper-save-project'));
    return;
  }
  if (ev.key === 'Escape') {
    if (!$('contextMenu').hidden || !$('assetLibrary').hidden) {
      closePopovers();
      return;
    }
    if (marquee) {
      selected = new Set(marquee.previous);
      marquee = null;
      render();
      return;
    }
    if (gesture) {
      if (gesture.committed) {
        for (const original of gesture.original)
          Object.assign(
            doc.elements.find((e) => e.id === original.id),
            original,
          );
        if (window.paperHistory) {
          window.paperHistory.undo();
        } else history.pop();
        persist();
      }
      gesture = null;
      render();
      return;
    }
    finishEditing();
    selected.clear();
    render();
    return;
  }
  if (typing) return;
  if (!mod && key === '?') {
    ev.preventDefault();
    $('shortcutsDialog').showModal();
    return;
  }
  if (!mod && ['v', 'm'].includes(key)) {
    ev.preventDefault();
    setSelectionTool(key === 'v' ? 'select' : 'marquee');
    return;
  }
  if (mod && key === 'g') {
    ev.preventDefault();
    if (ev.shiftKey) ungroupSelection();
    else groupSelection();
    return;
  }
  if (ev.code === 'Space' && !ev.target.closest('button,[role=menu]')) {
    ev.preventDefault();
    panMode = true;
    $('viewport').classList.add('pan-mode');
    return;
  }
  if (mod && key === 'c') {
    ev.preventDefault();
    copySelection();
    return;
  }
  if (mod && key === 'x') {
    ev.preventDefault();
    copySelection(true);
    return;
  }
  if (mod && key === 'v') {
    ev.preventDefault();
    pasteSelection();
    return;
  }
  if (mod && key === 'z') {
    ev.preventDefault();
    undo(ev.shiftKey);
    return;
  }
  if (mod && key === 'y') {
    ev.preventDefault();
    undo(true);
    return;
  }
  if (mod && key === 'd') {
    ev.preventDefault();
    $('duplicate').click();
    return;
  }
  if (mod && key === 'a') {
    ev.preventDefault();
    selected = new Set(doc.elements.map((e) => e.id));
    render();
    return;
  }
  if (ev.key === 'Delete' || ev.key === 'Backspace') {
    ev.preventDefault();
    $('delete').click();
    return;
  }
  if (ev.key.startsWith('Arrow') && selected.size) {
    const list = boundMoveMembers(editableElements(), doc.elements);
    if (!list.length) return;
    ev.preventDefault();
    const step = ev.shiftKey ? 10 : 1,
      bounds = boundsOf(list);
    const dx = Math.max(
      -bounds.x,
      Math.min(
        W - bounds.x - bounds.w,
        ev.key === 'ArrowLeft' ? -step : ev.key === 'ArrowRight' ? step : 0,
      ),
    );
    const dy = Math.max(
      -bounds.y,
      Math.min(
        H - bounds.y - bounds.h,
        ev.key === 'ArrowUp' ? -step : ev.key === 'ArrowDown' ? step : 0,
      ),
    );
    mutate(() =>
      list.forEach((e) => {
        e.x += dx;
        e.y += dy;
      }),
    );
  }
});
window.addEventListener('keyup', (ev) => {
  if (ev.code === 'Space') {
    panMode = false;
    $('viewport').classList.remove('pan-mode');
  }
});
window.addEventListener(
  'wheel',
  (ev) => {
    if (!ev.ctrlKey && !ev.metaKey) return;
    ev.preventDefault();
    const rect = $('viewport').getBoundingClientRect();
    const inCanvas =
      ev.clientX >= rect.left &&
      ev.clientX <= rect.right &&
      ev.clientY >= rect.top &&
      ev.clientY <= rect.bottom;
    const delta = ev.deltaY * (ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? 400 : 1);
    setZoom(
      zoom * Math.exp(-Math.max(-100, Math.min(100, delta)) * 0.002),
      inCanvas ? { x: ev.clientX, y: ev.clientY } : undefined,
    );
    $('contextMenu').hidden = true;
  },
  { passive: false },
);
$('zoomIn').onclick = () => setZoom(zoom * 1.15);
$('zoomOut').onclick = () => setZoom(zoom / 1.15);

function shapeSvg(shape, fill = '#dfebe1', color = '#246b53', width = 1.5, dash = 'solid') {
  const path = SHAPE_PATHS[shape];
  if (!path) return '';
  const pattern = { dashed: '8 5', dotted: '2 4' }[dash] || 'none';
  return `<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path d="${path}" fill="${escapeHtml(fill)}" stroke="${escapeHtml(color)}" stroke-width="${Number(width)}" stroke-dasharray="${pattern}" vector-effect="non-scaling-stroke" /></svg>`;
}

function copySelection(cut = false) {
  finishEditing();
  const source = elements().filter((e) => !cut || !e.locked);
  if (!source.length) {
    toast('请先选择可操作的元素');
    return;
  }
  canvasClipboard = clone(source);
  if (cut)
    mutate(() => {
      const ids = new Set(source.map((e) => e.id));
      doc.elements = doc.elements.filter((e) => !ids.has(e.id));
      selected.clear();
    });
  toast(cut ? '已剪切，可在画布中粘贴' : '已复制，可在画布中粘贴');
}
function pasteSelection(point) {
  if (!canvasClipboard.length) return;
  mutate(() => {
    const left = Math.min(...canvasClipboard.map((e) => e.x));
    const top = Math.min(...canvasClipboard.map((e) => e.y));
    const right = Math.max(...canvasClipboard.map((e) => e.x + e.w));
    const bottom = Math.max(...canvasClipboard.map((e) => e.y + e.h));
    const dx = Math.max(-left, Math.min(W - right, point ? point.x - left : 18));
    const dy = Math.max(-top, Math.min(H - bottom, point ? point.y - top : 18));
    const copies = copyElements(canvasClipboard, dx, dy);
    doc.elements.push(...copies);
    selected = new Set(copies.map((e) => e.id));
  });
}
function closePopovers() {
  $('contextMenu').hidden = true;
  $('assetLibrary').hidden = true;
}
function placePopover(element, x, y) {
  element.hidden = false;
  const rect = element.getBoundingClientRect();
  element.style.left = Math.max(8, Math.min(window.innerWidth - rect.width - 8, x)) + 'px';
  element.style.top = Math.max(8, Math.min(window.innerHeight - rect.height - 8, y)) + 'px';
}
function openAssets(kind, point) {
  closePopovers();
  $('assetTitle').textContent = kind === 'shapes' ? '常用图形' : '背景与边框';
  const content = $('assetContent');
  content.replaceChildren();
  const grid = document.createElement('div');
  grid.className = 'asset-grid';
  const addPreset = (name, type, extra, preview) => {
    const button = document.createElement('button');
    button.className = 'asset-item';
    const icon = document.createElement('span');
    icon.className = 'asset-preview';
    if (preview) icon.innerHTML = preview;
    else
      Object.assign(icon.style, {
        background: extra.fill,
        border: `${extra.strokeWidth || 0}px ${extra.dash || 'solid'} ${extra.color || '#246b53'}`,
        borderRadius: type === 'ellipse' ? '50%' : (extra.radius || 0) + 'px',
      });
    const label = document.createElement('span');
    label.textContent = name;
    button.append(icon, label);
    button.onclick = () => {
      closePopovers();
      const position = point
        ? { x: Math.min(W - 160, point.x), y: Math.min(H - 120, point.y) }
        : {};
      add(type, { ...position, ...extra, name });
    };
    grid.append(button);
  };
  if (kind === 'shapes') {
    addPreset('矩形', 'rect', { fill: '#dfebe1' });
    addPreset('圆角矩形', 'rect', { fill: '#dfebe1', radius: 18 });
    addPreset('圆形', 'ellipse', { fill: '#dfebe1', w: 130, h: 130 });
    addPreset('椭圆', 'ellipse', { fill: '#dfebe1' });
    for (const [shape, name] of Object.entries(SHAPE_NAMES))
      addPreset(
        name,
        'shape',
        { shape, fill: '#dfebe1', strokeWidth: 1.5, color: '#246b53' },
        shapeSvg(shape),
      );
    content.append(grid);
  } else {
    const title = document.createElement('h4');
    title.textContent = '背景框与边框';
    content.append(title);
    addPreset('浅绿背景框', 'rect', { w: 300, h: 160, fill: '#e6f0e8', radius: 12 });
    addPreset('浅蓝背景框', 'rect', { w: 300, h: 160, fill: '#e8eff8', radius: 12 });
    addPreset('米色背景框', 'rect', { w: 300, h: 160, fill: '#f6eddf', radius: 12 });
    addPreset('深色标题框', 'rect', { w: 300, h: 60, fill: '#246b53', radius: 6 });
    addPreset('细线边框', 'rect', {
      w: 300,
      h: 160,
      fill: 'transparent',
      strokeWidth: 1.5,
      color: '#246b53',
    });
    addPreset('圆角边框', 'rect', {
      w: 300,
      h: 160,
      fill: 'transparent',
      strokeWidth: 2,
      color: '#246b53',
      radius: 16,
    });
    addPreset('虚线边框', 'rect', {
      w: 300,
      h: 160,
      fill: 'transparent',
      strokeWidth: 2,
      color: '#83988a',
      dash: 'dashed',
    });
    addPreset('整页边框', 'rect', {
      x: 12 * MM,
      y: 12 * MM,
      w: 186 * MM,
      h: 273 * MM,
      fill: 'transparent',
      strokeWidth: 1.5,
      color: '#246b53',
    });
    content.append(grid);
    const paperTitle = document.createElement('h4');
    paperTitle.textContent = '纸张背景颜色';
    content.append(paperTitle);
    const swatches = document.createElement('div');
    swatches.className = 'background-swatches';
    for (const color of ['#ffffff', '#faf7f0', '#eaf2ed', '#eaf0f9', '#f5ecef', '#e9e9e9']) {
      const b = document.createElement('button');
      b.style.background = color;
      b.title = color;
      b.setAttribute('aria-label', '纸张背景 ' + color);
      b.onclick = () => mutate(() => (doc.background = color));
      swatches.append(b);
    }
    content.append(swatches);
    const imageButton = document.createElement('button');
    imageButton.className = 'wide';
    imageButton.textContent = '使用图片作为纸张背景';
    imageButton.onclick = () => {
      closePopovers();
      replaceImage = false;
      imageAsBackground = true;
      $('imageFile').click();
    };
    content.append(imageButton);
  }
  const source = $(kind === 'shapes' ? 'shapes' : 'backgrounds').getBoundingClientRect();
  placePopover($('assetLibrary'), source.right + 12, Math.min(source.top, 160));
}
$('shapes').onclick = () => openAssets('shapes');
$('backgrounds').onclick = () => openAssets('backgrounds');
$('closeAssets').onclick = closePopovers;

function openContextMenu(clientX, clientY, target) {
  closePopovers();
  finishEditing();
  if (target && !selected.has(target.dataset.id)) select(target.dataset.id);
  if (!target) {
    selected.clear();
    render();
  }
  const paperRect = $('paper').getBoundingClientRect();
  const point = {
    x: Math.max(0, Math.min(W, (clientX - paperRect.left) / zoom)),
    y: Math.max(0, Math.min(H, (clientY - paperRect.top) / zoom)),
  };
  const menu = $('contextMenu');
  menu.replaceChildren();
  const item = (label, shortcut, action, disabled = false) => {
    const button = document.createElement('button');
    button.setAttribute('role', 'menuitem');
    button.disabled = disabled;
    const text = document.createElement('span');
    text.textContent = label;
    const hint = document.createElement('small');
    hint.textContent = shortcut;
    button.append(text, hint);
    button.onclick = () => {
      menu.hidden = true;
      action();
    };
    menu.append(button);
  };
  const separator = () => menu.append(document.createElement('hr'));
  if (selected.size) {
    const first = elements()[0],
      editable = elements().some((e) => !e.locked);
    if (first.type === 'text' && selected.size === 1)
      item('编辑文字', '双击', () => startEditing(first.id), first.locked);
    const rowAnchor = selectedRowAnchor();
    if (rowAnchor) {
      if (selected.size === 1 && rowAnchor.rowGuide)
        item('移除绑定基线', '', () => mutate(() => detachGuide(rowAnchor, doc.elements)));
      else
        item(selected.size > 1 ? '将所选文字绑定成一行' : '创建横向绑定基线', '', createRowGuide);
      const candidates = doc.elements
        .filter((e) => e.rowGuide && !selected.has(e.id))
        .sort(
          (a, b) =>
            Math.abs(guideY(a) - guideY(rowAnchor)) - Math.abs(guideY(b) - guideY(rowAnchor)),
        )
        .slice(0, 3);
      for (const anchor of candidates) {
        const name = anchor.html.replace(/<[^>]*>/g, '').slice(0, 12);
        item('绑定到基线 · ' + name, '', () =>
          mutate(() =>
            bindRow(
              anchor,
              editableElements().filter((e) => e.type === 'text'),
            ),
          ),
        );
      }
    }
    if (editableElements().some((e) => e.rowAnchorId))
      item('解除行绑定', '', () =>
        mutate(() => editableElements().forEach((e) => delete e.rowAnchorId)),
      );
    if (editableElements().filter((e) => e.type === 'text').length > 1)
      item('合并为一个文字框', '', mergeSelectedText);
    separator();
    item('剪切', 'Ctrl+X', () => copySelection(true), !editable);
    item('复制', 'Ctrl+C', () => copySelection());
    item('粘贴到此处', 'Ctrl+V', () => pasteSelection(point), !canvasClipboard.length);
    item('制作副本', 'Ctrl+D', () => $('duplicate').click());
    item('删除', 'Delete', () => $('delete').click(), !editable);
    item('选择同类元素', '', () => {
      selected = new Set(doc.elements.filter((e) => e.type === first.type).map((e) => e.id));
      render();
    });
    if (editableElements().length > 1) item('组合', 'Ctrl+G', groupSelection);
    if (editableElements().some((e) => e.groupId))
      item('取消组合', 'Ctrl+Shift+G', ungroupSelection);
    if (selectionUnits().length > 1) {
      item('左对齐所选元素', '', () => {
        alignReference = 'selection';
        alignSelection('left');
      });
      item('顶端对齐所选元素', '', () => {
        alignReference = 'selection';
        alignSelection('top');
      });
    }
    if (selectionUnits().length > 2) {
      item('水平等距分布', '', () => distributeSelection('x'));
      item('垂直等距分布', '', () => distributeSelection('y'));
    }
    separator();
    const arrange = document.createElement('div');
    arrange.className = 'context-arrange';
    for (const [mode, label] of [
      ['forward', '上移'],
      ['backward', '下移'],
      ['front', '置顶'],
      ['back', '置底'],
    ]) {
      const b = document.createElement('button');
      b.textContent = label;
      b.disabled = !editable;
      b.setAttribute('role', 'menuitem');
      b.onclick = () => {
        menu.hidden = true;
        reorder(mode);
      };
      arrange.append(b);
    }
    menu.append(arrange);
    item(elements().every((e) => e.locked) ? '解锁元素' : '锁定元素', '', () => $('lock').click());
    if (selected.size === 1 && ['rect', 'image'].includes(first.type))
      item(
        '设为整页背景',
        '',
        () =>
          mutate(() => {
            Object.assign(first, {
              x: 0,
              y: 0,
              w: W,
              h: H,
              rotation: 0,
              name: '整页背景',
              objectFit: 'cover',
            });
            doc.elements = doc.elements.filter((e) => e.id !== first.id);
            doc.elements.unshift(first);
          }),
        first.locked,
      );
  } else {
    item('撤销', 'Ctrl+Z', () => undo(), !history.length);
    item('重做', 'Ctrl+Shift+Z', () => undo(true), !future.length);
    item('粘贴到此处', 'Ctrl+V', () => pasteSelection(point), !canvasClipboard.length);
    separator();
    item('在此处添加文字', '', () =>
      add('text', { x: Math.min(W - 240, point.x), y: Math.min(H - 48, point.y) }),
    );
    item('添加常用图形', '', () => openAssets('shapes', point));
    item('背景与边框', '', () => openAssets('backgrounds', point));
  }
  separator();
  item('画布原始大小', 'Ctrl+0', () => setZoom(1));
  item('适合窗口', 'Ctrl+1', fit);
  placePopover(menu, clientX, clientY);
  menu.querySelector('button:not(:disabled)')?.focus({ preventScroll: true });
}
$('viewport').addEventListener('contextmenu', (ev) => {
  if (ev.target.closest('[contenteditable=true]')) return;
  ev.preventDefault();
  let target = ev.target.closest('.element');
  if (!target && selected.size) {
    const point = paperPoint(ev),
      bounds = boundsOf(elements());
    const inside =
      point.x >= bounds.x &&
      point.x <= bounds.x + bounds.w &&
      point.y >= bounds.y &&
      point.y <= bounds.y + bounds.h;
    if (ev.target.closest('.handle') || (selected.size > 1 && inside))
      target = [...$('paper').children].find((el) => el.dataset.id === [...selected][0]);
  }
  openContextMenu(ev.clientX, ev.clientY, target);
});
$('contextMenu').addEventListener('keydown', (ev) => {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(ev.key)) return;
  ev.preventDefault();
  ev.stopPropagation();
  const items = [...$('contextMenu').querySelectorAll('button:not(:disabled)')];
  const index = items.indexOf(document.activeElement);
  const next =
    ev.key === 'Home'
      ? 0
      : ev.key === 'End'
        ? items.length - 1
        : (index + (ev.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
  items[next]?.focus();
});
document.addEventListener('pointerdown', (ev) => {
  if (!ev.target.closest('#contextMenu,#assetLibrary,#shapes,#backgrounds')) closePopovers();
});
window.addEventListener('resize', closePopovers);

window.paperEditor = {
  getDocument: () => clone(doc),
  validate: validateProject,
  setDocument: (value) => {
    const previous = [...selected];
    doc = validateProject(clone(value));
    synchronizeRows(doc.elements);
    selected = new Set(previous.filter((id) => doc.elements.some((e) => e.id === id)));
    editing = null;
    gesture = null;
    render();
  },
  render,
  finishEditing,
  fit,
  toast,
};
render();
let initialZoom = 1;
try {
  const view = JSON.parse(localStorage.getItem(VIEW_STORAGE));
  if (view && Number.isFinite(view.zoom)) initialZoom = view.zoom;
} catch {}
setZoom(initialZoom);
$('viewport').scrollTop = 0;
$('viewport').scrollLeft = 0;

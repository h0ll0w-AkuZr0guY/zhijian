import type { CanvasElement } from './model';

type Point = [number, number];
export const polygons: Record<string, { name: string; points: Point[] }> = {
  triangle: {
    name: '三角形',
    points: [
      [50, 2],
      [98, 98],
      [2, 98],
    ],
  },
  diamond: {
    name: '菱形',
    points: [
      [50, 2],
      [98, 50],
      [50, 98],
      [2, 50],
    ],
  },
  pentagon: {
    name: '五边形',
    points: [
      [50, 2],
      [98, 38],
      [80, 98],
      [20, 98],
      [2, 38],
    ],
  },
  hexagon: {
    name: '六边形',
    points: [
      [26, 2],
      [74, 2],
      [98, 50],
      [74, 98],
      [26, 98],
      [2, 50],
    ],
  },
  star: {
    name: '五角星',
    points: [
      [50, 2],
      [62, 36],
      [98, 37],
      [70, 59],
      [80, 96],
      [50, 75],
      [20, 96],
      [30, 59],
      [2, 37],
      [38, 36],
    ],
  },
  arrow: {
    name: '箭头',
    points: [
      [2, 28],
      [60, 28],
      [60, 2],
      [98, 50],
      [60, 98],
      [60, 72],
      [2, 72],
    ],
  },
  chevron: {
    name: '燕尾箭头',
    points: [
      [2, 2],
      [55, 2],
      [98, 50],
      [55, 98],
      [2, 98],
      [45, 50],
    ],
  },
  parallelogram: {
    name: '平行四边形',
    points: [
      [26, 2],
      [98, 2],
      [74, 98],
      [2, 98],
    ],
  },
  trapezoid: {
    name: '等腰梯形',
    points: [
      [26, 2],
      [74, 2],
      [98, 98],
      [2, 98],
    ],
  },
  'right-trapezoid': {
    name: '直角梯形',
    points: [
      [2, 2],
      [74, 2],
      [98, 98],
      [2, 98],
    ],
  },
};

export const adjustableInset = (shape?: string) =>
  shape === 'parallelogram' || shape === 'trapezoid' || shape === 'right-trapezoid';
export const shapeDash = (dash?: string) =>
  dash === 'dashed' ? [8, 5] : dash === 'dotted' ? [2, 4] : undefined;

export function cornerValues(e: CanvasElement): [number, number, number, number] {
  return e.cornerRadii ?? [e.radius, e.radius, e.radius, e.radius];
}
function toward([x, y]: Point, [tx, ty]: Point, distance: number): Point {
  const length = Math.hypot(tx - x, ty - y);
  const fraction = length ? Math.min(0.5, distance / length) : 0;
  return [x + (tx - x) * fraction, y + (ty - y) * fraction];
}
export function shapePath(e: CanvasElement): string {
  if (e.type === 'line') return `M0 ${e.h / 2} H${e.w}`;
  let points: Point[] = [
    [0, 0],
    [100, 0],
    [100, 100],
    [0, 100],
  ];
  if (e.type === 'shape') {
    points = polygons[e.shape!]?.points ?? points;
    const inset = e.shapeInset ?? 24;
    if (e.shape === 'parallelogram')
      points = [
        [2 + inset, 2],
        [98, 2],
        [98 - inset, 98],
        [2, 98],
      ];
    if (e.shape === 'trapezoid')
      points = [
        [2 + inset, 2],
        [98 - inset, 2],
        [98, 98],
        [2, 98],
      ];
    if (e.shape === 'right-trapezoid')
      points = [
        [2, 2],
        [98 - inset, 2],
        [98, 98],
        [2, 98],
      ];
  }
  const vertices: Point[] = points.map(([x, y]) => [
    ((e.flipX ? 100 - x : x) * e.w) / 100,
    ((e.flipY ? 100 - y : y) * e.h) / 100,
  ]);
  const radii = points.length === 4 ? cornerValues(e) : [];
  return (
    vertices
      .map((point, index) => {
        const radius = radii[index] ?? e.radius;
        const command = index ? 'L' : 'M';
        if (!radius) return command + point.join(' ');
        const before = toward(point, vertices.at(index - 1)!, radius);
        const after = toward(point, vertices[(index + 1) % vertices.length], radius);
        return `${command}${before.join(' ')} Q${point.join(' ')} ${after.join(' ')}`;
      })
      .join(' ') + ' Z'
  );
}

export function shapeNode(e: CanvasElement): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${e.w} ${e.h}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.cssText = 'display:block;width:100%;height:100%;overflow:visible;pointer-events:none';
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', shapePath(e));
  path.setAttribute('fill', e.type === 'line' ? 'none' : e.fill);
  path.setAttribute('stroke', e.color);
  path.setAttribute('stroke-width', String(e.type === 'line' ? e.h : e.strokeWidth));
  const dash = shapeDash(e.dash);
  if (dash) path.setAttribute('stroke-dasharray', dash.join(' '));
  svg.append(path);
  return svg;
}

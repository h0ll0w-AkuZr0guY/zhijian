import { describe, expect, it } from 'vitest';
import { element, MM } from '../src/core/model';
import { shapePath } from '../src/core/shapes';

describe('Canvas shape geometry', () => {
  it('keeps a fractional line centered within its physical thickness', () => {
    const line = element('line', { w: 135, h: 0.1 * MM });
    expect(shapePath(line)).toBe(`M0 ${line.h / 2} H135`);
  });

  it('flips an adjustable right trapezoid within its existing bounds', () => {
    const shape = element('shape', { shape: 'right-trapezoid', w: 200, h: 100, shapeInset: 36 });
    expect(shapePath(shape)).toBe('M4 2 L124 2 L196 98 L4 98 Z');
    expect(shapePath({ ...shape, flipX: true })).toBe('M196 2 L76 2 L4 98 L196 98 Z');
  });

  it('rounds a single corner and keeps all other vertices sharp', () => {
    const rect = element('rect', { w: 100, h: 50, cornerRadii: [12, 0, 0, 0] });
    expect(shapePath(rect)).toBe('M0 12 Q0 0 12 0 L100 0 L100 50 L0 50 Z');
  });
});

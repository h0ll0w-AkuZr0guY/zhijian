import { createFont } from 'fonteditor-core';

/** Build a complete, compact TTF before PDF embedding to preserve CJK glyph indices. */
export function subsetFont(bytes: ArrayBuffer, text: string): ArrayBuffer {
  const codePoints = [...new Set(Array.from(text + ' ').map((char) => char.codePointAt(0)!))];
  const font = createFont(bytes, {
    type: 'ttf',
    subset: codePoints,
    compound2simple: true,
    hinting: false,
    kerning: false,
  });
  return font.write({ type: 'ttf', hinting: false }) as ArrayBuffer;
}

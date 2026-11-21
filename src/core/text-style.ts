export const inlineTextProperties = [
  'font-weight',
  'font-style',
  'text-decoration',
  'color',
  'font-family',
  'font-size',
  'letter-spacing',
];

export function retainTextStyle(element: HTMLElement): void {
  const values = inlineTextProperties.map((name) => [name, element.style?.getPropertyValue(name)]);
  for (const attr of [...element.attributes]) element.removeAttribute(attr.name);
  for (const [name, value] of values) if (value) element.style.setProperty(name, value);
}

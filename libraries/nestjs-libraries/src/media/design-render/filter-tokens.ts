/**
 * Canonical filter-token vocabulary shared between the client canvas and the
 * server render worker. Keep this file dependency-free so both sides can import
 * it without pulling in UI or Node-only modules.
 */

export const DESIGNER_FILTER_TOKENS = [
  'grayscale',
  'sepia',
  'blur',
  'brightness',
  'contrast',
  'saturate',
] as const;

export type DesignerFilterToken = (typeof DESIGNER_FILTER_TOKENS)[number];

export const isDesignerFilterToken = (
  key: string
): key is DesignerFilterToken =>
  (DESIGNER_FILTER_TOKENS as readonly string[]).includes(key);

export const parseDesignerFilterToken = (
  token: string
): { key: DesignerFilterToken; value?: number } | null => {
  if (token === 'grayscale' || token === 'sepia') {
    return { key: token };
  }
  const [key, valueStr] = token.split(':');
  if (!isDesignerFilterToken(key) || valueStr === undefined) return null;
  const value = parseFloat(valueStr);
  if (Number.isNaN(value)) return null;
  return { key, value };
};

export const buildDesignerFilterToken = (
  key: DesignerFilterToken,
  value?: number
): string => {
  if (key === 'grayscale' || key === 'sepia') return key;
  return `${key}:${value ?? 0}`;
};

/** CSS filter string used by the server canvas renderer. */
export const cssFilterForToken = (
  key: DesignerFilterToken,
  value?: number
): string => {
  switch (key) {
    case 'grayscale':
      return 'grayscale(100%)';
    case 'sepia':
      return 'sepia(100%)';
    case 'blur':
      return `blur(${value ?? 0}px)`;
    case 'brightness':
      return `brightness(${value ?? 1})`;
    case 'contrast':
      return `contrast(${value ?? 1})`;
    case 'saturate':
      return `saturate(${value ?? 1})`;
  }
};

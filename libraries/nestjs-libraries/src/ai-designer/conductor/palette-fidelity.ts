import type { DesignPlan } from '../ai-designer.types';

const HEX_RE = /^#[0-9a-f]{6}$/i;
const HEX_IN_TEXT_RE = /#[0-9a-f]{6}\b/gi;

export const validPaletteColors = (values: unknown): string[] =>
  Array.isArray(values)
    ? [...new Set(values.filter((value): value is string => typeof value === 'string' && HEX_RE.test(value)).map((value) => value.toLowerCase()))]
    : [];

export const explicitPromptColors = (intent: string): string[] =>
  validPaletteColors((intent || '').match(HEX_IN_TEXT_RE) ?? []);

export const applyPaletteConstraints = (
  plans: DesignPlan[],
  options: { brandPalette?: string[]; intent?: string; pinnedStyle?: boolean }
): DesignPlan[] => {
  const brand = validPaletteColors(options.brandPalette);
  const explicit = explicitPromptColors(options.intent ?? '');
  const required = [...explicit, ...(options.pinnedStyle ? [] : brand)];
  if (!required.length) return plans;

  return plans.map((plan) => {
    const current = validPaletteColors(plan.palette);
    const palette = [
      ...current.slice(0, 2),
      ...required,
      ...current.slice(2),
    ].filter((color, index, all) => all.indexOf(color) === index);
    for (const fallback of [...current, '#ffffff', '#000000']) {
      if (palette.length >= 3) break;
      if (!palette.includes(fallback)) palette.push(fallback);
    }
    return { ...plan, palette };
  });
};

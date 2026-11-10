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
  options: { brandPalette?: string[]; intent?: string }
): DesignPlan[] => {
  const brand = validPaletteColors(options.brandPalette);
  const explicit = explicitPromptColors(options.intent ?? '');
  if (!brand.length && !explicit.length) return plans;

  return plans.map((plan) => {
    const current = validPaletteColors(plan.palette);
    const base = brand.length ? brand : current.slice(0, 2);
    const palette = [
      ...base,
      ...explicit,
      ...current.slice(brand.length ? 0 : 2),
    ].filter((color, index, all) => all.indexOf(color) === index);
    for (const fallback of current) {
      if (palette.length >= 3) break;
      if (!palette.includes(fallback)) palette.push(fallback);
    }
    return {
      ...plan,
      palette,
      ...(plan.background?.kind === 'solid' && palette[0]
        ? { background: { ...plan.background, value: palette[0] } }
        : {}),
    };
  });
};

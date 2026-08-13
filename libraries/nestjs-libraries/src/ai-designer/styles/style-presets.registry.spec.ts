import { describe, expect, it } from 'vitest';
import { CURATED_FONTS } from '../../media/design-render/font-loader.service';
import {
  DEFAULT_STYLE_ID,
  STYLE_PRESET_IDS,
  getStylePreset,
  listStylePresets,
} from './style-presets.registry';

const HEX_RE = /^#[0-9A-Fa-f]{6}$/;
const CURATED_FAMILIES = new Set(CURATED_FONTS.map((f) => f.family));

describe('AI Designer style preset registry', () => {
  const presets = listStylePresets();

  it('exposes the expected preset ids', () => {
    expect(STYLE_PRESET_IDS).toEqual([
      'bold',
      'editorial',
      'minimal',
      'neon',
      'retro',
      'neobrutalism',
      'corporate',
      'refined',
    ]);
    expect(presets.map((p) => p.id)).toEqual(STYLE_PRESET_IDS);
  });

  it('has unique ids', () => {
    expect(new Set(STYLE_PRESET_IDS).size).toBe(STYLE_PRESET_IDS.length);
  });

  it('resolves the default style', () => {
    expect(getStylePreset(DEFAULT_STYLE_ID)).toBeDefined();
  });

  it('returns undefined for unknown ids and a defensive copy from listStylePresets', () => {
    expect(getStylePreset('nope')).toBeUndefined();
    expect(getStylePreset(undefined)).toBeUndefined();
    expect(listStylePresets()).not.toBe(presets);
  });

  it.each(presets.map((p) => [p.id, p] as const))(
    '%s: fonts exist in the curated catalog',
    (_id, preset) => {
      expect(CURATED_FAMILIES.has(preset.fonts.display)).toBe(true);
      expect(CURATED_FAMILIES.has(preset.fonts.body)).toBe(true);
    }
  );

  it.each(presets.map((p) => [p.id, p] as const))(
    '%s: palettes are 2-3 arrays of 3-5 valid hex colors',
    (_id, preset) => {
      expect(preset.palettes.length).toBeGreaterThanOrEqual(2);
      expect(preset.palettes.length).toBeLessThanOrEqual(3);
      for (const palette of preset.palettes) {
        expect(palette.length).toBeGreaterThanOrEqual(3);
        expect(palette.length).toBeLessThanOrEqual(5);
        for (const color of palette) {
          expect(color).toMatch(HEX_RE);
        }
      }
    }
  );

  it.each(presets.map((p) => [p.id, p] as const))(
    '%s: type scale is headline-relative and treatments are well-formed',
    (_id, preset) => {
      expect(preset.typeScale.headline).toBe(1);
      for (const ratio of Object.values(preset.typeScale)) {
        expect(ratio).toBeGreaterThan(0);
        expect(ratio).toBeLessThanOrEqual(1);
      }
      expect(['pill', 'rect', 'underline', 'outline']).toContain(
        preset.treatments.ctaStyle
      );
      expect(preset.description.length).toBeGreaterThan(0);
      expect(preset.promptFragment.split('\n').length).toBeGreaterThanOrEqual(3);
    }
  );
});

describe('AI Designer style preset CTA treatments', () => {
  const presets = listStylePresets();
  const byId = (id: string) => presets.find((p) => p.id === id)!;

  it.each(presets.map((p) => [p.id, p] as const))(
    '%s: cta treatment fields are well-formed',
    (_id, preset) => {
      if (preset.treatments.ctaRadius !== undefined) {
        expect(['square', 'small', 'pill']).toContain(
          preset.treatments.ctaRadius
        );
      }
      for (const flag of [
        preset.treatments.ctaBorder,
        preset.treatments.ctaShadow,
      ]) {
        if (flag !== undefined) expect(typeof flag).toBe('boolean');
      }
      // A border/shadow only renders on a filled button — the outline and
      // underline branches skip both.
      if (preset.treatments.ctaBorder || preset.treatments.ctaShadow) {
        expect(preset.treatments.ctaStyle).toBe('rect');
      }
    }
  );

  it('neobrutalism: "a hard-edged rectangle with a thick border and an offset solid shadow"', () => {
    const { treatments, promptFragment } = byId('neobrutalism');
    expect(promptFragment).toContain(
      'CTA is a hard-edged rectangle with a thick border and an offset solid shadow.'
    );
    expect(treatments.ctaStyle).toBe('rect');
    expect(treatments.ctaRadius).toBe('square');
    expect(treatments.ctaBorder).toBe(true);
    expect(treatments.ctaShadow).toBe(true);
  });

  it('minimal: "a plain rectangular CTA at most" — no rounding, no border, no shadow', () => {
    const { treatments, promptFragment } = byId('minimal');
    expect(promptFragment).toContain('a plain rectangular CTA at most');
    expect(promptFragment).toContain('No decorative shapes, shadows, or strokes');
    expect(treatments.ctaStyle).toBe('rect');
    expect(treatments.ctaRadius).toBe('square');
    expect(treatments.ctaBorder).toBeUndefined();
    expect(treatments.ctaShadow).toBeUndefined();
  });

  it('corporate: "a solid or lightly rounded rectangle"', () => {
    const { treatments, promptFragment } = byId('corporate');
    expect(promptFragment).toContain(
      'CTA is a solid or lightly rounded rectangle in the accent color.'
    );
    expect(treatments.ctaStyle).toBe('rect');
    expect(treatments.ctaRadius).toBe('small');
    expect(treatments.ctaBorder).toBeUndefined();
    expect(treatments.ctaShadow).toBeUndefined();
  });

  it('every rect/outline preset states a corner treatment (no shared default)', () => {
    // One shared round(height * 0.14) used to serve all of them, which shipped
    // a 9px radius on the presets whose own prompt demands hard edges.
    for (const preset of presets) {
      if (preset.treatments.ctaStyle === 'rect' || preset.treatments.ctaStyle === 'outline') {
        expect(preset.treatments.ctaRadius).toBeDefined();
      }
    }
  });

  it('the pill and underline presets carry no corner override', () => {
    for (const preset of presets) {
      if (preset.treatments.ctaStyle === 'pill' || preset.treatments.ctaStyle === 'underline') {
        expect(preset.treatments.ctaRadius).toBeUndefined();
      }
    }
  });
});

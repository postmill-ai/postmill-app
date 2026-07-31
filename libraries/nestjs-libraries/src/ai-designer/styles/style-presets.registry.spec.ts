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

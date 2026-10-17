import { describe, it, expect } from 'vitest';
import {
  parseDesignerFilterToken,
  cssFilterForToken,
} from '@postmill-ai/nestjs-libraries/media/design-render/filter-tokens';
import { MAX_FILTERS_PER_ELEMENT } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.limits';
import {
  CLIP_LOOK_PRESETS,
  activeLookForFilters,
  lookCssFilter,
  toggleClipLook,
} from './clip-look-presets';

/**
 * A look is only ever a bundle of the shared filter-token vocabulary, so the
 * contract to pin is: every preset is expressible, valid and within the
 * schema's per-element bound — and the toggle writes/clears tokens, nothing
 * else.
 */
describe('CLIP_LOOK_PRESETS', () => {
  it('has unique ids', () => {
    const ids = CLIP_LOOK_PRESETS.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('builds every look from valid, renderable filter tokens', () => {
    for (const look of CLIP_LOOK_PRESETS) {
      expect(look.filters.length).toBeGreaterThan(0);
      expect(look.filters.length).toBeLessThanOrEqual(MAX_FILTERS_PER_ELEMENT);
      for (const token of look.filters) {
        const parsed = parseDesignerFilterToken(token);
        expect(parsed, `${look.id}: ${token}`).not.toBeNull();
        // The token must produce CSS on BOTH renderers, not parse then drop.
        expect(
          cssFilterForToken(parsed!.key, parsed!.value),
          `${look.id}: ${token}`
        ).toBeTruthy();
      }
      // The swatch preview filter string is non-empty for every look.
      expect(lookCssFilter(look)).toBeTruthy();
    }
  });

  it('never uses a valued grayscale/sepia token, which the renderers treat differently', () => {
    // 'sepia:0.3' parses, but the preview drops it while the frame renderer
    // renders full sepia — presets must stick to the bare 100% tokens.
    for (const look of CLIP_LOOK_PRESETS) {
      for (const token of look.filters) {
        expect(token.startsWith('grayscale:')).toBe(false);
        expect(token.startsWith('sepia:')).toBe(false);
      }
    }
  });
});

describe('activeLookForFilters', () => {
  it('matches the clip carrying exactly a preset’s tokens', () => {
    const vivid = CLIP_LOOK_PRESETS.find((l) => l.id === 'vivid')!;
    expect(activeLookForFilters([...vivid.filters])?.id).toBe('vivid');
  });

  it('does not match after a manual filter edit', () => {
    const vivid = CLIP_LOOK_PRESETS.find((l) => l.id === 'vivid')!;
    expect(activeLookForFilters([...vivid.filters, 'blur:2'])).toBeUndefined();
    expect(activeLookForFilters(['saturate:1.4'])).toBeUndefined();
    // Order matters — the tokens are an applied stack, not a set.
    expect(activeLookForFilters([...vivid.filters].reverse())).toBeUndefined();
  });

  it('matches nothing for empty or absent filters', () => {
    expect(activeLookForFilters(undefined)).toBeUndefined();
    expect(activeLookForFilters([])).toBeUndefined();
  });
});

describe('toggleClipLook', () => {
  const cinema = CLIP_LOOK_PRESETS.find((l) => l.id === 'cinema')!;
  const mono = CLIP_LOOK_PRESETS.find((l) => l.id === 'mono')!;

  it('writes the preset’s tokens onto the clip', () => {
    expect(toggleClipLook(undefined, cinema)).toEqual(cinema.filters);
    expect(toggleClipLook(['blur:4'], cinema)).toEqual(cinema.filters);
  });

  it('replaces another look’s tokens', () => {
    expect(toggleClipLook(mono.filters, cinema)).toEqual(cinema.filters);
  });

  it('clears the filters when the active look is clicked again', () => {
    expect(toggleClipLook([...cinema.filters], cinema)).toEqual([]);
  });

  it('does not alias the preset’s array', () => {
    const next = toggleClipLook(undefined, cinema);
    next.push('blur:9');
    expect(cinema.filters).toHaveLength(3);
  });
});

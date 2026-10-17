/**
 * "Looks" — named bundles of the six existing clip filter tokens
 * (grayscale/sepia/blur/brightness/contrast/saturate).
 *
 * A look is pure sugar over `clip.filters`: picking one WRITES the preset's
 * tokens onto the clip, so both renderers (the Konva overlay's
 * `mapFiltersToCss` and the frame renderer's `applyFilters`) apply it with
 * zero render-side change, and manual slider edits afterwards simply edit the
 * same token array. A look shows as active only while the clip's tokens match
 * the preset exactly.
 */

import {
  cssFilterForToken,
  parseDesignerFilterToken,
} from '@postmill-ai/nestjs-libraries/media/design-render/filter-tokens';

export interface ClipLookPreset {
  /** Stable identifier — used for matching and i18n keys. Never translate. */
  id: string;
  /** i18n key for the display label — `name` is the English fallback. */
  nameKey: string;
  name: string;
  /** Filter tokens, in application order. */
  filters: string[];
}

export const CLIP_LOOK_PRESETS: ClipLookPreset[] = [
  {
    id: 'vivid',
    nameKey: 'designer_look_vivid',
    name: 'Vivid',
    filters: ['saturate:1.4', 'contrast:1.1'],
  },
  {
    id: 'warm',
    nameKey: 'designer_look_warm',
    name: 'Warm',
    filters: ['brightness:1.05', 'saturate:1.2', 'contrast:1.05'],
  },
  {
    id: 'cool',
    nameKey: 'designer_look_cool',
    name: 'Cool',
    filters: ['brightness:1.02', 'contrast:1.05', 'saturate:0.85'],
  },
  {
    id: 'fade',
    nameKey: 'designer_look_fade',
    name: 'Fade',
    filters: ['contrast:0.9', 'brightness:1.1', 'saturate:0.8'],
  },
  {
    id: 'mono',
    nameKey: 'designer_look_mono',
    name: 'Mono',
    filters: ['grayscale'],
  },
  {
    id: 'noir',
    nameKey: 'designer_look_noir',
    name: 'Noir',
    filters: ['grayscale', 'contrast:1.3', 'brightness:0.95'],
  },
  {
    id: 'vintage',
    nameKey: 'designer_look_vintage',
    name: 'Vintage',
    filters: ['sepia', 'brightness:1.05', 'contrast:0.95'],
  },
  {
    id: 'hdr',
    nameKey: 'designer_look_hdr',
    name: 'HDR',
    filters: ['contrast:1.25', 'saturate:1.15'],
  },
  {
    id: 'soft',
    nameKey: 'designer_look_soft',
    name: 'Soft',
    filters: ['blur:0.6', 'brightness:1.06', 'saturate:1.05'],
  },
  {
    id: 'pop',
    nameKey: 'designer_look_pop',
    name: 'Pop',
    filters: ['saturate:1.6', 'contrast:1.15'],
  },
  {
    id: 'cinema',
    nameKey: 'designer_look_cinema',
    name: 'Cinema',
    filters: ['contrast:1.15', 'saturate:0.9', 'brightness:0.95'],
  },
  {
    id: 'dreamy',
    nameKey: 'designer_look_dreamy',
    name: 'Dreamy',
    filters: ['blur:1', 'brightness:1.1', 'saturate:1.1'],
  },
];

/** CSS filter string for a look — drives the swatch thumbnail in the gallery. */
export const lookCssFilter = (look: ClipLookPreset): string =>
  look.filters
    .map((token) => {
      const parsed = parseDesignerFilterToken(token);
      return parsed ? cssFilterForToken(parsed.key, parsed.value) : '';
    })
    .filter(Boolean)
    .join(' ');

const sameTokens = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((token, i) => token === b[i]);

/**
 * The look whose tokens the clip currently carries, in order. Any manual
 * filter edit breaks the match — the clip keeps the tokens, it just stops
 * being "the Vivid look".
 */
export const activeLookForFilters = (
  filters?: readonly string[]
): ClipLookPreset | undefined => {
  if (!filters?.length) return undefined;
  return CLIP_LOOK_PRESETS.find((look) => sameTokens(filters, look.filters));
};

/**
 * Toggle a look on a clip: applies the preset's tokens (replacing whatever
 * `filters` held), or clears them when the look is already active.
 */
export const toggleClipLook = (
  filters: readonly string[] | undefined,
  look: ClipLookPreset
): string[] =>
  activeLookForFilters(filters)?.id === look.id ? [] : [...look.filters];

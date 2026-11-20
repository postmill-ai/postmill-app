import {
  cssFilterForToken,
  parseDesignerFilterToken,
} from '@postmill-ai/nestjs-libraries/media/design-render/filter-tokens';

export interface FilterPreset {
  id: string;
  nameKey: string;
  name: string;
  filters: string[];
}

export const FILTER_PRESETS: FilterPreset[] = [
  { id: 'vivid', nameKey: 'designer_look_vivid', name: 'Vivid', filters: ['saturate:1.4', 'contrast:1.1'] },
  { id: 'warm', nameKey: 'designer_look_warm', name: 'Warm', filters: ['brightness:1.05', 'saturate:1.2', 'contrast:1.05'] },
  { id: 'cool', nameKey: 'designer_look_cool', name: 'Cool', filters: ['brightness:1.02', 'contrast:1.05', 'saturate:0.85'] },
  { id: 'fade', nameKey: 'designer_look_fade', name: 'Fade', filters: ['contrast:0.9', 'brightness:1.1', 'saturate:0.8'] },
  { id: 'mono', nameKey: 'designer_look_mono', name: 'Mono', filters: ['grayscale'] },
  { id: 'noir', nameKey: 'designer_look_noir', name: 'Noir', filters: ['grayscale', 'contrast:1.3', 'brightness:0.95'] },
  { id: 'vintage', nameKey: 'designer_look_vintage', name: 'Vintage', filters: ['sepia', 'brightness:1.05', 'contrast:0.95'] },
  { id: 'hdr', nameKey: 'designer_look_hdr', name: 'HDR', filters: ['contrast:1.25', 'saturate:1.15'] },
  { id: 'soft', nameKey: 'designer_look_soft', name: 'Soft', filters: ['blur:0.6', 'brightness:1.06', 'saturate:1.05'] },
  { id: 'pop', nameKey: 'designer_look_pop', name: 'Pop', filters: ['saturate:1.6', 'contrast:1.15'] },
  { id: 'cinema', nameKey: 'designer_look_cinema', name: 'Cinema', filters: ['contrast:1.15', 'saturate:0.9', 'brightness:0.95'] },
  { id: 'dreamy', nameKey: 'designer_look_dreamy', name: 'Dreamy', filters: ['blur:1', 'brightness:1.1', 'saturate:1.1'] },
];

export const filterPresetCss = (preset: FilterPreset): string =>
  preset.filters
    .map((token) => {
      const parsed = parseDesignerFilterToken(token);
      return parsed ? cssFilterForToken(parsed.key, parsed.value) : '';
    })
    .filter(Boolean)
    .join(' ');

const sameTokens = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((token, i) => token === b[i]);

export const activeFilterPreset = (
  filters?: readonly string[]
): FilterPreset | undefined => {
  if (!filters?.length) return undefined;
  return FILTER_PRESETS.find((preset) => sameTokens(filters, preset.filters));
};

export const toggleFilterPreset = (
  filters: readonly string[] | undefined,
  preset: FilterPreset
): string[] =>
  activeFilterPreset(filters)?.id === preset.id ? [] : [...preset.filters];

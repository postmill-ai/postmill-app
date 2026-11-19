import {
  FILTER_PRESETS,
  activeFilterPreset,
  filterPresetCss,
  toggleFilterPreset,
  type FilterPreset,
} from './filter-presets';

export type ClipLookPreset = FilterPreset;
export const CLIP_LOOK_PRESETS = FILTER_PRESETS;
export const lookCssFilter = filterPresetCss;
export const activeLookForFilters = activeFilterPreset;
export const toggleClipLook = toggleFilterPreset;

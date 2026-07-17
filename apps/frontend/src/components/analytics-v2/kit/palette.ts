// Single source of truth for analytics-v2 chart colours.
//
// Replaces the 6-colour palette that used to be re-declared as a literal array
// in overview.tab, post.detail.chart, and the drill panels (F1), and the raw
// `#2B5CD3` accent that filter.bar hard-coded 12×.

/**
 * The brand accent. This is the ONE place the raw hex literal lives — everywhere
 * else references `ACCENT`, the `designerAccent` Tailwind token, or `--new-btn-primary`.
 */
export const ACCENT = '#2B5CD3';

/** RGB triple of {@link ACCENT}, for building rgba() ramps without re-parsing hex. */
export const ACCENT_RGB = '43, 92, 211';

/**
 * The 6-colour categorical chart palette. Each entry resolves a `--chart-N` CSS
 * token (defined in colors.scss for both themes) with a hard-coded fallback.
 */
export const CHART_PALETTE: string[] = [
  'var(--chart-1, #2b5cd3)',
  'var(--chart-2, #32d583)',
  'var(--chart-3, #1d9bf0)',
  'var(--chart-4, #f97066)',
  'var(--chart-5, #ffac30)',
  'var(--chart-6, #8b90ff)',
];

/**
 * Sequential heat ramp (low → high engagement), built from the accent so it
 * reads correctly in both light and dark themes. Applied as an inline
 * `backgroundColor` over a `bg-newTableHeader` base — no raw Tailwind palette
 * classes (green-500/orange-500/…), which don't adapt to light mode.
 */
export const HEATMAP_RAMP: string[] = [
  `rgba(${ACCENT_RGB}, 0.10)`,
  `rgba(${ACCENT_RGB}, 0.28)`,
  `rgba(${ACCENT_RGB}, 0.46)`,
  `rgba(${ACCENT_RGB}, 0.66)`,
  `rgba(${ACCENT_RGB}, 0.88)`,
];

/** Map an engagement ratio (0..1) onto the heat ramp; 0 → transparent (base shows). */
export function heatmapColor(ratio: number): string {
  if (ratio <= 0) return 'transparent';
  if (ratio < 0.1) return HEATMAP_RAMP[0];
  if (ratio < 0.25) return HEATMAP_RAMP[1];
  if (ratio < 0.5) return HEATMAP_RAMP[2];
  if (ratio < 0.75) return HEATMAP_RAMP[3];
  return HEATMAP_RAMP[4];
}

import { GOOGLE_FONTS_CATALOG_RAW } from './google-fonts.catalog';

/**
 * The font catalog, shared by the picker, the canvas loader and the server
 * renderer.
 *
 * There used to be three hand-maintained lists — `designer/fonts.ts`, an
 * `@import` in `global.scss` and `CURATED_FONTS` on the server — and nothing
 * tied them together. A family missing from the second rendered as Arial; one
 * missing from the third exported as sans-serif. This is the single list, and
 * `google-fonts.catalog.ts` is generated rather than typed by hand.
 *
 * It is also the server's **allowlist**: a family name ends up interpolated
 * into a fonts.googleapis.com URL, so it gets checked against this before the
 * fetch rather than trusted from the document.
 */

export type FontCategory =
  | 'sans-serif'
  | 'serif'
  | 'display'
  | 'handwriting'
  | 'monospace';

export interface CatalogFont {
  family: string;
  category: FontCategory;
  /** Upright weights Google actually serves for this family. */
  weights: number[];
}

const CATEGORY_BY_CODE: Record<string, FontCategory> = {
  s: 'sans-serif',
  f: 'serif',
  d: 'display',
  h: 'handwriting',
  m: 'monospace',
};

const parse = (): CatalogFont[] => {
  const out: CatalogFont[] = [];
  for (const row of GOOGLE_FONTS_CATALOG_RAW.split('\n')) {
    if (!row) continue;
    const [family, code, weights] = row.split('|');
    const category = CATEGORY_BY_CODE[code];
    if (!family || !category || !weights) continue;
    out.push({
      family,
      category,
      weights: weights.split(',').map(Number).filter(Boolean),
    });
  }
  return out;
};

export const GOOGLE_FONTS: CatalogFont[] = parse();

const BY_FAMILY = new Map(GOOGLE_FONTS.map((f) => [f.family, f]));

/** The catalog entry for a family, or undefined if Google does not serve it. */
export const catalogFont = (family: string): CatalogFont | undefined =>
  BY_FAMILY.get(family);

/**
 * Whether a family may be fetched. Everything that builds a Google Fonts URL
 * from a document-supplied name goes through this first.
 */
export const isCatalogFamily = (family: string): boolean =>
  BY_FAMILY.has(family);

/**
 * The weights to request for a family, narrowed to what Google serves.
 *
 * Asking for a weight a family does not have makes the whole `css2` request
 * 400, which would take every other family in the same request down with it.
 */
export const catalogWeights = (family: string, wanted: number[]): number[] => {
  const entry = BY_FAMILY.get(family);
  if (!entry) return [];
  const available = new Set(entry.weights);
  const kept = wanted.filter((w) => available.has(w));
  if (kept.length) return [...new Set(kept)].sort((a, b) => a - b);
  // Nothing matched — fall back to the family's own default rather than
  // dropping it entirely and rendering in a fallback face.
  return [available.has(400) ? 400 : entry.weights[0]];
};

/**
 * The stylesheet URL for one family at the given weights.
 *
 * `display=swap` so text paints in a fallback rather than staying invisible;
 * the canvas re-measures once the real font arrives.
 */
export const googleFontsUrl = (family: string, weights: number[]): string => {
  const resolved = catalogWeights(family, weights);
  const encoded = family.replace(/ /g, '+');
  const spec = resolved.length ? `:wght@${resolved.join(';')}` : '';
  return `https://fonts.googleapis.com/css2?family=${encoded}${spec}&display=swap`;
};

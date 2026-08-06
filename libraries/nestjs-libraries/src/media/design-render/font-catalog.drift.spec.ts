import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  GOOGLE_FONTS,
  catalogWeights,
  googleFontsUrl,
  isCatalogFamily,
} from '../designer-doc/font-catalog';

/**
 * The Designer's font list used to be written down three times — the picker
 * (`fonts.ts`), the stylesheet that actually loaded them (`global.scss`) and
 * the server's `CURATED_FONTS` — with nothing tying them together, and the
 * failure silent in both directions: a family missing from the `@import`
 * rendered as Arial, one missing from `CURATED_FONTS` exported as sans-serif.
 *
 * There is now one generated catalog that all three read, so these guard the
 * things that can still drift: a recommended family that Google does not serve,
 * and the return of a baked stylesheet.
 */

const FRONTEND_ROOT = resolve(__dirname, '../../../../../apps/frontend/src');
const FONTS_TS = resolve(FRONTEND_ROOT, 'components/media-tools/designer/fonts.ts');
const GLOBAL_SCSS = resolve(FRONTEND_ROOT, 'app/global.scss');

/** The one family the picker carries that is never fetched: the system font. */
const SYSTEM_ONLY = new Set(['Arial']);

const parseRecommended = (): Map<string, number[]> => {
  const source = readFileSync(FONTS_TS, 'utf8');
  const out = new Map<string, number[]>();
  const entry = /\{\s*family:\s*'([^']+)'[^}]*?weights:\s*\[([^\]]*)\]/g;
  let match: RegExpExecArray | null;
  while ((match = entry.exec(source))) {
    const family = match[1];
    if (SYSTEM_ONLY.has(family)) continue;
    out.set(
      family,
      match[2]
        .split(',')
        .map((n) => Number(n.trim()))
        .filter((n) => !Number.isNaN(n))
    );
  }
  return out;
};

describe('font catalog', () => {
  it('covers the whole of Google Fonts, not a shortlist', () => {
    expect(GOOGLE_FONTS.length).toBeGreaterThan(1500);
  });

  it('every recommended family is one Google actually serves', () => {
    // A recommended family missing from the catalog would be unloadable: the
    // loader gates on the catalog, so the picker would offer a face that
    // silently renders as a fallback.
    const missing = [...parseRecommended().keys()].filter((f) => !isCatalogFamily(f));
    expect(missing).toEqual([]);
  });

  it('every recommended weight is one that family actually has', () => {
    // Asking css2 for a weight a family lacks 400s the request.
    const wrong: string[] = [];
    for (const [family, weights] of parseRecommended()) {
      const usable = catalogWeights(family, weights);
      const missing = weights.filter((w) => !usable.includes(w));
      if (missing.length) wrong.push(`${family}: ${missing.join(',')}`);
    }
    expect(wrong).toEqual([]);
  });

  it('does not bake a font stylesheet back into global.scss', () => {
    // The single @import carried ~50 families on every page load and had run
    // out of URL to grow into. Families load per-family, on demand, now.
    const scss = readFileSync(GLOBAL_SCSS, 'utf8');
    expect(scss).not.toMatch(/@import url\('https:\/\/fonts\.googleapis\.com/);
  });

  it('still offers a condensed cut in both the sans and serif ranges', () => {
    const families = new Set(parseRecommended().keys());
    expect(families.has('Roboto Condensed')).toBe(true);
    expect(families.has('Barlow Condensed')).toBe(true);
    expect(families.has('Bodoni Moda')).toBe(true);
  });
});

describe('googleFontsUrl', () => {
  it('encodes spaces the way the CSS API expects', () => {
    expect(googleFontsUrl('Roboto Condensed', [400])).toContain('family=Roboto+Condensed');
  });

  it('narrows to weights the family actually has', () => {
    // Anton ships one weight; asking for 700 as well would break the request.
    const url = googleFontsUrl('Anton', [400, 700]);
    expect(url).toContain('wght@400');
    expect(url).not.toContain('700');
  });

  it('falls back to a real weight rather than dropping the family', () => {
    expect(catalogWeights('Anton', [900])).toEqual([400]);
  });

  it('asks for display=swap so text is never invisible while loading', () => {
    expect(googleFontsUrl('Inter', [400])).toContain('display=swap');
  });
});
